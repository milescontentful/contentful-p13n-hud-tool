// Where the HUD reads its Contentful connection from.
//
// Two ways to supply it (the first one found wins):
//   1. call configureP13nHud({ spaceId, environment, previewToken }) once at boot
//   2. Vite env vars: VITE_CONTENTFUL_SPACE_ID, VITE_CONTENTFUL_PREVIEW_TOKEN,
//      optional VITE_CONTENTFUL_ENVIRONMENT_ID (or VITE_CONTENTFUL_ENVIRONMENT)
// Nothing supplied → the HUD still runs, with prop-supplied personas and no
// entry links (it says so on screen rather than pretending).

export interface P13nHudConfig {
  spaceId?: string
  /** default 'master' */
  environment?: string
  /** Content Preview API token — drafts show, so draft variants resolve */
  previewToken?: string
  /** content type id holding persona entries (default 'demoPersona') */
  personaContentType?: string
}

let explicit: P13nHudConfig = {}

/** Optional: set the connection in code instead of (or on top of) env vars. */
export function configureP13nHud(cfg: P13nHudConfig) {
  explicit = { ...explicit, ...cfg }
}

function env(key: string): string | undefined {
  // optional chaining: non-Vite bundlers have no import.meta.env
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key]
  return v || undefined
}

export function hudConfig(): Required<Pick<P13nHudConfig, 'environment' | 'personaContentType'>> &
  Pick<P13nHudConfig, 'spaceId' | 'previewToken'> {
  return {
    spaceId: explicit.spaceId ?? env('VITE_CONTENTFUL_SPACE_ID'),
    environment:
      explicit.environment ?? env('VITE_CONTENTFUL_ENVIRONMENT_ID') ?? env('VITE_CONTENTFUL_ENVIRONMENT') ?? 'master',
    previewToken: explicit.previewToken ?? env('VITE_CONTENTFUL_PREVIEW_TOKEN'),
    personaContentType: explicit.personaContentType ?? 'demoPersona',
  }
}
