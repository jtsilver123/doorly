import { AREAS } from "@/lib/areas";
import type { SearchCriteria, Source } from "@/types";

/**
 * Your saved search, opened on the listing sites themselves.
 *
 * This app is the tailored version of the hunt, but it is not the inventory:
 * StreetEasy and Zillow are. A renter who can jump from their filtered board
 * to the same search on the big sites in one click never has to choose
 * between trusting us and double-checking us, and the double-check is how
 * trust gets built. So the links carry the criteria as far as each site's
 * public URL grammar allows, and land on the closest page it has.
 *
 * These are the public website URLs, not the API forms the poller uses. The
 * two grammars have already diverged once (see areas.ts), so nothing here is
 * shared with the adapters.
 */

export interface SiteJump {
  source: Source;
  label: string;
  url: string;
}

const areaOf = (slug: string) => AREAS.find((a) => a.slug === slug);

/**
 * StreetEasy: /for-rent/{place}/{filter|filter}. One chosen neighborhood
 * links straight to it; several in one borough link the borough; a mixed bag
 * links all of NYC. Filters ride along because SE's URL grammar carries them.
 */
export function streeteasySearchUrl(c: SearchCriteria): string {
  const chosen = c.areas.map(areaOf).filter((a) => a !== undefined);
  const boroughs = new Set(chosen.map((a) => a.borough));
  const place =
    chosen.length === 1
      ? chosen[0].slug
      : boroughs.size === 1 && chosen.length > 0
        ? chosen[0].borough.toLowerCase().replace(/ /g, "-")
        : "nyc";

  const filters: string[] = [];
  filters.push(c.priceMin > 0 ? `price:${c.priceMin}-${c.priceMax}` : `price:-${c.priceMax}`);
  if (c.bedMax == null) {
    if (c.bedMin > 0) filters.push(`beds>=${c.bedMin}`);
  } else if (c.bedMin === c.bedMax) {
    filters.push(`beds:${c.bedMin}`);
  } else {
    filters.push(`beds:${c.bedMin}-${c.bedMax}`);
  }

  return `https://streeteasy.com/for-rent/${place}/${filters.join("%7C")}`;
}

/**
 * Zillow: the neighborhood rentals page. Zillow's filters live in a JSON
 * query-string blob that changes without notice, so the link stops at the
 * right place rather than guessing at the right filters.
 */
export function zillowSearchUrl(c: SearchCriteria): string {
  const chosen = c.areas.map(areaOf).filter((a) => a !== undefined);
  const place = chosen.length === 1 ? `${chosen[0].slug}-new-york-ny` : "new-york-ny";
  return `https://www.zillow.com/${place}/rentals/`;
}

/** The jump row: the two sites renters actually cross-check against. */
export function siteJumps(c: SearchCriteria): SiteJump[] {
  return [
    { source: "streeteasy", label: "StreetEasy", url: streeteasySearchUrl(c) },
    { source: "zillow", label: "Zillow", url: zillowSearchUrl(c) },
  ];
}

/**
 * The same address, looked up on a listing site.
 *
 * A place you pasted from a Facebook group or typed in by hand has no
 * published URL of its own, so the panel had nothing external to offer for
 * exactly the listings you most want a second opinion on. A site search for
 * the address is the next best thing, and it's what you'd type anyway.
 */
export function addressSearchUrl(source: Source, address: string): string {
  const q = encodeURIComponent(`${address}, New York, NY`);
  switch (source) {
    case "zillow":
      return `https://www.zillow.com/homes/${q}_rb/`;
    case "hotpads":
      return `https://hotpads.com/search?q=${q}`;
    case "apartments":
      return `https://www.apartments.com/${encodeURIComponent(address.replace(/\s+/g, "-").toLowerCase())}/`;
    case "craigslist":
      return `https://newyork.craigslist.org/search/apa?query=${q}`;
    default:
      return `https://streeteasy.com/search?search%5Bquery%5D=${q}`;
  }
}
