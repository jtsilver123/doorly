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

  for (const { listing, liked } of signals) {
    const counts = liked ? likeCounts : passCounts;
    if (liked) likes++;
    else passes++;
    for (const token of new Set(features(listing))) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
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
