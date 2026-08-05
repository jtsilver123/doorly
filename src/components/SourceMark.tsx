"use client";

import type { Source } from "@/types";
import { SOURCE_LABEL } from "@/types";

/**
 * Source badges.
 *
 * Five word-marks repeated across every card is a lot of reading for
 * information you take in at a glance — you learn "purple square = StreetEasy"
 * in about two cards, and after that the name is noise.
 *
 * Drawn as inline SVG rather than fetched: these render inside listing cards
 * that already load a photo each, and a sixth network request per card for a
 * 200-byte logo is a bad trade. The name stays in the tooltip and in aria-label,
 * so nothing is lost to a screen reader or an unsure user.
 */

const MARKS: Record<Source, { bg: string; fg: string; glyph: string }> = {
  // Approximations of each brand's primary colour — recognisable without
  // pretending to be an official asset.
  streeteasy: { bg: "#0f7ae5", fg: "#ffffff", glyph: "SE" },
  zillow: { bg: "#006aff", fg: "#ffffff", glyph: "Z" },
  apartments: { bg: "#00a4bd", fg: "#ffffff", glyph: "A" },
  hotpads: { bg: "#f5a623", fg: "#1a1a1a", glyph: "HP" },
  craigslist: { bg: "#5b2d8e", fg: "#ffffff", glyph: "CL" },
  email: { bg: "#6b6b7b", fg: "#ffffff", glyph: "@" },
  manual: { bg: "#16a34a", fg: "#ffffff", glyph: "+" },
};

export default function SourceMark({
  source,
  size = 18,
  href,
}: {
  source: Source;
  size?: number;
  href?: string;
}) {
  const mark = MARKS[source] ?? MARKS.manual;
  const label = SOURCE_LABEL[source] ?? source;

  const badge = (
    <span
      className="srcmark"
      style={{
        background: mark.bg,
        color: mark.fg,
        width: size,
        height: size,
        fontSize: Math.round(size * (mark.glyph.length > 1 ? 0.42 : 0.55)),
      }}
      aria-hidden="true"
    >
      {mark.glyph}
    </span>
  );

  if (!href) {
    return (
      <span title={label} aria-label={label} role="img">
        {badge}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="srcmark-link"
      title={`Open on ${label}`}
      aria-label={`Open on ${label}`}
      onClick={(e) => e.stopPropagation()}
    >
      {badge}
    </a>
  );
}
