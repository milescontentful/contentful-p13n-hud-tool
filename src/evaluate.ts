// evaluate.ts — the built-in rule evaluator behind the decision trace.
//
// Give it the REAL audience rules (the `nt_rules` field of each nt_audience
// entry, as loadP13nDefinitions() fetches them) plus what this page actually
// knows about the visitor (pages viewed, events, traits), and it answers, per
// audience and per condition:
//
//   ✓ matched · ✗ not matched · ∅ NO DATA
//
// Three states, never two: "we have no campaign on this visit" is a different
// fact from "the campaign is family, the rule wants climb". And a rule type
// this page cannot see (location, device, …) says so — "can't evaluate here" —
// instead of guessing.
//
// This is a local mirror of the platform's logic, for EXPLAINING a decision.
// The Experience API still makes the real decision server-side; the HUD shows
// its confirmation next to our math.
//
// Pure module: no React, no SDK, no DOM — so it runs under plain `node` for
// the selftest (test/evaluate.selftest.ts).
import type { TraceCondition, TraceOutcome, TraceStep } from './types'

// ---- what the page knows ----------------------------------------------------

/** One page view this page knows about. */
export interface PageFact {
  /** full URL of the page */
  url?: string
  /** UTM values seen on that page view: name/source/medium/term/content */
  campaign?: Partial<Record<'name' | 'source' | 'medium' | 'term' | 'content', string>>
  referrer?: string
}

/** One tracked event this page knows about (e.g. sdk.track({ event })). */
export interface EventFact {
  name: string
}

/**
 * Everything the evaluator may test. `undefined` means NOT MEASURED (the rule
 * reads ∅ NO DATA), which is different from an empty list.
 */
export interface VisitorFacts {
  pages?: PageFact[]
  events?: EventFact[]
  traits?: Record<string, unknown>
  /** nt_audience ids (or entry sys ids) the Experience API says this visitor joined */
  confirmedAudiences?: string[]
}

/** One audience, ready to evaluate. */
export interface AudienceRules {
  /** nt_audience_id */
  id: string
  /** entry sys id (experiences link audiences by sys id) */
  sysId?: string
  name: string
  rules: unknown
}

// ---- raw rule shapes (as the Personalization app writes them) --------------
type RawKey = { id?: string; key?: string; label?: string }
type RawCondition = { key?: RawKey | string; operator?: string; value?: unknown }
type RawRule = {
  type?: string
  count?: unknown
  key?: unknown
  operator?: string
  value?: unknown
  conditions?: RawCondition[]
}
type RawRules = { any?: { all?: RawRule[] }[] }

/** Read nt_audience entries (Preview/Delivery shape, or CMA's per-locale shape). */
export function audiencesFromEntries(entries: unknown[]): AudienceRules[] {
  const unwrap = (v: unknown): unknown => {
    // CMA returns { 'en-US': value }; the Delivery/Preview API returns value
    if (v && typeof v === 'object' && !Array.isArray(v) && !('any' in v) && !('sys' in v)) {
      const vals = Object.values(v as Record<string, unknown>)
      if (vals.length === 1) return vals[0]
    }
    return v
  }
  const out: AudienceRules[] = []
  for (const e of entries as { sys?: { id?: string }; sysId?: string; fields?: Record<string, unknown> }[]) {
    const f = e?.fields ?? {}
    const id = unwrap(f.nt_audience_id) as string | undefined
    if (!id) continue
    out.push({
      id,
      sysId: e.sys?.id ?? e.sysId,
      name: (unwrap(f.nt_name) as string | undefined) ?? id,
      rules: unwrap(f.nt_rules),
    })
  }
  return out
}

// ---- words ------------------------------------------------------------------
const KEY_LABEL: Record<string, string> = {
  context_page_url: 'Page URL',
  context_page_referrer: 'Referrer',
  context_campaign_name: 'Campaign name',
  context_campaign_source: 'Campaign source',
  context_campaign_medium: 'Campaign medium',
  context_campaign_term: 'Campaign term',
  context_campaign_content: 'Campaign content',
}
const OP_WORD: Record<string, string> = {
  equal: 'equals',
  notEqual: 'does not equal',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
}
const COUNT_SYM: Record<string, string> = {
  greaterThanInclusive: '≥',
  greaterThan: '>',
  lessThanInclusive: '≤',
  lessThan: '<',
  equal: '=',
}
const times = (n: number) => `${n} time${n === 1 ? '' : 's'}`

function countCmp(op: string | undefined, n: number, want: number): boolean | null {
  switch (op) {
    case 'greaterThanInclusive':
      return n >= want
    case 'greaterThan':
      return n > want
    case 'lessThanInclusive':
      return n <= want
    case 'lessThan':
      return n < want
    case 'equal':
      return n === want
    default:
      return null
  }
}

/** Compare a known string; `*` on equal = "anything present". null = unsupported operator. */
function strCmp(op: string | undefined, actual: string, want: string): boolean | null {
  const a = actual.toLowerCase()
  const w = want.toLowerCase()
  switch (op) {
    case 'equal':
      return w === '*' ? a.length > 0 : a === w
    case 'notEqual':
      return a !== w
    case 'contains':
      return a.includes(w)
    case 'notContains':
      return !a.includes(w)
    case 'startsWith':
      return a.startsWith(w)
    case 'endsWith':
      return a.endsWith(w)
    default:
      return null
  }
}

/** Which page field a condition key reads. null = a key this page can't see. */
function pageField(keyId: string): ((p: PageFact) => string | undefined) | null {
  if (keyId === 'context_page_url') return (p) => p.url
  if (keyId === 'context_page_referrer') return (p) => p.referrer
  const m = /^context_campaign_(name|source|medium|term|content)$/.exec(keyId)
  if (m) return (p) => p.campaign?.[m[1] as 'name']
  return null
}

const keyIdOf = (k: RawCondition['key']): string => (typeof k === 'string' ? k : (k?.id ?? k?.key ?? ''))
const keyLabelOf = (k: RawCondition['key']): string => {
  const id = keyIdOf(k)
  return KEY_LABEL[id] ?? (typeof k === 'object' && k?.label) ?? id
}

function cannot(text: string, why: string): TraceCondition {
  return { text, observed: `can't evaluate here (${why})`, outcome: 'no-data', unsupported: true }
}

// ---- one rule → one plain-English condition row ------------------------------

function evalPage(r: RawRule, f: VisitorFacts): TraceCondition {
  const want = Number(r.count)
  const sym = COUNT_SYM[r.operator ?? '']
  const conds = r.conditions ?? []
  const condWords = conds.map((c) => {
    const v = String(c.value ?? '')
    return c.operator === 'equal' && v === '*' ? `any ${keyLabelOf(c.key)}` : `${keyLabelOf(c.key)} ${OP_WORD[c.operator ?? ''] ?? c.operator} "${v}"`
  })
  const allWildcard = conds.length > 0 && conds.every((c) => c.operator === 'equal' && c.value === '*')
  const simple = r.operator === 'greaterThanInclusive' && want === 1 && conds.length > 0 && !allWildcard
  const text = simple
    ? condWords.join(' and ')
    : `Viewed ${allWildcard || !conds.length ? 'any page' : `a page where ${condWords.join(' and ')}`} ${sym ?? r.operator} ${times(want)}`

  if (typeof r.count !== 'string') return cannot(text, 'count stored as a number — the platform ignores this rule')
  if (!sym || Number.isNaN(want)) return cannot(text, `count operator "${r.operator}"`)
  const readers = conds.map((c) => pageField(keyIdOf(c.key)))
  const badKey = conds.findIndex((_, i) => !readers[i])
  if (badKey >= 0) return cannot(text, `condition on "${keyLabelOf(conds[badKey].key)}"`)
  if (conds.some((c) => !OP_WORD[c.operator ?? ''])) return cannot(text, `operator "${conds.find((c) => !OP_WORD[c.operator ?? ''])?.operator}"`)

  if (!f.pages) return { text, observed: 'page views not measured', outcome: 'no-data' }

  // per page: true (all conditions hold) · false (one fails) · null (a value is missing)
  let hit = 0
  let unknown = 0
  for (const p of f.pages) {
    let state: boolean | null = true
    for (let i = 0; i < conds.length; i++) {
      const actual = readers[i]!(p)
      if (actual === undefined || actual === '') {
        if (state) state = null // MISSING is not a failure
        continue
      }
      if (!strCmp(conds[i].operator, actual, String(conds[i].value ?? ''))) {
        state = false
        break
      }
    }
    if (state === true) hit++
    else if (state === null) unknown++
  }

  // outcome over the range of possible counts [hit, hit + unknown]
  let anyTrue = false
  let anyFalse = false
  for (let n = hit; n <= hit + unknown; n++) {
    if (countCmp(r.operator, n, want)) anyTrue = true
    else anyFalse = true
  }
  const outcome: TraceOutcome = anyTrue && !anyFalse ? 'matched' : anyFalse && !anyTrue ? 'not-matched' : 'no-data'

  // what to show as "this visitor: …"
  let observed: string
  const single = conds.length === 1 && !allWildcard && keyIdOf(conds[0].key).startsWith('context_campaign_') ? readers[0]! : null
  if (simple && single) {
    const seen = [...new Set(f.pages.map(single).filter((v): v is string => !!v))]
    observed = seen.length ? seen.join(', ') : `no ${keyLabelOf(conds[0].key).toLowerCase()} on ${f.pages.length === 1 ? 'this visit' : 'these visits'}`
  } else {
    observed = `${hit}${unknown ? ` (+${unknown} unclear)` : ''}`
    if (simple) observed = `${hit} of ${f.pages.length} page view${f.pages.length === 1 ? '' : 's'}${unknown ? ` (+${unknown} unclear)` : ''}`
  }
  return { text, observed, outcome }
}

function evalTrack(r: RawRule, f: VisitorFacts): TraceCondition {
  const want = Number(r.count)
  const sym = COUNT_SYM[r.operator ?? '']
  const name = String(r.value ?? '')
  const text = `${name === '*' || !name ? 'Any event' : `Event ${name}`} ${sym ?? r.operator} ${want}`
  if (typeof r.count !== 'string') return cannot(text, 'count stored as a number — the platform ignores this rule')
  if (!sym || Number.isNaN(want)) return cannot(text, `count operator "${r.operator}"`)
  if (r.conditions?.length) return cannot(text, 'event property conditions')
  if (!f.events?.length) return { text, observed: 'no events yet', outcome: 'no-data' }
  const n = f.events.filter((e) => name === '*' || e.name === name).length
  return { text, observed: `${n}`, outcome: countCmp(r.operator, n, want) ? 'matched' : 'not-matched' }
}

function evalTrait(r: RawRule, f: VisitorFacts): TraceCondition {
  const key = String(r.key ?? '')
  const want = String(r.value ?? '')
  const word = OP_WORD[r.operator ?? '']
  const text = `Trait ${key} ${word ?? r.operator} "${want}"`
  if (!key) return cannot(text, 'trait rule without a trait name')
  if (!word) return cannot(text, `operator "${r.operator}"`)
  if (!f.traits) return { text, observed: 'traits not measured', outcome: 'no-data' }
  const v = f.traits[key]
  if (v === undefined || v === null || v === '') return { text, observed: 'not set', outcome: 'no-data' }
  const ok = strCmp(r.operator, String(v), want)
  return { text, observed: String(v), outcome: ok ? 'matched' : 'not-matched' }
}

/** One raw rule (an item of `all`) → one condition row. */
export function evaluateRule(r: RawRule, f: VisitorFacts): TraceCondition {
  switch (r?.type) {
    case 'page':
      return evalPage(r, f)
    case 'track':
      return evalTrack(r, f)
    case 'identify':
      return evalTrait(r, f)
    default:
      return cannot(`${r?.type ?? 'unknown'} rule`, `rule type ${r?.type ?? 'unknown'}`)
  }
}

// ---- three-valued AND / OR ---------------------------------------------------
function and(xs: TraceOutcome[]): TraceOutcome {
  if (xs.includes('not-matched')) return 'not-matched'
  if (xs.includes('no-data')) return 'no-data'
  return 'matched'
}
function or(xs: TraceOutcome[]): TraceOutcome {
  if (xs.includes('matched')) return 'matched'
  if (xs.includes('no-data')) return 'no-data'
  return 'not-matched'
}

/** Evaluate one audience's rules → one trace step with per-condition rows. */
export function evaluateAudience(a: AudienceRules, f: VisitorFacts): TraceStep {
  const rules = a.rules as RawRules | undefined
  const groups = rules?.any ?? []
  const confirmed = !!f.confirmedAudiences?.some((x) => x === a.id || (a.sysId && x === a.sysId))
  const api = confirmed ? ' · Experience API: joined' : ''
  if (!groups.length)
    return { rule: a.name, audienceId: a.id, audienceSysId: a.sysId, outcome: 'no-data', detail: `no rules on this audience — nothing to evaluate${api}`, conditions: [] }

  const conditions: TraceCondition[] = []
  const groupOutcomes = groups.map((g, gi) => {
    const rows = (g.all ?? []).map((r) => ({ ...evaluateRule(r, f), group: gi }))
    conditions.push(...rows)
    return and(rows.map((r) => r.outcome))
  })
  const outcome = or(groupOutcomes)
  const unsupported = conditions.filter((c) => c.unsupported).length
  let detail =
    outcome === 'matched'
      ? 'this visitor fits the rule'
      : outcome === 'not-matched'
        ? 'this visitor does not fit the rule'
        : unsupported
          ? 'depends on something this page cannot see'
          : 'not enough data yet to decide'
  if (confirmed && outcome !== 'matched') detail += ' — but the server saw signals this page can’t (earlier visits) or an operator override is on'
  return { rule: a.name, audienceId: a.id, audienceSysId: a.sysId, outcome, detail: detail + api, conditions }
}

export function evaluateAudiences(list: AudienceRules[], f: VisitorFacts): TraceStep[] {
  return list.map((a) => evaluateAudience(a, f))
}

/** The first condition that explains a non-match (for "why not" lines). */
export function deciding(step: TraceStep): TraceCondition | undefined {
  const want: TraceOutcome = step.outcome === 'no-data' ? 'no-data' : 'not-matched'
  return step.conditions?.find((c) => c.outcome === want)
}
