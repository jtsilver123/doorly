import type { JSX } from "react";
import { AMENITIES, type AmenityKey } from "@/lib/amenities";

/**
 * The amenity badges.
 *
 * "Is it a good deal" is never only about price — it's about price for *this*
 * apartment, and the difference between two identically priced studios is
 * usually a washer, a dishwasher and a lift. These are the badges that let you
 * see that difference without opening anything.
 *
 * The icons are inline SVG rather than Unicode glyphs. The first version used
 * characters like ❋ and ⇅, which is fine until you meet a machine whose system
 * font doesn't carry them and every badge renders as an identical empty
 * rectangle — the amenities became noise on exactly the platforms least likely
 * to be tested. SVG draws the same everywhere and costs no network request.
 *
 * Capped at four on a card. Sources list twenty-odd amenities and most of them
 * ("Fios Available") change nobody's mind; showing all of them is the same as
 * showing none.
 */

const S = { width: 13, height: 13, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const;
const stroke = { stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<AmenityKey, JSX.Element> = {
  // A front-loader: door circle inside a box.
  laundry_unit: (
    <svg {...S}>
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" {...stroke} />
      <circle cx="8" cy="9" r="3.2" {...stroke} />
      <path d="M5 4h2" {...stroke} />
    </svg>
  ),
  // The same machine, smaller, sat in a building.
  laundry_building: (
    <svg {...S}>
      <path d="M2 14V4l6-2.5V14" {...stroke} />
      <path d="M8 14V6l6 2v6" {...stroke} />
      <circle cx="5" cy="9" r="1.6" {...stroke} />
    </svg>
  ),
  // Plates on a rack.
  dishwasher: (
    <svg {...S}>
      <rect x="2" y="2" width="12" height="12" rx="1.5" {...stroke} />
      <path d="M2 6h12" {...stroke} />
      <circle cx="8" cy="10" r="2" {...stroke} />
    </svg>
  ),
  // Lift arrows.
  elevator: (
    <svg {...S}>
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" {...stroke} />
      <path d="M6.5 7L8 5l1.5 2M6.5 9l1.5 2 1.5-2" {...stroke} />
    </svg>
  ),
  // A leaf, for a balcony or a garden.
  outdoor: (
    <svg {...S}>
      <path d="M13 3c0 6-3.5 9-8 9-1 0-2-.3-2-.3C3 6.5 7 3 13 3z" {...stroke} />
      <path d="M11 5C7.5 6.5 5 9 3.6 13" {...stroke} />
    </svg>
  ),
  // Sun.
  light: (
    <svg {...S}>
      <circle cx="8" cy="8" r="3" {...stroke} />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M13 3l-1 1M4 12l-1 1" {...stroke} />
    </svg>
  ),
  // Snowflake.
  air: (
    <svg {...S}>
      <path d="M8 1.5v13M2.4 4.75l11.2 6.5M13.6 4.75L2.4 11.25" {...stroke} />
      <path d="M6.4 3.1L8 1.5l1.6 1.6M6.4 12.9L8 14.5l1.6-1.6" {...stroke} />
    </svg>
  ),
  // A bell at a desk.
  doorman: (
    <svg {...S}>
      <path d="M2.5 12h11" {...stroke} />
      <path d="M4 12a4 4 0 018 0" {...stroke} />
      <path d="M8 8V6" {...stroke} />
      <circle cx="8" cy="4.5" r="1.2" {...stroke} />
    </svg>
  ),
  // A paw.
  pets: (
    <svg {...S}>
      <ellipse cx="4" cy="6" rx="1.4" ry="1.9" {...stroke} />
      <ellipse cx="7.4" cy="4.4" rx="1.4" ry="1.9" {...stroke} />
      <ellipse cx="11" cy="6" rx="1.4" ry="1.9" {...stroke} />
      <path d="M7.5 8.2c2.2 0 3.6 1.6 3.6 3S9.7 14 7.5 14 3.9 12.6 3.9 11.2s1.4-3 3.6-3z" {...stroke} />
    </svg>
  ),
  // A dumbbell.
  gym: (
    <svg {...S}>
      <path d="M2 6v4M4.5 4.5v7M11.5 4.5v7M14 6v4M4.5 8h7" {...stroke} />
    </svg>
  ),
};

export default function Perks({
  keys,
  absent = [],
  limit = 4,
  showLabels = false,
}: {
  keys: AmenityKey[];
  /**
   * Stated absences — walk-up, "no pets". A different thing from silence,
   * and often the more decisive fact: nobody skips a viewing because a
   * listing has an elevator, plenty skip one because it doesn't.
   */
  absent?: AmenityKey[];
  limit?: number;
  showLabels?: boolean;
}) {
  if (!keys.length && !absent.length) {
    return <span className="perks-empty">No amenities listed</span>;
  }

  const shown = keys.slice(0, limit);
  const extra = keys.length - shown.length;

  return (
    <span className="perks">
      {shown.map((key) => (
        <span key={key} className="perk" title={AMENITIES[key].label}>
          {ICONS[key]}
          <span className={showLabels ? undefined : "sr-only"}>{AMENITIES[key].label}</span>
        </span>
      ))}
      {extra > 0 && (
        <span
          className="perk perk-more"
          title={keys.slice(limit).map((k) => AMENITIES[k].label).join(", ")}
        >
          +{extra}
        </span>
      )}
      {absent.map((key) => (
        <span key={key} className="perk perk-no" title={`No ${AMENITIES[key].label.toLowerCase()}`}>
          {ICONS[key]}
          <span className={showLabels ? undefined : "sr-only"}>
            No {AMENITIES[key].label.toLowerCase()}
          </span>
        </span>
      ))}
    </span>
  );
}
