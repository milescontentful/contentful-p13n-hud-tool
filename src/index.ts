// Public entry point — import everything from the package root.
export { OperatorHud } from './OperatorHud'
export type { HudProps, AudienceOption, ContentSource } from './OperatorHud'
export type { HudSignal, TvSignal, TraceStep, TraceCondition, TraceOutcome, SegOption } from './types'
export {
  evaluateAudience,
  evaluateAudiences,
  evaluateRule,
  audiencesFromEntries,
  type VisitorFacts,
  type PageFact,
  type EventFact,
  type AudienceRules,
} from './evaluate'
export { recordPageFact, readPageFacts, recordEventFact, readEventFacts, clearFacts, campaignFromUrl } from './facts'
export { whyNotOthers, type Alternative } from './whyNot'
export { configureP13nHud, type P13nHudConfig } from './config'
export { loadP13nDefinitions, getP13nDefinitions, type P13nDefinitions } from './optimization'
export { fetchPersonas, type ContentPersona } from './personas'
export {
  sdkAvailable,
  activatePersona,
  resetAll,
  readProfile,
  subscribeProfile,
  forceVariant,
  resetProfile,
  getOverrides,
  readSelections,
  subscribeSelections,
  type SdkProfile,
  type SdkSelection,
} from './ntAdapter'
