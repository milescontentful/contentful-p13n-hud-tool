# Contentful P13n HUD

An operator inspector for Contentful Personalization demos: a draggable dark-glass panel that
shows the full causal chain of every personalization decision —

**① signals → ② audience → ③ decision trace → ④ selected variant (+ why)** —

with live SDK state and every operator control a presenter needs. It **replaces the first-party
preview panel entirely** (audience forcing, per-experience variant forcing, profile id,
profile reset) by driving the same official override engine the panel uses, from a surface
designed for storytelling instead of debugging.

Lineage: PGE quiz HUD → HCA/ref-marketing `PersonalizationHud` (personas-as-content) → this
generalized operator HUD (surface-generic, decision trace, SDK parity, `@contentful/optimization`).

## What it shows

- **Signals** — the distilled traits the personalization layer received (the host app's list;
  the framing: raw history stays in the warehouse, only the distillate crosses over)
- **Audience** — resolved trait/audience with live SDK status; personas load from `demoPersona`
  CONTENT entries in the space when connected, falling back to prop-supplied options
- **Decision trace** — the host's deterministic rule evaluation, three-state:
  matched ✓ · not matched ✗ · **NO DATA ∅** (an absent signal is not a failed rule)
- **Selected variant** — with Contentful entry provenance ("this pixel came from this entry")
  and a labeled Open-in-Contentful button
- **Operator controls** — audience switch, entry point, personalization on/off, A/B preview,
  locale, content source, experience state, reset
- **SDK block** (only when the SDK is live) — profile id (click-to-copy), traits, matched
  audiences, per-experience variant forcing chips (Auto/Base/V1), "Reset profile (forget me)"

Panel UX: draggable anywhere (position + collapse state persist in sessionStorage), minimize
pill, Esc closes, collapsible numbered sections.

## SDK coupling

Built for **`@contentful/optimization-react-web` ≥ 1.2.0**. All SDK access lives in
`src/ntAdapter.ts` (two host-facing touchpoints: `activatePersona` / `resetAll`, plus the
widget-parity extras) via the official surface — `window.contentfulOptimization`,
`getPreviewPanelBridge` (`@contentful/optimization-core/bridge-support`), and
`PreviewOverrideManager` (`.../preview-support`). `src/optimization.ts` loads the
`nt_audience`/`nt_experience` graph with the SDK's own mappers (preview host, so draft
variants resolve).

Everything degrades honestly: no SDK mounted → the audience block says
"SDK not detected — local decisioning" and all SDK-only UI stays hidden. No credentials →
personas fall back to props. The HUD never fakes a capability it doesn't have.

Two migration landmines this code already solves (found by observation, 2026-08-15):
1. The initial page event silently no-ops against the SDK's pre-live snapshot runtime — the
   host must wait for the live SDK (`useOptimizationContext()`) before `trackPageView()`.
2. The SDK's mappers use two id spaces — `AudienceDefinition.id` is the `nt_audience_id`
   field, but `ExperienceDefinition.audience.id` is the entry **sys id**. `optimization.ts`
   carries the bridge map.

## Integration (source-drop)

This is a source drop, not (yet) an npm package: copy `src/` into your app and wire the props.

```tsx
<OperatorHud
  surface="My Storefront"
  audience={audienceKey}
  audienceOptions={[{ key, label, emoji, color }, …]}
  traitKey="shopperArchetype"
  selectedVariant={exp.selectedVariant}
  decisionReason={exp.decisionReason}
  trace={exp.trace}                 // optional TraceStep[]
  signals={signalsForAudience}
  locale={locale} timeOfDay={timeOfDay}
  contentSource={source} experienceState={view}
  p13nOn={p13nOn} preview={preview}
  cfEntryId={entryId}               // optional: powers Open-in-Contentful
  entryPoint={entry} onSetEntryPoint={setEntry}   // optional row
  onSwitchAudience={…} onSetLocale={…} onSetContentSource={…}
  onSetExperienceState={…} onSetP13n={…} onSetPreview={…} onReset={…}
/>
```

Env (Vite): `VITE_CONTENTFUL_SPACE_ID`, `VITE_CONTENTFUL_PREVIEW_TOKEN`, optional
`VITE_CONTENTFUL_ENVIRONMENT_ID` (personas + entry links + definitions loader).

Peer expectations: React 18, the optimization SDK mounted by the host (see the reference
consumer's `main.tsx`), `contentful` (for the definitions loader).

The host page should mark its personalized element with `data-p13n-target` (the Highlight
button pulses it) and register no other p13n UI — the HUD is designed to be the single
source of truth on screen; don't attach `@contentful/optimization-web-preview-panel`
alongside it.

## Reference consumer

`milescontentful/lg-display` (private) — a webOS TV demo with two surfaces (gaming +
commerce) driving this HUD, including a deterministic rule engine that emits the decision
trace and micro-personalizations (abandoned cart, brand-affinity sale, replenishment).

## Generalization TODOs

- `EntryPoint`/`ENTRY_META` in `types.ts` still carry the reference demo's example values —
  make the entry-point row fully prop-driven
- Package as an npm module with proper peerDependencies
- The persona content type id (`demoPersona`) and locale strings are conventions from the
  source platform; make them configurable
