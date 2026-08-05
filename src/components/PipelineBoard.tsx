"use client";

import { useState } from "react";
import type { FeedListing, Stage } from "@/types";
import { PIPELINE_STAGES, STAGE_LABEL } from "@/types";
import { RatingDisc } from "@/components/Rating";

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

/**
 * The single next action for a listing, given where it sits.
 *
 * A board that only shows position makes you re-derive the action every time
 * you look at it. This states it, and turns amber when it has waited too long.
 */
function nextStep(l: FeedListing): string {
  if (l.needsFollowUp) return "Chase — no reply yet";
  switch (l.stage) {
    case "interested":
      return "Ask for a viewing";
    case "contacted":
      return "Waiting on their reply";
    case "tour":
      return "Tour booked — go see it";
    case "toured":
      return "Decide, then apply";
    case "applied":
      return "Waiting on the landlord";
    default:
      return "";
  }
}

/** What an empty column means, rather than a bare "Nothing here". */
const STAGE_HINT: Record<string, string> = {
  interested: "Star a place to start it here",
  contacted: "Nothing waiting on a reply",
  tour: "No viewings booked yet",
  toured: "Nothing seen in person yet",
  applied: "No applications in",
};

export default function PipelineBoard({
  listings,
  onOpen,
  onMove,
}: {
  listings: FeedListing[];
  onOpen: (listing: FeedListing) => void;
  onMove: (listing: FeedListing, stage: Stage) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);

  function moveBy(listing: FeedListing, delta: number) {
    const at = PIPELINE_STAGES.indexOf(listing.stage);
    if (at < 0) return;
    const next = PIPELINE_STAGES[at + delta];
    if (next) onMove(listing, next);
  }

  return (
    <div className="board">
      {PIPELINE_STAGES.map((stage) => {
        const column = listings.filter((l) => l.stage === stage);
        return (
          <div
            key={stage}
            className="board-col"
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
              <span className="muted">{column.length}</span>
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
                  </span>
                  <span className="board-addr">
                    {l.address}
                    {l.unit ? ` #${l.unit}` : ""}
                  </span>
                  <span className="muted board-where">{l.neighborhood}</span>
                  <span className={l.needsFollowUp ? "board-next is-due" : "board-next"}>
                    {nextStep(l)}
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
  );
}
