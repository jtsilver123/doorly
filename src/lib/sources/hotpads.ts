import type { Listing, SearchCriteria } from "@/types";
import { realtyGet } from "@/lib/realtyapi";
import { loadConfig } from "@/lib/apikey";
import { getAreas, boroughFor, canonicalNeighborhood } from "@/lib/areas";
import { extractUnit } from "@/lib/dedupe";

/**
 * HotPads via realtyapi.io.
 *
 * Zillow-owned, but its rental feed is not identical to Zillow's: it carries
 * broker-exclusive listings and full amenity lists, and its titles include the
 * unit number ("255 W 14th St #5A") which makes cross-site dedupe much easier.
 *
 * This is also the closest available stand-in for Apartments.com, which is
 * CoStar-owned, has no API on this key, and hard-403s direct requests.
 */

interface HotPadsListing {
  listing_id?: string;
  building_id?: string;
  property_type?: string;
  name?: string;
  title?: string;
  uri_malone?: string;
  price?: number;
  price_high?: number;
  beds?: number;
  baths?: number;
  is_active?: boolean;
  photos?: string[];
  amenities?: string[];
  description?: string;
  sqft?: number;
  contact_phone?: string;
  broker_name?: string;
  available_date?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    latitude?: number;
    longitude?: number;
  };
}

interface HotPadsResponse {
  total?: number;
  searchResults?: HotPadsListing[];
}

const NO_FEE_RE = /no\s*fee/i;

export function normalizeHotPads(rows: HotPadsListing[], areaLabel = ""): Listing[] {
  const out: Listing[] = [];

  for (const row of rows) {
    if (!row.listing_id) continue;
    if (row.is_active === false) continue;
    const price = row.price ?? row.price_high ?? 0;
    if (!price || price <= 0) continue;

    const street = row.address?.street ?? row.name ?? "";
    // The title usually carries the unit: "255 W 14th St #5A".
    const unit = extractUnit(row.title, street);
    const amenities = row.amenities ?? [];
    const amenityBlob = amenities.join(" ");

    const neighborhood =
      canonicalNeighborhood(`${row.name ?? ""} ${street}`) || areaLabel;
    const borough = boroughFor(`${neighborhood} ${street} ${row.address?.city ?? ""}`);

    out.push({
      id: `hotpads-${row.listing_id}`,
      source: "hotpads",
      sourceId: row.listing_id,
      url: row.uri_malone
        ? `https://hotpads.com${row.uri_malone}`
        : `https://hotpads.com/search?q=${encodeURIComponent(street)}`,
      price: Math.round(price),
      bedrooms: row.beds ?? 0,
      bathrooms: row.baths ?? 1,
      sqft: row.sqft && row.sqft > 0 ? row.sqft : null,
      neighborhood,
      borough,
      address: street,
      unit,
      lat: row.address?.latitude ?? null,
      lon: row.address?.longitude ?? null,
      imageUrl: row.photos?.[0] ?? null,
      availableAt: null,
      noFee: NO_FEE_RE.test(amenityBlob) || NO_FEE_RE.test(row.title ?? ""),
      amenities,
      buildingType: row.property_type ?? "",
      listingStatus: "ACTIVE",
      description: row.description ?? "",
      contactPhone: row.contact_phone ?? "",
      contactName: row.broker_name ?? row.name ?? "",
      contactEmail: "",
      monthsFree: 0,
      leaseMonths: 12,
      netEffectiveRent: null,
      availableText: row.available_date ?? "",
    });
  }

  return out;
}


export async function fetchHotPads(c: SearchCriteria): Promise<Listing[]> {
  // Pages per source is the main lever on the monthly request budget;
  // sorted by newest, one page already catches everything fresh.
  const PAGES = (await loadConfig()).pagesPerSource;
  const byId = new Map<string, Listing>();
  const bedsRange = `${c.bedMin}-${c.bedMax ?? 8}`;

  for (const area of getAreas(c.areas)) {
    const pages = await Promise.allSettled(
      Array.from({ length: PAGES }, (_, i) =>
        realtyGet<HotPadsResponse>("hotpads", "/search/bylocation", {
          location: area.hotpads,
          priceRange: `${c.priceMin}-${c.priceMax}`,
          bedsRange,
          resultCount: 100,
          page: i + 1,
          sortOrder: "Newest",
        })
      )
    );

    const label = area.isBorough ? "" : area.label;

    for (const page of pages) {
      if (page.status !== "fulfilled") continue;
      for (const listing of normalizeHotPads(page.value?.searchResults ?? [], label)) {
        byId.set(listing.id, listing);
      }
    }
  }

  return [...byId.values()];
}
