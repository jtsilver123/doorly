"use client";

import { useEffect, useState } from "react";
import type {
  ContactLog,
  FeedListing,
  ListingEvent,
  PricePoint,
  Stage,
} from "@/types";
import {
  EVENT_LABEL,
  LINK_PREFERENCE,
  SOURCE_LABEL,
  STAGES,
  STAGE_LABEL,
} from "@/types";
import {
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

export default function ListingDrawer({ listing, profile, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notes, setNotes] = useState(listing.notes);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const message = draftTourMessage(listing, profile);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  /**
   * Reaching out is one action, not two: log the contact, advance the pipeline,
   * then hand off to Messages or Mail. The CRM writes happen *first* on purpose
   * — an sms:/mailto: handoff can unload the page before a later fetch lands.
   */
  async function reachOut(channel: "text" | "email") {
    await patch({
      action: "contact",
      channel,
      direction: "out",
      who: listing.contactName,
      note: "Tour request",
    });
    if (listing.stage === "inbox" || listing.stage === "interested") {
      await patch({ action: "stage", stage: "contacted" });
    }
    window.location.href =
      channel === "text"
        ? smsLink(listing.contactPhone, message)
        : mailtoLink("", tourSubject(listing), message);
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
      <aside className="drawer" role="dialog" aria-label={listing.address}>
        <header
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{money(listing.price)}</div>
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

        <div style={{ overflowY: "auto", padding: 16, display: "grid", gap: 18 }}>
          {/* --- outreach ------------------------------------------------ */}
          <section style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => reachOut("text")}
              >
                Text for tour
              </button>
              <button className="btn" onClick={() => reachOut("email")}>
                Email
              </button>
              <button className="btn" onClick={copyMessage}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            {listing.contactPhone ? (
              <div className="muted" style={{ fontSize: 12 }}>
                Sends to {listing.contactPhone}
                {listing.contactName ? ` · ${listing.contactName}` : ""}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                No phone published for this listing — the draft opens Messages empty so
                you can pick a contact, and “Copy text” puts it on the clipboard.
              </div>
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
              <strong>{listing.dealLabel}</strong>
              {listing.dealVerdict === "steal" && (
                <span className="muted">
                  {" "}
                  Worth seeing today — and worth verifying in person.
                </span>
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
          <section style={{ display: "grid", gap: 6 }}>
            <label className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
              STATUS
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {STAGES.map((stage) => (
                <button
                  key={stage}
                  className={listing.stage === stage ? "btn btn-primary" : "btn"}
                  style={{ fontSize: 12, padding: "5px 9px" }}
                  onClick={() => patch({ action: "stage", stage: stage as Stage })}
                  disabled={saving}
                >
                  {STAGE_LABEL[stage]}
                </button>
              ))}
            </div>
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
                .sort(
                  (a, b) =>
                    LINK_PREFERENCE.indexOf(a.source) - LINK_PREFERENCE.indexOf(b.source)
                )
                .map((s) => (
                <a
                  key={s.source}
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 8px" }}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {SOURCE_LABEL[s.source]} ↗
                </a>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
