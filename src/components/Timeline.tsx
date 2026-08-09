"use client";

import type { Funnel, PhaseInfo } from "@/lib/timeline";
import { phaseBands } from "@/lib/timeline";

/**
 * Where you are in the hunt.
 *
 * The single most useful thing to know each morning isn't which listings exist
 * — it's whether you should be browsing, viewing, or compromising. That's set
 * by the calendar, not by the feed, so it gets the top of the screen.
 */
export default function Timeline({
  info,
  funnel,
  moveInDate,
  onInsights,
}: {
  info: PhaseInfo;
  funnel: Funnel;
  moveInDate: string;
  onInsights?: () => void;
}) {
  const bands = phaseBands();
  const target = moveInDate
    ? new Date(`${moveInDate}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : "your move-in date";

  return (
    <section className="surface timeline">
      <header className="timeline-head">
        <div>
          <div className="timeline-phase">{info.label}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {info.daysLeft >= 0
              ? `${info.daysLeft} days until ${target}`
              : `${target} has passed`}
          </div>
        </div>
        {/* The numbers double as the door to the full read: rates between
            the stages, and what they suggest changing. */}
        <button
          className="timeline-funnel"
          onClick={onInsights}
          disabled={!onInsights}
          aria-label="Open hunt insights"
        >
          {(
            [
              ["Contacted", funnel.contacted],
              ["Replied", funnel.replied],
              ["Viewed", funnel.viewed],
              ["Applied", funnel.applied],
            ] as [string, number][]
          ).map(([label, value]) => (
            <div key={label} className="timeline-stat">
              <strong>{value}</strong>
              <span className="muted">{label}</span>
            </div>
          ))}
          {onInsights && <span className="timeline-funnel-more muted">Insights →</span>}
        </button>
      </header>

      <div className="timeline-bar" role="img" aria-label={`${info.label}, ${info.daysLeft} days left`}>
        {bands.map((band) => (
          <div
            key={band.phase}
            className={`timeline-band band-${band.phase}${
              band.phase === info.phase ? " is-current" : ""
            }`}
            style={{ flexGrow: band.width }}
            title={band.label}
          >
            <span>{band.label}</span>
          </div>
        ))}
        <div
          className="timeline-marker"
          style={{ left: `${info.progress * 100}%` }}
          aria-hidden="true"
        >
          <span className="timeline-marker-dot" />
        </div>
      </div>

      {/* One line in the pinned strip; the full sentence rides on hover. */}
      <p className="timeline-advice" title={info.advice}>
        {info.advice}
      </p>

      {/* Outreach pace. The usual way this search fails is being too selective
          in week one and running out of runway in week three. */}
      {info.phase !== "early" && info.phase !== "past" && (
        <div className={`timeline-pace ${funnel.onPace ? "is-ok" : "is-behind"}`}>
          <div className="meter">
            <span
              style={{
                width: `${Math.min(100, (funnel.contacted / Math.max(funnel.targetContacts, 1)) * 100)}%`,
                background: funnel.onPace ? "var(--good)" : "var(--warn)",
              }}
            />
          </div>
          <div style={{ fontSize: 12 }}>
            {funnel.onPace ? (
              <>
                On pace. {funnel.contacted} contacted, about {funnel.targetContacts}{" "}
                typically needed to land one.
              </>
            ) : (
              <>
                <strong>Behind pace.</strong> {funnel.contacted} contacted; roughly{" "}
                {funnel.expectedByNow} by now keeps you on track for{" "}
                {funnel.targetContacts} total.
              </>
            )}
            {funnel.usingOwnRates && (
              <span className="muted"> Based on your own reply rate.</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
