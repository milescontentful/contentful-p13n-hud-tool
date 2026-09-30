// whyNot.ts — "Why not the other version?" for the selected-variant card.
//
// Given the entry on screen, find every version that could have filled the
// same slot (the baseline + each experience's variant that replaces it), and
// give each one that LOST a one-line reason: which rule condition failed or had
// no data (from the evaluator's trace), or the traffic split, or an operator
// override. Pure — reads raw nt_experience entries, no SDK, no DOM.
import type { TraceOutcome, TraceStep } from './types'
import { deciding } from './evaluate'

type RawEntry = { sys?: { id?: string }; fields?: Record<string, unknown> }
type RawComponent = { baseline?: { id?: string }; variants?: { id?: string }[] }
type RawExperience = RawEntry & {
  fields?: {
    nt_name?: string
    nt_type?: string
    nt_experience_id?: string
    nt_audience?: { sys?: { id?: string }; fields?: { nt_audience_id?: string } }
    nt_config?: { components?: RawComponent[]; distribution?: number[] }
    nt_variants?: RawEntry[]
  }
}

export interface Alternative {
  label: string
  outcome: TraceOutcome
  reason: string
}

const NAME_FIELDS = ['internalName', 'internal_name', 'title', 'name', 'heading', 'headline']

/** Best human label for a resolved entry, else its id. */
function entryLabel(e: RawEntry | undefined, id: string): string {
  for (const k of NAME_FIELDS) {
    const v = e?.fields?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return id
}
const expName = (e: RawExperience) => String(e.fields?.nt_name ?? e.fields?.nt_experience_id ?? e.sys?.id ?? '').replace(/^\[[^\]]+\]\s*/, '')
const pct = (e: RawExperience, index: number) => {
  const d = e.fields?.nt_config?.distribution?.[index]
  return typeof d === 'number' ? ` (${Math.round(d * 100)}% of traffic)` : ''
}

export function whyNotOthers(opts: {
  shownEntryId: string
  experiences: unknown[]
  trace: TraceStep[]
  /** is any operator override (audience or variant) in effect? */
  overrideActive: boolean
}): Alternative[] | null {
  const exps = opts.experiences as RawExperience[]
  // 1. the slot: the baseline the shown entry belongs to
  let baseline: string | undefined
  for (const e of exps)
    for (const c of e.fields?.nt_config?.components ?? [])
      if (c.baseline?.id === opts.shownEntryId || c.variants?.some((v) => v.id === opts.shownEntryId)) baseline ??= c.baseline?.id
  if (!baseline) return null

  // 2. every candidate for that slot
  type Cand = { entryId: string; label: string; exp: RawExperience | null; index: number }
  const cands: Cand[] = [{ entryId: baseline, label: 'Baseline', exp: null, index: 0 }]
  for (const e of exps)
    for (const c of e.fields?.nt_config?.components ?? []) {
      if (c.baseline?.id !== baseline) continue
      ;(c.variants ?? []).forEach((v, i) => {
        if (!v.id) return
        const resolved = e.fields?.nt_variants?.find((x) => x.sys?.id === v.id)
        cands.push({ entryId: v.id, label: entryLabel(resolved, v.id), exp: e, index: i + 1 })
      })
    }
  const shown = cands.find((c) => c.entryId === opts.shownEntryId)
  const shownLabel = shown?.label ?? opts.shownEntryId
  const stepFor = (e: RawExperience) => {
    const ids = [e.fields?.nt_audience?.sys?.id, e.fields?.nt_audience?.fields?.nt_audience_id].filter((x): x is string => !!x)
    return opts.trace.find((t) => t.audienceId && (ids.includes(t.audienceId) || (!!t.audienceSysId && ids.includes(t.audienceSysId))))
  }
  const override = opts.overrideActive ? ' · an operator override is also in effect' : ''

  // 3. a one-line reason for each loser
  return cands
    .filter((c) => c.entryId !== opts.shownEntryId)
    .map((c): Alternative => {
      if (!c.exp) {
        // the baseline lost: some experience took the slot
        const winner = shown?.exp
        if (!winner) return { label: c.label, outcome: 'not-matched', reason: `another version is on screen${override}` }
        const w = stepFor(winner)
        if (!winner.fields?.nt_audience)
          return { label: c.label, outcome: 'not-matched', reason: `traffic split put this visitor in "${shownLabel}"${pct(winner, shown!.index)}${override}` }
        // only claim "the rule matched" when the trace says so — otherwise the
        // winner is on screen for another reason (an operator override)
        if (w?.outcome === 'matched')
          return { label: c.label, outcome: 'not-matched', reason: `${w.rule} matched, so "${expName(winner)}" replaced it${override}` }
        return {
          label: c.label,
          outcome: 'not-matched',
          reason: opts.overrideActive
            ? `an operator override put "${expName(winner)}" here — its own rule reads ${w ? (w.outcome === 'no-data' ? 'NO DATA' : 'not matched') : 'unevaluated'} for this visitor`
            : `the Experience API served "${expName(winner)}" — this page's own signals don't show why (earlier visits?)`,
        }
      }
      const e = c.exp
      if (!e.fields?.nt_audience) {
        return { label: c.label, outcome: 'not-matched', reason: `traffic split — this visitor got "${shownLabel}"${shown?.exp === e ? pct(e, shown.index) : ''}${override}` }
      }
      const step = stepFor(e)
      if (!step) return { label: c.label, outcome: 'no-data', reason: `its audience isn't in the trace — not evaluated here${override}` }
      if (step.outcome === 'matched')
        return {
          label: c.label,
          outcome: 'matched',
          reason: `${step.rule} matched, but "${shownLabel}" holds the slot${shown?.exp ? '' : ' — the Experience API has not served it (yet)'}${override}`,
        }
      const d = deciding(step)
      return {
        label: c.label,
        outcome: step.outcome,
        reason: d ? `${d.text} → this visitor: ${d.observed}${override}` : `${step.rule}: ${step.detail}${override}`,
      }
    })
}
