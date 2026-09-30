// Content-driven personas: the HUD reads `demoPersona` entries from the space
// at boot (personas are CONTENT, not code — a reusable demo pattern). Absent
// credentials or entries → returns null and the HUD falls back to the
// audienceOptions the host app passed as props. Plain fetch, no SDK needed.
//
// Connection comes from ./config (configureP13nHud() or Vite env vars).
// Preview host so draft personas show during authoring.
import { hudConfig } from './config'

export type ContentPersona = {
  key: string
  label: string
  traitKey: string
  audienceNtId?: string
  description?: string
  emoji?: string
  color?: string
}

export async function fetchPersonas(): Promise<ContentPersona[] | null> {
  const { spaceId: SPACE, environment: ENV, previewToken: CPA_TOKEN, personaContentType } = hudConfig()
  if (!SPACE || !CPA_TOKEN) return null
  const qs = new URLSearchParams({ content_type: personaContentType, limit: '25', access_token: CPA_TOKEN })
  try {
    const res = await fetch(`https://preview.contentful.com/spaces/${SPACE}/environments/${ENV}/entries?${qs}`)
    if (!res.ok) {
      console.warn(`[p13n-hud] persona fetch ${res.status} — HUD falls back to prop-supplied audiences`)
      return null
    }
    const json = await res.json()
    if (!json?.items?.length) return null
    const personas = (json.items as any[])
      .map((e) => ({
        key: e.fields?.personaKey,
        label: e.fields?.label,
        traitKey: e.fields?.traitKey,
        audienceNtId: e.fields?.audienceNtId,
        description: e.fields?.description,
        emoji: e.fields?.emoji,
        color: e.fields?.color,
      }))
      .filter((p: ContentPersona) => p.key && p.label && p.traitKey)
    return personas.length ? personas : null
  } catch (e) {
    console.warn('[p13n-hud] persona fetch unreachable — HUD falls back to prop-supplied audiences', e)
    return null
  }
}
