"use client";

import type { Funnel, PhaseInfo } from "@/lib/timeline";

/**
 * The hunt's vital signs, living in the rail.
 *
 * There used to be two half-versions of this: a countdown in the rail and a
 * wide phase panel heading the Pipeline page, each carrying part of the same
 * story. Merged here they become the thing the rail was missing — a status
 * instrument that answers "where am I, how's it going" from any tab, in the
 * order the question runs: how long left, which phase that puts you in, how
 * the funnel is converting, whether the pace holds.
 *
 * The funnel is drawn, not listed: four bars falling from contacted to
 * applied, because conversion is a shape before it's a number.
 */
export default function RailStatus({
  info,
  funnel,
  moveInDate,
  live,
  changed,
  onInsights,
  won,
}: {
  info: PhaseInfo;
  funnel: Funnel;
  moveInDate: string;
  live: number;
  changed: number;
  onInsights?: () => void;
  /**
   * The address that ended the hunt, if one has. A countdown and a pace
   * meter are advice, and advice about how fast you are hunting is nonsense
   * once you have signed: the instrument stops measuring and starts
   * reporting.
   */
  won?: string | null;
}) {
  const date = moveInDate
    ? new Date(`${moveInDate}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
  const showPace = info.phase !== "early" && info.phase !== "past";

  if (won) {
    return (
      <div className="railstatus railstatus-won">
        <span className="railstatus-label">You&apos;re in</span>
        <b className="railstatus-address">{won}</b>
        {date && <span className="muted">Yours from {date}</span>}
        {onInsights && (
          <button className="railstatus-insights" onClick={onInsights}>
            How it went →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="railstatus" title={info.advice}>
      <div className="railstatus-top">
        <span className="railstatus-label">
          Move-in{date ? ` · ${date}` : ""}
        </span>
        <span className="railstatus-phase" data-phase={info.phase}>
          {info.label}
        </span>
      </div>

      <b className="railstatus-days" data-soon={info.daysLeft <= 21 ? "true" : undefined}>
        {Math.max(info.daysLeft, 0)}
        <i>days</i>
      </b>

      {/* One bar, one line. The phase word above already places you on the
          calendar; what this adds is whether the work is keeping up, plus
          the two funnel numbers that change what you do today. */}
      {showPace && (
        <div className={`railstatus-pace ${funnel.onPace ? "is-ok" : "is-behind"}`}>
          <span className="railstatus-meter">
            <i
              style={{
                width: `${Math.min(100, (funnel.contacted / Math.max(funnel.targetContacts, 1)) * 100)}%`,
              }}
            />
          </span>
          <span>
            {funnel.onPace
              ? `On pace · ${funnel.contacted} contacted · ${funnel.replied} replied`
              : `Behind pace · ${funnel.contacted} contacted, ~${funnel.expectedByNow} by now keeps you on track`}
          </span>
        </div>
      )}

      <span className="brandstat">
        <i aria-hidden="true" />
        <b>{live}</b> live
        {changed > 0 && (
          <>
            {" · "}
            <b>{changed}</b> changed
          </>
        )}
      </span>

      {/* The door to the full read: rates between the stages, and what
          they suggest doing differently. */}
      {onInsights && (
        <button className="railstatus-insights" onClick={onInsights}>
          How it&apos;s going →
        </button>
      )}
    </div>
  );
}
