import type { Listing, SearchCriteria } from "@/types";
import { realtyGet, POLL_PAGE_CAP } from "@/lib/realtyapi";
import { loadConfig } from "@/lib/apikey";
import { queryScopes, boroughFor, canonicalNeighborhood } from "@/lib/areas";
import { extractUnit } from "@/lib/dedupe";
import { locate } from "@/lib/geo";
import { addressSansUnit, toPrice, toNum } from "@/lib/parse";

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
    allPropertyPhotos?: { highResolution?: string[] };
  };
  carouselPhotos?: { url?: string }[];
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

/** Zillow's own spelling of the same "N or more" idea. */
function bathParam(bathMin: number): string {
  if (bathMin <= 0) return "Any";
  if (bathMin <= 1) return "OnePlus";
  if (bathMin <= 1.5) return "OneHalfPlus";
  if (bathMin <= 2) return "TwoPlus";
  if (bathMin <= 3) return "ThreePlus";
  return "FourPlus";
}

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

    // Coordinates beat both the title text and the queried label: they're the
    // only signal that still works when one borough query covers four areas.
    const located = locate(p.location?.latitude, p.location?.longitude);
    const neighborhood =
      located.neighborhood ||
      canonicalNeighborhood(`${p.title ?? ""} ${street}`) ||
      areaLabel;
    const borough =
      located.borough || boroughFor(`${neighborhood} ${street} ${p.address?.city ?? ""}`);
    const photo =
      p.media?.propertyPhotoLinks?.highResolutionLink ??
      p.media?.propertyPhotoLinks?.mediumSizeLink ??
      null;
    // Zillow sometimes ships the whole carousel on search rows; take it when
    // it's there, fall back to the single lead photo when it isn't.
    const photos = [
      ...(p.media?.allPropertyPhotos?.highResolution ?? []),
      ...(p.carouselPhotos ?? [])
        .map((c) => c.url)
        .filter((u): u is string => Boolean(u)),
    ];
    if (!photos.length && photo) photos.push(photo);

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
      // "312 W 23rd St APT 4M" plus unit "4M" printed the unit twice on
      // every renderer; the clause lives in the unit field alone.
      address: addressSansUnit(street, extractUnit(street)),
      unit: extractUnit(street),
      lat: p.location?.latitude ?? null,
      lon: p.location?.longitude ?? null,
      imageUrl: photo,
      images: [...new Set(photos)],
      availableAt: null,
      noFee: false,
      amenities: [],
      buildingType: p.propertyType ?? (isGroup ? "apartmentComplex" : ""),
      listingStatus: p.listingStatus === "forRent" ? "ACTIVE" : (p.listingStatus ?? "ACTIVE"),
      description: notes.join(" · "),
      contactPhone: phone,
      contactName: p.title ?? "",
      contactEmail: "",
      monthsFree: 0,
      leaseMonths: 12,
      netEffectiveRent: null,
      availableText: "",
    });
  }

  return out;
}


export async function fetchZillow(c: SearchCriteria): Promise<Listing[]> {
  // Pages per source is the main lever on the monthly request budget;
  // sorted by newest, one page already catches everything fresh.
  const config = await loadConfig();
  const MAX_PAGES = Math.min(config.pagesPerSource, POLL_PAGE_CAP);
  const byId = new Map<string, Listing>();

  for (const area of queryScopes(c.areas, config.wideQueries)) {
    const pages = await Promise.allSettled(
      Array.from({ length: MAX_PAGES }, (_, i) =>
        realtyGet<ZillowResponse>("zillow", "/search/byaddress", {
          location: area.zillow,
          listingStatus: "For_Rent",
          bed_min: bedMinParam(c.bedMin),
          bathrooms: bathParam(c.bathMin),
          /* Probed 2026-08-07: this endpoint ignores every price parameter
             we've tried (listPriceRange, price_min/max, monthlyPayment_*) —
             a 0-4000 request returns $14k listings. Kept because it's
             harmless and may start working; `inBounds` is what actually
             enforces the budget, at the cost of page slots. */
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
 * One place, one request: the targeted lookup behind a quick-add miss.
 *
 * A pasted address used to trigger a full poll — every source, every area,
 * every page — to find one apartment. The byaddress endpoint takes a
 * specific address as its location, so the whole hunt costs a single
 * request against the shared budget. Criteria are wide open on purpose:
 * a paste is a manual decision, and bounds would only hide the answer.
 */
export async function fetchZillowOne(address: string): Promise<Listing[]> {
  const wide: SearchCriteria = {
    areas: [],
    bedMin: 0,
    bedMax: null,
    bathMin: 0,
    priceMin: 0,
    priceMax: 100_000,
    sources: ["zillow"],
    noFeeOnly: false,
  };
  const body = await realtyGet<ZillowResponse>("zillow", "/search/byaddress", {
    location: address,
    listingStatus: "For_Rent",
    sortOrder: "Newest",
    page: 1,
  });
  return normalizeZillow(body?.searchResults ?? [], wide, "");
}

/**
 * Zillow's own price history for one listing. Richer than our observed history
 * because it predates the first time we ever saw the place.
 *
 * Throws on failure rather than returning [] — the caller caches answers,
 * and "the record is empty" and "the fetch never happened" must not share a
 * value, or one keyless visitor poisons the cache for everyone after them.
 * "Listing removed" rows arrive with price null and are dropped; the price
 * facts live on the listed/price-change rows.
 */
export async function fetchZillowPriceHistory(
  zpid: string
): Promise<{ date: string; price: number; event: string; rental: boolean }[]> {
  const body = await realtyGet<{ priceHistory?: unknown[] }>(
    "zillow",
    "/pricehistory",
    { byzpid: zpid }
  );
  const rows = (body?.priceHistory ?? []) as Record<string, unknown>[];
  return rows
    .map((r) => ({
      date: String(r.date ?? ""),
      price: Number(r.price ?? 0),
      event: String(r.event ?? ""),
      // The source's own word on rental vs sale, when it gives one.
      rental: r.postingIsRental !== false,
    }))
    .filter((r) => r.date && r.price > 0);
}
