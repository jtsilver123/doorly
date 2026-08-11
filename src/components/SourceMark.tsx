"use client";

import type { Source } from "@/types";
import { SOURCE_LABEL } from "@/types";

/**
 * Source badges.
 *
 * Each site's own mark, drawn as inline SVG in its real brand colour: you
 * recognise the Zillow house or the Apartments.com bubble instantly, where
 * "Z" and "A" in coloured squares needed learning first. Nominative use —
 * these say "this listing is on Zillow", which is what a logo is for.
 *
 * Inline rather than fetched, because these render several times per card in
 * a grid of hundreds; a network request per badge would be a bad trade for
 * two hundred bytes. The name still rides in the tooltip and aria-label, so
 * nothing is lost to a screen reader or to anyone who doesn't know the mark.
 */

/** 24×24 viewBox for all of them, so they line up at any size. */
// Exported for the Find directory, which shows these marks at tile size.
export function Glyph({ source }: { source: Source }) {
  switch (source) {
    case "facebook":
      // The f in its circle — nominative use, same as the rest.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <circle cx="12" cy="12" r="12" fill="#0866ff" />
          <path
            d="M15.9 15.2l.5-3.2h-3.1V9.9c0-.9.4-1.7 1.8-1.7h1.4V5.4S15.2 5.2 14 5.2c-2.6 0-4.3 1.6-4.3 4.4V12H6.9v3.2h2.8V23a11 11 0 0 0 3.6 0v-7.8Z"
            fill="#fff"
          />
        </svg>
      );

    case "zillow":
      // Roofline over a house with the lightning-Z cut through it.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <circle cx="12" cy="12" r="12" fill="#006aff" />
          <path
            d="M12 4.6 4.9 9.9v1.9l2.6-1.9v8.4h9v-8.4l2.6 1.9V9.9Z"
            fill="#fff"
          />
          <path
            d="M9.2 9.6h6.2l-3.1 3.3 3.5-1.1v2.6H9.2l3-3.2-3 1Z"
            fill="#006aff"
          />
        </svg>
      );

    case "apartments":
      // Speech bubble with a building inside it.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <path
            d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0Z"
            fill="#102a63"
          />
          <path
            d="M12 3.4a8.6 8.6 0 0 0-1.5 17.1v2.9l3.2-3.1A8.6 8.6 0 0 0 12 3.4Z"
            fill="#fff"
          />
          <path
            d="M8.4 7.6h7.2v1.1h-.7v7.7H9.1V8.7h-.7Zm1.9 2.1v1.5h1.2V9.7Zm2.4 0v1.5h1.2V9.7Zm-2.4 2.9v1.5h1.2v-1.5Zm2.4 0v1.5h1.2v-1.5Zm-1.2 2.9v1.9h1.2v-1.9Z"
            fill="#102a63"
          />
        </svg>
      );

    case "hotpads":
      // Five kites pinwheeling around a hollow star.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <rect width="24" height="24" rx="3" fill="#fff" />
          <g fill="#76bc06">
            <path d="M11.4 2.4 5.1 4.6l3.3 3.6 4.6-2.2Z" />
            <path d="M15.1 3.5l-1.6 4.7 4.5 2.3.7-4.9Z" />
            <path d="M5.9 7.9 2.4 11l4.1 4 1.2-4.9Z" />
            <path d="M21.6 12.2l-4.6 1.9.5 4.9 4.1-3.6Z" />
            <path d="M7.7 16.6l1.9 4.9 6-1.4-3.1-4.4Z" />
          </g>
        </svg>
      );

    case "streeteasy":
      // A stylised brownstone stoop — StreetEasy's blue, no wordmark.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#0a6cd4" />
          <path d="M6 9.5 12 5.5l6 4V19h-4.3v-4.6h-3.4V19H6Z" fill="#fff" />
        </svg>
      );

    case "craigslist":
      // The peace-sign dot, in Craigslist's purple.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <circle cx="12" cy="12" r="12" fill="#5b2d8e" />
          <circle cx="12" cy="12" r="7.2" fill="none" stroke="#fff" strokeWidth="1.6" />
          <path
            d="M12 4.8v14.4M12 12 6.9 17.1M12 12l5.1 5.1"
            stroke="#fff"
            strokeWidth="1.6"
          />
        </svg>
      );

    case "email":
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#697077" />
          <path
            d="M5 8h14v8H5Zm0 0 7 5 7-5"
            fill="none"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );

    default:
      // Added by hand.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <rect width="24" height="24" rx="4" fill="#d6f84b" />
          <path d="M12 6.5v11M6.5 12h11" stroke="#14141a" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
  }
}

export default function SourceMark({
  source,
  size = 18,
  href,
}: {
  source: Source;
  size?: number;
  href?: string;
}) {
  const label = SOURCE_LABEL[source] ?? source;
  const badge = (
    <span className="srcmark" style={{ width: size, height: size }} aria-hidden="true">
      <Glyph source={source} />
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
