"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { FeedListing, SearchCriteria } from "@/types";
import type { Stage } from "@/types";
import { isFacebookUrl, parseFreePost, type FreePost } from "@/lib/freepost";
import { supabaseBrowser } from "@/lib/supabase/client";
import PasteIn from "@/components/PasteIn";
import { ALL_SOURCES, DEFAULT_PREFERRED_SOURCE, SOURCE_LABEL } from "@/types";
import { DEFAULT_PROFILE, type Profile } from "@/lib/outreach";
import { daysUntil } from "@/lib/cost";
import { findPasted } from "@/lib/filters";
import { burstConfetti } from "@/lib/confetti";
import { runwayDays } from "@/lib/runway";
import { useAutosave, saveLabel } from "@/lib/useAutosave";
import { formatPhone } from "@/lib/phone";
import { usePush } from "@/lib/usePush";
import ApplyHub from "@/components/ApplyHub";
import UploadStatus from "@/components/UploadStatus";
import SearchEditor from "@/components/SearchEditor";
import Compare from "@/components/Compare";
import RailStatus from "@/components/RailStatus";
import ChaseAll from "@/components/ChaseAll";
import ReviewTours from "@/components/ReviewTours";
import MoveInCosts from "@/components/MoveInCosts";
import MessageSettings from "@/components/MessageSettings";
import Toasts, { useToasts } from "@/components/Toasts";
import Timeline from "@/components/Timeline";
import AccountMenu, { type ProfileSection } from "@/components/AccountMenu";
import CrewPanel, { type CrewView } from "@/components/CrewPanel";
import { phaseFor, funnelFor } from "@/lib/timeline";
import ListingDrawer from "@/components/ListingDrawer";
import PipelineBoard from "@/components/PipelineBoard";
import Changes, { type Change, type Notice } from "@/components/Changes";
import PassDialog from "@/components/PassDialog";
import { icsFor, icsFilename } from "@/lib/calendar";
import Logo from "@/components/Logo";
import Icon, { type IconName } from "@/components/Icon";
import JoinGate from "@/components/JoinGate";
import Tour from "@/components/Tour";
import GuestWall from "@/components/GuestWall";
import WhereToLook from "@/components/WhereToLook";
import Insights from "@/components/Insights";
// Client-only: Leaflet reads `window` the moment its module loads, which
// detonates the server prerender. The planner has no server-renderable form.
const TourPlanner = dynamic(() => import("@/components/TourPlanner"), { ssr: false });

/**
 * Three places, not five. Usage was blunt about it: the hunt happens in
 * Listings and Pipeline, with Activity as the news ticker. "Today" was a
 * landing page restating what the other tabs already knew — its action strip
 * now tops Listings and its move-in timeline heads Pipeline — and Compare is
 * the pipeline's own finalists in a different lens, so it's a view there
 * rather than a destination.
 */
type Tab = "feed" | "changes" | "pipeline" | "profile" | "compare" | "apply";

/** Every valid tab, so a hand-edited hash can't put the app in a dead state. */
const TABS: Tab[] = ["pipeline", "feed", "compare", "apply", "profile"];

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
  apply: "apply",
  profile: "you",
  changes: "listings",
};
const PATH_TABS: Record<string, Tab> = {
  pipeline: "pipeline",
  listings: "feed",
  compare: "compare",
  apply: "apply",
  you: "profile",
};

/**
 * The welcome walk's five stops, on the real interface. Each names the tab
 * it lives on so advancing can carry the person there; a target that isn't
 * on screen (the rail's refresh block on a phone) just centers the card.
 */
const TOUR_STOPS: { tab: Tab; target?: string; title: string; body: string }[] = [
  {
    tab: "pipeline",
    target: ".board",
    title: "The board is the method",
    body: "Every place you save starts in Interested and moves right as you work it. Contact, tour, decide. The red button on a card is always your next move.",
  },
  {
    tab: "feed",
    target: ".wtl-lane",
    title: "Search where the inventory lives",
    body: "StreetEasy, Zillow, the sublet boards — organized by what kind of hunt yours is, each opening with your filters already set. Browse there; the work happens here.",
  },
  {
    tab: "feed",
    target: ".searchfield",
    title: "Found one? Paste it",
    body: "A link from any site, or a whole Facebook post. It lands on your board with the price checked, the building's record pulled, and a message ready to send.",
  },
  {
    tab: "feed",
    target: ".mobile-nav",
    title: "Compare, then apply",
    body: "After a few tours, Compare lines your finalists up side by side. Apply keeps your documents in one packet so a yes can't catch you unprepared.",
  },
  {
    tab: "pipeline",
    target: ".refresh",
    title: "We watch what you're chasing",
    // No button named here: the on-the-spot check lives in the desktop
    // rail, and a phone's tour must not describe a control it can't show.
    body: "Every place on your board gets re-checked on a schedule: price drops, relists, quiet delistings land in Activity and find you. That's the tour. Go find your place.",
  },
];

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
  apply: "send",
  profile: "profile",
};

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
      ["details", "search", "messages", "crew", "api"].includes(sec)
    ) {
      setSection(sec as ProfileSection);
    }
    // The packet moved out of settings and onto the Apply tab; old
    // /you#packet bookmarks and in-app links land where it lives now.
    if (window.location.pathname === "/you" && sec === "packet") {
      setTab("apply");
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
    // The account page carries its section as a hash (/you#messages), so a
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
  /*
   * A visitor with no account, browsing the live corpus through the shop
   * window. Everything that only reads is theirs to use; the first write
   * opens the create-account modal instead of failing quietly.
   */
  const [guest, setGuest] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  /*
   * Arriving with #join (the landing's "create your account" line) opens
   * the modal over the demo — but only once we know this really is a
   * guest, so a signed-in person following an old link isn't offered an
   * account they already have.
   */
  const wantsJoin = useRef(false);
  // Layout effect on purpose: the URL-normalizing effect below rewrites the
  // hash away on its first run, so the read has to happen before any
  // passive effect gets a turn.
  useLayoutEffect(() => {
    if (window.location.hash === "#join") {
      wantsJoin.current = true;
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  useEffect(() => {
    if (guest && wantsJoin.current) {
      wantsJoin.current = false;
      setJoinOpen(true);
    }
  }, [guest]);
  const requireAccount = useCallback(() => {
    if (!guest) return false;
    setJoinOpen(true);
    return true;
  }, [guest]);

  /*
   * The welcome walk. Setup hands a brand-new account here with ?tour=1,
   * read the same way as #join: in a layout effect, before the
   * URL-normalizing effect wipes the query away. It only ever auto-runs on
   * that flag plus a clean localStorage slate, so nobody who has already
   * seen the app gets toured against their will; "Show me around" in the
   * account menu replays it on request.
   */
  const wantsTour = useRef(false);
  const [tourAt, setTourAt] = useState<number | null>(null);
  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tour")) {
      wantsTour.current = true;
      url.searchParams.delete("tour");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);
  const [changes, setChanges] = useState<Change[]>([]);
  /** Personal notices: crew adds, watched changes, good drops. */
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Auto-run only once the feed has answered: before that we don't know
  // whether this is a signed-in newcomer or a guest, and a guest's first
  // sight of the app should be the app, not a tour of it.
  useEffect(() => {
    if (loading || !wantsTour.current) return;
    wantsTour.current = false;
    if (guest || localStorage.getItem("damnlease.tourDone")) return;
    setTab(TOUR_STOPS[0].tab);
    setTourAt(0);
  }, [loading, guest]);

  const [open, setOpen] = useState<FeedListing | null>(null);

  const startTour = useCallback(() => {
    setOpen(null);
    setTab(TOUR_STOPS[0].tab);
    setTourAt(0);
  }, []);

  // Stable on purpose: effects in the drawer key off this prop, and a
  // fresh arrow per render made them re-run mid-interaction.
  const closeDrawer = useCallback(() => {
    setOpen(null);
    setDrawerJump(null);
  }, []);

  /** The tour-day route planner, opened from the pipeline's Tour column. */
  const [planning, setPlanning] = useState(false);
  /** The listing whose pass dialog is open. */
  const [passing, setPassing] = useState<FeedListing | null>(null);
  /** The bulk-outreach run: opening pitches or follow-ups, or closed. */
  const [bulkMode, setBulkMode] = useState<"first" | "chase" | null>(null);
  const [reviewing, setReviewing] = useState(false);
  /** The insights read: funnel rates and what they suggest changing. */
  const [insightsOpen, setInsightsOpen] = useState(false);

  const [api, setApi] = useState<ApiStatus | null>(null);
  const [crew, setCrew] = useState<CrewView | null>(null);
  const [email, setEmail] = useState("");
  /** The saved search, for the directory links that carry it outward. */
  const [searchCriteria, setSearchCriteria] = useState<SearchCriteria | null>(null);
  const { toasts, push: toast, dismiss } = useToasts();

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
      // which "all" hides. The drawer re-filters client-side anyway.
      //
      // A shared link's ?place= rides along so the server can guarantee the
      // named listing is in the response — for a guest it may sit outside
      // the recency window, for a signed-in reader outside their search.
      const place = new URLSearchParams(window.location.search).get("place");
      const res = await fetch(
        `/api/feed?stage=everything${place ? `&place=${encodeURIComponent(place)}` : ""}`
      );
      const body = await res.json();
      if (body.error) toast({ message: body.error, tone: "warn" });
      // The feed says whether this is a visitor looking through the shop
      // window; every mutating path checks that flag and offers an account.
      setGuest(Boolean(body.guest));
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
    // Nothing personal to notify a visitor about, and the poll would 401
    // every two minutes forever.
    if (!document.cookie.includes("-auth-token")) return;
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
  /**
   * The sender's id, when this page was opened from a share link. It rides
   * the URL as ?via= and is what lets a visitor see the footage the sender
   * attached — their walkthrough, nobody else's.
   */
  const [sharedVia, setSharedVia] = useState<string | null>(null);
  /*
   * The incoming link, snapshotted before anything can rewrite it. The URL
   * is now a live mirror of the open drawer (see the sync effect), and that
   * mirror runs on mount with nothing open — it would erase the very
   * parameters this effect is waiting on, because the feed takes a moment
   * longer to arrive than the first paint.
   */
  const incoming = useRef<{ place: string | null; via: string | null }>({
    place: null,
    via: null,
  });
  useLayoutEffect(() => {
    const search = new URLSearchParams(window.location.search);
    incoming.current = { place: search.get("place"), via: search.get("via") };
    if (incoming.current.via) setSharedVia(incoming.current.via);
  }, []);
  useEffect(() => {
    if (openedShared.current || !listings.length) return;
    const id = incoming.current.place;
    if (!id) {
      openedShared.current = true;
      return;
    }
    openedShared.current = true;
    const hit = listings.find((l) => l.id === id);
    if (hit) {
      setOpen(hit);
      setTab("feed");
    } else {
      toast({ message: "That place isn't tracked here any more.", tone: "warn" });
    }
  }, [listings, toast]);

  /** Own id, for building share links that carry your footage with them. */
  const [myId, setMyId] = useState<string | null>(null);
  useEffect(() => {
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => setMyId(data.session?.user?.id ?? null))
      .catch(() => {});
  }, []);



  /** A pasted Facebook post (or any free-text tip) awaiting the form. */
  const [pasteDraft, setPasteDraft] = useState<null | {
    text: string;
    url: string;
    parsed: FreePost;
  }>(null);

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
    /*
     * No auth cookie means every personal endpoint would answer 401 — a
     * dozen red lines in a visitor's console for nothing. The cookie is
     * readable here (Supabase's SSR cookies aren't httpOnly), so its
     * absence is a reliable, synchronous "skip the personal loads".
     */
    if (!document.cookie.includes("-auth-token")) return;
    loadChanges();
    loadApi();
    loadCrew();
    fetch("/api/searches")
      .then((r) => r.json())
      .then((b) => {
        const first = (b.searches ?? [])[0];
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
   * One press of "Check my places": re-check everything on the board against
   * the sites — prices, delistings, relists — then reload what it touched.
   */
  async function refresh() {
    if (requireAccount()) return;
    setRefreshing(true);

    try {
      const body = await fetch("/api/refresh", { method: "POST" }).then((r) => r.json());
      await Promise.all([loadFeed(), loadChanges(), loadApi()]);
      if (body.error) {
        toast({ message: body.error, tone: "warn" });
      } else if (body.events) {
        const drops = body.priceDrops
          ? `${body.priceDrops} price drop${body.priceDrops === 1 ? "" : "s"}`
          : "";
        const gone = body.gone ? `${body.gone} gone` : "";
        toast({
          message: [drops, gone].filter(Boolean).join(" · ") || `${body.events} changes`,
          tone: "good",
        });
      } else if (body.checked === 0 && body.watched === 0) {
        toast({ message: "Nothing on your board to watch yet. Save a place first" });
      } else {
        toast({ message: `Checked ${body.checked} — all holding steady` });
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
      // Every optimistic mutation funnels through here, so this one gate
      // covers stars, stages, leans, notes, contacts — the works. The
      // reload snaps any optimistic flourish back to the guest truth.
      if (requireAccount()) {
        await loadFeed();
        return;
      }
      await fetch(`/api/listings/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (reload) await loadFeed();
    },
    [loadFeed, requireAccount]
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
   * "Still deciding" on a toured card: one tap commits to a check-back
   * day (tomorrow morning), a second tap clears it. The reason and a
   * different day live in the panel; the card is for the commitment.
   */
  const toggleDeciding = useCallback(
    (listing: FeedListing) => {
      let followUpAt: string | null = null;
      if (!listing.followUpAt) {
        const at = new Date();
        at.setDate(at.getDate() + 1);
        at.setHours(9, 0, 0, 0);
        followUpAt = at.toISOString();
      }
      setListings((list) =>
        list.map((l) =>
          l.id === listing.id
            ? { ...l, followUpAt, followUpNote: followUpAt ? l.followUpNote : "" }
            : l
        )
      );
      patch(listing.id, { action: "followUp", followUpAt }, false).catch(() => loadFeed());
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
    // Pasting a place to track is the moment a visitor becomes a user.
    if (requireAccount()) return;
    /*
     * A Facebook link or a pasted post can't be looked up — the group boards
     * have no API and their terms bar scraping — so they open the paste-in
     * form instead: parse what the text says, let the person fix the rest.
     */
    if (isFacebookUrl(query)) {
      setPasteDraft({ text: "", url: query.trim(), parsed: parseFreePost("") });
      return;
    }
    const freeform = !/^https?:\/\//i.test(query.trim()) && query.trim().length > 60;
    if (freeform) {
      const parsed = parseFreePost(query);
      if (parsed.looksLikeListing) {
        setPasteDraft({ text: query, url: "", parsed });
        return;
      }
    }
    /*
     * Adding is a moment; finding something you already had is not. A place
     * already on your board gets opened and nothing else — no stage move
     * that would quietly undo where you'd filed it, no confetti for work
     * you did last week. Searching for what you own should feel like
     * search.
     */
    const alreadyMine = (l: FeedListing) =>
      l.starred || !["inbox", "passed"].includes(l.stage);

    const claim = (hit: FeedListing, message: string) => {
      const mine = alreadyMine(hit);
      if (!mine) moveStage(hit, "interested");
      setOpen(hit);
      toast({
        message: mine ? `Already on your board: ${hit.address}` : message,
        tone: "good",
      });
      // Landing a place you were hunting for deserves more than a toast.
      if (!mine) burstConfetti();
    };

    /*
     * The feed in this browser is criteria-scoped, and a paste is a manual
     * decision that outranks criteria — over-budget, wrong bedroom count,
     * outside the saved areas, none of it matters when you're adding it
     * yourself. So a local miss asks the server to search the whole shared
     * corpus; tracking the hit is what carries it into the feed permanently.
     */
    const adopt = async (id: string, message: string) => {
      // Was this already yours before the round trip? Then it's a find.
      const before = listings.find((l) => l.id === id);
      const mine = before ? alreadyMine(before) : false;
      if (!mine) await patch(id, { action: "stage", stage: "interested" }, false);
      const fresh = await loadFeed();
      const hit = fresh.find((l) => l.id === id);
      if (hit) {
        setOpen(hit);
        toast({
          message: mine ? `Already on your board: ${hit.address}` : message,
          tone: "good",
        });
        if (!mine) burstConfetti();
        return true;
      }
      return false;
    };
    const lookup = async (pull: boolean): Promise<{ id: string | null; error?: string }> => {
      try {
        const body = await fetch("/api/listings/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, pull }),
        }).then((r) => r.json());
        return { id: body.id ?? null, error: body.error };
      } catch {
        return { id: null };
      }
    };

    const hit = findPasted(listings, query);
    if (hit) {
      claim(hit, `Found it. ${hit.address} is in your pipeline`);
      return;
    }

    // Two steps, cheapest first: the shared corpus costs nothing, and a miss
    // there asks the sources for THIS place — one targeted request, not the
    // full every-source-every-page poll a paste used to trigger.
    const known = await lookup(false);
    if (known.id && (await adopt(known.id, "Found it. Added to your pipeline"))) return;

    toast({ message: "Not tracked yet. Asking the sources for that exact place" });
    const pulled = await lookup(true);
    if (pulled.id && (await adopt(pulled.id, "There it is. Added to your pipeline"))) return;
    toast({
      message:
        pulled.error ??
        "The sources don't have it. If it's a private tip, paste the whole post and I'll take it from the text.",
      tone: "warn",
    });
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
   * They answered. The reply arrives on your phone, not in the app, so the
   * record takes one tap: an inbound contact in the log, and the card's next
   * action flips from chasing to booking on the spot.
   */
  const logReply = useCallback(
    (listing: FeedListing) => {
      setListings((list) =>
        list.map((l) => (l.id === listing.id ? { ...l, hasReply: true, needsFollowUp: false } : l))
      );
      patch(
        listing.id,
        {
          action: "contact",
          channel: listing.lastContactChannel ?? "text",
          direction: "in",
          who: listing.contactName,
          note: "They replied",
        },
        false
      ).catch(() => loadFeed());
    },
    [patch, loadFeed]
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

  /**
   * The address bar says what's open.
   *
   * This used to run the other way: an incoming ?place= was consumed and
   * then scrubbed out of the URL, on the theory that a reload shouldn't
   * reopen a drawer you'd closed. The cost was the most natural sharing
   * gesture there is — copy the URL of the page you're looking at — which
   * silently produced a bare /app that opens nothing. Closing the drawer
   * clears the parameters instead, which answers the reload worry without
   * breaking copy and paste.
   *
   * `via` rides along because footage is per-person: a link that carries
   * who is looking is a link that can show that person's walkthrough. It's
   * your own id while you're the one browsing, so the URL you copy shares
   * your footage; opening someone else's link and copying it hands on
   * yours, not theirs, which is the honest default.
   */
  useEffect(() => {
    // Wait for the incoming link to be honoured; until then the URL is an
    // instruction, not a reflection.
    if (!openedShared.current) return;
    const url = new URL(window.location.href);
    const openId = openListing?.id ?? null;
    if (openId) {
      url.searchParams.set("place", openId);
      const via = myId ?? sharedVia;
      if (via) url.searchParams.set("via", via);
      else url.searchParams.delete("via");
    } else {
      url.searchParams.delete("place");
      url.searchParams.delete("via");
    }
    const next = url.pathname + url.search + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, "", next);
    }
  }, [openListing, myId, sharedVia]);

  /*
   * Compare is a strict subset of the pipeline: every board card except
   * the ones that ended (not interested, closed). The badge used to also
   * count anything starred — leftovers starred before being passed on —
   * which made Compare read BIGGER than Pipeline and look like a bug.
   * This mirrors the Compare page's own membership rule (STAGE_RANK), so
   * the number on the tab is the number of places the page compares.
   */
  const finalistCount = useMemo(
    () =>
      listings.filter(
        (l) => !["inbox", "passed", "no_go", "closed"].includes(l.stage)
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
      // What the Apply tab has to act on: toured places you could file for,
      // plus applications still waiting on a verdict.
      apply: listings.filter(
        (l) => l.stage === "toured" || (l.stage === "applied" && l.appResult === 0)
      ).length,
    }),
    [listings]
  );

  const daysToMove = daysUntil(profile.moveInDate);
  const phase = useMemo(() => phaseFor(daysToMove), [daysToMove]);
  const funnel = useMemo(
    () => funnelFor(listings, daysToMove),
    [listings, daysToMove]
  );
  // No toast: the forms save themselves as you type now, and a "Saved" pop
  // for every debounced keystroke would be a metronome. Each form shows its
  // own quiet status line instead.
  async function saveProfile(next: Profile) {
    if (requireAccount()) return;
    setProfile(next);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: next }),
    });
  }

  return (
    <div className="shell" data-guest={guest ? "yes" : undefined}>
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
          {/* A visitor has no move-in date and no funnel; showing them a red
              "Behind pace" computed from a default profile reads as either
              broken or manipulative. They get the calm truth instead. */}
          {/*
            Nothing until the feed answers. Before that we don't know whether
            this is a visitor or a hunt in progress, and rendering the
            signed-in instrument first meant a stranger watched a move-in
            countdown appear and then vanish — the app looked broken at the
            one moment it was making its first impression.
          */}
          {loading ? null : guest ? (
            /*
             * No count here. The visitor feed is capped at 400 rows, so the
             * number was always "400" — a fact about a query limit wearing
             * the clothes of a fact about New York. What a stranger needs is
             * what this place is for.
             */
            <div className="railguest">
              <b>You&rsquo;re looking around</b>
              <span className="muted">
                Every apartment you paste in gets priced, checked and chased
                from here. Nothing saves until you make an account, which is
                free.
              </span>
            </div>
          ) : (
            <RailStatus
              info={phase}
              funnel={funnel}
              moveInDate={profile.moveInDate}
              live={counts.active}
              changed={counts.changed}
              onInsights={() => setInsightsOpen(true)}
            />
          )}
        </div>

        <div className="mobile-nav" style={{ display: "grid", gap: 2 }}>
          {(
            [
              // Ordered like the hunt: find places, work them on the board,
              // then choose. Activity rides inside Find — its unread count
              // joins that badge so news shows without a tab to hold it.
              ["feed", "Find", unread],
              ["pipeline", "Pipeline", counts.pipeline],
              ["compare", "Compare", finalistCount],
              // Applying promoted from a settings panel to a step of the
              // work: find, work it, choose, then win the place.
              ["apply", "Apply", counts.apply],
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
          // The chase lives where the cards do: the board's Contacted column.
          <button
            className="callout"
            onClick={() => setTab("pipeline")}
          >
            <strong>{counts.followUp} waiting on a reply</strong>
            <span className="muted">Contacted 2+ days ago. Chase them</span>
          </button>
        )}


        {/*
          Checking for listings and the budget that check spends are one
          subject, and they were at opposite ends of the rail — a meter in the
          middle, the button that moves it at the bottom, with no way to tell
          they were related.
        */}
        <div className="railfoot">
          {/* A guest can't run a poll and has no key to meter; the whole
              refresh block would just shout over the one button that
              matters down here, the account CTA. */}
          {!guest && (
          <div className="refresh">
            {/*
              A dead key makes "Check my places" a lie — pressing it runs a
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
                {refreshing ? "Checking…" : "Check my places"}
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
          )}

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

          {guest ? (
            // The shop window's one honest ask, where the account chip
            // would sit. Everything above it works without one. The sign-in
            // line is for the person who already has a hunt here and landed
            // logged out — a shared link, a new phone, a cleared browser.
            <div className="rail-joinwrap">
              <button
                className="btn btn-primary rail-join"
                onClick={() => setJoinOpen(true)}
              >
                Create your free account
              </button>
              <a className="linkish rail-login" href="/login">
                Already hunting here? Log in
              </a>
            </div>
          ) : (
            <AccountMenu
              email={email}
              name={profile.name}
              onOpenSection={(next) => {
                setSection(next);
                setTab("profile");
              }}
              onTour={startTour}
            />
          )}
        </div>
      </nav>

      <main className="main" id="results">
        {/*
          Find: the directory out to the sites that own the inventory, and
          the paste box back in. The grid-and-map that used to live here
          imitated a listings site and miscast the product as one; the pages
          that matter — the board, Compare, Apply — are about what happens
          after the search.
        */}
        {tab === "feed" && !activityOpen && (
          <WhereToLook
            criteria={searchCriteria}
            /* While the feed loads we assume a hunt in progress — the recap
               popping in for a first-timer beats it flashing at everyone. */
            hasPlaces={
              loading ||
              listings.some((l) => l.starred || !["inbox", "passed"].includes(l.stage))
            }
            onEditSearch={() => {
              setSection("search");
              setTab("profile");
            }}
            onFind={(q) => {
              const pastable =
                /^https?:\/\//i.test(q.trim()) || isFacebookUrl(q) || q.trim().length > 60;
              if (!pastable) return false;
              quickAdd(q.trim());
              return true;
            }}
            activityPill={
              <button
                className={activityOpen ? "pill activity-pill is-on" : "pill activity-pill"}
                aria-expanded={activityOpen}
                onClick={() => setActivityOpen((v) => !v)}
              >
                <Icon name="bell" size={14} />
                Activity
                {unread > 0 && <span className="chip">{unread}</span>}
              </button>
            }
          />
        )}

        {/* Diligence on your places: price cuts, relists, delistings. */}
        {tab === "feed" && activityOpen && (
          <>
            <button
              className="linkish wtl-back"
              onClick={() => setActivityOpen(false)}
            >
              ← Back to where to look
            </button>
            <Changes
              changes={changes}
              notices={notices}
              listings={listings}
              onOpen={setOpen}
              onRefresh={refresh}
              refreshing={refreshing}
            />
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
            {/* Same reasoning as the rail: pace advice presumes a hunt. */}
            {!guest && (
              <Timeline
                info={phase}
                funnel={funnel}
                moveInDate={profile.moveInDate}
                onInsights={() => setInsightsOpen(true)}
              />
            )}

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
              onReplied={logReply}
              onLean={setLean}
              onDeciding={toggleDeciding}
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
              onBrowse={() => setTab("feed")}
              onNotes={async (id, notes) => {
                await patch(id, { action: "notes", notes });
                loadFeed();
              }}
            />
          </div>
        )}

        {/* The winning step gets its own page: which places are at the
            applying stage, and the packet they're all waiting on. */}
        {!loading && tab === "apply" && (
          <div className="page-panels">
            {/*
              The one place the shop window closes. Everything else a
              visitor sees is the market or the method; this is their own
              file — documents, readiness, the packet a landlord reads —
              and rendering it empty invites a stranger to upload a passport
              into an account that doesn't exist.
            */}
            {guest ? (
              <GuestWall
                title="Your application packet"
                body="A landlord says yes at 6pm and wants everything by 8. This is the folder that's already ready when they ask."
                points={[
                  "Your ID, pay stubs, bank letter and references in one place",
                  "A packet you paste into any email or portal, already written",
                  "A readiness score, so you know what's missing before it costs you a place",
                ]}
                onJoin={() => setJoinOpen(true)}
              />
            ) : (
              <ApplyHub
                listings={listings}
                profile={profile}
                onSave={saveProfile}
                onOpen={setOpen}
                onOpenApply={(l) => {
                  setDrawerJump("sec-apply");
                  setOpen(l);
                }}
                onGate={requireAccount}
              />
            )}
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
                    ["messages", "Your messages"],
                    ["crew", "Search together"],
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
            {section === "messages" && (
              <MessageSettings profile={profile} onSave={saveProfile} />
            )}
            {section === "details" && (
              <ProfileForm
                profile={profile}
                onSave={saveProfile}
                onGoPacket={() => setTab("apply")}
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
          onClose={closeDrawer}
          onChanged={loadFeed}
          crew={crew}
          all={listings}
          onMark={markAmenity}
          meId={myId}
          via={sharedVia}
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

      {/* The moment a visitor tried to act like a user: offer the account
          right here, on top of the thing they were doing. */}
      {joinOpen && <JoinGate onClose={() => setJoinOpen(false)} />}

      {insightsOpen && (
        <Insights listings={listings} onClose={() => setInsightsOpen(false)} />
      )}

      {tourAt != null && (
        <Tour
          stops={TOUR_STOPS}
          at={tourAt}
          onAt={(n) => {
            setOpen(null);
            if (TOUR_STOPS[n].tab !== tab) setTab(TOUR_STOPS[n].tab);
            setTourAt(n);
          }}
          onClose={() => {
            // Skipped or finished, the answer is the same: never auto-run
            // again. The account menu can always replay it.
            setTourAt(null);
            try {
              localStorage.setItem("damnlease.tourDone", "1");
            } catch {}
          }}
        />
      )}

      {/* The standing offer, top right of every page a guest visits. It
          sits below the drawer and the modal in the stack, so it never
          shouts over the thing it's selling. */}
      {guest && !joinOpen && (
        <button
          className="btn btn-primary guest-topcta"
          onClick={() => setJoinOpen(true)}
        >
          Create free account
        </button>
      )}

      {/* A pasted post becoming a card. Lands as Interested, same as any
          manual add: your paste outranks the criteria. */}
      {pasteDraft && (
        <PasteIn
          text={pasteDraft.text}
          url={pasteDraft.url}
          parsed={pasteDraft.parsed}
          onClose={() => setPasteDraft(null)}
          onDone={async (id) => {
            setPasteDraft(null);
            await patch(id, { action: "stage", stage: "interested" }, false);
            const fresh = await loadFeed();
            const hit = fresh.find((l) => l.id === id);
            if (hit) setOpen(hit);
            toast({ message: "On the board. Reach out while it's fresh", tone: "good" });
            burstConfetti();
          }}
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
  const [limit, setLimit] = useState(String(status?.monthlyLimit ?? 250));
  const [checks, setChecks] = useState(String(status?.checksPerDay ?? 2));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  /** Focused after the renewal card sends you to the dashboard. */
  const keyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!status) return;
    setLimit(String(status.monthlyLimit));
    setChecks(String(status.checksPerDay));
  }, [status]);

  /**
   * Schedule and allowance save themselves. The key deliberately does
   * not: debouncing a 27-character paste-or-type would write the first half of
   * a key mid-entry, so it commits on blur or Enter instead.
   *
   * Disabled until the first status load — before that the fields hold
   * defaults, and "saving" the defaults over real stored settings on mount is
   * how apps quietly reset people's configuration.
   */
  const settingsState = useAutosave(
    { limit, checks },
    async (next) => {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
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

  // Measured from this key's actual spend, server-side: with the watch, a
  // check costs about one request per place on the board.
  const perPoll = Math.max(1, Math.round(status?.perPollEstimate ?? 5));
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
          One RealtyAPI key powers the lookups: pricing a place you paste,
          pulling its rent history, and re-checking everything on your board.
          The site links on Find need none of it.
        </div>
      </div>

      {status && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>
              {status.usage.exhausted
                ? "Spent, by the API's own count"
                : `${status.usage.used} of ${status.usage.limit} requests used`}
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
              {status.usage.remaining} left. About {polls} more board checks at{" "}
              {perPoll} requests each. Usage resets when you paste a new key.
            </div>
          )}
        </div>
      )}

      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        <span className="muted">Re-check your places</span>
        <select className="field" value={checks} onChange={(e) => setChecks(e.target.value)}>
          <option value="0">Only when I press the button</option>
          <option value="1">Once a day</option>
          <option value="2">Twice a day (morning and evening)</option>
          <option value="4">Every 6 hours</option>
          <option value="8">Every 3 hours</option>
        </select>
        <span className="muted" style={{ fontSize: 11 }}>
          Each check re-reads the places on your board from the sites: price
          cuts, relists, and delistings land in Activity and your
          notifications. Pressing &ldquo;Check my places&rdquo; always works
          on top of the schedule.{" "}
          {status?.usage.exhausted
            ? "Checks are paused until a fresh key lands below."
            : days == null
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
        A check costs about one request per place on your board, so a normal
        hunt fits the free tier with room to spare.
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
  /** Jump to the Apply page, where the packet and its files now live. */
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
    ["name", "Your name", "First and last"],
    ["employer", owner ? "Your business" : "Where you work", "Company, school, or your LLC"],
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
          you earn and your documents live on the{" "}
          <button className="linkish" onClick={onGoPacket}>
            Apply page
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


      <div className="savestate" data-state={saveState} role="status">
        {saveLabel(saveState)}
      </div>
    </div>
  );
}
