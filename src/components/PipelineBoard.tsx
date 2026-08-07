"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedListing, Stage } from "@/types";
import { PIPELINE_STAGES, STAGE_LABEL } from "@/types";
import { RatingDisc } from "@/components/Rating";
import { googleCalendarUrl } from "@/lib/calendar";
import { nextAction } from "@/lib/nextAction";
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
  crewTag,
  onPass,
  onLean,
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
          onQuickAdd(quick.trim());
          setQuick("");
        }}
      >
        <input
          className="field"
          value={quick}
          placeholder="Paste an address or a listing link to pull it in"
          aria-label="Find a place by address or link"
          onChange={(e) => setQuick(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={!quick.trim()}>
          Find it
        </button>
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
        /*
         * The Tour column is a schedule, so it reads like one: soonest
         * viewing first. Cards with no time yet sort after the timed ones —
         * they carry their own coral "Set the time" flag, and a schedule
         * interleaved with unscheduled entries stops being scannable as a
         * day. Other columns keep the rating order the feed arrived in.
         */
        if (stage === "tour") {
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
                <span className="muted">{column.length}</span>
              </span>
            </div>

            <div className="board-stack">
              {column.map((l) => (
                <button
                  key={l.id}
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
                  {crewTag?.(l) && <span className="board-crew">{crewTag(l)}</span>}

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
                  {/* Fresh from the viewing: which way are you leaning? A
                      thumb is a note to self, not a decision — the card
                      stays in its column, and only a stage move files it.
                      Tapping the same thumb again clears it. */}
                  {(l.stage === "tour" || l.stage === "toured") && (
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
                      ) : l.appResult !== 0 ? (
                        <span className="muted lean-note">
                          {l.appResult === 1 ? "accepted" : "denied"}
                        </span>
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
                      const kind = nextAction(l).kind;
                      onOpenAt(l, kind === "apply" ? "sec-apply" : "sec-contact");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        const kind = nextAction(l).kind;
                        onOpenAt(l, kind === "apply" ? "sec-apply" : "sec-contact");
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
