// Shared types for the OperatorHud. In a consuming app these usually live in
// your domain layer — they're gathered here so the tool is self-contained.

// A signal the personalization layer received — phrased as observation → value
// (e.g. { q: 'Visited pricing page', a: '3 times' }). Ideally distilled traits:
// raw history stays in your warehouse, only the distillate crosses over.
export interface HudSignal {
  q: string // the signal name, phrased as what was observed
  a: string // the observed value
}
/** @deprecated old name, kept for existing consumers */
export type TvSignal = HudSignal

// One evaluated rule in the deterministic decision trace. Three states, never
// two: an absent signal (no-data) is not the same as a rule that failed.
export type TraceOutcome = 'matched' | 'not-matched' | 'no-data'

// One condition inside an audience rule, in plain English with the live value:
// "Campaign name equals "climb"" → this visitor: "family" → not matched.
export interface TraceCondition {
  text: string
  observed: string
  outcome: TraceOutcome
  /** which `any` group (OR) the condition sits in — conditions in one group are ANDed */
  group?: number
  /** true when this page can't evaluate the rule type/key/operator (shown, never guessed) */
  unsupported?: boolean
}

export interface TraceStep {
  rule: string
  outcome: TraceOutcome
  detail: string
  /** per-condition rows (the built-in evaluator fills these) */
  conditions?: TraceCondition[]
  /** nt_audience_id this step evaluated, when it is an audience */
  audienceId?: string
  /** that audience entry's sys id (experiences link audiences by sys id) */
  audienceSysId?: string
}

// One option in a segmented control row (locale, entry point, experience state…)
export interface SegOption<T extends string = string> {
  v: T
  label: string
}
