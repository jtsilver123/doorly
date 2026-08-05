"use client";

import { useEffect, useRef, useState } from "react";
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
import { RatingDisc, MyScoreDisc, MyScoreField, ProsConsList } from "@/components/Rating";
import { nextAction, tourWhen } from "@/lib/nextAction";
import { formatPhone, isCompletePhone } from "@/lib/phone";
import {
  bestChannel,
  reachableOn,
  draftTourMessage,
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
  const [imageBroken, setImageBroken] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [phone, setPhone] = useState(formatPhone(listing.myContactPhone));
  const [who, setWho] = useState(listing.myContactName);
  const [email, setEmail] = useState(listing.myContactEmail);
  const [tourAt, setTourAt] = useState(toLocalInput(listing.tourAt));
  const [tourKind, setTourKind] = useState<TourKind>(listing.tourKind);
  const [tourEndsAt, setTourEndsAt] = useState(toLocalInput(listing.tourEndsAt));
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

  const message = draftTourMessage(listing, profile);

  // A different listing in the same panel starts from its own stage.
  useEffect(() => setStage(listing.stage), [listing.id, listing.stage]);
  useEffect(() => {
    setPhone(formatPhone(listing.myContactPhone));
    setWho(listing.myContactName);
    setEmail(listing.myContactEmail);
    setTourAt(toLocalInput(listing.tourAt));
    setTourKind(listing.tourKind);
    setTourEndsAt(toLocalInput(listing.tourEndsAt));
    setEditingContact(false);
  }, [listing.id, listing.myContactPhone, listing.myContactName, listing.myContactEmail, listing.tourAt, listing.tourKind, listing.tourEndsAt]);

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
        <header
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div style={{ display: "grid", gap: 4, justifyItems: "center" }}>
            <RatingDisc
              rating={listing.rating}
              grade={listing.grade}
              size="lg"
              title={`${listing.rating} out of 100 for your search`}
            />
            {listing.myScore != null && <MyScoreDisc score={listing.myScore} size="sm" />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 600 }}>
              {money(listing.price)}
              <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
                {" "}
                · {listing.ratingHeadline}
              </span>
            </div>
            <div style={{ fontSize: 13 }}>
              {listing.address}
              {listing.unit ? ` #${listing.unit}` : ""}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {listing.neighborhood || listing.borough} ·{" "}
              {listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bed`} ·{" "}
              {listing.bathrooms} bath
              {listing.sqft ? ` · ${listing.sqft} ft²` : ""}
            </div>
          </div>
          <button className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {/*
          Block flow, not grid.
          
          This was a grid, and inside a height-constrained scroll container its
          auto rows collapsed to zero — children rendered at their natural size
          and overlapped each other, so the photo painted over the figures and
          the figures over the verdict. Patching each child with a minimum
          height only moved the problem to the next one I added. Normal flow
          cannot compress a child below its content, so the whole class of bug
          goes away with the layout mode.
        */}
        <div className="drawer-body">
          {/* The panel never showed the apartment. A detail view of a home
              that omits the photo and the cost of getting in is a summary of
              everything except what you opened it for. */}
          <div className="drawer-photo">
            {/* Same under-layer the cards use: an image that never resolves
                fires no error event, so swapping on error leaves a blank box.
                Something readable always sits behind it. */}
            <span className="drawer-photo-alt" aria-hidden="true">
              {listing.neighborhood || listing.borough || "No photo"}
            </span>
            {listing.imageUrl && !imageBroken && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={listing.imageUrl}
                alt={`Photo of ${listing.address}`}
                onError={() => setImageBroken(true)}
              />
            )}
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
                {listing.availableText || (listing.timing === "ready" ? "In time" : "Not stated")}
              </dd>
            </div>
          </dl>

          {/* --- the verdict, before anything else ----------------------- */}
          <section style={{ display: "grid", gap: 10 }}>
            <label className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
              WHY {listing.rating} OUT OF 100
            </label>
            <ProsConsList listing={listing} />
            <Perks keys={listing.perks} limit={10} showLabels />

            {/* The rating knows what the listing published. It does not know
                the block was loud at 8pm or that the kitchen photo was three
                years old. After a viewing you have the better number. */}
            <label className="muted" style={{ fontSize: 11, fontWeight: 600, marginTop: 4 }}>
              YOUR SCORE
            </label>
            <MyScoreField
              score={listing.myScore}
              onChange={(next) => patch({ action: "myScore", myScore: next })}
            />
          </section>

          {/* --- outreach ------------------------------------------------ */}
          <section style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {/* What this offers depends on where the listing is. Proposing a
                  tour on something already booked, or already applied to, makes
                  you check whether the app has lost track of you. */}
              {action.kind === "add-contact" ? (
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => setEditingContact(true)}
                >
                  {action.label}
                </button>
              ) : action.kind === "schedule" ? (
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => document.getElementById("tour-at")?.focus()}
                >
                  {action.label}
                </button>
              ) : action.kind === "apply" ? (
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => move("applied")}
                >
                  {action.label}
                </button>
              ) : action.kind === "reach" || action.kind === "chase" ? (
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() =>
                  reachOut(reach.channel === "text" || reach.channel === "email" ? reach.channel : "portal")
                }
                title={reach.hint}
              >
                {action.kind === "chase" ? "Send a follow-up" : reach.label}
              </button>
              ) : (
                <div className="stagenote" style={{ flex: 1 }}>
                  <strong>{action.label}</strong>
                  <span>{action.hint}</span>
                </div>
              )}
              {reach.channel !== "email" && (
                <button
                  className="btn"
                  onClick={() => reachOut("email")}
                  title="Same message, in an email draft"
                >
                  Email
                </button>
              )}
              <button className="btn" onClick={copyMessage}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {contact.phone
                ? `Texts ${contact.phone}${contact.who ? ` · ${contact.who}` : ""}${contact.mine ? " (you added this)" : ""}. Sending logs it and moves this to Contacted.`
                : contact.email
                  ? `Emails ${contact.email}${contact.who ? ` · ${contact.who}` : ""}. Sending logs it and moves this to Contacted.`
                  : "No phone or email published. The button copies your message and opens the listing, where their contact form lives — or add a number below if you have one."}
            </div>

            {/*
              Nothing in the live corpus publishes a phone number, so the one
              you got by calling around is usually the only one there is. It
              belongs on the listing, where the app can act on it, rather than
              in a notes field it can't read.
            */}
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
                    /* Digits only, punctuated as you go. A number copied off a
                       sign arrives as "212.555.0134" or "+1 212 555 0134", and
                       three spellings of one broker is three contacts. */
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
              <button className="linkish" onClick={() => setEditingContact(true)}>
                {contact.phone || contact.email
                  ? "Edit their contact details"
                  : "I have their number — add it"}
              </button>
            )}

            {/*
              The point of typing in a number is texting it. Before this you
              saved the contact and then had to work out that the button at the
              top of the panel had quietly changed meaning — so the message,
              already written, sits right under the number it's going to.
            */}
            {!editingContact && contact.phone && (
              <button
                className="textnow"
                onClick={() => reachOut("text")}
                title={message}
              >
                <span className="textnow-go" aria-hidden="true">
                  💬
                </span>
                <span className="textnow-copy">
                  <b>Text {formatPhone(contact.phone) || contact.phone}</b>
                  <span>
                    {contact.who ? `${contact.who} · ` : ""}
                    Opens your messages with the request already written
                  </span>
                </span>
              </button>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {listing.contactPhone && (
                <a
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 8px" }}
                  href={`tel:${listing.contactPhone.replace(/[^\d+]/g, "")}`}
                  onClick={() =>
                    patch({
                      action: "contact",
                      channel: "phone",
                      direction: "out",
                      who: listing.contactName,
                      note: "Called",
                    })
                  }
                >
                  📞 Call
                </a>
              )}
              {/* Anything that happened outside the app still belongs in the log. */}
              <button
                className="btn"
                style={{ fontSize: 12, padding: "4px 8px" }}
                onClick={() =>
                  patch({
                    action: "contact",
                    channel: "phone",
                    direction: "in",
                    who: listing.contactName,
                    note: "They replied",
                  })
                }
              >
                Log a reply
              </button>
              <a
                className="btn"
                style={{ fontSize: 12, padding: "4px 8px" }}
                href={listing.url}
                target="_blank"
                rel="noreferrer"
              >
                Listing ↗
              </a>
            </div>
            <details>
              <summary className="muted" style={{ fontSize: 12, cursor: "pointer" }}>
                Preview message
              </summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: 12,
                  background: "var(--surface-2)",
                  padding: 10,
                  borderRadius: 8,
                  marginTop: 6,
                  fontFamily: "inherit",
                }}
              >
                {message}
              </pre>
            </details>
          </section>

          {/* --- is it a good price, and is it real? --------------------- */}
          <section style={{ display: "grid", gap: 8 }}>
            <label className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
              PRICE CHECK
            </label>
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

            {listing.flags.length > 0 && (
              <ul className="flags">
                {listing.flags.map((flag) => (
                  <li key={flag.kind} className={`flag flag-${flag.severity}`}>
                    <span>{flag.severity === "warn" ? "⚠" : "·"}</span>
                    <span>{flag.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* --- pipeline ------------------------------------------------ */}
          {/*
            Eight equal chips wrapping onto two rows asked you to find the one
            you wanted among choices you'd never pick. Almost every move is to
            the next stage, so that's a button; the rest is a menu.
          */}
          <section style={{ display: "grid", gap: 8 }}>
            <label className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
              STATUS
            </label>
            <div className="stagerow">
              {advance && (
                <button
                  className="btn btn-primary"
                  onClick={() => move(advance)}
                >
                  Move to {STAGE_LABEL[advance].toLowerCase()}
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
            </div>

            {/* Tag-team: whose find, and who owns talking to the agent. The
                point person exists so two people never both text the same
                broker about the same apartment. */}
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

            {/* Only once a tour exists to have a time. "Tour booked" without
                one is a label rather than a plan, and it's the thing you'll
                want to look up on the morning of. */}
            {stage === "tour" && (
              <div className="tourplan">
                {/* Which kind first, because it changes what the fields below
                    mean: an appointment has a time, an open house has a
                    window. */}
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
              </div>
            )}
          </section>

          {/* --- price history ------------------------------------------- */}
          {detail && detail.priceHistory.length > 1 && (
            <section style={{ display: "grid", gap: 6 }}>
              <label className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
                PRICE HISTORY
              </label>
              <PriceChart points={detail.priceHistory} />
            </section>
          )}

          {/* --- notes --------------------------------------------------- */}
          <section style={{ display: "grid", gap: 6 }}>
            <label className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
              NOTES
            </label>
            <textarea
              className="field"
              rows={3}
              value={notes}
              placeholder="Third floor walk-up, faces the street…"
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== listing.notes && patch({ action: "notes", notes })}
            />
          </section>

          {/* --- timeline ------------------------------------------------ */}
          <section style={{ display: "grid", gap: 6 }}>
            <label className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
              TIMELINE
            </label>
            {!detail && <div className="muted" style={{ fontSize: 12 }}>Loading…</div>}
            {detail?.events.length === 0 && (
              <div className="muted" style={{ fontSize: 12 }}>
                Nothing has changed since we first saw it.
              </div>
            )}
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {detail?.contacts.map((c) => (
                <li key={`c${c.id}`} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                  <span className="chip chip-accent">
                    {c.direction === "out" ? "you →" : "← them"}
                  </span>
                  <span style={{ flex: 1 }}>
                    {c.channel}
                    {c.note ? ` · ${c.note}` : ""}
                  </span>
                  <span className="muted">{when(c.occurredAt)}</span>
                </li>
              ))}
              {detail?.events.map((e) => (
                <li key={`e${e.id}`} style={{ display: "flex", gap: 8, fontSize: 12 }}>
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
                  <span style={{ flex: 1 }}>{e.detail}</span>
                  <span className="muted">{when(e.occurredAt)}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* --- where it's listed --------------------------------------- */}
          <section style={{ display: "grid", gap: 6 }}>
            <label className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
              LISTED ON
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[...listing.alsoOn]
                .filter((s) => s.url)
                .sort((a, b) => {
                  const order = linkPreference(profile.preferredSource);
                  return order.indexOf(a.source) - order.indexOf(b.source);
                })
                .map((s) => (
                  <a
                    key={s.source}
                    className="btn srcbtn"
                    style={{ fontSize: 12, padding: "4px 9px" }}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <SourceMark source={s.source} size={15} />
                    {SOURCE_LABEL[s.source]}
                  </a>
                ))}
            </div>
            {/* Provenance, plainly. Everything here is copied from the sites
                above — we don't inspect apartments, and saying so is what makes
                the rest of the numbers credible. */}
            <p className="muted" style={{ fontSize: 11, lineHeight: 1.45, margin: 0 }}>
              Details come from the listing sites, not from us. Last confirmed
              live {when(listing.lastSeenAt)}; first seen {when(listing.firstSeenAt)}.
              Prices and availability can change without the listing being
              updated — confirm both before you travel.
            </p>
          </section>
        </div>
      </aside>
    </>
  );
}
