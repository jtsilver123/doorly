import type { FeedListing } from "@/types";
import { countSteps, type FunnelSteps } from "@/lib/insights";

/**
 * The hunt, told back to you on the day it ends.
 *
 * Everything else in this app is forward-looking: what to do next, who hasn't
 * answered, which deadline is closest. This is the one read that only makes
 * sense in the past tense. A New York apartment hunt is weeks of rejection
 * with one good day at the end, and the good day tends to arrive as a text
 * message and then nothing. The numbers were being kept the whole time; they
 * may as well add up to something.
 *
 * Every figure here is derived from rows the person created themselves, and
 * anything that can't be honestly computed comes back null rather than
 * guessed. A made-up statistic in a victory screen is worse than no statistic.
 */

export interface HuntStory {
  /** The place that ended it. */
  won: FeedListing;
  steps: FunnelSteps;
  /** Days from the first place entering the pipeline to today. Null if unknown. */
  days: number | null;
  /** Outbound messages logged across every place. */
  messages: number;
  /** Neighborhoods the hunt touched, most-visited first. */
  areas: string[];
  /**
   * The winner's rent against the average of everywhere else toured. Negative
   * means the place they took was the cheaper one. Null until two tours exist,
   * because "cheaper than the one other place you saw" is not a finding.
   */
  vsToured: number | null;
  /** How the rent compares to genuinely similar listings, when known. */
  vsMarket: number | null;
  /** Places passed on, which is most of the work nobody remembers doing. */
  passed: number;
}

const TRACKED = (l: FeedListing) =>
  l.starred || (l.stage !== "inbox" && l.stage !== "passed");

const TOURED_STAGES = ["toured", "applied", "closed", "no_go"];

export function huntStory(
  listings: FeedListing[],
  won: FeedListing,
  now = new Date()
): HuntStory {
  const tracked = listings.filter(TRACKED);
  const steps = countSteps(listings, now);

  /*
   * When the hunt started: the earliest moment a place became yours, not the
   * earliest a listing was posted. A stage move is the first thing a person
   * does deliberately, so it dates the decision to start hunting; anything
   * that never moved falls back to when it was first seen.
   */
  const starts = tracked
    .map((l) => l.stageChangedAt ?? l.firstSeenAt)
    .filter((iso): iso is string => Boolean(iso))
    .map((iso) => new Date(iso).getTime())
    .filter((ms) => Number.isFinite(ms));
  const days = starts.length
    ? Math.max(1, Math.round((now.getTime() - Math.min(...starts)) / 86_400_000))
    : null;

  const messages = tracked.reduce((sum, l) => sum + (l.contactCount || 0), 0);

  const counts = new Map<string, number>();
  for (const l of tracked) {
    if (!l.neighborhood) continue;
    counts.set(l.neighborhood, (counts.get(l.neighborhood) ?? 0) + 1);
  }
  const areas = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const otherToured = tracked.filter(
    (l) =>
      l.id !== won.id &&
      (TOURED_STAGES.includes(l.stage) ||
        (l.stage === "tour" && l.tourAt != null && new Date(l.tourAt) < now)) &&
      l.price > 0
  );
  const vsToured =
    otherToured.length >= 2
      ? won.price -
        Math.round(otherToured.reduce((sum, l) => sum + l.price, 0) / otherToured.length)
      : null;

  const vsMarket = won.dealVerdict === "unknown" ? null : won.dealDelta;

  const passed = listings.filter(
    (l) => l.stage === "passed" || l.stage === "no_go" || l.passedAt != null
  ).length;

  return { won, steps, days, messages, areas, vsToured, vsMarket, passed };
}
