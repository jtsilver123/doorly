"use client";

import { useEffect, useRef, useState } from "react";
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
import SourceMark from "@/components/SourceMark";
import Perks from "@/components/Perks";
import PhotoGallery from "@/components/PhotoGallery";
import TourMedia from "@/components/TourMedia";
import { RatingDisc, MyScoreDisc, MyScoreField, ProsConsList } from "@/components/Rating";
import { nextAction, tourWhen } from "@/lib/nextAction";
import { tourQuestions } from "@/lib/tourPrep";
import { formatPhone, isCompletePhone } from "@/lib/phone";
import { nearestStation, stationsWithin } from "@/lib/subway";
import { siteUrl } from "@/lib/site";
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

export default function ListingDrawer({ listing, profile, onClose, onChanged, crew }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notes, setNotes] = useState(listing.notes);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [phone, setPhone] = useState(formatPhone(listing.myContactPhone));
  const [who, setWho] = useState(listing.myContactName);
  const [email, setEmail] = useState(listing.myContactEmail);
  const [tourAt, setTourAt] = useState(toLocalInput(listing.tourAt));
  const [tourKind, setTourKind] = useState<TourKind>(listing.tourKind);
  const [tourEndsAt, setTourEndsAt] = useState(toLocalInput(listing.tourEndsAt));
  const [appUrl, setAppUrl] = useState(listing.applicationUrl);
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
    ? draftFollowUp(listing, profile)
    : draftTourMessage(listing, profile);

  // A different listing in the same panel starts from its own stage.
  useEffect(() => setStage(listing.stage), [listing.id, listing.stage]);
  useEffect(() => {
    setPhone(formatPhone(listing.myContactPhone));
    setWho(listing.myContactName);
    setEmail(listing.myContactEmail);
    setTourAt(toLocalInput(listing.tourAt));
    setTourKind(listing.tourKind);
    setTourEndsAt(toLocalInput(listing.tourEndsAt));
    setAppUrl(listing.applicationUrl);
    setEditingContact(false);
  }, [listing.id, listing.myContactPhone, listing.myContactName, listing.myContactEmail, listing.tourAt, listing.tourKind, listing.tourEndsAt, listing.applicationUrl]);

  useEffect(() => {
    let live = true;
    fetch(`/api/listings/${encodeURIComponent(listing.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch(() => {});
    // Opening the drawer counts as reading its updates.
    fetch(`/api/listings/${encodeURIComponent(listing.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "seen" }),
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [listing.id]);

  /**
   * Focus goes into the panel on open and back to whatever opened it on close,
   * and Tab is kept inside while it's up. Without this a keyboard user tabs
   * straight out of the dialog into the grid behind it, which is disorienting
   * sighted and unusable unsighted.
   */
  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
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
  }, [onClose]);

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
    patch({
      action: "tourAt",
      tourAt: start ? new Date(start).toISOString() : null,
      tourKind: kind,
      tourEndsAt:
        kind === "open_house" && end ? new Date(end).toISOString() : null,
    });
  }

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
    const text = `${money(listing.price)}/mo · ${listing.neighborhood} · ${listing.rating}/100 on Doorly`;
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
      <div className="scrim" onClick={onClose} />
      <aside
        ref={panelRef}
        className="drawer"
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
            <button
              className={shared ? "btn drawer-share is-done" : "btn drawer-share"}
              onClick={share}
              aria-label={`Share ${listing.address}`}
            >
              <Icon name={shared ? "check" : "external"} size={14} />
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
        <div className="drawer-body">
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
                <a
                  className="photo-btn photo-btn-flat"
                  href={listing.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open the original listing"
                >
                  <SourceMark source={listing.source} size={16} />
                </a>
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

          <dl className="drawer-facts">
            <div>
              <dt>Rent</dt>
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

          {/* The way out to the source, right at the top — checking the full
              listing is the first thing people do, and these buttons lived at
              the very bottom of the scroll. A listing with no cross-site
              records still has its own page; an empty row read as broken. */}
          {(() => {
            const sites = [...listing.alsoOn]
              .filter((so) => so.url)
              .sort((a, b) => {
                const order = linkPreference(profile.preferredSource);
                return order.indexOf(a.source) - order.indexOf(b.source);
              });
            if (!sites.length && listing.url) {
              sites.push({ source: listing.source, url: listing.url });
            }
            if (!sites.length) return null;
            return (
              <div className="drawer-sites">
                {sites.map((so) => (
                  <a
                    key={so.source}
                    className="btn btn-quiet srcbtn"
                    href={so.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <SourceMark source={so.source} size={15} />
                    View on {SOURCE_LABEL[so.source]}
                    <Icon name="external" size={12} />
                  </a>
                ))}
              </div>
            );
          })()}

          {/* A passed place explains itself — to you a week later, and to
              whoever found it. */}
          {(listing.stage === "passed" || listing.stage === "no_go") && listing.passReason && (
            <div className="passnote">
              <b>{listing.stage === "no_go" ? "Didn't like it" : "Passed"}</b>
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
              <section className="dsec">
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
                <p className="muted drawer-fineprint">
                  Straight-line distance at walking pace, from the MTA&apos;s own
                  station list — a couple of blocks either way.
                </p>
              </section>
            );
          })()}

          {/* --- one judgment: the score, the price, the catches, yours -- */}
          <section className="dsec">
            <h3 className="dsec-label">Why {listing.rating} out of 100</h3>

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

            <Perks keys={listing.perks} limit={10} showLabels />

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

          {/* --- the viewing, when one exists to plan -------------------- */}
          {stage === "tour" && (
            <section className="dsec">
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
                        if (tourAt) saveTour(tourAt, value, tourEndsAt);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <label className="tourtime">
                  <span>{tourKind === "open_house" ? "Starts" : "When is it?"}</span>
                  <input
                    id="tour-at"
                    className="field"
                    type="datetime-local"
                    value={tourAt}
                    onChange={(e) => {
                      setTourAt(e.target.value);
                      saveTour(e.target.value, tourKind, tourEndsAt);
                    }}
                  />
                  {listing.tourAt && <b>{tourWhen(listing.tourAt)}</b>}
                </label>

                {tourKind === "open_house" && (
                  <label className="tourtime">
                    <span>Until</span>
                    <input
                      className="field"
                      type="datetime-local"
                      value={tourEndsAt}
                      onChange={(e) => {
                        setTourEndsAt(e.target.value);
                        saveTour(tourAt, tourKind, e.target.value);
                      }}
                    />
                    {listing.tourEndsAt && <b>{tourWhen(listing.tourEndsAt)}</b>}
                  </label>
                )}

                {tourKind === "open_house" && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    A window, not an appointment — show up any time inside it.
                  </span>
                )}

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
          <section className="dsec">
            <h3 className="dsec-label">Reaching them</h3>

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
                      Nothing published — the message button copies your draft
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
          <section className="dsec">
            <h3 className="dsec-label">Your tour footage</h3>
            {/* Keyed so the grid resets when the panel moves to another
                apartment. */}
            <TourMedia key={listing.id} listingId={listing.id} />
          </section>

          {/* --- the application ----------------------------------------- */}
          {/* Landlords send portal links that die in text threads. Pinned
              here, the link is where you'll look when it's time to apply —
              and one click away once pasted. Saves on blur, like notes. */}
          <section className="dsec">
            <h3 className="dsec-label">The application</h3>
            <div className="applink">
              <input
                className="field"
                type="url"
                inputMode="url"
                value={appUrl}
                placeholder="Paste the application link — RentSpree, portal, form…"
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
          {detail && detail.priceHistory.length > 1 && (
            <section className="dsec">
              <h3 className="dsec-label">Price history</h3>
              <PriceChart points={detail.priceHistory} />
            </section>
          )}

          <section className="dsec">
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
              updated — confirm both before you travel.
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
            <button
              className="btn btn-primary btn-block"
              onClick={() => document.getElementById("tour-at")?.focus()}
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
