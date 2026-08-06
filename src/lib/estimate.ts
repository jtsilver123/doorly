/**
 * How long this is going to take.
 *
 * The premise of the whole product is that an apartment hunt is a process with
 * a shape — a number of messages sent, a number of doors walked through, a
 * number of weeks — and that people lose apartments because nobody ever told
 * them the shape. So the landing page states it, out loud, before anyone signs
 * up: here is roughly what you're in for.
 *
 * Everything below is arithmetic over two inputs — how much inventory actually
 * matches you, and how soon you need to be in — and every constant is named
 * and justified rather than tuned until the output looked nice. It's an
 * estimate and the UI says so; what it must not be is invented.
 */

export interface EstimateInput {
  /** Listings in the corpus matching the chosen neighborhoods and bedrooms. */
  matches: number;
  /** Median asking rent across those matches, or null when too few to say. */
  medianRent: number | null;
  /** Days between today and the requested move-in. */
  daysToMoveIn: number;
  neighborhoods: number;
}

export interface Estimate {
  outreach: number;
  tours: number;
  weeks: number;
  /** Cash needed at signing, low and high. */
  upfrontLow: number | null;
  upfrontHigh: number | null;
  medianRent: number | null;
  /** True when the move-in date is sooner than the search usually takes. */
  tight: boolean;
  /** Days of slack — negative means behind before starting. */
  slackDays: number;
}

/*
 * The constants.
 *
 * Reply rate: roughly two in five inquiries to a NYC listing get a human
 * response — the rest are stale posts, bait, or agents who've already filled
 * it. Of the replies, most but not all become a viewing you actually attend.
 * Together that's about four messages per tour, which is why the outreach
 * number always looks alarming and why sending them one at a time by hand is
 * the thing that loses people apartments.
 */
const MESSAGES_PER_TOUR = 4;

/**
 * Applications don't convert one-for-one: some places go to someone who
 * applied an hour earlier, some fall over at the income check. Two-ish
 * serious attempts is the normal cost of one signed lease.
 */
const TOURS_BASE = 9;

/** What a determined person actually manages in a week around a job. */
const TOURS_PER_WEEK = 3;

/** Board approval, credit checks, guarantor paperwork, lease signing. */
const CLOSING_WEEKS = 1.5;

/**
 * Cash at signing, in months of rent.
 *
 * Low is the no-fee case: first month plus one month's security. High adds a
 * broker fee at the usual 15% of the annual rent, which is 1.8 months — the
 * single most under-anticipated number in a New York apartment hunt.
 */
const UPFRONT_LOW_MONTHS = 2;
const UPFRONT_HIGH_MONTHS = 2 + 1.8;

/**
 * How much the tour count moves with supply.
 *
 * Thin inventory means more of what you see is wrong for you and more of it is
 * gone before you get there. This is bounded hard in both directions: the
 * corpus is a sample of the market, not the market, so it's allowed to nudge
 * the estimate and not to drive it.
 */
function supplyFactor(matches: number, neighborhoods: number): number {
  const perArea = matches / Math.max(1, neighborhoods);
  if (perArea >= 40) return 0.75;
  if (perArea >= 20) return 0.9;
  if (perArea >= 8) return 1;
  if (perArea >= 3) return 1.2;
  return 1.4;
}

export function estimateHunt(input: EstimateInput): Estimate {
  const factor = supplyFactor(input.matches, input.neighborhoods);
  const tours = Math.max(3, Math.round(TOURS_BASE * factor));
  const outreach = Math.round(tours * MESSAGES_PER_TOUR);
  const weeks = Math.max(
    2,
    Math.round((tours / TOURS_PER_WEEK + CLOSING_WEEKS) * 2) / 2
  );

  const rent = input.medianRent;
  const slackDays = Math.round(input.daysToMoveIn - weeks * 7);

  return {
    outreach,
    tours,
    weeks,
    medianRent: rent,
    upfrontLow: rent ? Math.round((rent * UPFRONT_LOW_MONTHS) / 50) * 50 : null,
    upfrontHigh: rent ? Math.round((rent * UPFRONT_HIGH_MONTHS) / 50) * 50 : null,
    // Only flagged when the date is genuinely behind the estimate, not merely
    // close to it — a warning that fires on every input teaches nothing.
    tight: slackDays < 0,
    slackDays,
  };
}

/** The median of a list of prices. Returns null below a usable sample. */
export function medianOf(values: number[], minSample = 5): number | null {
  const sorted = values.filter((n) => n > 0).sort((a, b) => a - b);
  if (sorted.length < minSample) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
