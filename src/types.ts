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
export interface TraceStep {
  rule: string
  outcome: 'matched' | 'not-matched' | 'no-data'
  detail: string
}

// One option in a segmented control row (locale, entry point, experience state…)
export interface SegOption<T extends string = string> {
  v: T
  label: string
}
