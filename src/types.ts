// Shared types for the OperatorHud. In a consuming app these usually live in
// your domain layer — they're gathered here so the tool is self-contained.

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'late-night'

// A signal the personalization layer received — phrased as observation → value.
// In the source demo these are distilled TRAITS (the warehouse keeps raw
// history; only the distillate crosses to the p13n layer).
export interface TvSignal {
  q: string // the signal name, phrased as what was observed
  a: string // the observed value
}

// One evaluated rule in the deterministic decision trace. Three states, never
// two: an absent signal (no-data) is not the same as a rule that failed.
export interface TraceStep {
  rule: string
  outcome: 'matched' | 'not-matched' | 'no-data'
  detail: string
}

// Entry points — EXAMPLE values from the source demo (a TV shopping journey).
// Replace with your app's own entry vocabulary; the HUD only renders whatever
// keys exist here when the entryPoint/onSetEntryPoint props are provided.
export type EntryPoint = 'storefront' | 'drama-show' | 'sports-broadcast'

export const ENTRY_META: Record<EntryPoint, { label: string; emoji: string }> = {
  storefront: { label: 'Storefront', emoji: '🏬' },
  'drama-show': { label: 'Drama show (shoppable scene)', emoji: '🎬' },
  'sports-broadcast': { label: 'Sports broadcast', emoji: '🏟' },
}
