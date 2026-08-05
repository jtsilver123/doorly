/**
 * The mark.
 *
 * A walk-up facade seen straight on: the shape you actually look up at from
 * the sidewalk when you're deciding whether to press the buzzer. Four windows
 * dark and one lit — the one that's free, which is the whole product in a
 * glyph.
 *
 * Drawn on a square grid with no strokes below 1.5px, so it stays legible at
 * the 22px it renders in the rail. Inline SVG rather than a file: no request,
 * no flash before it paints, and it inherits the accent colour so it follows
 * the theme rather than fighting it.
 */

export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Facade */}
      <rect x="3" y="2.5" width="18" height="19" rx="2.5" className="logo-face" />
      {/* Windows, unlit */}
      <rect x="6.5" y="6" width="4" height="4" rx="0.8" className="logo-pane" />
      <rect x="13.5" y="6" width="4" height="4" rx="0.8" className="logo-pane" />
      <rect x="6.5" y="12" width="4" height="4" rx="0.8" className="logo-pane" />
      {/* The one that's free */}
      <rect x="13.5" y="12" width="4" height="4" rx="0.8" className="logo-lit" />
      {/* Stoop door */}
      <path d="M10 21.5v-3a2 2 0 0 1 4 0v3" className="logo-door" />
    </svg>
  );
}
