"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Estimate } from "@/lib/estimate";

/**
 * The pitch, run as a calculation.
 *
 * Everything else on this page is a claim. This is the claim being performed:
 * pick three neighborhoods and a move-in date, and the page tells you how many
 * messages, how many viewings, how many weeks and how much cash — off the same
 * live corpus every search inside the app reads.
 *
 * That's the whole argument in one object. An apartment hunt feels like luck
 * because nobody ever states its shape; stating it is the product. And the
 * most useful thing it can say is the uncomfortable one — that the date
 * someone already committed to is sooner than the search normally takes.
 */

/**
 * The neighborhoods the corpus has real depth in, most-searched first.
 *
 * Order is the whole design of this control: the first three chips are what
 * most people were going to pick anyway, so the common case is one tap rather
 * than a hunt through a list. Anything with too little live inventory to
 * produce an honest median is left off entirely — a chip that returns "not
 * enough listings" is worse than no chip.
 */
const AREAS = [
  "East Village",
  "West Village",
  "Williamsburg",
  "Lower East Side",
  "Chelsea",
  "Gramercy",
  "Murray Hill",
  "Financial District",
  "Bushwick",
];

const BEDS = [
  { value: 0, label: "Studio" },
  { value: 1, label: "1 bed" },
  { value: 2, label: "2 bed" },
  { value: 3, label: "3 bed" },
];

/**
 * The first of next month.
 *
 * Which is when leases actually start — nobody moves in on the 14th — so a
 * date picked by adding N days to today produces a number the reader has to
 * mentally correct before the estimate below it means anything.
 */
function defaultMoveIn(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  // Built from local parts: toISOString would shift to UTC and hand back the
  // last day of *this* month for anyone west of Greenwich.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function HuntEstimator({ cta, ctaLabel }: { cta: string; ctaLabel: string }) {
  const [areas, setAreas] = useState<string[]>(["East Village", "Williamsburg"]);
  const [beds, setBeds] = useState(1);
  const [moveIn, setMoveIn] = useState(defaultMoveIn);
  const [result, setResult] = useState<(Estimate & { sample: number }) | null>(null);
  const [loading, setLoading] = useState(true);

  /*
   * Debounced, and every in-flight request is abandoned when the inputs
   * change again — tapping four neighborhoods in a row would otherwise race
   * four responses and settle on whichever returned last, not whichever was
   * asked last.
   */
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          areas: areas.join(","),
          beds: String(beds),
          moveIn,
        });
        const res = await fetch(`/api/estimate?${params}`, { signal: controller.signal });
        const body = await res.json();
        if (!body.error) setResult(body);
      } catch {
        // Aborted, or the network blinked. The last good answer stays on
        // screen rather than flashing an error into the hero.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [areas, beds, moveIn]);

  const toggle = (area: string) =>
    setAreas((list) =>
      list.includes(area) ? list.filter((a) => a !== area) : [...list, area].slice(-4)
    );

  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const daysAway = Math.max(
    0,
    Math.round((new Date(moveIn).getTime() - Date.now()) / 86_400_000)
  );

  return (
    <aside className="estimator" aria-label="Estimate your hunt">
      <p className="overline">Your hunt, in numbers</p>

      {/* Chip groups, not form controls: `label` with no control to point at
          is a dangling label to a screen reader, so each group names itself
          with a span the group is labelled by. */}
      <div className="estimator-field">
        <span className="estimator-label" id="est-where">
          Where
        </span>
        <div className="estimator-chips" role="group" aria-labelledby="est-where">
          {AREAS.map((area) => (
            <button
              key={area}
              type="button"
              className="pill"
              data-on={areas.includes(area) ? "true" : undefined}
              aria-pressed={areas.includes(area)}
              onClick={() => toggle(area)}
            >
              {area}
            </button>
          ))}
        </div>
      </div>

      <div className="estimator-row">
        <div className="estimator-field">
          <span className="estimator-label" id="est-beds">
            Size
          </span>
          <div className="estimator-chips" role="group" aria-labelledby="est-beds">
            {BEDS.map((b) => (
              <button
                key={b.value}
                type="button"
                className="pill"
                data-on={beds === b.value ? "true" : undefined}
                aria-pressed={beds === b.value}
                onClick={() => setBeds(b.value)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="estimator-field">
          <label htmlFor="est-date">Move in by</label>
          <input
            id="est-date"
            type="date"
            className="field estimator-date"
            value={moveIn}
            onChange={(e) => setMoveIn(e.target.value)}
          />
        </div>
      </div>

      <div className="estimator-out" data-loading={loading ? "true" : undefined}>
        {result ? (
          <>
            <p className="estimator-basis">
              {result.medianRent
                ? `Based on ${result.sample} live ${BEDS.find((b) => b.value === beds)?.label.toLowerCase()} listings there, asking a median of ${money(result.medianRent)}.`
                : "Not enough live listings there yet to put a price on it. The counts below still hold."}
            </p>

            <dl className="estimator-nums">
              <div>
                <dt>Agents you&apos;ll message</dt>
                <dd>{result.outreach}</dd>
                <span>to book {result.tours} viewings</span>
              </div>
              <div>
                <dt>Apartments you&apos;ll see</dt>
                <dd>{result.tours}</dd>
                <span>before one is yours</span>
              </div>
              <div>
                <dt>Weeks, first message to keys</dt>
                <dd>{result.weeks}</dd>
                <span>at ~3 viewings a week</span>
              </div>
              <div>
                <dt>Cash due at signing</dt>
                <dd className="estimator-cash">
                  {result.upfrontLow && result.upfrontHigh
                    ? `${money(result.upfrontLow)}–${money(result.upfrontHigh)}`
                    : "—"}
                </dd>
                <span>first month, security, then the broker fee</span>
              </div>
            </dl>

            {/*
              * The uncomfortable line, and the most useful one on the page.
              * Stated as two dates and a subtraction rather than as a verdict,
              * because "you're behind" only lands if the reader can see the
              * arithmetic that produced it.
              */}
            <p className="estimator-verdict" data-tight={result.tight ? "true" : undefined}>
              {result.tight ? (
                <>
                  Your move-in is <b>{daysAway} days</b> away and this usually takes about{" "}
                  <b>{Math.round(result.weeks * 7)} days</b>. You&apos;d be starting{" "}
                  <span className="mark">{Math.abs(result.slackDays)} days behind</span>.
                </>
              ) : (
                <>
                  Your move-in is <b>{daysAway} days</b> away and this usually takes about{" "}
                  <b>{Math.round(result.weeks * 7)} days</b>. That leaves about{" "}
                  <span className="mark">{result.slackDays} days of room</span> to walk away
                  from a bad one.
                </>
              )}
            </p>

            <p className="estimator-fine">
              Estimates, worked out from real inventory. Not a promise.
            </p>
          </>
        ) : (
          <p className="estimator-fine">Working it out…</p>
        )}
      </div>

      <Link className="landing-go estimator-go" href={cta}>
        {ctaLabel}
      </Link>
    </aside>
  );
}
