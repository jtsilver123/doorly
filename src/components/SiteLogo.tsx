"use client";

import { Glyph } from "@/components/SourceMark";
import type { Source } from "@/types";

/**
 * Directory marks for the Find page, one per door.
 *
 * Same rules as SourceMark, which draws the five listing sources: each
 * site's mark as inline SVG in its real brand colour, nominative use — the
 * mark says "this link opens Zillow", which is what a logo is for. Inline
 * rather than fetched: no third-party favicon requests, no broken images
 * when a CDN hiccups, and the page stays self-contained.
 *
 * Sites the source system already draws reuse its glyphs, so the mark on a
 * directory door and the badge on a listing card can never disagree. The
 * rest get marks at the fidelity honesty allows: widely recognised symbols
 * (the Airbnb Bélo) drawn as symbols, and smaller brands as monograms in
 * their brand colour — a faked "logo" for a brand nobody could verify is
 * worse than a clean initial.
 */

/** Directory keys that are just a listing source wearing a different hat. */
const AS_SOURCE: Record<string, Source> = {
  streeteasy: "streeteasy",
  zillow: "zillow",
  hotpads: "hotpads",
  apartments: "apartments",
  craigslist: "craigslist",
  "cl-sublets": "craigslist",
  "fb-nofee": "facebook",
  "fb-sublets": "facebook",
};

/** A brand-coloured tile with the brand's initial, for the smaller names. */
function Monogram({ bg, letter, fg = "#fff" }: { bg: string; letter: string; fg?: string }) {
  return (
    <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill={bg} />
      <text
        x="12"
        y="16.6"
        textAnchor="middle"
        fontFamily="Archivo, system-ui, sans-serif"
        fontSize="13"
        fontWeight="750"
        fill={fg}
      >
        {letter}
      </text>
    </svg>
  );
}

export default function SiteLogo({ site }: { site: string }) {
  const source = AS_SOURCE[site];
  if (source) return <Glyph source={source} />;

  switch (site) {
    case "renthop":
      // The house mid-hop, in RentHop's green.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <rect width="24" height="24" rx="5" fill="#3e9c35" />
          <path d="M6.2 12.6 12 8l5.8 4.6V18h-4v-3.4h-3.6V18h-4Z" fill="#fff" />
          <path
            d="M5.5 7.8c1.6-2.6 4-4 6.5-4s4.9 1.4 6.5 4"
            fill="none"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="0.1 3"
          />
        </svg>
      );

    case "airbnb":
      // The Bélo, simplified to what a 38px tile can honestly hold.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <rect width="24" height="24" rx="5" fill="#ff385c" />
          <path
            d="M12 4.6c1.5 0 2.3 1 3.1 2.7l3 6.3c.9 2 .3 4-1.6 4.6-1.4.5-2.9-.2-4.5-2.1-1.6 1.9-3.1 2.6-4.5 2.1-1.9-.6-2.5-2.6-1.6-4.6l3-6.3C9.7 5.6 10.5 4.6 12 4.6Zm0 2c-.5 0-.9.4-1.4 1.5l-2.9 6.1c-.5 1.1-.2 2 .6 2.3.9.3 2-.4 3.7-2.5 1.7 2.1 2.8 2.8 3.7 2.5.8-.3 1.1-1.2.6-2.3l-2.9-6.1c-.5-1.1-.9-1.5-1.4-1.5Zm0 3.2c.9 0 1.6.7 1.6 1.6 0 .9-.7 1.9-1.6 2.9-.9-1-1.6-2-1.6-2.9 0-.9.7-1.6 1.6-1.6Z"
            fill="#fff"
          />
        </svg>
      );

    case "vrbo":
      // The roofline V, in Vrbo's blue.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <rect width="24" height="24" rx="5" fill="#245abc" />
          <path d="M5 7.5h4l3 5.4 3-5.4h4L12 18.8Z" fill="#fff" />
        </svg>
      );

    case "furnished-finder":
      // A furnished house under the finder's lens.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <rect width="24" height="24" rx="5" fill="#12467b" />
          <path d="M5.4 11.6 11 7.2l5.6 4.4v6H5.4Z" fill="#fff" />
          <circle cx="16.4" cy="14.6" r="3.1" fill="none" stroke="#f6a21d" strokeWidth="1.7" />
          <path d="m18.7 16.9 2 2" stroke="#f6a21d" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );

    case "blueground":
      return <Monogram bg="#04246a" letter="b" />;

    case "junehomes":
      return <Monogram bg="#5236ab" letter="j" />;

    case "leasebreak":
      // A lease, torn: the whole pitch in one mark.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <rect width="24" height="24" rx="5" fill="#0f7fa8" />
          <path
            d="M7 5h10v7.2l-2 1.6-2-1.6-2 1.6-2-1.6-2 1.6Zm0 10.4 2-1.6 2 1.6 2-1.6 2 1.6 2-1.6V19H7Z"
            fill="#fff"
          />
        </svg>
      );

    case "listings-project":
      // Black on paper-white, like the newsletter it is.
      return <Monogram bg="#f4f2ea" letter="L" fg="#14141a" />;

    case "spareroom":
      // The spare bed, in SpareRoom's teal.
      return (
        <svg viewBox="0 0 24 24" className="srcglyph" aria-hidden="true">
          <rect width="24" height="24" rx="5" fill="#00a0a8" />
          <path
            d="M5 8.5v7.5M5 13h14v3M5 12h14v-1.7a2 2 0 0 0-2-2h-7"
            fill="none"
            stroke="#fff"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="7.8" cy="9.8" r="1.4" fill="#fff" />
        </svg>
      );

    default:
      return <Monogram bg="#697077" letter={site.slice(0, 1).toUpperCase()} />;
  }
}
