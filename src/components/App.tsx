"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { FeedListing, Source } from "@/types";
import type { Stage } from "@/types";
import { ALL_SOURCES, DEFAULT_PREFERRED_SOURCE, SOURCE_LABEL } from "@/types";
import {
  DEFAULT_PROFILE,
  PROOF_OPTIONS,
  bestChannel,
  draftTourMessage,
  mailtoLink,
  smsLink,
  tourSubject,
  type Profile,
} from "@/lib/outreach";
import { daysUntil } from "@/lib/cost";
import { applyFilters } from "@/lib/filters";
import { nextAction } from "@/lib/nextAction";
import { runwayDays } from "@/lib/runway";
import { useAutosave, saveLabel } from "@/lib/useAutosave";
import { formatPhone } from "@/lib/phone";
import ApplicationPacket from "@/components/ApplicationPacket";
import SearchEditor from "@/components/SearchEditor";
import Compare from "@/components/Compare";
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
import Changes, { type Change } from "@/components/Changes";
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

type Tab = "today" | "feed" | "changes" | "pipeline" | "compare" | "profile";

/** Every valid tab, so a hand-edited hash can't put the app in a dead state. */
const TABS: Tab[] = ["today", "feed", "changes", "pipeline", "compare", "profile"];

interface ApiStatus {
  usage: { used: number; limit: number; remaining: number; keyHint: string };
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
  today: "today",
  feed: "listings",
  changes: "changes",
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
  // Today is the default: the hunt is a four-week sprint, and the first
  // question each morning is what to do, not what exists.
  const [tab, setTab] = useState<Tab>("today");

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
    const fromHash = () => {
      const key = window.location.hash.replace(/^#/, "") as Tab;
      return TABS.includes(key) ? key : null;
    };
    const initial = fromHash();
    if (initial) setTab(initial);
    const onPop = () => {
      const next = fromHash();
      if (next) setTab(next);
    };
    window.addEventListener("hashchange", onPop);
    return () => window.removeEventListener("hashchange", onPop);
  }, []);

  // replaceState rather than pushState: switching tabs shouldn't stack up
  // history entries you then have to press Back through five times.
  useEffect(() => {
    if (window.location.hash.replace(/^#/, "") !== tab) {
      window.history.replaceState(null, "", `#${tab}`);
    }
  }, [tab]);
  const [listings, setListings] = useState<FeedListing[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [open, setOpen] = useState<FeedListing | null>(null);
  /** The tour-day route planner, opened from the pipeline's Tour column. */
  const [planning, setPlanning] = useState(false);
  const [api, setApi] = useState<ApiStatus | null>(null);
  const [crew, setCrew] = useState<CrewView | null>(null);
  const [email, setEmail] = useState("");
  const [budget, setBudget] = useState(0);
  /** The saved search's neighborhoods — what "Where" actually means. */
  const [searchAreas, setSearchAreas] = useState<string[]>([]);
  const [focus, setFocus] = useState(0);
  const { toasts, push: toast, dismiss } = useToasts();

  // filters
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("best");
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
  /** Which panel the profile area opens on, so the menu can deep-link. */
  const [section, setSection] = useState<ProfileSection>("details");
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
  }, []);

  /**
   * One fetch for the whole corpus, then everything narrows in the browser.
   *
   * Filters used to be query parameters, so each keystroke in the search box
   * cost a round trip *and* a full server-side rescore. Now the network is
   * touched only when the underlying data can actually have changed — a poll, a
   * star, a stage move — and adjusting a filter is a synchronous array pass.
   */
  const loadFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/feed?stage=all");
      const body = await res.json();
      if (body.error) toast({ message: body.error, tone: "warn" });
      setListings(body.listings ?? []);
    } catch {
      toast({ message: "Couldn't load your listings. Check your connection.", tone: "warn" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const visible = useMemo(
    () =>
      applyFilters(listings, {
        stage: "all",
        search: query,
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
        sort: sort as Parameters<typeof applyFilters>[1]["sort"],
      }),
    [
      listings,
      query,
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
    ]
  );

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

  async function refresh() {
    setRefreshing(true);

    try {
      const body = await fetch("/api/refresh", { method: "POST" }).then((r) => r.json());
      if (body.error) {
        toast({ message: body.error, tone: "warn" });
      } else if (body.newListings || body.events) {
        toast({
          message: `${body.newListings} new · ${body.events} changes`,
          tone: "good",
        });
      } else {
        toast({ message: "Nothing new since last check" });
      }
      await Promise.all([loadFeed(), loadChanges(), loadApi()]);
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
    },
    [patch, loadFeed]
  );

  /**
   * Add a place by address.
   *
   * Matches against what's already tracked first. Somebody sending you an
   * address usually means a listing the poll already has, and creating a second
   * copy of it would split its price history and its notes in two.
   */
  const quickAdd = useCallback(
    (address: string) => {
      const hit = applyFilters(listings, { stage: "all", search: address })[0];
      if (hit) {
        moveStage(hit, "interested");
        setOpen(hit);
        toast({ message: `Found it — ${hit.address} is in your pipeline`, tone: "good" });
        return;
      }
      toast({
        message: `Nothing matching "${address}" yet. It'll appear after the next check.`,
        tone: "warn",
      });
    },
    [listings, moveStage, toast]
  );

  const pass = useCallback(
    (listing: FeedListing) => {
      setListings((list) => list.filter((l) => l.id !== listing.id));
      patch(listing.id, { action: "feedback", value: "pass" }, false).catch(() =>
        loadFeed()
      );
      toast({
        message: `Passed on ${listing.address}`,
        actionLabel: "Undo",
        onAction: () => {
          patch(listing.id, { action: "unpass" }, false)
            .then(loadFeed)
            .catch(() => loadFeed());
        },
      });
    },
    [patch, loadFeed, toast]
  );

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
      const message = draftTourMessage(listing, profile);

      await patch(
        listing.id,
        {
          action: "contact",
          channel,
          direction: "out",
          who: listing.contactName,
          note: "Tour request",
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
            message: "Message copied — paste it into their contact form",
            tone: "good",
          });
        } catch {
          toast({ message: "Opened listing — copy the message from the detail panel" });
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
            setOpen(current);
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
  }, [tab, open, visible, focus, pass, star, reachOut, profile.preferredSource]);

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
        (l) => l.starred || !["inbox", "passed", "closed"].includes(l.stage)
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
            <span className="brand brandmark">Doorly</span>
          </div>
          <div className="brandmeta">
            <span className="brandstat">
              <i aria-hidden="true" />
              <b>{counts.active}</b> live
              {counts.changed > 0 && (
                <>
                  {" · "}
                  <b>{counts.changed}</b> changed
                </>
              )}
            </span>
            {/* The countdown is the premise of the product — four weeks, then
                you're either moving or you're not. It reads as a figure. */}
            {daysToMove > 0 && (
              <span className="brandcount" data-soon={daysToMove <= 21 ? "true" : undefined}>
                <b>{daysToMove}</b>
                <span>days to move-in</span>
              </span>
            )}
          </div>
        </div>

        <div className="mobile-nav" style={{ display: "grid", gap: 2 }}>
          {(
            [
              ["today", "Today", actions.length],
              ["feed", "Listings", counts.active],
              ["changes", "Changes", changes.length],
              ["pipeline", "Pipeline", counts.pipeline],
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
              onClick={() => setTab(key)}
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
            <span className="muted">Contacted 2+ days ago — chase them</span>
          </button>
        )}

        {/*
          Checking for listings and the budget that check spends are one
          subject, and they were at opposite ends of the rail — a meter in the
          middle, the button that moves it at the bottom, with no way to tell
          they were related.
        */}
        <div className="railfoot">
          <div className="refresh">
            <button
              className="btn btn-primary"
              onClick={refresh}
              disabled={refreshing}
            >
              {refreshing ? "Checking…" : "Check for new"}
            </button>

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
                      width: `${Math.min(100, (api.usage.used / api.usage.limit) * 100)}%`,
                      background:
                        api.usage.remaining <= 25 ? "var(--warn)" : "var(--accent)",
                    }}
                  />
                </span>
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
              </button>
            )}
          </div>

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
        {(tab === "today" || tab === "feed") && (
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

        {loading && (tab === "today" || tab === "feed") && <SkeletonGrid />}

        {!loading && tab === "today" && (
          <div className="page-today">
            <Timeline info={phase} funnel={funnel} moveInDate={profile.moveInDate} />

            <div className="actions-block">
              <div className="muted section-label">DO THIS TODAY</div>
              <div className="actions">
              {actions.length === 0 ? (
                <div className="surface" style={{ padding: 20 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    Nothing urgent
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    No silent leads, no viewings booked, nothing new since
                    yesterday. Pull fresh listings or work through the feed.
                  </div>
                </div>
              ) : (
                actions.map((action) => (
                  <button
                    key={action.key}
                    className={`surface action action-${action.tone}`}
                    onClick={() => {
                      if (action.filter === "followUp") {
                        setFollowUpOnly(true);
                        setTab("feed");
                      } else if (action.filter === "new") {
                        setSort("newest");
                        setTab("feed");
                      } else if (action.filter === "tour") {
                        setTab("pipeline");
                      } else {
                        setTab("feed");
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
                ))
              )}
              </div>
            </div>

            {/* The best of what's live, so Today can stand alone. */}
            {visible.length > 0 && (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="muted section-label">BEST MATCHES RIGHT NOW</div>
                <div className="grid">
                  {visible.slice(0, 4).map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      via={via(listing)}
                      onOpen={setOpen}
                      onStar={star}
                      onPass={pass}
                      onReach={reachOut}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

            {tab === "feed" && (
              <FilterBar
              total={visible.length}
              filters={{
                query,
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
              }}
              onChange={(next: Partial<Filters>) => {
                if (next.query !== undefined) setQuery(next.query);
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
              }}
              onReset={clearFilters}
              lastCheckedAt={api?.lastCheckedAt}
              sourceCount={ALL_SOURCES.length}
              />
            )}
          </div>
        )}

        {tab === "feed" && (
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
                      onOpen={setOpen}
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

        {loading && tab !== "today" && tab !== "feed" && (
          <div className="surface" style={{ padding: 24 }} aria-busy="true">
            <div className="skeleton skeleton-line" style={{ width: "40%", height: 16 }} />
            <div className="skeleton skeleton-line" style={{ width: "70%", marginTop: 10 }} />
            <div className="skeleton skeleton-line" style={{ width: "55%", marginTop: 8 }} />
          </div>
        )}

        {!loading && tab === "changes" && (
          <Changes
            changes={changes}
            listings={listings}
            onOpen={setOpen}
            onRefresh={refresh}
            refreshing={refreshing}
          />
        )}

        {!loading && tab === "pipeline" && (
          <PipelineBoard
            listings={listings}
            onOpen={setOpen}
            onMove={moveStage}
            onQuickAdd={quickAdd}
            onPlanTours={() => setPlanning(true)}
            crewTag={(l) => {
              if (!crew) return null;
              // Point person first — on a working board, "who's on this" beats
              // "who found it".
              const poc = crewName(l.pocId);
              if (poc) return `${poc} has point`;
              return via(l);
            }}
          />
        )}

        {!loading && tab === "compare" && (
          <Compare
            listings={listings}
            onOpen={setOpen}
            onNotes={async (id, notes) => {
              await patch(id, { action: "notes", notes });
              loadFeed();
            }}
          />
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
            {section === "details" && <ProfileForm profile={profile} onSave={saveProfile} />}
            {section === "search" && <SearchEditor onSaved={loadFeed} />}
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
          onClose={() => setOpen(null)}
          onChanged={loadFeed}
          crew={crew}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />

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
    setNote("Key saved — the next check uses it");
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
                width: `${Math.min(100, (status.usage.used / status.usage.limit) * 100)}%`,
                background: status.usage.remaining <= 25 ? "var(--warn)" : "var(--accent)",
              }}
            />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {status.usage.remaining} left — about {polls} more checks at {perPoll}{" "}
            requests each. Usage resets when you paste a new key.
          </div>
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
            ? "Nothing runs on its own — the key only spends when you press the button, so it never expires on a schedule."
            : days <= 3
              ? `⚠ At this pace you'd need a fresh key by ${replaceBy} — ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`}. Consider checking less often.`
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
              A fresh one takes a minute and resets the meter — same account,
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
        <span className="muted">New API key — saves when you click away</span>
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
            <option value="1">1 — lightest (~10/check)</option>
            <option value="2">2 — deeper (~20/check)</option>
            <option value="3">3 — thorough (~30/check)</option>
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

/**
 * The details every outreach message is built from. Filling this in once is
 * what makes reaching out a single keystroke afterwards.
 */
function ProfileForm({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
}) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile]);
  const saveState = useAutosave(draft, onSave);

  const owner = draft.employment === "self_employed";

  function toggleProof(proof: string) {
    setDraft({
      ...draft,
      proofs: draft.proofs.includes(proof)
        ? draft.proofs.filter((p) => p !== proof)
        : [...draft.proofs, proof],
    });
  }

  const text: [keyof Profile, string, string][] = [
    ["name", "Your name", "Jake Silver"],
    ["employer", owner ? "Your business" : "Where you work", "BetterCampus"],
    [
      "income",
      owner ? "Income shown on your 2025 return" : "Your income",
      "$240,000",
    ],
    ["moveInDate", "Target move-in", "2026-09-01"],
    ["phone", "Your phone", "(212) 555-0134"],
    ["email", "Your email", "you@example.com"],
    ["creditNote", "Anything else worth saying", "credit in the 700s, no pets"],
  ];

  return (
    <div className="surface" style={{ padding: 20, display: "grid", gap: 14 }}>
      <div>
        <div style={{ fontWeight: 600 }}>Your details</div>
        <div className="muted" style={{ fontSize: 12 }}>
          These fill in every tour request, so you only write them once.
        </div>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          How you earn
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {(
            [
              ["self_employed", "I own a business"],
              ["employed", "I'm employed"],
              ["other", "Other"],
            ] as [Profile["employment"], string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={draft.employment === value ? "btn btn-primary" : "btn"}
              style={{ fontSize: 12 }}
              onClick={() => setDraft({ ...draft, employment: value })}
            >
              {label}
            </button>
          ))}
        </div>
        {owner && (
          <div className="muted" style={{ fontSize: 11 }}>
            No salary to quote is the usual objection. Put the figure from your
            return above and the message cites it as documented income.
          </div>
        )}
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
          which one the buttons open — the badges on each card still show every
          site carrying it.
        </span>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          What you can show
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PROOF_OPTIONS.map((proof) => (
            <button
              key={proof}
              className={draft.proofs.includes(proof) ? "btn btn-primary" : "btn"}
              style={{ fontSize: 12, padding: "4px 9px" }}
              onClick={() => toggleProof(proof)}
            >
              {proof}
            </button>
          ))}
        </div>
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
