"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import type { FeedListing, Stage } from "@/types";
import { PIPELINE_STAGES, STAGE_LABEL } from "@/types";
import { RatingDisc } from "@/components/Rating";
import { googleCalendarUrl } from "@/lib/calendar";
import { nextAction, dayWord } from "@/lib/nextAction";
import { fuzzyBest } from "@/lib/fuzzy";
import { CONTACT_LABEL } from "@/lib/outreach";
import { compactPrice } from "@/lib/cost";
import Icon from "@/components/Icon";

/**
 * The pipeline board.
 *
 * It has always looked exactly like a board you could drag, and wasn't — the
 * only way to advance a listing was to open it and pick a status. An
 * affordance that lies is worse than one that isn't there, because you spend
 * the first attempt believing the app is broken.
 *
 * Three ways to move a card, because one is never enough:
 *
 *   pointer   drag it to another column
 *   keyboard  focus a card, ← and → move it a stage at a time
 *   touch     hold a card for a beat, then drag — see below
 *
 * Mouse drags use HTML5 drag-and-drop: it is what screen readers and browsers
 * already understand, and it costs no library. But those events never fire on
 * touch, and on a phone the board is a horizontally scrolling strip where an
 * immediate drag would fight the scroll. So touch gets its own gesture with a
 * long-press to disambiguate: a swipe scrolls the board, a hold lifts the
 * card. Once lifted, a ghost follows the finger, columns light up as targets,
 * and holding near either edge scrolls the strip so every column is reachable.
 */

/** How long a finger must hold still before a touch becomes a drag. */
const LIFT_MS = 300;
/** Movement past this many pixels before the hold elapses means a scroll. */
const WOBBLE_PX = 12;

const money = (n: number) => `$${n.toLocaleString()}`;

/** "today 2:14 PM", "yesterday 9:05 AM", then just "Aug 5". */
function whenText(iso: string, withTime: boolean): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (days <= 0) return withTime ? `today ${time}` : "today";
  if (days === 1) return withTime ? `yesterday ${time}` : "yesterday";
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return withTime && days < 7 ? `${date}, ${time}` : date;
}

/** What an empty column means, rather than a bare "Nothing here". */
const STAGE_HINT: Record<string, string> = {
  interested: "Star a place to start it here",
  contacted: "Nothing waiting on a reply",
  tour: "No viewings booked yet",
  toured: "Nothing seen in person yet",
  applied: "No applications in",
  no_go: "Toured places you passed on land here",
};

export default function PipelineBoard({
  listings,
  onOpen,
  onMove,
  onQuickAdd,
  onPlanTours,
  onChaseAll,
  onReachAll,
  onReviewTours,
  onReplied,
  crewTag,
  onPass,
  onLean,
  onDeciding,
  onAppResult,
  onSecured,
  onOpenAt,
  onAddToCalendar,
}: {
  listings: FeedListing[];
  onOpen: (listing: FeedListing) => void;
  onMove: (listing: FeedListing, stage: Stage) => void;
  /** Address or listing link pasted into the quick-add box. Resolved by the page. */
  onQuickAdd: (query: string) => void;
  /** Thumb on a tour-stage card: 1 leaning yes, -1 leaning no, 0 to clear. */
  onLean: (listing: FeedListing, lean: number) => void;
  /** Toggle the still-deciding state: sets a check-back day, or clears it. */
  onDeciding: (listing: FeedListing) => void;
  /** The landlord's answer on an applied card: 1 accepted, -1 denied, 0 waiting. */
  onAppResult: (listing: FeedListing, result: number) => void;
  /** Accepted and taken — the hunt's finish line. */
  onSecured: (listing: FeedListing, secured: boolean) => void;
  /** Open the drawer already scrolled to a section, e.g. "sec-contact". */
  onOpenAt: (listing: FeedListing, section: string) => void;
  /** Opens the tour-day route planner. */
  onPlanTours: () => void;
  /** Opens the follow-up run over the whole Contacted column. */
  onChaseAll: () => void;
  /** Opens the first-contact run over the whole Interested column. */
  onReachAll: () => void;
  /** Opens review mode: each toured place's footage, one thumb at a time. */
  onReviewTours: () => void;
  /** One tap when the broker answers — logs the inbound reply. */
  onReplied: (listing: FeedListing) => void;
  /**
   * Tag-team line for a card — "Emma has point", "via Dad" — or null when
   * solo. Computed by the page, which holds the roster.
   */
  crewTag?: (listing: FeedListing) => string | null;
  /** Take it out of the running — opens the reason dialog upstream. */
  onPass: (listing: FeedListing) => void;
  /** Download the .ics for a booked tour. */
  onAddToCalendar: (listing: FeedListing) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [quick, setQuick] = useState("");

  /*
   * One box, two jobs. Typing searches the board you already have —
   * fuzzily, because people remember "ludlow" or "the bushwick one", not
   * the exact string — and dims everything that doesn't match. Submitting
   * opens the best match, or, when nothing on the board matches, falls
   * through to the paste-it-in behaviour this box has always had.
   */
  const hits = useMemo(() => {
    const query = quick.trim();
    // A pasted link is an add, never a search: no card's text looks like a URL.
    if (query.length < 2 || /^https?:\/\//i.test(query)) return null;
    const scored = listings
      // Only what the board actually shows: counting matches you can't see
      // makes the tally a lie.
      .filter((l) => (PIPELINE_STAGES as string[]).includes(l.stage))
      .map((l) => ({
        listing: l,
        score: fuzzyBest(
          [
            { text: `${l.address}${l.unit ? ` #${l.unit}` : ""}`, weight: 3 },
            { text: l.neighborhood, weight: 2 },
            { text: l.myContactName || l.contactName || "", weight: 1.5 },
            { text: l.notes, weight: 1 },
          ],
          query
        ),
      }))
      .filter((row): row is { listing: FeedListing; score: number } => row.score != null)
      .sort((a, b) => b.score - a.score);
    /*
     * Subsequence matching is generous by design — it has to be, to survive
     * a typo — but that generosity turns into "everything is a match" on
     * short queries. Anything far weaker than the best hit is coincidence,
     * so the tail gets cut rather than shown.
     */
    if (!scored.length) return null;
    const floor = scored[0].score * 0.45;
    return scored.filter((row) => row.score >= floor);
  }, [quick, listings]);

  const hitIds = useMemo(
    () => new Set((hits ?? []).map((h) => h.listing.id)),
    [hits]
  );
  const searching = hits != null || (quick.trim().length >= 2 && !/^https?:\/\//i.test(quick));

  // The best match scrolls itself into view, so a hit three columns over
  // isn't a hit you have to go hunting for.
  useEffect(() => {
    const top = hits?.[0];
    if (!top) return;
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(top.listing.id)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [hits]);
  /**
   * Per-column sort by time in the column. Three states per column: the
   * default order (rating as the feed arrived; Tour reads as a schedule),
   * oldest here first (what's been waiting longest), newest here first.
   * Loaded after mount rather than in the initializer so the server and
   * first client render agree.
   */
  const [sorts, setSorts] = useState<Partial<Record<Stage, "old" | "new">>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem("damnlease.board.sort");
      if (raw) setSorts(JSON.parse(raw));
    } catch {
      /* an unreadable preference is just the default order */
    }
  }, []);
  function cycleSort(stage: Stage) {
    setSorts((prev) => {
      const next = { ...prev };
      if (!prev[stage]) next[stage] = "old";
      else if (prev[stage] === "old") next[stage] = "new";
      else delete next[stage];
      try {
        localStorage.setItem("damnlease.board.sort", JSON.stringify(next));
      } catch {
        /* private mode: the toggle still works for the session */
      }
      return next;
    });
  }
  /** When the card landed in its column; discovery time before it moved. */
  const inColumnSince = (l: FeedListing) =>
    new Date(l.stageChangedAt ?? l.firstSeenAt).getTime();

  /** The viewing is behind you: past its time, or past its window's end. */
  const tourOver = (l: FeedListing) =>
    Boolean(
      l.tourAt &&
        new Date(
          (l.tourKind === "open_house" && l.tourEndsAt) || l.tourAt
        ).getTime() < Date.now()
    );

  /**
   * Where the card's next-action button should land in the drawer: the
   * control the label names, not just the neighborhood. "Set the time"
   * opens the viewing planner with the cursor in the time field; "Add a
   * number" lands in the phone field; anything apply-shaped opens Apply.
   * The @suffix asks the drawer to focus that control after scrolling.
   */
  function jumpFor(l: FeedListing): string {
    const kind = nextAction(l).kind;
    if (kind === "decide" || (kind === "wait" && l.stage === "toured")) return "sec-score";
    if (kind === "apply" || l.stage === "applied") return "sec-apply";
    if (l.stage === "tour") return "sec-viewing@time";
    if (kind === "add-contact") return "sec-contact@phone";
    return "sec-contact";
  }
  /** A touch-lifted card: what's being dragged and where the finger is. */
  const [lifted, setLifted] = useState<{ listing: FeedListing; x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    startX: number;
    startY: number;
    listing: FeedListing | null;
    lifted: boolean;
    overStage: Stage | null;
    /** Swallow the click that some browsers fire after a drag's touchend. */
    justDropped: boolean;
  }>({ timer: null, startX: 0, startY: 0, listing: null, lifted: false, overStage: null, justDropped: false });

  function moveBy(listing: FeedListing, delta: number) {
    const at = PIPELINE_STAGES.indexOf(listing.stage);
    if (at < 0) return;
    const next = PIPELINE_STAGES[at + delta];
    if (next) onMove(listing, next);
  }

  /** A finger down on a card arms the hold timer; nothing lifts yet. */
  function armTouch(listing: FeedListing, e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t || e.touches.length > 1) return;
    const state = touch.current;
    state.startX = t.clientX;
    state.startY = t.clientY;
    state.listing = listing;
    state.lifted = false;
    state.overStage = null;
    state.timer = setTimeout(() => {
      state.timer = null;
      state.lifted = true;
      navigator.vibrate?.(10);
      setLifted({ listing, x: state.startX, y: state.startY });
      setDragging(listing.id);
    }, LIFT_MS);
  }

  /*
   * The move/end handlers are native, not React props: React registers touch
   * listeners as passive, and a passive touchmove cannot preventDefault —
   * which is the only way to stop the page scrolling under a lifted card.
   */
  useEffect(() => {
    const state = touch.current;

    /*
     * Which column the finger is over, by lane rather than by point.
     * elementFromPoint was the first attempt and it missed constantly: the
     * columns are short (min-height 200), so a finger below a sparse column
     * or in the gutter between two resolved to nothing and the drop
     * cancelled. On a horizontal strip the honest model is that a column
     * owns its full vertical lane.
     */
    function columnAt(x: number): Stage | null {
      const cols = boardRef.current?.querySelectorAll<HTMLElement>(".board-col");
      for (const col of cols ?? []) {
        const r = col.getBoundingClientRect();
        if (x >= r.left - 6 && x <= r.right + 6)
          return col.getAttribute("data-stage") as Stage | null;
      }
      return null;
    }

    function onMoveTouch(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      if (state.timer) {
        // Still deciding: real movement before the hold elapses is a scroll.
        const wobble = Math.hypot(t.clientX - state.startX, t.clientY - state.startY);
        if (wobble > WOBBLE_PX) {
          clearTimeout(state.timer);
          state.timer = null;
          state.listing = null;
        }
        return;
      }
      if (!state.lifted || !state.listing) return;
      e.preventDefault();
      setLifted({ listing: state.listing, x: t.clientX, y: t.clientY });
      const stage = columnAt(t.clientX);
      state.overStage = stage;
      setOver(stage);
      // Near either edge, scroll the strip so far columns stay reachable.
      const board = boardRef.current;
      if (board) {
        const box = board.getBoundingClientRect();
        if (t.clientX < box.left + 56) board.scrollLeft -= 14;
        else if (t.clientX > box.right - 56) board.scrollLeft += 14;
      }
    }

    function onEndTouch() {
      if (state.timer) {
        // Short tap: let the ordinary click open the card.
        clearTimeout(state.timer);
        state.timer = null;
        state.listing = null;
        return;
      }
      if (!state.lifted) return;
      const { listing, overStage } = state;
      state.lifted = false;
      state.listing = null;
      state.justDropped = true;
      setTimeout(() => {
        state.justDropped = false;
      }, 350);
      setLifted(null);
      setDragging(null);
      setOver(null);
      if (listing && overStage && listing.stage !== overStage) onMove(listing, overStage);
    }

    document.addEventListener("touchmove", onMoveTouch, { passive: false });
    document.addEventListener("touchend", onEndTouch);
    document.addEventListener("touchcancel", onEndTouch);
    return () => {
      document.removeEventListener("touchmove", onMoveTouch);
      document.removeEventListener("touchend", onEndTouch);
      document.removeEventListener("touchcancel", onEndTouch);
    };
  }, [onMove]);

  return (
    <>
      {/*
        Somebody sends you an address or a link. This finds it in what's
        already tracked and moves it onto the board — and on a miss the page
        runs a check on the spot, because everything gets posted somewhere and
        the poll just hasn't reached it yet.
      */}
      <form
        className="quickadd"
        onSubmit={(e) => {
          e.preventDefault();
          if (!quick.trim()) return;
          // On the board already? Open it. Otherwise it's something new.
          if (hits?.length) {
            onOpen(hits[0].listing);
            setQuick("");
            return;
          }
          onQuickAdd(quick.trim());
          setQuick("");
        }}
      >
        <input
          className="field"
          value={quick}
          placeholder="Search your board, or paste a link to pull one in"
          aria-label="Search your pipeline, or paste an address or link"
          onChange={(e) => setQuick(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={!quick.trim()}>
          {hits?.length ? "Open it" : "Find it"}
        </button>
        {searching && (
          <span className="quickadd-count muted" aria-live="polite">
            {hits?.length
              ? `${hits.length} match${hits.length === 1 ? "" : "es"} · Enter opens ${hits[0].listing.address}`
              : "Nothing on your board matches. Enter pulls it in"}
          </span>
        )}
      </form>

    <div
      className="board"
      ref={boardRef}
      // Android fires a context menu on a stationary long-press — the same
      // gesture that lifts a card here.
      onContextMenu={(e) => {
        if (touch.current.lifted) e.preventDefault();
      }}
    >
      {PIPELINE_STAGES.map((stage) => {
        const column = listings.filter((l) => l.stage === stage);
        const sortDir = sorts[stage];
        /*
         * The Tour column is a schedule, so it reads like one: soonest
         * viewing first. Cards with no time yet sort after the timed ones —
         * they carry their own coral "Set the time" flag, and a schedule
         * interleaved with unscheduled entries stops being scannable as a
         * day. Other columns keep the rating order the feed arrived in.
         * A chosen column sort overrides both — the person asked for time.
         */
        if (sortDir) {
          column.sort((a, b) =>
            sortDir === "old"
              ? inColumnSince(a) - inColumnSince(b)
              : inColumnSince(b) - inColumnSince(a)
          );
        } else if (stage === "tour") {
          column.sort((a, b) => {
            if (a.tourAt && b.tourAt)
              return new Date(a.tourAt).getTime() - new Date(b.tourAt).getTime();
            if (a.tourAt) return -1;
            if (b.tourAt) return 1;
            return 0;
          });
        }
        return (
          <div
            key={stage}
            className="board-col"
            data-stage={stage}
            data-over={over === stage && dragging ? "true" : undefined}
            onDragOver={(e) => {
              // Without preventDefault the browser refuses the drop outright.
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== stage) setOver(stage);
            }}
            onDragLeave={(e) => {
              // Leaving for a child is not leaving the column.
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              const listing = listings.find((l) => l.id === id);
              setDragging(null);
              setOver(null);
              if (listing && listing.stage !== stage) onMove(listing, stage);
            }}
          >
            <div className="board-head">
              <span>{STAGE_LABEL[stage]}</span>
              {/* How much of today is already spoken for, on the column
                  header where the count already lives. */}
              {stage === "tour" &&
                (() => {
                  const today = column.filter(
                    (l) => l.tourAt && dayWord(l.tourAt) === "Today"
                  ).length;
                  return today > 0 ? (
                    <span className="board-today">{today} today</span>
                  ) : null;
                })()}
              <span className="board-head-side">
                {/* The Tour column is the one with a geography problem: the
                    bookings have times and addresses, so the app can draw
                    the day instead of leaving you to zigzag. */}
                {stage === "tour" && column.some((l) => l.tourAt) && (
                  <button
                    className="board-plan"
                    onClick={onPlanTours}
                    title="Map your tour days: order, route and walking time"
                    aria-label="Plan your tour route"
                  >
                    <Icon name="calendar" size={13} />
                    Plan
                  </button>
                )}
                {/* Mass outreach is the game: reach the whole Interested
                    column with opening pitches, then chase the whole
                    Contacted column with follow-ups, one pre-written tap
                    per place. */}
                {stage === "interested" && column.length > 0 && (
                  <button
                    className="board-plan"
                    onClick={onReachAll}
                    title="Send the opening message to everyone here, one tap each"
                    aria-label="Reach out to everyone in Interested"
                  >
                    <Icon name="send" size={13} />
                    Text all
                  </button>
                )}
                {stage === "contacted" && column.length > 0 && (
                  <button
                    className="board-plan"
                    onClick={onChaseAll}
                    title="Send a follow-up to everyone here, one tap each"
                    aria-label="Follow up with everyone in Contacted"
                  >
                    <Icon name="send" size={13} />
                    Chase all
                  </button>
                )}
                {/* After a day of viewings the places blur together. Review
                    replays each toured place with its own footage and takes
                    a thumb, one place at a time. */}
                {stage === "toured" && column.length > 0 && (
                  <button
                    className="board-plan"
                    onClick={onReviewTours}
                    title="Replay your footage place by place and thumb each one"
                    aria-label="Review your toured places"
                  >
                    <Icon name="video" size={13} />
                    Review
                  </button>
                )}
                {/* Time in column, on demand: what's been sitting longest
                    is usually what needs the next push. */}
                {column.length > 1 && (
                  <button
                    className={sortDir ? "board-sort is-on" : "board-sort"}
                    onClick={() => cycleSort(stage)}
                    aria-pressed={Boolean(sortDir)}
                    title={
                      sortDir === "old"
                        ? "Oldest here first. Tap for newest first"
                        : sortDir === "new"
                          ? "Newest here first. Tap to go back to the usual order"
                          : "Sort by how long each place has been in this column"
                    }
                    aria-label={`Sort the ${STAGE_LABEL[stage]} column by time here`}
                  >
                    <Icon name="sort" size={12} />
                    {sortDir === "old" ? "Oldest" : sortDir === "new" ? "Newest" : ""}
                  </button>
                )}
                <span className="muted">{column.length}</span>
              </span>
            </div>

            <div className="board-stack">
              {column.map((l) => (
                <button
                  key={l.id}
                  data-card-id={l.id}
                  data-hit={searching ? (hitIds.has(l.id) ? "yes" : "no") : undefined}
                  // Today's viewings are the only cards on this board with a
                  // deadline measured in hours. They get their own colour so
                  // "what am I doing today" is answered by glancing, not
                  // reading every date in the column.
                  data-today={
                    l.stage === "tour" && l.tourAt && dayWord(l.tourAt) === "Today"
                      ? "yes"
                      : undefined
                  }
                  className="surface board-card"
                  draggable
                  data-dragging={dragging === l.id ? "true" : undefined}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", l.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(l.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  onTouchStart={(e) => armTouch(l, e)}
                  onClick={() => {
                    // The click that trails a touch-drop would open the card
                    // you just filed somewhere else.
                    if (touch.current.justDropped) return;
                    onOpen(l);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight") {
                      e.preventDefault();
                      moveBy(l, 1);
                    } else if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      moveBy(l, -1);
                    }
                  }}
                  aria-label={`${l.address}, ${STAGE_LABEL[l.stage]}. Left and right arrows move it between stages.`}
                >
                  <span className="board-top">
                    <strong>{money(l.price)}</strong>
                    <RatingDisc rating={l.rating} grade={l.grade} size="sm" />
                    {/* Anything on the board can leave it. Without this the
                        only way out of Interested was to open the panel and
                        hunt through the status menu. */}
                    <span
                      role="button"
                      tabIndex={0}
                      className="board-drop"
                      title="Not for me"
                      aria-label={`Pass on ${l.address}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPass(l);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onPass(l);
                        }
                      }}
                    >
                      <Icon name="close" size={12} />
                    </span>
                  </span>
                  <span className="board-addr">
                    {l.address}
                    {l.unit ? ` #${l.unit}` : ""}
                  </span>
                  <span className="muted board-where">{l.neighborhood}</span>
                  {l.forSale && (
                    <span className="sale-tag">
                      For sale{l.salePrice ? ` · asks ${compactPrice(l.salePrice)}` : ""}
                    </span>
                  )}
                  {crewTag?.(l) && <span className="board-crew">{crewTag(l)}</span>}

                  {/* The question each column actually raises. Interested:
                      how long has this been sitting here? Contacted: when
                      did I last poke them, and how? */}
                  {l.stage === "interested" && (
                    <span className="muted board-stamp">
                      Spotted {whenText(l.firstSeenAt, false)}
                    </span>
                  )}
                  {l.stage === "contacted" && (l.lastContactAt || l.stageChangedAt) && (
                    <span className="muted board-stamp">
                      {l.lastContactAt
                        ? `${CONTACT_LABEL[l.lastContactChannel ?? "text"]} ${whenText(l.lastContactAt, true)}`
                        : `Marked contacted ${whenText(l.stageChangedAt!, true)}`}
                    </span>
                  )}

                  {/* A booked tour's whole point is being somewhere at a
                      time, so the handoff to your calendar belongs on the
                      card — not only inside a panel you have to open. */}
                  {l.stage === "tour" && l.tourAt && (
                    <span className="board-cal">
                      <span
                        role="button"
                        tabIndex={0}
                        className="btn btn-quiet"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToCalendar(l);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onAddToCalendar(l);
                          }
                        }}
                      >
                        <Icon name="calendar" size={13} /> Calendar
                      </span>
                      <a
                        className="btn btn-quiet"
                        href={googleCalendarUrl(l) ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Google <Icon name="external" size={11} />
                      </a>
                    </span>
                  )}
                  {/* The app can't read your texts, so the reply gets one
                      tap instead: press it when they answer and the card's
                      whole posture flips from chasing to booking. */}
                  {l.stage === "contacted" && !l.hasReply && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="board-replied"
                      title="Mark that they answered"
                      aria-label={`They replied about ${l.address}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReplied(l);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onReplied(l);
                        }
                      }}
                    >
                      <Icon name="message" size={13} />
                      They replied
                    </span>
                  )}
                  {/* Fresh from the viewing: which way are you leaning? A
                      thumb is a note to self, not a decision — the card
                      stays in its column, and only a stage move files it.
                      Tapping the same thumb again clears it. Asking before
                      the viewing happened would be polling a gut that has
                      nothing to go on yet, so a booked tour keeps its
                      thumbs until its time (or its window) has passed. */}
                  {(l.stage === "toured" || (l.stage === "tour" && tourOver(l))) && (
                    <span className="board-lean">
                      {([
                        [1, "thumbup", "Leaning yes"],
                        [-1, "thumbdown", "Leaning no"],
                      ] as const).map(([value, icon, label]) => (
                        <span
                          key={icon}
                          role="button"
                          tabIndex={0}
                          className={l.lean === value ? "lean-btn is-on" : "lean-btn"}
                          data-lean={value}
                          title={label}
                          aria-label={`${label} on ${l.address}`}
                          aria-pressed={l.lean === value}
                          onClick={(e) => {
                            e.stopPropagation();
                            onLean(l, l.lean === value ? 0 : value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              onLean(l, l.lean === value ? 0 : value);
                            }
                          }}
                        >
                          <Icon name={icon} size={14} />
                        </span>
                      ))}
                      {l.lean !== 0 && (
                        <span className="muted lean-note">
                          {l.lean === 1 ? "leaning yes" : "leaning no"}
                        </span>
                      )}
                      {/* The third state, made deliberate: not yes, not no,
                          but committed to a day you'll answer by. One tap
                          books tomorrow; the panel takes the reason. */}
                      <span
                        role="button"
                        tabIndex={0}
                        className={l.followUpAt ? "decide-chip is-on" : "decide-chip"}
                        title={
                          l.followUpAt
                            ? "You set a check-back day. Tap to clear it"
                            : "Not ready to call it? Tap to check back tomorrow"
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeciding(l);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onDeciding(l);
                          }
                        }}
                      >
                        {l.followUpAt
                          ? `deciding by ${dayWord(l.followUpAt).toLowerCase()}${l.followUpNote ? ` · ${l.followUpNote.slice(0, 24)}` : ""}`
                          : "still deciding?"}
                      </span>
                    </span>
                  )}
                  {/* The application's verdict, recorded where you're
                      staring while you wait for it. Accepted opens the last
                      question — did you take it? — as a star, because
                      "secured" is the card every hunt is trying to draw. */}
                  {l.stage === "applied" && (
                    <span className="board-lean">
                      {([
                        [1, "thumbup", "Accepted"],
                        [-1, "thumbdown", "Denied"],
                      ] as const).map(([value, icon, label]) => (
                        <span
                          key={icon}
                          role="button"
                          tabIndex={0}
                          className={l.appResult === value ? "lean-btn is-on" : "lean-btn"}
                          data-lean={value}
                          title={label}
                          aria-label={`${label}: ${l.address}`}
                          aria-pressed={l.appResult === value}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAppResult(l, l.appResult === value ? 0 : value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              onAppResult(l, l.appResult === value ? 0 : value);
                            }
                          }}
                        >
                          <Icon name={icon} size={14} />
                        </span>
                      ))}
                      {l.appResult === 1 && (
                        <span
                          role="button"
                          tabIndex={0}
                          className={l.secured ? "lean-btn secured-btn is-on" : "lean-btn secured-btn"}
                          title={l.secured ? "Secured. This is the one" : "Took it? Mark it secured"}
                          aria-label={`Mark ${l.address} secured`}
                          aria-pressed={l.secured}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSecured(l, !l.secured);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              onSecured(l, !l.secured);
                            }
                          }}
                        >
                          <Icon name="star" size={14} />
                        </span>
                      )}
                      {l.secured && l.appResult === 1 ? (
                        <span className="lean-note secured-note">secured</span>
                      ) : l.appResult === 1 ? (
                        /* Their yes is not your yes. Without somewhere to
                           record "accepted, and I passed", the card sits at
                           "accepted" forever and the funnel counts a place
                           you turned down as still live. */
                        <span className="lean-accepted">
                          <span className="muted lean-note">accepted</span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="declinebtn"
                            title="Accepted, but you're not taking it"
                            aria-label={`Turn down ${l.address}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPass(l);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                onPass(l);
                              }
                            }}
                          >
                            not taking it
                          </span>
                        </span>
                      ) : l.appResult !== 0 ? (
                        <span className="muted lean-note">denied</span>
                      ) : null}
                    </span>
                  )}
                  {/* One source of truth with the cards and the panel, so the
                      board can never disagree about what comes next. And the
                      label is the shortcut: "Add a number" lands you on the
                      number field, not at the top of a panel to scroll. */}
                  <span
                    role="button"
                    tabIndex={0}
                    className={
                      nextAction(l).urgent ? "board-next is-due" : "board-next"
                    }
                    title="Jump to where this happens"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenAt(l, jumpFor(l));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onOpenAt(l, jumpFor(l));
                      }
                    }}
                  >
                    {nextAction(l).label}
                  </span>
                </button>
              ))}

              {column.length === 0 && (
                <div className="board-empty">
                  {dragging ? `Drop here to mark ${STAGE_LABEL[stage].toLowerCase()}` : STAGE_HINT[stage]}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* The lifted card's ghost, riding under the finger. */}
      {lifted && (
        <div
          className="board-ghost"
          style={{ left: lifted.x, top: lifted.y }}
          aria-hidden="true"
        >
          <strong>{money(lifted.listing.price)}</strong>
          <span>
            {lifted.listing.address}
            {lifted.listing.unit ? ` #${lifted.listing.unit}` : ""}
          </span>
          <i>{over ? `→ ${STAGE_LABEL[over]}` : "Drag to a column"}</i>
        </div>
      )}
    </div>
    </>
  );
}
