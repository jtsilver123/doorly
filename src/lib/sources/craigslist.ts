import type { Listing, SearchCriteria } from "@/types";
import { craigslistSubareas, boroughFor, canonicalNeighborhood } from "@/lib/areas";
import { extractUnit } from "@/lib/dedupe";

/**
 * Craigslist, scraped directly. No API key, no paid proxy — the only fully free
 * source here, and often the first place a small landlord posts.
 *
 * Parsing strategy (kept from the original APT implementation): the static
 * search page carries a JSON-LD ItemList with clean bed/bath/geo data, plus
 * `<li class="cl-static-search-result">` cards with price/title/location. The
 * two are positionally aligned, so we merge them by index.
 *
 * Craigslist can only filter by borough subarea, so neighborhood narrowing
 * happens in the criteria post-filter rather than here.
 */

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface JsonLdItem {
  name?: string;
  bedrooms?: number;
  bathrooms?: number;
  latitude?: number;
  longitude?: number;
}

function safeNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : undefined;
}

export function parseJsonLd(html: string): Map<number, JsonLdItem> {
  const items = new Map<number, JsonLdItem>();
  const scriptRe =
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      if (data?.["@type"] !== "ItemList") continue;
      for (const entry of data.itemListElement ?? []) {
        const position = Number.parseInt(String(entry.position), 10);
        if (!Number.isFinite(position)) continue;
        const item = entry.item ?? {};
        items.set(position, {
          name: item.name ?? undefined,
          bedrooms: safeNumber(item.numberOfBedrooms),
          bathrooms: safeNumber(item.numberOfBathroomsTotal),
          latitude: safeNumber(item.latitude),
          longitude: safeNumber(item.longitude),
        });
      }
    } catch {
      // A malformed block shouldn't lose the whole page.
    }
  }
  return items;
}

const CARD_RE = /<li\s+class="cl-static-search-result"[^>]*>([\s\S]*?)<\/li>/g;

/**
 * Craigslist post ids.
 *
 * They moved from numeric ids to opaque slugs, and both still appear in the
 * wild depending on the page:
 *   legacy  https://newyork.craigslist.org/mnh/abo/d/some-slug/7891234567.html
 *   current https://www.craigslist.org/view/d/some-slug/nysfnVxrP9Y9QZh5cXF5L3
 *
 * Matching only the legacy form silently drops every result, so try the numeric
 * id first (stabler when present) and fall back to the trailing path segment.
 */
export function craigslistId(href: string): string {
  const legacy = /\/(\d{6,})\.html/.exec(href);
  if (legacy) return legacy[1];

  const path = href.split("?")[0].replace(/\/+$/, "");
  const last = path.slice(path.lastIndexOf("/") + 1);
  return /^[A-Za-z0-9_-]{8,}$/.test(last) ? last : "";
}

export function parseCraigslistHtml(html: string): Listing[] {
  const jsonLd = parseJsonLd(html);
  const listings: Listing[] = [];

  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = CARD_RE.exec(html)) !== null) {
    const card = match[1];
    const position = index;
    index++;

    const href = /href="([^"]+)"/.exec(card)?.[1];
    if (!href) continue;

    const sourceId = craigslistId(href);
    if (!sourceId) continue;

    const priceRaw = /class="price"[^>]*>\s*\$?([\d,]+)/.exec(card)?.[1];
    const price = priceRaw ? Number.parseInt(priceRaw.replace(/,/g, ""), 10) : 0;
    if (!price || price <= 0) continue;

    const title = /class="title"[^>]*>([^<]+)/.exec(card)?.[1]?.trim() ?? "";
    const locationText =
      /class="location"[^>]*>([^<]+)/.exec(card)?.[1]?.trim() ?? "";

    // Craigslist emits `"position": "0"` for the first item, so JSON-LD and
    // card order share the same 0-based index.
    const ld = jsonLd.get(position) ?? {};
    const displayTitle = ld.name || title || "Craigslist listing";
    const combined = `${locationText} ${displayTitle}`;

    const neighborhood = canonicalNeighborhood(combined) || locationText;

    listings.push({
      id: `craigslist-${sourceId}`,
      source: "craigslist",
      sourceId,
      url: href.startsWith("http") ? href : `https://newyork.craigslist.org${href}`,
      price,
      bedrooms: ld.bedrooms ?? 0,
      bathrooms: ld.bathrooms ?? 1,
      sqft: null,
      neighborhood,
      borough: boroughFor(combined),
      // Craigslist has no address field; the title is the best proxy and often
      // does contain one ("123 Bedford Ave - sunny 2BR").
      address: displayTitle,
      unit: extractUnit(displayTitle),
      lat: ld.latitude ?? null,
      lon: ld.longitude ?? null,
      imageUrl: null,
      availableAt: null,
      noFee: /no\s*fee/i.test(displayTitle),
      amenities: [],
      buildingType: "",
      listingStatus: "ACTIVE",
      description: locationText,
      contactPhone: "",
      contactName: "",
      availableText: "",
    });
  }

  return listings;
}

async function fetchSubarea(
  subarea: string,
  c: SearchCriteria
): Promise<Listing[]> {
  const params = new URLSearchParams({
    min_price: String(c.priceMin),
    max_price: String(c.priceMax),
    min_bedrooms: String(c.bedMin),
    availabilityMode: "0",
  });
  if (c.bedMax != null) params.set("max_bedrooms", String(c.bedMax));

  const url = `https://newyork.craigslist.org/search/${subarea}/apa?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    // Craigslist 301s to www.craigslist.org/search/subarea/...; fetch follows.
    const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!response.ok) throw new Error(`Craigslist returned ${response.status}`);
    return parseCraigslistHtml(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCraigslist(c: SearchCriteria): Promise<Listing[]> {
  const subareas = craigslistSubareas(c.areas);
  const targets = subareas.length ? subareas : ["mnh"];

  const results = await Promise.allSettled(targets.map((s) => fetchSubarea(s, c)));
  const byId = new Map<string, Listing>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const listing of result.value) byId.set(listing.id, listing);
  }
  return [...byId.values()];
}
