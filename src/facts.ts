// facts.ts — what THIS browser has seen, so the evaluator has something to test.
//
// The HUD records one page fact per page load (URL + any utm_* values) in
// sessionStorage, so a campaign that arrived three pages ago still counts —
// the same way the visitor's profile remembers it. SPA hosts call
// recordPageFact() on route changes; hosts that track events call
// recordEventFact(name) next to sdk.track(). A host can instead pass its own
// `facts` prop to the HUD, which wins over these.
//
// Session-scoped on purpose: it is a demo inspector, not a profile store. The
// Experience API's own answer (profile.audiences) is shown alongside.
import type { EventFact, PageFact } from './evaluate'

const PAGES_KEY = 'p13n-hud-pages'
const EVENTS_KEY = 'p13n-hud-events'
const CAP = 100

function read<T>(key: string): T[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}
function write<T>(key: string, list: T[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(list.slice(-CAP)))
  } catch {
    // storage blocked — the evaluator then sees only what the host passes
  }
}

/** UTM values on a URL, in the SDK's campaign shape (name/source/medium/term/content). */
export function campaignFromUrl(href: string): PageFact['campaign'] {
  let q: URLSearchParams
  try {
    q = new URL(href).searchParams
  } catch {
    return undefined
  }
  const out: Record<string, string> = {}
  for (const k of ['campaign', 'source', 'medium', 'term', 'content']) {
    const v = q.get(`utm_${k}`)
    if (v) out[k === 'campaign' ? 'name' : k] = v
  }
  return Object.keys(out).length ? out : undefined
}

// guards React StrictMode double-mounts: one record per href per JS lifetime-step
let lastHref: string | null = null

/** Record a page view (defaults to the current URL). Safe to call repeatedly. */
export function recordPageFact(href: string = window.location.href): PageFact[] {
  const list = read<PageFact>(PAGES_KEY)
  if (href === lastHref) return list
  lastHref = href
  list.push({ url: href, campaign: campaignFromUrl(href), referrer: document.referrer || undefined })
  write(PAGES_KEY, list)
  return list
}

export function readPageFacts(): PageFact[] {
  return read<PageFact>(PAGES_KEY)
}

/** Record a tracked event (call it next to sdk.track({ event: name })). */
export function recordEventFact(name: string) {
  write(EVENTS_KEY, [...read<EventFact>(EVENTS_KEY), { name }])
}

export function readEventFacts(): EventFact[] {
  return read<EventFact>(EVENTS_KEY)
}

/** Forget every recorded fact (the HUD calls this on "Reset profile"). */
export function clearFacts() {
  lastHref = null
  write(PAGES_KEY, [])
  write(EVENTS_KEY, [])
}
