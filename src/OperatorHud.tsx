// OperatorHud — the "how did the page decide this" inspector for Contentful
// Personalization demos. Prop-driven and SURFACE-GENERIC: the host passes its
// personas/options and the HUD renders the causal chain top-to-bottom:
//   1 signals → 2 audience → 3 decision trace → 4 selected variant (+ why)
// The DECISION TRACE is three-state (matched / not matched / NO DATA) — an
// anonymous visitor is not a failed rule, and showing that honestly is the
// trust moment in a demo ("see the math").
// This HUD is THE p13n control surface on screen: it replaces the Contentful
// Optimization preview panel (don't attach both), so it also carries the
// panel's powers when the SDK is live (profile, per-experience variant
// forcing, profile reset). All of that is gated behind sdkAvailable().
// ALL SDK coupling stays in ./ntAdapter.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HudSignal, SegOption, TraceStep } from './types'
import {
  sdkAvailable,
  activatePersona,
  resetAll,
  readProfile,
  subscribeProfile,
  subscribeOverrides,
  forcedVariantFor,
  setPreviewPanelOpen,
  forceVariant as sdkForceVariant,
  resetProfile as sdkResetProfile,
  getOverrides,
  readSelections,
  subscribeSelections,
  type SdkProfile,
  type SdkSelection,
} from './ntAdapter'
import { audiencesFromEntries, evaluateAudiences, type VisitorFacts } from './evaluate'
import { clearFacts, readEventFacts, readPageFacts, recordPageFact } from './facts'
import { whyNotOthers } from './whyNot'
import { HUD_CSS, Icon, IconButton } from './icons'
import { getP13nDefinitions } from './optimization'
import { fetchPersonas, type ContentPersona } from './personas'
import { hudConfig } from './config'

const ACCENT = '#00B8C4'
const AMBER = '#F59E0B'
const GREEN = '#4ADE80'
const RED = '#F87171'

export interface AudienceOption {
  key: string
  label: string
  emoji: string
  color: string
  /** nt_audience_id this persona forces (default `aud-<key>`).
   *  `null` = a baseline persona (e.g. "Default visitor"): picking it forces
   *  every other persona's audience OFF, so the default content shows. */
  audienceNtId?: string | null
}

export type ContentSource = 'fixture' | 'contentful-personalization'

export interface HudProps {
  /** display label for the page/app the HUD sits on */
  surface: string
  /** currently active persona key */
  audience: string
  audienceOptions: AudienceOption[]
  /** profile trait the persona sets via identify(), e.g. 'segment' */
  traitKey: string
  selectedVariant: string
  decisionReason: string
  /** optional: your own decision trace. Omit it and the HUD builds one from
   * the REAL nt_audience rules + the visitor facts (see src/evaluate.ts). */
  trace?: TraceStep[]
  /** optional: what the page knows about the visitor. Any field you omit is
   * filled from the HUD's own session record (pages/UTM, recordEventFact
   * events) and the SDK profile (traits, joined audiences). */
  facts?: VisitorFacts
  /** optional: which nt_audience ids the auto-trace covers (default: the
   * audiences targeted by the experiences the HUD lists) */
  traceAudiences?: string[]
  signals: HudSignal[]
  onSwitchAudience: (key: string) => void
  onReset: () => void
  // ---- optional context rows (shown only when supplied) --------------------
  locale?: string
  timeOfDay?: string
  cfEntryId?: string
  // ---- optional operator rows: each renders only when its handler (and,
  // where needed, its options) are passed — no dead buttons on screen -------
  p13nOn?: boolean
  onSetP13n?: (on: boolean) => void
  preview?: 'personalized' | 'control'
  onSetPreview?: (p: 'personalized' | 'control') => void
  localeOptions?: SegOption[]
  onSetLocale?: (l: string) => void
  contentSource?: ContentSource
  onSetContentSource?: (s: ContentSource) => void
  experienceState?: string
  experienceStateOptions?: SegOption[]
  onSetExperienceState?: (s: string) => void
  entryPoint?: string
  entryPointOptions?: SegOption[]
  onSetEntryPoint?: (e: string) => void
  /** optional: which experiences the Advanced list offers (e.g. hide retired
   * drafts — the Preview API returns unpublished entries too) */
  experienceFilter?: (e: { id: string; name?: string; type?: string }) => boolean
}

// ---- Optimization SDK surface -----------------------------------------------
// The adapter (ntAdapter.ts) owns ALL SDK access now — profile reads, variant
// forcing, and profile reset included — so the HUD has zero window-global
// coupling of its own. Experience definitions come from the SDK's own
// nt_experience mappers via getP13nDefinitions().

// ---- HUD state persistence (survive reloads mid-demo) -----------------------
const HUD_STORE_KEY = 'p13n-operator-hud'
type HudStored = { pos?: { x: number; y: number } | null; collapsed?: Record<string, boolean> }
function loadHudState(): HudStored {
  try {
    return JSON.parse(sessionStorage.getItem(HUD_STORE_KEY) ?? '{}') as HudStored
  } catch {
    return {}
  }
}

function highlightPersonalized() {
  const el = document.querySelector('[data-p13n-target]') as HTMLElement | null
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  el.animate(
    [
      { boxShadow: 'inset 0 0 0 0 rgba(0,184,196,0)' },
      { boxShadow: 'inset 0 0 0 5px rgba(0,184,196,0.9)' },
      { boxShadow: 'inset 0 0 0 0 rgba(0,184,196,0)' },
    ],
    { duration: 1500, iterations: 2, easing: 'ease-in-out' },
  )
}

const TRACE_STYLE: Record<TraceStep['outcome'], { mark: string; color: string; label: string }> = {
  matched: { mark: '✓', color: GREEN, label: 'matched' },
  'not-matched': { mark: '✗', color: RED, label: 'not matched' },
  'no-data': { mark: '∅', color: AMBER, label: 'NO DATA' },
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

export function OperatorHud(p: HudProps) {
  const [open, setOpen] = useState(false)
  // one page fact per page load (URL + utm_*) — the evaluator's raw material
  useState(() => recordPageFact())
  // collapsed[sectionKey] = true → body hidden, header (with counts) remains
  // (restored from sessionStorage so a mid-demo reload keeps the layout)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => loadHudState().collapsed ?? {})
  // demoPersona entries from the space (personas are CONTENT when connected)
  const [contentPersonas, setContentPersonas] = useState<ContentPersona[] | null>(null)
  useEffect(() => {
    fetchPersonas().then(setContentPersonas)
  }, [])

  // ---- draggable anywhere: null = default bottom-right anchor ---------------
  // (drag position also restored from sessionStorage; the fit effect below
  // clamps a restored position back on-screen if the window shrank)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => loadHudState().pos ?? null)
  // persist drag position + collapse state across reloads (mid-demo safety)
  useEffect(() => {
    try {
      sessionStorage.setItem(HUD_STORE_KEY, JSON.stringify({ pos, collapsed } satisfies HudStored))
    } catch {
      // storage full/blocked — persistence is a convenience, never fatal
    }
  }, [pos, collapsed])
  const boxRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  function dragStart(e: React.PointerEvent, allowButtons = false) {
    // header buttons (minimize) must never start a drag — the pill itself may
    if (!allowButtons && (e.target as HTMLElement).closest('button, a')) return
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // synthetic/stale pointer — drag still works while the cursor stays on the handle
    }
  }
  function dragMove(e: React.PointerEvent) {
    const d = dragRef.current
    const el = boxRef.current
    if (!d || !el) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return
    d.moved = true
    const r = el.getBoundingClientRect()
    setPos({
      x: clamp(e.clientX - d.dx, 8, window.innerWidth - r.width - 8),
      y: clamp(e.clientY - d.dy, 8, window.innerHeight - Math.min(r.height, window.innerHeight - 16) - 8),
    })
  }
  // `suppress` only matters for the pill (a drag must not count as a click);
  // the panel header has no click action, and setting the flag there would
  // swallow the pill's first click after closing (observed bug)
  function dragEnd(suppress = false) {
    if (suppress) suppressClickRef.current = !!dragRef.current?.moved
    dragRef.current = null
  }
  // once dragged, keep the box on-screen when it changes size (open/collapse)
  // or the window resizes
  useLayoutEffect(() => {
    const fit = () => {
      const el = boxRef.current
      if (!pos || !el) return
      const r = el.getBoundingClientRect()
      const x = clamp(pos.x, 8, window.innerWidth - r.width - 8)
      const y = clamp(pos.y, 8, window.innerHeight - Math.min(r.height, window.innerHeight - 16) - 8)
      if (x !== pos.x || y !== pos.y) setPos({ x, y })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [pos, open])
  const anchor: React.CSSProperties = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : {}

  const personaOf = (key: string): AudienceOption => {
    const opt = p.audienceOptions.find((o) => o.key === key)
    const cp = contentPersonas?.find((x) => x.key === key)
    if (cp) return { key, label: cp.label, emoji: cp.emoji ?? opt?.emoji ?? '👤', color: cp.color ?? opt?.color ?? '#888' }
    return opt ?? { key, label: key, emoji: '👤', color: '#888' }
  }
  const sdkUp = sdkAvailable()
  const meta = personaOf(p.audience)
  // nt_audience_id per persona: content entry → prop → `aud-<key>` convention
  const audienceIdOf = (key: string): string | null => {
    const opt = p.audienceOptions.find((o) => o.key === key)
    if (opt?.audienceNtId === null) return null // baseline persona — forces no audience
    return contentPersonas?.find((x) => x.key === key)?.audienceNtId ?? opt?.audienceNtId ?? `aud-${key}`
  }
  const allAudienceIds = p.audienceOptions.map((o) => audienceIdOf(o.key)).filter((a): a is string => !!a)

  // ---- live SDK state (preview-panel parity, gated on sdkUp) ----------------
  const [profile, setProfile] = useState<SdkProfile | null>(null)
  // forced-variant chips read the REAL override state (so audience switches
  // and resets show up too) — this counter just triggers a re-render
  const [, setOverrideTick] = useState(0)
  useEffect(() => subscribeOverrides(() => setOverrideTick((t) => t + 1)), [])
  useEffect(() => {
    if (!open || !sdkUp) return
    setProfile(readProfile())
    // live subscription to the SDK's profile observable — no polling needed
    const unsub = subscribeProfile(setProfile)
    return () => unsub?.()
  }, [open, sdkUp])
  // which variant the SDK picked per experience (for the A/B rows + "why not")
  const [selections, setSelections] = useState<SdkSelection[]>([])
  useEffect(() => {
    if (!open || !sdkUp) return
    setSelections(readSelections())
    const unsub = subscribeSelections(setSelections)
    return () => unsub?.()
  }, [open, sdkUp])
  // tell the SDK a preview panel is open → it repaints forced variants live
  // (same signal the official panel sends; see ntAdapter.setPreviewPanelOpen)
  useEffect(() => {
    if (!sdkUp) return
    setPreviewPanelOpen(open)
    return () => {
      setPreviewPanelOpen(false)
    }
  }, [open, sdkUp])

  function forceVariant(expId: string, idx: number | null) {
    // writes the SDK's real selected-optimizations override (the same engine
    // the first-party preview panel drives)
    sdkForceVariant(expId, idx)
  }

  async function resetProfile() {
    // clears overrides, forgets the anonymous id, fires a page event so a
    // FRESH profile is fetched — all inside the adapter
    if (!(await sdkResetProfile())) return
    // a forgotten profile starts from this page again — so do the facts
    clearFacts()
    recordPageFact()
    setProfile(readProfile())
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])

  function switchAudience(key: string) {
    p.onSwitchAudience(key)
    activatePersona({
      audienceNtId: audienceIdOf(key) ?? undefined,
      traitKey: p.traitKey,
      personaKey: key,
      allAudienceIds,
    })
    window.setTimeout(highlightPersonalized, 350)
  }

  function reset() {
    resetAll(allAudienceIds)
    p.onReset()
  }

  if (!open) {
    return (
      <button
        ref={boxRef as unknown as React.Ref<HTMLButtonElement>}
        style={{ ...s.pill, ...anchor, touchAction: 'none' }}
        onPointerDown={(e) => dragStart(e, true)}
        onPointerMove={dragMove}
        onPointerUp={() => dragEnd(true)}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            return
          }
          setOpen(true)
        }}
        title="Open the personalization inspector (operator only) — drag to move"
      >
        <span style={{ ...s.dot, background: ACCENT }} />
        Contentful HUD
      </button>
    )
  }

  const row = (label: string, control: React.ReactNode) => (
    <div style={s.ctrlRow}>
      <span style={s.ctrlLabel}>{label}</span>
      {control}
    </div>
  )

  const seg = <T extends string>(value: T, options: { v: T; label: string }[], onPick: (v: T) => void) => (
    <div style={s.segWrap}>
      {options.map((o) => (
        <button key={o.v} type="button" className="p13n-hud-focus" aria-pressed={value === o.v} onClick={() => onPick(o.v)} style={{ ...s.segBtn, ...(value === o.v ? s.segOn : null) }}>
          {o.label}
        </button>
      ))}
    </div>
  )

  // numbered step header — the causal chain 1→4. Sections with a `k` collapse.
  const stepHead = (n: number | null, label: string, right?: React.ReactNode, k?: string) => (
    <div
      style={{ ...s.stepLabel, cursor: k ? 'pointer' : 'default' }}
      onClick={k ? () => setCollapsed((c) => ({ ...c, [k]: !c[k] })) : undefined}
      onKeyDown={k ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setCollapsed((c) => ({ ...c, [k]: !c[k] }))) : undefined}
      role={k ? 'button' : undefined}
      tabIndex={k ? 0 : undefined}
      aria-expanded={k ? !collapsed[k] : undefined}
      className={k ? 'p13n-hud-focus' : undefined}
      title={k ? 'Click to collapse / expand' : undefined}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        {n !== null && <span style={s.stepNo}>{n}</span>}
        {label}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        {right}
        {k && <span style={s.chev}>{collapsed[k] ? '▸' : '▾'}</span>}
      </span>
    </div>
  )

  // experience graph mapped by the SDK's own nt_experience mappers
  const defs = getP13nDefinitions()
  const listed = defs.experiences.filter((e) => !p.experienceFilter || p.experienceFilter(e))
  const experiences = sdkUp ? listed : []

  // ---- ③ the decision trace: built from the REAL nt_audience rules ----------
  // (a host-supplied `trace` prop still wins — see evaluate.ts for the math)
  const liveProfile = profile ?? (sdkUp ? readProfile() : null)
  const facts: VisitorFacts = {
    pages: p.facts?.pages ?? readPageFacts(),
    events: p.facts?.events ?? readEventFacts(),
    traits: p.facts?.traits ?? (liveProfile ? (liveProfile.traits ?? {}) : undefined),
    confirmedAudiences: p.facts?.confirmedAudiences ?? liveProfile?.audiences,
  }
  const autoTrace: TraceStep[] = []
  if (!p.trace) {
    const all = audiencesFromEntries(defs.audienceEntries)
    const wanted = p.traceAudiences ?? listed.map((e) => e.audience?.id).filter((x): x is string => !!x)
    const traced = wanted.length ? all.filter((a) => wanted.includes(a.id) || (!!a.sysId && wanted.includes(a.sysId))) : all
    autoTrace.push(...evaluateAudiences(traced, facts))
    // A/B tests with no audience: everyone qualifies — show which half this visitor got
    for (const e of listed.filter((x) => x.type === 'nt_experiment' && !x.audience)) {
      const sel = selections.find((x) => x.experienceId === e.id)
      const forced = forcedVariantFor(e.id) !== null
      const share = (i: number) => {
        const pc = e.distribution.find((d) => d.index === i)?.percentage
        return pc !== undefined ? ` (${pc}%)` : ''
      }
      autoTrace.push({
        rule: `A/B test: ${(e.name ?? e.id).replace(/^\[[^\]]+\]\s*/, '')}`,
        outcome: 'matched',
        detail: sel
          ? `everyone is in it · this visitor got ${sel.variantIndex === 0 ? 'the baseline' : `V${sel.variantIndex}`}${share(sel.variantIndex)}${forced ? ' — operator override' : ''}`
          : 'everyone is in it · the Experience API has not reported this visitor’s half yet',
        conditions: [],
      })
    }
  }
  const trace = p.trace ?? autoTrace
  const traceCount = trace.length
  const variantStepNo = traceCount > 0 ? 4 : 3

  // ---- "Why not the other version?" for the selected-variant card ------------
  type RawExp = { sys?: { id?: string }; fields?: { nt_experience_id?: string; nt_name?: string; nt_type?: string } }
  const rawListed = (defs.experienceEntries as RawExp[]).filter((e) => {
    const id = e.fields?.nt_experience_id ?? e.sys?.id ?? ''
    return !p.experienceFilter || p.experienceFilter({ id, name: e.fields?.nt_name, type: e.fields?.nt_type })
  })
  const ov = getOverrides()
  const overrideActive = Object.keys(ov.audiences).length > 0 || Object.keys(ov.selectedOptimizations).length > 0
  const alternatives = p.cfEntryId
    ? whyNotOthers({ shownEntryId: p.cfEntryId, experiences: rawListed, trace, overrideActive })
    : null
  const audienceName = (id: string) =>
    defs.audiences.find((a) => a.id === id || defs.audienceSysIdByAudienceId[a.id] === id)?.name ?? id
  const cfg = hudConfig()
  // "Advanced" (variant forcing) is closed unless the operator opened it
  const advancedOpen = collapsed.advanced === false
  const extraSignals = (p.timeOfDay ? 1 : 0) + (p.locale ? 1 : 0)

  return (
    <div ref={boxRef} style={{ ...s.panel, ...anchor }} data-p13n-hud>
      <style>{HUD_CSS}</style>
      {/* header = drag handle; the minimize button stays put */}
      <div
        style={s.headRow}
        onPointerDown={dragStart}
        onPointerMove={dragMove}
        onPointerUp={() => dragEnd()}
        title="Drag to move"
      >
        <div>
          <div style={s.title}>
            <span style={{ ...s.dot, background: p.p13nOn === false ? AMBER : GREEN }} />
            Contentful HUD
            {sdkUp && (
              <span style={s.liveChip} title="Contentful Optimization SDK mounted on this page — this HUD is its control surface">
                SDK LIVE
              </span>
            )}
          </div>
          <div style={s.sub}>Operator inspector · signals → audience → trace → variant → why · {p.surface}</div>
        </div>
        <IconButton label="Minimize the HUD (Esc)" icon={Icon.minimize} onClick={() => setOpen(false)} testId="minimize" />
      </div>

      <div style={s.body}>
        {/* 1 — signals the personalization layer received */}
        {stepHead(1, 'Signals received', <span style={s.countBadge}>{p.signals.length + extraSignals}</span>, 'signals')}
        {!collapsed.signals && (
          <div style={s.signalList}>
            {p.signals.map((sig, i) => (
              <div key={i} style={s.signalRow}>
                <span style={s.signalQ}>{sig.q}</span>
                <span style={{ ...s.chip, color: ACCENT, borderColor: `${ACCENT}66` }} title={sig.a}>
                  {sig.a}
                </span>
              </div>
            ))}
            {p.timeOfDay && (
              <div style={s.signalRow}>
                <span style={s.signalQ}>Time of day (context)</span>
                <span style={{ ...s.chip, color: ACCENT, borderColor: `${ACCENT}66` }}>{p.timeOfDay}</span>
              </div>
            )}
            {p.locale && (
              <div style={s.signalRow}>
                <span style={s.signalQ}>Locale</span>
                <span style={{ ...s.chip, color: ACCENT, borderColor: `${ACCENT}66` }}>{p.locale}</span>
              </div>
            )}
          </div>
        )}

        <Connector />

        {/* 2 — resolved audience */}
        {stepHead(
          2,
          'Audience',
          // header already wears the SDK LIVE chip — only warn when it's absent
          sdkUp ? undefined : (
            <span style={{ fontSize: 9.5, fontWeight: 800, color: AMBER }}>SDK not detected — local decisioning</span>
          ),
        )}
        <div style={s.block}>
          <div style={s.kv}>
            <code style={s.code}>{p.traitKey}</code>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>=</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: meta.color }}>
              {meta.emoji} {p.audience}
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
            {contentPersonas
              ? `personas: ${contentPersonas.length} demoPersona entries from the space`
              : 'personas: local fixtures (no space connection)'}
          </div>
        </div>

        {/* 3 — decision trace: THE MATH. deterministic rules, three-state outcomes */}
        {traceCount > 0 && (
          <>
            <Connector />
            {stepHead(
              3,
              'Decision trace',
              <span style={{ fontSize: 9.5, fontWeight: 800, color: GREEN }}>no AI at serve time</span>,
              'trace',
            )}
            {!collapsed.trace && (
              <div style={s.block}>
                <div style={s.traceLegend}>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {p.trace ? 'Deterministic rules, in order —' : 'Your audience rules from Contentful, tested live —'}
                  </span>{' '}
                  <span style={{ color: GREEN, whiteSpace: 'nowrap' }}>✓ matched</span>{' · '}
                  <span style={{ color: RED, whiteSpace: 'nowrap' }}>✗ not matched</span>{' · '}
                  <span style={{ color: AMBER, whiteSpace: 'nowrap' }}>∅ no data</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {trace.map((t, i) => {
                    const st = TRACE_STYLE[t.outcome]
                    return (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }} data-hud-trace={t.outcome}>
                        <span style={{ fontSize: 12, fontWeight: 900, color: st.color, width: 14, flexShrink: 0 }}>
                          {st.mark}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                            {t.rule}{' '}
                            <span style={{ fontSize: 9.5, fontWeight: 800, color: st.color, letterSpacing: '0.05em' }}>
                              {st.label}
                            </span>
                          </div>
                          {/* plain-English conditions with this visitor's live value */}
                          {!!t.conditions?.length && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '3px 0 2px' }}>
                              {t.conditions.map((c, j) => {
                                const cs = TRACE_STYLE[c.outcome]
                                const orBefore = j > 0 && c.group !== t.conditions![j - 1].group
                                return (
                                  <div key={j}>
                                    {orBefore && <div style={s.orSep}>or</div>}
                                    <div style={s.condRow} data-hud-condition={c.outcome}>
                                      <span style={{ color: 'rgba(255,255,255,0.82)' }}>{c.text}</span>
                                      <span style={{ color: 'rgba(255,255,255,0.4)' }}> → </span>
                                      <span style={{ color: c.unsupported ? AMBER : 'rgba(255,255,255,0.62)' }}>
                                        {c.unsupported ? c.observed : `this visitor: ${c.observed}`}
                                      </span>{' '}
                                      <span style={{ color: cs.color, fontWeight: 900 }} title={cs.label}>
                                        {cs.mark}
                                      </span>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'ui-monospace, monospace' }}>
                            {t.detail}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        <Connector />

        {/* 4 — selected variant + rationale + the Contentful provenance footer */}
        {stepHead(variantStepNo, 'Selected variant')}
        <div style={s.block}>
          <div style={s.kv}>
            <code style={s.code}>{p.selectedVariant}</code>
            <span style={{ marginLeft: 'auto' }}>
              <IconButton label="Highlight the personalized element on the page" icon={Icon.highlight} onClick={highlightPersonalized} tone="accent" testId="highlight" />
            </span>
          </div>
          <div style={s.why}>{p.decisionReason}</div>
          {/* why the other versions of this slot lost — one line each */}
          {!!alternatives?.length && (
            <div style={s.whyNot} data-hud-whynot>
              <div style={s.entryFootLabel}>Why not the other version?</div>
              {alternatives.map((a, i) => {
                const st = TRACE_STYLE[a.outcome]
                return (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 10.5, lineHeight: 1.45 }}>
                    <span style={{ color: st.color, fontWeight: 900, width: 11, flexShrink: 0 }} title={st.label}>
                      {st.mark}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{a.label}</span>
                      <span style={{ color: 'rgba(255,255,255,0.55)' }}> — {a.reason}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          {/* provenance: this pixel came from this entry */}
          {p.contentSource !== 'fixture' && p.cfEntryId && cfg.spaceId ? (
            <div style={s.entryFoot}>
              <div style={{ minWidth: 0 }}>
                <div style={s.entryFootLabel}>Contentful source entry</div>
                <code style={s.entryId} title={p.cfEntryId}>
                  {p.cfEntryId}
                </code>
              </div>
              <IconButton
                label="Open this entry in Contentful (new tab)"
                icon={Icon.external}
                href={`https://app.contentful.com/spaces/${cfg.spaceId}/environments/${cfg.environment}/entries/${p.cfEntryId}`}
                tone="accent"
                testId="open-entry"
              />
            </div>
          ) : (
            <div style={s.entryFoot}>
              <div style={s.entryFootHint}>
                {p.contentSource === 'fixture'
                  ? 'Served from local fixtures — flip Content source → Contentful below and this renders from a live entry.'
                  : 'No source entry id passed (cfEntryId) — provenance link unavailable.'}
              </div>
            </div>
          )}
        </div>

        <div style={s.divider} />

        {/* operator controls — each row appears only when the host wires it */}
        {stepHead(null, 'Operator controls', undefined, 'controls')}
        {!collapsed.controls && (
          <div style={s.ctrlBox}>
            {row(
              'Audience',
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {p.audienceOptions.map((o) => {
                  const m = personaOf(o.key)
                  const on = p.audience === o.key
                  return (
                    <button
                      key={o.key}
                      type="button"
                      className="p13n-hud-focus"
                      title={m.label}
                      aria-label={`Switch audience: ${m.label}`}
                      aria-pressed={on}
                      onClick={() => switchAudience(o.key)}
                      style={{
                        ...s.personaBtn,
                        borderColor: on ? m.color : 'rgba(255,255,255,0.16)',
                        background: on ? `${m.color}22` : 'rgba(255,255,255,0.04)',
                      }}
                    >
                      {m.emoji}
                    </button>
                  )
                })}
              </div>,
            )}
            {p.entryPoint !== undefined &&
              !!p.entryPointOptions?.length &&
              p.onSetEntryPoint &&
              row('Entry point', seg(p.entryPoint, p.entryPointOptions, p.onSetEntryPoint))}
            {p.onSetP13n &&
              row(
                'Personalization',
                seg(p.p13nOn === false ? 'off' : 'on', [{ v: 'on', label: 'On' }, { v: 'off', label: 'Off' }], (v) =>
                  p.onSetP13n?.(v === 'on'),
                ),
              )}
            {p.onSetPreview &&
              row(
                'Preview',
                seg(
                  p.preview ?? 'personalized',
                  [
                    { v: 'control', label: 'A · Control' },
                    { v: 'personalized', label: 'B · Personalized' },
                  ],
                  p.onSetPreview,
                ),
              )}
            {p.locale !== undefined &&
              !!p.localeOptions?.length &&
              p.onSetLocale &&
              row('Locale', seg(p.locale, p.localeOptions, p.onSetLocale))}
            {p.contentSource && p.onSetContentSource &&
              row(
                'Content source',
                seg(
                  p.contentSource,
                  [
                    { v: 'fixture', label: 'Fixtures' },
                    { v: 'contentful-personalization', label: 'Contentful' },
                  ],
                  p.onSetContentSource,
                ),
              )}
            {p.experienceState !== undefined &&
              !!p.experienceStateOptions?.length &&
              p.onSetExperienceState &&
              row('Experience state', seg(p.experienceState, p.experienceStateOptions, p.onSetExperienceState))}
            {row(
              'Actions',
              <div style={{ display: 'flex', gap: 6 }}>
                <IconButton label="Highlight the personalized element" icon={Icon.highlight} onClick={highlightPersonalized} testId="highlight-2" />
                <IconButton label="Reset to baseline (clear every override)" icon={Icon.reset} onClick={reset} testId="reset" />
                {sdkUp && (
                  <IconButton label="Reset profile — forget this visitor and fetch a fresh profile" icon={Icon.forget} onClick={resetProfile} testId="reset-profile" />
                )}
              </div>,
            )}
          </div>
        )}

        {/* Live SDK profile — only when the SDK is mounted */}
        {sdkUp && (
          <>
            {stepHead(
              null,
              'Live profile (SDK)',
              <span style={{ fontSize: 9.5, fontWeight: 800, color: GREEN }}>replaces the preview panel</span>,
              'sdk',
            )}
            {!collapsed.sdk && (
              <div style={s.ctrlBox}>
                <div style={s.ctrlRow}>
                  <span style={s.ctrlLabel}>Profile id</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <code style={s.entryId} title={profile?.id ?? 'loading profile…'}>
                      {profile ? `${profile.id.slice(0, 14)}…` : '…'}
                    </code>
                    <IconButton
                      label="Copy the profile id"
                      icon={Icon.copy}
                      onClick={() => profile && navigator.clipboard?.writeText(profile.id)}
                      testId="copy-profile"
                    />
                  </span>
                </div>
                <div style={s.ctrlRow}>
                  <span style={s.ctrlLabel}>Audiences</span>
                  <span style={s.sdkVal}>
                    {profile?.audiences?.length ? profile.audiences.map(audienceName).join(', ') : 'none matched yet'}
                  </span>
                </div>
                <div style={s.ctrlRow}>
                  <span style={s.ctrlLabel}>Traits</span>
                  <span style={s.sdkVal}>
                    {profile && profile.traits && Object.keys(profile.traits).length
                      ? Object.entries(profile.traits)
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join(' · ')
                      : 'none'}
                  </span>
                </div>
              </div>
            )}

            {/* Advanced: force one experience at a time. Closed by default —
                the Audience buttons above are the storytelling control; this
                is for QA ("show me variant 2 of that one A/B test"). */}
            {experiences.length > 0 && (
              <>
                <div
                  style={{ ...s.stepLabel, cursor: 'pointer' }}
                  onClick={() => setCollapsed((c) => ({ ...c, advanced: advancedOpen }))}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setCollapsed((c) => ({ ...c, advanced: advancedOpen })))}
                  role="button"
                  tabIndex={0}
                  aria-expanded={advancedOpen}
                  className="p13n-hud-focus"
                  title="Click to open / close"
                >
                  <span>Advanced · force a variant</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <span style={s.countBadge}>{experiences.length}</span>
                    <span style={s.chev}>{advancedOpen ? '▾' : '▸'}</span>
                  </span>
                </div>
                {advancedOpen && (
                  <div style={s.ctrlBox}>
                    {experiences.map((e) => {
                      const f = forcedVariantFor(e.id)
                      const variants = e.distribution.filter((d) => d.index > 0)
                      const pct = (idx: number) => {
                        const d = e.distribution.find((x) => x.index === idx)
                        return d?.percentage !== undefined ? ` · ${d.percentage}% of traffic` : ''
                      }
                      const chip = (label: string, idx: number | null, title: string) => (
                        <button
                          key={String(idx)}
                          type="button"
                          className="p13n-hud-focus"
                          onClick={() => forceVariant(e.id, idx)}
                          style={{ ...s.segBtn, ...(f === idx ? s.segOn : null), padding: '2px 7px', fontSize: 9.5, minHeight: 28 }}
                          title={title}
                          aria-label={`${title} — ${(e.name ?? e.id).replace(/^\[[^\]]+\]\s*/, '')}`}
                          aria-pressed={f === idx}
                        >
                          {label}
                        </button>
                      )
                      return (
                        <div key={e.id} style={s.ctrlRow}>
                          <span style={{ ...s.ctrlLabel, fontSize: 10, minWidth: 0, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${e.name ?? e.id} (${e.type === 'nt_experiment' ? 'A/B test' : 'personalization'})`}>
                            {e.type === 'nt_experiment' ? '⚖ ' : ''}
                            {(e.name ?? e.id).replace(/^\[P13n\]\s*/, '')}
                          </span>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            {chip('Auto', null, 'Let the SDK decide (clear the override)')}
                            {chip('Base', 0, `Force the baseline${pct(0)}`)}
                            {variants.map((v) =>
                              chip(`V${v.index}`, v.index, `Force ${v.name ?? `variant ${v.index}`}${pct(v.index)}`),
                            )}
                          </div>
                        </div>
                      )
                    })}
                    <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>
                      Writes the SDK preview override. The page repaints only where it renders through the SDK
                      (&lt;OptimizedEntry&gt;); host-decided content follows the Audience buttons instead.
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        <div style={s.foot}>Operator tool — all staged demo data should be labeled in your app.</div>
      </div>
    </div>
  )
}

function Connector() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, margin: '8px 0' }}>
      <span style={{ width: 2, height: 10, borderRadius: 2, background: ACCENT }} />
      <span style={{ fontSize: 8, lineHeight: 1, color: ACCENT }}>▼</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  pill: {
    position: 'fixed', bottom: 18, right: 18, zIndex: 9998, display: 'inline-flex', alignItems: 'center', gap: 9,
    padding: '10px 16px', borderRadius: 99, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(6,10,18,0.9)',
    backdropFilter: 'blur(12px)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'grab',
    boxShadow: '0 10px 34px rgba(0,0,0,0.4)', fontFamily: "'Inter', system-ui, sans-serif",
  },
  panel: {
    position: 'fixed', bottom: 18, right: 18, zIndex: 9998, width: 380, maxWidth: 'calc(100vw - 36px)',
    maxHeight: 'calc(100vh - 36px)', display: 'flex', flexDirection: 'column', borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(6,10,18,0.94)', backdropFilter: 'blur(16px)',
    boxShadow: '0 18px 50px rgba(0,0,0,0.5)', color: '#fff', fontFamily: "'Inter', system-ui, sans-serif",
    overflow: 'hidden',
  },
  headRow: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
    padding: '14px 16px 10px', cursor: 'grab', touchAction: 'none', userSelect: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
  },
  body: { overflowY: 'auto', padding: '0 16px 16px' },
  title: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800 },
  sub: { fontSize: 10.5, color: 'rgba(255,255,255,0.55)', marginTop: 3 },
  dot: { width: 9, height: 9, borderRadius: '50%', flexShrink: 0 },
  liveChip: {
    display: 'inline-flex', alignItems: 'center', padding: '1px 7px', borderRadius: 99,
    border: `1px solid ${GREEN}`, background: `${GREEN}1f`, color: GREEN, fontSize: 9.5, fontWeight: 800,
    letterSpacing: '0.07em',
  },
  stepLabel: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.55)', margin: '14px 0 8px',
    userSelect: 'none',
  },
  stepNo: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16,
    borderRadius: '50%', border: `1px solid ${ACCENT}88`, color: ACCENT, fontSize: 9.5, fontWeight: 800,
    flexShrink: 0,
  },
  countBadge: { color: 'rgba(255,255,255,0.4)', fontSize: 10 },
  chev: { color: 'rgba(255,255,255,0.4)', fontSize: 9 },
  signalList: { display: 'flex', flexDirection: 'column', gap: 5 },
  signalRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chip: {
    flexShrink: 0, padding: '2px 9px', borderRadius: 99, border: '1px solid',
    background: 'rgba(255,255,255,0.05)', fontSize: 10.5, fontWeight: 700, maxWidth: 230,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  signalQ: {
    fontSize: 10.5, color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  block: { padding: '10px 12px', borderRadius: 11, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' },
  kv: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  code: {
    fontFamily: 'ui-monospace, monospace', fontSize: 11.5, padding: '2px 7px', borderRadius: 6,
    background: 'rgba(255,255,255,0.1)', color: '#e2e8f0',
  },
  why: { marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.75)' },
  whyNot: {
    marginTop: 9, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)',
    display: 'flex', flexDirection: 'column', gap: 3,
  },
  condRow: { fontSize: 10.5, lineHeight: 1.45, overflowWrap: 'anywhere' },
  orSep: {
    fontSize: 8.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)', margin: '1px 0',
  },
  traceLegend: {
    fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, lineHeight: 1.4,
  },
  entryFoot: {
    marginTop: 10, paddingTop: 9, borderTop: '1px solid rgba(255,255,255,0.1)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
  },
  entryFootLabel: {
    fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
    color: 'rgba(255,255,255,0.45)', marginBottom: 3,
  },
  entryId: {
    fontFamily: 'ui-monospace, monospace', fontSize: 10.5, padding: '2px 6px', borderRadius: 6,
    background: 'rgba(255,255,255,0.08)', color: '#7FE9F1', overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', display: 'inline-block', maxWidth: 160, verticalAlign: 'bottom',
  },
  entryFootHint: { fontSize: 10, lineHeight: 1.5, color: 'rgba(255,255,255,0.45)' },
  divider: { marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.1)' },
  ctrlBox: {
    display: 'flex', flexDirection: 'column', gap: 10, padding: '12px', borderRadius: 11,
    border: '1px dashed rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.03)',
  },
  ctrlRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ctrlLabel: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', flexShrink: 0 },
  sdkVal: {
    fontSize: 10, color: 'rgba(255,255,255,0.7)', fontFamily: 'ui-monospace, monospace', textAlign: 'right',
    lineHeight: 1.5, wordBreak: 'break-word', minWidth: 0,
  },
  segWrap: { display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' },
  segBtn: {
    padding: '4px 9px', borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: 700,
    cursor: 'pointer',
  },
  segOn: { borderColor: ACCENT, background: `${ACCENT}22`, color: '#7FE9F1' },
  personaBtn: {
    width: 32, height: 32, borderRadius: 9, borderWidth: 1, borderStyle: 'solid', fontSize: 14, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  },
  foot: {
    marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: 10,
    lineHeight: 1.5, color: 'rgba(255,255,255,0.4)',
  },
}
