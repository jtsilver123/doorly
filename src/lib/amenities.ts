import type { Listing } from "@/types";

/**
 * What you actually get for the money.
 *
 * "Is this a good deal?" was being answered on price alone, which is only half
 * the question. $3,000 for a studio with in-unit laundry, a dishwasher and an
 * elevator is a very different apartment from $3,000 for a fifth-floor walk-up
 * with a shared basement machine — and until now the app called them the same
 * thing.
 *
 * Sources describe the same feature a dozen ways ("Laundry: In Unit", "W/D in
 * unit", "washer/dryer"), so everything is normalised to a small set of things
 * New Yorkers actually trade off. The list is deliberately short: laundry,
 * dishwasher, elevator, outdoor space, light, air conditioning, pets. Listing
 * "Fios Available" next to "Elevator" as though they carry equal weight is how
 * you end up with a wall of badges nobody reads.
 */

export type AmenityKey =
  | "laundry_unit"
  | "laundry_building"
  | "dishwasher"
  | "elevator"
  | "outdoor"
  | "light"
  | "air"
  | "doorman"
  | "pets"
  | "gym";

export interface Amenity {
  key: AmenityKey;
  label: string;
  /**
   * Roughly what New Yorkers pay up for, on a 0-10 scale. Used to judge whether
   * a price is good *for what it is*, not to score apartments absolutely.
   */
  weight: number;
}

export const AMENITIES: Record<AmenityKey, Amenity> = {
  laundry_unit: { key: "laundry_unit", label: "W/D in unit", weight: 10 },
  outdoor: { key: "outdoor", label: "Outdoor space", weight: 8 },
  dishwasher: { key: "dishwasher", label: "Dishwasher", weight: 6 },
  elevator: { key: "elevator", label: "Elevator", weight: 6 },
  light: { key: "light", label: "Good light", weight: 5 },
  laundry_building: { key: "laundry_building", label: "Laundry in building", weight: 4 },
  air: { key: "air", label: "Central air", weight: 4 },
  doorman: { key: "doorman", label: "Doorman", weight: 3 },
  pets: { key: "pets", label: "Pets OK", weight: 3 },
  gym: { key: "gym", label: "Gym", weight: 2 },
};

/** Ordered by how much they move a decision, so the card can take the top few. */
export const AMENITY_ORDER: AmenityKey[] = [
  "laundry_unit",
  "outdoor",
  "dishwasher",
  "elevator",
  "light",
  "laundry_building",
  "air",
  "doorman",
  "pets",
  "gym",
];

const PATTERNS: [AmenityKey, RegExp][] = [
  // In-unit must be tested before the generic laundry match, or every shared
  // basement machine reads as a washer in the kitchen.
  [
    "laundry_unit",
    /laundry:?\s*in[\s-]?unit|in[\s-]?unit laundry|w\/?d in unit|washer\s*(?:and|\/|&)?\s*dryer in|\bwasher\b(?![^.]*\bshared\b)/i,
  ],
  ["laundry_building", /laundry:?\s*(shared|building|on[\s-]?site)|laundry room|laundry in building/i],
  ["dishwasher", /dishwasher|\bd\/?w\b/i],
  ["elevator", /elevator|lift\b/i],
  ["outdoor", /balcon|terrace|patio|private outdoor|backyard|back yard|roof ?deck|garden|\bdeck\b|courtyard/i],
  // Light is described, never listed as a field — these are the words used.
  ["light", /sun[\s-]?(?:lit|drenched|ny)|southern exposure|south[\s-]?facing|great light|natural light|bright|skylight|floor[\s-]?to[\s-]?ceiling|view type|city view|skyline view|(?:oversized|huge|big|large|new|wall of) windows|windows in every room/i],
  ["air", /central air|central a\/?c|\bcac\b/i],
  ["doorman", /doorman|concierge|attended lobby/i],
  ["pets", /pets? (?:ok|allowed|friendly)|dog friendly|cats? ok|dogs? ok/i],
  ["gym", /fitness|\bgym\b/i],
];

/**
 * Yes, no, or the listing never said.
 *
 * These six move NYC decisions more than square footage does, and "not
 * mentioned" is a different fact from "doesn't have one". A walk-up *tells*
 * you there is no elevator; a listing that says nothing about laundry might
 * have a machine on every floor. Collapsing those two into one dash is how a
 * comparison table lies politely.
 *
 * "No" needs explicit words, so it stays rarer than "yes" — which matches how
 * listings are written: brokers advertise what exists and go quiet about what
 * doesn't.
 */
export type AmenityFact = "yes" | "no" | "unknown";

const NEGATIONS: [AmenityKey, RegExp][] = [
  // A walk-up is the one absence brokers do state, because it filters people
  // before the stairs do.
  ["elevator", /walk[\s-]?up|no elevator|non[\s-]?elevator/i],
  ["laundry_unit", /no (?:in[\s-]?unit )?(?:laundry|washer)|laundr[oa]mat (?:nearby|around)/i],
  ["laundry_building", /no laundry in (?:the )?building|no laundry/i],
  ["pets", /no pets|pets? not allowed|sorry,? no (?:dogs|cats|pets)/i],
  ["doorman", /no doorman|non[\s-]?doorman/i],
  ["dishwasher", /no dishwasher/i],
];

/*
 * Hook-ups are plumbing, not appliances. "W/D hookups" reads as an in-unit
 * washer to the pattern above and to nobody who has priced a washer, so it is
 * checked first and downgrades the claim.
 */
const HOOKUPS = /(?:w\/?d|washer(?:\s*(?:and|\/|&)?\s*dryer)?)\s*hook[\s-]?ups?/i;

export function amenityFacts(
  listing: Pick<Listing, "amenities" | "description" | "address">
): Record<AmenityKey, AmenityFact> {
  const haystack = [
    ...(listing.amenities ?? []),
    listing.description ?? "",
    listing.address ?? "",
  ].join(" · ");

  const facts = Object.fromEntries(
    AMENITY_ORDER.map((k) => [k, "unknown"])
  ) as Record<AmenityKey, AmenityFact>;

  for (const [key, pattern] of PATTERNS) {
    if (pattern.test(haystack)) facts[key] = "yes";
  }
  if (facts.laundry_unit === "yes" && HOOKUPS.test(haystack)) {
    // Only the hookup was mentioned: the machine is yours to buy.
    const positive = PATTERNS.find(([k]) => k === "laundry_unit")![1];
    const withoutHookups = haystack.replace(new RegExp(HOOKUPS.source, "gi"), "");
    if (!positive.test(withoutHookups)) facts.laundry_unit = "unknown";
  }
  // Negations override: "no laundry" beats a stray keyword match, because a
  // sentence about absence contains the word it denies.
  for (const [key, pattern] of NEGATIONS) {
    if (pattern.test(haystack)) facts[key] = "no";
  }
  // A stated in-unit washer settles the building question upward.
  if (facts.laundry_unit === "yes" && facts.laundry_building !== "no") {
    facts.laundry_building = "yes";
  }
  return facts;
}

/** Everything a listing tells us, folded into the canonical set. */
export function amenitiesOf(
  listing: Pick<Listing, "amenities" | "description" | "address">
): AmenityKey[] {
  const facts = amenityFacts(listing);
  const found = new Set(
    AMENITY_ORDER.filter((key) => facts[key] === "yes")
  );
  // In-unit laundry implies the building has laundry; saying both is noise.
  if (found.has("laundry_unit")) found.delete("laundry_building");
  return AMENITY_ORDER.filter((key) => found.has(key));
}

/**
 * A 0-100 read on what the apartment offers, before price.
 *
 * Not a quality score for the flat itself — we can't see the floors or hear the
 * street. It's the sum of the features people pay extra for, which is what
 * makes "cheap" meaningful: cheap *with* a washer and an elevator is a find,
 * cheap without them is usually just cheap.
 */
export function qualityScore(keys: AmenityKey[]): number {
  const total = keys.reduce((sum, key) => sum + AMENITIES[key].weight, 0);
  const max = AMENITY_ORDER.reduce((sum, key) => sum + AMENITIES[key].weight, 0);
  return Math.round((total / max) * 100);
}

export type QualityTier = "bare" | "standard" | "well_equipped" | "loaded";

export function tierOf(score: number): QualityTier {
  if (score >= 45) return "loaded";
  if (score >= 25) return "well_equipped";
  if (score >= 10) return "standard";
  return "bare";
}

/**
 * The sentence that answers "is this a good deal?" properly — price *and* what
 * you get, in one line.
 *
 * A place under market with real amenities is the thing worth dropping
 * everything for; under market with nothing is usually under market for a
 * reason, and saying so is more useful than a green badge.
 */
export function dealSentence(
  percentVsMedian: number,
  hasComps: boolean,
  keys: AmenityKey[]
): string {
  const tier = tierOf(qualityScore(keys));
  const top = keys.slice(0, 2).map((k) => AMENITIES[k].label.toLowerCase());

  if (!hasComps) {
    return top.length
      ? `Has ${top.join(" and ")}. Not enough similar listings to price it yet.`
      : "Not enough similar listings to price this yet.";
  }

  const cheap = percentVsMedian <= -8;
  const dear = percentVsMedian >= 11;
  const gap = Math.abs(percentVsMedian);

  if (cheap && (tier === "loaded" || tier === "well_equipped")) {
    return `${gap}% under market and it has ${top.join(" and ")} — this is the kind that goes in a day.`;
  }
  if (cheap && tier === "bare") {
    return `${gap}% under market, but no washer, dishwasher or elevator listed. Cheap for a reason, possibly a walk-up.`;
  }
  if (cheap) {
    return `${gap}% under market${top.length ? `, with ${top.join(" and ")}` : ""}.`;
  }
  if (dear && tier === "bare") {
    return `${gap}% over market with few amenities listed — hard to justify unless the photos win you over.`;
  }
  if (dear) {
    return `${gap}% over market, though it does have ${top.join(" and ")}.`;
  }
  return top.length
    ? `About market rate, with ${top.join(" and ")}.`
    : "About market rate, with no standout amenities listed.";
}
