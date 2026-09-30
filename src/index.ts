// Public entry point — import everything from the package root.
export { OperatorHud } from './OperatorHud'
export type { HudProps, AudienceOption, ContentSource } from './OperatorHud'
export type { HudSignal, TvSignal, TraceStep, SegOption } from './types'
export { configureP13nHud, type P13nHudConfig } from './config'
export { loadP13nDefinitions, getP13nDefinitions, type P13nDefinitions } from './optimization'
export { fetchPersonas, type ContentPersona } from './personas'
export {
  sdkAvailable,
  activatePersona,
  resetAll,
  readProfile,
  forceVariant,
  resetProfile,
  getOverrides,
  type SdkProfile,
} from './ntAdapter'
