/**
 * The mark.
 *
 * Three lines of a document, and the one in the middle is highlighted.
 *
 * Not a house, not a roofline, not a keyhole — every other product in this
 * category has drawn those, and a logo that looks like the category is a logo
 * nobody remembers. What this draws instead is the thing the product actually
 * does: it reads the paperwork and marks the line that matters. The glyph is
 * the `.mark` primitive from the stylesheet, which is the same gesture the
 * headline uses and the same one a listing's real price gets.
 *
 * The acid bar deliberately overruns both grey lines, the way a highlighter
 * overshoots the text it's marking. That asymmetry is what stops it reading as
 * a generic stack of bars.
 *
 * Straight, not tilted: a few degrees of rotation looks more hand-made at
 * 128px and turns to mush at 16px, where horizontal edges are the only thing
 * that stays crisp. This has to survive the 22px it renders at in the rail.
 *
 * Inline SVG rather than a file: no request, no flash before it paints, and
 * it inherits theme colours through CSS rather than shipping two copies.
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
      <rect x="3.5" y="3.5" width="12" height="3" rx="1.5" className="logo-line" />
      <rect x="1.5" y="9.5" width="21" height="5.5" rx="1.2" className="logo-lit" />
      <rect x="3.5" y="18" width="15" height="3" rx="1.5" className="logo-line" />
    </svg>
  );
}
