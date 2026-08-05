"use client";

import { useEffect, useState } from "react";
import type { FeedListing } from "@/types";
import { GRADE_LABEL, type Grade } from "@/lib/verdict";

/**
 * The score, and why.
 *
 * A number on its own is a black box, and a black box is the fastest way to
 * lose someone's trust — a "72" nobody can interrogate gets ignored within a
 * day. So the disc is never shown without its reasons close by: on the card,
 * the best thing and the worst thing about the apartment; in the drawer, the
 * full list. The disc is the summary of the list, not a separate opinion.
 */

export function RatingDisc({
  rating,
  grade,
  size = "md",
  title,
}: {
  rating: number;
  grade: Grade;
  size?: "sm" | "md" | "lg";
  title?: string;
}) {
  return (
    <span
      className="ratedisc"
      data-grade={grade}
      data-size={size}
      title={title ?? `${rating} out of 100 — ${GRADE_LABEL[grade]} match for your search`}
      aria-label={`Rated ${rating} out of 100, ${GRADE_LABEL[grade]}`}
      role="img"
    >
      <b>{rating}</b>
      {size !== "sm" && <i>/100</i>}
    </span>
  );
}

/**
 * Your own number, beside the computed one.
 *
 * Shown only once you've set it, and never restyled to look like the generated
 * disc — it's outlined rather than filled, so a glance tells you which of the
 * two is the model's opinion and which is yours. Two numbers that disagree is
 * the useful case: an 81 you scored 40 after seeing it is the single most
 * valuable fact in the pipeline.
 */
export function MyScoreDisc({
  score,
  size = "md",
}: {
  score: number;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      className="myscore"
      data-size={size}
      title={`You scored this ${score} out of 100`}
      aria-label={`Your score, ${score} out of 100`}
      role="img"
    >
      <b>{score}</b>
      {size !== "sm" && <i>you</i>}
    </span>
  );
}

/**
 * Setting it.
 *
 * A slider rather than a number field: the question is "how much do I like
 * this", which is a feeling with no exact answer, and asking someone to type
 * "73" invites them to deliberate over a digit that doesn't matter. The number
 * is shown live beside the track so it's still precise if you want it to be.
 *
 * Saves on release, not on drag, so dragging from 1 to 90 is one write.
 */
export function MyScoreField({
  score,
  onChange,
}: {
  score: number | null;
  onChange: (score: number | null) => void;
}) {
  const [draft, setDraft] = useState<number>(score ?? 70);
  // A different listing in the same panel starts from its own score.
  useEffect(() => setDraft(score ?? 70), [score]);

  return (
    <div className="myscore-field">
      <div className="myscore-row">
        <input
          type="range"
          min={1}
          max={100}
          value={draft}
          aria-label="Your score out of 100"
          onChange={(e) => setDraft(Number(e.target.value))}
          onMouseUp={() => onChange(draft)}
          onTouchEnd={() => onChange(draft)}
          onKeyUp={() => onChange(draft)}
        />
        <MyScoreDisc score={draft} />
      </div>
      <div className="myscore-foot">
        <span className="muted">
          {score == null
            ? "Not scored — drag to set yours"
            : "Sorts and compares on your number, not ours"}
        </span>
        {score != null && (
          <button className="linkish" onClick={() => onChange(null)}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One good thing and one bad thing, always in the same two slots.
 *
 * Reserving both rows even when a listing has nothing to say in one of them is
 * deliberate: it keeps every card exactly the same height, which is what makes
 * a grid scannable rather than something you have to re-read line by line.
 */
export function ProsConsLine({ listing }: { listing: FeedListing }) {
  const pro = listing.pros[0];
  const con = listing.cons[0];

  return (
    <div className="proscon">
      <span className="proscon-row is-pro">
        <span aria-hidden="true">✓</span>
        <span>{pro ?? "Nothing standing out yet"}</span>
      </span>
      <span className="proscon-row is-con">
        <span aria-hidden="true">✕</span>
        <span>{con ?? "No obvious drawbacks"}</span>
      </span>
    </div>
  );
}

/** The full breakdown, for the detail panel where there's room to read. */
export function ProsConsList({ listing }: { listing: FeedListing }) {
  return (
    <div className="proscon-cols">
      <div>
        <h4 className="proscon-head is-pro">Good</h4>
        <ul className="proscon-list">
          {listing.pros.length ? (
            listing.pros.map((line) => (
              <li key={line}>
                <span aria-hidden="true">✓</span>
                {line}
              </li>
            ))
          ) : (
            <li className="muted">Nothing stands out in the listing.</li>
          )}
        </ul>
      </div>
      <div>
        <h4 className="proscon-head is-con">Watch out</h4>
        <ul className="proscon-list">
          {listing.cons.length ? (
            listing.cons.map((line) => (
              <li key={line}>
                <span aria-hidden="true">✕</span>
                {line}
              </li>
            ))
          ) : (
            <li className="muted">Nothing concerning found.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
