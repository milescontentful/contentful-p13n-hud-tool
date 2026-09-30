# Contentful P13n HUD

**See the math.** An operator panel for Contentful Personalization demos that shows *why* the
page is showing what it's showing — in the order it happened:

**① signals → ② audience → ③ decision trace → ④ selected variant (+ why)**

The decision trace is the part audiences remember: every rule, in order, marked
**✓ matched · ✗ not matched · ∅ NO DATA** — because "we have no data on this visitor yet" is a
different fact from "this visitor failed the rule", and saying so honestly is the trust moment.

It also does the job of Contentful's standard preview panel (force an audience, force a variant,
see the live profile, reset) by driving the **same official override engine** the panel uses —
so you run one panel on screen, built for storytelling instead of debugging.

This repo is the master copy. It ships as TypeScript source for **Vite + React** apps.

---

## 5-minute quick start

**1. Install** (plus the SDK pieces you probably already have):

```sh
npm install github:milescontentful/contentful-p13n-hud-tool
npm install @contentful/optimization-react-web @contentful/optimization-core contentful
```

**2. Point it at your space** — add to `.env.local` (Vite):

```
VITE_CONTENTFUL_SPACE_ID=<your space id>
VITE_CONTENTFUL_PREVIEW_TOKEN=<Content Preview API token>
VITE_CONTENTFUL_ENVIRONMENT_ID=master          # optional, default master
```

Or in code: `configureP13nHud({ spaceId, environment, previewToken })` once at boot.
With nothing set, the HUD still runs on the personas you pass as props and says so on screen.

**3. Load the audience/experience list once** (in `main.tsx`, next to your `<OptimizationRoot>`):

```tsx
import { loadP13nDefinitions } from 'contentful-p13n-hud-tool'
void loadP13nDefinitions() // reads nt_audience / nt_experience (drafts included) for the forcing controls
```

**4. Drop the HUD on the page** (the ~10 lines that matter):

```tsx
import { OperatorHud } from 'contentful-p13n-hud-tool'

<OperatorHud
  surface="My Site"
  audience={personaKey}                          // which persona is active now
  audienceOptions={[{ key: 'returning', label: 'Returning', emoji: '⭐', color: '#F59E0B' }]}
  traitKey="segment"                             // profile trait the persona sets
  selectedVariant={variantName}
  decisionReason="Returning-customer rule matched."
  trace={[{ rule: 'Page views ≥ 3', outcome: 'matched', detail: 'pageViews = 5' }]}
  signals={[{ q: 'Page views this session', a: '5' }]}
  onSwitchAudience={setPersonaKey}
  onReset={() => setPersonaKey('new-visitor')}
/>
```

Mark the personalized element with `data-p13n-target` so the **Highlight** button can pulse it.

**What you see:** a "Contentful HUD" pill bottom-right. Click it → the four numbered steps, the
operator controls, and (when the Optimization SDK is running on the page) the live profile plus a
closed-by-default **Advanced · force a variant** section. Drag it anywhere; it remembers where you
left it and which sections were folded, even across a reload. Esc closes it.

### Optional rows

Every extra control appears **only when you wire it** — no buttons that do nothing:

| Row | Pass |
|---|---|
| Personalization on/off | `p13nOn` + `onSetP13n` |
| A/B preview (control vs personalized) | `preview` + `onSetPreview` |
| Locale | `locale` + `localeOptions` + `onSetLocale` |
| Content source (fixtures vs Contentful) | `contentSource` + `onSetContentSource` |
| Experience state / entry point | `experienceState` + `experienceStateOptions` + `onSetExperienceState` (same shape for `entryPoint…`) |
| Open-in-Contentful link | `cfEntryId` |

### Personas as content (optional)

If the space has `demoPersona` entries (`personaKey`, `label`, `traitKey`, optional
`audienceNtId`, `emoji`, `color`, `description`), the HUD reads labels/colours from them, so
editors can rename personas without a code change. Content type id is configurable
(`configureP13nHud({ personaContentType })`). Each persona forces the audience whose
`nt_audience_id` is `audienceNtId` — or `aud-<personaKey>` by convention.

---

## Preflight checklist (the landmines)

Both of the first two were found by watching real pages fail silently — nothing errors, the swap
just never happens.

- [ ] **Fire the first page event after the SDK is live.** A `page()` call made during the first
  render hits a placeholder and does nothing. Wait for `useOptimizationContext()` to report the
  live SDK, then call `sdk.page()`.
- [ ] **Two id spaces for audiences.** The SDK's `AudienceDefinition.id` is the `nt_audience_id`
  *field*, but `ExperienceDefinition.audience.id` is the audience entry's *sys id*.
  `loadP13nDefinitions()` builds the bridge between them; if you roll your own loader, do the same.
- [ ] **Load definitions from the Preview API.** Variant entries are often drafts; the Delivery
  API silently drops them, so forcing controls would show nothing.
- [ ] **Don't attach `@contentful/optimization-web-preview-panel` as well.** Two panels driving
  one override engine will fight.
- [ ] **SDK v2 renamed the root prop:** `<OptimizationRoot clientId=…>` is now `spaceId=…`.
  The HUD itself works with SDK 1.2+ and 2.x (type-checked against both).

---

## vs. the standard preview panel

Compared with `@contentful/optimization-web-preview-panel` 2.0.1 (the official panel, Sept 2026):

**What the HUD adds**
- **Decision trace** with a three-state outcome (matched / not matched / NO DATA) — the panel
  shows *what* is on, never *why*.
- **Signals** block — what the personalization layer received, in plain language.
- **Selected variant + reason + provenance** — which Contentful entry produced the pixels, with an
  Open-in-Contentful button.
- **Live profile** — profile id, traits, matched audiences (the panel shows none of this).
- **Personas as content**, one-click persona switching (forces the audience *and* sets the trait
  via `identify()` so it survives a reload), highlight-the-change, full "forget me" reset.
- Presenter UX: draggable, collapsible, remembers layout, dark theme for screen shares.

**Where the panel is still ahead**
- Fuzzy **search** across audience/experience names.
- Every audience listed with a three-way **Off / Default / On** switch (the HUD forces *on* only,
  and only for your personas).
- **"You naturally qualify"** markers on audiences and variants.
- Variant **names and traffic %** shown inline (the HUD puts them in tooltips).
- Forced variants **survive a reload** (the panel saves them; the HUD's are cleared on reload).
- CSP nonce option.

Both drive the same engine (`PreviewOverrideManager`) and both tell the SDK "a preview panel is
open", which makes forced variants repaint immediately.

---

## How it talks to the SDK

All SDK access lives in `src/ntAdapter.ts`, using only official surface:
`window.contentfulOptimization`, `getPreviewPanelBridge` (`@contentful/optimization-core/bridge-support`)
and `PreviewOverrideManager` (`…/preview-support`). No SDK on the page → the audience block reads
"SDK not detected — local decisioning" and all SDK-only UI stays hidden. The HUD never fakes a
capability it doesn't have.

Forced variants repaint anything rendered through the SDK's `<OptimizedEntry>`. Content your app
decides itself (its own rules) follows the persona buttons instead.

## Files

| File | What it does |
|---|---|
| `src/OperatorHud.tsx` | the panel |
| `src/ntAdapter.ts` | every SDK call (persona activation, forcing, profile, reset) |
| `src/optimization.ts` | loads nt_audience / nt_experience with the SDK's own mappers |
| `src/personas.ts` | optional `demoPersona` content loader |
| `src/config.ts` | connection settings (env vars or `configureP13nHud`) |
| `src/index.ts` | public exports |
