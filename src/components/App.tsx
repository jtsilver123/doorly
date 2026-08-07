"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { FeedListing, SearchCriteria, Source } from "@/types";
import type { Stage } from "@/types";
import { siteJumps } from "@/lib/siteLinks";
import { ALL_SOURCES, DEFAULT_PREFERRED_SOURCE, SOURCE_LABEL } from "@/types";
import {
  DEFAULT_PROFILE,
  bestChannel,
  draftTourMessage,
  draftFollowUp,
  mailtoLink,
  smsLink,
  tourSubject,
  type Profile,
} from "@/lib/outreach";
import { daysUntil } from "@/lib/cost";
import { applyFilters, findPasted } from "@/lib/filters";
import { burstConfetti } from "@/lib/confetti";
import { nextAction } from "@/lib/nextAction";
import { runwayDays } from "@/lib/runway";
import { useAutosave, saveLabel } from "@/lib/useAutosave";
import { formatPhone } from "@/lib/phone";
import { usePush } from "@/lib/usePush";
import { commuteMinutes } from "@/lib/commute";
import type { AmenityKey } from "@/lib/amenities";
import ApplicationPacket from "@/components/ApplicationPacket";
import UploadStatus from "@/components/UploadStatus";
import SearchEditor from "@/components/SearchEditor";
import Compare from "@/components/Compare";
import RailStatus from "@/components/RailStatus";
import ChaseAll from "@/components/ChaseAll";
import ReviewTours from "@/components/ReviewTours";
import MoveInCosts from "@/components/MoveInCosts";
import FilterBar, { type Filters } from "@/components/FilterBar";
import SearchHeader from "@/components/SearchHeader";
import Toasts, { useToasts } from "@/components/Toasts";
import Timeline from "@/components/Timeline";
import AccountMenu, { type ProfileSection } from "@/components/AccountMenu";
import CrewPanel, { type CrewView } from "@/components/CrewPanel";
import { phaseFor, funnelFor, todaysActions } from "@/lib/timeline";
import ListingCard, { orderedSources } from "@/components/ListingCard";
import ListingDrawer from "@/components/ListingDrawer";
import PipelineBoard from "@/components/PipelineBoard";
import Changes, { type Change, type Notice } from "@/components/Changes";
import PassDialog from "@/components/PassDialog";
import { icsFor, icsFilename } from "@/lib/calendar";
import Logo from "@/components/Logo";
import Icon, { type IconName } from "@/components/Icon";
// Client-only: Leaflet reads `window` the moment its module loads, which
// detonates the server prerender. The map has no server-renderable form anyway.
const CityMap = dynamic(() => import("@/components/CityMap"), {
  ssr: false,
  loading: () => <div className="citymap" aria-busy="true" />,
});
// Same constraint, same cure: the planner is Leaflet too.
const TourPlanner = dynamic(() => import("@/components/TourPlanner"), { ssr: false });

/**
 * Three places, not five. Usage was blunt about it: the hunt happens in
 * Listings and Pipeline, with Activity as the news ticker. "Today" was a
 * landing page restating what the other tabs already knew — its action strip
 * now tops Listings and its move-in timeline heads Pipeline — and Compare is
 * the pipeline's own finalists in a different lens, so it's a view there
 * rather than a destination.
 */
type Tab = "feed" | "changes" | "pipeline" | "profile" | "compare";

/** Every valid tab, so a hand-edited hash can't put the app in a dead state. */
const TABS: Tab[] = ["pipeline", "feed", "compare", "profile"];

/**
 * Old bookmarks and muscle memory keep working. "changes" stays a valid hash
 * — the Activity list now lives inside Listings, so the old tab lands there
 * with the panel open rather than 404ing someone's routine.
 */
const LEGACY_TABS: Record<string, Tab> = { today: "feed", changes: "feed" };

/** The clean addresses, one per section, and the way back. */
const TAB_PATHS: Record<Tab, string> = {
  pipeline: "pipeline",
  feed: "listings",
  compare: "compare",
  profile: "you",
  changes: "listings",
};
const PATH_TABS: Record<string, Tab> = {
  pipeline: "pipeline",
  listings: "feed",
  compare: "compare",
  you: "profile",
};

interface ApiStatus {
  usage: {
    used: number;
    limit: number;
    remaining: number;
    keyHint: string;
    exhausted?: boolean;
  };
  hasKey: boolean;
  keyHint: string;
  monthlyLimit: number;
  pagesPerSource: number;
  checksPerDay: number;
  lastCheckedAt: string | null;
  wideQueries: boolean;
  perPollEstimate: number;
}

/** Drawn marks, one per section. Shown at every width. */
const NAV_ICON: Record<string, IconName> = {
  feed: "listings",
  changes: "bell",
  pipeline: "pipeline",
  compare: "compare",
  profile: "profile",
};

/** Cards mounted per page. Two full rows beyond a tall viewport. */
const PAGE = 36;

/**
 * What the "good deals only" filter means.
 *
 * Pinned to the rating at which the verdict starts saying "worth a tour", so
 * the filter and the words on the cards agree. On the live corpus that's about
 * a sixth of what's tracked — a shortlist you could actually work through in
 * an evening, rather than a different-sized wall of cards.
 */
const GOOD_DEAL_RATING = 64;


function sinceText(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function Home() {
  // Pipeline is the default: it's where the actual work lives. Listings is
  // the finding tool, and honestly the source sites do browsing well — what
  // they don't have is your board. The order mirrors the process: work the
  // pipeline, find more, compare and choose.
  const [tab, setTab] = useState<Tab>("pipeline");
  /** Which account panel is showing; rides in /you's hash so reloads keep it. */
  const [section, setSection] = useState<ProfileSection>("details");
  /** The Activity list, folded into Listings as a panel rather than a tab. */
  const [activityOpen, setActivityOpen] = useState(false);
  /** Section the drawer should open scrolled to, from a board next-action. */
  const [drawerJump, setDrawerJump] = useState<string | null>(null);

  /**
   * The tab lives in the URL.
   *
   * Reloading in the middle of working a pipeline used to dump you back on
   * Today — the app forgot where you were every time you refreshed, which on
   * a phone happens constantly. The hash also makes back/forward work and
   * makes a screen linkable.
   *
   * useLayoutEffect, not useEffect: it runs before the browser paints, so
   * restoring the tab never flashes Today first. And it can't go in the
   * useState initialiser — the server renders this too, and reading
   * `location` there would hydrate mismatched.
   */
  useLayoutEffect(() => {
    /*
     * On the real app host the section is the pathname — /pipeline,
     * /listings, /compare, /you — served by a middleware rewrite of the same
     * shell. Hashes are the legacy address (#compare bookmarks, and local
     * dev where the shell lives at /app with no rewrite in front); they're
     * honored on arrival, then the URL is upgraded in place.
     */
    const read = (): Tab | null => {
      // The hash outranks the path on arrival: /pipeline#compare is an old
      // #compare bookmark that rode through the /app redirect, and the
      // person meant Compare. The next replaceState erases the hash anyway.
      const raw = window.location.hash.replace(/^#/, "");
      if (raw) {
        const key = (LEGACY_TABS[raw] ?? raw) as Tab;
        if (TABS.includes(key)) return key;
      }
      const seg = window.location.pathname.replace(/^\//, "");
      return (PATH_TABS[seg] ?? null) as Tab | null;
    };
    const initial = read();
    if (initial) setTab(initial);
    // /you carries its section in the hash, so a reload keeps the panel.
    const sec = window.location.hash.replace(/^#/, "");
    if (
      window.location.pathname === "/you" &&
      ["details", "search", "crew", "packet", "api"].includes(sec)
    ) {
      setSection(sec as ProfileSection);
    }
    const onPop = () => {
      const next = read();
      if (next) setTab(next);
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  // replaceState rather than pushState: switching tabs shouldn't stack up
  // history entries you then have to press Back through five times.
  useEffect(() => {
    // Clean paths only where the middleware serves them — everywhere the
    // shell answers at /app (local dev), the hash keeps doing the job.
    // The account page carries its section as a hash (/you#packet), so a
    // reload lands on the same panel instead of the first one.
    const cleanUrls = window.location.pathname !== "/app";
    const want = cleanUrls
      ? `/${TAB_PATHS[tab]}${tab === "profile" ? `#${section}` : ""}`
      : `#${tab}`;
    const have = cleanUrls
      ? window.location.pathname + (tab === "profile" ? window.location.hash : "")
      : `#${window.location.hash.replace(/^#/, "")}`;
    if (have !== want) {
      window.history.replaceState(null, "", want);
    }
    // A new tab starts at its top. Carrying the last tab's scroll position
    // over opened Pipeline mid-page on a phone, with the view toggle clipped
    // above the fold.
    window.scrollTo({ top: 0 });
    document.querySelector(".main")?.scrollTo?.({ top: 0 });
  }, [tab, section]);
  const [listings, setListings] = useState<FeedListing[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  /** Personal notices: crew adds, watched changes, good drops. */
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [open, setOpen] = useState<FeedListing | null>(null);
  /** The tour-day route planner, opened from the pipeline's Tour column. */
  const [planning, setPlanning] = useState(false);
  /** The listing whose pass dialog is open. */
  const [passing, setPassing] = useState<FeedListing | null>(null);
  /** The bulk-outreach run: opening pitches or follow-ups, or closed. */
  const [bulkMode, setBulkMode] = useState<"first" | "chase" | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const [api, setApi] = useState<ApiStatus | null>(null);
  const [crew, setCrew] = useState<CrewView | null>(null);
  const [email, setEmail] = useState("");
  const [budget, setBudget] = useState(0);
  /** The saved search's neighborhoods — what "Where" actually means. */
  const [searchAreas, setSearchAreas] = useState<string[]>([]);
  /** The whole saved search, for the jump-to-StreetEasy/Zillow links. */
  const [searchCriteria, setSearchCriteria] = useState<SearchCriteria | null>(null);
  const [focus, setFocus] = useState(0);
  const { toasts, push: toast, dismiss } = useToasts();

  // filters
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
  /** Which panel the profile area opens on, so the menu can deep-link. */
  /**
   * How many cards are mounted.
   *
   * The grid used to render the whole filtered set — 323 articles of ~30 nodes
   * each, about ten thousand DOM nodes, most of them below the fold. It's
   * imperceptible at this corpus size and won't be at three thousand, or on a
   * mid-range phone. Cards past the first page mount as you approach them.
   */
  const [pageSize, setPageSize] = useState(PAGE);
  const observerRef = useRef<IntersectionObserver | null>(null);
  /** Shared between the map and the grid, so hovering either highlights both. */
  const [linkedId, setLinkedId] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);

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

  /**
   * One fetch for the whole corpus, then everything narrows in the browser.
   *
   * Filters used to be query parameters, so each keystroke in the search box
   * cost a round trip *and* a full server-side rescore. Now the network is
   * touched only when the underlying data can actually have changed — a poll, a
   * star, a stage move — and adjusting a filter is a synchronous array pass.
   */
  // Returns what it loaded: quick-add re-searches the fresh list right after
  // a check, and reading it back out of state would race the render.
  const loadFeed = useCallback(async (): Promise<FeedListing[]> => {
    try {
      // "everything", not "all": the board's loss column holds no_go rows,
      // which "all" hides. The browse grid re-filters client-side anyway.
      const res = await fetch("/api/feed?stage=everything");
      const body = await res.json();
      if (body.error) toast({ message: body.error, tone: "warn" });
      const fresh: FeedListing[] = body.listings ?? [];
      setListings(fresh);
      return fresh;
    } catch {
      toast({ message: "Couldn't load your listings. Check your connection.", tone: "warn" });
      return [];
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const loadNotices = useCallback(async () => {
    try {
      const body = await fetch("/api/notifications").then((r) => r.json());
      setNotices(body.notifications ?? []);
      setUnread(body.unread ?? 0);
    } catch {
      /* the next poll gets another chance */
    }
  }, []);

  useEffect(() => {
    loadNotices();
    const timer = setInterval(loadNotices, 120_000);
    return () => clearInterval(timer);
  }, [loadNotices]);

  // Visiting Activity reads everything — the badge counts the unseen, and
  // "seen" means the page was in front of you, not that you clicked each row.
  useEffect(() => {
    if (tab !== "changes" || unread === 0) return;
    fetch("/api/notifications", { method: "PATCH" })
      .then(() => setUnread(0))
      .catch(() => {});
  }, [tab, unread]);

  /**
   * ?place=<id> opens that listing.
   *
   * The half of "share this apartment" that happens on the receiving end.
   * It waits for the feed, because the drawer needs the whole listing and
   * not just its id — and it runs once, so closing the drawer doesn't
   * immediately reopen it.
   */
  const openedShared = useRef(false);
  useEffect(() => {
    if (openedShared.current || !listings.length) return;
    const id = new URLSearchParams(window.location.search).get("place");
    if (!id) return;
    openedShared.current = true;
    const hit = listings.find((l) => l.id === id);
    if (hit) {
      setOpen(hit);
      setTab("feed");
    } else {
      toast({ message: "That place isn't in your search any more.", tone: "warn" });
    }
    // Drop the parameter once it's been used; a reload shouldn't fight you
    // by reopening a drawer you closed.
    const url = new URL(window.location.href);
    url.searchParams.delete("place");
    window.history.replaceState(null, "", url.toString());
  }, [listings, toast]);


  const anchor = (profile.anchors ?? [])[0];
  const visible = useMemo(() => {
    const filtered = applyFilters(listings, {
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
    if (!anchor || commuteMax === "any") return filtered;
    const cap = Number(commuteMax);
    return filtered.filter((l) => {
      const est = commuteMinutes(l, anchor);
      return est != null && est.minutes <= cap;
    });
  }, [
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

  const loadChanges = useCallback(async () => {
    const body = await fetch("/api/changes").then((r) => r.json());
    setChanges(body.changes ?? []);
  }, []);

  const loadApi = useCallback(async () => {
    try {
      setApi(await fetch("/api/settings").then((r) => r.json()));
    } catch {
      /* settings are optional; the app still works from the env key */
    }
  }, []);

  // Tag-team attribution. First names, because a card footer is small and
  // everyone in a crew already knows which Emma.
  const meId = crew?.members.find((m) => m.isYou)?.userId ?? null;
  const crewName = useCallback(
    (id: string | null): string | null => {
      if (!crew || !id) return null;
      const member = crew.members.find((m) => m.userId === id);
      return member ? member.name.split(" ")[0] : null;
    },
    [crew]
  );
  const via = useCallback(
    (l: FeedListing): string | null => {
      if (!crew || !l.addedById || l.addedById === meId) return null;
      const name = crewName(l.addedById);
      return name ? `via ${name}` : null;
    },
    [crew, meId, crewName]
  );

  const loadCrew = useCallback(async () => {
    try {
      const body = await fetch("/api/crew").then((r) => r.json());
      setCrew(body.crew ?? null);
    } catch {
      /* solo is the default; attribution UI simply stays hidden */
    }
  }, []);

  /*
   * The desktop frame must never scroll as a document — `.main` owns the
   * scrolling. CSS clips overflow on html and body already, but a clipped
   * viewport is per spec still programmatically scrollable, and something
   * (a focus call, a browser restoring scroll on back-navigation) kept
   * sliding the whole shell up and off, sidebar and all, leaving raw ink and
   * a fixed drawer hovering over content that had moved. This is the
   * backstop the CSS can't be: whatever scrolls the document, it snaps back.
   */
  useEffect(() => {
    const reset = () => {
      if (!window.matchMedia("(min-width: 861px)").matches) return;
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    };
    reset();
    window.addEventListener("scroll", reset, { passive: true });
    return () => window.removeEventListener("scroll", reset);
  }, []);

  useEffect(() => {
    loadChanges();
    loadApi();
    loadCrew();
    fetch("/api/searches")
      .then((r) => r.json())
      .then((b) => {
        const first = (b.searches ?? [])[0];
        if (first?.criteria?.priceMax) setBudget(first.criteria.priceMax);
        if (Array.isArray(first?.criteria?.areas)) setSearchAreas(first.criteria.areas);
        if (first?.criteria) setSearchCriteria(first.criteria);
      })
      .catch(() => {});
    fetch("/api/profile")
      .then((r) => r.json())
      .then((b) => {
        if (b.profile) setProfile({ ...DEFAULT_PROFILE, ...b.profile });
        if (b.email) setEmail(b.email);
      })
      .catch(() => {});
  }, [loadChanges, loadApi]);

  /**
   * One press of "Check for new": run the poll, reload everything it can
   * change, and hand back the fresh feed so callers can look inside it.
   * Quick-add re-runs its match against exactly this list.
   */
  const checkNow = async (): Promise<{
    listings: FeedListing[];
    error?: string;
    newListings: number;
    events: number;
  }> => {
    const body = await fetch("/api/refresh", { method: "POST" }).then((r) => r.json());
    const [fresh] = await Promise.all([loadFeed(), loadChanges(), loadApi()]);
    return {
      listings: fresh,
      error: body.error,
      newListings: body.newListings ?? 0,
      events: body.events ?? 0,
    };
  };

  async function refresh() {
    setRefreshing(true);

    try {
      const res = await checkNow();
      if (res.error) {
        toast({ message: res.error, tone: "warn" });
      } else if (res.newListings || res.events) {
        toast({
          message: `${res.newListings} new · ${res.events} changes`,
          tone: "good",
        });
      } else {
        toast({ message: "Nothing new since last check" });
      }
    } catch (err) {
      toast({
        message: err instanceof Error ? err.message : "Refresh failed",
        tone: "warn",
      });
    } finally {
      setRefreshing(false);
    }
  }

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>, reload = true) => {
      await fetch(`/api/listings/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (reload) await loadFeed();
    },
    [loadFeed]
  );

  /**
   * Star and pass update the list immediately and reconcile in the background.
   * Waiting on a round trip for a keystroke is what made triage feel heavy —
   * at one card per second, a 300ms refetch is most of the interaction.
   */
  const star = useCallback(
    (listing: FeedListing) => {
      const next = !listing.starred;
      setListings((list) =>
        list.map((l) => (l.id === listing.id ? { ...l, starred: next } : l))
      );
      patch(listing.id, { action: "star", starred: next }, false).catch(() =>
        loadFeed()
      );
    },
    [patch, loadFeed]
  );

  /**
   * The post-tour thumb. Optimistic like star: a gut reaction recorded with
   * a round-trip spinner stops being a gut reaction.
   */
  const setLean = useCallback(
    (listing: FeedListing, lean: number) => {
      setListings((list) =>
        list.map((l) => (l.id === listing.id ? { ...l, lean } : l))
      );
      patch(listing.id, { action: "lean", lean }, false).catch(() => loadFeed());
    },
    [patch, loadFeed]
  );

  /**
   * Move a listing along the pipeline, from a drag or an arrow key.
   *
   * Optimistic like star and pass: a drag that snaps back while a round trip
   * finishes reads as a failed drop, and people re-drag. On failure the whole
   * feed reloads, which puts the card back where it really is.
   */
  const moveStage = useCallback(
    (listing: FeedListing, stage: Stage) => {
      if (listing.stage === stage) return;
      setListings((list) =>
        list.map((l) =>
          l.id === listing.id
            ? { ...l, stage, stageChangedAt: new Date().toISOString() }
            : l
        )
      );
      patch(listing.id, { action: "stage", stage }, false).catch(() => loadFeed());
      // Submitting an application is the hunt's biggest single step forward.
      if (stage === "applied") burstConfetti();
    },
    [patch, loadFeed]
  );

  /** The landlord's answer on an applied place: 1 accepted, -1 denied, 0 waiting. */
  const setAppResult = useCallback(
    (listing: FeedListing, result: number) => {
      setListings((list) =>
        list.map((l) =>
          l.id === listing.id
            ? { ...l, appResult: result, secured: result === 1 ? l.secured : false }
            : l
        )
      );
      patch(listing.id, { action: "appResult", result }, false).catch(() => loadFeed());
    },
    [patch, loadFeed]
  );

  /** Your own amenity answer, from the compare table. */
  const markAmenity = useCallback(
    (listing: FeedListing, key: string, fact: "yes" | "no" | null) => {
      setListings((list) =>
        list.map((l) => {
          if (l.id !== listing.id) return l;
          const marks = { ...l.amenityMarks };
          if (fact) marks[key] = fact;
          else delete marks[key];
          return { ...l, amenityMarks: marks };
        })
      );
      patch(listing.id, { action: "amenityMark", key, fact }, false).catch(() =>
        loadFeed()
      );
    },
    [patch, loadFeed]
  );

  /** Accepted and taken: the flag the whole hunt exists to set. */
  const setSecured = useCallback(
    (listing: FeedListing, secured: boolean) => {
      setListings((list) =>
        list.map((l) => (l.id === listing.id ? { ...l, secured } : l))
      );
      patch(listing.id, { action: "secured", secured }, false).catch(() => loadFeed());
      if (secured) burstConfetti();
    },
    [patch, loadFeed]
  );

  /**
   * Add a place by address or pasted link.
   *
   * Matches against what's already tracked first. Somebody sending you an
   * address usually means a listing the poll already has, and creating a second
   * copy of it would split its price history and its notes in two.
   *
   * A miss used to dead-end at "wait for the next check", which turned pasting
   * a hot listing into homework. Now it runs the check itself and re-matches
   * when the fresh feed lands. The person pasting is the person in a hurry.
   */
  const quickAdd = async (query: string) => {
    const claim = (hit: FeedListing, message: string) => {
      moveStage(hit, "interested");
      setOpen(hit);
      toast({ message, tone: "good" });
      // Landing a place you were hunting for deserves more than a toast.
      burstConfetti();
    };

    /*
     * The feed in this browser is criteria-scoped, and a paste is a manual
     * decision that outranks criteria — over-budget, wrong bedroom count,
     * outside the saved areas, none of it matters when you're adding it
     * yourself. So a local miss asks the server to search the whole shared
     * corpus; tracking the hit is what carries it into the feed permanently.
     */
    const adopt = async (id: string, message: string) => {
      await patch(id, { action: "stage", stage: "interested" }, false);
      const fresh = await loadFeed();
      const hit = fresh.find((l) => l.id === id);
      if (hit) {
        setOpen(hit);
        toast({ message, tone: "good" });
        burstConfetti();
        return true;
      }
      return false;
    };
    const inCorpus = async (): Promise<string | null> => {
      try {
        const body = await fetch("/api/listings/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query }),
        }).then((r) => r.json());
        return body.id ?? null;
      } catch {
        return null;
      }
    };

    const hit = findPasted(listings, query);
    if (hit) {
      claim(hit, `Found it. ${hit.address} is in your pipeline`);
      return;
    }

    const known = await inCorpus();
    if (known && (await adopt(known, "Found it. Added to your pipeline"))) return;

    if (refreshing) {
      toast({ message: "A check is already running. Paste it again when that finishes." });
      return;
    }

    toast({ message: "Not tracked yet. Checking the sources for it now" });
    setRefreshing(true);
    try {
      const res = await checkNow();
      const fresh = findPasted(res.listings, query);
      if (fresh) {
        claim(fresh, `There it is. ${fresh.address} just came in`);
        return;
      }
      // The check may have pulled it into the corpus outside your criteria;
      // the corpus-wide lookup is what can still see it there.
      const late = await inCorpus();
      if (late && (await adopt(late, "There it is. Added to your pipeline"))) return;
      if (res.error) {
        toast({ message: res.error, tone: "warn" });
      } else {
        toast({
          message: `Checked just now and the sources don't have it. If it's a private tip, it won't turn up on its own.`,
          tone: "warn",
        });
      }
    } catch (err) {
      toast({
        message: err instanceof Error ? err.message : "The check failed. Try again in a minute.",
        tone: "warn",
      });
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * The optimistic side of a "no". Dismissing something unseen removes it —
   * that's triage. Declining a place you've toured is an outcome: the card
   * moves to the board's loss column instead of vanishing, matching what the
   * server decides in passListing.
   */
  const sawIt = (l: FeedListing) => ["toured", "applied", "no_go"].includes(l.stage);
  const optimisticPass = useCallback((listing: FeedListing, reason = "") => {
    if (sawIt(listing)) {
      setListings((list) =>
        list.map((l) =>
          l.id === listing.id ? { ...l, stage: "no_go" as const, passReason: reason } : l
        )
      );
    } else {
      setListings((list) => list.filter((l) => l.id !== listing.id));
    }
  }, []);

  const pass = useCallback(
    (listing: FeedListing) => {
      optimisticPass(listing);
      patch(listing.id, { action: "feedback", value: "pass" }, false).catch(() =>
        loadFeed()
      );
      /*
       * The quick dismiss stays one tap. Clearing a feed of forty places can't
       * cost forty dialogs, so the reason is offered rather than demanded —
       * and a pass with no reason still counts, just against everything.
       */
      toast({
        message: sawIt(listing)
          ? `${listing.address} filed under "Not applying"`
          : `Passed on ${listing.address}`,
        actionLabel: "Say why",
        onAction: () => setPassing(listing),
        secondaryLabel: "Undo",
        onSecondary: () => {
          patch(listing.id, { action: "unpass" }, false)
            .then(loadFeed)
            .catch(() => loadFeed());
        },
      });
    },
    [patch, loadFeed, toast, optimisticPass]
  );

  /**
   * Passing with a reason attached, from the dialog.
   *
   * Same optimistic move-or-remove as a bare pass — the reason rides along
   * on the write so the two can never disagree, and undoing clears it.
   */
  const passWithReason = useCallback(
    (listing: FeedListing, reason: string, reasons: string[] = []) => {
      setPassing(null);
      optimisticPass(listing, reason);
      // `reasons` are codes for the ranking model, `reason` is the note a
      // crew-mate reads. Both ride on the one write so they can't disagree.
      patch(listing.id, { action: "pass", reason, reasons }, false).catch(() => loadFeed());
      toast({
        message: sawIt(listing)
          ? `${listing.address} filed under "Not applying"`
          : reasons.length
            ? `Passed on ${listing.address}. Your scores know why.`
            : `Passed on ${listing.address}`,
        actionLabel: "Undo",
        onAction: () => {
          patch(listing.id, { action: "unpass" }, false)
            .then(loadFeed)
            .catch(() => loadFeed());
        },
      });
    },
    [patch, loadFeed, toast, optimisticPass]
  );

  /**
   * Shift-select: the panel and the listing's own site together. Triage
   * often ends at "looks right, now show me the full listing" — one gesture
   * covers both instead of open-panel-then-hunt-for-the-link.
   */
  const openCard = useCallback(
    (listing: FeedListing, visitSource?: boolean) => {
      if (visitSource) {
        const target =
          orderedSources(listing, profile.preferredSource)[0]?.url ?? listing.url;
        if (target) window.open(target, "_blank", "noopener");
      }
      setOpen(listing);
    },
    [profile.preferredSource]
  );

  /** The .ics for a booked tour, shared by the board and the drawer. */
  const downloadIcs = useCallback((listing: FeedListing) => {
    const body = icsFor(listing);
    if (!body) return;
    const url = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = icsFilename(listing);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, []);

  /**
   * One "reach out" action whose behaviour depends on what the listing has.
   * Whatever the channel, the CRM is written first — an sms:/mailto: handoff
   * can unload the page before a later request lands.
   */
  const reachOut = useCallback(
    async (listing: FeedListing) => {
      // Anything that isn't "send them a message" belongs in the panel, where
      // the control for it lives.
      const action = nextAction(listing);
      if (action.kind !== "reach" && action.kind !== "chase") {
        if (action.becomes) {
          patch(listing.id, { action: "stage", stage: action.becomes }, false).catch(() =>
            loadFeed()
          );
          setListings((list) =>
            list.map((l) => (l.id === listing.id ? { ...l, stage: action.becomes! } : l))
          );
          return;
        }
        setOpen(listing);
        return;
      }
      const { channel } = bestChannel(listing);
      /*
       * Which draft rides the button. Once you've contacted, every later
       * message from a card is a nudge, never the opening pitch resent —
       * getting the original again is what makes people look like bots.
       */
      const chasing = listing.stage === "contacted";
      const message = chasing
        ? draftFollowUp(listing, profile)
        : draftTourMessage(listing, profile);

      await patch(
        listing.id,
        {
          action: "contact",
          channel,
          direction: "out",
          who: listing.contactName,
          note: chasing ? "Follow-up" : "Tour request",
        },
        false
      );
      if (listing.stage === "inbox" || listing.stage === "interested") {
        await patch(listing.id, { action: "stage", stage: "contacted" }, false);
      }
      await loadFeed();

      if (channel === "text") {
        window.location.href = smsLink(listing.contactPhone, message);
      } else if (channel === "email") {
        window.location.href = mailtoLink(
          listing.contactEmail,
          tourSubject(listing),
          message
        );
      } else {
        // No published contact: put the draft on the clipboard and open the
        // listing, where the site's own enquiry form lives.
        try {
          await navigator.clipboard.writeText(message);
          toast({
            message: "Message copied. Paste it into their contact form",
            tone: "good",
          });
        } catch {
          toast({ message: "Opened the listing. Copy the message from the detail panel" });
        }
        const target = orderedSources(listing, profile.preferredSource)[0]?.url ?? listing.url;
        if (target) window.open(target, "_blank", "noopener");
      }
    },
    [patch, profile, loadFeed]
  );

  // --- keyboard triage -----------------------------------------------------
  // With hundreds of listings the bottleneck is triage speed, so the whole
  // feed is drivable without the mouse.
  useEffect(() => {
    if (tab !== "feed" || open) return;

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
            openCard(current, e.shiftKey);
          }
          break;
        case "e":
          if (current) {
            e.preventDefault();
            reachOut(current);
          }
          break;
        case "x":
          if (current) {
            e.preventDefault();
            pass(current);
          }
          break;
        case "s":
          if (current) {
            e.preventDefault();
            star(current);
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
  }, [tab, open, visible, focus, pass, star, reachOut, openCard, profile.preferredSource]);

  // Keep the focused card in view as you move through the list.
  useEffect(() => {
    const node = gridRef.current?.children[focus] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  // Any change to what's on screen resets the cursor to the top of it.
  useEffect(() => setFocus(0), [visible]);
  useEffect(() => setPageSize(PAGE), [visible]);

  /**
   * Grow the window when the marker below the grid comes into view.
   *
   * A callback ref rather than an effect over a plain ref: the marker only
   * exists on the listings tab, so an effect would have to name every piece of
   * state that governs whether it's mounted — tab, view, loading, result count
   * — and the first one forgotten leaves the observer watching nothing. This
   * attaches whenever the node appears and detaches when it goes, with no
   * dependency list to get wrong.
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

  /**
   * The open listing, always re-read from the current feed.
   *
   * `open` used to hold the object captured at click time, so a change made
   * inside the panel updated the grid behind it and left the panel showing the
   * old values — a number you had just saved still read as "no phone
   * published". Resolving by id each render means the panel sees every write
   * the moment the feed reloads.
   */
  const openListing = useMemo(
    () => (open ? listings.find((l) => l.id === open.id) ?? open : null),
    [open, listings]
  );

  const finalistCount = useMemo(
    () =>
      listings.filter(
        (l) => l.starred || !["inbox", "passed", "no_go", "closed"].includes(l.stage)
      ).length,
    [listings]
  );

  const counts = useMemo(
    () => ({
      active: listings.filter((l) => l.isActive).length,
      changed: listings.filter((l) => l.unseenEvents > 0 || l.price !== l.originalPrice)
        .length,
      pipeline: listings.filter((l) => l.stage !== "inbox" && l.stage !== "passed").length,
      followUp: listings.filter((l) => l.needsFollowUp).length,
    }),
    [listings]
  );

  const daysToMove = daysUntil(profile.moveInDate);
  const phase = useMemo(() => phaseFor(daysToMove), [daysToMove]);
  const funnel = useMemo(
    () => funnelFor(listings, daysToMove),
    [listings, daysToMove]
  );
  const actions = useMemo(
    () => todaysActions(listings, funnel, phase),
    [listings, funnel, phase]
  );

  /**
   * Budget and move-in date, saved from wherever they're edited.
   *
   * The budget lives on the saved search (it bounds what gets scraped) and the
   * date lives on the profile (it fills the outreach message and the timeline),
   * but to the user they're one pair of settings. This hides that seam, and
   * reloads the feed because both feed straight back into the rating.
   */
  const saveSearchBasics = useCallback(
    async ({ budget: nextBudget, moveInDate }: { budget?: number; moveInDate?: string }) => {
      if (nextBudget != null) {
        setBudget(nextBudget);
        const body = await fetch("/api/searches").then((r) => r.json());
        const current = (body.searches ?? [])[0];
        if (current) {
          await fetch("/api/searches", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              label: current.label,
              criteria: { ...current.criteria, priceMax: nextBudget },
            }),
          });
          // Criteria are keyed by content, so an edit creates a new row. Drop
          // the old one or every poll scrapes both and doubles the API spend.
          await fetch("/api/searches", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ searchKey: current.searchKey }),
          });
        }
      }
      if (moveInDate) {
        setProfile((p) => ({ ...p, moveInDate }));
        await fetch("/api/profile", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile: { ...profile, moveInDate } }),
        });
      }
      await loadFeed();
      toast({ message: "Updated", tone: "good" });
    },
    [profile, loadFeed, toast]
  );

  // No toast: the forms save themselves as you type now, and a "Saved" pop
  // for every debounced keystroke would be a metronome. Each form shows its
  // own quiet status line instead.
  async function saveProfile(next: Profile) {
    setProfile(next);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: next }),
    });
  }

  return (
    <div className="shell">
      <a className="skiplink" href="#results">
        Skip to listings
      </a>
      <nav className="sidebar" aria-label="Sections">
        <div className="brandblock">
          <div className="brandrow">
            <Logo />
            <span className="brand brandmark">DamnLease</span>
          </div>
          {/* The hunt's vitals, promoted from two half-versions (a bare
              countdown here, a wide panel on Pipeline) into the rail's one
              status instrument. Hidden on phones with the rest of the rail
              chrome; the Pipeline page keeps a strip there instead. */}
          <RailStatus
            info={phase}
            funnel={funnel}
            moveInDate={profile.moveInDate}
            live={counts.active}
            changed={counts.changed}
          />
        </div>

        <div className="mobile-nav" style={{ display: "grid", gap: 2 }}>
          {(
            [
              // Ordered like the work: the board you live on, the finding
              // tool, then choosing. Activity rides inside Listings now —
              // its unread count joins the Listings badge so news still
              // shows without a whole tab to hold it.
              ["pipeline", "Pipeline", counts.pipeline],
              ["feed", "Listings", actions.length + unread],
              ["compare", "Compare", finalistCount],
              // Phones only: the desktop rail reaches this through the account
              // button, which the bottom bar has no room for.
              ["profile", "You", 0],
            ] as [Tab, string, number][]
          ).map(([key, label, count]) => (
            <button
              key={key}
              className="nav-item"
              data-key={key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => {
                // The bar stays above the drawer on phones; switching
                // sections is also how you leave the panel.
                setOpen(null);
                setTab(key);
              }}
            >
              <Icon name={NAV_ICON[key]} size={18} className="nav-icon" />
              <span>{label}</span>
              {count > 0 && <span className="chip">{count}</span>}
            </button>
          ))}
        </div>

        {counts.followUp > 0 && (
          <button
            className="callout"
            onClick={() => {
              setTab("feed");
              setFollowUpOnly(true);
            }}
          >
            <strong>{counts.followUp} waiting on a reply</strong>
            <span className="muted">Contacted 2+ days ago. Chase them</span>
          </button>
        )}

        {/* The triage keys, listed where your eyes rest between cards. Shown
            only on Listings, the one page they drive; the phone rail is a tab
            bar and never renders this. */}
        {tab === "feed" && (
          <div className="keys" aria-label="Keyboard shortcuts">
            <span className="keys-title">Keyboard</span>
            <dl className="keys-grid">
              <dt>
                <kbd>J</kbd>
                <kbd>K</kbd>
              </dt>
              <dd>next, previous</dd>
              <dt>
                <kbd>↵</kbd>
              </dt>
              <dd>open the place</dd>
              <dt>
                <kbd>⇧</kbd>
                <kbd>↵</kbd>
              </dt>
              <dd>open it + its site</dd>
              <dt>
                <kbd>O</kbd>
              </dt>
              <dd>the listing site</dd>
              <dt>
                <kbd>E</kbd>
              </dt>
              <dd>reach out</dd>
              <dt>
                <kbd>S</kbd>
              </dt>
              <dd>save</dd>
              <dt>
                <kbd>X</kbd>
              </dt>
              <dd>pass</dd>
            </dl>
          </div>
        )}

        {/*
          Checking for listings and the budget that check spends are one
          subject, and they were at opposite ends of the rail — a meter in the
          middle, the button that moves it at the bottom, with no way to tell
          they were related.
        */}
        <div className="railfoot">
          <div className="refresh">
            {/*
              A dead key makes "Check for new" a lie — pressing it runs a
              check that cannot fetch and reports nothing new. When the key
              is spent, the button says what actually needs doing and goes
              where you do it.
            */}
            {api?.usage && (api.usage.exhausted || api.usage.remaining <= 0) ? (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setSection("api");
                  setTab("profile");
                }}
              >
                Add a fresh API key
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={refresh}
                disabled={refreshing}
              >
                {refreshing ? "Checking…" : "Check for new"}
              </button>
            )}

            {api?.usage && (
              <button
                className="usage"
                onClick={() => {
                  setSection("api");
                  setTab("profile");
                }}
                title="Change your key or how often we check"
              >
                <span className="usage-top">
                  <span>
                    {api.lastCheckedAt
                      ? `Checked ${sinceText(api.lastCheckedAt)}`
                      : "Not checked yet"}
                    {api.checksPerDay > 0 ? ` · auto ${api.checksPerDay}×/day` : " · auto off"}
                  </span>
                </span>
                <span className="meter">
                  <span
                    style={{
                      width: api.usage.exhausted
                        ? "100%"
                        : `${Math.min(100, (api.usage.used / api.usage.limit) * 100)}%`,
                      background:
                        api.usage.exhausted || api.usage.remaining <= 25
                          ? "var(--warn)"
                          : "var(--accent)",
                    }}
                  />
                </span>
                {/* Upstream's word beats our arithmetic: the local count only
                    sees requests made through this app, so a key drained
                    elsewhere looks healthy here while every call bounces. */}
                {api.usage.exhausted ? (
                  <span className="usage-foot">
                    <span className="warn-text">
                      Key out of credits. Paste a new one
                    </span>
                  </span>
                ) : (
                  <span className="usage-foot">
                    <span className={api.usage.remaining <= 25 ? "warn-text" : undefined}>
                      {api.usage.remaining} of {api.usage.limit} requests left
                    </span>
                    <span>
                      {(() => {
                        const d = runwayDays(
                          api.usage.remaining,
                          api.checksPerDay,
                          Math.max(api.perPollEstimate ?? 5, 1)
                        );
                        return d == null
                          ? "manual only"
                          : d <= 3
                            ? `new key in ${d}d`
                            : `~${d}d left`;
                      })()}
                    </span>
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Straight to the person who builds this — a pre-filled email
              beats a feedback form nobody maintains. */}
          <a
            className="feedback-link"
            href={`mailto:jtsilver123@gmail.com?subject=${encodeURIComponent(
              "DamnLease feedback"
            )}&body=${encodeURIComponent(
              [
                "Hey Jake,",
                "",
                "What I was doing:",
                "",
                "What happened (or what's missing):",
                "",
                "What I expected instead:",
                "",
                "Sent from DamnLease",
              ].join("\n")
            )}`}
          >
            <Icon name="mail" size={14} />
            Send feedback
          </a>

          <AccountMenu
            email={email}
            name={profile.name}
            onOpenSection={(next) => {
              setSection(next);
              setTab("profile");
            }}
          />
        </div>
      </nav>

      <main className="main" id="results">
        {tab === "feed" && (
          <div className="stickytop">
            {budget > 0 && (
          <SearchHeader
            listings={listings}
            budget={budget}
            searchAreas={searchAreas}
            moveInDate={profile.moveInDate}
            onSave={saveSearchBasics}
            onEditSearch={() => {
              setSection("search");
              setTab("profile");
            }}
          />
            )}

        {loading && <SkeletonGrid />}

            {/* What used to be the Today tab, boiled down to its one useful
                part: the things that need doing, as a strip above the browse.
                Nothing urgent means no strip — the feed speaks for itself. */}
            {!loading && actions.length > 0 && (
              <div className="actions actions-strip">
                {actions.map((action) => (
                  <button
                    key={action.key}
                    className={`surface action action-${action.tone}`}
                    onClick={() => {
                      if (action.filter === "followUp") {
                        setFollowUpOnly(true);
                      } else if (action.filter === "new") {
                        setSort("newest");
                      } else if (action.filter === "tour") {
                        setTab("pipeline");
                      }
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{action.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {action.detail}
                      </div>
                    </div>
                    <span className="action-arrow">→</span>
                  </button>
                ))}
              </div>
            )}

            {tab === "feed" && (
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
              lastCheckedAt={api?.lastCheckedAt}
              sourceCount={ALL_SOURCES.length}
              anchorLabel={anchor?.label ?? null}
              jumps={searchCriteria ? siteJumps(searchCriteria) : undefined}
              /* Activity used to hold a whole row of the frozen header for
                 one pill; it rides the count row now. It's diligence on the
                 same inventory (price cuts, relists, delistings), so it
                 opens here over the browse instead of a tab away. */
              trailing={
                !loading ? (
                  <button
                    className={activityOpen ? "pill is-on" : "pill"}
                    aria-expanded={activityOpen}
                    onClick={() => setActivityOpen((v) => !v)}
                  >
                    <Icon name="bell" size={13} />
                    Activity{unread > 0 ? ` (${unread})` : ""}
                  </button>
                ) : null
              }
              />
            )}
          </div>
        )}

        {tab === "feed" && activityOpen && !loading && (
          <Changes
            changes={changes}
            notices={notices}
            listings={listings}
            onOpen={setOpen}
            onRefresh={refresh}
            refreshing={refreshing}
          />
        )}

        {tab === "feed" && !activityOpen && (
          <>
            {loading ? null : visible.length === 0 ? (
              <Empty
                filtered={listings.length > 0}
                onRefresh={refresh}
                onClear={clearFilters}
              />
            ) : (
              // Zillow's split, always: the map holds still on the left while
              // the results scroll on the right, hover linked both ways. The
              // old Photos/Map toggle was a decision nobody needed to make.
              <div className="split">
                <div className="split-map">
                  <CityMap
                    listings={visible}
                    onOpen={setOpen}
                    linkedId={linkedId}
                    onHover={setLinkedId}
                  />
                </div>
                <div className="split-cards" ref={gridRef}>
                  {visible.slice(0, pageSize).map((listing, i) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      via={via(listing)}
                      focused={i === focus}
                      linked={linkedId === listing.id}
                      preferredSource={profile.preferredSource}
                      onHover={setLinkedId}
                      onOpen={openCard}
                      onStar={star}
                      onPass={pass}
                      onReach={reachOut}
                    />
                  ))}
                  {visible.length > pageSize && (
                    <div ref={sentinelRef} className="more-sentinel">
                      Showing {pageSize} of {visible.length.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {loading && tab !== "feed" && (
          <div className="surface" style={{ padding: 24 }} aria-busy="true">
            <div className="skeleton skeleton-line" style={{ width: "40%", height: 16 }} />
            <div className="skeleton skeleton-line" style={{ width: "70%", marginTop: 10 }} />
            <div className="skeleton skeleton-line" style={{ width: "55%", marginTop: 8 }} />
          </div>
        )}

        {!loading && tab === "pipeline" && (
          <div className="page-pipeline">
            {/* Phones only: the rail that carries this status on desktop is
                a bottom tab bar down there, so the strip covers for it. */}
            <Timeline info={phase} funnel={funnel} moveInDate={profile.moveInDate} />

            <PipelineBoard
              listings={listings}
              onOpen={setOpen}
              onMove={moveStage}
              onQuickAdd={quickAdd}
              onPlanTours={() => setPlanning(true)}
              onPass={(l) => setPassing(l)}
              onChaseAll={() => setBulkMode("chase")}
              onReachAll={() => setBulkMode("first")}
              onReviewTours={() => setReviewing(true)}
              onLean={setLean}
              onAppResult={setAppResult}
              onSecured={setSecured}
              onOpenAt={(l, sec) => {
                setDrawerJump(sec);
                setOpen(l);
              }}
              onAddToCalendar={downloadIcs}
              crewTag={(l) => {
                if (!crew) return null;
                // Point person first — on a working board, "who's on this"
                // beats "who found it".
                const poc = crewName(l.pocId);
                if (poc) return `${poc} has point`;
                return via(l);
              }}
            />
          </div>
        )}

        {/* Compare is the choosing step, so it stands on its own in the nav:
            find (Listings), work it (Pipeline), choose (here). */}
        {!loading && tab === "compare" && (
          <div className="page-panels page-compare">
            <Compare
              listings={listings}
              onOpen={setOpen}
              onMove={moveStage}
              onLean={setLean}
              onMark={markAmenity}
              preferredSource={profile.preferredSource}
              onNotes={async (id, notes) => {
                await patch(id, { action: "notes", notes });
                loadFeed();
              }}
            />
          </div>
        )}

        {!loading && tab === "profile" && (
          <div className="page-panels">
            <div className="profilehead">
              <h1>Your account</h1>
              <div className="profiletabs" role="tablist">
                {(
                  [
                    ["details", "Your details"],
                    ["search", "What you're looking for"],
                    ["crew", "Search together"],
                    ["packet", "Application packet"],
                    ["api", "Data & refresh"],
                  ] as [ProfileSection, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={section === key}
                    className={section === key ? "pill is-on" : "pill"}
                    onClick={() => setSection(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {section === "details" && (
              <ProfileForm
                profile={profile}
                onSave={saveProfile}
                onGoPacket={() => setSection("packet")}
              />
            )}
            {section === "search" && (
              <div className="page-panels" style={{ display: "grid", gap: 16 }}>
                <SearchEditor onSaved={loadFeed} />
                {/* Costs shape every card's move-in figure, so they live with
                    the search rather than with the application papers. */}
                <MoveInCosts profile={profile} onSave={saveProfile} />
              </div>
            )}
            {section === "crew" && (
              <CrewPanel
                onChanged={() => {
                  loadCrew();
                  loadFeed();
                }}
              />
            )}
            {section === "packet" && (
              <ApplicationPacket profile={profile} onSave={saveProfile} />
            )}
            {section === "api" && <ApiSettings status={api} onSaved={loadApi} />}
          </div>
        )}
      </main>

      {planning && (
        <TourPlanner
          listings={listings}
          onClose={() => setPlanning(false)}
          onOpen={(l) => {
            setPlanning(false);
            setOpen(l);
          }}
        />
      )}

      {openListing && (
        <ListingDrawer
          listing={openListing}
          profile={profile}
          jumpTo={drawerJump}
          onClose={() => {
            setOpen(null);
            setDrawerJump(null);
          }}
          onChanged={loadFeed}
          crew={crew}
          all={listings}
        />
      )}

      {/* The chase run: follow up with the whole Contacted column in one
          sitting, one pre-written tap per place. */}
      {bulkMode && (
        <ChaseAll
          mode={bulkMode}
          listings={listings.filter(
            (l) => l.stage === (bulkMode === "chase" ? "contacted" : "interested")
          )}
          all={listings}
          profile={profile}
          onLog={async (l, channel) => {
            await patch(
              l.id,
              {
                action: "contact",
                channel,
                direction: "out",
                who: l.contactName,
                note: bulkMode === "chase" ? "Follow-up" : "Tour request",
              },
              false
            );
            // A first contact moves the card forward, same as the card button.
            if (bulkMode === "first") {
              await patch(l.id, { action: "stage", stage: "contacted" }, false);
            }
          }}
          onClose={() => {
            setBulkMode(null);
            loadFeed();
            loadChanges();
          }}
        />
      )}

      {/* Review mode: the toured places replayed one at a time, footage on
          screen, a thumb per place. The whole day judged in a minute. */}
      {reviewing && (
        <ReviewTours
          listings={listings.filter((l) => l.stage === "toured")}
          onLean={setLean}
          onOpen={(l) => {
            setReviewing(false);
            setOpen(l);
          }}
          onClose={() => setReviewing(false)}
        />
      )}

      {/* Passing from the board. In a crew it asks why, so the person who
          found it learns something; solo it's the same one tap it always was. */}
      {passing && (
        <PassDialog
          listing={passing}
          finderName={
            passing.addedById && crew
              ? (crew.members.find((m) => m.userId === passing.addedById && !m.isYou)?.name ??
                null)
              : null
          }
          onConfirm={(reason, reasons) => passWithReason(passing, reason, reasons)}
          onClose={() => setPassing(null)}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />
      {/* Uploads outlive the panel that started them; this is their heartbeat. */}
      <UploadStatus />

    </div>
  );
}

/**
 * Two different nothings, two different answers.
 *
 * "You have no listings at all" and "your filters excluded all 300 of them" are
 * unrelated problems, and offering "check for new listings" to someone who has
 * simply set the max rent too low sends them off to spend API credit on a
 * question they could answer by clicking Clear.
 */
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

function Empty({
  filtered,
  onRefresh,
  onClear,
}: {
  filtered: boolean;
  onRefresh: () => void;
  onClear: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-title">
        {filtered ? "No listings match these filters" : "Nothing tracked yet"}
      </div>
      <p className="empty-body">
        {filtered
          ? "Everything we're tracking got filtered out. Clearing the filters will bring the full list back."
          : "Pull listings from StreetEasy, Zillow, Apartments.com, HotPads and Craigslist."}
      </p>
      <div className="empty-actions">
        {filtered ? (
          <button className="btn btn-primary" onClick={onClear}>
            Clear all filters
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onRefresh}>
            Find listings now
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * API key and request budget.
 *
 * The free tier is 250 requests a month and a poll costs roughly ten, so the
 * allowance is a real limit rather than a detail — it needs to be visible, and
 * swapping in a fresh trial key has to be possible without redeploying.
 */
function ApiSettings({
  status,
  onSaved,
}: {
  status: ApiStatus | null;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [pages, setPages] = useState(String(status?.pagesPerSource ?? 1));
  const [limit, setLimit] = useState(String(status?.monthlyLimit ?? 250));
  const [checks, setChecks] = useState(String(status?.checksPerDay ?? 2));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  /** Focused after the renewal card sends you to the dashboard. */
  const keyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!status) return;
    setPages(String(status.pagesPerSource));
    setLimit(String(status.monthlyLimit));
    setChecks(String(status.checksPerDay));
  }, [status]);

  /**
   * Schedule, depth and allowance save themselves. The key deliberately does
   * not: debouncing a 27-character paste-or-type would write the first half of
   * a key mid-entry, so it commits on blur or Enter instead.
   *
   * Disabled until the first status load — before that the fields hold
   * defaults, and "saving" the defaults over real stored settings on mount is
   * how apps quietly reset people's configuration.
   */
  const settingsState = useAutosave(
    { pages, limit, checks },
    async (next) => {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pagesPerSource: Number(next.pages),
          monthlyLimit: Number(next.limit),
          checksPerDay: Number(next.checks),
        }),
      });
      onSaved();
    },
    { enabled: Boolean(status) }
  );

  async function saveKey() {
    const trimmed = key.trim();
    if (!trimmed) return;
    setBusy(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ realtyApiKey: trimmed }),
    });
    setKey("");
    setBusy(false);
    setNote("Key saved. The next check uses it");
    setTimeout(() => setNote(""), 4000);
    onSaved();
  }

  // Measured from this key's actual spend (server-side), scaled if the user is
  // trying a different page depth than the one the measurement was taken at.
  const savedPages = Math.max(status?.pagesPerSource ?? 1, 1);
  const perPoll = Math.max(
    1,
    Math.round((status?.perPollEstimate ?? 5) * (Number(pages) / savedPages))
  );
  const polls = status ? Math.floor(status.usage.remaining / perPoll) : 0;

  // Recomputed on every keystroke of the schedule dropdown — the estimate's
  // job is to answer "what if I check more often?" before the user commits.
  const days = runwayDays(status?.usage.remaining ?? 0, Number(checks), perPoll);
  const replaceBy =
    days == null
      ? null
      : new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });

  return (
    <div className="surface" style={{ padding: 20, display: "grid", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 600 }}>API key & usage</div>
        <div className="muted" style={{ fontSize: 12 }}>
          StreetEasy, Zillow, Apartments.com and HotPads all run on one RealtyAPI
          key. Craigslist needs none, so it keeps working when the quota is gone.
        </div>
      </div>

      {status && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>
              {status.usage.used} of {status.usage.limit} requests used
            </span>
            <span className="muted">key {status.keyHint}</span>
          </div>
          <div className="meter">
            <span
              style={{
                width: status.usage.exhausted
                  ? "100%"
                  : `${Math.min(100, (status.usage.used / status.usage.limit) * 100)}%`,
                background:
                  status.usage.exhausted || status.usage.remaining <= 25
                    ? "var(--warn)"
                    : "var(--accent)",
              }}
            />
          </div>
          {status.usage.exhausted ? (
            <div className="warn-text" style={{ fontSize: 12 }}>
              The API itself says this key is out of credits — the count above
              only sees requests made through DamnLease, so a key spent elsewhere
              can look healthy here. Paste a new key below to keep checking.
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              {status.usage.remaining} left. About {polls} more checks at {perPoll}{" "}
              requests each. Usage resets when you paste a new key.
            </div>
          )}
        </div>
      )}

      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        <span className="muted">Check for new listings</span>
        <select className="field" value={checks} onChange={(e) => setChecks(e.target.value)}>
          <option value="0">Only when I press the button</option>
          <option value="1">Once a day</option>
          <option value="2">Twice a day (morning and evening)</option>
          <option value="4">Every 6 hours</option>
          <option value="8">Every 3 hours</option>
        </select>
        <span className="muted" style={{ fontSize: 11 }}>
          {Number(checks) > 1 && (
            <>
              Vercel&apos;s free plan only runs one scheduled job a day, so
              anything above &ldquo;once a day&rdquo; needs Vercel Pro or a free
              external pinger hitting <code>/api/cron/poll</code>. Pressing
              &ldquo;Check for new&rdquo; always works.{" "}
            </>
          )}
          {days == null
            ? "Nothing runs on its own. The key only spends when you press the button, so it never expires on a schedule."
            : days <= 3
              ? `⚠ At this pace you'd need a fresh key by ${replaceBy}, ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`}. Consider checking less often.`
              : `At ${Number(checks) * perPoll} requests a day you'll need a fresh key around ${replaceBy} (${days} days).`}
          {status?.lastCheckedAt
            ? ` Last checked ${new Date(status.lastCheckedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
            : ""}
        </span>
      </label>

      {/*
        Renewal, made mindless. The free tier runs dry mid-hunt by design, and
        the old answer was a paragraph of instructions from onboarding you'd
        long forgotten. When the runway is short this card walks the whole
        loop: open the dashboard (new tab), copy the key, paste it here — and
        the input is focused for you when you come back.
      */}
      {status && (days == null ? status.usage.remaining <= 25 : days <= 3) && (
        <div className="keyrenew" role="status">
          <div className="keyrenew-copy">
            <b>
              {status.usage.remaining <= 0
                ? "This key is spent."
                : `About ${status.usage.remaining} requests left on this key.`}
            </b>
            <span>
              A fresh one takes a minute and resets the meter. Same account,
              new key.
            </span>
          </div>
          <a
            className="btn btn-primary"
            href="https://realtyapi.io/dashboard"
            target="_blank"
            rel="noreferrer"
            onClick={() => keyInputRef.current?.focus()}
          >
            Get a fresh key
            <Icon name="external" size={13} />
          </a>
        </div>
      )}

      <div className="fieldgrid">
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        <span className="muted">New API key, saves when you click away</span>
        <input
          ref={keyInputRef}
          className="field"
          value={key}
          placeholder="rt_…"
          onChange={(e) => setKey(e.target.value)}
          onBlur={saveKey}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveKey();
          }}
        />
        <span className="muted" style={{ fontSize: 11 }}>
          From{" "}
          <a href="https://realtyapi.io/dashboard" target="_blank" rel="noreferrer">
            realtyapi.io/dashboard
          </a>{" "}
          — copy, paste, done. Usage resets the moment it saves.
        </span>
      </label>

        <label style={{ display: "grid", gap: 4, fontSize: 12, flex: 1 }}>
          <span className="muted">Pages per source</span>
          <select className="field" value={pages} onChange={(e) => setPages(e.target.value)}>
            <option value="1">1 · lightest (~10/check)</option>
            <option value="2">2 · deeper (~20/check)</option>
            <option value="3">3 · thorough (~30/check)</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12, flex: 1 }}>
          <span className="muted">Monthly allowance</span>
          <input
            className="field"
            value={limit}
            inputMode="numeric"
            onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ""))}
          />
        </label>
      </div>

      <div className="muted" style={{ fontSize: 11 }}>
        Listings are sorted newest-first, so one page catches everything fresh.
        Raise it only when you want to backfill deeper history.
      </div>

      <div className="savestate" data-state={busy ? "saving" : settingsState} role="status">
        {busy ? "Saving key…" : note || saveLabel(settingsState)}
      </div>
    </div>
  );
}

/** The device switch: service worker + permission + subscription, one button. */
function PushToggle() {
  const { state, enable, disable } = usePush();
  if (state === "unsupported") {
    return (
      <span className="muted" style={{ fontSize: 11 }}>
        This browser can&apos;t do device notifications. On iPhone, add DamnLease
        to your Home Screen first. Safari only allows push for installed apps.
      </span>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        className={state === "on" ? "btn" : "btn btn-primary"}
        style={{ fontSize: 12 }}
        disabled={state === "pending"}
        onClick={state === "on" ? disable : enable}
      >
        {state === "on"
          ? "Turn off on this device"
          : state === "pending"
            ? "Asking…"
            : "Notify me on this device"}
      </button>
      <span className="muted" style={{ fontSize: 11 }}>
        {state === "on"
          ? "This device gets a push when something above happens."
          : "Your browser will ask permission once."}
      </span>
    </div>
  );
}

/**
 * The details every outreach message is built from. Filling this in once is
 * what makes reaching out a single keystroke afterwards.
 */
/**
 * Commute anchors: the two or three places your week actually goes. Geocoded
 * once on save (Nominatim), then every listing wears a door-to-door estimate
 * and the feed can filter on it.
 */
function AnchorsEditor({
  anchors,
  onChange,
}: {
  anchors: NonNullable<Profile["anchors"]>;
  onChange: (next: NonNullable<Profile["anchors"]>) => void;
}) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [state, setState] = useState<"idle" | "looking" | "error">("idle");

  async function add() {
    if (!label.trim() || address.trim().length < 3) return;
    setState("looking");
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address.trim())}`);
      const body = await res.json();
      if (!res.ok || body.lat == null) throw new Error(body.error ?? "not found");
      onChange([
        ...anchors,
        { label: label.trim(), address: address.trim(), lat: body.lat, lon: body.lon },
      ]);
      setLabel("");
      setAddress("");
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        Commute anchors: work, the gym, wherever your week goes
      </span>
      {anchors.map((anchor) => (
        <div key={anchor.label} className="anchorrow">
          <b>{anchor.label}</b>
          <span className="muted">{anchor.address}</span>
          <button
            className="linkish"
            onClick={() => onChange(anchors.filter((a) => a.label !== anchor.label))}
          >
            Remove
          </button>
        </div>
      ))}
      {anchors.length < 3 && (
        <div className="anchoradd">
          <input
            className="field"
            value={label}
            placeholder="Work"
            aria-label="Anchor name"
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            className="field"
            value={address}
            placeholder="1 Madison Ave"
            aria-label="Anchor address"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn" onClick={add} disabled={state === "looking"}>
            {state === "looking" ? "Finding…" : "Add"}
          </button>
        </div>
      )}
      {state === "error" && (
        <span className="warn-text" style={{ fontSize: 12 }}>
          Couldn&apos;t place that address. Try adding the borough.
        </span>
      )}
      <span className="muted" style={{ fontSize: 11 }}>
        Every listing then shows a rough door-to-door subway time to each
        anchor, and the feed can filter on the first one.
      </span>
    </div>
  );
}

function ProfileForm({
  profile,
  onSave,
  onGoPacket,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
  /** Jump to the packet tab, where the docs and situation now live. */
  onGoPacket: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile]);
  const saveState = useAutosave(draft, onSave);

  const owner = draft.employment === "self_employed";

  /*
   * This tab shrank on purpose. How you earn, the guarantor, and what you
   * can document all migrated to the Application packet (where the files
   * are), and the move-in date and cost levers to the search preferences
   * (where they shape the feed). What's left is the part only this tab
   * knows: who you are in a message.
   */
  const text: [keyof Profile, string, string][] = [
    ["name", "Your name", "Jake Silver"],
    ["employer", owner ? "Your business" : "Where you work", "BetterCampus"],
    [
      "income",
      owner ? "Income shown on your 2025 return" : "Your income",
      "$240,000",
    ],
    ["phone", "Your phone", "(212) 555-0134"],
    ["email", "Your email", "you@example.com"],
    ["creditNote", "Anything else worth saying", "credit in the 700s, no pets"],
  ];

  return (
    <div className="surface" style={{ padding: 20, display: "grid", gap: 14 }}>
      <div>
        <div style={{ fontWeight: 600 }}>Your details</div>
        <div className="muted" style={{ fontSize: 12 }}>
          These fill in every tour request, so you only write them once. How
          you earn and your documents live in the{" "}
          <button className="linkish" onClick={onGoPacket}>
            application packet
          </button>
          ; move-in date and costs sit with your search preferences.
        </div>
      </div>

      <div className="fieldgrid">
        {text.map(([key, label, placeholder]) => (
          <label
            key={key}
            className={key === "creditNote" ? "field-wide" : undefined}
            style={{ display: "grid", gap: 4, fontSize: 12 }}
          >
            <span className="muted">{label}</span>
            <input
              className="field"
              value={String(draft[key] ?? "")}
              placeholder={placeholder}
              inputMode={key === "phone" ? "tel" : undefined}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  // Your number ends up in every message you send; digits only,
                  // punctuated as you type, same as the listing contact field.
                  [key]: key === "phone" ? formatPhone(e.target.value) : e.target.value,
                })
              }
            />
          </label>
        ))}
      </div>

      <AnchorsEditor
        anchors={draft.anchors ?? []}
        onChange={(anchors) => setDraft({ ...draft, anchors })}
      />

      <div style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          When a place is on several sites, open
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ALL_SOURCES.map((source) => (
            <button
              key={source}
              className={
                (draft.preferredSource ?? DEFAULT_PREFERRED_SOURCE) === source
                  ? "btn btn-primary"
                  : "btn"
              }
              style={{ fontSize: 12, padding: "4px 9px" }}
              onClick={() => setDraft({ ...draft, preferredSource: source })}
            >
              {SOURCE_LABEL[source]}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          The same apartment is often listed three or four times. This decides
          which one the buttons open. The badges on each card still show every
          site carrying it.
        </span>
      </div>

      {/*
        Which pushes reach the device. The bell in the rail records everything
        regardless — muting your phone shouldn't make the app forget.
      */}
      <div style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Notifications
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(
            [
              ["crewAdds", "Crew adds a place"],
              ["watched", "A place I'm on changes"],
              ["goodDrops", "A price drops hard"],
            ] as const
          ).map(([key, label]) => {
            const on = draft.notify?.[key] ?? true;
            return (
              <button
                key={key}
                className={on ? "btn btn-primary" : "btn"}
                style={{ fontSize: 12, padding: "4px 9px" }}
                aria-pressed={on}
                onClick={() =>
                  setDraft({
                    ...draft,
                    notify: { ...draft.notify, [key]: !on },
                  })
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <PushToggle />
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Preview
        </span>
        <pre className="preview">
          {draftTourMessage(
            {
              address: "55 Morton Street",
              unit: "5J",
              price: 3500,
              bedrooms: 1,
              neighborhood: "West Village",
              myContactName: "Jane at Corcoran",
            } as FeedListing,
            draft
          )}
        </pre>
      </div>

      <div className="savestate" data-state={saveState} role="status">
        {saveLabel(saveState)}
      </div>
    </div>
  );
}
