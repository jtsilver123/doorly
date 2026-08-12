"use client";

import { useMemo, useState } from "react";
import type { EventKind, FeedListing } from "@/types";
import { EVENT_LABEL } from "@/types";
import Icon from "@/components/Icon";
import { RatingDisc } from "@/components/Rating";

/**
 * What moved.
 *
 * The old version was a flat run of two hundred undifferentiated rows with a
 * date stamp on the end, and three problems with it:
 *
 *   1  It showed our clock, not the landlord's. Every event carries the
 *      moment *the poll noticed*, not the moment the price changed — a
 *      thousand events in the live corpus land in five distinct hours,
 *      because that's when the cron ran. Printing "3:47 PM" beside 235 rows
 *      that share it is noise dressed as precision, and worse, it implies a
 *      resolution the data doesn't have. So: no clock. Days are the honest
 *      grain, and days are what you'd act on anyway.
 *
 *   2  Everything weighed the same. A price drop on a place you've toured
 *      and a fifth site picking up a listing you've never opened were the
 *      same row. Drops are 3 in 1000 here — the rarest and most valuable
 *      signal, buried.
 *
 *   3  No way to narrow it. Two hundred rows, no filter, no grouping.
 *
 * So this groups by day, leads with the changes that touch your pipeline,
 * shows price movement as a before-and-after rather than a sentence, and
 * lets you filter to the kind you care about.
 */

/** A personal notice — the "For you" rows. Same stream the pushes ride. */
export interface Notice {
  id: number;
  kind: "crew_add" | "watched" | "good_drop";
  listingId: string | null;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

const NOTICE_KIND: Record<Notice["kind"], string> = {
  crew_add: "Crew",
  watched: "Following",
  good_drop: "Price drop",
};

export interface Change {
  id: number;
  listingId: string;
  kind: string;
  detail: string;
  occurredAt: string;
  address: string;
  neighborhood: string;
  price: number;
  url: string;
  oldValue?: string | null;
  newValue?: string | null;
}

/** Filters, in the order they matter. Count is filled in from the data. */
const FILTERS: { key: string; label: string; kinds: EventKind[] }[] = [
  { key: "all", label: "Everything", kinds: [] },
  { key: "price", label: "Price moves", kinds: ["price_drop", "price_rise"] },
  { key: "supply", label: "On and off market", kinds: ["delisted", "back_on_market", "relisted"] },
  { key: "spread", label: "Now listed elsewhere", kinds: ["also_listed_on"] },
];

const money = (n: number) => `$${n.toLocaleString()}`;

/** "Today", "Yesterday", then the weekday and date. */
function dayLabel(iso: string): string {
  const at = new Date(iso);
  const today = new Date();
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(today) - midnight(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return at.toLocaleDateString("en-US", { weekday: "long" });
  return at.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

/** Price events carry the old and new figures; everything else is a sentence. */
function movement(change: Change): { from: number; to: number } | null {
  const from = Number(change.oldValue);
  const to = Number(change.newValue);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !from || !to) return null;
  return { from, to };
}

export default function Changes({
  changes,
  notices,
  listings,
  onOpen,
  onRefresh,
  refreshing,
}: {
  changes: Change[];
  notices: Notice[];
  listings: FeedListing[];
  onOpen: (listing: FeedListing) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  /*
   * "For you" first when it has anything unread — that's the consolidation:
   * the bell used to be a second surface for the same stream, and two entry
   * points for one stream is one too many. Everything personal now fronts
   * the market feed instead of floating in a popover.
   */
  const [filter, setFilter] = useState(() =>
    notices.some((n) => !n.read) ? "you" : "all"
  );
  const [minePlace, setMineOnly] = useState(false);

  /** Listings by id, so a row can carry the score and know if it's yours. */
  const byId = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);

  /** In your pipeline or starred — the changes that are actually about you. */
  const isMine = (c: Change) => {
    const l = byId.get(c.listingId);
    return Boolean(l && (l.starred || !["inbox", "passed", "no_go"].includes(l.stage)));
  };

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: changes.length };
    for (const f of FILTERS.slice(1)) {
      out[f.key] = changes.filter((c) => f.kinds.includes(c.kind as EventKind)).length;
    }
    return out;
  }, [changes]);

  const mineCount = useMemo(() => changes.filter(isMine).length, [changes, byId]);

  const shown = useMemo(() => {
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds ?? [];
    return changes
      .filter((c) => (kinds.length ? kinds.includes(c.kind as EventKind) : true))
      .filter((c) => (minePlace ? isMine(c) : true));
  }, [changes, filter, minePlace, byId]);

  /** Grouped by day, newest first, each day keeping the incoming order. */
  const days = useMemo(() => {
    /*
     * One apartment, one row. The same unit tracked from two sites ("122
     * Allen Street #9" and "122 Allen St") produces two identical change
     * events, and a feed that repeats itself both pads its unread badge and
     * reads as broken. Same day + same kind + same value + same street
     * (numbers and first word, which survives St/Street spelling) is the
     * same news.
     */
    const streetish = (address: string) =>
      (address.toLowerCase().match(/^\d+\s+\w+/)?.[0] ?? address.toLowerCase()).trim();
    const seen = new Set<string>();
    const map = new Map<string, { label: string; items: Change[] }>();
    for (const c of shown) {
      const key = dayKey(c.occurredAt);
      const dupe = `${key}|${c.kind}|${c.newValue ?? c.detail}|${streetish(c.address)}`;
      if (seen.has(dupe)) continue;
      seen.add(dupe);
      if (!map.has(key)) map.set(key, { label: dayLabel(c.occurredAt), items: [] });
      map.get(key)!.items.push(c);
    }
    return [...map.values()];
  }, [shown]);

  if (changes.length === 0) {
    return (
      <div className="empty">
        <div className="empty-title">Nothing has moved yet</div>
        <p className="empty-body">
          This is where a place drops its price, comes back on the market, or
          disappears — the things no listing site will tell you. Nothing has
          changed since the last check.
        </p>
        <div className="empty-actions">
          <button className="btn btn-primary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="changes">
      <div className="changes-bar">
        <div className="changes-filters" role="group" aria-label="Kind of change">
          <button
            className={filter === "you" ? "pill is-on" : "pill"}
            aria-pressed={filter === "you"}
            disabled={notices.length === 0}
            onClick={() => setFilter("you")}
          >
            For you
            <span className="muted"> {notices.length}</span>
          </button>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={filter === f.key ? "pill is-on" : "pill"}
              aria-pressed={filter === f.key}
              disabled={counts[f.key] === 0}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="muted"> {counts[f.key]}</span>
            </button>
          ))}
        </div>

        {/* The one filter that changes the question from "what happened" to
            "what happened to me". */}
        {mineCount > 0 && (
          <button
            className={minePlace ? "pill is-on" : "pill"}
            aria-pressed={minePlace}
            onClick={() => setMineOnly((v) => !v)}
          >
            <Icon name="star" size={12} filled={minePlace} />
            Places I'm tracking
            <span className="muted"> {mineCount}</span>
          </button>
        )}
      </div>

      {filter === "you" && (
        <div className="changelist">
          {notices.map((n) => {
            const listing = n.listingId ? byId.get(n.listingId) : undefined;
            return (
              <button
                key={`n${n.id}`}
                className="changerow"
                data-fresh={!n.read ? "true" : undefined}
                disabled={!listing}
                title={listing ? undefined : "This listing is no longer tracked"}
                onClick={() => listing && onOpen(listing)}
              >
                <span
                  className={
                    n.kind === "good_drop"
                      ? "chip chip-good"
                      : n.kind === "crew_add"
                        ? "chip chip-accent"
                        : "chip"
                  }
                >
                  {NOTICE_KIND[n.kind]}
                </span>
                <span className="changerow-what">
                  <b>{n.title}</b>
                  {n.body && <span className="muted">{n.body}</span>}
                </span>
                <span className="changerow-detail muted">{dayLabel(n.createdAt)}</span>
                {listing && (
                  <RatingDisc rating={listing.rating} grade={listing.grade} size="sm" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {filter !== "you" && shown.length === 0 && (
        <p className="changes-none muted">
          Nothing of that kind yet.{" "}
          <button className="linkish" onClick={() => { setFilter("all"); setMineOnly(false); }}>
            Show everything
          </button>
        </p>
      )}

      {filter !== "you" && days.map((day) => (
        <section key={day.label} className="changeday">
          {/* Days, not clock times: the timestamp is when our poll ran, not
              when the landlord acted, and pretending otherwise invents a
              precision the data doesn't have. */}
          <h3 className="changeday-head">
            {day.label}
            <span className="muted">
              {day.items.length} {day.items.length === 1 ? "change" : "changes"}
            </span>
          </h3>

          <div className="changelist">
            {day.items.map((c) => {
              const listing = byId.get(c.listingId);
              const move = movement(c);
              const drop = c.kind === "price_drop";
              const gone = c.kind === "delisted";
              return (
                <button
                  key={c.id}
                  className="changerow"
                  data-kind={c.kind}
                  disabled={!listing}
                  title={listing ? undefined : "This listing is no longer tracked"}
                  onClick={() => listing && onOpen(listing)}
                >
                  <span
                    className={
                      drop || c.kind === "back_on_market"
                        ? "chip chip-good"
                        : c.kind === "price_rise" || gone
                          ? "chip chip-warn"
                          : "chip"
                    }
                  >
                    {EVENT_LABEL[c.kind as EventKind] ?? c.kind.replace(/_/g, " ")}
                  </span>

                  <span className="changerow-what">
                    {/* A listing whose address never parsed still has to
                        name itself — blank rows read as broken. */}
                    <b>{c.address.trim() || `A ${c.neighborhood || "tracked"} place`}</b>
                    <span className="muted">{c.neighborhood}</span>
                  </span>

                  {/* A price move shown as a move — struck-through before,
                      the new figure, and what it saves you a month. */}
                  {move ? (
                    <span className="changerow-move">
                      <s>{money(move.from)}</s>
                      <Icon name="chevron" size={12} className="changerow-arrow" />
                      <b>{money(move.to)}</b>
                      <span className={drop ? "changerow-delta is-good" : "changerow-delta"}>
                        {move.to < move.from ? "−" : "+"}
                        {money(Math.abs(move.to - move.from))}/mo
                      </span>
                    </span>
                  ) : (
                    <span className="changerow-detail muted">{c.detail}</span>
                  )}

                  {listing && (
                    <RatingDisc rating={listing.rating} grade={listing.grade} size="sm" />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
