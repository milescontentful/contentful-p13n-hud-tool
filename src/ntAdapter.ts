// ntAdapter.ts — the ONLY place the OperatorHud touches a p13n SDK.
//
// 2026-08-15: rewritten for @contentful/optimization (the design intent all
// along — "when @contentful/optimization replaces the legacy SDK, rewrite
// these two functions and the HUD is untouched"). The two-touchpoint contract
// (activatePersona / resetAll) is unchanged; the HUD's widget-parity extras
// (profile read, variant forcing, profile reset) also live here now so the
// HUD has ONE import for all SDK access.
//
// How it talks to the new SDK — all official surface, no panel attached:
// - `window.contentfulOptimization` — the browser singleton the Web SDK
//   attaches on construction (OptimizationRoot creates it).
// - `getPreviewPanelBridge(sdk)` (@contentful/optimization-core/bridge-support)
//   — the same mutable-state bridge the first-party preview panel uses:
//   profile/selectedOptimizations signals + state interceptors.
// - `PreviewOverrideManager` (@contentful/optimization-core/preview-support)
//   — the platform-agnostic override engine behind the panel's audience and
//   variant forcing. We drive it from the HUD instead of the panel UI.
//
// Graceful degradation: every function no-ops (returns false/null) when no
// SDK singleton is mounted — the fixtures-only run and forks without a client
// id build clean and the HUD honestly shows "SDK not detected".
import {
  PreviewOverrideManager,
  type OverrideState,
} from '@contentful/optimization-core/preview-support'
import { getPreviewPanelBridge } from '@contentful/optimization-core/bridge-support'
import { getP13nDefinitions } from './optimization'

// Minimal structural typing of the Web SDK singleton — only what we call.
// (The full class type lives in @contentful/optimization-web; typing it
// structurally keeps this adapter decoupled from the package's generics.)
export type SdkProfile = {
  id: string
  stableId?: string
  audiences?: string[]
  traits?: Record<string, unknown>
}
type Observable<T> = {
  current: T
  subscribe: (next: (v: T) => void) => { unsubscribe: () => void }
}
type OptimizationSdk = {
  identify: (payload: { userId: string; traits?: Record<string, unknown> }) => Promise<unknown>
  page: (payload?: Record<string, unknown>) => Promise<unknown>
  reset: () => void
  states: {
    profile: Observable<SdkProfile | undefined>
    selectedOptimizations: Observable<unknown>
  }
}

function sdk(): OptimizationSdk | undefined {
  return (window as unknown as { contentfulOptimization?: OptimizationSdk }).contentfulOptimization
}

/** True when the Optimization Web SDK singleton is mounted on this page. */
export function sdkAvailable(): boolean {
  return !!sdk()
}

// ---- override manager (lazy singleton, built on the preview bridge) --------
let manager: PreviewOverrideManager | null = null
let managerFor: unknown = null
let overrides: Readonly<OverrideState> = { audiences: {}, selectedOptimizations: {} }

function overrideManager(): PreviewOverrideManager | null {
  const s = sdk()
  if (!s) return null
  if (!manager || managerFor !== s) {
    const bridge = getPreviewPanelBridge(s)
    manager = new PreviewOverrideManager({
      selectedOptimizations: bridge.selectedOptimizations,
      profile: bridge.profile,
      changes: bridge.changes,
      stateInterceptors: bridge.stateInterceptors,
      onOverridesChanged: (state) => {
        overrides = state
      },
    })
    managerFor = s
  }
  return manager
}

/** Current override state (audiences + forced variants), for display. */
export function getOverrides(): Readonly<OverrideState> {
  return overrides
}

/** Experience ids targeting an audience — the override manager needs them.
 * Matches BOTH id spaces: ExperienceDefinition.audience.id is the audience
 * entry's SYS id, while callers pass the nt_audience_id field value. */
function experienceIdsFor(audienceId: string): string[] {
  const defs = getP13nDefinitions()
  const sysId = defs.audienceSysIdByAudienceId[audienceId]
  return defs.experiences
    .filter((e) => e.audience?.id === audienceId || (sysId !== undefined && e.audience?.id === sysId))
    .map((e) => e.id)
}

/**
 * TOUCHPOINT 1 — activate a persona:
 * reset every known audience override (a stale forced-off override blocks
 * later activations — the PGE lesson), force the target audience on via the
 * override manager (sets its experiences to variant 1, exactly what the
 * preview panel's audience toggle does), and persist the declared trait with
 * identify() so it matches the audience's rules server-side and survives
 * reloads. No-op (returns false) when no SDK is mounted.
 */
export function activatePersona(opts: {
  audienceNtId?: string
  traitKey: string
  personaKey: string
  allAudienceIds: string[]
}): boolean {
  const s = sdk()
  if (!s) return false
  const m = overrideManager()
  if (m && opts.audienceNtId) {
    opts.allAudienceIds.forEach((a) => m.resetAudienceOverride(a))
    m.activateAudience(opts.audienceNtId, experienceIdsFor(opts.audienceNtId))
  }
  // empty userId = anonymous identify carrying traits (same as the legacy call)
  void s.identify({ userId: '', traits: { [opts.traitKey]: opts.personaKey } }).catch(() => {
    // Experience API rejected the event (bad client id / network) — audience
    // forcing above already happened locally, so the demo still moves.
  })
  return true
}

/**
 * TOUCHPOINT 2 — clear every audience + variant override (rearm / forget).
 * No-op (returns false) when no SDK is mounted.
 */
export function resetAll(_allAudienceIds: string[]): boolean {
  const m = overrideManager()
  if (!m) return false
  m.resetAll()
  return true
}

// ---- widget-parity extras (profile, variant forcing, profile reset) --------

/** Snapshot of the current profile (null when no SDK / not fetched yet). */
export function readProfile(): SdkProfile | null {
  return sdk()?.states.profile.current ?? null
}

/** Subscribe to live profile updates. Returns an unsubscribe fn, or null. */
export function subscribeProfile(next: (p: SdkProfile | null) => void): (() => void) | null {
  const s = sdk()
  if (!s) return null
  const sub = s.states.profile.subscribe((v) => next(v ?? null))
  return () => sub.unsubscribe()
}

/**
 * Force one experience to a variant index (0 = baseline), or `null` to clear
 * the override and let the SDK decide again.
 */
export function forceVariant(experienceId: string, variantIndex: number | null): boolean {
  const m = overrideManager()
  if (!m) return false
  if (variantIndex === null) m.resetOptimizationOverride(experienceId)
  else m.setVariantOverride(experienceId, variantIndex)
  return true
}

/**
 * Forget this profile entirely: clear all overrides, reset SDK state (drops
 * the anonymous-id cookie + caches), then fire a page event so a FRESH
 * profile is fetched (the SPA lesson — without an event, no new profile).
 */
export async function resetProfile(): Promise<boolean> {
  const s = sdk()
  if (!s) return false
  overrideManager()?.resetAll()
  s.reset()
  await s.page().catch(() => undefined)
  return true
}
