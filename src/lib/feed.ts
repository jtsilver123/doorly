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
import { statsFor, readDeal, flagsFor } from "@/lib/market";
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

  const { data: rows, error } = await query
    .order("first_seen_at", { ascending: false })
    .limit(1500);
  if (error) throw new Error(`loadFeed: ${error.message}`);

  let listings = (rows ?? []) as ListingRow[];

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

  const [states, sources, events, contacts, feedbackRows] = await Promise.all([
    supabase.from("user_listing_state").select("*").eq("user_id", ownerId),
    supabase.from("listing_sources").select("listing_id, source, url, is_active"),
    supabase
      .from("events")
      .select("listing_id, kind, occurred_at, old_value, new_value")
      .order("occurred_at", { ascending: false })
      .limit(4000),
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
    if (row) signals.push({ listing: toListing(row), liked, reasons });
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
      // The ball's court: an inbound reply anywhere in the thread means the
      // conversation is live and the next move is booking, not chasing.
      hasReply: contact?.inbound ?? false,
      stage: state?.stage ?? "inbox",
      stageChangedAt: state?.stage_changed_at ?? null,
      starred: state?.starred ?? false,
      visitedAt: state?.visited_at ?? null,
      notes: state?.notes ?? "",
      followUpAt: state?.follow_up_at ?? null,
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
      stats: statsFor(listing, corpus),
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
export async function findInCorpus(query: string): Promise<string | null> {
  const supabase = await db();
  const [{ data: rows }, { data: srcs }] = await Promise.all([
    supabase
      .from("listings")
      .select("id, address, unit, neighborhood, url")
      .eq("is_active", true)
      .order("first_seen_at", { ascending: false })
      .limit(4000),
    supabase.from("listing_sources").select("listing_id, source, url"),
  ]);
  const alsoBy = new Map<string, { source: Source; url: string }[]>();
  for (const s of srcs ?? []) {
    const list = alsoBy.get(s.listing_id) ?? [];
    list.push({ source: s.source as Source, url: s.url });
    alsoBy.set(s.listing_id, list);
  }
  const stubs = (rows ?? []).map((r) => ({
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
