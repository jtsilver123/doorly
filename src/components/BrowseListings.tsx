"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { FeedListing, SearchCriteria, Source } from "@/types";
import { ALL_SOURCES } from "@/types";
import type { Profile } from "@/lib/outreach";
import type { AmenityKey } from "@/lib/amenities";
import { applyFilters } from "@/lib/filters";
import { commuteMinutes } from "@/lib/commute";
import { siteJumps } from "@/lib/siteLinks";
import FilterBar, { type Filters } from "@/components/FilterBar";
import ListingCard, { orderedSources } from "@/components/ListingCard";
import Icon from "@/components/Icon";

// Client-only: Leaflet reads `window` the moment its module loads, which
// detonates the server prerender. The map has no server-renderable form anyway.
const CityMap = dynamic(() => import("@/components/CityMap"), {
  ssr: false,
  loading: () => <div className="citymap" aria-busy="true" />,
});

/**
 * The browse lens on everything tracked: map on the left, cards on the right,
 * every filter local and instant.
 *
 * This grid used to BE the listings tab, back when the product pretended to
 * be a search engine. The directory replaced it as the front door — the
 * inventory lives on the sites — but the grid answers a different question
 * the directory can't: "show me everything on my radar at once, on a map,
 * narrowed my way". So it lives on as Find's second view, browsing what's
 * already tracked rather than promising the whole market.
 */

/** Cards mounted per page. Two full rows beyond a tall viewport. */
const PAGE = 36;

/**
 * What the "good deals only" filter means.
 *
 * Pinned to the rating at which the verdict starts saying "worth a tour", so
 * the filter and the words on the cards agree.
 */
const GOOD_DEAL_RATING = 64;

/** Which diary heading a listing files under, for the newest-first grid. */
function freshnessBucket(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "New today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Earlier this week";
  return "Older";
}

export default function BrowseListings({
  listings,
  loading,
  active,
  profile,
  criteria,
  lastCheckedAt,
  via,
  onOpen,
  onStar,
  onPass,
  onReach,
  onPaste,
  onGuide,
  trailing,
}: {
  listings: FeedListing[];
  loading: boolean;
  /**
   * Whether this view is the one in front of the person — no drawer, no
   * other tab. Keyboard triage listens on the window, so it has to know
   * when to stand down.
   */
  active: boolean;
  profile: Profile;
  /** The saved search, for the jump-to-StreetEasy/Zillow links. */
  criteria: SearchCriteria | null;
  lastCheckedAt: string | null;
  /** Tag-team attribution — "via Emma" — when a crew-mate found it. */
  via: (l: FeedListing) => string | null;
  onOpen: (listing: FeedListing, visitSource?: boolean) => void;
  onStar: (listing: FeedListing) => void;
  onPass: (listing: FeedListing) => void;
  onReach: (listing: FeedListing) => void;
  /**
   * A pasted link or group post handed to the pull-it-in flow; returns true
   * when consumed so the search box can clear itself.
   */
  onPaste: (query: string) => boolean;
  /** The way to the directory, offered when there's nothing to browse. */
  onGuide: () => void;
  /** Extra control on the filter row (the Activity toggle). */
  trailing?: ReactNode;
}) {
  // filters — all local: adjusting one is a synchronous array pass, never a
  // round trip.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("best");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [beds, setBeds] = useState("any");
  const [baths, setBaths] = useState("any");
  const [sourceFilter, setSourceFilter] = useState<Source[]>([]);
  const [changedOnly, setChangedOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [noFeeOnly, setNoFeeOnly] = useState(false);
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);
  const [goodOnly, setGoodOnly] = useState(false);
  /** Cap on minutes to the first commute anchor. "any" = off. */
  const [commuteMax, setCommuteMax] = useState("any");
  /** Must-have amenities: w/d, elevator, dishwasher and friends. */
  const [perkFilter, setPerkFilter] = useState<AmenityKey[]>([]);
  /** Late listings shown anyway, by explicit request. */
  const [showLate, setShowLate] = useState(false);
  /** Phones: which of the two views the toggle is showing. */
  const [mobileMap, setMobileMap] = useState(false);
  /** Shared between the map and the grid, so hovering either highlights both. */
  const [linkedId, setLinkedId] = useState<string | null>(null);
  /** The keyboard cursor's position in the visible list. */
  const [focus, setFocus] = useState(0);
  /**
   * How many cards are mounted. The grid used to render the whole filtered
   * set — hundreds of articles of ~30 nodes each, most below the fold. Cards
   * past the first page mount as you approach them.
   */
  const [pageSize, setPageSize] = useState(PAGE);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const anchor = (profile.anchors ?? [])[0];

  const clearFilters = useCallback(() => {
    setQuery("");
    setPriceMin("");
    setPriceMax("");
    setBeds("any");
    setBaths("any");
    setSourceFilter([]);
    setSort("best");
    setChangedOnly(false);
    setStarredOnly(false);
    setNoFeeOnly(false);
    setFollowUpOnly(false);
    setReadyOnly(false);
    setGoodOnly(false);
    setCommuteMax("any");
    setPerkFilter([]);
  }, []);

  const { visible, lateHidden } = useMemo(() => {
    let filtered = applyFilters(listings, {
      stage: "all",
      search: query,
      priceMin: priceMin ? Number(priceMin) : undefined,
      priceMax: priceMax ? Number(priceMax) : undefined,
      bedsMin: beds === "any" ? undefined : Number(beds),
      bedsMax: beds === "any" ? undefined : Number(beds),
      bathsMin: baths === "any" ? undefined : Number(baths),
      sources: sourceFilter,
      changedOnly,
      starredOnly,
      noFeeOnly,
      followUpOnly,
      readyByMoveIn: readyOnly,
      minRating: goodOnly ? GOOD_DEAL_RATING : undefined,
      perks: perkFilter,
      sort: sort as Parameters<typeof applyFilters>[1]["sort"],
    });
    // The commute cap is against the first anchor — "work", for most people.
    if (anchor && commuteMax !== "any") {
      const cap = Number(commuteMax);
      filtered = filtered.filter((l) => {
        const est = commuteMinutes(l, anchor);
        return est != null && est.minutes <= cap;
      });
    }
    /*
     * A place that won't be free until weeks after the move-in date is not a
     * candidate, and showing it as one reads as the app not listening. Hidden
     * by default rather than dropped: the count and a reveal keep it honest.
     * Anything already in your pipeline is yours regardless.
     */
    if (showLate || readyOnly) return { visible: filtered, lateHidden: 0 };
    const kept = filtered.filter((l) => l.timing !== "late" || l.stage !== "inbox");
    return { visible: kept, lateHidden: filtered.length - kept.length };
  }, [
    showLate,
    listings,
    query,
    priceMin,
    priceMax,
    beds,
    baths,
    sourceFilter,
    changedOnly,
    starredOnly,
    noFeeOnly,
    followUpOnly,
    readyOnly,
    goodOnly,
    sort,
    anchor,
    commuteMax,
    perkFilter,
  ]);

  // --- keyboard triage -----------------------------------------------------
  // With hundreds of listings the bottleneck is triage speed, so the whole
  // grid is drivable without the mouse.
  useEffect(() => {
    if (!active) return;

    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const current = visible[focus];
      switch (e.key.toLowerCase()) {
        case "arrowright":
        case "arrowdown":
        case "j":
          e.preventDefault();
          setFocus((f) => Math.min(f + 1, visible.length - 1));
          break;
        case "arrowleft":
        case "arrowup":
        case "k":
          e.preventDefault();
          setFocus((f) => Math.max(f - 1, 0));
          break;
        case "enter":
          if (current) {
            e.preventDefault();
            // Shift widens the gesture: the panel plus the source site.
            onOpen(current, e.shiftKey);
          }
          break;
        case "e":
          if (current) {
            e.preventDefault();
            onReach(current);
          }
          break;
        case "x":
          if (current) {
            e.preventDefault();
            onPass(current);
          }
          break;
        case "s":
          if (current) {
            e.preventDefault();
            onStar(current);
          }
          break;
        case "o":
          if (current) {
            e.preventDefault();
            const target =
              orderedSources(current, profile.preferredSource)[0]?.url ?? current.url;
            if (target) window.open(target, "_blank", "noopener");
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, visible, focus, onPass, onStar, onReach, onOpen, profile.preferredSource]);

  // Keep the focused card in view as you move through the list. Cards sit
  // inside display:contents wrappers, which have no box to scroll to —
  // target the card itself.
  useEffect(() => {
    const node = gridRef.current?.querySelectorAll(".card")[focus] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  // Any change to what's on screen resets the cursor to the top of it.
  useEffect(() => setFocus(0), [visible]);
  useEffect(() => setPageSize(PAGE), [visible]);

  /**
   * Grow the window when the marker below the grid comes into view.
   *
   * A callback ref rather than an effect over a plain ref: the marker only
   * exists when there are more cards than the page, so an effect would have
   * to name every piece of state that governs whether it's mounted — and the
   * first one forgotten leaves the observer watching nothing. This attaches
   * whenever the node appears and detaches when it goes.
   */
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setPageSize((n) => n + PAGE);
      },
      // Start loading before the marker is actually reached, so a fast scroll
      // meets cards rather than a gap.
      { rootMargin: "800px" }
    );
    observerRef.current.observe(node);
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  // Keyboard triage can outrun the window, so walking past the end grows it.
  useEffect(() => {
    if (focus >= pageSize - 4) setPageSize((n) => Math.min(visible.length, n + PAGE));
  }, [focus, pageSize, visible.length]);

  if (loading) return <SkeletonGrid />;

  return (
    <div className="browse">
      <div className="stickytop">
        <FilterBar
          total={visible.length}
          filters={{
            query,
            priceMin,
            priceMax,
            beds,
            baths,
            sources: sourceFilter,
            sort,
            changedOnly,
            starredOnly,
            noFeeOnly,
            followUpOnly,
            readyOnly,
            goodOnly,
            commuteMax,
            perks: perkFilter,
          }}
          onChange={(next: Partial<Filters>) => {
            if (next.query !== undefined) setQuery(next.query);
            if (next.priceMin !== undefined) setPriceMin(next.priceMin);
            if (next.priceMax !== undefined) setPriceMax(next.priceMax);
            if (next.beds !== undefined) setBeds(next.beds);
            if (next.baths !== undefined) setBaths(next.baths);
            if (next.sources !== undefined) setSourceFilter(next.sources);
            if (next.sort !== undefined) setSort(next.sort);
            if (next.changedOnly !== undefined) setChangedOnly(next.changedOnly);
            if (next.starredOnly !== undefined) setStarredOnly(next.starredOnly);
            if (next.noFeeOnly !== undefined) setNoFeeOnly(next.noFeeOnly);
            if (next.followUpOnly !== undefined) setFollowUpOnly(next.followUpOnly);
            if (next.readyOnly !== undefined) setReadyOnly(next.readyOnly);
            if (next.goodOnly !== undefined) setGoodOnly(next.goodOnly);
            if (next.commuteMax !== undefined) setCommuteMax(next.commuteMax);
            if (next.perks !== undefined) setPerkFilter(next.perks);
          }}
          onReset={clearFilters}
          lastCheckedAt={lastCheckedAt}
          sourceCount={ALL_SOURCES.length}
          anchorLabel={anchor?.label ?? null}
          jumps={criteria ? siteJumps(criteria) : undefined}
          /* One box for both intents: typing filters, pasting a link or a
             whole group post pulls the place in. */
          onPasteSubmit={onPaste}
          trailing={trailing}
        />
      </div>

      {visible.length === 0 ? (
        <Empty filtered={listings.length > 0} onGuide={onGuide} onClear={clearFilters} />
      ) : (
        // Zillow's split on desktop: the map holds still on the left while
        // the results scroll on the right, hover linked both ways. Phones
        // choose one at a time via the floating toggle.
        <>
          {(lateHidden > 0 || showLate) && (
            <div className="late-note" role="status">
              {showLate ? (
                <>
                  Including places that are not free until well after your
                  move-in.{" "}
                  <button className="linkish" onClick={() => setShowLate(false)}>
                    Hide them again
                  </button>
                </>
              ) : (
                <>
                  {lateHidden} hidden: not free until well after your move-in
                  date.{" "}
                  <button className="linkish" onClick={() => setShowLate(true)}>
                    Show them
                  </button>
                </>
              )}
            </div>
          )}
          <div className="split" data-view={mobileMap ? "map" : "list"}>
            <div className="split-map">
              <CityMap
                listings={visible}
                onOpen={onOpen}
                linkedId={linkedId}
                onHover={setLinkedId}
              />
            </div>
            <div className="split-cards" ref={gridRef}>
              {visible.slice(0, pageSize).map((listing, i) => (
                <div className="card-cell" key={listing.id}>
                  {/* Sorted by newest, the grid reads as a diary: day
                      headings mark where today's crop ends and yesterday's
                      begins. Other sorts interleave dates, where headings
                      would lie. */}
                  {sort === "newest" &&
                    (() => {
                      const bucket = freshnessBucket(listing.firstSeenAt);
                      const prev =
                        i > 0 ? freshnessBucket(visible[i - 1].firstSeenAt) : null;
                      if (bucket === prev) return null;
                      return <h3 className="grid-day">{bucket}</h3>;
                    })()}
                  <ListingCard
                    listing={listing}
                    via={via(listing)}
                    focused={i === focus}
                    linked={linkedId === listing.id}
                    preferredSource={profile.preferredSource}
                    onHover={setLinkedId}
                    onOpen={onOpen}
                    onStar={onStar}
                    onPass={onPass}
                    onReach={onReach}
                  />
                </div>
              ))}
              {visible.length > pageSize && (
                <div ref={sentinelRef} className="more-sentinel">
                  Showing {pageSize} of {visible.length.toLocaleString()}
                </div>
              )}
            </div>
          </div>
          {/* Phones: one view at a time, switched from a thumb-height
              floating pill — the pattern every listing app lands on. */}
          <button
            className="mapswitch"
            onClick={() => setMobileMap((v) => !v)}
            aria-pressed={mobileMap}
          >
            <Icon name={mobileMap ? "listings" : "pin"} size={15} />
            {mobileMap ? "List" : "Map"}
          </button>
        </>
      )}
    </div>
  );
}

/** Placeholder cards in the real card's shape, so nothing jumps on arrival. */
function SkeletonGrid() {
  return (
    <div className="grid" aria-busy="true" aria-label="Loading listings">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="card skeleton-card">
          <div className="skeleton skeleton-media" />
          <div className="card-body">
            <div className="skeleton skeleton-line" style={{ width: "45%", height: 18 }} />
            <div className="skeleton skeleton-line" style={{ width: "62%" }} />
            <div className="skeleton skeleton-line" style={{ width: "88%" }} />
            <div className="skeleton skeleton-line" style={{ width: "50%" }} />
            <div className="skeleton skeleton-line" style={{ width: "70%" }} />
            <div
              className="skeleton skeleton-line"
              style={{ width: "100%", height: 32, marginTop: 10 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * "You have nothing tracked" and "your filters excluded all of it" are
 * unrelated problems: one is answered by the directory, the other by the
 * Clear button. Sending someone off to search when their max rent is set
 * too low would waste their evening on a question one click answers.
 */
function Empty({
  filtered,
  onGuide,
  onClear,
}: {
  filtered: boolean;
  onGuide: () => void;
  onClear: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-title">
        {filtered ? "No places match these filters" : "Nothing to browse yet"}
      </div>
      <p className="empty-body">
        {filtered
          ? "Everything on your radar got filtered out. Clearing the filters will bring the full list back."
          : "This view maps everything you're tracking. Find places on the sites in Where to look, paste them in, and they show up here."}
      </p>
      <div className="empty-actions">
        {filtered ? (
          <button className="btn btn-primary" onClick={onClear}>
            Clear all filters
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onGuide}>
            See where to look
          </button>
        )}
      </div>
    </div>
  );
}
