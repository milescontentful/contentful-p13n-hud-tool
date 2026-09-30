// icons.tsx — the HUD's operator icons: inline SVG, no icon library.
// Every icon button carries a tooltip (title) AND an aria-label, a 28px hit
// area, and a visible keyboard focus ring (the .p13n-hud-ib rule in HUD_CSS).
import type { CSSProperties, ReactNode } from 'react'

const base = (children: ReactNode) => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

export const Icon = {
  /** minimize the panel back to the pill */
  minimize: () => base(<path d="M5 12h14" />),
  /** pulse the personalized element on the page */
  highlight: () =>
    base(
      <>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </>,
    ),
  /** back to baseline (clear every override) */
  reset: () =>
    base(
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
      </>,
    ),
  /** forget this profile */
  forget: () =>
    base(
      <>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21a7 7 0 0 1 14 0" />
        <path d="M17 8l5 5M22 8l-5 5" />
      </>,
    ),
  /** open in Contentful (new tab) */
  external: () =>
    base(
      <>
        <path d="M14 4h6v6" />
        <path d="M20 4l-9 9" />
        <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </>,
    ),
  /** copy to clipboard */
  copy: () =>
    base(
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a1 1 0 0 1 1-1h10" />
      </>,
    ),
}

/** Focus ring + hover for every HUD control (inline styles can't do :focus-visible). */
export const HUD_CSS = `
.p13n-hud-ib:focus-visible,.p13n-hud-focus:focus-visible{outline:2px solid #00B8C4;outline-offset:2px}
.p13n-hud-ib:hover{background:rgba(255,255,255,0.12)!important;color:#fff!important}
`

const ib: CSSProperties = {
  width: 28,
  height: 28,
  minWidth: 28,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.16)',
  background: 'rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.78)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  flexShrink: 0,
  textDecoration: 'none',
}
const accent: CSSProperties = { borderColor: '#00B8C4', background: 'rgba(0,184,196,0.13)', color: '#7FE9F1' }

/** A small square icon button with tooltip + aria-label. Renders an <a> when `href` is set. */
export function IconButton(p: {
  label: string
  icon: () => ReactNode
  onClick?: () => void
  href?: string
  tone?: 'plain' | 'accent'
  testId?: string
}) {
  const style = { ...ib, ...(p.tone === 'accent' ? accent : null) }
  if (p.href)
    return (
      <a
        className="p13n-hud-ib"
        href={p.href}
        target="_blank"
        rel="noreferrer"
        title={p.label}
        aria-label={p.label}
        style={style}
        data-hud-action={p.testId}
      >
        {p.icon()}
      </a>
    )
  return (
    <button
      type="button"
      className="p13n-hud-ib"
      title={p.label}
      aria-label={p.label}
      onClick={p.onClick}
      style={style}
      data-hud-action={p.testId}
    >
      {p.icon()}
    </button>
  )
}
