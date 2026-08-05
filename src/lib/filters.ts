import type { FeedListing, Source, Stage } from "@/types";
import { streetKey } from "@/lib/dedupe";

/**
 * Search the way people actually type an address.
 *
 * A plain substring match meant "91 E 3rd" found nothing while "91 East Third
 * Street" found the listing — the same building, spelled the way the listing
 * site happened to spell it. Both sides go through the same canonicaliser the
 * cross-site dedupe uses, so ordinals, directions and street-type suffixes all
 * collapse: "E"/"East", "3rd"/"3"/"Third", "St"/"Street".
 *
 * The raw text is searched too, so neighborhoods and your own notes still match
 * even though they aren't addresses.
 */
const SPELLED: Record<string, string> = {
  first: "1", second: "2", third: "3", fourth: "4", fifth: "5",
  sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10",
  eleventh: "11", twelfth: "12",
};

function spellOut(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b/g,
      (w) => SPELLED[w] ?? w
    );
}

/**
 * What gets searched. Both the canonical address form and the raw text, so a
 * query can match either.
 */
function haystack(text: string): string {
  const spelled = spellOut(text);
  return `${streetKey(spelled)} ${spelled}`;
}

/**
 * What gets searched *for* — canonical only.
 *
 * Including the raw form here was the first attempt and it was wrong: typing
 * "91 E 3rd" produced the token "3rd", which a canonicalised haystack never
 * contains, so requiring every token found nothing.
 */
function needleWords(text: string): string[] {
  const spelled = spellOut(text);
  const canonical = streetKey(spelled);
  return (canonical || spelled).split(/\s+/).filter(Boolean);
}

/**
 * Filtering and sorting, as a pure function of the listings you already have.
 *
 * This lives apart from `feed.ts` on purpose. Every filter used to be a query
 * parameter, which meant typing a letter in the search box fired a request that
 * re-read every row, retrained the preference model, recomputed the comps and
 * re-rated the whole corpus — a few hundred milliseconds of server work to hide
 * some cards the browser already had in memory.
 *
 * The set of listings is small enough (low thousands, capped) that doing this
 * in the browser is imperceptible, so the server now loads the feed once and the
 * client filters it. The same module runs on both sides, so the two can't drift.
 */

export interface FeedFilterOptions {
  stage?: Stage | "all" | "active";
  sources?: Source[];
  areas?: string[];
  priceMin?: number;
  priceMax?: number;
  bedsMin?: number;
  bedsMax?: number;
  bathsMin?: number;
  noFeeOnly?: boolean;
  changedOnly?: boolean;
  followUpOnly?: boolean;
  starredOnly?: boolean;
  effectiveMax?: number;
  readyByMoveIn?: boolean;
  /** Hide anything the rating judges to be below this, 0-100. */
  minRating?: number;
  search?: string;
  sort?: SortKey;
  limit?: number;
  /**
   * Server-side only: whether to read delisted rows out of the database at all.
   * Every other option here is applied in memory, but this one decides what
   * gets fetched, so it can't be re-evaluated in the browser.
   */
  includeGone?: boolean;
}

export type SortKey =
  | "best"
  | "newest"
  | "cheapest"
  | "effective"
  | "allin"
  | "upfront"
  | "recent_change";

/** The sort options offered in the UI, in the order they're shown. */
export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "best", label: "Best for me" },
  { value: "newest", label: "Newest first" },
  { value: "cheapest", label: "Lowest rent" },
  { value: "effective", label: "Lowest after concessions" },
  { value: "allin", label: "Lowest true monthly" },
  { value: "upfront", label: "Least cash up front" },
  { value: "recent_change", label: "Recently changed" },
];

const SORTERS: Record<SortKey, (a: FeedListing, b: FeedListing) => number> = {
  best: (a, b) => b.rating - a.rating,
  newest: (a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt),
  cheapest: (a, b) => a.price - b.price,
  upfront: (a, b) => a.upfrontCost - b.upfrontCost,
  effective: (a, b) => a.effectiveRent - b.effectiveRent,
  allin: (a, b) => a.allInMonthly - b.allInMonthly,
  recent_change: (a, b) =>
    (b.priceChangedAt ?? b.lastSeenAt).localeCompare(a.priceChangedAt ?? a.lastSeenAt),
};

export function applyFilters(
  listings: FeedListing[],
  filters: FeedFilterOptions
): FeedListing[] {
  let result = listings;

  if (filters.stage && filters.stage !== "all") {
    if (filters.stage === "active") {
      result = result.filter((l) => l.stage !== "inbox" && l.stage !== "passed");
    } else {
      result = result.filter((l) => l.stage === filters.stage);
    }
  } else {
    // "All" still hides things you've explicitly rejected.
    result = result.filter((l) => l.stage !== "passed");
  }

  if (filters.priceMin != null) result = result.filter((l) => l.price >= filters.priceMin!);
  if (filters.priceMax != null) result = result.filter((l) => l.price <= filters.priceMax!);
  if (filters.bedsMin != null) result = result.filter((l) => l.bedrooms >= filters.bedsMin!);
  if (filters.bedsMax != null) result = result.filter((l) => l.bedrooms <= filters.bedsMax!);
  if (filters.bathsMin != null)
    result = result.filter((l) => l.bathrooms >= filters.bathsMin!);
  if (filters.noFeeOnly) result = result.filter((l) => l.noFee);
  if (filters.effectiveMax != null)
    result = result.filter((l) => l.effectiveRent <= filters.effectiveMax!);
  if (filters.starredOnly) result = result.filter((l) => l.starred);
  if (filters.followUpOnly) result = result.filter((l) => l.needsFollowUp);
  if (filters.readyByMoveIn) {
    // "unknown" stays in: most sources publish no date, and dropping them
    // would hide the majority of the market.
    result = result.filter((l) => l.timing === "ready" || l.timing === "unknown");
  }
  if (filters.minRating != null) {
    result = result.filter((l) => l.rating >= filters.minRating!);
  }
  if (filters.changedOnly) {
    result = result.filter((l) => l.unseenEvents > 0 || l.price !== l.originalPrice);
  }
  if (filters.sources?.length) {
    // Any-of, not all-of: picking StreetEasy and Zillow means "either".
    result = result.filter((l) => l.alsoOn.some((s) => filters.sources!.includes(s.source)));
  }
  if (filters.areas?.length) {
    const wanted = new Set(filters.areas.map((a) => a.toLowerCase()));
    result = result.filter((l) => wanted.has(l.neighborhood.toLowerCase()));
  }
  if (filters.search?.trim()) {
    // Try the query both ways. Canonicalising catches "91 E 3rd" against
    // "91 East Third Street"; the raw form catches everything that isn't an
    // address at all, where canonicalising can drop a word — streetKey exists
    // to normalise streets, not neighborhoods or your own notes.
    const raw = spellOut(filters.search).split(/\s+/).filter(Boolean);
    const canonical = needleWords(filters.search);
    result = result.filter((l) => {
      const hay = haystack(`${l.address} ${l.unit} ${l.neighborhood} ${l.notes}`);
      const words = new Set(hay.split(/\s+/));
      /*
       * Long tokens may match inside a word, so typing "mort" still finds
       * Morton. Short ones must be whole words — canonicalising turns "East"
       * into "e", and a substring "e" appears in almost every listing on the
       * board, which silently made the search match everything.
       */
      const has = (w: string) => (w.length >= 3 ? hay.includes(w) : words.has(w));
      return raw.every(has) || canonical.every(has);
    });
  }

  result = [...result].sort(SORTERS[filters.sort ?? "best"] ?? SORTERS.best);
  return filters.limit ? result.slice(0, filters.limit) : result;
}

/** How many filters are narrowing the list, for the "clear" affordance. */
export function activeFilterCount(filters: FeedFilterOptions): number {
  let n = 0;
  if (filters.search?.trim()) n++;
  if (filters.priceMax != null) n++;
  if (filters.bedsMin != null || filters.bedsMax != null) n++;
  if (filters.bathsMin != null) n++;
  if (filters.sources?.length) n++;
  if (filters.noFeeOnly) n++;
  if (filters.changedOnly) n++;
  if (filters.starredOnly) n++;
  if (filters.followUpOnly) n++;
  if (filters.readyByMoveIn) n++;
  if (filters.minRating != null) n++;
  return n;
}
