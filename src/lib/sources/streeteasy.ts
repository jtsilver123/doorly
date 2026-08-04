import type { Listing, SearchCriteria, SearchResponse, StreetEasyListing } from "@/types";
import { realtyGet } from "@/lib/realtyapi";
import { loadConfig } from "@/lib/apikey";
import { getArea, boroughFor } from "@/lib/areas";

/**
 * StreetEasy via realtyapi.io. The best NYC rental source by a distance: real
 * unit numbers, square footage, neighborhood names, and an explicit status
 * field that tells us when something goes off market.
 */

const PHOTO_BASE = "https://photos.zillowstatic.com/fp";

/** realtyapi's `beds` param maxes out at 4, which means "4 or more". */
function bedValues(c: SearchCriteria): string[] {
  const CAP = 4;
  const top = c.bedMax == null ? CAP : Math.min(c.bedMax, CAP);
  const values: number[] = [];
  for (let b = Math.max(0, c.bedMin); b <= top; b++) values.push(b);
  if (!values.length) values.push(Math.min(Math.max(c.bedMin, 0), CAP));
  return [...new Set(values)].map(String);
}

function seLocations(areas: string[]): string[] {
  const slugs = areas.map((a) => getArea(a)?.streeteasy).filter(Boolean) as string[];
  return slugs.length ? [...new Set(slugs)] : ["nyc"];
}

export function normalizeStreetEasy(raw: StreetEasyListing[]): Listing[] {
  const out: Listing[] = [];
  for (const item of raw) {
    const n = item?.node;
    if (!n?.id) continue;

    // StreetEasy returns sold/delisted rows alongside live ones. Keeping only
    // ACTIVE here means a listing simply stops appearing when it goes away,
    // which is what ingest's disappearance check keys off.
    if (n.status !== "ACTIVE") continue;
    if (!n.price || n.price <= 0) continue;

    const photoKey = n.leadMedia?.photo?.key;
    const area = n.areaName || "";

    out.push({
      id: `streeteasy-${n.id}`,
      source: "streeteasy",
      sourceId: String(n.id),
      url: `https://streeteasy.com${n.urlPath}`,
      price: Math.round(n.price),
      bedrooms: n.bedroomCount ?? 0,
      bathrooms: (n.fullBathroomCount ?? 0) + (n.halfBathroomCount ?? 0) * 0.5,
      sqft: n.livingAreaSize && n.livingAreaSize > 0 ? n.livingAreaSize : null,
      neighborhood: area,
      borough: boroughFor(area),
      address: n.street || "",
      unit: n.unit || "",
      lat: n.geoPoint?.latitude ?? null,
      lon: n.geoPoint?.longitude ?? null,
      imageUrl: photoKey ? `${PHOTO_BASE}/${photoKey}-se_large_800_400.webp` : null,
      availableAt: n.availableAt ?? null,
      noFee: Boolean(n.noFee),
      amenities: [],
      buildingType: n.buildingType || "",
      listingStatus: n.status,
      description: n.sourceGroupLabel ? `Listed by ${n.sourceGroupLabel}` : "",
      contactPhone: "",
      contactName: n.sourceGroupLabel || "",
      contactEmail: "",
      availableText: n.availableAt ?? "",
    });
  }
  return out;
}

export async function fetchStreetEasy(c: SearchCriteria): Promise<Listing[]> {
  // Pages per source is the main lever on the monthly request budget;
  // sorted by newest, one page already catches everything fresh.
  const PAGES_PER_BED = (await loadConfig()).pagesPerSource;
  const byId = new Map<string, Listing>();

  const requests = seLocations(c.areas).flatMap((location) =>
    bedValues(c).flatMap((beds) =>
      Array.from({ length: PAGES_PER_BED }, (_, i) => ({
        location,
        beds,
        page: String(i + 1),
      }))
    )
  );

  const responses = await Promise.allSettled(
    requests.map((r) =>
      realtyGet<SearchResponse>("streeteasy", "/search/rent", {
        location: r.location,
        beds: r.beds,
        page: r.page,
        priceRange: `${c.priceMin}-${c.priceMax}`,
        sort_by: "Newest",
      })
    )
  );

  for (const response of responses) {
    if (response.status !== "fulfilled") continue;
    const listings = response.value?.search_results?.listings ?? [];
    for (const listing of normalizeStreetEasy(listings)) byId.set(listing.id, listing);
  }

  return [...byId.values()];
}
