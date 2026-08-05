import type { Listing, SearchCriteria } from "@/types";
import { realtyGet } from "@/lib/realtyapi";
import { loadConfig } from "@/lib/apikey";
import { queryScopes, boroughFor, canonicalNeighborhood } from "@/lib/areas";
import { extractUnit } from "@/lib/dedupe";
import { locate } from "@/lib/geo";
import { toPrice, toNum } from "@/lib/parse";

/**
 * Apartments.com via realtyapi.io.
 *
 * Worth having for two reasons the other sources can't cover: it is the biggest
 * source of large-building/management-company inventory (which barely appears
 * on StreetEasy), and it is the only one whose search accepts an availability
 * window — so a 1 September move-in can be filtered upstream instead of after
 * the fact.
 *
 * ---------------------------------------------------------------------------
 * UNVERIFIED against live responses. The endpoint list and parameters come from
 * the published OpenAPI spec, and the response envelope (`searchResults`) was
 * observed, but the per-listing field names were not — the API key ran out of
 * credits before a successful search returned. Every field is therefore read
 * through tolerant lookups with several plausible names, and anything missing
 * degrades to a sane default rather than throwing. Check the first real run
 * against `scripts/smoke.ts` output before trusting the numbers.
 * ---------------------------------------------------------------------------
 */

interface ApartmentsListing {
  [key: string]: unknown;
}

interface ApartmentsResponse {
  total?: number;
  searchResults?: ApartmentsListing[];
}

/** First present value among several candidate keys. */
function pick(row: ApartmentsListing, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/**
 * Apartments.com sometimes hands back an object where a string belongs —
 * `address: { streetAddress, city, state }` instead of the line itself. The
 * old `String(value)` turned that into the literal text "[object Object]",
 * which then got stored, deduplicated against, and rendered on cards. Never
 * stringify a container: reach inside it for the field that was wanted, and
 * return empty rather than nonsense if there isn't one.
 */
function pickString(row: ApartmentsListing, ...keys: string[]): string {
  const value = pick(row, ...keys);
  return asText(value);
}

const TEXT_KEYS = ["streetAddress", "street", "line1", "addressLine1", "full", "name", "value"];

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    // First usable element; a list of address parts joins on the caller's terms.
    for (const item of value) {
      const text = asText(item);
      if (text) return text;
    }
    return "";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      const text = asText(record[key]);
      if (text) return text;
    }
  }
  return "";
}

/** Bed/price on Apartments.com are often ranges ("1-2", {min,max}). */
function lowEnd(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.includes("-")) {
    return toNum(value.split("-")[0]);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return toNum(record.min ?? record.low ?? record.from);
  }
  return toNum(value);
}

export function normalizeApartments(
  rows: ApartmentsListing[],
  areaLabel = ""
): Listing[] {
  const out: Listing[] = [];

  for (const row of rows) {
    const id = pickString(row, "listingKey", "listingId", "id", "key");
    if (!id) continue;

    const price = toPrice(
      pick(row, "rentPrice", "price", "rent", "minRent", "lowPrice"),
      lowEnd(pick(row, "rentRange", "priceRange"))
    );
    if (price == null) continue;

    const address = pickString(row, "address", "streetAddress", "addressLine1", "title");
    const name = pickString(row, "propertyName", "name", "title");
    const beds = lowEnd(pick(row, "beds", "bedrooms", "bedRange", "minBeds")) ?? 0;
    const baths = lowEnd(pick(row, "baths", "bathrooms", "bathRange", "minBaths")) ?? 1;
    const sqft = lowEnd(pick(row, "sqft", "squareFeet", "squareFeetRange", "size"));

    const photo = (() => {
      const media = pick(row, "photos", "images", "media", "photoUrl", "imageUrl");
      if (typeof media === "string") return media;
      if (Array.isArray(media) && media.length) {
        const first = media[0];
        if (typeof first === "string") return first;
        if (first && typeof first === "object") {
          const record = first as Record<string, unknown>;
          const url = record.url ?? record.href ?? record.src;
          return typeof url === "string" ? url : null;
        }
      }
      return null;
    })();

    const url = pickString(row, "url", "listingUrl", "webUrl", "detailUrl");
    const lat = toNum(pick(row, "latitude", "lat"));
    const lon = toNum(pick(row, "longitude", "lon", "lng"));
    const located = locate(lat, lon);
    const neighborhood =
      located.neighborhood ||
      canonicalNeighborhood(`${name} ${address}`) ||
      pickString(row, "neighborhood", "area") ||
      areaLabel;

    const amenityRaw = pick(row, "amenities", "amenityList");
    const amenities = Array.isArray(amenityRaw)
      ? amenityRaw.map((a) => (typeof a === "string" ? a : String((a as Record<string, unknown>)?.name ?? "")))
          .filter(Boolean)
      : [];

    const blob = `${amenities.join(" ")} ${pickString(row, "specials", "specialOffers")}`;

    out.push({
      id: `apartments-${id}`,
      source: "apartments",
      sourceId: id,
      url: url || `https://www.apartments.com/${id}/`,
      price,
      bedrooms: beds,
      bathrooms: baths,
      sqft: sqft && sqft > 0 ? Math.round(sqft) : null,
      neighborhood,
      borough: located.borough || boroughFor(`${neighborhood} ${address}`),
      address: address || name,
      unit: extractUnit(address),
      lat,
      lon,
      imageUrl: photo,
      availableAt: pickString(row, "availableFrom", "availableDate", "dateAvailable") || null,
      noFee: /no\s*fee/i.test(blob),
      amenities,
      buildingType: pickString(row, "propertyType", "type"),
      listingStatus: "ACTIVE",
      description: pickString(row, "specials", "specialOffers", "description"),
      // Apartments.com surfaces a leasing office on most listings — the main
      // reason to have it, since nothing else reliably publishes a phone.
      contactPhone: pickString(row, "phone", "contactPhone", "phoneNumber"),
      contactName: name,
      contactEmail: pickString(row, "email", "contactEmail"),
      availableText: pickString(row, "availabilityText", "availableFrom"),
      monthsFree: toNum(pick(row, "monthsFree", "freeMonths")) ?? 0,
      leaseMonths: toNum(pick(row, "leaseTermMonths", "leaseLength")) ?? 12,
      netEffectiveRent: toPrice(pick(row, "netEffectiveRent", "effectiveRent")),
    });
  }

  return out;
}

/** ISO date window around the move-in target, so results can actually be taken. */
function availabilityWindow(moveIn: string): { from?: string; to?: string } {
  if (!moveIn) return {};
  const target = new Date(`${moveIn.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(target.getTime())) return {};
  const from = new Date(target.getTime() - 30 * 86_400_000);
  const to = new Date(target.getTime() + 21 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export async function fetchApartments(
  c: SearchCriteria,
  moveInDate = ""
): Promise<Listing[]> {
  const config = await loadConfig();
  const pages = config.pagesPerSource;
  const byId = new Map<string, Listing>();
  const window = availabilityWindow(moveInDate);

  for (const area of queryScopes(c.areas, config.wideQueries)) {
    const results = await Promise.allSettled(
      Array.from({ length: pages }, (_, i) =>
        realtyGet<ApartmentsResponse>("apartments", "/search/bylocation", {
          location: area.hotpads, // "West Village, New York, NY" — same city form
          priceRange: `${c.priceMin}-${c.priceMax}`,
          bedRange: `${c.bedMin}-${c.bedMax ?? 4}`,
          bathRange: c.bathMin > 0 ? `${c.bathMin}-8` : undefined,
          resultCount: 100,
          page: i + 1,
          sortOrder: "Newest",
          availableFrom: window.from,
          availableTo: window.to,
        })
      )
    );

    const label = area.isBorough ? "" : area.label;
    for (const page of results) {
      if (page.status !== "fulfilled") continue;
      for (const listing of normalizeApartments(page.value?.searchResults ?? [], label)) {
        byId.set(listing.id, listing);
      }
    }
  }

  return [...byId.values()];
}
