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
import { db, adminDb, currentUserId } from "@/lib/supabase";
import { DEFAULT_CRITERIA, searchKey, normalizeCriteria } from "@/lib/criteria";
import { train, score, stageImpliesLike, type Signal } from "@/lib/rank";
import { fingerprint, extractUnit } from "@/lib/dedupe";
import { boroughFor } from "@/lib/areas";
import { DEFAULT_PROFILE, type Profile } from "@/lib/outreach";
import {
  moveInCost,
  moveInFit,
  effectiveRent,
  allInMonthly,
  DEFAULT_COSTS,
} from "@/lib/cost";
import { statsFor, readDeal, flagsFor } from "@/lib/market";

export interface FeedFilters {
  stage?: Stage | "all" | "active";
  source?: Source | "all";
  areas?: string[];
  priceMin?: number;
  priceMax?: number;
  bedsMin?: number;
  bedsMax?: number;
  noFeeOnly?: boolean;
  changedOnly?: boolean;
  followUpOnly?: boolean;
  includeGone?: boolean;
  starredOnly?: boolean;
  sort?:
    | "best"
    | "newest"
    | "cheapest"
    | "effective"
    | "allin"
    | "upfront"
    | "recent_change";
  /** Filter on effective rent, so concession deals aren't hidden by gross. */
  effectiveMax?: number;
  readyByMoveIn?: boolean;
  search?: string;
  limit?: number;
}

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
}

interface StateRow {
  listing_id: string;
  stage: Stage;
  stage_changed_at: string | null;
  starred: boolean;
  visited_at: string | null;
  notes: string;
  follow_up_at: string | null;
  events_seen_at: string | null;
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
    address: row.address,
    unit: row.unit,
    lat: row.lat,
    lon: row.lon,
    imageUrl: row.image_url,
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

/**
 * Loads the feed: every listing, joined with your CRM state, scored by the
 * model trained on your own feedback, then filtered and sorted.
 *
 * Scoring happens here rather than at ingest time so that a thumbs-up
 * re-ranks the whole board immediately, without waiting for the next poll.
 */
export async function loadFeed(filters: FeedFilters = {}): Promise<FeedListing[]> {
  const supabase = await db();
  const userId = await currentUserId();

  let query = supabase.from("listings").select("*");

  if (!filters.includeGone) query = query.eq("is_active", true);
  if (filters.priceMin != null) query = query.gte("price", filters.priceMin);
  if (filters.priceMax != null) query = query.lte("price", filters.priceMax);
  if (filters.bedsMin != null) query = query.gte("bedrooms", filters.bedsMin);
  if (filters.bedsMax != null) query = query.lte("bedrooms", filters.bedsMax);
  if (filters.noFeeOnly) query = query.eq("no_fee", true);

  const { data: rows, error } = await query
    .order("first_seen_at", { ascending: false })
    .limit(1500);
  if (error) throw new Error(`loadFeed: ${error.message}`);

  const listings = (rows ?? []) as ListingRow[];
  if (!listings.length) return [];

  const ids = listings.map((r) => r.id);

  const [states, sources, events, contacts, feedbackRows] = await Promise.all([
    supabase.from("user_listing_state").select("*").eq("user_id", userId),
    supabase.from("listing_sources").select("listing_id, source, url, is_active"),
    supabase
      .from("events")
      .select("listing_id, kind, occurred_at, old_value, new_value")
      .order("occurred_at", { ascending: false })
      .limit(4000),
    supabase
      .from("contact_log")
      .select("listing_id, occurred_at, channel, direction")
      .eq("user_id", userId),
    supabase.from("feedback").select("listing_id, action").eq("user_id", userId),
  ]);

  const stateBy = new Map<string, StateRow>(
    ((states.data ?? []) as StateRow[]).map((s) => [s.listing_id, s])
  );

  const sourcesBy = new Map<string, { source: Source; url: string }[]>();
  for (const row of sources.data ?? []) {
    const list = sourcesBy.get(row.listing_id) ?? [];
    list.push({ source: row.source as Source, url: row.url });
    sourcesBy.set(row.listing_id, list);
  }

  const eventsBy = new Map<string, { kind: string; occurred_at: string }[]>();
  for (const row of events.data ?? []) {
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
  const explicit = new Map<string, boolean>();
  for (const row of feedbackRows.data ?? []) {
    explicit.set(row.listing_id, row.action === "like");
  }
  const byId = new Map(listings.map((r) => [r.id, r]));
  const signals: Signal[] = [];
  for (const [listingId, liked] of explicit) {
    const row = byId.get(listingId);
    if (row) signals.push({ listing: toListing(row), liked });
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

  // Comparison set for pricing. Drawn from everything currently tracked, which
  // is what makes "12% under market" a measurement rather than an opinion.
  const corpus = listings.map((r) => ({
    neighborhood: r.neighborhood,
    borough: r.borough,
    bedrooms: r.bedrooms,
    price: r.price,
  }));

  // --- assemble ----------------------------------------------------------
  const out: FeedListing[] = [];
  for (const row of listings) {
    const state = stateBy.get(row.id);
    const alsoOn = sourcesBy.get(row.id) ?? [];
    const listing = toListing(row, alsoOn[0]?.source ?? "streeteasy");
    const { score: value, reasons } = score(listing, model, DEFAULT_CRITERIA);

    const rowEvents = eventsBy.get(row.id) ?? [];
    const seenAt = state?.events_seen_at;
    const unseen = rowEvents.filter(
      (e) => e.kind !== "new" && (!seenAt || e.occurred_at > seenAt)
    ).length;

    const contact = contactStats.get(row.id);
    const cost = moveInCost(listing, costs);
    const fit = moveInFit(row.available_at, profile.moveInDate);
    const deal = readDeal(row.price, statsFor(listing, corpus));

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
      stage: state?.stage ?? "inbox",
      stageChangedAt: state?.stage_changed_at ?? null,
      starred: state?.starred ?? false,
      visitedAt: state?.visited_at ?? null,
      notes: state?.notes ?? "",
      followUpAt: state?.follow_up_at ?? null,
      contactCount: contact?.count ?? 0,
      lastContactAt: contact?.last ?? null,
      lastContactChannel: contact?.channel ?? null,
      score: value,
      scoreReasons: reasons,
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

  // Flags depend on fields only present once the row is fully assembled
  // (days on market, how many sites carry it), so they're a second pass.
  for (const listing of out) {
    listing.flags = flagsFor(listing, {
      verdict: listing.dealVerdict,
      percentVsMedian: listing.dealDelta,
      stats: statsFor(listing, corpus),
      label: listing.dealLabel,
    });
  }

  return applyFilters(out, filters);
}

function applyFilters(listings: FeedListing[], filters: FeedFilters): FeedListing[] {
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

  if (filters.effectiveMax != null) {
    result = result.filter((l) => l.effectiveRent <= filters.effectiveMax!);
  }
  if (filters.starredOnly) result = result.filter((l) => l.starred);
  if (filters.followUpOnly) result = result.filter((l) => l.needsFollowUp);
  if (filters.readyByMoveIn) {
    // "unknown" stays in: most sources publish no date, and dropping them
    // would hide the majority of the market.
    result = result.filter((l) => l.timing === "ready" || l.timing === "unknown");
  }
  if (filters.changedOnly) {
    result = result.filter((l) => l.unseenEvents > 0 || l.price !== l.originalPrice);
  }
  if (filters.source && filters.source !== "all") {
    result = result.filter((l) => l.alsoOn.some((s) => s.source === filters.source));
  }
  if (filters.areas?.length) {
    const wanted = new Set(filters.areas.map((a) => a.toLowerCase()));
    result = result.filter((l) => wanted.has(l.neighborhood.toLowerCase()));
  }
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    result = result.filter((l) =>
      `${l.address} ${l.unit} ${l.neighborhood} ${l.notes}`.toLowerCase().includes(needle)
    );
  }

  const sort = filters.sort ?? "best";
  const sorters: Record<string, (a: FeedListing, b: FeedListing) => number> = {
    best: (a, b) => (b.score ?? 0) - (a.score ?? 0),
    newest: (a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt),
    cheapest: (a, b) => a.price - b.price,
    upfront: (a, b) => a.upfrontCost - b.upfrontCost,
    effective: (a, b) => a.effectiveRent - b.effectiveRent,
    allin: (a, b) => a.allInMonthly - b.allInMonthly,
    recent_change: (a, b) =>
      (b.priceChangedAt ?? b.lastSeenAt).localeCompare(a.priceChangedAt ?? a.lastSeenAt),
  };
  result = [...result].sort(sorters[sort] ?? sorters.best);

  return filters.limit ? result.slice(0, filters.limit) : result;
}

/** Everything known about one listing, for the detail view. */
export async function loadListingDetail(id: string): Promise<{
  events: ListingEvent[];
  contacts: ContactLog[];
  priceHistory: PricePoint[];
} | null> {
  const supabase = await db();
  const userId = await currentUserId();

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
      .eq("user_id", userId)
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
  const now = new Date().toISOString();
  await supabase.from("user_listing_state").upsert(
    {
      user_id: await currentUserId(),
      listing_id: listingId,
      stage,
      stage_changed_at: now,
      updated_at: now,
    },
    { onConflict: "user_id,listing_id" }
  );

  // Moving a card is itself a preference signal, so mirror it into feedback.
  const implied = stageImpliesLike(stage);
  if (implied != null) {
    await supabase.from("feedback").upsert(
      {
        user_id: await currentUserId(),
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
  }>
): Promise<void> {
  const supabase = await db();
  await supabase.from("user_listing_state").upsert(
    {
      user_id: await currentUserId(),
      listing_id: listingId,
      ...fields,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,listing_id" }
  );
}

export async function recordFeedback(
  listingId: string,
  action: "like" | "pass"
): Promise<void> {
  const supabase = await db();
  await supabase.from("feedback").upsert(
    {
      user_id: await currentUserId(),
      listing_id: listingId,
      action,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id,listing_id" }
  );
  if (action === "pass") await setStage(listingId, "passed");
}

/**
 * Undo a pass.
 *
 * Triage is fast and keyboard-driven, which means it will sometimes be wrong —
 * one stray keystroke and a flat you wanted is gone. Reversing it has to clear
 * the training signal too, otherwise the ranker keeps learning from a mistake
 * you already took back.
 */
export async function undoPass(listingId: string): Promise<void> {
  const supabase = await db();
  await supabase
    .from("feedback")
    .delete()
    .eq("user_id", await currentUserId())
    .eq("listing_id", listingId);
  await supabase.from("user_listing_state").upsert(
    {
      user_id: await currentUserId(),
      listing_id: listingId,
      stage: "inbox",
      stage_changed_at: new Date().toISOString(),
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
    user_id: await currentUserId(),
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

// --- manual entry ---------------------------------------------------------

export interface ManualListing {
  url: string;
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
  const supabase = await db();
  const now = new Date().toISOString();
  const id = `manual-${Date.now().toString(36)}`;

  const listing: Listing = {
    id,
    source: "manual",
    sourceId: id,
    url: input.url,
    price: Math.round(input.price),
    bedrooms: input.bedrooms ?? 0,
    bathrooms: input.bathrooms ?? 1,
    sqft: null,
    neighborhood: input.neighborhood ?? "",
    borough: boroughFor(`${input.neighborhood ?? ""} ${input.address}`),
    address: input.address,
    unit: input.unit ?? extractUnit(input.address),
    lat: null,
    lon: null,
    imageUrl: null,
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
    is_active: true,
    first_seen_at: now,
    last_seen_at: now,
  });
  if (error) throw new Error(`addManualListing: ${error.message}`);

  await supabase.from("listing_sources").insert({
    source: "manual",
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
    detail: "Added by hand",
    occurred_at: now,
  });

  if (input.notes) await setListingFields(id, { notes: input.notes });
  await setStage(id, "interested");
  return id;
}
