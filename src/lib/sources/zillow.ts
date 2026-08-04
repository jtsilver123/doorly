import type { Listing, SearchCriteria } from "@/types";
import { realtyGet } from "@/lib/realtyapi";
import { loadConfig } from "@/lib/apikey";
import { getAreas, boroughFor, canonicalNeighborhood } from "@/lib/areas";
import { extractUnit } from "@/lib/dedupe";
import { toPrice, toNum } from "@/lib/parse";

/**
 * Zillow via realtyapi.io.
 *
 * Results arrive in two shapes:
 *   resultType "property"       one unit, with real beds/baths/sqft/rent
 *   resultType "propertyGroup"  a whole building, with a price *range* and a
 *                               list of available unit types
 *
 * Groups are kept but flattened to their cheapest matching unit type, because a
 * building with 7 available units is still a lead worth tracking — it just
 * can't be priced precisely until you call them.
 */

interface ZillowAddress {
  streetAddress?: string;
  zipcode?: string;
  city?: string;
  state?: string;
}

interface ZillowUnit {
  bedrooms?: number;
  minPrice?: unknown;
  price?: unknown;
}

interface ZillowProperty {
  zpid?: number | string;
  location?: { latitude?: number; longitude?: number };
  address?: ZillowAddress;
  title?: string;
  bedrooms?: number;
  bathrooms?: number;
  livingArea?: number;
  price?: unknown;   // number | { value: number } depending on result
  minPrice?: unknown;
  maxPrice?: unknown;
  listingStatus?: string;
  propertyType?: string;
  unitsGroup?: ZillowUnit[];
  matchingHomeCount?: number;
  rental?: { baseRent?: number };
  media?: {
    propertyPhotoLinks?: { highResolutionLink?: string; mediumSizeLink?: string };
  };
  listCardRecommendation?: {
    ctaRecommendations?: { displayString?: string; contentType?: string }[];
  };
}

interface ZillowResult {
  property?: ZillowProperty;
  resultType?: string;
}

interface ZillowResponse {
  searchResults?: ZillowResult[];
  pagesInfo?: { totalPages?: number; currentPage?: number };
}

const BED_ENUM = ["No_Min", "Studio", "1", "2", "3", "4", "5"];

function bedMinParam(bedMin: number): string {
  if (bedMin <= 0) return "No_Min";
  return BED_ENUM[Math.min(bedMin + 1, BED_ENUM.length - 1)] ?? "No_Min";
}


/** Phone number Zillow surfaces on the card — the "reach out" shortcut. */
function phoneOf(p: ZillowProperty): string {
  const ctas = p.listCardRecommendation?.ctaRecommendations ?? [];
  const phone = ctas.find((c) => c.contentType === "PHONE")?.displayString;
  return phone ?? "";
}

/**
 * @param areaLabel the neighborhood we asked Zillow for. Zillow returns no
 *   neighborhood field at all, so without this every result would fail the
 *   criteria post-filter. We queried it by area, so the area is the answer.
 */
export function normalizeZillow(
  results: ZillowResult[],
  c: SearchCriteria,
  areaLabel = ""
): Listing[] {
  const out: Listing[] = [];

  for (const result of results) {
    const p = result?.property;
    if (!p?.zpid) continue;

    const street = p.address?.streetAddress ?? "";
    const isGroup = result.resultType === "propertyGroup";

    // Pick the cheapest unit type that still satisfies the bed floor, so a
    // 3BR-only building doesn't get logged at its studio price.
    let bedrooms = p.bedrooms ?? 0;
    // baseRent first: it is always a clean number, while `price` is sometimes
    // an object wrapper.
    let price = toPrice(p.rental?.baseRent, p.price, p.minPrice);

    if (isGroup) {
      const units = (p.unitsGroup ?? []).filter(
        (u) => (u.bedrooms ?? 0) >= c.bedMin && (c.bedMax == null || (u.bedrooms ?? 0) <= c.bedMax)
      );
      const cheapest = units
        .map((u) => ({ beds: u.bedrooms ?? 0, price: toPrice(u.minPrice, u.price) }))
        .filter((u): u is { beds: number; price: number } => u.price != null)
        .sort((a, b) => a.price - b.price)[0];
      if (!cheapest) continue;
      bedrooms = cheapest.beds;
      price = cheapest.price;
    }

    if (price == null) continue;

    const neighborhood =
      canonicalNeighborhood(`${p.title ?? ""} ${street}`) || areaLabel;
    const borough = boroughFor(`${neighborhood} ${street} ${p.address?.city ?? ""}`);
    const photo =
      p.media?.propertyPhotoLinks?.highResolutionLink ??
      p.media?.propertyPhotoLinks?.mediumSizeLink ??
      null;

    const phone = phoneOf(p);
    const notes: string[] = [];
    if (isGroup && p.matchingHomeCount) notes.push(`${p.matchingHomeCount} units available`);
    if (phone) notes.push(`Leasing office: ${phone}`);

    out.push({
      id: `zillow-${p.zpid}`,
      source: "zillow",
      sourceId: String(p.zpid),
      url: `https://www.zillow.com/homedetails/${p.zpid}_zpid/`,
      price,
      bedrooms,
      bathrooms: toNum(p.bathrooms) ?? 1,
      sqft: (toNum(p.livingArea) ?? 0) > 0 ? (toNum(p.livingArea) as number) : null,
      neighborhood,
      borough,
      address: street,
      unit: extractUnit(street),
      lat: p.location?.latitude ?? null,
      lon: p.location?.longitude ?? null,
      imageUrl: photo,
      availableAt: null,
      noFee: false,
      amenities: [],
      buildingType: p.propertyType ?? (isGroup ? "apartmentComplex" : ""),
      listingStatus: p.listingStatus === "forRent" ? "ACTIVE" : (p.listingStatus ?? "ACTIVE"),
      description: notes.join(" · "),
      contactPhone: phone,
      contactName: p.title ?? "",
      contactEmail: "",
      availableText: "",
    });
  }

  return out;
}


export async function fetchZillow(c: SearchCriteria): Promise<Listing[]> {
  // Pages per source is the main lever on the monthly request budget;
  // sorted by newest, one page already catches everything fresh.
  const MAX_PAGES = (await loadConfig()).pagesPerSource;
  const byId = new Map<string, Listing>();

  for (const area of getAreas(c.areas)) {
    const pages = await Promise.allSettled(
      Array.from({ length: MAX_PAGES }, (_, i) =>
        realtyGet<ZillowResponse>("zillow", "/search/byaddress", {
          location: area.zillow,
          listingStatus: "For_Rent",
          bed_min: bedMinParam(c.bedMin),
          listPriceRange: `${c.priceMin}-${c.priceMax}`,
          sortOrder: "Newest",
          page: i + 1,
        })
      )
    );

    // Whole-borough searches must not stamp every result "Manhattan" as if it
    // were a neighborhood; only narrow area queries carry a usable label.
    const label = area.isBorough ? "" : area.label;

    for (const page of pages) {
      if (page.status !== "fulfilled") continue;
      for (const listing of normalizeZillow(page.value?.searchResults ?? [], c, label)) {
        byId.set(listing.id, listing);
      }
    }
  }

  return [...byId.values()];
}

/**
 * Zillow's own price history for one listing. Richer than our observed history
 * because it predates the first time we ever saw the place.
 */
export async function fetchZillowPriceHistory(
  zpid: string
): Promise<{ date: string; price: number; event: string }[]> {
  try {
    const body = await realtyGet<{ priceHistory?: unknown[] }>(
      "zillow",
      "/pricehistory",
      { byzpid: zpid }
    );
    const rows = (body?.priceHistory ?? []) as Record<string, unknown>[];
    return rows
      .map((r) => ({
        date: String(r.date ?? r.time ?? ""),
        price: Number(r.price ?? r.priceChangeRate ?? 0),
        event: String(r.event ?? ""),
      }))
      .filter((r) => r.date && r.price > 0);
  } catch {
    return [];
  }
}
