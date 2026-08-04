import type { Listing, SearchCriteria, Source } from "@/types";
import { inBounds } from "@/lib/criteria";
import { hasRealtyKey, BudgetExhaustedError } from "@/lib/realtyapi";
import { fetchStreetEasy } from "@/lib/sources/streeteasy";
import { fetchZillow } from "@/lib/sources/zillow";
import { fetchHotPads } from "@/lib/sources/hotpads";
import { fetchCraigslist } from "@/lib/sources/craigslist";

export interface SourceReport {
  source: Source;
  ok: boolean;
  fetched: number;
  kept: number;
  message: string;
}

export interface SearchRun {
  listings: Listing[];
  reports: SourceReport[];
}

type Fetcher = (c: SearchCriteria) => Promise<Listing[]>;

const FETCHERS: Record<string, { run: Fetcher; needsKey: boolean }> = {
  streeteasy: { run: fetchStreetEasy, needsKey: true },
  zillow: { run: fetchZillow, needsKey: true },
  hotpads: { run: fetchHotPads, needsKey: true },
  craigslist: { run: fetchCraigslist, needsKey: false },
};

/**
 * Runs one saved search across its enabled sources.
 *
 * Sources fail independently and loudly: a StreetEasy outage must not hide the
 * Craigslist results, but it also must not look like "no new listings today".
 * Every source returns a report so the UI can say which ones actually ran.
 */
export async function runSearch(c: SearchCriteria): Promise<SearchRun> {
  const enabled = c.sources.filter((s) => FETCHERS[s]);
  const keyed = await hasRealtyKey();

  const settled = await Promise.allSettled(
    enabled.map(async (source): Promise<SourceReport & { listings: Listing[] }> => {
      const entry = FETCHERS[source];
      if (entry.needsKey && !keyed) {
        return {
          source,
          ok: false,
          fetched: 0,
          kept: 0,
          message: "skipped: no API key — add one in Settings",
          listings: [],
        };
      }
      try {
        const fetched = await entry.run(c);
        const kept = fetched.filter((l) => inBounds(l, c));
        return {
          source,
          ok: true,
          fetched: fetched.length,
          kept: kept.length,
          message: "",
          listings: kept,
        };
      } catch (err) {
        // Running out of quota is not the same as a broken source; label it so
        // the UI can tell you to swap keys instead of implying an outage.
        const message =
          err instanceof BudgetExhaustedError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        return { source, ok: false, fetched: 0, kept: 0, message, listings: [] };
      }
    })
  );

  const byId = new Map<string, Listing>();
  const reports: SourceReport[] = [];

  for (const result of settled) {
    if (result.status === "rejected") continue;
    const { listings, ...report } = result.value;
    reports.push(report);
    for (const listing of listings) byId.set(listing.id, listing);
  }

  return { listings: [...byId.values()], reports };
}
