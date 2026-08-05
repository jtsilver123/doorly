import type { FeedListing } from "@/types";
import type { AmenityKey } from "@/lib/amenities";

/**
 * What to actually check when you're standing in the apartment.
 *
 * A tour is twenty minutes against a decision you'll live in for a year, and
 * the questions worth asking are exactly the ones the listing dodged. The
 * rating's cons already know what those are — this turns each gap into the
 * question that settles it, so "No laundry mentioned" becomes "where's the
 * nearest laundromat", and a ground-floor unit becomes "who's above you".
 *
 * Every question is grounded in something the listing did or didn't say —
 * generic advice ("check the water pressure") is what every blog already
 * offers, and none of it needs this app. Pure function so it's testable.
 */

export interface TourQuestion {
  /** The question to ask, phrased for the doorway. */
  ask: string;
  /** Why this one, tied to the listing: "no laundry mentioned". */
  because: string;
  /** Higher asks first; the list gets truncated to fit the panel. */
  rank: number;
}

/** "1B", "#1F", "G2", "GARDEN" — the unit strings that mean low floor. */
export function looksGroundFloor(unit: string, description = ""): boolean {
  const u = unit.trim().toUpperCase().replace(/^#/, "");
  if (/^(G|GA|GF|GARDEN|BSMT|B)\d*[A-Z]?$/.test(u)) return true;
  if (/^1(?![0-9])/.test(u)) return true; // "1", "1A", "1-B" — not "10C"
  return /ground[\s-]?floor|garden[\s-]?level|garden apartment|basement level/i.test(description);
}

const has = (l: FeedListing, key: AmenityKey) => l.perks.includes(key);

export function tourQuestions(listing: FeedListing, limit = 6): TourQuestion[] {
  const qs: TourQuestion[] = [];
  const ask = (rank: number, ask_: string, because: string) =>
    qs.push({ ask: ask_, because, rank });

  const described =
    (listing.amenities?.length ?? 0) > 0 || (listing.description?.length ?? 0) >= 80;

  // The floor, first: it's the one thing you can't renovate away.
  if (looksGroundFloor(listing.unit, listing.description)) {
    ask(
      96,
      "Who's directly above — bedrooms or someone's living room?",
      `Unit ${listing.unit || "on the ground floor"} reads as ground floor`
    );
    ask(
      74,
      "Do the windows face the street? Check the bars and the foot traffic.",
      "Ground-floor windows are the noise and privacy question"
    );
  }

  if (!has(listing, "laundry_unit") && !has(listing, "laundry_building") && described) {
    ask(
      90,
      "Where's the closest laundromat, and is there hookup space in-unit?",
      "No laundry mentioned in the listing"
    );
  } else if (has(listing, "laundry_building")) {
    ask(
      58,
      "How many machines, where, and do they take a card?",
      "Laundry is in the building, not the unit"
    );
  }

  if (!has(listing, "elevator") && described) {
    ask(
      84,
      "How many flights up, and how tight are the stairs for a couch?",
      "No elevator listed — likely a walk-up"
    );
  }

  if (!has(listing, "air")) {
    ask(
      50,
      "Window units or nothing — what did cooling cost last summer?",
      "No central air listed"
    );
  }

  if (!has(listing, "dishwasher") && described) {
    ask(
      42,
      "Any room in the kitchen to add a dishwasher?",
      "No dishwasher listed"
    );
  }

  if (!has(listing, "light")) {
    ask(
      46,
      "Which way do the windows face? Note where the sun is right now.",
      "The listing doesn't mention light"
    );
  }

  // Deal-shaped questions: suspicious prices and long shelf lives have causes.
  if (listing.dealVerdict === "steal" || listing.dealDelta <= -15) {
    ask(
      88,
      `It's ${Math.abs(listing.dealDelta)}% under the going rate — ask what's wrong. Scaffolding? Noise? Why did the last tenant leave?`,
      "Priced well below comparable listings"
    );
  }
  if (listing.daysOnMarket >= 30) {
    ask(
      68,
      `Why hasn't it gone in ${listing.daysOnMarket} days?`,
      "On the market unusually long"
    );
  }

  if (listing.effectiveRent < listing.price) {
    ask(
      78,
      "Is the free month off the gross or the net — and what does renewal jump to?",
      "Advertised with a concession"
    );
  }

  if (!listing.noFee) {
    ask(
      62,
      "Confirm the broker fee — exact amount, and what it covers.",
      "Listing isn't marked no-fee"
    );
  }

  if (!listing.sqft) {
    ask(
      36,
      "Pace out the bedroom — will the bed and a desk actually fit?",
      "No square footage published"
    );
  }

  if (!listing.imageUrl) {
    ask(
      72,
      "Photograph every room yourself — check what wasn't shown.",
      "The listing posted no photos"
    );
  }

  for (const flag of listing.flags.filter((f) => f.severity === "warn")) {
    ask(94, "See the unit and meet the agent before any money moves.", flag.message.split(".")[0]);
  }

  return qs.sort((a, b) => b.rank - a.rank).slice(0, limit);
}
