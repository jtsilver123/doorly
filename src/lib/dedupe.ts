import type { Listing } from "@/types";

/**
 * Cross-site identity.
 *
 * The same apartment shows up on StreetEasy as "123 West 45th Street #4B" and on
 * Craigslist as "123 W 45 St - Apt 4b" with a different price and no unit field
 * at all. Matching on the raw address never works, so we reduce it to a
 * canonical key and match on that.
 */

const SUFFIXES: Record<string, string> = {
  street: "st", st: "st",
  avenue: "ave", ave: "ave", av: "ave",
  boulevard: "blvd", blvd: "blvd",
  place: "pl", pl: "pl",
  road: "rd", rd: "rd",
  drive: "dr", dr: "dr",
  court: "ct", ct: "ct",
  terrace: "ter", ter: "ter",
  parkway: "pkwy", pkwy: "pkwy",
  lane: "ln", ln: "ln",
  square: "sq", sq: "sq",
  plaza: "plz", plz: "plz",
};

const DIRECTIONS: Record<string, string> = {
  west: "w", w: "w",
  east: "e", e: "e",
  north: "n", n: "n",
  south: "s", s: "s",
};

const NOISE = new Set([
  "new", "york", "ny", "nyc", "brooklyn", "queens", "bronx", "manhattan",
  "apt", "apartment", "unit", "the",
]);

const UNIT_RE =
  /(?:#|\b(?:apt|apartment|unit|ste|suite)\.?\s*)([0-9]{1,4}[a-z]?|[a-z][0-9]{0,3})\b/i;

/** Pull a unit designator out of an address or title. "123 Main St #4B" -> "4B". */
export function extractUnit(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = UNIT_RE.exec(candidate);
    if (match) return match[1].toUpperCase();
  }
  return "";
}

/**
 * Canonical street form: "123 West 45th Street, Brooklyn NY" -> "123 w 45 st".
 * Drops unit, city, punctuation, and ordinal suffixes.
 */
export function streetKey(address: string): string {
  if (!address) return "";
  let text = address.toLowerCase();
  text = text.replace(UNIT_RE, " ");
  text = text.split(",")[0];
  text = text.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1"); // 45th -> 45
  text = text.replace(/[^a-z0-9\s]/g, " ");

  const out: string[] = [];
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    if (NOISE.has(token)) continue;
    out.push(DIRECTIONS[token] ?? SUFFIXES[token] ?? token);
  }
  return out.join(" ").trim();
}

/**
 * Does this look like a real street address?
 *
 * "Contains a digit" is not enough: New York listing titles are full of numbers
 * that aren't addresses — "Sunny 1BR", "24hr doorman", "2 bath". A street
 * address begins with a house number followed by a word, so that's what we
 * check. Getting this wrong in either direction is costly: too loose and
 * unrelated Craigslist posts merge into one apartment, too strict and real
 * addresses stop matching across sites.
 */
export function hasStreetNumber(address: string): boolean {
  return /^\s*\d{1,5}[a-z]?\s+\S/i.test(address.trim());
}

/**
 * The dedupe key. Two listings sharing a fingerprint are treated as the same
 * apartment even if they came from different sites at different prices.
 *
 * Deliberately excludes price — a price drop must not fork a listing in two.
 * Falls back to the source-unique id when there's no usable address, so
 * unaddressed listings (common on Craigslist) never collapse into each other.
 */
export function fingerprint(listing: Listing): string {
  const street = streetKey(listing.address);
  if (!street || !hasStreetNumber(listing.address)) {
    // No street number means we can't safely match it to anything.
    return `id:${listing.source}-${listing.sourceId}`;
  }
  const unit = (listing.unit || extractUnit(listing.address)).toUpperCase();
  const beds = Number.isFinite(listing.bedrooms) ? listing.bedrooms : 0;
  return unit ? `${street}|${unit}|${beds}` : `${street}||${beds}`;
}

/**
 * Confidence that two listings are the same apartment, for the case where
 * fingerprints differ only because one side is missing a unit number.
 * Returns 0..1; callers merge above ~0.8.
 */
export function matchConfidence(a: Listing, b: Listing): number {
  const streetA = streetKey(a.address);
  const streetB = streetKey(b.address);
  if (!streetA || streetA !== streetB) return 0;
  if (a.bedrooms !== b.bedrooms) return 0;

  const unitA = (a.unit || extractUnit(a.address)).toUpperCase();
  const unitB = (b.unit || extractUnit(b.address)).toUpperCase();

  // Both have units and they disagree: different apartments in one building.
  if (unitA && unitB && unitA !== unitB) return 0;

  let score = 0.6; // same building, same bed count
  if (unitA && unitB && unitA === unitB) score += 0.3;

  const spread = Math.abs(a.price - b.price) / Math.max(a.price, b.price, 1);
  if (spread < 0.02) score += 0.15;
  else if (spread < 0.1) score += 0.05;
  else if (spread > 0.35) score -= 0.3;

  if (a.sqft && b.sqft) {
    const sqftSpread = Math.abs(a.sqft - b.sqft) / Math.max(a.sqft, b.sqft);
    if (sqftSpread < 0.1) score += 0.1;
    else if (sqftSpread > 0.3) score -= 0.2;
  }

  return Math.max(0, Math.min(1, score));
}

/** Hash of the fields worth diffing. A change here becomes a timeline event. */
export function contentHash(listing: Listing): string {
  const material = JSON.stringify({
    price: listing.price,
    status: listing.listingStatus,
    beds: listing.bedrooms,
    baths: listing.bathrooms,
    sqft: listing.sqft,
    noFee: listing.noFee,
    available: listing.availableAt,
    description: listing.description.trim().toLowerCase().slice(0, 2000),
  });

  // Small, dependency-free 52-bit hash. Collisions here only cost us a missed
  // "details changed" event, never a wrong price or a lost listing.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < material.length; i++) {
    const ch = material.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
