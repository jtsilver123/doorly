"use client";

import type { FeedListing } from "@/types";
import { STAGE_LABEL } from "@/types";
import { CONTACT_LABEL } from "@/lib/outreach";

/**
 * Decision night.
 *
 * The journey's last mile: you've toured two or three places, a hold expires in
 * the morning, and the comparison is happening in browser tabs and memory —
 * which one had the broker fee? which was the fourth-floor walk-up? This puts
 * the finalists side by side on the numbers that decide it, with the best value
 * in each row marked, so the trade you're making is visible instead of felt.
 *
 * Finalists = starred, or anywhere in the active pipeline. No separate
 * "add to compare" step — the shortlist you already built is the comparison.
 */

const money = (n: number) => `$${n.toLocaleString()}`;

type Row = {
  label: string;
  value: (l: FeedListing) => string;
  /** Numeric extract for best-in-row marking; higher-is-better via `invert`. */
  num?: (l: FeedListing) => number | null;
  invert?: boolean;
};

const ROWS: Row[] = [
  { label: "Rent", value: (l) => money(l.price), num: (l) => l.price },
  {
    label: "Effective rent",
    value: (l) =>
      l.effectiveRent < l.price ? `${money(l.effectiveRent)}/mo` : "—",
    num: (l) => (l.effectiveRent < l.price ? l.effectiveRent : null),
  },
  { label: "Cash to move in", value: (l) => money(l.upfrontCost), num: (l) => l.upfrontCost },
  { label: "All-in monthly", value: (l) => money(l.allInMonthly), num: (l) => l.allInMonthly },
  {
    label: "$/sqft",
    value: (l) => (l.sqft ? `$${(l.price / l.sqft).toFixed(1)}` : "unknown"),
    num: (l) => (l.sqft ? l.price / l.sqft : null),
  },
  {
    label: "Size",
    value: (l) =>
      `${l.bedrooms === 0 ? "Studio" : `${l.bedrooms}bd`}/${l.bathrooms}ba${l.sqft ? ` · ${l.sqft}ft²` : ""}`,
    num: (l) => l.sqft,
    invert: true,
  },
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
    label: "Ready for your date",
    value: (l) =>
      l.timing === "ready" ? "yes" : l.timing === "unknown" ? "unlisted" : l.timingLabel,
  },
  { label: "Days listed", value: (l) => `${l.daysOnMarket}d`, num: (l) => l.daysOnMarket },
  {
    label: "Status",
    value: (l) =>
      `${STAGE_LABEL[l.stage]}${
        l.lastContactChannel ? ` · ${CONTACT_LABEL[l.lastContactChannel].toLowerCase()}` : ""
      }`,
  },
  { label: "Fit score", value: (l) => `${l.score ?? "—"}%`, num: (l) => l.score, invert: true },
];

export default function Compare({
  listings,
  onOpen,
}: {
  listings: FeedListing[];
  onOpen: (l: FeedListing) => void;
}) {
  const finalists = listings
    .filter((l) => l.starred || !["inbox", "passed", "closed"].includes(l.stage))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5);

  if (finalists.length < 2) {
    return (
      <div className="surface" style={{ padding: 24 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Nothing to compare yet</div>
        <div className="muted" style={{ fontSize: 13 }}>
          Star a couple of places or move them along the pipeline, and they line
          up here side by side — rent, real cost, and how each stacks up against
          the market — for the night you have to choose.
        </div>
      </div>
    );
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
    <div className="surface" style={{ overflowX: "auto" }}>
      <table className="compare">
        <thead>
          <tr>
            <th />
            {finalists.map((l) => (
              <th key={l.id}>
                <button className="compare-head" onClick={() => onOpen(l)}>
                  <span style={{ fontWeight: 600 }}>
                    {l.address}
                    {l.unit ? ` #${l.unit}` : ""}
                  </span>
                  <span className="muted">{l.neighborhood}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const best = bestIn(row);
            return (
              <tr key={row.label}>
                <td className="muted compare-label">{row.label}</td>
                {finalists.map((l, i) => (
                  <td key={l.id} className={i === best ? "compare-best" : ""}>
                    {row.value(l)}
                    {i === best && <span className="compare-tick"> ✓</span>}
                  </td>
                ))}
              </tr>
            );
          })}
          <tr>
            <td className="muted compare-label">Your notes</td>
            {finalists.map((l) => (
              <td key={l.id} className="muted" style={{ fontSize: 12, maxWidth: 180 }}>
                {l.notes || "—"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
