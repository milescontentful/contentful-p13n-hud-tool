// OperatorHud — the "how did the TV decide this" inspector.
// LG evolution of custom-demos' PersonalizationHud (HCA/ref-marketing): same
// dark-glass visual language, but prop-driven and SURFACE-GENERIC: the Gaming
// Portal passes tvProfile personas, ShopTime passes shopperArchetype options —
// the HUD doesn't care.
// The panel reads top-to-bottom as the causal chain:
//   1 signals → 2 audience → 3 decision trace → 4 selected variant (+ why)
// with a DECISION TRACE whose outcomes are three-state (matched / not matched /
// NO DATA) — an anonymous household is not a failed rule, and showing that
// honestly is the trust moment with the Korea team.
// This HUD is THE p13n control surface on screen: it replaces the Contentful
// Optimization preview panel entirely (the panel package is deliberately NOT
// attached), so it also carries the panel's powers when the SDK is live
// (profile id, per-experience variant forcing, profile reset). All of that is
// gated behind sdkAvailable() — the fixtures-only run never sees it.
// ALL SDK coupling stays in ../personalization/ntAdapter.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TimeOfDay, TvSignal } from './types'
import { ENTRY_META, type EntryPoint, type TraceStep } from './types'
import {
  sdkAvailable,
  activatePersona,
  resetAll,
  readProfile,
  subscribeProfile,
  forceVariant as sdkForceVariant,
  resetProfile as sdkResetProfile,
  type SdkProfile,
} from './ntAdapter'
import { getP13nDefinitions } from './optimization'
import { fetchPersonas, type ContentPersona } from './personas'

const ACCENT = '#00B8C4'
const AMBER = '#F59E0B'
const GREEN = '#4ADE80'
const RED = '#F87171'

export interface AudienceOption {
  key: string
  label: string
  emoji: string
  color: string
}

export interface HudProps {
  surface: string // 'gaming' | 'shop' — display only
  audience: string
  audienceOptions: AudienceOption[]
  traitKey: string // tvProfile | shopperArchetype
  selectedVariant: string
  decisionReason: string
  trace?: TraceStep[]
  signals: TvSignal[]
  locale: string
  timeOfDay: TimeOfDay
  contentSource: 'fixture' | 'contentful-personalization'
  experienceState: string
  p13nOn: boolean
  preview: 'personalized' | 'control'
  cfEntryId?: string
  // shop surface only: the entry-point signal is operator-driven from here
  entryPoint?: EntryPoint
  onSetEntryPoint?: (e: EntryPoint) => void
  onSwitchAudience: (key: string) => void
  onSetLocale: (l: string) => void
  onSetContentSource: (s: 'fixture' | 'contentful-personalization') => void
  onSetExperienceState: (s: string) => void
  onSetP13n: (on: boolean) => void
  onSetPreview: (p: 'personalized' | 'control') => void
  onReset: () => void
}

// ---- Optimization SDK surface -----------------------------------------------
// The adapter (ntAdapter.ts) owns ALL SDK access now — profile reads, variant
// forcing, and profile reset included — so the HUD has zero window-global
// coupling of its own. Experience definitions come from the SDK's own
// nt_experience mappers via getP13nDefinitions().

// ---- HUD state persistence (survive reloads mid-demo) -----------------------
const HUD_STORE_KEY = 'lg-operator-hud'
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
  // aud-<key> is apply-p13n's deterministic nt_audience_id convention;
  // content personas may carry an explicit override
  const allAudienceIds = p.audienceOptions.map(
    (o) => contentPersonas?.find((x) => x.key === o.key)?.audienceNtId ?? `aud-${o.key}`,
  )

  // ---- live SDK state (preview-panel parity, gated on sdkUp) ----------------
  const [profile, setProfile] = useState<SdkProfile | null>(null)
  // per-experience forced variant: undefined/null = auto (SDK decides)
  const [forced, setForced] = useState<Record<string, number | null>>({})
  useEffect(() => {
    if (!open || !sdkUp) return
    setProfile(readProfile())
    // live subscription to the SDK's profile observable — no polling needed
    const unsub = subscribeProfile(setProfile)
    return () => unsub?.()
  }, [open, sdkUp])

  function forceVariant(expId: string, idx: number | null) {
    // writes the SDK's real selected-optimizations override (the same engine
    // the first-party preview panel drives)
    if (!sdkForceVariant(expId, idx)) return
    setForced((f) => ({ ...f, [expId]: idx }))
  }

  async function resetProfile() {
    // clears overrides, forgets the anonymous id, fires a page event so a
    // FRESH profile is fetched (SPA lesson) — all inside the adapter
    if (!(await sdkResetProfile())) return
    setForced({})
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
    const cp = contentPersonas?.find((x) => x.key === key)
    activatePersona({
      audienceNtId: cp?.audienceNtId ?? `aud-${key}`,
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
        <button key={o.v} onClick={() => onPick(o.v)} style={{ ...s.segBtn, ...(value === o.v ? s.segOn : null) }}>
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

  const traceCount = p.trace?.length ?? 0
  const variantStepNo = traceCount > 0 ? 4 : 3
  // experience graph mapped by the SDK's own nt_experience mappers
  const experiences = sdkUp ? getP13nDefinitions().experiences : []

  return (
    <div ref={boxRef} style={{ ...s.panel, ...anchor }}>
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
            <span style={{ ...s.dot, background: p.p13nOn ? GREEN : AMBER }} />
            Contentful HUD
            {sdkUp && (
              <span style={s.liveChip} title="Contentful Optimization SDK mounted on this page — this HUD is its control surface">
                SDK LIVE
              </span>
            )}
          </div>
          <div style={s.sub}>Operator inspector · signals → audience → trace → variant → why · {p.surface}</div>
        </div>
        <button style={s.iconBtn} title="Collapse (Esc)" onClick={() => setOpen(false)}>
          –
        </button>
      </div>

      <div style={s.body}>
        {/* 1 — signals the logged-in TV holds */}
        {stepHead(1, 'Signals received', <span style={s.countBadge}>{p.signals.length + 2}</span>, 'signals')}
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
            <div style={s.signalRow}>
              <span style={s.signalQ}>Time of day (context)</span>
              <span style={{ ...s.chip, color: ACCENT, borderColor: `${ACCENT}66` }}>{p.timeOfDay}</span>
            </div>
            <div style={s.signalRow}>
              <span style={s.signalQ}>Locale</span>
              <span style={{ ...s.chip, color: ACCENT, borderColor: `${ACCENT}66` }}>{p.locale}</span>
            </div>
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
        {traceCount > 0 && p.trace && (
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
                  <span style={{ whiteSpace: 'nowrap' }}>Deterministic rules, in order —</span>{' '}
                  <span style={{ color: GREEN, whiteSpace: 'nowrap' }}>✓ matched</span>{' · '}
                  <span style={{ color: RED, whiteSpace: 'nowrap' }}>✗ not matched</span>{' · '}
                  <span style={{ color: AMBER, whiteSpace: 'nowrap' }}>∅ no data</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {p.trace.map((t, i) => {
                    const st = TRACE_STYLE[t.outcome]
                    return (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 12, fontWeight: 900, color: st.color, width: 14, flexShrink: 0 }}>
                          {st.mark}
                        </span>
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                            {t.rule}{' '}
                            <span style={{ fontSize: 9.5, fontWeight: 800, color: st.color, letterSpacing: '0.05em' }}>
                              {st.label}
                            </span>
                          </div>
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
            <button style={s.showBtn} onClick={highlightPersonalized}>
              Highlight
            </button>
          </div>
          <div style={s.why}>{p.decisionReason}</div>
          {/* provenance: this pixel came from this entry */}
          {p.contentSource === 'contentful-personalization' && p.cfEntryId ? (
            <div style={s.entryFoot}>
              <div style={{ minWidth: 0 }}>
                <div style={s.entryFootLabel}>Contentful source entry</div>
                <code style={s.entryId} title={p.cfEntryId}>
                  {p.cfEntryId}
                </code>
              </div>
              <a
                href={`https://app.contentful.com/spaces/${import.meta.env.VITE_CONTENTFUL_SPACE_ID}/environments/${import.meta.env.VITE_CONTENTFUL_ENVIRONMENT_ID ?? 'master'}/entries/${p.cfEntryId}`}
                target="_blank"
                rel="noreferrer"
                style={s.cfBtn}
              >
                Open in Contentful ↗
              </a>
            </div>
          ) : (
            <div style={s.entryFoot}>
              <div style={s.entryFootHint}>
                Served from local fixtures — flip <b>Content source → Contentful</b> below and this hero renders from a
                live entry.
              </div>
            </div>
          )}
        </div>

        <div style={s.divider} />

        {/* operator controls — every one changes the TV surface visibly */}
        {stepHead(null, 'Operator controls', undefined, 'controls')}
        {!collapsed.controls && (
          <div style={s.ctrlBox}>
            {row(
              'Audience',
              <div style={{ display: 'flex', gap: 5 }}>
                {p.audienceOptions.map((o) => {
                  const m = personaOf(o.key)
                  const on = p.audience === o.key
                  return (
                    <button
                      key={o.key}
                      title={m.label}
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
            {p.entryPoint &&
              p.onSetEntryPoint &&
              row(
                'Entry point',
                seg(
                  p.entryPoint,
                  (Object.keys(ENTRY_META) as EntryPoint[]).map((e) => ({
                    v: e,
                    label: `${ENTRY_META[e].emoji} ${ENTRY_META[e].label.split(' ')[0]}`,
                  })),
                  p.onSetEntryPoint,
                ),
              )}
            {row(
              'Personalization',
              seg(p.p13nOn ? 'on' : 'off', [{ v: 'on', label: 'On' }, { v: 'off', label: 'Off' }], (v) => p.onSetP13n(v === 'on')),
            )}
            {row(
              'Preview',
              seg(
                p.preview,
                [
                  { v: 'control', label: 'A · Control' },
                  { v: 'personalized', label: 'B · Personalized' },
                ],
                p.onSetPreview,
              ),
            )}
            {row(
              'Locale',
              seg(
                p.locale,
                [
                  { v: 'en-US', label: 'en-US' },
                  { v: 'ko-KR', label: 'ko-KR' },
                  { v: 'de-DE', label: 'de-DE' },
                ],
                p.onSetLocale,
              ),
            )}
            {row(
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
            {row(
              'Experience state',
              seg(
                p.experienceState,
                [
                  { v: 'gaming', label: 'Gaming' },
                  { v: 'commerce', label: 'ShopTime' },
                  { v: 'home', label: 'Home' },
                ],
                p.onSetExperienceState,
              ),
            )}
            <button style={s.resetBtn} onClick={reset}>
              ⟲ Reset to baseline
            </button>
          </div>
        )}

        {/* Optimization SDK — preview-panel parity, only when the SDK is mounted */}
        {sdkUp && (
          <>
            {stepHead(
              null,
              'Optimization SDK',
              <span style={{ fontSize: 9.5, fontWeight: 800, color: GREEN }}>replaces the preview panel</span>,
              'sdk',
            )}
            {!collapsed.sdk && (
              <div style={s.ctrlBox}>
                <div style={s.ctrlRow}>
                  <span style={s.ctrlLabel}>Profile id</span>
                  <code
                    style={{ ...s.entryId, cursor: 'copy' }}
                    title={profile ? `${profile.id} — click to copy` : 'loading profile…'}
                    onClick={() => profile && navigator.clipboard?.writeText(profile.id)}
                  >
                    {profile ? `${profile.id.slice(0, 14)}…` : '…'}
                  </code>
                </div>
                <div style={s.ctrlRow}>
                  <span style={s.ctrlLabel}>Audiences</span>
                  <span style={s.sdkVal}>
                    {profile?.audiences?.length ? profile.audiences.join(', ') : 'none matched yet'}
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
                {experiences.length > 0 && (
                  <div>
                    <div style={{ ...s.entryFootLabel, marginBottom: 6 }}>
                      Force experience variants ({experiences.length} mapped)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {experiences.map((e) => {
                        // distribution includes index 0 (baseline); chips beyond it
                        const nVariants = e.distribution.filter((d) => d.index > 0).length
                        const f = forced[e.id] ?? null
                        const chip = (label: string, idx: number | null) => (
                          <button
                            key={String(idx)}
                            onClick={() => forceVariant(e.id, idx)}
                            style={{ ...s.segBtn, ...(f === idx ? s.segOn : null), padding: '2px 7px', fontSize: 9.5 }}
                            title={
                              idx === null
                                ? 'Let the SDK decide (reset override)'
                                : idx === 0
                                  ? 'Force the baseline'
                                  : `Force variant ${idx}`
                            }
                          >
                            {label}
                          </button>
                        )
                        return (
                          <div key={e.id} style={s.ctrlRow}>
                            <span style={{ ...s.ctrlLabel, fontSize: 10 }} title={e.id}>
                              {(e.name ?? e.id).replace(/^\[P13n\]\s*/, '')}
                            </span>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {chip('Auto', null)}
                              {chip('Base', 0)}
                              {Array.from({ length: nVariants }, (_, i) => chip(`V${i + 1}`, i + 1))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 9.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>
                      Writes the SDK preview override — page pixels follow the Audience control above.
                    </div>
                  </div>
                )}
                <button style={s.resetBtn} onClick={resetProfile} title="Clear overrides, forget this profile, fetch a fresh one">
                  ⟲ Reset profile (forget me)
                </button>
              </div>
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
  iconBtn: {
    width: 24, height: 24, borderRadius: 7, border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13,
    flexShrink: 0,
  },
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
  traceLegend: {
    fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: 8, lineHeight: 1.4,
  },
  showBtn: {
    marginLeft: 'auto', padding: '4px 10px', borderRadius: 8, border: `1px solid ${ACCENT}`,
    background: `${ACCENT}22`, color: '#7FE9F1', fontSize: 11, fontWeight: 700, cursor: 'pointer',
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
  cfBtn: {
    flexShrink: 0, padding: '5px 10px', borderRadius: 8, border: `1px solid ${ACCENT}`,
    background: `${ACCENT}22`, color: '#7FE9F1', fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
    textDecoration: 'none', whiteSpace: 'nowrap',
  },
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
  resetBtn: {
    marginTop: 2, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)', fontSize: 11.5, fontWeight: 700,
    cursor: 'pointer',
  },
  foot: {
    marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: 10,
    lineHeight: 1.5, color: 'rgba(255,255,255,0.4)',
  },
}
