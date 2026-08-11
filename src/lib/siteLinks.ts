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

/* --- the directory ------------------------------------------------------- */

/**
 * Where to look, by what kind of hunt this is.
 *
 * DamnLease is not the inventory and stops pretending to be: the sites are.
 * What it knows is the person's search, so every link below opens the right
 * site already pointed at it, as far as that site's public URL grammar
 * allows. `carries` is the honesty bit — true only when the link really
 * lands filtered, so the UI never promises a tailored page and delivers a
 * homepage.
 *
 * Grammar confidence follows the same rule as the jump row above: carry
 * filters only where the grammar is stable (StreetEasy paths, Craigslist
 * query params), and land on the closest honest page everywhere else.
 */

export type HuntKind = "lease" | "short" | "sublet";

export interface DirectorySite {
  key: string;
  name: string;
  /** Why this site earns a slot, in one line. */
  tagline: string;
  url: string;
  /** True when the link lands pre-filtered with the user's search. */
  carries: boolean;
  /**
   * The lane's first stop. Seventeen equal doors is a decision tax on
   * someone already stressed; one per lane gets to say "start here".
   */
  lead?: boolean;
}

export interface DirectoryLane {
  kind: HuntKind;
  title: string;
  /** Who this lane is for, so people self-select in one read. */
  when: string;
  sites: DirectorySite[];
}

const nycQ = (q: string) => encodeURIComponent(q);

/** Craigslist's query grammar has outlived every redesign. */
function craigslistSearchUrl(c: SearchCriteria, section: "apa" | "sub"): string {
  const params = new URLSearchParams();
  if (c.priceMin > 0) params.set("min_price", String(c.priceMin));
  params.set("max_price", String(c.priceMax));
  if (c.bedMin > 0) params.set("min_bedrooms", String(c.bedMin));
  if (c.bedMax != null) params.set("max_bedrooms", String(c.bedMax));
  return `https://newyork.craigslist.org/search/${section}?${params}`;
}

/** RentHop: plain min/max query params on the NYC search page. */
function renthopSearchUrl(c: SearchCriteria): string {
  const params = new URLSearchParams({
    min_price: String(c.priceMin),
    max_price: String(c.priceMax),
  });
  if (c.bedMin > 0) params.set("min_bedrooms", String(c.bedMin));
  if (c.bedMax != null) params.set("max_bedrooms", String(c.bedMax));
  return `https://www.renthop.com/search/nyc?${params}`;
}

/** HotPads: filters ride as query params on the city rentals page. */
function hotpadsSearchUrl(c: SearchCriteria): string {
  const params = new URLSearchParams({ price: `${c.priceMin}-${c.priceMax}` });
  if (c.bedMax != null || c.bedMin > 0) {
    params.set("beds", `${c.bedMin}-${c.bedMax ?? 8}`);
  }
  return `https://hotpads.com/new-york-ny/apartments-for-rent?${params}`;
}

/**
 * Apartments.com encodes filters in the path. The price ceiling is the one
 * segment that has held stable for years, so that's all the link claims.
 */
function apartmentsSearchUrl(c: SearchCriteria): string {
  return `https://www.apartments.com/new-york-ny/under-${c.priceMax}/`;
}

export function directoryLanes(input: SearchCriteria | null): DirectoryLane[] {
  // Nothing saved yet (a guest, a fresh account): the doors still open, just
  // unfiltered. The UI reads `carries` per site, not per person.
  const c: SearchCriteria | null = input;

  const filtered = <T>(withCriteria: (c: SearchCriteria) => T, plain: T) =>
    c ? { url: withCriteria(c), carries: true } : { url: plain, carries: false };

  return [
    {
      kind: "lease",
      title: "A lease",
      when: "Twelve months or more, your own name on it. The classic hunt.",
      sites: [
        {
          key: "streeteasy",
          name: "StreetEasy",
          tagline: "The NYC inventory. If it's listed, it's here first",
          lead: true,
          ...filtered(streeteasySearchUrl, "https://streeteasy.com/for-rent/nyc"),
        },
        {
          key: "zillow",
          name: "Zillow",
          tagline: "Widest net, and the price history to check a deal against",
          url: c ? zillowSearchUrl(c) : "https://www.zillow.com/new-york-ny/rentals/",
          carries: false,
        },
        {
          key: "renthop",
          name: "RentHop",
          tagline: "Ranks by freshness, so you see today's listings today",
          ...filtered(renthopSearchUrl, "https://www.renthop.com/search/nyc"),
        },
        {
          key: "hotpads",
          name: "HotPads",
          tagline: "Zillow's inventory on a faster map",
          ...filtered(
            hotpadsSearchUrl,
            "https://hotpads.com/new-york-ny/apartments-for-rent"
          ),
        },
        {
          key: "apartments",
          name: "Apartments.com",
          tagline: "Big buildings and managed rentals the brokers skip",
          ...filtered(apartmentsSearchUrl, "https://www.apartments.com/new-york-ny/"),
        },
        {
          key: "craigslist",
          name: "Craigslist",
          tagline: "Owner-listed and no-fee places that never hit the big sites",
          ...filtered(
            (cc) => craigslistSearchUrl(cc, "apa"),
            "https://newyork.craigslist.org/search/apa"
          ),
        },
        {
          key: "fb-nofee",
          name: "Facebook groups",
          tagline: "No-fee and by-owner posts. Paste what you find back here",
          url: `https://www.facebook.com/search/groups/?q=${nycQ("nyc apartments no fee")}`,
          carries: false,
        },
      ],
    },
    {
      kind: "short",
      title: "Short term",
      when: "One to six months, furnished, walk in with a suitcase.",
      sites: [
        {
          key: "blueground",
          name: "Blueground",
          tagline: "Furnished one-to-twelve month flats, all managed",
          url: "https://www.theblueground.com/furnished-apartments-new-york-ny",
          carries: false,
          lead: true,
        },
        {
          key: "furnished-finder",
          name: "Furnished Finder",
          tagline: "Monthly rentals priced for stays, not vacations",
          url: "https://www.furnishedfinder.com/housing/New-York-City--NY",
          carries: false,
        },
        {
          key: "junehomes",
          name: "June Homes",
          tagline: "Flexible terms on real apartments, rooms or whole units",
          url: "https://junehomes.com/apartments-for-rent-in-new-york",
          carries: false,
        },
        {
          key: "airbnb",
          name: "Airbnb",
          tagline: "Monthly stays. Filter to a month and the nightly math changes",
          url: "https://www.airbnb.com/s/New-York--NY/homes",
          carries: false,
        },
        {
          key: "vrbo",
          name: "Vrbo",
          tagline: "Whole places only. Worth a cross-check against Airbnb",
          url: `https://www.vrbo.com/search?destination=${nycQ("New York, NY")}`,
          carries: false,
        },
      ],
    },
    {
      kind: "sublet",
      title: "A sublet",
      when: "Someone else's lease, their furniture, your next few months.",
      sites: [
        {
          key: "leasebreak",
          name: "Leasebreak",
          tagline: "People leaving leases early. NYC's sublet clearing house",
          url: "https://www.leasebreak.com/",
          carries: false,
          lead: true,
        },
        {
          key: "listings-project",
          name: "Listings Project",
          tagline: "Vetted weekly list, strong on live-work and artist spaces",
          url: "https://www.listingsproject.com/",
          carries: false,
        },
        {
          key: "cl-sublets",
          name: "Craigslist sublets",
          tagline: "The sublet section proper, filtered to your numbers",
          ...filtered(
            (cc) => craigslistSearchUrl(cc, "sub"),
            "https://newyork.craigslist.org/search/sub"
          ),
        },
        {
          key: "fb-sublets",
          name: "Facebook sublet groups",
          tagline: "Gypsy Housing and friends. Fast, chaotic, occasionally gold",
          url: `https://www.facebook.com/search/groups/?q=${nycQ("nyc sublets")}`,
          carries: false,
        },
        {
          key: "spareroom",
          name: "SpareRoom",
          tagline: "Rooms in shares, when the sublet is a room not a unit",
          url: "https://www.spareroom.com/rooms-for-rent/new-york",
          carries: false,
        },
      ],
    },
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
