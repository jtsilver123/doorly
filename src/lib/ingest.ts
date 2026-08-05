import type { Listing, SavedSearch, Source } from "@/types";
import { LINK_PREFERENCE } from "@/types";
import { adminDb } from "@/lib/supabase";
import { fingerprint, contentHash, matchConfidence } from "@/lib/dedupe";
import { deliver, noticesForEvents } from "@/lib/notify";
import { sweepPlan } from "@/lib/sweep";
import { runSearch, type SourceReport } from "@/lib/sources";

/**
 * The ingest pipeline. Runs every saved search, folds the results into the
 * database, and — the part that matters — works out what *changed* since last
 * time.
 *
 * Ordering is deliberate:
 *   1. scrape every active search
 *   2. merge duplicates across sites (same flat on StreetEasy and Zillow)
 *   3. diff each listing against its previous state -> events
 *   4. mark anything that stopped appearing as off-market
 *
 * Step 4 only runs for sources that actually answered. If StreetEasy times out
 * we must not conclude that every StreetEasy listing was rented overnight.
 */

/** Reappearing after this long counts as a relist, not a continuation. */
const RELIST_GAP_MS = 3 * 24 * 60 * 60 * 1000;

/** Ignore sub-$10 wobble (fees, rounding) so the timeline stays readable. */
const PRICE_NOISE = 10;

export interface IngestResult {
  searches: number;
  fetched: number;
  newListings: number;
  events: number;
  reports: SourceReport[];
  errors: string[];
}

interface ListingRow {
  id: string;
  fingerprint: string;
  price: number;
  original_price: number;
  is_active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  relisted_at: string | null;
  images: string[] | null;
}

interface EventInsert {
  listing_id: string;
  kind: string;
  old_value: string | null;
  new_value: string | null;
  detail: string;
  occurred_at: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Collapse listings that are the same apartment on different sites.
 * Returns groups keyed by the id we'll store as the canonical listing.
 */
export function groupByApartment(listings: Listing[]): Map<string, Listing[]> {
  const byFingerprint = new Map<string, Listing[]>();
  for (const listing of listings) {
    const key = fingerprint(listing);
    const bucket = byFingerprint.get(key);
    if (bucket) bucket.push(listing);
    else byFingerprint.set(key, [listing]);
  }

  // Second pass: a listing with no unit number can still be the same flat as one
  // that has it. Fold low-information groups into a confident match.
  const groups = [...byFingerprint.entries()];
  const merged = new Map<string, Listing[]>();
  const consumed = new Set<string>();

  for (const [key, group] of groups) {
    if (consumed.has(key)) continue;
    const combined = [...group];

    for (const [otherKey, other] of groups) {
      if (otherKey === key || consumed.has(otherKey)) continue;
      // Only try to merge when one side lacks a unit; two known-and-different
      // units are genuinely different apartments.
      const confidence = matchConfidence(group[0], other[0]);
      if (confidence >= 0.8) {
        combined.push(...other);
        consumed.add(otherKey);
      }
    }
    consumed.add(key);
    merged.set(key, combined);
  }

  return merged;
}

/**
 * Prefer the richest record as the canonical face of an apartment.
 *
 * StreetEasy usually wins on *data* — it's the only source that reliably has
 * square footage, a real unit number and a proper neighborhood name.
 */
export function pickPrimary(group: Listing[]): Listing {
  const rank = (l: Listing) =>
    (l.source === "streeteasy" ? 3 : l.source === "zillow" ? 2 : 1) +
    (l.sqft ? 1 : 0) +
    (l.unit ? 1 : 0) +
    (l.imageUrl ? 1 : 0);
  return [...group].sort((a, b) => rank(b) - rank(a))[0];
}

/**
 * Which link to open. Deliberately *not* the same choice as pickPrimary: the
 * best data and the best page to actually look at are different sites. Zillow's
 * listing pages are the nicest to use, so they win the click even when
 * StreetEasy supplied the numbers.
 */
/** First non-empty value for a field across the group. */
function firstNonEmpty(group: Listing[], pick: (l: Listing) => string): string {
  for (const listing of group) {
    const value = pick(listing);
    if (value) return value;
  }
  return "";
}

export function pickCanonicalUrl(group: Listing[]): string {
  for (const source of LINK_PREFERENCE) {
    const hit = group.find((l) => l.source === source && l.url);
    if (hit) return hit.url;
  }
  return group.find((l) => l.url)?.url ?? "";
}

/**
 * Last occurrence of each key wins.
 *
 * Needed before any upsert with an ON CONFLICT target: Postgres rejects a
 * statement that would update one row twice, and rejects all of it.
 */
function dedupeBy<T>(rows: T[], key: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(key(row), row);
  return [...byKey.values()];
}

export async function ingest(searches: SavedSearch[]): Promise<IngestResult> {
  // Shared market data is written once for everyone, so it needs the service
  // role: RLS deliberately gives users read-only access to it.
  const supabase = adminDb();
  const startedAt = new Date();
  const nowIso = startedAt.toISOString();
  const errors: string[] = [];
  const allReports: SourceReport[] = [];

  const { data: runRow } = await supabase
    .from("poll_runs")
    .insert({ started_at: nowIso })
    .select("id")
    .single();
  const runId = runRow?.id as number | undefined;

  // 1. Scrape. Identical criteria across searches collapse to one fetch.
  const distinct = new Map<string, SavedSearch>();
  for (const search of searches.filter((s) => s.active)) {
    distinct.set(search.searchKey, search);
  }

  const incoming = new Map<string, Listing>();
  for (const search of distinct.values()) {
    try {
      const { listings, reports } = await runSearch(search.criteria);
      allReports.push(...reports);
      for (const report of reports) {
        if (!report.ok) errors.push(`${report.source}: ${report.message}`);
      }
      for (const listing of listings) incoming.set(listing.id, listing);
    } catch (err) {
      errors.push(`${search.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const fetched = incoming.size;
  if (fetched === 0) {
    if (runId) {
      await supabase
        .from("poll_runs")
        .update({
          finished_at: new Date().toISOString(),
          fetched: 0,
          ok: errors.length === 0,
          message: errors.join("; ").slice(0, 2000),
        })
        .eq("id", runId);
    }
    return {
      searches: distinct.size,
      fetched: 0,
      newListings: 0,
      events: 0,
      reports: allReports,
      errors,
    };
  }

  // 2. Merge cross-site duplicates.
  const groups = groupByApartment([...incoming.values()]);

  // Resolve each group to an existing listing id where we already know one.
  const sourceKeys = [...incoming.values()].map((l) => `${l.source}:${l.sourceId}`);
  const knownSources = new Map<string, string>(); // "source:source_id" -> listing_id
  for (const batch of chunk([...incoming.values()], 200)) {
    const { data } = await supabase
      .from("listing_sources")
      .select("source, source_id, listing_id")
      .in("source_id", batch.map((l) => l.sourceId));
    for (const row of data ?? []) {
      knownSources.set(`${row.source}:${row.source_id}`, row.listing_id);
    }
  }

  const fingerprints = [...groups.keys()];
  const knownFingerprints = new Map<string, ListingRow>();
  for (const batch of chunk(fingerprints, 200)) {
    const { data } = await supabase
      .from("listings")
      .select("id, fingerprint, price, original_price, is_active, first_seen_at, last_seen_at, relisted_at, images")
      .in("fingerprint", batch);
    for (const row of (data ?? []) as ListingRow[]) {
      knownFingerprints.set(row.fingerprint, row);
    }
  }

  const events: EventInsert[] = [];
  const listingUpserts: Record<string, unknown>[] = [];
  const sourceUpserts: Record<string, unknown>[] = [];
  const observations: Record<string, unknown>[] = [];
  const seenSourceKeys = new Set<string>(sourceKeys);
  let newListings = 0;
  /** Rows that collapsed onto an existing id before writing — see step 3. */
  let mergedInBatch = 0;

  for (const [fp, group] of groups) {
    const primary = pickPrimary(group);
    const existingByFp = knownFingerprints.get(fp);
    const existingBySource = group
      .map((l) => knownSources.get(`${l.source}:${l.sourceId}`))
      .find(Boolean);

    const listingId = existingByFp?.id ?? existingBySource ?? primary.id;
    const isNew = !existingByFp && !existingBySource;

    const price = primary.price;
    const previousPrice = existingByFp?.price;
    const priceChanged =
      previousPrice != null && Math.abs(price - previousPrice) > PRICE_NOISE;

    if (isNew) {
      newListings++;
      events.push({
        listing_id: listingId,
        kind: "new",
        old_value: null,
        new_value: String(price),
        detail: `${primary.bedrooms}BR in ${primary.neighborhood || primary.borough || "NYC"}`,
        occurred_at: nowIso,
      });
    } else if (priceChanged) {
      const delta = price - previousPrice!;
      const pct = Math.round((delta / previousPrice!) * 1000) / 10;
      events.push({
        listing_id: listingId,
        kind: delta < 0 ? "price_drop" : "price_rise",
        old_value: String(previousPrice),
        new_value: String(price),
        detail: `${delta < 0 ? "" : "+"}$${delta.toLocaleString()} (${pct}%)`,
        occurred_at: nowIso,
      });
    }

    // Came back after a long absence, or after being marked off-market.
    let relistedAt = existingByFp?.relisted_at ?? null;
    if (existingByFp) {
      const gap = startedAt.getTime() - new Date(existingByFp.last_seen_at).getTime();
      if (!existingByFp.is_active) {
        relistedAt = nowIso;
        events.push({
          listing_id: listingId,
          kind: "back_on_market",
          old_value: null,
          new_value: String(price),
          detail: "Reappeared after being off market",
          occurred_at: nowIso,
        });
      } else if (gap > RELIST_GAP_MS) {
        relistedAt = nowIso;
        events.push({
          listing_id: listingId,
          kind: "relisted",
          old_value: null,
          new_value: String(price),
          detail: `Back after ${Math.round(gap / 86_400_000)} days`,
          occurred_at: nowIso,
        });
      }
    }

    listingUpserts.push({
      id: listingId,
      fingerprint: fp,
      address: primary.address,
      unit: primary.unit,
      neighborhood: primary.neighborhood,
      borough: primary.borough,
      lat: primary.lat,
      lon: primary.lon,
      bedrooms: primary.bedrooms,
      bathrooms: primary.bathrooms,
      sqft: primary.sqft,
      price,
      original_price: existingByFp?.original_price ?? price,
      description: primary.description,
      url: pickCanonicalUrl(group),
      image_url: primary.imageUrl,
      /*
       * The gallery pools across sites: the same unit found on StreetEasy
       * (one lead photo) and HotPads (the whole set) gets the whole set.
       * Photos already stored stay — a source dropping out of one poll
       * shouldn't strip a gallery someone is about to tour with. Primary's
       * hero leads so the card and the gallery open on the same shot.
       */
      images: [
        ...new Set([
          ...primary.images,
          ...group.flatMap((l) => l.images),
          ...(existingByFp?.images ?? []),
        ]),
      ].slice(0, 24),
      available_at: primary.availableAt,
      no_fee: primary.noFee,
      amenities: primary.amenities,
      building_type: primary.buildingType,
      // Contact details come from whichever site has them, not necessarily the
      // one that supplied the rest of the record — only Zillow exposes a phone.
      contact_phone: firstNonEmpty(group, (l) => l.contactPhone),
      contact_name: firstNonEmpty(group, (l) => l.contactName),
      contact_email: firstNonEmpty(group, (l) => l.contactEmail),
      // Concessions: take the best deal any site is advertising for this unit.
      months_free: Math.max(...group.map((l) => l.monthsFree ?? 0), 0),
      lease_months: primary.leaseMonths ?? 12,
      net_effective_rent:
        group.map((l) => l.netEffectiveRent).filter((v): v is number => !!v).sort((a, b) => a - b)[0] ??
        null,
      available_text: firstNonEmpty(group, (l) => l.availableText),
      is_active: true,
      first_seen_at: existingByFp?.first_seen_at ?? nowIso,
      last_seen_at: nowIso,
      price_changed_at: priceChanged ? nowIso : undefined,
      relisted_at: relistedAt,
    });

    for (const listing of group) {
      const key = `${listing.source}:${listing.sourceId}`;
      const alreadyKnown = knownSources.has(key);
      if (!alreadyKnown && !isNew) {
        events.push({
          listing_id: listingId,
          kind: "also_listed_on",
          old_value: null,
          new_value: listing.source,
          detail: `Also appeared on ${listing.source}`,
          occurred_at: nowIso,
        });
      }
      sourceUpserts.push({
        source: listing.source,
        source_id: listing.sourceId,
        listing_id: listingId,
        url: listing.url,
        is_active: true,
        last_seen_at: nowIso,
      });
      observations.push({
        listing_id: listingId,
        source: listing.source,
        source_id: listing.sourceId,
        observed_at: nowIso,
        price: listing.price,
        status: listing.listingStatus,
        content_hash: contentHash(listing),
        payload: listing,
      });
    }
  }

  // 3. Write. Listings first so the foreign keys resolve.
  //
  // Deduplicated by conflict key first. Postgres refuses an ON CONFLICT DO
  // UPDATE that would touch the same row twice in one statement, and it
  // refuses the *whole* statement — so a single collision silently discarded
  // an entire poll. Two fingerprint groups land on one id whenever their
  // sources already point at the same stored listing, which is common: it is
  // the cross-site dedupe working, arriving one scrape too late to have merged
  // the groups. Later wins; they describe the same apartment.
  const dedupedListings = dedupeBy(listingUpserts, (r) => String(r.id));
  const dedupedSources = dedupeBy(sourceUpserts, (r) => `${r.source}:${r.source_id}`);
  const collapsed =
    listingUpserts.length - dedupedListings.length +
    (sourceUpserts.length - dedupedSources.length);
  mergedInBatch += collapsed;
  if (mergedInBatch > 0) {
    allReports.push({
      source: "manual",
      ok: true,
      fetched: 0,
      kept: 0,
      message: `${mergedInBatch} rows merged onto listings already stored`,
    });
  }

  let wrote = 0;
  for (const batch of chunk(dedupedListings, 300)) {
    const { error } = await supabase.from("listings").upsert(batch, { onConflict: "id" });
    if (error) errors.push(`listings upsert: ${error.message}`);
    else wrote += batch.length;
  }

  // Nothing downstream can reference a listing that failed to save, so a
  // failure here would only produce a cascade of foreign-key errors that bury
  // the real one.
  if (wrote === 0 && dedupedListings.length > 0) {
    // Report what persisted, not what was computed. The counts below are
    // derived in memory before any write; returning them after a failed write
    // is how a poll that stored nothing kept reporting a hundred new listings.
    return {
      searches: distinct.size,
      fetched,
      newListings: 0,
      events: 0,
      reports: allReports,
      errors,
    };
  }

  for (const batch of chunk(dedupedSources, 300)) {
    const { error } = await supabase
      .from("listing_sources")
      .upsert(batch, { onConflict: "source,source_id" });
    if (error) errors.push(`listing_sources upsert: ${error.message}`);
  }
  for (const batch of chunk(observations, 300)) {
    const { error } = await supabase.from("observations").insert(batch);
    if (error) errors.push(`observations insert: ${error.message}`);
  }

  // 4. Anything that stopped appearing, from a source that actually answered.
  const healthySources = new Set<Source>(
    allReports.filter((r) => r.ok && r.fetched > 0).map((r) => r.source)
  );
  if (healthySources.size > 0) {
    const { data: stale } = await supabase
      .from("listing_sources")
      .select("source, source_id, listing_id")
      .in("source", [...healthySources])
      .eq("is_active", true)
      .lt("last_seen_at", nowIso);

    /*
     * The circuit breaker.
     *
     * "ok && fetched > 0" is not the same as "answered completely": a source
     * that returns its first page and then rate-limits reports healthy, and
     * everything on its deeper pages would read as delisted. That exact
     * failure flapped half the corpus off- and back-on-market four times in
     * one afternoon — 78 delists at 3pm, 80 resurrections at 4pm.
     *
     * Real markets don't shed a third of their inventory between two polls.
     * If a source's sweep would delist more than 25% of its active rows (and
     * more than 10 of them), the fetch was partial: skip that source's sweep
     * entirely and say so. The listings stay live until a poll that actually
     * saw the whole picture.
     */
    const rows = (stale ?? []).map((row) => ({
      source: row.source as string,
      gone: !seenSourceKeys.has(`${row.source}:${row.source_id}`),
    }));
    const { sweepable, skipped } = sweepPlan(rows);
    for (const skip of skipped) {
      errors.push(
        `sweep skipped for ${skip.source}: would delist ${skip.gone} of ${skip.active} — fetch looks partial`
      );
    }

    const goneIds = new Set<string>();
    const goneKeys: { source: string; source_id: string }[] = [];
    for (const row of stale ?? []) {
      if (!sweepable.has(row.source)) continue;
      if (seenSourceKeys.has(`${row.source}:${row.source_id}`)) continue;
      goneKeys.push({ source: row.source, source_id: row.source_id });
      goneIds.add(row.listing_id);
    }

    for (const batch of chunk(goneKeys, 200)) {
      await supabase
        .from("listing_sources")
        .update({ is_active: false })
        .in("source_id", batch.map((k) => k.source_id))
        .in("source", [...new Set(batch.map((k) => k.source))]);
    }

    // A listing is only off-market once every source carrying it has dropped it.
    if (goneIds.size > 0) {
      const { data: survivors } = await supabase
        .from("listing_sources")
        .select("listing_id")
        .in("listing_id", [...goneIds])
        .eq("is_active", true);
      const stillListed = new Set((survivors ?? []).map((r) => r.listing_id));

      const trulyGone = [...goneIds].filter((id) => !stillListed.has(id));
      for (const batch of chunk(trulyGone, 200)) {
        await supabase
          .from("listings")
          .update({ is_active: false })
          .in("id", batch)
          .eq("is_active", true);
        for (const id of batch) {
          events.push({
            listing_id: id,
            kind: "delisted",
            old_value: null,
            new_value: null,
            detail: "No longer listed on any source",
            occurred_at: nowIso,
          });
        }
      }
    }
  }

  for (const batch of chunk(events, 300)) {
    const { error } = await supabase.from("events").insert(batch);
    if (error) errors.push(`events insert: ${error.message}`);
  }

  // Tell the people who'd want to know — watchers about their listings,
  // everyone hunting about a real drop. Never lets a notification failure
  // fail the poll: the data is already safe, and the bell can catch up.
  try {
    await deliver(await noticesForEvents(events));
  } catch (err) {
    errors.push(`notify: ${err instanceof Error ? err.message : "failed"}`);
  }

  if (runId) {
    await supabase
      .from("poll_runs")
      .update({
        finished_at: new Date().toISOString(),
        fetched,
        new_listings: newListings,
        events: events.length,
        ok: errors.length === 0,
        message: errors.join("; ").slice(0, 2000),
      })
      .eq("id", runId);
  }

  return {
    searches: distinct.size,
    fetched,
    newListings,
    events: events.length,
    reports: allReports,
    errors,
  };
}
