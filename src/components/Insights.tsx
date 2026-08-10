"use client";

import { useEffect, useMemo } from "react";
import type { FeedListing } from "@/types";
import { readHunt } from "@/lib/insights";
import Icon from "@/components/Icon";

/**
 * How the hunt is actually going.
 *
 * The board shows where each place is; this shows what happens between the
 * columns. Every hand-off is a rate — saved to contacted, contacted to
 * replied, replied to toured, toured to applied — drawn as a falling
 * funnel, because conversion is a shape before it's a number. Under the
 * shape, at most two observations from your own numbers, each pointing at
 * a habit rather than a statistic: the point isn't to grade the hunt, it's
 * to change what you do tomorrow morning.
 */
export default function Insights({
  listings,
  onClose,
}: {
  listings: FeedListing[];
  onClose: () => void;
}) {
  const { steps, insights } = useMemo(() => readHunt(listings), [listings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: { label: string; count: number; of: number | null; hint: string }[] = [
    { label: "Saved", count: steps.saved, of: null, hint: "in your pipeline" },
    { label: "Contacted", count: steps.contacted, of: steps.saved, hint: "of saved" },
    { label: "Replied", count: steps.replied, of: steps.contacted, hint: "of contacted" },
    { label: "Toured", count: steps.toured, of: steps.replied, hint: "of replied" },
    { label: "Applied", count: steps.applied, of: steps.toured, hint: "of toured" },
  ];
  // Approved is the landlord's yes, signed is yours; only rows with
  // something in them earn a line.
  if (steps.approved > 0)
    rows.push({ label: "Approved", count: steps.approved, of: steps.applied, hint: "of applied" });
  if (steps.won > 0)
    rows.push({ label: "Signed", count: steps.won, of: steps.applied, hint: "of applied" });

  const max = Math.max(steps.saved, 1);

  return (
    <div
      className="compare-modal"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="compare-modal-panel insights-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Hunt insights"
      >
        <header className="insights-head">
          <div>
            <b>How it&apos;s going</b>
            <span className="muted">
              What happens between the columns, in your own numbers
            </span>
          </div>
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </header>

        <div className="insights-funnel" role="table" aria-label="Your funnel">
          {rows.map((row) => {
            const rate = row.of != null && row.of > 0 ? row.count / row.of : null;
            return (
              <div className="insights-row" role="row" key={row.label}>
                <span className="insights-stage">{row.label}</span>
                <span className="insights-bar">
                  <i
                    data-zero={row.count === 0 ? "true" : undefined}
                    style={{ width: `${Math.max((row.count / max) * 100, 2)}%` }}
                  />
                  <b>{row.count}</b>
                </span>
                <span className="insights-rate">
                  {rate != null ? (
                    <>
                      <b>{Math.round(rate * 100)}%</b> {row.hint}
                    </>
                  ) : row.of === 0 ? (
                    <span className="muted">waiting on {row.hint.replace("of ", "")}</span>
                  ) : (
                    <span className="muted">{row.hint}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div className="insights-reads">
          {insights.map((item) => (
            <div className="insights-card" data-tone={item.tone} key={item.key}>
              <span className="insights-card-mark" aria-hidden="true">
                <Icon
                  name={item.tone === "win" ? "check" : item.tone === "push" ? "alert" : "today"}
                  size={15}
                />
              </span>
              <div>
                <b>{item.title}</b>
                <p>{item.body}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="muted insights-note">
          Rates firm up as the hunt grows; advice only appears once a stage has
          enough places behind it to mean something.
        </p>
      </div>
    </div>
  );
}
