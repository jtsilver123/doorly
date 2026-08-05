"use client";

import { useState } from "react";
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
 *   touch     open it and use the status control in the panel
 *
 * HTML5 drag-and-drop deliberately, rather than a pointer-event
 * reimplementation: it is what screen readers and browsers already understand,
 * and it costs no library. It does not fire on touch — but on a phone this
 * board is a horizontally scrolling strip, where a drag gesture would be
 * fighting the scroll anyway, so the panel is the better answer there.
 */

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
  crewTag,
  onPass,
  onAddToCalendar,
}: {
  listings: FeedListing[];
  onOpen: (listing: FeedListing) => void;
  onMove: (listing: FeedListing, stage: Stage) => void;
  /** Address typed into the quick-add box. Resolved by the page. */
  onQuickAdd: (address: string) => void;
  /** Opens the tour-day route planner. */
  onPlanTours: () => void;
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

  function moveBy(listing: FeedListing, delta: number) {
    const at = PIPELINE_STAGES.indexOf(listing.stage);
    if (at < 0) return;
    const next = PIPELINE_STAGES[at + delta];
    if (next) onMove(listing, next);
  }

  return (
    <>
      {/*
        Somebody sends you an address. This finds it in what's already tracked
        and moves it onto the board — everything gets posted somewhere, so a
        miss means the poll hasn't reached it yet, not that it wants typing in
        by hand.
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
          placeholder="Paste an address to pull it in — 91 East Third Street"
          aria-label="Find a place by address"
          onChange={(e) => setQuick(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={!quick.trim()}>
          Find it
        </button>
      </form>

    <div className="board">
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
                    title="Map your tour days — order, route and walking time"
                    aria-label="Plan your tour route"
                  >
                    <Icon name="calendar" size={13} />
                    Plan
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
                  onClick={() => onOpen(l)}
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
                  {/* One source of truth with the cards and the panel, so the
                      board can never disagree about what comes next. */}
                  <span
                    className={
                      nextAction(l).urgent ? "board-next is-due" : "board-next"
                    }
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
    </div>
    </>
  );
}
