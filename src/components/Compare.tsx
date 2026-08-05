"use client";

import { useEffect, useMemo, useState } from "react";
import type { FeedListing } from "@/types";
import { STAGE_LABEL } from "@/types";
import { CONTACT_LABEL } from "@/lib/outreach";
import { AMENITIES, AMENITY_ORDER } from "@/lib/amenities";
import { RatingDisc } from "@/components/Rating";
import Icon from "@/components/Icon";
import { useAutosave, saveLabel } from "@/lib/useAutosave";

/**
 * Decision night.
 *
 * The journey's last mile: you've toured two or three places, a hold expires in
 * the morning, and the comparison is happening in browser tabs and memory —
 * which one had the broker fee? which was the fourth-floor walk-up? This puts
 * the finalists side by side on the numbers that decide it, with the best value
 * in each row marked, so the trade you're making is visible instead of felt.
 *
 * Finalists default to starred-or-in-the-pipeline, because the shortlist you
 * already built is the comparison and a separate "add to compare" step is
 * busywork. But the default is only a default: on decision night you want to
 * put two specific places next to each other, drag the one you're leaning
 * toward into the first column, and write down what you actually thought
 * while standing in the kitchen. So the set, the order, and the notes are all
 * yours to change.
 *
 * The set and the order live in localStorage rather than the database: they
 * are a view of your own pipeline that changes twice an hour on the night it
 * matters and never again. The notes are real content and go to the server.
 */

const ORDER_KEY = "doorly.compare.order";
const OUT_KEY = "doorly.compare.excluded";

/** Reads a string array out of localStorage without trusting what it finds. */
function readList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * One column's notes.
 *
 * Its own component so each cell can hold its own autosave timer — hooks
 * can't be called in a loop, and a single shared debounce would let a note
 * typed in column three overwrite column one.
 */
function NoteCell({
  listing,
  onSave,
}: {
  listing: FeedListing;
  onSave: (id: string, notes: string) => Promise<void> | void;
}) {
  const [text, setText] = useState(listing.notes);
  useEffect(() => setText(listing.notes), [listing.id, listing.notes]);
  const state = useAutosave(text, (next) => onSave(listing.id, next));

  return (
    <div className="compare-note">
      <textarea
        className="field"
        rows={3}
        value={text}
        placeholder="Loud at 8pm. Kitchen smaller than the photos…"
        aria-label={`Notes on ${listing.address}`}
        onChange={(e) => setText(e.target.value)}
      />
      <span className="savestate" data-state={state}>
        {saveLabel(state)}
      </span>
    </div>
  );
}

const money = (n: number) => `$${n.toLocaleString()}`;

type Row = {
  label: string;
  value: (l: FeedListing) => string;
  /** Numeric extract for best-in-row marking; higher-is-better via `invert`. */
  num?: (l: FeedListing) => number | null;
  invert?: boolean;
};

const ROWS: Row[] = [
  { label: "Rent", value: (l) => money(l.price), num: (l) => l.price },
  {
    label: "Effective rent",
    value: (l) =>
      l.effectiveRent < l.price ? `${money(l.effectiveRent)}/mo` : "—",
    num: (l) => (l.effectiveRent < l.price ? l.effectiveRent : null),
  },
  { label: "Cash to move in", value: (l) => money(l.upfrontCost), num: (l) => l.upfrontCost },
  { label: "All-in monthly", value: (l) => money(l.allInMonthly), num: (l) => l.allInMonthly },
  {
    label: "$/sqft",
    value: (l) => (l.sqft ? `$${(l.price / l.sqft).toFixed(1)}` : "unknown"),
    num: (l) => (l.sqft ? l.price / l.sqft : null),
  },
  {
    label: "Size",
    value: (l) =>
      `${l.bedrooms === 0 ? "Studio" : `${l.bedrooms}bd`}/${l.bathrooms}ba${l.sqft ? ` · ${l.sqft}ft²` : ""}`,
    num: (l) => l.sqft,
    invert: true,
  },
  {
    label: "Vs market",
    value: (l) =>
      l.dealVerdict === "unknown"
        ? "no comps"
        : l.dealDelta === 0
          ? "at market"
          : `${l.dealDelta > 0 ? "+" : ""}${l.dealDelta}%`,
    num: (l) => (l.dealVerdict === "unknown" ? null : l.dealDelta),
  },
  {
    label: "Ready for your date",
    value: (l) =>
      l.timing === "ready" ? "yes" : l.timing === "unknown" ? "unlisted" : l.timingLabel,
  },
  { label: "Days listed", value: (l) => `${l.daysOnMarket}d`, num: (l) => l.daysOnMarket },
  {
    label: "Status",
    value: (l) =>
      `${STAGE_LABEL[l.stage]}${
        l.lastContactChannel ? ` · ${CONTACT_LABEL[l.lastContactChannel].toLowerCase()}` : ""
      }`,
  },
  {
    label: "Amenities",
    value: (l) => (l.perks.length ? `${l.perks.length} listed` : "none listed"),
    num: (l) => l.perks.length,
    invert: true,
  },
  {
    label: "Biggest catch",
    value: (l) => l.cons[0] ?? "none found",
  },
];

/**
 * One row per amenity any finalist has, ordered by how much each moves a
 * decision. Amenities nobody lists are left out entirely; ones everybody
 * shares are folded away by the same rule that folds any agreeing row.
 */
export function amenityRowsFor(finalists: FeedListing[]): Row[] {
  return AMENITY_ORDER.filter((key) => finalists.some((l) => l.perks.includes(key))).map(
    (key) => ({
      label: AMENITIES[key].label,
      value: (l: FeedListing) => (l.perks.includes(key) ? "yes" : "—"),
      num: (l: FeedListing) => (l.perks.includes(key) ? 1 : 0),
      invert: true,
    })
  );
}

export default function Compare({
  listings,
  onOpen,
  onNotes,
}: {
  listings: FeedListing[];
  onOpen: (l: FeedListing) => void;
  onNotes: (id: string, notes: string) => Promise<void> | void;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  // localStorage is only readable after mount; reading it in the initialiser
  // would render different markup on the server and hydrate mismatched.
  useEffect(() => {
    setOrder(readList(ORDER_KEY));
    setExcluded(readList(OUT_KEY));
  }, []);

  function persist(key: string, value: string[]) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode; the session still works, it just won't be remembered */
    }
  }

  /** Everything eligible to be compared, before your inclusions and order. */
  const candidates = useMemo(
    () =>
      listings
        .filter((l) => l.starred || !["inbox", "passed", "closed"].includes(l.stage))
        .sort((a, b) => b.rating - a.rating),
    [listings]
  );

  const finalists = useMemo(() => {
    const kept = candidates.filter((l) => !excluded.includes(l.id));
    // Anything you've dragged leads, in your order; the rest follow by rating.
    const ranked = order
      .map((id) => kept.find((l) => l.id === id))
      .filter((l): l is FeedListing => Boolean(l));
    const rest = kept.filter((l) => !order.includes(l.id));
    return [...ranked, ...rest].slice(0, 5);
  }, [candidates, excluded, order]);

  /** Drop `id` where `target` currently sits. */
  function reorder(id: string, target: string) {
    if (id === target) return;
    const ids = finalists.map((l) => l.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setOrder(ids);
    persist(ORDER_KEY, ids);
  }

  /** Keyboard equivalent, because dragging is not available to everyone. */
  function nudge(id: string, delta: number) {
    const ids = finalists.map((l) => l.id);
    const at = ids.indexOf(id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    setOrder(ids);
    persist(ORDER_KEY, ids);
  }

  function toggle(id: string) {
    const next = excluded.includes(id)
      ? excluded.filter((x) => x !== id)
      : [...excluded, id];
    setExcluded(next);
    persist(OUT_KEY, next);
  }

  if (candidates.length < 2) {
    return (
      <div className="surface" style={{ padding: 24 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Nothing to compare yet</div>
        <div className="muted" style={{ fontSize: 13 }}>
          Star a couple of places or move them along the pipeline, and they line
          up here side by side — rent, real cost, and how each stacks up against
          the market — for the night you have to choose.
        </div>
      </div>
    );
  }

  /**
   * A comparison table's only job is to show what differs.
   *
   * A row identical down every column costs a line of vertical scan and
   * returns nothing — and on live data most rows were like that: size all
   * "Studio/1ba", availability all "yes", the biggest catch word-for-word the
   * same on all five. Those rows are folded away rather than deleted, with a
   * line saying what they agreed on, so nothing is silently lost.
   */
  /*
   * Amenities, one per row.
   *
   * They used to be a single comma-run per column — "W/D in unit, Dishwasher,
   * Elevator" against four other comma-runs, which is exactly the diffing
   * work a comparison table exists to do for you. A row each means the
   * dishwasher line either has ticks in it or it doesn't, and the
   * fold-what-agrees rule below removes the ones nobody differs on.
   *
   * Ordered by how much each moves a decision, so laundry sits above gym.
   */
  const amenityRows = amenityRowsFor(finalists);

  const rows: Row[] = [];
  const agreed: string[] = [];
  for (const row of [...ROWS, ...amenityRows]) {
    const values = finalists.map((l) => row.value(l));
    if (new Set(values).size === 1) {
      agreed.push(`${row.label.toLowerCase()}: ${values[0]}`);
    } else {
      rows.push(row);
    }
  }

  // Best value per row: min by default, max when invert is set.
  function bestIn(row: Row): number | null {
    if (!row.num) return null;
    const values = finalists
      .map((l, i) => ({ v: row.num!(l), i }))
      .filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
    if (values.length < 2) return null;
    const pick = values.reduce((a, b) =>
      row.invert ? (b.v > a.v ? b : a) : (b.v < a.v ? b : a)
    );
    if (values.every((x) => x.v === pick.v)) return null;
    return pick.i;
  }

  return (
    <div className="compare-wrap">
      {/*
        Which places are in the table, and in what order. Both are decisions
        you make on the night, so they're one click away rather than derived
        and unchangeable.
      */}
      <div className="compare-bar">
        <button className="btn" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
          <Icon name="filter" size={15} />
          {finalists.length} of {candidates.length} places
        </button>
        <span className="muted">
          Drag a column heading to reorder, or focus one and use ← →.
        </span>
        {excluded.length > 0 && (
          <button
            className="linkish"
            onClick={() => {
              setExcluded([]);
              persist(OUT_KEY, []);
            }}
          >
            Put back {excluded.length}
          </button>
        )}
      </div>

      {picking && (
        <div className="compare-pick" role="group" aria-label="Places to compare">
          {candidates.map((l) => {
            const on = !excluded.includes(l.id);
            const full = on && !finalists.some((f) => f.id === l.id);
            return (
              <button
                key={l.id}
                className={on ? "pill is-on" : "pill"}
                aria-pressed={on}
                onClick={() => toggle(l.id)}
                title={full ? "Included, but the table shows five at a time" : undefined}
              >
                {on && <Icon name="check" size={12} />}
                {l.address}
                {l.unit ? ` #${l.unit}` : ""}
                {full && <span className="muted"> · over five</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="surface" style={{ overflowX: "auto" }}>
      <table className="compare">
        <thead>
          <tr>
            <th />
            {finalists.map((l) => (
              <th key={l.id}>
                <button
                  className="compare-head"
                  draggable
                  data-dragging={dragging === l.id ? "true" : undefined}
                  onClick={() => onOpen(l)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", l.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(l.id);
                  }}
                  onDragOver={(e) => {
                    // Without preventDefault the browser refuses the drop.
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    reorder(e.dataTransfer.getData("text/plain"), l.id);
                    setDragging(null);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      nudge(l.id, -1);
                    } else if (e.key === "ArrowRight") {
                      e.preventDefault();
                      nudge(l.id, 1);
                    }
                  }}
                  aria-label={`${l.address}. Left and right arrows move this column.`}
                >
                  <span className="compare-rating">
                    <RatingDisc rating={l.rating} grade={l.grade} size="sm" />
                    <span className="muted">{l.ratingHeadline}</span>
                  </span>
                  <span className="compare-addr">
                    {l.address}
                    {l.unit ? ` #${l.unit}` : ""}
                  </span>
                  <span className="muted">{l.neighborhood}</span>
                </button>
                <button
                  className="compare-drop"
                  onClick={() => toggle(l.id)}
                  title="Take this out of the comparison"
                  aria-label={`Remove ${l.address} from the comparison`}
                >
                  <Icon name="close" size={13} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const best = bestIn(row);
            return (
              <tr key={row.label}>
                <td className="muted compare-label">{row.label}</td>
                {finalists.map((l, i) => (
                  <td key={l.id} className={i === best ? "compare-best" : ""}>
                    {row.value(l) === "yes" ? (
                      <Icon name="check" size={15} className="compare-has" />
                    ) : (
                      row.value(l)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
          {/* Written on the night, in the row where you're comparing them —
              not in a panel you'd have to open one place at a time. */}
          <tr>
            <td className="muted compare-label">Your notes</td>
            {finalists.map((l) => (
              <td key={l.id} className="compare-notecell">
                <NoteCell listing={l} onSave={onNotes} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      </div>
      {agreed.length > 0 && (
        <p className="compare-same">
          Identical on all {finalists.length} — {agreed.join(" · ")}
        </p>
      )}
    </div>
  );
}
