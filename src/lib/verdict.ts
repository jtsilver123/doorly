import type { FeedListing, SearchCriteria } from "@/types";
import { AMENITIES, type AmenityKey, qualityScore } from "@/lib/amenities";

/**
 * One number, and the reasons behind it.
 *
 * Up to now the app showed two competing scores — a "% match" from the learned
 * preference model and a "% under market" from the comps — and left the renter
 * to reconcile them. That's the wrong job to hand over. Someone scrolling a grid
 * at 11pm wants to know *is this good, yes or no*, and only then why.
 *
 * So: a single 0-100 rating, plus an explicit list of pros and cons. The rating
 * is a weighted sum of things a New Yorker actually trades off, and every
 * component that moves it also produces a line of plain English. Nothing
 * contributes to the number silently — if the score is 41, the cons list says
 * why it's 41.
 *
 * The weights are opinions, not measurements, and they're stated here rather
 * than buried: price against comparable listings matters most, what you get for
 * it comes second, and whether it fits the budget and the calendar come third.
 * Learned taste is deliberately capped low, because it's trained on a handful of
 * clicks and shouldn't be able to overrule an objectively bad price.
 */

const WEIGHTS = {
  price: 30,     // vs. comparable listings
  amenities: 25, // what you actually get
  budget: 18,    // against your ceiling, all-in
  timing: 10,    // free when you need it
  taste: 12,     // learned from your stars and passes
  condition: 5,  // photos, size, fee
} as const;

/** Worst case the risk flags can cost a listing. */
const MAX_RISK_PENALTY = 18;

export type Grade = "excellent" | "strong" | "fair" | "weak";

export interface Verdict {
  /** 1-100. Higher is a better apartment *for this renter*. */
  rating: number;
  grade: Grade;
  /** Two or three words for the badge: "Great deal", "Overpriced". */
  headline: string;
  pros: string[];
  cons: string[];
}

export const GRADE_LABEL: Record<Grade, string> = {
  excellent: "Excellent",
  strong: "Strong",
  fair: "Fair",
  weak: "Weak",
};

export function gradeOf(rating: number): Grade {
  if (rating >= 78) return "excellent";
  if (rating >= 62) return "strong";
  if (rating >= 45) return "fair";
  return "weak";
}

/** Map a value in [lo, hi] onto [0, 1], clamped at both ends. */
function ramp(value: number, lo: number, hi: number): number {
  if (hi === lo) return 0.5;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Score one listing and explain it.
 *
 * `criteria` is the renter's own saved search, so "over budget" means over
 * *their* budget rather than some notional average.
 */
export function verdictFor(listing: FeedListing, criteria: SearchCriteria): Verdict {
  /**
   * Reasons carry a rank, because both lists get truncated to fit the card and
   * a naive push-in-code-order buries the important ones. "$400/mo over budget"
   * must never be cut so that "square footage not listed" can survive.
   */
  const reasons: { text: string; rank: number; good: boolean }[] = [];
  const pro = (rank: number, text: string) => reasons.push({ text, rank, good: true });
  const con = (rank: number, text: string) => reasons.push({ text, rank, good: false });

  let points = 0;
  let available = 0;

  // --- price against comparable listings --------------------------------
  // The single most useful fact, and the one no listing site will tell you.
  if (listing.dealVerdict !== "unknown") {
    available += WEIGHTS.price;
    // -25% or better earns full marks; +15% earns none.
    const share = ramp(-listing.dealDelta, -15, 25);
    points += share * WEIGHTS.price;

    const gap = Math.abs(listing.dealDelta);
    if (listing.dealDelta <= -20) pro(100, `${gap}% below comparable listings`);
    else if (listing.dealDelta <= -8) pro(95, `${gap}% under the going rate`);
    else if (listing.dealDelta >= 15) con(85, `${gap}% above comparable listings`);
    else if (listing.dealDelta >= 8) con(80, `${gap}% over the going rate`);
  }

  // --- what you get for the money ---------------------------------------
  available += WEIGHTS.amenities;
  const quality = qualityScore(listing.perks);
  // 45/100 on the amenity scale is already a well-equipped apartment in NYC —
  // scoring against a theoretical maximum would rate almost everything zero.
  points += ramp(quality, 0, 45) * WEIGHTS.amenities;

  const has = (key: AmenityKey) => listing.perks.includes(key);
  if (has("laundry_unit")) pro(78, "Washer/dryer in the unit");
  else if (has("laundry_building")) pro(45, "Laundry in the building");
  else con(55, "No laundry mentioned");

  if (has("outdoor")) pro(62, "Private outdoor space");
  if (has("dishwasher")) pro(44, "Dishwasher");
  else con(32, "No dishwasher listed");
  if (has("light")) pro(52, "Described as bright");
  if (has("elevator")) pro(42, "Elevator building");
  else if (has("doorman")) pro(38, "Doorman building");
  else con(38, "No elevator — could be a walk-up");
  if (has("pets")) pro(26, "Pets allowed");

  // --- does it fit the budget -------------------------------------------
  // Measured on all-in monthly, so a cheap rent with a fat broker fee can't
  // pass itself off as affordable.
  if (criteria.priceMax > 0) {
    available += WEIGHTS.budget;
    const ratio = listing.allInMonthly / criteria.priceMax;
    // 12% under budget scores full; 10% over scores nothing.
    points += ramp(-ratio, -1.1, -0.88) * WEIGHTS.budget;

    const under = criteria.priceMax - listing.allInMonthly;
    if (under >= criteria.priceMax * 0.08) {
      pro(88, `${money(under)}/mo under your budget, all in`);
    } else if (under < 0) {
      con(100, `${money(-under)}/mo over budget once fees are counted`);
    }
    if (listing.effectiveRent < listing.price) {
      pro(84, `${money(listing.effectiveRent)}/mo effective after free months`);
    }
  }

  // --- will it be free when you need it ----------------------------------
  available += WEIGHTS.timing;
  const timingShare: Record<FeedListing["timing"], number> = {
    ready: 1,
    soon: 0.7,
    unknown: 0.6,
    stale: 0.35,
    late: 0.15,
  };
  points += timingShare[listing.timing] * WEIGHTS.timing;
  if (listing.timing === "ready") pro(70, "Available in time for your move-in");
  if (listing.timing === "late") con(90, listing.timingLabel || "Free too late for your move-in");
  if (listing.timing === "stale") con(48, `On the market ${listing.daysOnMarket} days`);

  // --- learned taste ------------------------------------------------------
  available += WEIGHTS.taste;
  points += ((listing.score ?? 50) / 100) * WEIGHTS.taste;
  if ((listing.score ?? 0) >= 75 && listing.scoreReasons.length) {
    pro(30, `Matches what you've liked: ${listing.scoreReasons[0]}`);
  }

  // --- the small stuff ----------------------------------------------------
  available += WEIGHTS.condition;
  let condition = 0;
  if (listing.noFee) {
    condition += 0.5;
    pro(66, "No broker fee");
  }
  if (listing.imageUrl) condition += 0.25;
  else con(58, "No photos yet");
  if (listing.sqft && listing.sqft >= 600) {
    condition += 0.25;
    pro(34, `${listing.sqft} sq ft`);
  } else if (!listing.sqft) {
    con(12, "Square footage not listed");
  }
  points += Math.min(1, condition) * WEIGHTS.condition;

  // --- risk ---------------------------------------------------------------
  // Flags don't just annotate, they cost the listing points — a suspiciously
  // cheap flat shouldn't win the grid on price alone.
  const warns = listing.flags.filter((f) => f.severity === "warn");
  for (const flag of warns) con(96, flag.message.split(".")[0]);
  const penalty = Math.min(MAX_RISK_PENALTY, warns.length * 12);

  if (!listing.isActive) con(99, "No longer listed");

  // Normalise against what we could actually judge, so a listing with no comps
  // isn't punished for our missing data.
  const base = available > 0 ? (points / available) * 100 : 50;
  const rating = Math.max(1, Math.min(100, Math.round(base - penalty)));

  const ranked = [...reasons].sort((a, b) => b.rank - a.rank);

  return {
    rating,
    grade: gradeOf(rating),
    headline: headlineFor(rating, listing),
    pros: ranked.filter((r) => r.good).slice(0, 4).map((r) => r.text),
    cons: ranked.filter((r) => !r.good).slice(0, 4).map((r) => r.text),
  };
}

/** The two or three words that go on the badge. */
function headlineFor(rating: number, listing: FeedListing): string {
  if (listing.flags.some((f) => f.kind === "too-cheap")) return "Verify first";
  if (rating >= 85) return "Go see it today";
  if (rating >= 78) return "Great find";
  if (rating >= 70) return "Worth a tour";
  if (rating >= 62) return "Solid option";
  if (rating >= 45) return "Decent, some trade-offs";
  if (listing.dealDelta >= 10) return "Overpriced for what it is";
  return "Probably skip";
}

/** The amenity chips shown on a card, richest first, capped so they stay read. */
export function topAmenities(keys: AmenityKey[], limit = 3) {
  return keys.slice(0, limit).map((key) => AMENITIES[key]);
}
