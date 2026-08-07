"use client";

import { useEffect, useMemo, useState } from "react";
import type { FeedListing, Stage } from "@/types";
import { STAGE_LABEL, PIPELINE_STAGES } from "@/types";
import { CONTACT_LABEL } from "@/lib/outreach";
import { AMENITIES, AMENITY_ORDER, amenityFacts, type AmenityKey } from "@/lib/amenities";
import { nearestStation, routesWithin } from "@/lib/subway";
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

const ORDER_KEY = "damnlease.compare.order";
const OUT_KEY = "damnlease.compare.excluded";

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
  /** Exempt from the fold-if-everyone-agrees rule — see amenityRowsFor. */
  alwaysShow?: boolean;
  /** Present on amenity rows: the cell is a button that cycles your mark. */
  cycle?: (l: FeedListing) => void;
};

/*
 * Rows in the order a lease decision actually runs: what it costs, then what
 * it is, then what living there is like, then the meta. Status left this list
 * for the column header, where it's a control rather than a caption, and the
 * amenity count went with it — every amenity that matters gets its own row
 * below, and a count of the rest compares nothing.
 */
/*
 * Rent leads and carries its own asterisk: when free months make the
 * effective rent cheaper than the sticker, the cell says so right there, and
 * best-in-row judges the effective figure — the one you'd actually pay.
 */
const RENT_ROW: Row = {
  label: "Rent",
  value: (l) =>
    l.effectiveRent < l.price
      ? `${money(l.price)} · eff ${money(l.effectiveRent)}`
      : money(l.price),
  num: (l) => l.effectiveRent,
  alwaysShow: true,
};

const MONEY_ROWS: Row[] = [
  { label: "All-in monthly", value: (l) => money(l.allInMonthly), num: (l) => l.allInMonthly },
  { label: "Cash to move in", value: (l) => money(l.upfrontCost), num: (l) => l.upfrontCost },
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
    label: "Size",
    value: (l) =>
      `${l.bedrooms === 0 ? "Studio" : `${l.bedrooms}bd`}/${l.bathrooms}ba${l.sqft ? ` · ${l.sqft}ft²` : ""}`,
    num: (l) => l.sqft,
    invert: true,
  },
  {
    label: "$/sqft",
    value: (l) => (l.sqft ? `$${(l.price / l.sqft).toFixed(1)}` : "unknown"),
    num: (l) => (l.sqft ? l.price / l.sqft : null),
  },
];

const CONTEXT_ROWS: Row[] = [
  {
    label: "Ready for your date",
    value: (l) =>
      l.timing === "ready" ? "yes" : l.timing === "unknown" ? "unlisted" : l.timingLabel,
  },
  {
    /*
     * The question every New Yorker asks and no listing site answers with a
     * number. "Close to the L" is marketing; "4 min to 6 at 33 St" compares.
     */
    label: "Nearest train",
    value: (l) => {
      const near = nearestStation(l.lat, l.lon);
      return near ? `${near.minutes} min · ${near.routes.split("").join("/")}` : "unknown";
    },
    num: (l) => nearestStation(l.lat, l.lon)?.minutes ?? null,
  },
  {
    label: "Lines on foot",
    value: (l) => {
      const routes = routesWithin(l.lat, l.lon, 12);
      return routes.length ? routes.join("/") : "none within 12 min";
    },
    num: (l) => routesWithin(l.lat, l.lon, 12).length,
    invert: true,
  },
  { label: "Days listed", value: (l) => `${l.daysOnMarket}d`, num: (l) => l.daysOnMarket },
  {
    label: "Last contact",
    value: (l) =>
      l.lastContactChannel ? CONTACT_LABEL[l.lastContactChannel] : "not yet",
  },
  {
    label: "Biggest catch",
    value: (l) => l.cons[0] ?? "none found",
  },
];

/** Furthest along first: the places you've seen in person lead the table. */
const STAGE_RANK: Partial<Record<Stage, number>> = {
  applied: 5,
  toured: 4,
  tour: 3,
  contacted: 2,
  interested: 1,
};

/**
 * The six that decide NYC leases, each on its own line, always.
 *
 * These used to be yes-or-dash rows that folded away whenever the finalists
 * agreed, which meant the questions people actually walk in with — is there a
 * washer, is it a walk-up, who's at the door — could vanish from the table
 * entirely. Decision criteria don't fold: agreement on "everyone has an
 * elevator" is information, not noise.
 *
 * Three answers, honestly distinct: ✓ the listing said so, ✗ the listing said
 * not (walk-up, "no pets"), — the listing never said, which is a question for
 * the viewing rather than a fact for the table. Everything below these six stays
 * on the old fold-if-agreed behaviour.
 */
const DECISION_KEYS: AmenityKey[] = [
  "laundry_unit",
  "laundry_building",
  "elevator",
  "doorman",
  "dishwasher",
  "light",
];

const FACT_MARK = { yes: "✓", no: "✗", unknown: "—" } as const;

/** Label → amenity key, for showing which cells carry your own mark. */
const KEY_BY_LABEL = new Map(
  Object.values(AMENITIES).map((a) => [a.label, a.key as string])
);
function rowKeyOf(label: string): string {
  return KEY_BY_LABEL.get(label) ?? label;
}
const FACT_RANK = { yes: 1, no: -1, unknown: 0 } as const;

export function amenityRowsFor(
  finalists: FeedListing[],
  onMark?: (l: FeedListing, key: AmenityKey, fact: "yes" | "no" | null) => void
): Row[] {
  const facts = new Map(finalists.map((l) => [l.id, amenityFacts(l)]));
  /*
   * Your own mark outranks the listing's word: you stood in the kitchen, the
   * listing didn't. A missing mark defers to what the listing implied.
   */
  const factOf = (l: FeedListing, key: AmenityKey) =>
    (l.amenityMarks?.[key] as "yes" | "no" | undefined) ??
    facts.get(l.id)?.[key] ??
    "unknown";

  // A tap cycles what you know: unknown → yes → no → back to the listing's
  // own answer. Cycling to "clear" rather than to "unknown" matters — the
  // listing's ✓ comes back instead of being buried under a dash forever.
  const cycler = (key: AmenityKey) =>
    onMark
      ? (l: FeedListing) => {
          const marked = l.amenityMarks?.[key] as "yes" | "no" | undefined;
          const shown = factOf(l, key);
          const next = marked === "no" ? null : shown === "yes" ? "no" : "yes";
          onMark(l, key, next);
        }
      : undefined;

  // Every decision amenity, every time — these are the questions the
  // comparison exists to answer, and a row of dashes is itself the answer
  // "nobody's listing says": bring it up on the tours.
  const decision: Row[] = DECISION_KEYS.map((key) => ({
    label: AMENITIES[key].label,
    value: (l: FeedListing) => FACT_MARK[factOf(l, key)],
    num: (l: FeedListing) => FACT_RANK[factOf(l, key)],
    invert: true,
    alwaysShow: true,
    cycle: cycler(key),
  }));

  // Same extractor as the decision rows — reading `perks` here would be a
  // second source of truth for the same question, and the two would drift.
  const rest = AMENITY_ORDER.filter(
    (key) =>
      !DECISION_KEYS.includes(key) &&
      finalists.some((l) => factOf(l, key) === "yes")
  ).map((key) => ({
    label: AMENITIES[key].label,
    value: (l: FeedListing) => FACT_MARK[factOf(l, key)],
    num: (l: FeedListing) => FACT_RANK[factOf(l, key)],
    invert: true,
    cycle: cycler(key),
  }));

  return [...decision, ...rest];
}

export default function Compare({
  listings,
  onOpen,
  onMove,
  onLean,
  onMark,
  onNotes,
}: {
  listings: FeedListing[];
  onOpen: (l: FeedListing) => void;
  /** Stage changes made from the column header, same handler as the board. */
  onMove: (l: FeedListing, stage: Stage) => void;
  /** The post-tour thumb, same handler as the board. */
  onLean: (l: FeedListing, lean: number) => void;
  /** Your own amenity answer: yes, no, or null to defer to the listing. */
  onMark: (l: FeedListing, key: string, fact: "yes" | "no" | null) => void;
  onNotes: (id: string, notes: string) => Promise<void> | void;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  /** Tour footage per finalist, signed URLs from the media route. */
  const [media, setMedia] = useState<
    Record<string, { id: string; kind: string; url: string }[]>
  >({});

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

  /**
   * Everything eligible to be compared, before your inclusions and order.
   *
   * Strictly the pipeline. Compare is a lens on the board, so leaving the
   * board is leaving the table — the old starred-places exception meant a
   * card you'd just x-ed off the pipeline sat here anyway, looking exactly
   * like the glitch it was.
   *
   * Default order is stage first, furthest along leading: the same grouping
   * as the board's columns, so the table reads left to right as "seen it,
   * booked it, talked to them, want to" instead of a blind shuffle.
   */
  const candidates = useMemo(
    () =>
      listings
        .filter((l) => (STAGE_RANK[l.stage] ?? 0) > 0)
        .sort(
          (a, b) =>
            (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0) ||
            b.rating - a.rating
        ),
    [listings]
  );

  // Fetch each finalist's footage once per visit — decision night is exactly
  // when "what did we film there" matters, and the crew's clips come too.
  useEffect(() => {
    let live = true;
    (async () => {
      const entries = await Promise.all(
        candidates.slice(0, 12).map(async (l) => {
          try {
            const res = await fetch(`/api/listings/${encodeURIComponent(l.id)}/media`);
            const body = await res.json();
            return [l.id, body.media ?? []] as const;
          } catch {
            return [l.id, []] as const;
          }
        })
      );
      if (live) setMedia(Object.fromEntries(entries));
    })();
    return () => {
      live = false;
    };
  }, [candidates]);

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

  /**
   * Bring a queued place into the table.
   *
   * The cap is five columns, so promoting means moving this one to the front
   * of the order — the fifth visible place drops out of view but stays
   * included, which is the same trade you'd make by hand.
   */
  function promote(id: string) {
    const ids = [id, ...finalists.map((l) => l.id).filter((x) => x !== id)];
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
          Compare shows what&apos;s on your board. Put two or more places into
          the pipeline and they line up here side by side, with rent, real
          cost, and how each stacks up against the market, for the night you
          have to choose.
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
  const amenityRows = amenityRowsFor(finalists, onMark);

  const rows: Row[] = [];
  const agreed: string[] = [];
  // Rent, then the amenities that decide leases, then the rest of the money
  // and the context — the order the user actually compares in.
  for (const row of [RENT_ROW, ...amenityRows, ...MONEY_ROWS, ...CONTEXT_ROWS]) {
    const values = finalists.map((l) => row.value(l));
    // Decision amenities stay on the table even in agreement — "everyone has
    // a washer" is the kind of agreement people are checking for.
    if (!row.alwaysShow && new Set(values).size === 1) {
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
          Five at a time. Drag a column heading to reorder, or focus one and
          use ← →.
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
          {/*
            Grouped under the same headings as the board's columns, so picking
            reads as "which of my toured ones, which of my booked ones" —
            a flat run of addresses meant guessing where each one stood.

            Three chip states, not two. Everything included used to render
            checked and filled, including the ones past the five-column cap —
            so a chip said "in the table" and its own label said "over five"
            in the same breath. Only what is actually on screen is filled;
            the queued ones are outlined and say where they stand, and
            clicking one promotes it into view.
          */}
          {[...PIPELINE_STAGES]
            .filter((stage) => candidates.some((l) => l.stage === stage))
            .sort((a, b) => (STAGE_RANK[b] ?? 0) - (STAGE_RANK[a] ?? 0))
            .map((stage) => (
              <div key={stage} className="compare-pickgroup">
                <span className="overline compare-pickstage">{STAGE_LABEL[stage]}</span>
                {candidates
                  .filter((l) => l.stage === stage)
                  .map((l) => {
                    const included = !excluded.includes(l.id);
                    const inTable = finalists.some((f) => f.id === l.id);
                    const queued = included && !inTable;
                    return (
                      <button
                        key={l.id}
                        className={inTable ? "pill is-on" : queued ? "pill is-queued" : "pill"}
                        aria-pressed={included}
                        onClick={() => (queued ? promote(l.id) : toggle(l.id))}
                        title={
                          queued
                            ? "Not in the table — the table shows five. Click to bring it in."
                            : inTable
                              ? "Shown. Click to take it out."
                              : "Click to put it back."
                        }
                      >
                        {inTable && <Icon name="check" size={12} />}
                        {l.address}
                        {l.unit ? ` #${l.unit}` : ""}
                        {queued && <span className="pill-note">not shown</span>}
                      </button>
                    );
                  })}
              </div>
            ))}
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
                {/* The stage, where it can be changed rather than merely
                    read. Decision night IS stage changes — "we're applying
                    to this one, that one's out" — and bouncing back to the
                    board for each verdict broke the comparison mid-thought.
                    Moving one off the board takes its column with it. */}
                <select
                  className="field compare-stage"
                  value={l.stage}
                  aria-label={`Stage for ${l.address}`}
                  onChange={(e) => onMove(l, e.target.value as Stage)}
                >
                  {PIPELINE_STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {STAGE_LABEL[stage]}
                    </option>
                  ))}
                </select>
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
                    {row.cycle ? (
                      /* Your call beats the listing's: tap to cycle yes, no,
                         and back to whatever the listing itself said. */
                      <button
                        className="factbtn"
                        data-marked={l.amenityMarks?.[rowKeyOf(row.label)] ? "true" : undefined}
                        title="Tap to record what you saw: yes, no, then back to the listing's word"
                        aria-label={`${row.label} at ${l.address}: ${row.value(l) === "✓" ? "yes" : row.value(l) === "✗" ? "no" : "unknown"}. Tap to change.`}
                        onClick={() => row.cycle!(l)}
                      >
                        {row.value(l)}
                      </button>
                    ) : row.value(l) === "yes" ? (
                      <Icon name="check" size={15} className="compare-has" />
                    ) : (
                      row.value(l)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
          {/* Your gut, on the record. The same thumb as the board's tour
              cards: softer than a stage, sharper than a memory. Live here
              too, because this table is where the leans get compared. */}
          <tr>
            <td className="muted compare-label">Your take</td>
            {finalists.map((l) => (
              <td key={l.id}>
                <span className="board-lean compare-lean">
                  {([
                    [1, "thumbup", "Leaning yes"],
                    [-1, "thumbdown", "Leaning no"],
                  ] as const).map(([value, icon, label]) => (
                    <button
                      key={icon}
                      className={l.lean === value ? "lean-btn is-on" : "lean-btn"}
                      data-lean={value}
                      title={label}
                      aria-label={`${label} on ${l.address}`}
                      aria-pressed={l.lean === value}
                      onClick={() => onLean(l, l.lean === value ? 0 : value)}
                    >
                      <Icon name={icon} size={14} />
                    </button>
                  ))}
                </span>
              </td>
            ))}
          </tr>
          {/* What you actually saw — the tour footage, side by side. On
              decision night "remember the bedroom in the second one" becomes
              a thing you look at instead of argue about. */}
          <tr>
            <td className="muted compare-label">Your footage</td>
            {finalists.map((l) => (
              <td key={l.id} className="compare-mediacell">
                {(media[l.id] ?? []).length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <div className="compare-media">
                    {(media[l.id] ?? []).slice(0, 4).map((m) =>
                      m.kind === "video" ? (
                        <video key={m.id} src={m.url} controls playsInline preload="metadata" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={m.id} src={m.url} alt="Tour photo" loading="lazy" onClick={() => onOpen(l)} />
                      )
                    )}
                  </div>
                )}
              </td>
            ))}
          </tr>
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
