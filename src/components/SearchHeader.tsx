"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedListing } from "@/types";
import { daysUntil } from "@/lib/cost";

/**
 * Budget and move-in date, always visible and editable in one click.
 *
 * These are the two variables the whole product turns on, and both used to be
 * hidden — the date as a small line in the sidebar, the budget inside a
 * collapsed panel on a settings tab. That inverts the hierarchy: the numbers
 * deciding which apartments are even possible were harder to reach than a
 * filter for "no fee".
 *
 * Editing happens here rather than on a settings page because changing your
 * budget is not configuration, it's part of searching. You raise it by $200 to
 * see what opens up, look, and put it back — a round trip through a form page
 * makes that experiment cost enough that nobody runs it.
 *
 * The bar also answers the question a filtered list can't: *is this budget
 * realistic?* It compares the ceiling against the asking prices actually being
 * tracked in the chosen neighborhoods, so a search that can't succeed says so in
 * week one rather than after three weeks of empty results.
 */

export default function SearchHeader({
  listings,
  budget,
  moveInDate,
  onSave,
  onEditSearch,
}: {
  listings: FeedListing[];
  budget: number;
  moveInDate: string;
  /** Persists a change to either input. Both are optional; only what moved. */
  onSave: (next: { budget?: number; moveInDate?: string }) => void | Promise<void>;
  onEditSearch: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState<"budget" | "date" | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const days = daysUntil(moveInDate);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function open(field: "budget" | "date") {
    setDraft(field === "budget" ? String(budget) : moveInDate);
    setEditing(field);
  }

  function commit() {
    if (editing === "budget") {
      const value = Number(draft);
      // A budget of zero would hide every listing and read as a bug, so an
      // unparseable or empty entry just closes without changing anything.
      if (Number.isFinite(value) && value > 0 && value !== budget) onSave({ budget: value });
    } else if (editing === "date" && draft && draft !== moveInDate) {
      onSave({ moveInDate: draft });
    }
    setEditing(null);
  }

  // Share of tracked inventory the budget actually reaches. Measured from the
  // corpus rather than a national statistic, so it reflects these neighborhoods
  // at this moment.
  const priced = listings.filter((l) => l.price > 0);
  const affordable = priced.filter((l) => l.price <= budget).length;
  const share = priced.length ? Math.round((affordable / priced.length) * 100) : null;

  const sorted = priced.map((l) => l.price).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  // Under 15% of the market is a search that will mostly return nothing —
  // worth saying plainly, with the number that would fix it.
  const tooLow = share != null && share < 15 && priced.length >= 20;
  const dateLabel = moveInDate
    ? new Date(`${moveInDate}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "not set";

  return (
    <div className="searchhead">
      <div className="searchhead-facts">
        {editing === "budget" ? (
          <label className="fact fact-editing">
            <span className="fact-label">Max monthly rent</span>
            <input
              ref={inputRef}
              className="fact-input"
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(null);
              }}
              aria-label="Maximum monthly rent"
            />
          </label>
        ) : (
          <button className="fact" onClick={() => open("budget")}>
            <span className="fact-label">Budget</span>
            <span className="fact-value">
              ${budget.toLocaleString()}
              <span className="fact-unit">/mo · edit</span>
            </span>
          </button>
        )}

        {editing === "date" ? (
          <label className="fact fact-editing">
            <span className="fact-label">Move-in date</span>
            <input
              ref={inputRef}
              className="fact-input"
              type="date"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(null);
              }}
              aria-label="Move-in date"
            />
          </label>
        ) : (
          <button className="fact" onClick={() => open("date")}>
            <span className="fact-label">Move in</span>
            <span className="fact-value">
              {dateLabel}
              <span className="fact-unit">{days > 0 ? `in ${days} days` : "edit"}</span>
            </span>
          </button>
        )}

        <div className="fact fact-static">
          <span className="fact-label">In your range</span>
          <span className="fact-value">
            {share == null ? "—" : `${share}%`}
            <span className="fact-unit">
              {share == null ? "no data yet" : `${affordable} of ${priced.length}`}
            </span>
          </span>
        </div>

        <button className="fact fact-ghost fact-where" onClick={onEditSearch}>
          <span className="fact-label">Where</span>
          <span className="fact-value">
            Neighborhoods
            <span className="fact-unit">edit</span>
          </span>
        </button>
      </div>

      {tooLow && !dismissed && (
        <div className="reality" role="status">
          <span>
            <strong>Your budget reaches {share}% of what&apos;s listed here.</strong>{" "}
            The median asking price in your neighborhoods is $
            {median.toLocaleString()}. Raising the ceiling to $
            {Math.round((median * 1.05) / 50) * 50} or adding a neighborhood would
            open up most of the market.
          </span>
          <span className="reality-actions">
            <button
              className="linkish"
              onClick={() => onSave({ budget: Math.round((median * 1.05) / 50) * 50 })}
            >
              Raise to ${Math.round((median * 1.05) / 50) * 50}
            </button>
            <button className="linkish" onClick={() => setDismissed(true)}>
              Dismiss
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
