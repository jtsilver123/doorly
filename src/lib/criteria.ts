import type { Listing, SearchCriteria, Source } from "@/types";
import { neighborhoodFilter } from "@/lib/areas";
import { withinAreas } from "@/lib/geo";

/**
 * Jake's search: studio or 1BR around $3,500 in the West Village, East Village,
 * Chelsea or Flatiron. The band runs to $4,000 on purpose — asking prices move,
 * and a $3,800 listing that drops is exactly what this app exists to catch.
 */
export const DEFAULT_CRITERIA: SearchCriteria = {
  areas: ["west-village", "east-village", "chelsea", "flatiron"],
  bedMin: 0,
  bedMax: 1,
  priceMin: 2000,
  priceMax: 4000,
  sources: ["streeteasy", "zillow", "apartments", "hotpads", "craigslist"],
  noFeeOnly: false,
};

/**
 * Deterministic canonical key for a set of criteria. Identical searches — yours
 * and a friend's — collapse to one scrape instead of two. Human-readable on
 * purpose, so it's debuggable straight from the database.
 */
export function searchKey(c: SearchCriteria): string {
  const areas = [...c.areas].sort().join(",");
  const sources = [...c.sources].sort().join("+");
  const max = c.bedMax == null ? "" : c.bedMax;
  const fee = c.noFeeOnly ? "|nofee" : "";
  return `${areas}|beds:${c.bedMin}-${max}|price:${c.priceMin}-${c.priceMax}|src:${sources}${fee}`;
}

export function criteriaSummary(c: SearchCriteria, areaLabels: string[]): string {
  const beds =
    c.bedMax == null
      ? `${c.bedMin}BR+`
      : c.bedMin === c.bedMax
        ? c.bedMin === 0
          ? "Studio"
          : `${c.bedMin}BR`
        : `${c.bedMin}–${c.bedMax}BR`;
  const price = `$${c.priceMin.toLocaleString()}–$${c.priceMax.toLocaleString()}`;
  const where = areaLabels.length ? areaLabels.join(", ") : "NYC";
  return [beds, price, where, c.noFeeOnly ? "no fee" : ""].filter(Boolean).join(" · ");
}

/**
 * Post-filter. Sources apply criteria loosely (Craigslist can only search a
 * whole borough, Zillow rounds bed counts), so everything gets re-checked here
 * before it reaches the database.
 */
export function inBounds(listing: Listing, c: SearchCriteria): boolean {
  // Explicit finiteness check first. A NaN price would otherwise pass both
  // comparisons below, since every comparison against NaN is false.
  if (!Number.isFinite(listing.price) || listing.price <= 0) return false;
  if (!Number.isFinite(listing.bedrooms)) return false;

  if (listing.price < c.priceMin || listing.price > c.priceMax) return false;
  if (listing.bedrooms < c.bedMin) return false;
  if (c.bedMax != null && listing.bedrooms > c.bedMax) return false;
  if (c.noFeeOnly && !listing.noFee) return false;

  const hoods = neighborhoodFilter(c.areas);
  if (hoods.size === 0) return true; // whole-borough search: everything qualifies

  const names = [...hoods];

  // Coordinates first. They're the only signal that survives a borough-wide
  // query, and they don't care that Zillow writes "West Village, Manhattan, NY"
  // while Craigslist writes "w village".
  if (listing.lat != null && listing.lon != null) {
    return withinAreas(listing.lat, listing.lon, names);
  }

  // No coordinates (Craigslist, mostly): fall back to matching the text.
  const haystack = `${listing.neighborhood} ${listing.address}`.toLowerCase();
  return names.some((hood) => haystack.includes(hood));
}

export function normalizeCriteria(input: Partial<SearchCriteria>): SearchCriteria {
  const merged = { ...DEFAULT_CRITERIA, ...input };
  const bedMin = clamp(Math.floor(merged.bedMin ?? 0), 0, 8);
  const bedMax =
    merged.bedMax == null ? null : clamp(Math.floor(merged.bedMax), bedMin, 8);
  const priceMin = clamp(Math.floor(merged.priceMin ?? 0), 0, 100_000);
  const priceMax = clamp(Math.floor(merged.priceMax ?? 0), priceMin || 1, 100_000);
  const areas = (merged.areas ?? []).filter(Boolean);
  const sources = (merged.sources ?? []).filter(Boolean) as Source[];

  return {
    areas: areas.length ? areas : DEFAULT_CRITERIA.areas,
    bedMin,
    bedMax,
    priceMin,
    priceMax,
    sources: sources.length ? sources : DEFAULT_CRITERIA.sources,
    noFeeOnly: Boolean(merged.noFeeOnly),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
