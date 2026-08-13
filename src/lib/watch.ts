import type { Listing } from "@/types";
import { adminDb } from "@/lib/supabase";
import { currentHuntId } from "@/lib/hunts";
import { fetchZillowOne } from "@/lib/sources/zillow";
import { streetKey, extractUnit } from "@/lib/dedupe";
import { limitPollRequests, endPollRequests, BudgetExhaustedError } from "@/lib/realtyapi";
import { deliver, noticesForEvents } from "@/lib/notify";

/**
 * The watchlist re-check: diligence on your places, not a trawl for new ones.
 *
 * The hourly crawl used to do two jobs with one expensive motion — discover
 * new listings and notice changes to known ones — by re-scraping whole search
 * results. Discovery moved out to the sites themselves (see the directory in
 * siteLinks.ts), which leaves the second job, and the second job only needs
 * one request per place you're actually chasing: is it still up, and at what
 * price?
 *
 * Everything in your pipeline gets re-checked, stalest first. A price move
 * becomes a timeline event and a push through the same channels the crawl
 * fed; a place that vanishes from its own address search gets marked off
 * market. That's the entire PM promise — "we watch the places you're working"
 * — at a request budget of your pipeline's size instead of the market's.
 */

/** What one re-check learned about one place. */
export interface WatchVerdict {
  /** Events to append to the listing's timeline, in ingest's shapes. */
  events: {
    kind: "price_drop" | "price_rise" | "back_on_market" | "delisted";
    oldValue: string | null;
    newValue: string | null;
    detail: string;
  }[];
  /** Field updates for the listings row; empty means nothing changed. */
  update: Record<string, unknown>;
}

/** A watched row, as much of it as the diff needs. */
export interface WatchedRow {
  id: string;
  address: string;
  unit: string;
  bedrooms: number;
  price: number;
  isActive: boolean;
}

/** Ignore penny-level jitter; sites round differently between fetches. */
const PRICE_NOISE = 10;

/**
 * Match the address-search results to the watched apartment. The search
 * returns the building's active rentals; ours is the one on the same street
 * key whose unit agrees (or where neither side states a unit).
 */
export function findWatched(watched: WatchedRow, results: Listing[]): Listing | null {
  const street = streetKey(watched.address);
  if (!street) return null;
  const unit = (watched.unit || extractUnit(watched.address)).toUpperCase();

  let building: Listing | null = null;
  for (const found of results) {
    if (streetKey(found.address) !== street) continue;
    const foundUnit = (found.unit || extractUnit(found.address)).toUpperCase();
    if (unit && foundUnit && unit === foundUnit) return found;
    // Same building, unit unstated on one side: hold as a weak match, and
    // only trust it when the bed count agrees — the search can't tell 4B
    // from 2A, but a studio is not a 2BR.
    if ((!unit || !foundUnit) && found.bedrooms === watched.bedrooms) {
      building = building ?? found;
    }
  }
  return building;
}

/**
 * The pure diff: given what we believed and what the site says now, decide
 * which events happened. Extracted so the rules that can empty a timeline —
 * or cry wolf on it — are unit-tested rather than trusted.
 */
export function watchDiff(
  watched: WatchedRow,
  found: Listing | null,
  fetchOk: boolean,
  nowIso: string
): WatchVerdict {
  const verdict: WatchVerdict = { events: [], update: {} };

  /*
   * No verdict without evidence. A failed fetch says nothing about the
   * apartment; only a successful address search that comes back without the
   * unit is testimony that it's gone.
   */
  if (!fetchOk) return verdict;

  if (!found) {
    if (watched.isActive) {
      verdict.events.push({
        kind: "delisted",
        oldValue: String(watched.price),
        newValue: null,
        detail: "No longer listed at its own address",
      });
      verdict.update = { is_active: false };
    }
    return verdict;
  }

  verdict.update = { last_seen_at: nowIso };

  if (!watched.isActive) {
    verdict.events.push({
      kind: "back_on_market",
      oldValue: null,
      newValue: String(found.price),
      detail: "Reappeared after being off market",
    });
    verdict.update = { ...verdict.update, is_active: true, relisted_at: nowIso };
  }

  const delta = found.price - watched.price;
  if (Number.isFinite(found.price) && found.price > 0 && Math.abs(delta) > PRICE_NOISE) {
    const pct = Math.round((delta / watched.price) * 1000) / 10;
    verdict.events.push({
      kind: delta < 0 ? "price_drop" : "price_rise",
      oldValue: String(watched.price),
      newValue: String(found.price),
      detail: `${delta < 0 ? "" : "+"}$${delta.toLocaleString()} (${pct}%)`,
    });
    verdict.update = { ...verdict.update, price: found.price };
  }

  return verdict;
}

export interface WatchResult {
  /** Places re-checked this run (the stalest, up to the per-run cap). */
  checked: number;
  /** Places in the pipeline that qualify for watching at all. */
  watched: number;
  events: number;
  priceDrops: number;
  gone: number;
  errors: string[];
  /**
   * The hunt is won, so nothing was checked. Not an error and not an empty
   * board: the caller needs to tell those three apart to say anything true.
   */
  settled?: boolean;
}

/**
 * One request per place per check. The platform grants an invocation ~50
 * subrequests and the database work needs its share, so a big pipeline is
 * re-checked in stalest-first slices across runs rather than all at once.
 */
const PER_RUN_CAP = 12;

/** In the pipeline, and not something you filed away or never touched. */
export const WATCH_STAGES = ["interested", "contacted", "tour", "toured", "applied"];

export async function recheckWatch(userId: string): Promise<WatchResult> {
  const supabase = adminDb();
  const nowIso = new Date().toISOString();
  const errors: string[] = [];
  /*
   * Only the hunt in progress. A closed hunt's board is a record, and
   * re-checking its prices would spend requests to update history.
   */
  const huntId = await currentHuntId(userId);

  const result: WatchResult = {
    checked: 0,
    watched: 0,
    events: 0,
    priceDrops: 0,
    gone: 0,
    errors,
  };

  /*
   * A won hunt is not watched.
   *
   * Securing a place does not move anything out of WATCH_STAGES, so without
   * this the hourly run kept re-pricing every apartment on a finished board:
   * the ones toured and turned down, the ones that never answered. It spent
   * a metered API budget to do it and turned the result into notifications
   * about a hunt that was over. Checked before anything else because it is
   * the cheapest question here and it settles the whole run.
   */
  const { data: wonRows, error: wonErr } = await supabase
    .from("user_listing_state")
    .select("listing_id")
    .eq("user_id", userId)
    .eq("hunt_id", huntId)
    .eq("secured", true)
    .limit(1);
  if (wonErr) throw new Error(`watch: ${wonErr.message}`);
  if ((wonRows ?? []).length > 0) {
    result.settled = true;
    return result;
  }

  const { data: stateRows, error: stateErr } = await supabase
    .from("user_listing_state")
    .select("listing_id")
    .eq("user_id", userId)
    .eq("hunt_id", huntId)
    .in("stage", WATCH_STAGES);
  if (stateErr) throw new Error(`watch: ${stateErr.message}`);
  const ids = (stateRows ?? []).map((r) => r.listing_id as string);
  if (!ids.length) return result;

  const { data: listingRows, error: listErr } = await supabase
    .from("listings")
    .select("id, address, unit, bedrooms, price, is_active, last_seen_at")
    .in("id", ids)
    .order("last_seen_at", { ascending: true });
  if (listErr) throw new Error(`watch: ${listErr.message}`);

  /*
   * Only places an address search can answer for. A pasted Facebook post
   * with no street number can't be looked up, so re-checking it would spend
   * a request to learn nothing.
   */
  const watchable = ((listingRows ?? []) as Record<string, unknown>[])
    .map((row) => ({
      id: row.id as string,
      address: (row.address as string) ?? "",
      unit: (row.unit as string) ?? "",
      bedrooms: Number(row.bedrooms ?? 0),
      price: Number(row.price ?? 0),
      isActive: Boolean(row.is_active),
    }))
    .filter((row) => streetKey(row.address) !== "");
  result.watched = watchable.length;
  if (!watchable.length) return result;

  const slice = watchable.slice(0, PER_RUN_CAP);
  const { data: runRow } = await supabase
    .from("poll_runs")
    .insert({ started_at: nowIso, user_id: userId })
    .select("id")
    .single();

  limitPollRequests(PER_RUN_CAP);
  try {
    const eventInserts: Record<string, unknown>[] = [];
    for (const row of slice) {
      let found: Listing | null = null;
      let fetchOk = false;
      try {
        found = findWatched(row, await fetchZillowOne(row.address));
        fetchOk = true;
      } catch (err) {
        errors.push(
          `${row.address}: ${err instanceof Error ? err.message : String(err)}`
        );
        // Budget gone means every later fetch dies the same way; stop asking.
        if (err instanceof BudgetExhaustedError) break;
      }

      const { events, update } = watchDiff(row, found, fetchOk, nowIso);
      result.checked++;
      for (const e of events) {
        eventInserts.push({
          listing_id: row.id,
          kind: e.kind,
          old_value: e.oldValue,
          new_value: e.newValue,
          detail: e.detail,
          occurred_at: nowIso,
        });
        if (e.kind === "price_drop") result.priceDrops++;
        if (e.kind === "delisted") result.gone++;
      }
      if (Object.keys(update).length) {
        const { error } = await supabase.from("listings").update(update).eq("id", row.id);
        if (error) errors.push(`${row.address}: ${error.message}`);
      }
    }

    if (eventInserts.length) {
      const { error } = await supabase.from("events").insert(eventInserts);
      if (error) errors.push(`events: ${error.message}`);
      else result.events = eventInserts.length;

      // Same bell the crawl rang: a price drop on a place you're chasing is
      // exactly the push this app exists to send. A notify failure never
      // fails the check — the data is already safe.
      try {
        await deliver(
          await noticesForEvents(
            eventInserts as { listing_id: string; kind: string }[]
          )
        );
      } catch (err) {
        errors.push(`notify: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
  } finally {
    endPollRequests();
    if (runRow?.id) {
      await supabase
        .from("poll_runs")
        .update({
          finished_at: new Date().toISOString(),
          fetched: result.checked,
          ok: errors.length === 0,
          message: errors.join("; ").slice(0, 2000),
        })
        .eq("id", runRow.id);
    }
  }

  return result;
}
