// Fetch + map the nt_audience / nt_experience entries for the Contentful
// Optimization SDK's preview surface (the OperatorHud). Same content types the
// legacy Ninetailed SDK used — the new SDK consumes them through its OWN
// mappers (`@contentful/optimization-core/preview-support`), which is exactly
// what the first-party preview panel would do if we attached it (we don't:
// the HUD is the single p13n surface).
//
// Note the split: the SDK itself gets variant DECISIONS from the Experience
// API (server-side) — it never needs these entries. The entries are only
// needed browser-side to know the audience↔experience↔variant graph for
// forcing controls and labels.
//
// We use the PREVIEW host, because the variant entries are deliberately DRAFTS
// (drafts-first publish gate) and the delivery API would silently drop them
// from link resolution — the exact hollow the ninetailed-spa-debug lesson
// warns about.
import { createClient } from 'contentful'
import {
  createAudienceDefinitions,
  createExperienceDefinitions,
  fetchAudienceAndExperienceEntries,
  type AudienceDefinition,
  type ContentfulClient,
  type ExperienceDefinition,
} from '@contentful/optimization-core/preview-support'

const SPACE = import.meta.env.VITE_CONTENTFUL_SPACE_ID as string | undefined
const ENV = (import.meta.env.VITE_CONTENTFUL_ENVIRONMENT_ID as string | undefined) ?? 'master'
const CPA_TOKEN = import.meta.env.VITE_CONTENTFUL_PREVIEW_TOKEN as string | undefined

export function previewContentfulClient() {
  if (!SPACE || !CPA_TOKEN) return null
  return createClient({ space: SPACE, environment: ENV, accessToken: CPA_TOKEN, host: 'preview.contentful.com' })
}

export interface P13nDefinitions {
  audiences: AudienceDefinition[]
  experiences: ExperienceDefinition[]
  /**
   * nt_audience_id → audience ENTRY sys.id. Needed because the SDK's own
   * mappers live in two id spaces (observed 2026-08-15): AudienceDefinition.id
   * is the nt_audience_id FIELD (`aud-*`) while ExperienceDefinition.audience.id
   * is the linked entry's SYS id (`ntaud-*` in this space). Without this map,
   * audience→experience lookups silently match nothing — a classic hollow.
   */
  audienceSysIdByAudienceId: Record<string, string>
}

const EMPTY: P13nDefinitions = { audiences: [], experiences: [], audienceSysIdByAudienceId: {} }

declare global {
  interface Window {
    /** audience/experience graph stash — read by ntAdapter + OperatorHud */
    __optimizationDefinitions?: P13nDefinitions
  }
}

/**
 * Load all nt_audience / nt_experience entries (drafts included, preview host)
 * and map them with the SDK's own definition mappers. Stashes the result on
 * `window.__optimizationDefinitions` so the adapter/HUD can read it lazily.
 */
export async function loadP13nDefinitions(): Promise<P13nDefinitions> {
  const client = previewContentfulClient()
  if (!client) return EMPTY
  try {
    // contentful.js client structurally satisfies the SDK's ContentfulClient
    const { audiences, experiences } = await fetchAudienceAndExperienceEntries(client as unknown as ContentfulClient)
    const audienceSysIdByAudienceId: Record<string, string> = {}
    for (const entry of audiences.items) {
      const audienceId = (entry.fields as { nt_audience_id?: string }).nt_audience_id
      if (audienceId) audienceSysIdByAudienceId[audienceId] = entry.sys.id
    }
    const defs: P13nDefinitions = {
      audiences: createAudienceDefinitions(audiences),
      experiences: createExperienceDefinitions(experiences),
      audienceSysIdByAudienceId,
    }
    window.__optimizationDefinitions = defs
    return defs
  } catch (e) {
    console.warn('[optimization] could not fetch nt_audience / nt_experience entries', e)
    return EMPTY
  }
}

/** Synchronous read of the stashed definitions (empty until the fetch lands). */
export function getP13nDefinitions(): P13nDefinitions {
  return window.__optimizationDefinitions ?? EMPTY
}
