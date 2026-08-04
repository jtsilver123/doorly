import type { FeedListing, Listing } from "@/types";
import { hasStreetNumber } from "@/lib/dedupe";

/**
 * Is this a good price, and is this listing real?
 *
 * These are the two judgments a renter has to make in the fifteen minutes
 * before committing, and neither listing sites nor brokers will help — the
 * sites are paid by the people posting, and a broker's answer is always yes.
 *
 * Both are answerable from the corpus we already hold. Once a few hundred
 * listings are tracked, the median rent for a 1-bed in the East Village is a
 * fact rather than a feeling, and a unit priced 40% under that median is
 * telling you something: either it's the best deal of the month, or it doesn't
 * exist. Bait-and-switch is endemic in New York, and an impossibly cheap
 * listing is its signature.
 *
 * Comparisons are drawn from the tightest set with enough data behind it, and
 * the scope is always stated — "12% under 34 East Village 1-beds" is
 * actionable in a way that a bare "good deal" badge never is.
 */

/** Below this the median is noise, so widen the comparison instead. */
const MIN_COMPS = 5;

export interface MarketStats {
  median: number;
  p25: number;
  p75: number;
  count: number;
  /** Human description of the comparison set, e.g. "East Village 1-beds". */
  scope: string;
}

export type Verdict = "steal" | "good" | "market" | "high" | "unknown";

export interface DealRead {
  verdict: Verdict;
  /** Negative is cheaper than the median. */
  percentVsMedian: number;
  stats: MarketStats | null;
  label: string;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[index];
}

function bedLabel(beds: number): string {
  return beds === 0 ? "studios" : `${beds}-beds`;
}

/**
 * Comparable listings, narrowest first: same neighborhood and bed count, then
 * the borough, then the same bed count anywhere we're tracking.
 */
export function statsFor(
  listing: Pick<Listing, "neighborhood" | "borough" | "bedrooms">,
  corpus: { neighborhood: string; borough: string; bedrooms: number; price: number }[]
): MarketStats | null {
  const sets: { rows: typeof corpus; scope: string }[] = [
    {
      rows: corpus.filter(
        (l) => l.neighborhood === listing.neighborhood && l.bedrooms === listing.bedrooms
      ),
      scope: `${listing.neighborhood} ${bedLabel(listing.bedrooms)}`,
    },
    {
      rows: corpus.filter(
        (l) => l.borough === listing.borough && l.bedrooms === listing.bedrooms
      ),
      scope: `${listing.borough} ${bedLabel(listing.bedrooms)}`,
    },
    {
      rows: corpus.filter((l) => l.bedrooms === listing.bedrooms),
      scope: `all tracked ${bedLabel(listing.bedrooms)}`,
    },
  ];

  for (const set of sets) {
    if (set.rows.length < MIN_COMPS) continue;
    const prices = set.rows.map((l) => l.price).sort((a, b) => a - b);
    return {
      median: percentile(prices, 0.5),
      p25: percentile(prices, 0.25),
      p75: percentile(prices, 0.75),
      count: prices.length,
      scope: set.scope,
    };
  }
  return null;
}

export function readDeal(price: number, stats: MarketStats | null): DealRead {
  if (!stats || !stats.median) {
    return {
      verdict: "unknown",
      percentVsMedian: 0,
      stats,
      label: "Not enough similar listings yet",
    };
  }

  const delta = Math.round(((price - stats.median) / stats.median) * 100);
  const cheaper = Math.abs(delta);

  let verdict: Verdict;
  if (delta <= -20) verdict = "steal";
  else if (delta <= -8) verdict = "good";
  else if (delta <= 10) verdict = "market";
  else verdict = "high";

  const direction = delta < 0 ? "under" : "over";
  const label =
    Math.abs(delta) < 3
      ? `About the going rate for ${stats.scope}`
      : `${cheaper}% ${direction} the median of ${stats.count} ${stats.scope}`;

  return { verdict, percentVsMedian: delta, stats, label };
}

// --- is it real? -----------------------------------------------------------

export type FlagSeverity = "warn" | "info";

export interface Flag {
  kind: string;
  message: string;
  severity: FlagSeverity;
}

/**
 * Signals that a listing deserves scepticism.
 *
 * None of these prove anything on their own — plenty of real apartments have no
 * photos. They're framed as "check this before you spend an evening on it",
 * because the cost of the flag being wrong is a second look, while the cost of
 * missing a bait listing is a wasted trip or, worse, a deposit.
 */
export function flagsFor(listing: FeedListing, deal: DealRead): Flag[] {
  const flags: Flag[] = [];

  // The classic bait pattern: far below anything comparable.
  if (deal.stats && deal.percentVsMedian <= -35) {
    flags.push({
      kind: "too-cheap",
      message: `Priced ${Math.abs(deal.percentVsMedian)}% below similar listings. Sometimes real, often bait — see it in person and never wire a deposit before signing.`,
      severity: "warn",
    });
  }

  if (!listing.imageUrl) {
    flags.push({
      kind: "no-photos",
      message: "No photos published.",
      severity: "info",
    });
  }

  // No street number means we can't tell what building it is — and neither can
  // you, which is exactly how lead-harvesting listings work.
  if (!hasStreetNumber(listing.address)) {
    flags.push({
      kind: "vague-address",
      message: "No street address given, so this can't be matched to a building.",
      severity: "warn",
    });
  }

  if (listing.daysOnMarket > 45 && listing.price >= (deal.stats?.median ?? 0)) {
    flags.push({
      kind: "stale",
      message: `Listed ${listing.daysOnMarket} days at or above market. Room to negotiate, or something's off.`,
      severity: "info",
    });
  }

  if (listing.alsoOn.length >= 3) {
    flags.push({
      kind: "widely-listed",
      message: `Advertised on ${listing.alsoOn.length} sites — likely a broker casting wide rather than an exclusive.`,
      severity: "info",
    });
  }

  return flags;
}

/** Short badge text for the card. Empty when there's nothing worth saying. */
export function dealBadge(deal: DealRead): { text: string; tone: "good" | "warn" | "" } {
  switch (deal.verdict) {
    case "steal":
      return { text: `${Math.abs(deal.percentVsMedian)}% under market`, tone: "good" };
    case "good":
      return { text: `${Math.abs(deal.percentVsMedian)}% under market`, tone: "good" };
    case "high":
      return { text: `${deal.percentVsMedian}% over market`, tone: "warn" };
    default:
      return { text: "", tone: "" };
  }
}
