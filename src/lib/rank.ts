import type { Listing, SearchCriteria, Stage } from "@/types";

/**
 * Learning what you like.
 *
 * A deliberately small, explainable model rather than anything clever: every
 * listing is reduced to a handful of categorical tokens ("hood:West Village",
 * "price:3250-3500", "nofee:yes"), and each token carries a weight learned from
 * how you've reacted to listings carrying it. Score is the summed log-odds,
 * squashed to 0-100.
 *
 * Why this shape:
 *   - it explains itself. Every score decomposes into named reasons, which is
 *     what makes the ranking trustworthy enough to act on.
 *   - it works from ~5 examples. Laplace smoothing keeps early weights sane
 *     instead of letting one thumbs-down blackball a whole neighborhood.
 *   - it needs no dependencies and retrains in milliseconds on a laptop.
 */

export interface Signal {
  listing: Listing;
  liked: boolean;
  /** Why it was passed on, when the pass said. See `PASS_REASONS`. */
  reasons?: string[];
}

/**
 * Why a place was passed on, and what that actually teaches.
 *
 * A pass with no reason has to be read as "something about this listing was
 * wrong", so every one of its tokens takes the hit. That is the honest reading
 * of no information, and it is also how a model quietly poisons itself: pass a
 * $4,200 West Village studio because it costs too much, and the model learns
 * you dislike the West Village. Do that four times and the neighborhood you
 * most want stops surfacing.
 *
 * A reason says which part was wrong, so the negative lands only on the
 * tokens it implicates and everything else on the listing stays neutral.
 *
 * Two of these teach nothing, and that is a real answer rather than a gap:
 * a place that is already rented says nothing about taste, and a bad layout
 * is a fact about a floor plan this model has no token for. Training on
 * either would move weights that had nothing to do with the decision, so
 * those passes are dropped from training instead. They still leave the
 * pipeline; they just don't pretend to be a preference.
 */
export const PASS_REASONS: {
  code: string;
  label: string;
  /** Token prefixes this reason implicates. Empty means it teaches nothing. */
  families: string[];
}[] = [
  { code: "price", label: "Too expensive", families: ["price"] },
  { code: "area", label: "Wrong neighborhood", families: ["hood", "borough"] },
  { code: "size", label: "Too small", families: ["sqft", "beds"] },
  { code: "amenities", label: "Missing what I need", families: ["amenity", "baths"] },
  { code: "fee", label: "Broker fee", families: ["nofee"] },
  { code: "listing", label: "Listing tells me nothing", families: ["photos", "source"] },
  { code: "building", label: "Building looks rough", families: [] },
  { code: "layout", label: "Bad layout", families: [] },
  { code: "gone", label: "Already gone", families: [] },
];

const BY_CODE = new Map(PASS_REASONS.map((r) => [r.code, r]));

/**
 * Which tokens a pass should count against, or null when it should not be
 * trained on at all.
 */
function blamedTokens(tokens: string[], reasons: string[] | undefined): string[] | null {
  if (!reasons?.length) return tokens; // no reason given: blame the whole listing
  const families = new Set<string>();
  for (const code of reasons) {
    for (const family of BY_CODE.get(code)?.families ?? []) families.add(family);
  }
  // Every reason given was one this model has no token for. Training on it
  // would move weights that had nothing to do with the decision.
  if (!families.size) return null;
  return tokens.filter((t) => families.has(t.split(":")[0]));
}

export interface Model {
  weights: Record<string, number>;
  likes: number;
  passes: number;
  trained: boolean;
}

export interface Scored {
  score: number;
  reasons: string[];
}

/** Stages that imply approval even without an explicit thumbs-up. */
const POSITIVE_STAGES: Stage[] = ["interested", "contacted", "tour", "toured", "applied"];

export function stageImpliesLike(stage: Stage): boolean | null {
  if (POSITIVE_STAGES.includes(stage)) return true;
  // Both kinds of no: dismissed unseen, or toured and declined. The second is
  // arguably a *stronger* signal — the photos passed and the reality didn't.
  if (stage === "passed" || stage === "no_go") return false;
  return null;
}

function priceBucket(price: number): string {
  const step = 250;
  const low = Math.floor(price / step) * step;
  return `price:${low}-${low + step}`;
}

function sqftBucket(sqft: number | null): string | null {
  if (!sqft) return null;
  if (sqft < 400) return "sqft:under-400";
  if (sqft < 600) return "sqft:400-600";
  if (sqft < 800) return "sqft:600-800";
  return "sqft:800-plus";
}

/** Reduce a listing to the tokens the model reasons over. */
export function features(listing: Listing): string[] {
  const tokens: string[] = [];

  if (listing.neighborhood) tokens.push(`hood:${listing.neighborhood}`);
  if (listing.borough) tokens.push(`borough:${listing.borough}`);
  tokens.push(`beds:${listing.bedrooms}`);
  tokens.push(`baths:${Math.round(listing.bathrooms)}`);
  tokens.push(priceBucket(listing.price));
  tokens.push(`source:${listing.source}`);
  tokens.push(listing.noFee ? "nofee:yes" : "nofee:no");
  tokens.push(listing.imageUrl ? "photos:yes" : "photos:no");

  const sqft = sqftBucket(listing.sqft);
  if (sqft) tokens.push(sqft);

  const amenityBlob = `${listing.amenities.join(" ")} ${listing.description}`.toLowerCase();
  for (const [token, needles] of Object.entries({
    "amenity:laundry": ["laundry", "washer", "w/d"],
    "amenity:elevator": ["elevator"],
    "amenity:outdoor": ["balcony", "terrace", "patio", "roof deck", "backyard"],
    "amenity:doorman": ["doorman", "concierge"],
    "amenity:gym": ["fitness", "gym"],
    "amenity:dishwasher": ["dishwasher"],
    "amenity:pets": ["pet friendly", "pets allowed", "dogs ok", "cats ok"],
  })) {
    if (needles.some((n) => amenityBlob.includes(n))) tokens.push(token);
  }

  return tokens;
}

/**
 * Count how often each token appears among liked vs passed listings and turn
 * that into a log-odds weight. Smoothing (+1 / +2) keeps a token seen once from
 * dominating.
 */
export function train(signals: Signal[]): Model {
  const likeCounts = new Map<string, number>();
  const passCounts = new Map<string, number>();
  let likes = 0;
  let passes = 0;

  for (const { listing, liked, reasons } of signals) {
    const tokens = [...new Set(features(listing))];

    if (liked) {
      likes++;
      for (const token of tokens) likeCounts.set(token, (likeCounts.get(token) ?? 0) + 1);
      continue;
    }

    const blamed = blamedTokens(tokens, reasons);
    // A pass we can't learn anything from doesn't get to shift the totals
    // either — counting it would drag every weight toward "pass" through the
    // smoothing denominator without ever saying what was wrong.
    if (blamed === null) continue;
    passes++;
    for (const token of blamed) passCounts.set(token, (passCounts.get(token) ?? 0) + 1);
  }

  const weights: Record<string, number> = {};
  const tokens = new Set([...likeCounts.keys(), ...passCounts.keys()]);
  for (const token of tokens) {
    const pLike = ((likeCounts.get(token) ?? 0) + 1) / (likes + 2);
    const pPass = ((passCounts.get(token) ?? 0) + 1) / (passes + 2);
    weights[token] = Math.log(pLike / pPass);
  }

  // Two examples is not a preference. Below that we stay on the cold-start
  // heuristic rather than pretending to have learned something.
  return { weights, likes, passes, trained: likes >= 2 && likes + passes >= 3 };
}

const PRETTY: Record<string, string> = {
  hood: "neighborhood",
  borough: "borough",
  beds: "bedrooms",
  baths: "bathrooms",
  price: "price",
  source: "listing site",
  nofee: "no broker fee",
  photos: "has photos",
  sqft: "size",
  amenity: "amenity",
};

function describe(token: string, weight: number): string {
  const [kind, ...rest] = token.split(":");
  const value = rest.join(":");
  const label = PRETTY[kind] ?? kind;
  const direction = weight > 0 ? "likes" : "avoids";

  if (kind === "nofee") return weight > 0 ? "no broker fee" : "has a broker fee";
  if (kind === "photos") return weight > 0 ? "has photos" : "no photos";
  if (kind === "amenity") return `${direction === "likes" ? "" : "no "}${value}`;
  if (kind === "price") return `${direction} the $${value.replace("-", "–$")} range`;
  return `${direction} ${label} ${value}`;
}

/** Cold start: no feedback yet, so rank on the criteria themselves. */
function heuristicScore(listing: Listing, criteria: SearchCriteria): Scored {
  const reasons: string[] = [];
  let score = 50;

  const span = Math.max(criteria.priceMax - criteria.priceMin, 1);
  const position = (listing.price - criteria.priceMin) / span;
  const priceBonus = Math.round((1 - position) * 25);
  score += priceBonus;
  if (priceBonus >= 15) reasons.push(`well under your $${criteria.priceMax.toLocaleString()} ceiling`);

  if (listing.noFee) {
    score += 10;
    reasons.push("no broker fee");
  }
  if (listing.sqft && listing.sqft >= 600) {
    score += 8;
    reasons.push(`${listing.sqft} sq ft`);
  }
  if (listing.imageUrl) score += 4;
  else reasons.push("no photos yet");

  if (!reasons.length) reasons.push("matches your search");
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons: reasons.slice(0, 3) };
}

export function score(
  listing: Listing,
  model: Model,
  criteria: SearchCriteria
): Scored {
  if (!model.trained) return heuristicScore(listing, criteria);

  const contributions: { token: string; weight: number }[] = [];
  let total = 0;
  for (const token of new Set(features(listing))) {
    const weight = model.weights[token];
    if (weight === undefined || Math.abs(weight) < 0.05) continue;
    total += weight;
    contributions.push({ token, weight });
  }

  // Squash. The /2 keeps a handful of agreeing tokens from pinning every
  // listing at 0 or 100.
  const probability = 1 / (1 + Math.exp(-total / 2));

  contributions.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const reasons = contributions.slice(0, 3).map((c) => describe(c.token, c.weight));
  if (!reasons.length) reasons.push("nothing distinctive either way");

  return { score: Math.round(probability * 100), reasons };
}
