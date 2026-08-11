"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  ContactLog,
  FeedListing,
  ListingEvent,
  PricePoint,
  Stage,
  TourKind,
} from "@/types";
import {
  EVENT_LABEL,
  linkPreference,
  SOURCE_LABEL,
  STAGES,
  STAGE_LABEL,
} from "@/types";
import { addressSearchUrl } from "@/lib/siteLinks";
import { compactPrice } from "@/lib/cost";
import SourceMark from "@/components/SourceMark";
import Perks from "@/components/Perks";
import { amenityFacts, AMENITY_ORDER, AMENITIES, type AmenityKey } from "@/lib/amenities";
import PhotoGallery from "@/components/PhotoGallery";
import TourMedia from "@/components/TourMedia";
import { RatingDisc, MyScoreDisc, MyScoreField, ProsConsList } from "@/components/Rating";
import { nextAction, tourWhen } from "@/lib/nextAction";
import { tourQuestions } from "@/lib/tourPrep";
import type { BuildingIntel } from "@/lib/nycdata";
import {
  brokerHistory,
  incomeToAnnual,
  negotiationScript,
  qualifyCheck,
} from "@/lib/leverage";
import { commuteMinutes } from "@/lib/commute";
import { lastChangeOf } from "@/lib/timeline";
import { formatPhone, isCompletePhone } from "@/lib/phone";
import { nearestStation, stationsWithin } from "@/lib/subway";
import { siteUrl } from "@/lib/site";
import { packetReadiness } from "@/lib/packet";
import { readRentPast, rentCycles } from "@/lib/rentHistory";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
// Leaflet reads `window` on import, which detonates the server render.
const SpotMap = dynamic(() => import("@/components/SpotMap"), {
  ssr: false,
  loading: () => <div className="spotmap" aria-busy="true" />,
});
import Icon from "@/components/Icon";
import { googleCalendarUrl, icsFilename, icsFor } from "@/lib/calendar";
import {
  bestChannel,
  reachableOn,
  draftTourMessage,
  draftFollowUp,
  mailtoLink,
  smsLink,
  tourSubject,
  type Profile,
} from "@/lib/outreach";

interface Detail {
  events: ListingEvent[];
  contacts: ContactLog[];
  priceHistory: PricePoint[];
}

interface Props {
  listing: FeedListing;
  profile: Profile;
  onClose: () => void;
  onChanged: () => void;
  /** The tag-team roster, when there is one. Drives attribution + point person. */
  crew?: {
    members: { userId: string; name: string; isYou: boolean; role: string }[];
  } | null;
  /** Everything loaded, for cross-listing reads like broker memory. */
  all?: FeedListing[];
  /**
   * Open scrolled to a section ("sec-contact") instead of the top. The
   * board's next-action line uses this so "Add a number" is one click from
   * the field it means.
   */
  jumpTo?: string | null;
  /**
   * Record what you know about an amenity: yes, no, or null to clear back
   * to the listing's own word. The same marks the Compare grid edits, so
   * a check made here shows there and vice versa.
   */
  onMark?: (l: FeedListing, key: AmenityKey, fact: "yes" | "no" | null) => void;
}

/**
 * A timestamp as `datetime-local` wants it: local wall time, no zone.
 * Slicing the ISO string would show UTC, which is an hour or five wrong.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * Quarter-hour viewing slots, 7:00 AM through 10:00 PM. Agents really do
 * say "come at 11:45", and a list that can't hold the time you were given
 * is a list you work around.
 */
const TOUR_SLOTS: string[] = [];
for (let h = 7; h <= 22; h++) {
  for (const m of ["00", "15", "30", "45"]) {
    if (h === 22 && m !== "00") break;
    TOUR_SLOTS.push(`${String(h).padStart(2, "0")}:${m}`);
  }
}

function slotLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The slot grid plus the saved time when it falls off it (5:45 stays 5:45). */
function tourTimeOptions(current: string): string[] {
  if (!current || TOUR_SLOTS.includes(current)) return TOUR_SLOTS;
  return [...TOUR_SLOTS, current].sort();
}

/**
 * "2026-08-03" is a database's idea of a date. If the source string parses,
 * show "Aug 3"; anything human-written ("Immediate") passes through.
 */
function friendlyAvailable(text: string): string {
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) {
    const at = new Date(`${text.trim()}T12:00:00Z`);
    if (!Number.isNaN(at.getTime())) {
      return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    }
  }
  return text;
}

function money(n: number) {
  return `$${n.toLocaleString()}`;
}

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Sparkline of every price we've observed. */
function PriceChart({ points }: { points: PricePoint[] }) {
  if (points.length < 2) return null;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, 1);
  const W = 260;
  const H = 48;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - ((p.price - min) / span) * (H - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const falling = prices[prices.length - 1] < prices[0];

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" height={H}>
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke={falling ? "var(--good)" : "var(--warn)"}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span>{money(prices[0])}</span>
        <span>{money(prices[prices.length - 1])}</span>
      </div>
    </div>
  );
}

/**
 * The rent's whole life on one axis: every listing cycle from the pulled
 * record, the app's own observations folded into the tail, today's ask as
 * the final mark. Steps, not slopes — a rent holds a value until someone
 * changes it — and a gap between cycles stays a gap, because a line
 * through two unlisted years would claim a continuity the market never
 * had. The current cycle draws in accent; history recedes to muted.
 */
function RentTimeline({ cycles }: { cycles: { at: number; price: number }[][] }) {
  /*
   * Drawn in real pixels, not a scaled viewBox. A stretched viewBox scales
   * everything with the container — at drawer width the dots became blobs,
   * the label became a headline, and the year lines towered over the data.
   * Measuring the box and mapping 1 unit = 1px keeps text at text size and
   * strokes at stroke size no matter how wide the panel is.
   */
  const boxRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = cycles.flat();
  if (all.length < 2) return null;

  const H = 128;
  const TOP = 18;
  const BOTTOM = 20;
  const LEFT = 6;
  const RIGHT = 54; // room for the price labels on the gridlines

  const minT = Math.min(...all.map((p) => p.at));
  const maxT = Math.max(...all.map((p) => p.at));
  const rawMin = Math.min(...all.map((p) => p.price));
  const rawMax = Math.max(...all.map((p) => p.price));
  const rawSpan = Math.max(rawMax - rawMin, 50);
  const minP = rawMin - rawSpan * 0.08;
  const maxP = rawMax + rawSpan * 0.08;
  const spanT = Math.max(maxT - minT, 1);
  const plotW = Math.max(w - LEFT - RIGHT, 40);
  const x = (t: number) => LEFT + ((t - minT) / spanT) * plotW;
  const y = (p: number) => TOP + (1 - (p - minP) / (maxP - minP)) * (H - TOP - BOTTOM);

  // Price gridlines at round numbers: the y-axis the floating marks were
  // missing, labeled where the eye lands.
  const rawStep = rawSpan / 2.5;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const gridStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const gridLines: number[] = [];
  for (let v = Math.ceil(minP / gridStep) * gridStep; v <= maxP; v += gridStep) gridLines.push(v);

  const path = (cycle: { at: number; price: number }[]) => {
    // A one-event cycle still deserves a mark you can see: a short dash at
    // its price, not a zero-length path.
    if (cycle.length === 1) {
      const cx = x(cycle[0].at);
      const cy = y(cycle[0].price).toFixed(1);
      return `M ${Math.max(LEFT, cx - 6).toFixed(1)} ${cy} H ${(cx + 6).toFixed(1)}`;
    }
    let d = `M ${x(cycle[0].at).toFixed(1)} ${y(cycle[0].price).toFixed(1)}`;
    for (let i = 1; i < cycle.length; i++) {
      d += ` H ${x(cycle[i].at).toFixed(1)} V ${y(cycle[i].price).toFixed(1)}`;
    }
    return d;
  };

  const y0 = new Date(minT).getUTCFullYear();
  const y1 = new Date(maxT).getUTCFullYear();
  const yearStep = Math.max(1, Math.ceil((y1 - y0) / Math.max(2, Math.floor(plotW / 90))));
  const years: number[] = [];
  for (let yr = Math.ceil(y0 / yearStep) * yearStep; yr <= y1; yr += yearStep) years.push(yr);

  const last = cycles[cycles.length - 1];
  const nowPt = last[last.length - 1];
  const nowX = x(nowPt.at);
  const nowY = y(nowPt.price);

  return (
    <div ref={boxRef} className="renttimeline-box">
      {w > 0 && (
        <svg
          className="renttimeline"
          width={w}
          height={H}
          viewBox={`0 0 ${w} ${H}`}
          role="img"
          aria-label={`Rent history from ${y0} to now, ${money(rawMin)} to ${money(rawMax)}`}
        >
          {gridLines.map((v) => (
            <g key={v}>
              <line x1={LEFT} y1={y(v)} x2={LEFT + plotW} y2={y(v)} className="renttimeline-grid" />
              <text x={w - 2} y={y(v) + 3} textAnchor="end" className="renttimeline-tick">
                {money(v)}
              </text>
            </g>
          ))}
          {years.map((yr) => {
            const tx = x(Date.UTC(yr, 0, 1));
            if (tx < LEFT + 12 || tx > LEFT + plotW - 12) return null;
            return (
              <g key={yr}>
                <line
                  x1={tx}
                  y1={H - BOTTOM}
                  x2={tx}
                  y2={H - BOTTOM + 4}
                  className="renttimeline-grid"
                />
                <text x={tx} y={H - 6} textAnchor="middle" className="renttimeline-tick">
                  {yr}
                </text>
              </g>
            );
          })}
          {cycles.map((cycle, i) => (
            <path
              key={cycle[0].at}
              d={path(cycle)}
              fill="none"
              strokeWidth={i === cycles.length - 1 ? 2 : 1.6}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={i === cycles.length - 1 ? "renttimeline-now" : "renttimeline-past"}
            />
          ))}
          {cycles
            .slice(0, -1)
            .map((cycle) => cycle[cycle.length - 1])
            .map((p) => (
              <circle key={p.at} cx={x(p.at)} cy={y(p.price)} r="2" className="renttimeline-end" />
            ))}
          <circle cx={nowX} cy={nowY} r="3" className="renttimeline-dot" />
          <text
            x={Math.min(nowX - 7, LEFT + plotW - 4)}
            y={Math.min(Math.max(nowY + 3.5, TOP + 8), H - BOTTOM - 2)}
            textAnchor="end"
            className="renttimeline-nowlabel"
          >
            {money(nowPt.price)} now
          </text>
        </svg>
      )}
    </div>
  );
}

/**
 * The reading line: how far below the panel's top edge a section has to climb
 * before its chip lights. Shared by the scrollspy and the jump-to handler, so
 * tapping a chip always leaves that chip lit.
 */
const SPY_LINE = 90;

export default function ListingDrawer({
  listing,
  profile,
  onClose: requestClose,
  onChanged,
  crew,
  all,
  jumpTo,
  onMark,
}: Props) {
  /*
   * Closing is animated, which means the panel has to outlive the decision to
   * close it. Every close path sets this flag, the exit animation plays, and
   * only then does the parent unmount us — otherwise the drawer vanishes on
   * the frame the button is pressed, which is jarring next to an entrance
   * that slides.
   *
   * The timeout matches the CSS duration. If it drifts, the panel either
   * disappears mid-slide or lingers after it — both worse than no animation,
   * so the two are commented on each other.
   */
  const [closing, setClosing] = useState(false);
  const onClose = useCallback(() => {
    setClosing(true);
    setTimeout(requestClose, 180);
  }, [requestClose]);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [intel, setIntel] = useState<BuildingIntel | null>(null);
  /** Past rents: undefined = cache check in flight, null = none cached. */
  const [pastRents, setPastRents] = useState<
    { date: string; price: number; event: string }[] | null | undefined
  >(undefined);
  const [pastRentsError, setPastRentsError] = useState("");
  const [pullingPast, setPullingPast] = useState(false);
  // Render-time gate for the pull button; document isn't there on the server.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(document.cookie.includes("-auth-token")), []);

  async function pullPastRents() {
    if (pullingPast) return;
    setPullingPast(true);
    setPastRentsError("");
    try {
      const res = await fetch(`/api/listings/${encodeURIComponent(listing.id)}/history`, {
        method: "POST",
      });
      const body = await res.json();
      if (Array.isArray(body.events)) setPastRents(body.events);
      else setPastRentsError(body.error || "Couldn't reach the record. Try again in a minute.");
    } catch {
      setPastRentsError("Couldn't reach the record. Try again in a minute.");
    }
    setPullingPast(false);
  }

  /*
   * Where this place lives on the open web. Pinned in the header rather
   * than buried mid-scroll: "let me look at the real listing" is a
   * reflex you have while reading anything in this panel, and a link you
   * have to scroll back for is a link you stop using.
   */
  const sites = (() => {
    const order = linkPreference(profile.preferredSource);
    const found = [...listing.alsoOn]
      .filter((so) => so.url)
      .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
    if (!found.length && listing.url) found.push({ source: listing.source, url: listing.url });
    /*
     * A hand-added or Facebook place publishes no link of its own, and those
     * are exactly the ones you most want to check against a real listing
     * site. Fall back to a search for the address on the site you prefer,
     * so the header always offers a way out to the open web.
     */
    if (!found.length && listing.address) {
      const site = profile.preferredSource || "streeteasy";
      found.push({ source: site, url: addressSearchUrl(site, listing.address) });
    }
    return found;
  })();

  const pastRead = pastRents ? readRentPast(pastRents, listing.price) : null;
  const pastTrend =
    pastRead && pastRead.annualPct != null && pastRead.yearsSpanned != null
      ? `Rents here have moved ${pastRead.annualPct >= 0 ? "up " : "down "}about ${Math.abs(pastRead.annualPct).toFixed(1)}% a year across ${pastRead.yearsSpanned < 1.5 ? "the last year" : `${Math.round(pastRead.yearsSpanned)} years`} of listings.`
      : null;
  const pastVs = pastRead?.vsPast
    ? Math.abs(pastRead.vsPast.pct) < 0.5
      ? `Today's ask matches its ${pastRead.vsPast.year} listing.`
      : `Today's ask is ${Math.abs(pastRead.vsPast.pct).toFixed(0)}% ${pastRead.vsPast.pct > 0 ? "over" : "under"} its ${pastRead.vsPast.year} listing of ${money(pastRead.vsPast.price)}.`
    : null;
  const [negCopied, setNegCopied] = useState(false);
  /** Which section the quick tabs should light up, from scroll position. */
  const [activeSec, setActiveSec] = useState("sec-costs");
  const bodyRef = useRef<HTMLDivElement>(null);

  /*
   * Arriving with a destination. Runs after first paint so the sections have
   * heights; instant rather than smooth because on open there's no context
   * to animate from — the person asked for the contact area, not a tour of
   * everything above it.
   */
  useEffect(() => {
    if (!jumpTo) return;
    // "sec-viewing@time": land on the section AND put the cursor in the
    // control the button named. "Set the time" that ends with your cursor
    // anywhere but the time field hasn't finished its own sentence.
    const [sec, focusKey] = jumpTo.split("@");
    const body = bodyRef.current;
    const el = body?.querySelector(`[data-sec="${sec}"]`);
    if (!body || !el) return;
    const top =
      el.getBoundingClientRect().top -
      body.getBoundingClientRect().top +
      body.scrollTop -
      SPY_LINE +
      8;
    setActiveSec(sec);
    jumpUntil.current = Date.now() + 700;
    body.scrollTo({ top });
    if (focusKey) {
      const selector =
        focusKey === "time"
          ? '[data-tour-pick="day"] .rdp-day_button'
          : 'input[inputmode="tel"]';
      // Everything after the scroll settles — including opening the contact
      // editor, because the mount-time resync effect runs after this one
      // and would immediately close an editor opened here synchronously.
      setTimeout(() => {
        if (focusKey === "phone") setEditingContact(true);
        setTimeout(() => el.querySelector<HTMLElement>(selector)?.focus(), 120);
      }, 350);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo, listing.id]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const spyTick = useRef(false);
  /*
   * A tapped chip outranks the scrollspy until the smooth scroll settles.
   *
   * The last two or three sections are shorter than the panel, so once it is
   * scrolled as far as it goes they all sit below the reading line at once and
   * the spy can only ever name the final one. Tapping "Footage" scrolled to
   * the bottom and lit "Notes" — the destination was right and the tab bar
   * looked broken, which is worse than either problem alone.
   *
   * So a tap sets the chip directly and holds it while the animation runs.
   * The spy resumes the moment the user scrolls under their own steam, which
   * is when its answer is the true one again.
   */
  const jumpUntil = useRef(0);
  const [notes, setNotes] = useState(listing.notes);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [phone, setPhone] = useState(formatPhone(listing.myContactPhone));
  const [who, setWho] = useState(listing.myContactName);
  const [email, setEmail] = useState(listing.myContactEmail);
  /*
   * The viewing time as two atomic picks, not one segmented widget. Three
   * separate bugs lived in the native datetime-local — segment entry
   * garbled by resyncs, focus steals discarding half-typed dates,
   * controlled-value writes resetting the editor — because that widget
   * holds fragile mid-entry state the app can't see. A select has none: a
   * change event is a complete answer, so every pick saves instantly and
   * there is nothing to race.
   */
  const [tourDay, setTourDay] = useState(toLocalInput(listing.tourAt).slice(0, 10));
  const [tourTime, setTourTime] = useState(toLocalInput(listing.tourAt).slice(11));
  const [tourKind, setTourKind] = useState<TourKind>(listing.tourKind);
  const [tourEndTime, setTourEndTime] = useState(toLocalInput(listing.tourEndsAt).slice(11));
  const [appUrl, setAppUrl] = useState(listing.applicationUrl);
  const [decidingNote, setDecidingNote] = useState(listing.followUpNote);
  /**
   * Stage moves paint immediately and reconcile behind the scenes.
   *
   * Star and pass have been optimistic since triage got keyboard-driven, but
   * advancing the pipeline still awaited a round trip *and* disabled every
   * button while it waited — so the most deliberate action in the app was the
   * only one that felt slow.
   */
  const [stage, setStage] = useState<Stage>(listing.stage);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  // The same-agent memory feeds both the callout and the drafts, so the
  // message itself says "we've spoken" instead of leaving it to the reader.
  const knownBroker = brokerHistory(all ?? [], listing);

  /**
   * Which draft this panel is holding.
   *
   * A listing that's gone quiet needs a nudge, not the opening pitch sent a
   * second time — so the message the buttons send, the preview, and the
   * clipboard all switch together. One source, or they disagree.
   *
   * The whole contacted stage counts, not just the overdue part: any message
   * sent after the first one is by definition a follow-up.
   */
  const chasing = listing.stage === "contacted";
  const message = chasing
    ? draftFollowUp(listing, profile, knownBroker?.others[0] ?? null)
    : draftTourMessage(listing, profile, knownBroker?.others[0] ?? null);

  // A different listing in the same panel starts from its own stage.
  useEffect(() => setStage(listing.stage), [listing.id, listing.stage]);
  useEffect(() => {
    setPhone(formatPhone(listing.myContactPhone));
    setWho(listing.myContactName);
    setEmail(listing.myContactEmail);
    // Calendar taps and chips are atomic, so the server's copy can land
    // any time without eating anything mid-entry.
    setTourDay(toLocalInput(listing.tourAt).slice(0, 10));
    setTourTime(toLocalInput(listing.tourAt).slice(11));
    setTourEndTime(toLocalInput(listing.tourEndsAt).slice(11));
    setTourKind(listing.tourKind);
    if (!(document.activeElement instanceof HTMLInputElement) ||
        !document.activeElement.hasAttribute("data-deciding-note")) {
      setDecidingNote(listing.followUpNote);
    }
    setAppUrl(listing.applicationUrl);
    setEditingContact(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id, listing.myContactPhone, listing.myContactName, listing.myContactEmail, listing.tourAt, listing.tourKind, listing.tourEndsAt, listing.applicationUrl]);

  useEffect(() => {
    let live = true;
    fetch(`/api/listings/${encodeURIComponent(listing.id)}`)
      .then((r) => r.json())
      .then((d) => {
        // Only a payload shaped like a Detail gets in. An error body
        // ({error: "not signed in"}) once landed here as-is, and the first
        // `.length` read took the whole app down for guests.
        if (live && d && Array.isArray(d.events)) setDetail(d);
      })
      .catch(() => {});
    // The building's public record rides in behind the details — cached a
    // week server-side, so this is usually instant.
    setIntel(null);
    fetch(`/api/listings/${encodeURIComponent(listing.id)}/intel`)
      .then((r) => r.json())
      .then((b) => {
        if (live && b.intel) setIntel(b.intel as BuildingIntel);
      })
      .catch(() => {});
    // Past rents: cache-only on open, never a spend. The pull button below
    // is the only thing that costs a request.
    setPastRents(undefined);
    setPastRentsError("");
    setPullingPast(false);
    fetch(`/api/listings/${encodeURIComponent(listing.id)}/history`)
      .then((r) => r.json())
      .then((b) => {
        if (live) setPastRents(Array.isArray(b.events) ? b.events : null);
      })
      .catch(() => {
        if (live) setPastRents(null);
      });
    // Opening the drawer counts as reading its updates. A visitor has no
    // read-state to stamp, so the write is skipped rather than 401ing.
    if (document.cookie.includes("-auth-token")) {
      fetch(`/api/listings/${encodeURIComponent(listing.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "seen" }),
      }).catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [listing.id]);

  /**
   * Focus goes into the panel on open and back to whatever opened it on close,
   * and Tab is kept inside while it's up. Without this a keyboard user tabs
   * straight out of the dialog into the grid behind it, which is disorienting
   * sighted and unusable unsighted.
   *
   * Installed ONCE per open, with onClose read through a ref. This effect
   * used to depend on onClose — an inline arrow from the parent, fresh
   * every render — so any re-render while the panel was up re-ran it, and
   * the re-run's panel.focus() yanked focus out of whatever field you were
   * typing in. A datetime-local discards its half-typed segments the
   * moment it loses focus, which surfaced as "it won't let me set a time":
   * the debounced tour save re-rendered the app 900ms into your typing and
   * the field went blank mid-entry.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnFocusTo.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    await fetch(`/api/listings/${encodeURIComponent(listing.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    onChanged();
  }

  const reach = bestChannel(listing);
  const action = nextAction(listing);
  const contact = reachableOn(listing);

  /** The stage almost everyone moves to next, or null at the end of the line. */
  const ORDER: Stage[] = ["inbox", "interested", "contacted", "tour", "toured", "applied", "closed"];
  const at = ORDER.indexOf(stage);
  const advance = at >= 0 && at < ORDER.length - 1 ? ORDER[at + 1] : null;

  function move(next: Stage) {
    setStage(next);
    patch({ action: "stage", stage: next }).catch(() => setStage(listing.stage));
  }

  /** One write for the whole plan: start, kind, and (open house only) end. */
  function saveTour(start: string, kind: TourKind, end: string) {
    /*
     * A half-typed date can reach here reading like "202602-09-15" — the
     * year segment swallows stray digits — and an invalid Date's
     * toISOString THROWS, which used to kill the save silently and read as
     * "it won't let me set a time". Skip the write instead: the person is
     * mid-fumble, and the next valid value (or blur) will save.
     */
    const startAt = start ? new Date(start) : null;
    if (startAt && Number.isNaN(startAt.getTime())) return;
    const endAt = kind === "open_house" && end ? new Date(end) : null;
    patch({
      action: "tourAt",
      tourAt: startAt ? startAt.toISOString() : null,
      tourKind: kind,
      tourEndsAt: endAt && !Number.isNaN(endAt.getTime()) ? endAt.toISOString() : null,
    });
  }

  /**
   * A pick is a save. Chips deliver complete values, so there is no
   * debounce, no flush, no pending state: day and time both chosen means
   * write it now, and clearing the day clears the plan.
   */
  const saveTourParts = (day: string, time: string, kind: TourKind, endTime: string) => {
    if (!day) {
      if (listing.tourAt) saveTour("", kind, "");
      return;
    }
    if (!time) return; // half an answer; the hint below asks for the rest
    const end = kind === "open_house" && endTime ? `${day}T${endTime}` : "";
    saveTour(`${day}T${time}`, kind, end);
  };

  /*
   * The chosen chips stay in the window: strips scroll sideways, and a
   * selection three weeks out would otherwise sit invisibly off-screen.
   */
  /** The footer CTAs and the board's red buttons land on exact sections. */
  const goToSection = useCallback((sec: string, focusSel?: string) => {
    const body = bodyRef.current;
    const el = body?.querySelector(`[data-sec="${sec}"]`);
    if (!body || !el) return;
    const top =
      el.getBoundingClientRect().top -
      body.getBoundingClientRect().top +
      body.scrollTop -
      SPY_LINE +
      8;
    setActiveSec(sec);
    jumpUntil.current = Date.now() + 700;
    body.scrollTo({ top, behavior: "smooth" });
    if (focusSel) {
      setTimeout(() => {
        el.querySelector<HTMLElement>(focusSel)?.focus({ preventScroll: true });
      }, 400);
    }
  }, []);
  const goToViewing = useCallback(
    () =>
      goToSection(
        "sec-viewing",
        '[data-tour-pick="day"] .rdp-selected .rdp-day_button:not([disabled]), [data-tour-pick="day"] .rdp-today .rdp-day_button:not([disabled]), [data-tour-pick="day"] .rdp-day_button:not([disabled])'
      ),
    [goToSection]
  );

  /**
   * Reaching out is one action, not two: log the contact, advance the pipeline,
   * then hand off. The CRM writes happen *first* on purpose — an sms:/mailto:
   * handoff can unload the page before a later fetch lands.
   */
  async function reachOut(channel: "text" | "email" | "portal") {
    await patch({
      action: "contact",
      channel: channel === "portal" ? "portal" : channel,
      direction: "out",
      who: listing.contactName,
      note: "Tour request",
    });
    if (stage === "inbox" || stage === "interested") {
      setStage("contacted");
      await patch({ action: "stage", stage: "contacted" });
    }
    if (channel === "text") {
      // `contact`, not `listing.contactPhone` — a number you dug up yourself is
      // the only one most listings have, and sending to the published field
      // meant the button opened an empty message every time.
      window.location.href = smsLink(contact.phone, message);
    } else if (channel === "email") {
      window.location.href = mailtoLink(
        contact.email,
        tourSubject(listing),
        message
      );
    } else {
      // No published contact: draft to clipboard, then the listing's own form.
      try {
        await navigator.clipboard.writeText(message);
      } catch {
        /* the Copy button still works */
      }
      if (listing.url) window.open(listing.url, "_blank", "noopener");
    }
  }

  /**
   * The .ics as a Blob rather than a `data:` URL: Safari refuses to download
   * a data: URL from an anchor, and the file is well past the length some
   * browsers cap those at anyway.
   */
  function downloadIcs() {
    const body = icsFor(listing);
    if (!body) return;
    const url = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = icsFilename(listing);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can race the download in Firefox.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /**
   * A link straight to this apartment.
   *
   * "Look at this one" is the most common thing anyone says during a hunt,
   * and until now the only way to say it was to paste the StreetEasy URL —
   * which drops the person into the listing site without the score, the
   * true monthly, or any of the pipeline. This shares the app's own view.
   *
   * navigator.share where it exists (that's the native sheet on a phone,
   * which is where you're actually forwarding things), clipboard everywhere
   * else.
   */
  async function share() {
    const url = siteUrl(`/app?place=${encodeURIComponent(listing.id)}`);
    const title = `${listing.address}${listing.unit ? ` #${listing.unit}` : ""}`;
    const text = `${money(listing.price)}/mo · ${listing.neighborhood} · ${listing.rating}/100 on DamnLease`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // Cancelled, or the sheet refused — fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      setShared(false);
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="scrim" data-closing={closing ? "true" : undefined} onClick={onClose} />
      <aside
        ref={panelRef}
        className="drawer"
        data-closing={closing ? "true" : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={listing.address}
        tabIndex={-1}
      >
        {/*
          The shape of the panel, redrawn.

          It had become nine sections of equal weight with buttons scattered
          through five of them — the primary action lived mid-scroll, tiny
          buttons repeated what other buttons did, and finding "what do I do
          next" meant reading everything. Three rules now:

            1  One place to act. The next action and the stage live in a
               footer that never scrolls away. Everything else is reading.
            2  One judgment. Why-this-score, the price check, the red flags
               and your own score are a single section — they are all the
               same question.
            3  Quiet secondaries. Call, log, copy, preview are one row of
               small equal buttons inside the contact card, not free-floating
               peers of the primary.
        */}
        <header className="drawer-head">
          <div className="drawer-head-score">
            <RatingDisc
              rating={listing.rating}
              grade={listing.grade}
              size="lg"
              title={`${listing.rating} out of 100 for your search`}
            />
            {listing.myScore != null && <MyScoreDisc score={listing.myScore} size="sm" />}
          </div>
          <div className="drawer-head-what">
            <div className="drawer-head-price">
              {listing.buildingType === "apartmentComplex" && (
                <span className="price-from">from </span>
              )}
              {money(listing.price)}
              <span>· {listing.ratingHeadline}</span>
            </div>
            <div className="drawer-head-addr">
              {listing.address}
              {listing.unit ? ` #${listing.unit}` : ""}
            </div>
            <div className="muted">
              {listing.neighborhood || listing.borough} ·{" "}
              {listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bed`} ·{" "}
              {listing.bathrooms} bath
              {listing.sqft ? ` · ${listing.sqft} ft²` : ""}
            </div>
          </div>
          <div className="drawer-head-acts">
            {sites.length > 0 && (
              <span className="drawer-head-sites">
                {sites.map((so) => (
                  <a
                    key={so.source}
                    className="btn btn-quiet srcbtn"
                    href={so.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open on ${SOURCE_LABEL[so.source]}`}
                    aria-label={`Open on ${SOURCE_LABEL[so.source]}`}
                  >
                    {/* The brand mark alone. An external arrow on every one
                        doubled the weight of a row that sits beside the two
                        buttons that matter, and a site's own logo already
                        reads as "this opens there". */}
                    <SourceMark source={so.source} size={16} />
                  </a>
                ))}
              </span>
            )}
            <button
              className={shared ? "btn drawer-share is-done" : "btn drawer-share"}
              onClick={share}
              aria-label={`Share ${listing.address}`}
            >
              <Icon name={shared ? "check" : "share"} size={14} />
              <span className="drawer-share-label">{shared ? "Link copied" : "Share"}</span>
            </button>
            <button className="btn drawer-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={15} />
            </button>
          </div>
        </header>

        {/* Block flow, not grid: inside a height-constrained scroll container
            grid auto rows collapsed to zero and children overlapped. Normal
            flow cannot compress a child below its content. */}
        <div
          className="drawer-body"
          ref={bodyRef}
          onScroll={() => {
            // Scrollspy on a rAF leash: which section owns the reading line.
            if (spyTick.current) return;
            spyTick.current = true;
            requestAnimationFrame(() => {
              spyTick.current = false;
              const body = bodyRef.current;
              if (!body) return;
              // A jump is in flight; the chip it came from already won.
              if (Date.now() < jumpUntil.current) return;
              const sections = [...body.querySelectorAll("[data-sec]")];
              const line = body.getBoundingClientRect().top + SPY_LINE;
              let current = "sec-costs";
              for (const sec of sections) {
                if (sec.getBoundingClientRect().top <= line) {
                  current = sec.getAttribute("data-sec") ?? current;
                }
              }
              /*
               * The last sections can never win on their own.
               *
               * Once the panel is scrolled as far as it goes, everything after
               * the final screenful still sits below the reading line, so the
               * chip that lights is whichever section happens to straddle it.
               * Tapping "Footage" scrolled to the bottom and left "Contact"
               * lit, which reads as a tab bar that doesn't work.
               *
               * At the bottom the honest answer is the last section, because
               * that is what you are looking at.
               */
              if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) {
                current = sections.at(-1)?.getAttribute("data-sec") ?? current;
              }
              setActiveSec(current);
              // Keep the lit chip in view without scrolling anything else.
              const tabs = tabsRef.current;
              const chip = tabs?.querySelector<HTMLElement>(`[data-for="${current}"]`);
              if (tabs && chip) {
                const want = chip.offsetLeft - tabs.clientWidth / 2 + chip.clientWidth / 2;
                tabs.scrollTo({ left: want, behavior: "smooth" });
              }
            });
          }}
        >
          {/* Keyed by listing so the strip snaps back to the first photo when
              the panel moves to another apartment. */}
          <div className="drawer-photo-wrap">
            <PhotoGallery
              key={listing.id}
              images={listing.images}
              alt={`Photo of ${listing.address}`}
              placeholder={listing.neighborhood || listing.borough || "No photo"}
            />
            {/* Phone-only controls floating on the photo, the way every
                listing app does it — the header they replace is hidden there. */}
            <div className="drawer-photo-bar">
              <button className="photo-btn" onClick={onClose} aria-label="Back to listings">
                <Icon name="chevron-left" size={18} />
              </button>
              <span className="photo-pill">
                <button
                  className="photo-btn photo-btn-flat"
                  onClick={share}
                  aria-label={`Share ${listing.address}`}
                >
                  <Icon name={shared ? "check" : "external"} size={16} />
                </button>
                {sites[0] && (
                  <a
                    className="photo-btn photo-btn-flat"
                    href={sites[0].url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open on ${SOURCE_LABEL[sites[0].source]}`}
                  >
                    <SourceMark source={sites[0].source} size={16} />
                  </a>
                )}
              </span>
            </div>
          </div>

          {/* Phone-only: price and the vitals directly under the photo,
              reading like a listing page rather than a panel header. */}
          <div className="drawer-title-m">
            <span className="drawer-title-m-tag">
              <RatingDisc
                rating={listing.rating}
                grade={listing.grade}
                size="sm"
                title={`${listing.rating} out of 100 for your search`}
              />
              {listing.ratingHeadline}
            </span>
            <b className="drawer-title-m-price">
              {listing.buildingType === "apartmentComplex" && (
                <span className="price-from">from </span>
              )}
              {money(listing.price)}
              <span>/mo</span>
            </b>
            <span className="drawer-title-m-specs">
              <b>{listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bed`}</b>
              <b>{listing.bathrooms} bath</b>
              {listing.sqft ? <b>{listing.sqft} ft²</b> : <span>-- ft²</span>}
            </span>
            <span className="drawer-title-m-addr">
              {listing.address}
              {listing.unit ? ` #${listing.unit}` : ""}, {listing.neighborhood || listing.borough}
            </span>
          </div>

          {/* Quick tabs: pin to the top once the photo scrolls away, jump on
              tap, light up with the section under the reading line — the
              long panel's table of contents. On phones the pinned bar also
              carries the actions that matter mid-scroll: back on the left,
              the listing's own site on the right. The photo's floating
              buttons leave with the photo; these never do. */}
          <div className="drawer-pinbar">
            <button
              className="pin-act pin-back"
              onClick={onClose}
              aria-label="Back to listings"
            >
              <Icon name="chevron-left" size={17} />
            </button>
            <div className="drawer-tabs" ref={tabsRef} aria-label="Jump to a section">
            {(
              [
                ["sec-costs", "Costs", true],
                ["sec-around", "Around", listing.lat != null],
                ["sec-score", "Score", true],
                ["sec-record", "Building", Boolean(intel && (intel.violations || intel.bedbugs || intel.noise || intel.lot))],
                ["sec-viewing", "Viewing", stage === "tour"],
                ["sec-contact", "Contact", true],
                ["sec-footage", "Footage", true],
                ["sec-apply", "Apply", true],
                ["sec-notes", "Notes", true],
              ] as [string, string, boolean][]
            )
              .filter(([, , show]) => show)
              .map(([id, label]) => (
                <button
                  key={id}
                  data-for={id}
                  className={activeSec === id ? "is-on" : undefined}
                  onClick={() => {
                    const body = bodyRef.current;
                    const el = body?.querySelector(`[data-sec="${id}"]`);
                    if (!body || !el) return;
                    // Land the heading just under the pinned bar, and use
                    // the same constant the spy reads from so a tap and the
                    // highlight can't disagree about where the line is.
                    const top =
                      el.getBoundingClientRect().top -
                      body.getBoundingClientRect().top +
                      body.scrollTop -
                      SPY_LINE +
                      8;
                    // Light it now, and hold it while the scroll animates.
                    setActiveSec(id);
                    jumpUntil.current = Date.now() + 700;
                    body.scrollTo({ top, behavior: "smooth" });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {listing.url && (
              <a
                className="pin-act pin-site"
                href={listing.url}
                target="_blank"
                rel="noreferrer"
                aria-label="Open the original listing"
              >
                <SourceMark source={listing.source} size={15} />
              </a>
            )}
          </div>

          {/* Staleness, before the numbers. A listing nothing has confirmed
              in days can be gone — or worse, its page can have moved on to
              selling the unit — and the price below deserves that caveat. */}
          {(() => {
            const quiet = Math.floor(
              (Date.now() - new Date(listing.lastSeenAt).getTime()) / 86_400_000
            );
            if (quiet < 2 || !listing.isActive) return null;
            if (listing.source === "manual" || listing.source === "facebook") return null;
            return (
              <div className="stale-warn" role="note">
                <Icon name="alert" size={14} />
                <span>
                  No listing site has confirmed this in {quiet} days. Open the
                  listing and check it&apos;s still up before reaching out.
                </span>
              </div>
            );
          })()}

          {/* A place you're pitching, not renting yet: say the play out
              loud, next to both numbers it turns on. */}
          {listing.forSale && (
            <div className="sale-plan">
              <Icon name="star" size={14} />
              <span>
                Listed for sale
                {listing.salePrice ? ` at ${compactPrice(listing.salePrice)}` : ""}.
                The play here is convincing the owner to rent it to you
                {listing.price ? `, opening at ${money(listing.price)}/mo` : ""}.
                The drafts below make that pitch.
              </span>
            </div>
          )}

          <dl className="drawer-facts" data-sec="sec-costs">
            <div>
              <dt>{listing.forSale ? "Your pitch rent" : "Rent"}</dt>
              <dd>{money(listing.price)}<span>/mo</span></dd>
            </div>
            <div>
              <dt>To move in</dt>
              <dd>{money(listing.upfrontCost)}</dd>
            </div>
            <div>
              <dt>True monthly</dt>
              <dd>
                {money(listing.allInMonthly)}
                <span>fees spread</span>
              </dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd className="is-text">
                {friendlyAvailable(listing.availableText) ||
                  (listing.timing === "ready" ? "In time" : "Not stated")}
              </dd>
            </div>
          </dl>

          {/* How stale is this ad — listed when, moved when. */}
          {(() => {
            const change = lastChangeOf(listing);
            return (
              <p className="muted drawer-changed">
                Listed {when(listing.firstSeenAt)}
                {change.kind === "listed"
                  ? " · no changes since"
                  : ` · ${change.kind} ${when(change.at)}`}
              </p>
            );
          })()}

          {/* The way out to the source, right at the top — checking the full
              listing is the first thing people do, and these buttons lived at
              the very bottom of the scroll. A listing with no cross-site
              records still has its own page; an empty row read as broken. */}


          {/* A passed place explains itself — to you a week later, and to
              whoever found it. */}
          {(listing.stage === "passed" || listing.stage === "no_go") && listing.passReason && (
            <div className="passnote">
              <b>{listing.stage === "no_go" ? "Not applying" : "Passed"}</b>
              <span>{listing.passReason}</span>
              <button className="linkish" onClick={() => patch({ action: "unpass" })}>
                Put it back
              </button>
            </div>
          )}

          {/* --- getting around ------------------------------------------ */}
          {(() => {
            const near = nearestStation(listing.lat, listing.lon);
            if (!near) return null;
            const walk = stationsWithin(listing.lat, listing.lon, 12);
            return (
              <section className="dsec" data-sec="sec-around">
                <h3 className="dsec-label">Getting around</h3>
                {/* The block, not just the neighborhood's name. */}
                {listing.lat != null && listing.lon != null && (
                  <SpotMap
                    lat={listing.lat}
                    lon={listing.lon}
                    label={`${listing.address}${listing.unit ? ` #${listing.unit}` : ""}`}
                  />
                )}

                <div className="transit">
                  <div className="transit-lead">
                    <b>{near.minutes} min</b>
                    <span>
                      walk to <strong>{near.name}</strong>
                    </span>
                  </div>
                  <div className="transit-lines">
                    {near.routes.split("").map((route) => (
                      <span key={route} className="bullet" data-route={route}>
                        {route}
                      </span>
                    ))}
                  </div>
                </div>
                {walk.length > 1 && (
                  <ul className="transit-more">
                    {walk.slice(1, 4).map((station) => (
                      <li key={`${station.name}-${station.routes}`}>
                        <span className="muted">{station.minutes} min</span>
                        {station.name}
                        <span className="transit-lines">
                          {station.routes.split("").map((route) => (
                            <span key={route} className="bullet" data-route={route}>
                              {route}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Door-to-door to the places your week actually goes. */}
                {(profile.anchors ?? []).length > 0 && (
                  <ul className="commutes">
                    {(profile.anchors ?? []).map((anchor) => {
                      const est = commuteMinutes(listing, anchor);
                      return (
                        <li key={anchor.label}>
                          <b>{anchor.label}</b>
                          {est ? (
                            <span>
                              ~{est.minutes} min <i>({est.breakdown})</i>
                            </span>
                          ) : (
                            <span className="muted">no estimate</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                <p className="muted drawer-fineprint">
                  Straight-line distance at walking pace, from the MTA&apos;s own
                  station list, a couple of blocks either way
                  {(profile.anchors ?? []).length > 0
                    ? "; commute estimates assume average subway pace, not a route plan"
                    : ""}
                  .
                </p>
              </section>
            );
          })()}

          {/* --- one judgment: the score, the price, the catches, yours -- */}
          <section className="dsec" data-sec="sec-score">
            <h3 className="dsec-label">Why {listing.rating} out of 100</h3>

            {/* The third state after a tour, made deliberate: not yes, not
                no, but committed to a day you'll answer by. The reason
                rides along so the card can say what the wait is for. */}
            {stage === "toured" && (
              <div className={listing.followUpAt ? "deciding is-set" : "deciding"}>
                <span className="deciding-title">
                  {listing.followUpAt ? "Still deciding" : "Not ready to call it?"}
                </span>
                <input
                  className="field"
                  data-deciding-note
                  placeholder="What are you waiting on? Pets answer, second look, payday…"
                  value={decidingNote}
                  onChange={(e) => setDecidingNote(e.target.value)}
                  onBlur={() => {
                    if (listing.followUpAt && decidingNote !== listing.followUpNote) {
                      patch({
                        action: "followUp",
                        followUpAt: listing.followUpAt,
                        note: decidingNote,
                      });
                    }
                  }}
                />
                <div className="pickstrip">
                  {([
                    ["Tomorrow", 1],
                    ["In 2 days", 2],
                    ["In 3 days", 3],
                    ["Next week", 7],
                  ] as const).map(([label, days]) => {
                    const at = new Date();
                    at.setDate(at.getDate() + days);
                    at.setHours(9, 0, 0, 0);
                    const on =
                      listing.followUpAt != null &&
                      new Date(listing.followUpAt).toDateString() === at.toDateString();
                    return (
                      <button
                        key={label}
                        className={on ? "pickchip is-on" : "pickchip"}
                        data-deciding-days={days}
                        onClick={() =>
                          patch({
                            action: "followUp",
                            followUpAt: at.toISOString(),
                            note: decidingNote,
                          })
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {listing.followUpAt && (
                  <div className="tourtime-set">
                    <b>
                      Answer by{" "}
                      {new Date(listing.followUpAt).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </b>
                    <button
                      className="linkish"
                      onClick={() => patch({ action: "followUp", followUpAt: null })}
                    >
                      Called it, clear this
                    </button>
                  </div>
                )}
              </div>
            )}

            <div
              className={
                listing.dealVerdict === "steal" || listing.dealVerdict === "good"
                  ? "pricecheck is-good"
                  : listing.dealVerdict === "high"
                    ? "pricecheck is-high"
                    : "pricecheck"
              }
            >
              <strong>{listing.dealLabel}.</strong>
              {listing.dealVerdict === "steal" && (
                <span className="muted"> Worth verifying in person.</span>
              )}
            </div>

            <ProsConsList listing={listing} />

            {listing.flags.length > 0 && (
              <ul className="flags">
                {listing.flags.map((flag) => (
                  <li key={flag.kind} className={`flag flag-${flag.severity}`}>
                    <Icon name="alert" size={14} />
                    <span>{flag.message}</span>
                  </li>
                ))}
              </ul>
            )}

            <Perks
              keys={listing.perks}
              // The full ledger here: everything stated present and everything
              // stated absent. Silence stays invisible, which is the truth.
              absent={(() => {
                const facts = amenityFacts(listing);
                return AMENITY_ORDER.filter((k) => facts[k] === "no");
              })()}
              limit={10}
              showLabels
            />

            {/* What YOU know beats what the listing says: you stood in the
                kitchen, the listing didn't. Each row is the listing's word,
                correctable with one tap; the same marks drive the Compare
                grid, so a check made on a tour shows up on decision night. */}
            {onMark && (
              <div className="amencheck">
                <span className="amencheck-title">
                  Your amenity check
                  <span className="muted"> · tap what you saw. Compare shows the same marks</span>
                </span>
                <ul>
                  {(() => {
                    const facts = amenityFacts(listing);
                    return AMENITY_ORDER.map((key) => {
                      const listed = facts[key];
                      const mark = listing.amenityMarks?.[key];
                      const shown = mark ?? listed;
                      return (
                        <li key={key} data-state={shown}>
                          <span className="amencheck-name">{AMENITIES[key].label}</span>
                          <span className="muted amencheck-src">
                            {mark
                              ? "your check"
                              : listed === "unknown"
                                ? "not stated"
                                : "listing says"}
                          </span>
                          <span className="amencheck-btns">
                            <button
                              className={shown === "yes" ? "lean-btn is-on" : "lean-btn"}
                              data-lean={1}
                              title={mark === "yes" ? "Clear your mark" : "It has this"}
                              aria-pressed={shown === "yes"}
                              aria-label={`${AMENITIES[key].label}: has it`}
                              onClick={() => onMark(listing, key, mark === "yes" ? null : "yes")}
                            >
                              <Icon name="check" size={13} />
                            </button>
                            <button
                              className={shown === "no" ? "lean-btn is-on" : "lean-btn"}
                              data-lean={-1}
                              title={mark === "no" ? "Clear your mark" : "It doesn't"}
                              aria-pressed={shown === "no"}
                              aria-label={`${AMENITIES[key].label}: doesn't have it`}
                              onClick={() => onMark(listing, key, mark === "no" ? null : "no")}
                            >
                              <Icon name="close" size={13} />
                            </button>
                          </span>
                        </li>
                      );
                    });
                  })()}
                </ul>
              </div>
            )}

            {/* The 40× rule, before you fall for it. Only speaks when the
                profile has an income to check against. */}
            {(() => {
              const annual = incomeToAnnual(profile.income);
              if (!annual) return null;
              const q = qualifyCheck(listing.price, annual);
              return q.ok ? (
                <p className="qualify is-ok">
                  ✓ Your income clears the 40× rule for this rent (needs{" "}
                  {money(q.needed)}/yr).
                </p>
              ) : (
                <p className="qualify is-short">
                  The 40× rule wants {money(q.needed)}/yr. You&apos;re{" "}
                  {money(q.gap)} short, so plan on a guarantor. A guarantor
                  service runs about one month&apos;s rent.
                </p>
              );
            })()}

            {/* The rating knows what the listing published; it doesn't know
                the block was loud at 8pm. After a viewing, yours wins. */}
            <div className="dsec-sub">
              <h4 className="dsec-sublabel">Your score</h4>
              <MyScoreField
                score={listing.myScore}
                onChange={(next) => patch({ action: "myScore", myScore: next })}
              />
            </div>
          </section>

          {/* --- the building's rap sheet -------------------------------- */}
          {/* What the listing will never tell you: does the landlord fix
              things, has the building filed bedbugs, what do the neighbors
              call 311 about. Public record, cited as such. */}
          {intel && (intel.violations || intel.bedbugs || intel.noise || intel.lot) && (
            <section className="dsec" data-sec="sec-record">
              <h3 className="dsec-label">The building&apos;s record</h3>
              <ul className="intel">
                {intel.violations && (
                  <li className={intel.violations.openC > 0 ? "is-bad" : intel.violations.open > 0 ? "is-warn" : "is-ok"}>
                    {intel.violations.open > 0 ? (
                      <>
                        <b>{intel.violations.open} open HPD violation{intel.violations.open === 1 ? "" : "s"}</b>
                        {intel.violations.openC > 0 &&
                          `, ${intel.violations.openC} class C (immediately hazardous)`}
                        . Ask what&apos;s being done about them.
                      </>
                    ) : (
                      <>No open HPD violations{intel.violations.total > 0 ? ` (${intel.violations.total} on record, all closed)` : ""}.</>
                    )}
                  </li>
                )}
                {intel.bedbugs && (
                  <li className={intel.bedbugs.infested > 0 ? "is-warn" : "is-ok"}>
                    {intel.bedbugs.infested > 0
                      ? `Bedbug filing: ${intel.bedbugs.infested} infested unit${intel.bedbugs.infested === 1 ? "" : "s"} reported (${intel.bedbugs.lastFilingYear}). Ask about treatment and re-inspection.`
                      : `Bedbug registry: clean on the latest filing (${intel.bedbugs.lastFilingYear}).`}
                  </li>
                )}
                {intel.noise && (
                  <li className={intel.noise.count >= 20 ? "is-warn" : undefined}>
                    {intel.noise.count === 0
                      ? "No 311 noise complaints on this block in six months."
                      : `${intel.noise.count} noise complaint${intel.noise.count === 1 ? "" : "s"} to 311 on this block in six months${intel.noise.top.length ? `, mostly ${intel.noise.top.join(" and ").toLowerCase()}` : ""}.`}
                  </li>
                )}
                {/* Stabilization is money on the table: capped renewals for
                    as long as you stay. The rule can't see the unit's own
                    paperwork, so the copy asks the question instead of
                    answering it. */}
                {intel.lot?.stabilizedLikely && (
                  <li className="is-ok">
                    <b>Possibly rent stabilized:</b> built {intel.lot.yearBuilt} with{" "}
                    {intel.lot.unitsRes} apartments, which fits the classic rule
                    (before 1974, six or more units). If it is, renewal increases
                    are capped by law. Confirm free: request the unit&apos;s rent
                    history from DHCR, or ask the agent directly.
                  </li>
                )}
                {intel.lot && !intel.lot.stabilizedLikely && intel.lot.yearBuilt > 0 && (
                  <li>
                    Built {intel.lot.yearBuilt}
                    {intel.lot.unitsRes > 0
                      ? `, ${intel.lot.unitsRes} apartment${intel.lot.unitsRes === 1 ? "" : "s"} on the lot`
                      : ""}
                    . Doesn&apos;t fit the classic rent stabilization rule; newer
                    buildings can still be stabilized through tax programs, so
                    asking costs nothing.
                  </li>
                )}
              </ul>
              <p className="muted drawer-fineprint">
                NYC Open Data: HPD violations, the bedbug registry, 311 and the
                city&apos;s tax lot records, matched to this address. Public
                record, not a judgment.
              </p>
            </section>
          )}

          {/* --- the viewing, when one exists to plan -------------------- */}
          {stage === "tour" && (
            <section className="dsec" data-sec="sec-viewing">
              <h3 className="dsec-label">The viewing</h3>
              <div className="tourplan">
                <div className="tourplan-kind" role="radiogroup" aria-label="Kind of viewing">
                  {(
                    [
                      ["private", "Private tour"],
                      ["open_house", "Open house"],
                    ] as [TourKind, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={tourKind === value}
                      className={tourKind === value ? "btn btn-primary" : "btn"}
                      style={{ fontSize: 12, padding: "4px 9px" }}
                      onClick={() => {
                        setTourKind(value);
                        saveTourParts(tourDay, tourTime, value, tourEndTime);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* A booking strip, not a form: tap a day, tap a time, done.
                    Custom-drawn on purpose — the native datetime widget ate
                    three rounds of fixes with fragile mid-entry state, and
                    chips have none: a tap is atomic and saves on the spot. */}
                <div className="tourtime">
                  <span>When is it?</span>
                  {/* The calendar is react-day-picker — the same component
                      shadcn's date picker wraps, used bare so it wears this
                      design system instead of dragging in another one. */}
                  <div className="tourpicker">
                  <div className="tourcal" data-tour-pick="day">
                    <DayPicker
                      mode="single"
                      selected={tourDay ? new Date(`${tourDay}T12:00:00`) : undefined}
                      defaultMonth={tourDay ? new Date(`${tourDay}T12:00:00`) : new Date()}
                      disabled={{ before: new Date() }}
                      onSelect={(d) => {
                        if (!d) return;
                        const pad = (n: number) => String(n).padStart(2, "0");
                        const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                        setTourDay(day);
                        saveTourParts(day, tourTime, tourKind, tourEndTime);
                      }}
                    />
                  </div>
                  {/* A dropdown, not a strip: sixty quarter-hour slots
                      scan far better in a menu, and a select is still
                      atomic — one change is one complete answer. */}
                  <div className="tourside">
                  <label className="tourside-label" htmlFor="tour-time">
                    {tourKind === "open_house" ? "Starts" : "Start time"}
                  </label>
                  <select
                    id="tour-time"
                    className="field tourpick"
                    data-tour-pick="time"
                    aria-label="Viewing time"
                    value={tourTime}
                    onChange={(e) => {
                      const t = e.target.value;
                      setTourTime(t);
                      if (t) saveTourParts(tourDay, t, tourKind, tourEndTime);
                    }}
                  >
                    <option value="">Pick a time</option>
                    {tourTimeOptions(tourTime).map((t) => (
                      <option key={t} value={t}>
                        {slotLabel(t)}
                      </option>
                    ))}
                  </select>
                  {tourKind === "open_house" && (
                    <>
                      <label className="tourside-label" htmlFor="tour-end">
                        Ends
                      </label>
                      <select
                        id="tour-end"
                        className="field tourpick"
                        data-tour-pick="end"
                        aria-label="Open house end time"
                        value={tourEndTime}
                        onChange={(e) => {
                          const t = e.target.value;
                          setTourEndTime(t);
                          saveTourParts(tourDay, tourTime, tourKind, t);
                        }}
                      >
                        <option value="">Ends at…</option>
                        {tourTimeOptions(tourEndTime).map((t) => (
                          <option key={t} value={t}>
                            {slotLabel(t)}
                          </option>
                        ))}
                      </select>
                      <span className="muted tourside-hint">
                        A window, not an appointment. Show up any time inside it.
                      </span>
                    </>
                  )}
                  {tourDay && !tourTime && (
                    <span className="muted tourside-hint">
                      Now pick a time and it saves.
                    </span>
                  )}
                  {!tourDay && !listing.tourAt && (
                    <span className="muted tourside-hint">
                      Pick a day, then a time. It saves itself.
                    </span>
                  )}
                  {listing.tourAt && (
                    <div className="tourtime-set">
                      <b>{tourWhen(listing.tourAt)}</b>
                      <button
                        className="linkish"
                        onClick={() => {
                          setTourDay("");
                          setTourTime("");
                          setTourEndTime("");
                          saveTour("", tourKind, "");
                        }}
                      >
                        Clear the plan
                      </button>
                    </div>
                  )}
                  </div>
                  </div>
                </div>


                {listing.tourAt && (
                  <div className="addcal">
                    <button className="btn" onClick={downloadIcs}>
                      <Icon name="calendar" size={15} />
                      Add to calendar
                    </button>
                    <a
                      className="btn"
                      href={googleCalendarUrl(listing) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Calendar
                      <Icon name="external" size={13} />
                    </a>
                    <span className="muted">
                      Reminds you an hour before, with everything you need at the door.
                    </span>
                  </div>
                )}

                {/* What to check while you're standing in it — each question
                    comes from a gap in this specific listing, not a generic
                    viewing checklist. */}
                {tourQuestions(listing).length > 0 && (
                  <div className="tourprep">
                    <span className="tourprep-label">Ask while you&apos;re there</span>
                    <ul>
                      {tourQuestions(listing).map((q) => (
                        <li key={q.ask}>
                          <span>{q.ask}</span>
                          <i>{q.because}</i>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* --- reaching them: one card, everything in it --------------- */}
          <section className="dsec" data-sec="sec-contact">
            <h3 className="dsec-label">Reaching them</h3>

            {/* Broker memory: brokerages carry inventory, and the third
                message to the same agent shouldn't read like a stranger's
                form letter. */}
            {(() => {
              const known = knownBroker;
              if (!known) return null;
              return (
                <p className="brokerknown">
                  You&apos;ve dealt with <b>{known.name}</b> before:{" "}
                  {known.others.length === 1
                    ? `${known.others[0].address}${known.others[0].unit ? ` #${known.others[0].unit}` : ""} (${STAGE_LABEL[known.others[0].stage]})`
                    : `${known.others.length} other places: ${known.others
                        .slice(0, 3)
                        .map((o) => `${o.address} (${STAGE_LABEL[o.stage]})`)
                        .join(", ")}`}
                  . The drafts below say so, since repeat interest gets faster replies.
                </p>
              );
            })()}

            {editingContact ? (
              <div className="contactedit">
                <label>
                  <span>Their number</span>
                  <input
                    className="field"
                    value={phone}
                    inputMode="tel"
                    placeholder="(212) 555-0134"
                    autoFocus
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                  />
                </label>
                <label>
                  <span>Who is it?</span>
                  <input
                    className="field"
                    value={who}
                    placeholder="Jane at Corcoran"
                    onChange={(e) => setWho(e.target.value)}
                  />
                </label>
                <label className="contactedit-wide">
                  <span>Their email, if you have one</span>
                  <input
                    className="field"
                    value={email}
                    inputMode="email"
                    placeholder="jane@example.com"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <div className="contactedit-actions">
                  <button
                    className="btn btn-primary"
                    disabled={Boolean(phone.trim()) && !isCompletePhone(phone)}
                    onClick={async () => {
                      await patch({
                        action: "contactDetails",
                        phone: phone.trim(),
                        email: email.trim(),
                        who: who.trim(),
                      });
                      setEditingContact(false);
                    }}
                  >
                    Save contact
                  </button>
                  <button className="btn" onClick={() => setEditingContact(false)}>
                    Cancel
                  </button>
                  {phone.trim() && !isCompletePhone(phone) && (
                    <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
                      Needs 10 digits
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="reachcard">
                {/* Who you're talking to, or the honest absence of anyone. */}
                <div className="reachcard-who">
                  {contact.phone || contact.email ? (
                    <>
                      <b>{contact.who || "No name yet"}</b>
                      <span className="muted">
                        {[
                          contact.phone ? formatPhone(contact.phone) || contact.phone : null,
                          contact.email || null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {contact.mine ? " · you added this" : ""}
                      </span>
                    </>
                  ) : (
                    <span className="muted">
                      Nothing published. The message button copies your draft
                      and opens the listing's contact form.
                    </span>
                  )}
                  <button className="linkish" onClick={() => setEditingContact(true)}>
                    {contact.phone || contact.email ? "Edit" : "I have their number"}
                  </button>
                </div>

                {/*
                  The payoff for having a number, where the number is.

                  The restructure moved every action to the footer, which was
                  right for the state machine and wrong for this one: you type
                  in a phone number in order to text it, and the button has to
                  be at the end of that sentence rather than somewhere else on
                  the screen. It stays the loudest thing in this card.
                */}
                {contact.phone && (
                  <button className="textnow" onClick={() => reachOut("text")} title={message}>
                    <span className="textnow-go" aria-hidden="true">
                      <Icon name="message" size={20} />
                    </span>
                    <span className="textnow-copy">
                      <b>
                        {chasing ? "Send a follow-up to " : "Text "}
                        {formatPhone(contact.phone) || contact.phone}
                      </b>
                      <span>
                        {chasing
                          ? "One line asking if it's still available"
                          : "Opens your messages with the request already written"}
                      </span>
                    </span>
                  </button>
                )}

                {/* Small, equal, quiet: none of these is the next action. */}
                <div className="reachcard-row">
                  {contact.phone && (
                    <a
                      className="btn btn-quiet"
                      href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                      onClick={() =>
                        patch({
                          action: "contact",
                          channel: "phone",
                          direction: "out",
                          who: contact.who,
                          note: "Called",
                        })
                      }
                    >
                      <Icon name="phone" size={14} /> Call
                    </a>
                  )}
                  {reach.channel !== "email" && (contact.email || listing.url) && (
                    <button
                      className="btn btn-quiet"
                      onClick={() => reachOut("email")}
                      title="Same message, in an email draft"
                    >
                      <Icon name="mail" size={14} /> Email
                    </button>
                  )}
                  {!contact.phone && !contact.email && listing.url && (
                    <button className="btn btn-quiet" onClick={() => reachOut("portal")}>
                      <Icon name="external" size={14} /> Their contact form
                    </button>
                  )}
                  <button className="btn btn-quiet" onClick={copyMessage}>
                    {copied ? "Copied" : "Copy message"}
                  </button>
                  <button
                    className="btn btn-quiet"
                    onClick={() =>
                      patch({
                        action: "contact",
                        channel: "phone",
                        direction: "in",
                        who: contact.who,
                        note: "They replied",
                      })
                    }
                  >
                    Log a reply
                  </button>
                </div>

                <details className="reachcard-preview">
                  <summary>The message it sends</summary>
                  <pre>{message}</pre>
                </details>
              </div>
            )}

            {/* Talk them down — or don't. The comps decide which. */}
            {(() => {
              const neg = negotiationScript(listing);
              return (
                <div className={`negotiate is-${neg.stance}`}>
                  <b>
                    {neg.stance === "push"
                      ? "Talk them down"
                      : neg.stance === "move-fast"
                        ? "Don't negotiate this one"
                        : "Worth one ask"}
                  </b>
                  <span>{neg.note}</span>
                  {neg.message && (
                    <>
                      <pre>{neg.message}</pre>
                      <button
                        className="btn"
                        onClick={() => {
                          navigator.clipboard?.writeText(neg.message ?? "");
                          setNegCopied(true);
                          setTimeout(() => setNegCopied(false), 2000);
                        }}
                      >
                        {negCopied ? "Copied" : "Copy the script"}
                      </button>
                    </>
                  )}
                </div>
              );
            })()}

            {/* Tag-team: whose find, who owns the thread. */}
            {crew && crew.members.length > 1 && (
              <div className="crewline">
                {listing.addedById && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    Found by{" "}
                    {crew.members.find((m) => m.userId === listing.addedById)?.isYou
                      ? "you"
                      : (crew.members.find((m) => m.userId === listing.addedById)?.name ??
                        "a former member")}
                  </span>
                )}
                <label className="crewline-poc">
                  <span className="muted" style={{ fontSize: 12 }}>
                    Point person
                  </span>
                  <select
                    className="control control-sm"
                    value={listing.pocId ?? ""}
                    onChange={(e) =>
                      patch({ action: "poc", userId: e.target.value || null })
                    }
                    aria-label="Who talks to the agent for this one"
                  >
                    <option value="">Nobody yet</option>
                    {crew.members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.isYou ? `${m.name} (you)` : m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </section>

          {/* --- what you saw with your own eyes -------------------------- */}
          <section className="dsec" data-sec="sec-footage">
            <h3 className="dsec-label">Your tour footage</h3>
            {/* Keyed so the grid resets when the panel moves to another
                apartment. */}
            <TourMedia key={listing.id} listingId={listing.id} />
          </section>

          {/* --- the application ----------------------------------------- */}
          {/* Landlords send portal links that die in text threads. Pinned
              here, the link is where you'll look when it's time to apply,
              and one click away once pasted. Saves on blur, like notes. */}
          <section className="dsec" data-sec="sec-apply">
            <h3 className="dsec-label">The application</h3>
            {/* The handoff the funnel was missing: at the moment of applying,
                how ready the packet actually is — files, not checkboxes —
                with the jump to finish it. The fastest complete application
                usually wins the apartment. */}
            <PacketPulse profile={profile} />
            <div className="applink">
              <input
                className="field"
                type="url"
                inputMode="url"
                value={appUrl}
                placeholder="Paste the application link. RentSpree, portal, form…"
                aria-label="Application link"
                onChange={(e) => setAppUrl(e.target.value)}
                onBlur={() => {
                  if (appUrl.trim() !== listing.applicationUrl) {
                    patch({ action: "applicationUrl", url: appUrl.trim() });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              {listing.applicationUrl && (
                <a
                  className="btn btn-primary"
                  href={listing.applicationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Apply
                  <Icon name="external" size={13} />
                </a>
              )}
            </div>
          </section>

          {/* --- the record ---------------------------------------------- */}
          {/* Kept only until a pulled record exists: our own observations
              are the current cycle up close, and once the years are on
              screen they fold into that one timeline instead of telling
              half the story twice. */}
          {detail && (detail.priceHistory?.length ?? 0) > 1 && !pastRead?.rents.length && (
            <section className="dsec">
              <h3 className="dsec-label">Price history</h3>
              <PriceChart points={detail.priceHistory} />
            </section>
          )}

          {/* --- what it rented for before -------------------------------- */}
          <section className="dsec">
            <h3 className="dsec-label">Past rents</h3>
            {pastRents == null ? (
              <div className="pastrents-empty">
                <p className="muted">
                  What this exact place listed for over the years, from the
                  listing site&apos;s own record. Negotiation material: how hard
                  this landlord raises, and whether today&apos;s ask is a step
                  or a leap.
                </p>
                {pastRents === null &&
                  (signedIn ? (
                    <button className="btn" onClick={pullPastRents} disabled={pullingPast}>
                      {pullingPast ? "Pulling the record…" : "Pull its past rents"}
                      {!pullingPast && <span className="muted"> · 1 check</span>}
                    </button>
                  ) : (
                    <span className="muted">
                      Sign in and pulling it costs one check; once anyone has,
                      it&apos;s here for everyone.
                    </span>
                  ))}
                {pastRentsError && <p className="warn-text">{pastRentsError}</p>}
              </div>
            ) : !pastRead?.rents.length ? (
              <p className="muted">
                The record has no prior rental listings for this exact place.
                Newer buildings and first-time rentals often don&apos;t.
              </p>
            ) : (
              <>
                {/* One timeline, both sources: the pulled record is the
                    years, our own observations are the current cycle up
                    close, today's ask is the final mark. */}
                <RentTimeline
                  cycles={rentCycles(pastRents, detail?.priceHistory ?? [], listing.price)}
                />
                {(pastTrend || pastVs) && (
                  <p className="pastrents-read">
                    {pastTrend}
                    {pastTrend && pastVs ? " " : ""}
                    {pastVs}
                  </p>
                )}
                <ul className="pastrents">
                  {[...pastRead.rents].reverse().map((e) => (
                    <li key={`${e.date}-${e.price}`}>
                      <span className="pastrents-date">
                        {new Date(e.date).toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <b>{money(e.price)}</b>
                      <span className="muted">{(e.event || "listed").toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="dsec" data-sec="sec-notes">
            <h3 className="dsec-label">Notes</h3>
            <textarea
              className="field"
              rows={3}
              value={notes}
              placeholder="Third floor walk-up, faces the street…"
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== listing.notes && patch({ action: "notes", notes })}
            />
          </section>

          <section className="dsec">
            <h3 className="dsec-label">Timeline</h3>
            {!detail && <div className="muted" style={{ fontSize: 12 }}>Loading…</div>}
            {detail?.events.length === 0 && detail?.contacts.length === 0 && (
              <div className="muted" style={{ fontSize: 12 }}>
                Nothing has changed since we first saw it.
              </div>
            )}
            <ul className="drawer-log">
              {detail?.contacts.map((c) => (
                <li key={`c${c.id}`}>
                  <span className="chip chip-accent">
                    {c.direction === "out" ? "you →" : "← them"}
                  </span>
                  <span>
                    {c.channel}
                    {c.note ? ` · ${c.note}` : ""}
                  </span>
                  <span className="muted">{when(c.occurredAt)}</span>
                </li>
              ))}
              {detail?.events.map((e) => (
                <li key={`e${e.id}`}>
                  <span
                    className={
                      e.kind === "price_drop"
                        ? "chip chip-good"
                        : e.kind === "price_rise" || e.kind === "delisted"
                          ? "chip chip-warn"
                          : "chip"
                    }
                  >
                    {EVENT_LABEL[e.kind]}
                  </span>
                  <span>{e.detail}</span>
                  <span className="muted">{when(e.occurredAt)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="dsec">
            {/* The site buttons moved to the top of the panel; what stays down
                here is the provenance fine print, which is end-matter. */}
            <p className="muted drawer-fineprint">
              Details come from the listing sites, not from us. Last confirmed
              live {when(listing.lastSeenAt)}; first seen {when(listing.firstSeenAt)}.
              Prices and availability can change without the listing being
              updated. Confirm both before you travel.
            </p>
          </section>
        </div>

        {/*
          The footer is where you act, and it never scrolls away.

          Whatever the state machine says comes next is the one primary
          button; the stage menu sits beside it for the moves the machine
          didn't predict. Everything above this line is reading.
        */}
        <footer className="drawer-foot">
          {action.kind === "add-contact" ? (
            <button
              className="btn btn-primary btn-block"
              onClick={() => setEditingContact(true)}
            >
              {action.label}
              <i className="cta-sub">{action.hint}</i>
            </button>
          ) : action.kind === "schedule" ? (
            <button className="btn btn-primary btn-block" onClick={goToViewing}>
              {action.label}
              <i className="cta-sub">{action.hint}</i>
            </button>
          ) : action.kind === "decide" ? (
            <button
              className="btn btn-primary btn-block"
              onClick={() => goToSection("sec-score", "[data-deciding-note]")}
            >
              {action.label}
              <i className="cta-sub">{action.hint}</i>
            </button>
          ) : action.kind === "apply" ? (
            <button className="btn btn-primary btn-block" onClick={() => move("applied")}>
              {action.label}
              <i className="cta-sub">{action.hint}</i>
            </button>
          ) : action.kind === "reach" || action.kind === "chase" ? (
            <button
              className="btn btn-primary btn-block"
              onClick={() =>
                reachOut(
                  reach.channel === "text" || reach.channel === "email"
                    ? reach.channel
                    : "portal"
                )
              }
              title={reach.hint}
            >
              {action.kind === "chase" ? "Send a follow-up" : reach.label}
              <i className="cta-sub">{action.hint}</i>
            </button>
          ) : action.kind === "tour" ? (
            // A booked time is a fact you change more often than any other:
            // brokers move viewings. Saying it without offering the edit
            // was a dead end on the one line most likely to be wrong.
            <button className="stagenote btn-block is-live" onClick={goToViewing}>
              <strong>{action.label}</strong>
              <span>{action.hint} · tap to change</span>
            </button>
          ) : (
            <div className="stagenote btn-block">
              <strong>{action.label}</strong>
              <span>{action.hint}</span>
            </div>
          )}

          {advance && action.becomes !== advance && action.kind !== "apply" && (
            <button className="btn" onClick={() => move(advance)}>
              {STAGE_LABEL[advance]}
            </button>
          )}

          <select
            className="control control-sm"
            value={stage}
            onChange={(e) => move(e.target.value as Stage)}
            aria-label="Status"
          >
            {STAGES.map((option) => (
              <option key={option} value={option}>
                {STAGE_LABEL[option]}
              </option>
            ))}
          </select>

          {saving && <span className="drawer-saving" aria-live="polite" />}
        </footer>
      </aside>
    </>
  );
}


/**
 * The packet's readiness, read live where applying happens. Fetches the
 * document list on first render of the section; a percent and the missing
 * names, then one link to the packet itself.
 */
function PacketPulse({ profile }: { profile: Profile }) {
  const [docs, setDocs] = useState<{ slot: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    // A visitor has no documents; render the empty meter without the 401.
    if (!document.cookie.includes("-auth-token")) {
      setDocs([]);
      return;
    }
    fetch("/api/documents")
      .then((r) => r.json())
      .then((b) => {
        if (alive) setDocs(b.documents ?? []);
      })
      .catch(() => {
        if (alive) setDocs([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (docs === null) return null;
  const { percent, missing } = packetReadiness(profile, docs);
  return (
    <div className={percent >= 80 ? "packet-pulse is-ready" : "packet-pulse"}>
      <div className="meter">
        <span
          style={{
            width: `${percent}%`,
            background: percent >= 80 ? "var(--good)" : "var(--warn)",
          }}
        />
      </div>
      <span>
        Your packet is {percent}% ready
        {missing.length > 0 && percent < 100
          ? `. Still needed: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`
          : ". Send it with the application"}
        {" "}
        <a className="linkish" href="/apply">
          {percent < 100 ? "Finish it" : "Open it"}
        </a>
      </span>
    </div>
  );
}
