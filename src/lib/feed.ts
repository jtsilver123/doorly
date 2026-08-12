import type {
  ContactChannel,
  ContactLog,
  FeedListing,
  Listing,
  ListingEvent,
  PricePoint,
  SavedSearch,
  Source,
  Stage,
} from "@/types";
import { PIPELINE_STAGES } from "@/types";
import { db, adminDb, currentUserId } from "@/lib/supabase";
import { pipelineOwnerId, crewOf } from "@/lib/crew";
import { DEFAULT_CRITERIA, searchKey, normalizeCriteria, inBounds } from "@/lib/criteria";
import { train, score, stageImpliesLike, type Signal } from "@/lib/rank";
import { addressSansUnit } from "@/lib/parse";
import { fingerprint, extractUnit } from "@/lib/dedupe";
import { boroughFor } from "@/lib/areas";
import { deliver } from "@/lib/notify";
import { DEFAULT_PROFILE, type Profile } from "@/lib/outreach";
import {
  moveInCost,
  moveInFit,
  effectiveRent,
  allInMonthly,
  DEFAULT_COSTS,
} from "@/lib/cost";
import { statsFor, buildCompIndex, readDeal, flagsFor } from "@/lib/market";
import { applyFilters, findPasted, type FeedFilterOptions } from "@/lib/filters";
import { amenitiesOf } from "@/lib/amenities";
import { verdictFor } from "@/lib/verdict";

interface ListingRow {
  id: string;
  fingerprint: string;
  address: string;
  unit: string;
  neighborhood: string;
  borough: string;
  lat: number | null;
  lon: number | null;
  bedrooms: number;
  bathrooms: number;
  sqft: number | null;
  price: number;
  original_price: number;
  description: string;
  url: string;
  image_url: string | null;
  images: string[] | null;
  available_at: string | null;
  no_fee: boolean;
  amenities: string[] | null;
  building_type: string;
  contact_phone: string;
  contact_name: string;
  contact_email: string;
  months_free: number;
  lease_months: number;
  net_effective_rent: number | null;
  available_text: string;
  is_active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  price_changed_at: string | null;
  relisted_at: string | null;
  for_sale: boolean | null;
  sale_price: number | null;
}

interface StateRow {
  listing_id: string;
  stage: Stage;
  stage_changed_at: string | null;
  starred: boolean;
  visited_at: string | null;
  notes: string;
  follow_up_at: string | null;
  follow_up_note: string | null;
  events_seen_at: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_name: string | null;
  tour_at: string | null;
  my_score: number | null;
  lean: number | null;
  app_result: number | null;
  secured: boolean | null;
  amenity_marks: Record<string, string> | null;
  tour_kind: string | null;
  tour_ends_at: string | null;
  added_by: string | null;
  pass_reason: string | null;
  passed_at: string | null;
  poc_user_id: string | null;
  application_url: string | null;
}

function toListing(row: ListingRow, source: Source = "streeteasy"): Listing {
  return {
    id: row.id,
    source,
    sourceId: row.id,
    url: row.url,
    price: row.price,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    sqft: row.sqft,
    neighborhood: row.neighborhood,
    borough: row.borough,
    address: addressSansUnit(row.address, row.unit),
    unit: row.unit,
    lat: row.lat,
    lon: row.lon,
    imageUrl: row.image_url,
    // The gallery never renders empty while a hero photo exists.
    images: row.images?.length ? row.images : row.image_url ? [row.image_url] : [],
    availableAt: row.available_at,
    noFee: row.no_fee,
    amenities: row.amenities ?? [],
    buildingType: row.building_type,
    listingStatus: row.is_active ? "ACTIVE" : "GONE",
    description: row.description,
    contactPhone: row.contact_phone ?? "",
    contactName: row.contact_name ?? "",
    contactEmail: row.contact_email ?? "",
    monthsFree: row.months_free ?? 0,
    leaseMonths: row.lease_months ?? 12,
    netEffectiveRent: row.net_effective_rent ?? null,
    availableText: row.available_text ?? "",
    forSale: row.for_sale ?? false,
    salePrice: row.sale_price ?? null,
  };
}

/**
 * How long a reached-out listing may sit silent before it needs chasing.
 * Two days: long enough not to nag, short enough that in this market the
 * apartment is probably still available.
 */
const FOLLOW_UP_AFTER_DAYS = 2;

function daysBetween(from: string, to = new Date().toISOString()): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/*
 * Supabase answers every query with at most 1,000 rows, and it trims
 * silently: a .limit(4000) comes back as 1,000 with no error. The corpus
 * outgrew that, so bulk reads either walk pages (listings) or go out in
 * id-batches too small to hit the ceiling (per-listing child rows).
 */
const DB_PAGE = 1000;

async function allPages<T>(
  want: number,
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < want; from += DB_PAGE) {
    const to = Math.min(from + DB_PAGE, want) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(`${label}: ${error.message}`);
    const page = (data as T[] | null) ?? [];
    out.push(...page);
    if (page.length < to - from + 1) break;
  }
  return out;
}

async function forListings<T>(
  ids: string[],
  fetchBatch: (batch: string[]) => PromiseLike<{ data: unknown }>
): Promise<T[]> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) batches.push(ids.slice(i, i + 150));
  const results = await Promise.all(batches.map((b) => fetchBatch(b)));
  return results.flatMap((r) => (r.data as T[] | null) ?? []);
}

/**
 * Loads the feed: every listing, joined with your CRM state, scored by the
 * model trained on your own feedback, then filtered and sorted.
 *
 * Scoring happens here rather than at ingest time so that a thumbs-up
 * re-ranks the whole board immediately, without waiting for the next poll.
 */
export async function loadFeed(filters: FeedFilterOptions = {}): Promise<FeedListing[]> {
  const supabase = await db();
  const userId = await currentUserId();
  // In a crew, the pipeline you see is the crew's — the owner's rows. Taste
  // (feedback) stays yours: what to look for is an opinion, the pipeline is
  // the shared work.
  const ownerId = await pipelineOwnerId();

  let query = supabase.from("listings").select("*");

  if (!filters.includeGone) query = query.eq("is_active", true);
  if (filters.priceMin != null) query = query.gte("price", filters.priceMin);
  if (filters.priceMax != null) query = query.lte("price", filters.priceMax);
  if (filters.bedsMin != null) query = query.gte("bedrooms", filters.bedsMin);
  if (filters.bedsMax != null) query = query.lte("bedrooms", filters.bedsMax);
  if (filters.bathsMin != null) query = query.gte("bathrooms", filters.bathsMin);
  if (filters.noFeeOnly) query = query.eq("no_fee", true);

  const ordered = query.order("first_seen_at", { ascending: false });
  const rows = await allPages<ListingRow>(2000, "loadFeed", (from, to) => ordered.range(from, to));

  let listings = rows;

  /*
   * What you're pursuing never vanishes.
   *
   * The active-only filter is right for browsing, but the pipeline is a
   * record of your own work — and one bad poll marking a listing off-market
   * was emptying the board mid-hunt. Anything with real state (starred, or
   * past inbox) rides along regardless of is_active; the card wears its
   * "Off market" tag instead of disappearing.
   */
  if (!filters.includeGone) {
    const { data: trackedRows } = await supabase
      .from("user_listing_state")
      .select("listing_id, stage, starred")
      .eq("user_id", ownerId);
    const trackedIds = (trackedRows ?? [])
      .filter((t) => t.starred || !["inbox", "passed"].includes(t.stage as string))
      .map((t) => t.listing_id as string)
      .filter((id) => !listings.some((l) => l.id === id));
    if (trackedIds.length) {
      const { data: gone } = await supabase
        .from("listings")
        .select("*")
        .in("id", trackedIds);
      listings = [...listings, ...((gone ?? []) as ListingRow[])];
    }
  }

  if (!listings.length) return [];

  const ids = listings.map((r) => r.id);

  const [states, sourceRows, eventRows, contacts, feedbackRows] = await Promise.all([
    supabase.from("user_listing_state").select("*").eq("user_id", ownerId),
    forListings<{ listing_id: string; source: string; url: string; is_active: boolean }>(ids, (batch) =>
      supabase
        .from("listing_sources")
        .select("listing_id, source, url, is_active")
        .in("listing_id", batch)
    ),
    forListings<{ listing_id: string; kind: string; occurred_at: string }>(ids, (batch) =>
      supabase
        .from("events")
        .select("listing_id, kind, occurred_at, old_value, new_value")
        .in("listing_id", batch)
        .order("occurred_at", { ascending: false })
        .limit(DB_PAGE)
    ),
    supabase
      .from("contact_log")
      .select("listing_id, occurred_at, channel, direction")
      .eq("user_id", ownerId),
    supabase.from("feedback").select("listing_id, action, reasons").eq("user_id", userId),
  ]);

  const stateBy = new Map<string, StateRow>(
    ((states.data ?? []) as StateRow[]).map((s) => [s.listing_id, s])
  );

  const sourcesBy = new Map<string, { source: Source; url: string }[]>();
  for (const row of sourceRows) {
    const list = sourcesBy.get(row.listing_id) ?? [];
    list.push({ source: row.source as Source, url: row.url });
    sourcesBy.set(row.listing_id, list);
  }

  const eventsBy = new Map<string, { kind: string; occurred_at: string }[]>();
  for (const row of eventRows) {
    const list = eventsBy.get(row.listing_id) ?? [];
    list.push({ kind: row.kind, occurred_at: row.occurred_at });
    eventsBy.set(row.listing_id, list);
  }

  const contactStats = new Map<
    string,
    {
      count: number;
      last: string | null;
      channel: ContactChannel | null;
      inbound: boolean;
    }
  >();
  for (const row of contacts.data ?? []) {
    const prev =
      contactStats.get(row.listing_id) ??
      { count: 0, last: null, channel: null, inbound: false };
    prev.count++;
    // A reply means the ball is in your court, not theirs — no chase needed.
    if (row.direction === "in") prev.inbound = true;
    if (!prev.last || row.occurred_at > prev.last) {
      prev.last = row.occurred_at;
      prev.channel = row.channel as ContactChannel;
    }
    contactStats.set(row.listing_id, prev);
  }

  // --- train on this user's signals -------------------------------------
  const explicit = new Map<string, { liked: boolean; reasons: string[] }>();
  for (const row of feedbackRows.data ?? []) {
    explicit.set(row.listing_id, {
      liked: row.action === "like",
      // Reason codes scope which features the pass counts against, so a place
      // turned down on price stops teaching the model to avoid its
      // neighborhood. See PASS_REASONS in lib/rank.ts.
      reasons: (row.reasons as string[] | null) ?? [],
    });
  }
  const byId = new Map(listings.map((r) => [r.id, r]));
  const signals: Signal[] = [];
  for (const [listingId, { liked, reasons }] of explicit) {
    const row = byId.get(listingId);
    if (!row) continue;
    /*
     * A pass with no stated reason is read as "something about this listing
     * was wrong", so it counts against every feature at once. That reading
     * is plainly wrong for a place you were approved on: you wanted it
     * enough to file an application, and turning down their yes usually
     * means you took something else. Without a reason there is nothing here
     * to learn, so it trains on nothing rather than on the wrong thing.
     */
    if (!liked && !reasons.length && stateBy.get(listingId)?.app_result === 1) continue;
    signals.push({ listing: toListing(row), liked, reasons });
  }
  for (const [listingId, state] of stateBy) {
    if (explicit.has(listingId)) continue;
    const implied = stageImpliesLike(state.stage);
    if (implied == null) continue;
    const row = byId.get(listingId);
    if (row) signals.push({ listing: toListing(row), liked: implied });
  }
  const model = train(signals);

  // Cost assumptions and the move-in date come from the profile, so the numbers
  // on every card reflect this user's situation rather than a generic default.
  const profile = await loadProfile().catch(() => DEFAULT_PROFILE);
  const costs = profile.costs ?? DEFAULT_COSTS;

  // Rank and rate against the renter's own search rather than a stock one, so
  // "over budget" and "well under your ceiling" mean their numbers.
  const saved = await loadSearches().catch(() => []);
  const criteria =
    saved.find((s) => s.active)?.criteria ?? saved[0]?.criteria ?? DEFAULT_CRITERIA;

  // Comparison set for pricing. Drawn from everything currently tracked, which
  // is what makes "12% under market" a measurement rather than an opinion.
  const corpus = listings.map((r) => ({
    neighborhood: r.neighborhood,
    borough: r.borough,
    bedrooms: r.bedrooms,
    price: r.price,
  }));
  // Bucketed once, read once per listing below. Handing the raw array to
  // statsFor in a loop is quadratic and has taken the Worker down before.
  const comps = buildCompIndex(corpus);

  /*
   * Your feed is your searches.
   *
   * The corpus is communal — every user's pulls land in one pool, which is
   * what keeps it fresh and the comps honest — but the cards and the map
   * should show what *you* asked for, not the East Williamsburg 2-beds
   * somebody else is hunting. So each listing must fit one of your active
   * searches to render, with two exceptions: anything you track (starred or
   * in the pipeline) rides along wherever it is, and the comps above were
   * built from the whole pool on purpose.
   */
  const activeCriteria = saved.filter((s) => s.active).map((s) => s.criteria);

  // --- assemble ----------------------------------------------------------
  const out: FeedListing[] = [];
  for (const row of listings) {
    const state = stateBy.get(row.id);
    const alsoOn = sourcesBy.get(row.id) ?? [];
    const listing = toListing(row, alsoOn[0]?.source ?? "streeteasy");

    const trackedHere =
      Boolean(state?.starred) ||
      !["inbox", "passed"].includes((state?.stage as string) ?? "inbox");
    if (
      activeCriteria.length > 0 &&
      !trackedHere &&
      !activeCriteria.some((c) => inBounds(listing, c))
    ) {
      continue;
    }

    const { score: value, reasons } = score(listing, model, criteria);

    const rowEvents = eventsBy.get(row.id) ?? [];
    const seenAt = state?.events_seen_at;
    const unseen = rowEvents.filter(
      (e) => e.kind !== "new" && (!seenAt || e.occurred_at > seenAt)
    ).length;

    const contact = contactStats.get(row.id);
    const cost = moveInCost(listing, costs);
    const fit = moveInFit(row.available_at, profile.moveInDate);
    const deal = readDeal(row.price, statsFor(listing, comps));

    // The CRM chases itself: anything still parked at "contacted" with no
    // inbound reply after a couple of days gets flagged, so silence surfaces
    // instead of quietly rotting in the pipeline.
    const stage = state?.stage ?? "inbox";
    const needsFollowUp =
      stage === "contacted" &&
      contact?.last != null &&
      !contact.inbound &&
      daysBetween(contact.last) >= FOLLOW_UP_AFTER_DAYS;

    out.push({
      ...listing,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      isActive: row.is_active,
      originalPrice: row.original_price,
      priceChangedAt: row.price_changed_at,
      relistedAt: row.relisted_at,
      alsoOn,
      // The ball's court: an inbound reply anywhere in the thread means the
      // conversation is live and the next move is booking, not chasing.
      hasReply: contact?.inbound ?? false,
      stage: state?.stage ?? "inbox",
      stageChangedAt: state?.stage_changed_at ?? null,
      starred: state?.starred ?? false,
      visitedAt: state?.visited_at ?? null,
      notes: state?.notes ?? "",
      followUpAt: state?.follow_up_at ?? null,
      followUpNote: state?.follow_up_note ?? "",
      myContactPhone: state?.contact_phone ?? "",
      myContactEmail: state?.contact_email ?? "",
      myContactName: state?.contact_name ?? "",
      tourAt: state?.tour_at ?? null,
      myScore: state?.my_score ?? null,
      lean: state?.lean ?? 0,
      appResult: state?.app_result ?? 0,
      secured: Boolean(state?.secured),
      amenityMarks: (state?.amenity_marks as Record<string, "yes" | "no">) ?? {},
      tourKind: state?.tour_kind === "open_house" ? "open_house" : "private",
      tourEndsAt: state?.tour_ends_at ?? null,
      passReason: state?.pass_reason ?? "",
      applicationUrl: state?.application_url ?? "",
      passedAt: state?.passed_at ?? null,
      addedById: state?.added_by ?? null,
      pocId: state?.poc_user_id ?? null,
      contactCount: contact?.count ?? 0,
      lastContactAt: contact?.last ?? null,
      lastContactChannel: contact?.channel ?? null,
      score: value,
      scoreReasons: reasons,
      perks: amenitiesOf(listing),
      rating: 0,
      grade: "fair",
      ratingHeadline: "",
      pros: [],
      cons: [],
      daysOnMarket: daysBetween(row.first_seen_at),
      unseenEvents: unseen,
      needsFollowUp,
      upfrontCost: cost.total,
      dealVerdict: deal.verdict,
      dealDelta: deal.percentVsMedian,
      dealLabel: deal.label,
      flags: [],
      effectiveRent: effectiveRent(listing),
      allInMonthly: allInMonthly(listing, costs),
      timing: fit.timing,
      timingLabel: fit.label,
      priceHistory: [],
    });
  }

  // Flags depend on fields only present once the row is fully assembled (days
  // on market, how many sites carry it), so they're a second pass — and the
  // rating depends on the flags, so it comes after them in the same pass.
  for (const listing of out) {
    listing.flags = flagsFor(listing, {
      verdict: listing.dealVerdict,
      percentVsMedian: listing.dealDelta,
      stats: statsFor(listing, comps),
      label: listing.dealLabel,
    });
    const verdict = verdictFor(listing, criteria);
    listing.rating = verdict.rating;
    listing.grade = verdict.grade;
    listing.ratingHeadline = verdict.headline;
    listing.pros = verdict.pros;
    listing.cons = verdict.cons;
  }

  return applyFilters(out, filters);
}

/**
 * One corpus listing, dressed exactly the way the guest feed dresses them:
 * rated against stock criteria, sources and events attached, no personal
 * state. For the signed-in reader whose own feed doesn't reach a shared
 * place — someone else's find, outside their search.
 *
 * The impossible price floor is doing the work: it empties the guest
 * window, and ensureId puts the one listing back — so the whole mapping
 * pipeline runs for exactly one row instead of being duplicated here.
 */
export async function loadSharedListing(id: string): Promise<FeedListing | null> {
  const rows = await loadGuestFeed({}, id, true);
  return rows.find((l) => l.id === id) ?? null;
}

/**
 * The feed a visitor sees before they have an account.
 *
 * The whole pitch is "this is what hunting looks like in here", and an empty
 * screen behind a login wall makes that pitch with its hands tied. Guests get
 * the shared corpus — real listings, real ratings against stock criteria —
 * and none of anyone's personal state: no stages, no contacts, no notes, no
 * documents. Reads go through the service role because the corpus tables
 * don't grant the anonymous role anything; the personal tables are never
 * touched at all, so there is nothing here RLS would have protected.
 */
export async function loadGuestFeed(
  filters: FeedFilterOptions = {},
  /**
   * A listing this feed must contain, whatever the window says. A shared
   * link's whole job is opening the place it names, and "the 400 newest"
   * is an implementation detail no recipient should be able to fall off
   * of — including when the place has gone off market, which is itself
   * information the recipient came for.
   */
  ensureId?: string,
  /**
   * Just the ensured listing, nothing else. The window query is skipped
   * entirely rather than filtered into emptiness — an earlier version
   * asked for an impossible price floor to achieve this, and the floor it
   * picked overflowed Postgres's integer, 500ing every shared link whose
   * listing wasn't already in the window.
   */
  onlyEnsured = false
): Promise<FeedListing[]> {
  const supabase = adminDb();

  let query = supabase.from("listings").select("*").eq("is_active", true);
  if (filters.priceMin != null) query = query.gte("price", filters.priceMin);
  if (filters.priceMax != null) query = query.lte("price", filters.priceMax);
  if (filters.bedsMin != null) query = query.gte("bedrooms", filters.bedsMin);
  if (filters.bedsMax != null) query = query.lte("bedrooms", filters.bedsMax);
  if (filters.bathsMin != null) query = query.gte("bathrooms", filters.bathsMin);
  if (filters.noFeeOnly) query = query.eq("no_fee", true);

  const { data: rows, error } = onlyEnsured
    ? { data: [] as ListingRow[], error: null }
    : await query.order("first_seen_at", { ascending: false }).limit(400);
  if (error) throw new Error(`loadGuestFeed: ${error.message}`);
  const listings = (rows ?? []) as ListingRow[];

  if (ensureId && !listings.some((r) => r.id === ensureId)) {
    const { data: one } = await supabase
      .from("listings")
      .select("*")
      .eq("id", ensureId)
      .maybeSingle();
    if (one) listings.unshift(one as ListingRow);
  }
  if (!listings.length) return [];

  const ids = listings.map((r) => r.id);
  const [sourceRows, eventRows] = await Promise.all([
    forListings<{ listing_id: string; source: string; url: string }>(ids, (batch) =>
      supabase
        .from("listing_sources")
        .select("listing_id, source, url, is_active")
        .in("listing_id", batch)
    ),
    forListings<{ listing_id: string; kind: string; occurred_at: string }>(ids, (batch) =>
      supabase
        .from("events")
        .select("listing_id, kind, occurred_at")
        .in("listing_id", batch)
        .order("occurred_at", { ascending: false })
        .limit(DB_PAGE)
    ),
  ]);

  const sourcesBy = new Map<string, { source: Source; url: string }[]>();
  for (const row of sourceRows) {
    const list = sourcesBy.get(row.listing_id) ?? [];
    list.push({ source: row.source as Source, url: row.url });
    sourcesBy.set(row.listing_id, list);
  }
  const eventsBy = new Map<string, { kind: string; occurred_at: string }[]>();
  for (const row of eventRows) {
    const list = eventsBy.get(row.listing_id) ?? [];
    list.push({ kind: row.kind, occurred_at: row.occurred_at });
    eventsBy.set(row.listing_id, list);
  }

  // Stock taste: no signals to learn from, stock criteria to rate against.
  const model = train([]);
  const costs = DEFAULT_COSTS;
  const criteria = DEFAULT_CRITERIA;
  const corpus = listings.map((r) => ({
    neighborhood: r.neighborhood,
    borough: r.borough,
    bedrooms: r.bedrooms,
    price: r.price,
  }));
  // Bucketed once, read once per listing below. Handing the raw array to
  // statsFor in a loop is quadratic and has taken the Worker down before.
  const comps = buildCompIndex(corpus);

  const out: FeedListing[] = [];
  for (const row of listings) {
    const alsoOn = sourcesBy.get(row.id) ?? [];
    const listing = toListing(row, alsoOn[0]?.source ?? "streeteasy");
    const { score: value, reasons } = score(listing, model, criteria);
    const cost = moveInCost(listing, costs);
    const deal = readDeal(row.price, statsFor(listing, comps));

    out.push({
      ...listing,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      isActive: row.is_active,
      originalPrice: row.original_price,
      priceChangedAt: row.price_changed_at,
      relistedAt: row.relisted_at,
      alsoOn,
      hasReply: false,
      stage: "inbox",
      stageChangedAt: null,
      starred: false,
      visitedAt: null,
      notes: "",
      followUpAt: null,
      followUpNote: "",
      myContactPhone: "",
      myContactEmail: "",
      myContactName: "",
      tourAt: null,
      myScore: null,
      lean: 0,
      appResult: 0,
      secured: false,
      amenityMarks: {},
      tourKind: "private",
      tourEndsAt: null,
      passReason: "",
      applicationUrl: "",
      passedAt: null,
      addedById: null,
      pocId: null,
      contactCount: 0,
      lastContactAt: null,
      lastContactChannel: null,
      score: value,
      scoreReasons: reasons,
      perks: amenitiesOf(listing),
      rating: 0,
      grade: "fair",
      ratingHeadline: "",
      pros: [],
      cons: [],
      daysOnMarket: daysBetween(row.first_seen_at),
      unseenEvents: 0,
      needsFollowUp: false,
      upfrontCost: cost.total,
      dealVerdict: deal.verdict,
      dealDelta: deal.percentVsMedian,
      dealLabel: deal.label,
      flags: [],
      effectiveRent: effectiveRent(listing),
      allInMonthly: allInMonthly(listing, costs),
      timing: moveInFit(row.available_at, DEFAULT_PROFILE.moveInDate).timing,
      timingLabel: moveInFit(row.available_at, DEFAULT_PROFILE.moveInDate).label,
      priceHistory: [],
    });
  }

  for (const listing of out) {
    listing.flags = flagsFor(listing, {
      verdict: listing.dealVerdict,
      percentVsMedian: listing.dealDelta,
      stats: statsFor(listing, comps),
      label: listing.dealLabel,
    });
    const verdict = verdictFor(listing, criteria);
    listing.rating = verdict.rating;
    listing.grade = verdict.grade;
    listing.ratingHeadline = verdict.headline;
    listing.pros = verdict.pros;
    listing.cons = verdict.cons;
  }

  return applyFilters(out, filters);
}

/** Everything known about one listing, for the detail view. */
export async function loadListingDetail(id: string): Promise<{
  events: ListingEvent[];
  contacts: ContactLog[];
  priceHistory: PricePoint[];
} | null> {
  const supabase = await db();

  const [events, contacts, observations] = await Promise.all([
    supabase
      .from("events")
      .select("*")
      .eq("listing_id", id)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("contact_log")
      .select("*")
      .eq("listing_id", id)
      .eq("user_id", await pipelineOwnerId())
      .order("occurred_at", { ascending: false }),
    supabase
      .from("observations")
      .select("price, observed_at")
      .eq("listing_id", id)
      .order("observed_at", { ascending: true }),
  ]);

  // Collapse consecutive identical prices into change points.
  const priceHistory: PricePoint[] = [];
  for (const row of observations.data ?? []) {
    const price = row.price as number | null;
    if (price == null) continue;
    const last = priceHistory[priceHistory.length - 1];
    if (!last || last.price !== price) {
      priceHistory.push({ price, at: row.observed_at as string });
    }
  }

  return {
    events: ((events.data ?? []) as Record<string, unknown>[]).map((e) => ({
      id: e.id as number,
      listingId: e.listing_id as string,
      kind: e.kind as ListingEvent["kind"],
      oldValue: (e.old_value as string) ?? null,
      newValue: (e.new_value as string) ?? null,
      detail: (e.detail as string) ?? "",
      occurredAt: e.occurred_at as string,
      acknowledged: true,
    })),
    contacts: ((contacts.data ?? []) as Record<string, unknown>[]).map((c) => ({
      id: c.id as number,
      listingId: c.listing_id as string,
      channel: c.channel as ContactLog["channel"],
      direction: c.direction as "out" | "in",
      who: (c.who as string) ?? "",
      note: (c.note as string) ?? "",
      occurredAt: c.occurred_at as string,
    })),
    priceHistory,
  };
}

/**
 * A listing's public record for a visitor: the corpus's events and price
 * history, nobody's contact log. Served so the demo drawer shows the price
 * chart and the timeline instead of a spinner that never resolves — and
 * because none of this is personal, it was only ever behind the login by
 * accident of plumbing.
 */
export async function loadGuestListingDetail(id: string): Promise<{
  events: ListingEvent[];
  contacts: ContactLog[];
  priceHistory: PricePoint[];
}> {
  const supabase = adminDb();
  const [events, observations] = await Promise.all([
    supabase
      .from("events")
      .select("*")
      .eq("listing_id", id)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("observations")
      .select("price, observed_at")
      .eq("listing_id", id)
      .order("observed_at", { ascending: true }),
  ]);

  const priceHistory: PricePoint[] = [];
  for (const row of observations.data ?? []) {
    const price = row.price as number | null;
    if (price == null) continue;
    const last = priceHistory[priceHistory.length - 1];
    if (!last || last.price !== price) {
      priceHistory.push({ price, at: row.observed_at as string });
    }
  }

  return {
    events: ((events.data ?? []) as Record<string, unknown>[]).map((e) => ({
      id: e.id as number,
      listingId: e.listing_id as string,
      kind: e.kind as ListingEvent["kind"],
      oldValue: (e.old_value as string) ?? null,
      newValue: (e.new_value as string) ?? null,
      detail: (e.detail as string) ?? "",
      occurredAt: e.occurred_at as string,
      acknowledged: true,
    })),
    contacts: [],
    priceHistory,
  };
}

/** The "what changed" feed across every listing. */
export async function loadChanges(limit = 200): Promise<
  (ListingEvent & { address: string; neighborhood: string; price: number; url: string })[]
> {
  const supabase = await db();
  const { data } = await supabase
    .from("events")
    .select("*, listings(address, unit, neighborhood, price, url)")
    .neq("kind", "new")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as Record<string, unknown>[]).map((e) => {
    const listing = (e.listings ?? {}) as Record<string, unknown>;
    return {
      id: e.id as number,
      listingId: e.listing_id as string,
      kind: e.kind as ListingEvent["kind"],
      oldValue: (e.old_value as string) ?? null,
      newValue: (e.new_value as string) ?? null,
      detail: (e.detail as string) ?? "",
      occurredAt: e.occurred_at as string,
      acknowledged: false,
      address: `${listing.address ?? ""}${listing.unit ? ` #${listing.unit}` : ""}`,
      neighborhood: (listing.neighborhood as string) ?? "",
      price: (listing.price as number) ?? 0,
      url: (listing.url as string) ?? "",
    };
  });
}

// --- writes ---------------------------------------------------------------

export async function setStage(listingId: string, stage: Stage): Promise<void> {
  const supabase = await db();
  const owner = await pipelineOwnerId();
  const me = await currentUserId();
  const now = new Date().toISOString();

  // Attribution survives every later move: whoever first put the place in
  // the pipeline stays its "added by", however far it travels after that.
  const { data: existing } = await supabase
    .from("user_listing_state")
    .select("added_by, stage")
    .eq("user_id", owner)
    .eq("listing_id", listingId)
    .maybeSingle();

  await supabase.from("user_listing_state").upsert(
    {
      user_id: owner,
      listing_id: listingId,
      stage,
      stage_changed_at: now,
      updated_at: now,
      added_by: existing?.added_by ?? me,
    },
    { onConflict: "user_id,listing_id" }
  );

  /*
   * Tag-team: a place entering the shared pipeline is news to everyone who
   * didn't put it there. Only on the *entry* transition — advancing a card
   * through stages is work, not news, and a channel that reports work gets
   * muted inside a week.
   */
  const wasIn = existing != null && !["inbox", "passed"].includes((existing as { stage?: string }).stage ?? "inbox");
  const entering = PIPELINE_STAGES.includes(stage) && !wasIn;
  if (entering) {
    try {
      const crew = await crewOf(me);
      if (crew && crew.members.length > 1) {
        const { data: listing } = await supabase
          .from("listings")
          .select("address, unit, neighborhood, price")
          .eq("id", listingId)
          .maybeSingle();
        const who =
          crew.members.find((m) => m.userId === me)?.name ?? "Someone";
        const name = listing
          ? `${listing.address}${listing.unit ? ` #${listing.unit}` : ""}`
          : "a place";
        await deliver(
          crew.members
            .filter((m) => m.userId !== me)
            .map((m) => ({
              userId: m.userId,
              kind: "crew_add" as const,
              listingId,
              title: `${who} added ${name}`,
              body: listing
                ? `$${Number(listing.price).toLocaleString()}/mo · ${listing.neighborhood ?? ""}`
                : "",
            }))
        );
      }
    } catch {
      /* the stage change already saved; the bell can miss one */
    }
  }

  // Moving a card is itself a preference signal, so mirror it into feedback.
  // Feedback is the mover's own — taste stays personal even in a crew.
  const implied = stageImpliesLike(stage);
  if (implied != null) {
    await supabase.from("feedback").upsert(
      {
        user_id: me,
        listing_id: listingId,
        action: implied ? "like" : "pass",
        created_at: now,
      },
      { onConflict: "user_id,listing_id" }
    );
  }
}

export async function setListingFields(
  listingId: string,
  fields: Partial<{
    starred: boolean;
    notes: string;
    follow_up_at: string | null;
    visited_at: string | null;
    events_seen_at: string | null;
    contact_phone: string;
    contact_email: string;
    contact_name: string;
    pass_reason: string;
    passed_at: string | null;
    tour_at: string | null;
    my_score: number | null;
    lean: number;
    app_result: number;
    secured: boolean;
    tour_kind: string;
    tour_ends_at: string | null;
    poc_user_id: string | null;
    application_url: string;
  }>
): Promise<void> {
  const supabase = await db();
  await supabase.from("user_listing_state").upsert(
    {
      user_id: await pipelineOwnerId(),
      listing_id: listingId,
      ...fields,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,listing_id" }
  );
}

export async function recordFeedback(
  listingId: string,
  action: "like" | "pass",
  /** Pass reason codes, which scope what the model learns. See lib/rank.ts. */
  reasons: string[] = []
): Promise<void> {
  const supabase = await db();
  await supabase.from("feedback").upsert(
    {
      user_id: await currentUserId(),
      listing_id: listingId,
      action,
      reasons: action === "pass" ? reasons : [],
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id,listing_id" }
  );
  // Routed through passListing, not a bare setStage: a thumbs-down on a
  // place you already toured is an outcome (no_go), not triage (passed).
  if (action === "pass") await passListing(listingId);

  // A like is a pipeline event, not just a training signal: anything you
  // liked belongs on the board as interested — unless it's already further
  // along, in which case there's nothing to promote.
  if (action === "like") {
    const owner = await pipelineOwnerId();
    const { data: state } = await supabase
      .from("user_listing_state")
      .select("stage")
      .eq("user_id", owner)
      .eq("listing_id", listingId)
      .maybeSingle();
    const stage = state?.stage ?? "inbox";
    if (stage === "inbox" || stage === "passed") {
      await setStage(listingId, "interested");
    }
  }
}

/**
 * Undo a pass.
 *
 * Triage is fast and keyboard-driven, which means it will sometimes be wrong —
 * one stray keystroke and a flat you wanted is gone. Reversing it has to clear
 * the training signal too, otherwise the ranker keeps learning from a mistake
 * you already took back.
 */
/**
 * Take it out of the running, optionally saying why.
 *
 * The reason is for whoever put it in the pipeline — in a crew that's often
 * somebody else, and a place that silently disappears teaches the person who
 * volunteered to help absolutely nothing.
 */
export async function passListing(
  listingId: string,
  reason = "",
  /**
   * Reason codes, which are a different thing from the note above them: the
   * note is written for a crew-mate, the codes are an input to the ranking
   * model. Kept apart because they answer to different readers.
   */
  reasons: string[] = []
): Promise<void> {
  const supabase = await db();
  const owner = await pipelineOwnerId();
  const now = new Date().toISOString();
  /*
   * Two different kinds of "no": dismissing something you never saw is
   * triage, but declining a place you actually walked through is an outcome —
   * it belongs in the board's loss column, not the same bin as a hundred
   * swiped-away cards. The reason rides on the shared state row either way.
   */
  const { data: state } = await supabase
    .from("user_listing_state")
    .select("stage")
    .eq("user_id", owner)
    .eq("listing_id", listingId)
    .maybeSingle();
  const seenIt = ["toured", "applied", "no_go"].includes(state?.stage ?? "inbox");
  await supabase.from("user_listing_state").upsert(
    {
      user_id: owner,
      listing_id: listingId,
      stage: seenIt ? "no_go" : "passed",
      stage_changed_at: now,
      pass_reason: reason.slice(0, 500),
      passed_at: now,
      updated_at: now,
    },
    { onConflict: "user_id,listing_id" }
  );

  /*
   * The pass is also a training signal, and this is the only path that knows
   * the codes. Written as the passer rather than the pipeline owner: a crew
   * shares a board, but taste stays personal.
   */
  await supabase.from("feedback").upsert(
    {
      user_id: await currentUserId(),
      listing_id: listingId,
      action: "pass",
      reasons,
      created_at: now,
    },
    { onConflict: "user_id,listing_id" }
  );
}

export async function undoPass(listingId: string): Promise<void> {
  const supabase = await db();
  const owner = await pipelineOwnerId();
  await supabase
    .from("feedback")
    .delete()
    .eq("user_id", await currentUserId())
    .eq("listing_id", listingId);
  // Un-declining a place you toured puts it back where the decline happened —
  // you still saw it, so it returns to "toured", not to the top of the funnel.
  const { data: state } = await supabase
    .from("user_listing_state")
    .select("stage")
    .eq("user_id", owner)
    .eq("listing_id", listingId)
    .maybeSingle();
  await supabase.from("user_listing_state").upsert(
    {
      user_id: owner,
      listing_id: listingId,
      stage: state?.stage === "no_go" ? "toured" : "inbox",
      stage_changed_at: new Date().toISOString(),
      // Back in the running means the reason no longer applies.
      pass_reason: "",
      passed_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,listing_id" }
  );
}

export async function addContact(
  listingId: string,
  entry: {
    channel: ContactLog["channel"];
    direction: "out" | "in";
    who?: string;
    note?: string;
  }
): Promise<void> {
  const supabase = await db();
  await supabase.from("contact_log").insert({
    user_id: await pipelineOwnerId(),
    listing_id: listingId,
    channel: entry.channel,
    direction: entry.direction,
    who: entry.who ?? "",
    note: entry.note ?? "",
    occurred_at: new Date().toISOString(),
  });
}

// --- saved searches -------------------------------------------------------

export async function loadSearches(): Promise<SavedSearch[]> {
  const supabase = await db();
  const { data } = await supabase
    .from("saved_searches")
    .select("*")
    .eq("user_id", await currentUserId())
    .order("created_at", { ascending: true });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as number,
    label: row.label as string,
    criteria: normalizeCriteria(row.criteria as Record<string, never>),
    searchKey: row.search_key as string,
    active: Boolean(row.active),
  }));
}

/**
 * Every active search across every account, for the scheduled poll.
 *
 * Runs with the service role because a cron job has no session. Identical
 * criteria collapse by search_key downstream, so two users watching the same
 * neighborhoods cost one scrape, not two — the whole reason market data is
 * shared rather than per-user.
 */
export async function loadAllActiveSearches(): Promise<SavedSearch[]> {
  const { data, error } = await adminDb()
    .from("saved_searches")
    .select("*")
    .eq("active", true);
  if (error) throw new Error(`loadAllActiveSearches: ${error.message}`);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as number,
    label: row.label as string,
    criteria: normalizeCriteria(row.criteria as Record<string, never>),
    searchKey: row.search_key as string,
    active: true,
    userId: (row.user_id as string) ?? undefined,
  }));
}

/** Guarantees at least one search exists, so a fresh install polls something. */
export async function ensureDefaultSearch(): Promise<SavedSearch[]> {
  const existing = await loadSearches();
  if (existing.length) return existing;

  const supabase = await db();
  await supabase.from("saved_searches").insert({
    user_id: await currentUserId(),
    label: "Studio / 1BR downtown",
    criteria: DEFAULT_CRITERIA,
    search_key: searchKey(DEFAULT_CRITERIA),
    active: true,
  });
  return loadSearches();
}

// --- profile --------------------------------------------------------------

export async function loadProfile(): Promise<Profile> {
  const supabase = await db();
  const { data } = await supabase
    .from("user_profile")
    .select("profile")
    .eq("user_id", await currentUserId())
    .maybeSingle();
  return { ...DEFAULT_PROFILE, ...((data?.profile as Partial<Profile>) ?? {}) };
}

export async function saveProfile(profile: Partial<Profile>): Promise<void> {
  const supabase = await db();
  const merged = { ...(await loadProfile()), ...profile };
  await supabase
    .from("user_profile")
    .upsert(
      { user_id: await currentUserId(), profile: merged, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
}

/**
 * Record your own answer to an amenity question — or clear it with null to
 * defer back to what the listing says. Read-modify-write on the jsonb map,
 * because a blind upsert of the whole column would erase the other answers.
 */
export async function setAmenityMark(
  listingId: string,
  key: string,
  fact: "yes" | "no" | null
): Promise<void> {
  const supabase = await db();
  const ownerId = await pipelineOwnerId();
  const { data } = await supabase
    .from("user_listing_state")
    .select("amenity_marks")
    .eq("user_id", ownerId)
    .eq("listing_id", listingId)
    .maybeSingle();
  const marks = { ...((data?.amenity_marks as Record<string, string>) ?? {}) };
  if (fact) marks[key] = fact;
  else delete marks[key];
  await supabase.from("user_listing_state").upsert(
    {
      user_id: ownerId,
      listing_id: listingId,
      amenity_marks: marks,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,listing_id" }
  );
}

/**
 * Find a pasted address or link anywhere in the shared corpus.
 *
 * The feed the browser holds is scoped to your saved searches, and that's the
 * wrong pool for quick-add: pasting a link is a manual decision, and "it's
 * $200 over your ceiling" is not a reason to pretend the apartment doesn't
 * exist. This searches everything the pollers have ever kept, criteria be
 * damned — the caller then tracks the hit, and tracked places ride into the
 * feed regardless of criteria by the same exception everything tracked uses.
 *
 * The rows are dressed as minimal FeedListings so the ONE matcher (findPasted,
 * shared with the browser) does the matching — a second server-side matcher
 * would drift from the first within a month.
 */
/**
 * The targeted pull behind a quick-add miss: one place, one upstream
 * request, straight into the corpus.
 *
 * Before this, a pasted address the corpus didn't know triggered a full
 * poll — every source, every area, every configured page — to find one
 * apartment. Now the paste itself is the search term: the byaddress
 * endpoint takes a street address as its location, the results are
 * upserted the same shape the poller writes, and the id of the closest
 * match comes back for adoption. Returns null when the sources genuinely
 * don't have it.
 */
export async function pullListingByAddress(term: string): Promise<string | null> {
  const { fetchZillowOne } = await import("@/lib/sources/zillow");
  const found = await fetchZillowOne(term);
  if (!found.length) return null;

  const supabase = adminDb();
  const now = new Date().toISOString();
  // A building query can return several units; keep a handful so the person
  // lands on the right one even if the parse was loose.
  const keep = found.slice(0, 5);
  for (const listing of keep) {
    // Insert if new, refresh if known — split on purpose, because a blanket
    // upsert would stomp original_price and first_seen_at on a relist, and
    // those two columns are the whole price-drop story.
    const { error } = await supabase.from("listings").upsert(
      {
        id: listing.id,
        fingerprint: fingerprint(listing),
        address: listing.address,
        unit: listing.unit,
        neighborhood: listing.neighborhood,
        borough: listing.borough,
        lat: listing.lat,
        lon: listing.lon,
        bedrooms: listing.bedrooms,
        bathrooms: listing.bathrooms,
        sqft: listing.sqft,
        price: listing.price,
        original_price: listing.price,
        description: listing.description,
        url: listing.url,
        image_url: listing.imageUrl,
        available_at: listing.availableAt,
        no_fee: listing.noFee,
        building_type: listing.buildingType,
        contact_phone: listing.contactPhone,
        contact_name: listing.contactName,
        contact_email: listing.contactEmail,
        is_active: true,
        last_seen_at: now,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
    if (error) throw new Error(`pullListingByAddress: ${error.message}`);
    await supabase
      .from("listings")
      .update({ price: listing.price, is_active: true, last_seen_at: now, url: listing.url })
      .eq("id", listing.id);
    await supabase.from("listing_sources").upsert(
      {
        source: listing.source,
        source_id: listing.sourceId,
        listing_id: listing.id,
        url: listing.url,
        is_active: true,
        last_seen_at: now,
      },
      { onConflict: "source,source_id" }
    );
  }

  // The paste text itself decides which of the pulled units is the one.
  const best = findPasted(
    keep.map((l) => ({
      id: l.id,
      address: l.address,
      unit: l.unit,
      neighborhood: l.neighborhood,
      notes: "",
      url: l.url,
      alsoOn: [],
    })) as unknown as FeedListing[],
    term
  );
  return best?.id ?? keep[0].id;
}

export async function findInCorpus(query: string): Promise<string | null> {
  const supabase = await db();
  const rows = await allPages<{
    id: string;
    address: string | null;
    unit: string | null;
    neighborhood: string | null;
    url: string | null;
  }>(4000, "findInCorpus", (from, to) =>
    supabase
      .from("listings")
      .select("id, address, unit, neighborhood, url")
      .eq("is_active", true)
      .order("first_seen_at", { ascending: false })
      .range(from, to)
  );
  const srcs = await forListings<{ listing_id: string; source: string; url: string }>(
    rows.map((r) => r.id),
    (batch) => supabase.from("listing_sources").select("listing_id, source, url").in("listing_id", batch)
  );
  const alsoBy = new Map<string, { source: Source; url: string }[]>();
  for (const s of srcs) {
    const list = alsoBy.get(s.listing_id) ?? [];
    list.push({ source: s.source as Source, url: s.url });
    alsoBy.set(s.listing_id, list);
  }
  const stubs = rows.map((r) => ({
    id: r.id,
    address: r.address ?? "",
    unit: r.unit ?? "",
    neighborhood: r.neighborhood ?? "",
    notes: "",
    url: r.url ?? "",
    alsoOn: alsoBy.get(r.id) ?? [],
    stage: "inbox",
    rating: 0,
  })) as unknown as FeedListing[];
  return findPasted(stubs, query)?.id ?? null;
}

// --- manual entry ---------------------------------------------------------

export interface ManualListing {
  url: string;
  /** Where the tip came from; "facebook" keeps its badge and back-link. */
  source?: "manual" | "facebook";
  address: string;
  price: number;
  bedrooms?: number;
  bathrooms?: number;
  neighborhood?: string;
  unit?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  notes?: string;
  /**
   * On the market to buy, added to pitch the owner on renting instead.
   * `price` is then the rent you'd propose; `salePrice` is their ask.
   */
  forSale?: boolean;
  salePrice?: number;
}

/**
 * Add a place the scrapers never saw — a friend's tip, a broker's email, a
 * "for rent" sign. It lands in the same pipeline as everything else, so the
 * CRM covers your whole search rather than only the automated part.
 *
 * Manual listings carry source "manual", which no poll reports on, so the
 * disappearance sweep in ingest.ts can never mark them off-market.
 */
export async function addManualListing(input: ManualListing): Promise<string> {
  // The corpus tables only accept the service role — the same door the
  // pollers use. The API route above this checks for a signed-in user
  // before calling; this function must never be reachable unauthenticated.
  const supabase = adminDb();
  const now = new Date().toISOString();
  // Facebook-group pastes keep their provenance: the badge says where the
  // tip came from, and the url points back at the post.
  const src = input.source === "facebook" ? "facebook" : "manual";
  const id = `${src}-${Date.now().toString(36)}`;

  const listing: Listing = {
    id,
    source: src,
    sourceId: id,
    url: input.url,
    price: Math.round(input.price),
    bedrooms: input.bedrooms ?? 0,
    bathrooms: input.bathrooms ?? 1,
    sqft: null,
    neighborhood: input.neighborhood ?? "",
    borough: boroughFor(`${input.neighborhood ?? ""} ${input.address}`),
    // The unit leaves the address once extracted, or every renderer that
    // prints "address #unit" would say the unit twice.
    address: (() => {
      const u = input.unit ?? extractUnit(input.address);
      return u
        ? input.address
            .replace(new RegExp(`\\s*(?:#|Apt\\.?|Unit)\\s*${u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "")
            .trim()
        : input.address;
    })(),
    unit: input.unit ?? extractUnit(input.address),
    lat: null,
    lon: null,
    imageUrl: null,
    images: [],
    availableAt: null,
    noFee: false,
    amenities: [],
    buildingType: "",
    listingStatus: "ACTIVE",
    description: input.notes ?? "",
    contactPhone: input.contactPhone ?? "",
    contactName: input.contactName ?? "",
    contactEmail: input.contactEmail ?? "",
    availableText: "",
    monthsFree: 0,
    leaseMonths: 12,
    netEffectiveRent: null,
    forSale: input.forSale ?? false,
    salePrice: input.salePrice ?? null,
  };

  const { error } = await supabase.from("listings").insert({
    id,
    fingerprint: fingerprint(listing),
    address: listing.address,
    unit: listing.unit,
    neighborhood: listing.neighborhood,
    borough: listing.borough,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    price: listing.price,
    original_price: listing.price,
    description: listing.description,
    url: listing.url,
    contact_phone: listing.contactPhone,
    contact_name: listing.contactName,
    contact_email: listing.contactEmail,
    for_sale: listing.forSale ?? false,
    sale_price: listing.salePrice ?? null,
    is_active: true,
    first_seen_at: now,
    last_seen_at: now,
  });
  if (error) throw new Error(`addManualListing: ${error.message}`);

  await supabase.from("listing_sources").insert({
    source: src,
    source_id: id,
    listing_id: id,
    url: listing.url,
    is_active: true,
    first_seen_at: now,
    last_seen_at: now,
  });

  await supabase.from("events").insert({
    listing_id: id,
    kind: "new",
    new_value: String(listing.price),
    detail: listing.forSale
      ? "For sale. The plan is to pitch the owner on renting it"
      : src === "facebook"
        ? "From a Facebook group"
        : "Added by hand",
    occurred_at: now,
  });

  if (input.notes) await setListingFields(id, { notes: input.notes });
  await setStage(id, "interested");
  return id;
}
