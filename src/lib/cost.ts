import type { FeedListing } from "@/types";

/**
 * What it actually costs to get the keys.
 *
 * Comparing apartments on monthly rent is misleading, because the number that
 * decides whether you can take a place is the cheque you write on day one. A
 * $3,300 listing with a one-month broker fee costs more up front than a $3,500
 * no-fee listing, and it is the more expensive apartment for the first four
 * months — but every listing site sorts by the monthly figure, so the cheaper
 * one *looks* better right up until you're asked for the money.
 *
 * Everything here is configurable rather than asserted, because the rules move:
 * New York caps security deposits at one month's rent and application fees at
 * $20, and NYC's FARE Act shifted broker fees to whoever hired the broker — so
 * the sensible default for a tenant-paid broker fee is now zero, with the field
 * left adjustable for the listings that still charge one.
 */

export interface CostAssumptions {
  /** Months of rent held as deposit. New York caps this at 1. */
  depositMonths: number;
  /** Months of rent taken as a tenant-paid broker fee, when one applies. */
  brokerFeeMonths: number;
  /** Flat application fee. New York caps this at $20. */
  applicationFee: number;
  /** Months of rent due at signing (first month, sometimes first and last). */
  prepaidMonths: number;
}

export const DEFAULT_COSTS: CostAssumptions = {
  depositMonths: 1,
  brokerFeeMonths: 0,
  applicationFee: 20,
  prepaidMonths: 1,
};

export interface CostLine {
  label: string;
  amount: number;
}

export interface MoveInCost {
  total: number;
  lines: CostLine[];
  /** Total spread over a 12-month lease — the true monthly cost. */
  effectiveMonthly: number;
}

/**
 * Rent after concessions.
 *
 * "$3,800, two months free on a 14-month lease" is really $3,257 a month, and
 * that is the figure worth comparing — but it never appears in a search filter,
 * so genuinely affordable apartments hide above your price ceiling while you
 * scroll past them.
 *
 * Prefer the source's own net figure when it publishes one; otherwise spread
 * the free months across the lease term.
 */
export function effectiveRent(listing: {
  price: number;
  monthsFree?: number;
  leaseMonths?: number;
  netEffectiveRent?: number | null;
}): number {
  if (listing.netEffectiveRent && listing.netEffectiveRent > 0) {
    return Math.round(listing.netEffectiveRent);
  }
  const free = listing.monthsFree ?? 0;
  const term = listing.leaseMonths && listing.leaseMonths > 0 ? listing.leaseMonths : 12;
  if (free <= 0 || free >= term) return listing.price;
  return Math.round((listing.price * (term - free)) / term);
}

/**
 * The all-in monthly: concession-adjusted rent plus the one-off costs spread
 * over the lease. The deposit is excluded because you get it back — it's a cash
 * flow problem, not a cost.
 */
export function allInMonthly(
  listing: {
    price: number;
    noFee: boolean;
    monthsFree?: number;
    leaseMonths?: number;
    netEffectiveRent?: number | null;
  },
  assumptions: CostAssumptions = DEFAULT_COSTS
): number {
  const rent = effectiveRent(listing);
  const term = listing.leaseMonths && listing.leaseMonths > 0 ? listing.leaseMonths : 12;
  const fees =
    (!listing.noFee ? listing.price * assumptions.brokerFeeMonths : 0) +
    assumptions.applicationFee;
  return Math.round(rent + fees / term);
}

export function moveInCost(
  listing: Pick<FeedListing, "price" | "noFee">,
  assumptions: CostAssumptions = DEFAULT_COSTS
): MoveInCost {
  const rent = listing.price;
  const lines: CostLine[] = [];

  if (assumptions.prepaidMonths > 0) {
    lines.push({
      label: assumptions.prepaidMonths === 1 ? "First month" : `${assumptions.prepaidMonths} months up front`,
      amount: rent * assumptions.prepaidMonths,
    });
  }
  if (assumptions.depositMonths > 0) {
    lines.push({ label: "Security deposit", amount: rent * assumptions.depositMonths });
  }
  // A "no fee" listing is exactly the one where this line disappears.
  if (!listing.noFee && assumptions.brokerFeeMonths > 0) {
    lines.push({
      label: "Broker fee",
      amount: Math.round(rent * assumptions.brokerFeeMonths),
    });
  }
  if (assumptions.applicationFee > 0) {
    lines.push({ label: "Application fee", amount: assumptions.applicationFee });
  }

  const total = lines.reduce((sum, line) => sum + line.amount, 0);

  // The deposit comes back, so it isn't a true cost — only the fees and the
  // rent itself are money you never see again.
  const sunk = total - rent * assumptions.depositMonths;

  return {
    total,
    lines,
    effectiveMonthly: Math.round(sunk / 12 + rent - rent / 12),
  };
}

/**
 * Can you actually be in it by your move-in date?
 *
 * Listings that came free months ago have usually been passed over for a
 * reason, and ones that free up long after your date mean paying double rent
 * or moving twice. Both are worth seeing before you fall in love with a photo.
 */
export type Timing = "ready" | "soon" | "late" | "stale" | "unknown";

export interface TimingFit {
  timing: Timing;
  label: string;
  daysFromTarget: number | null;
}

export function moveInFit(
  availableAt: string | null,
  targetDate: string,
  now = new Date()
): TimingFit {
  if (!availableAt || !targetDate) {
    return { timing: "unknown", label: "", daysFromTarget: null };
  }
  const available = new Date(`${availableAt.slice(0, 10)}T12:00:00Z`);
  const target = new Date(`${targetDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(available.getTime()) || Number.isNaN(target.getTime())) {
    return { timing: "unknown", label: "", daysFromTarget: null };
  }

  const days = Math.round((available.getTime() - target.getTime()) / 86_400_000);
  const availableForDays = Math.round((now.getTime() - available.getTime()) / 86_400_000);

  // Free for over two months already: something is keeping it on the market.
  if (availableForDays > 60) {
    return { timing: "stale", label: `vacant ${Math.round(availableForDays / 30)}mo`, daysFromTarget: days };
  }
  if (days > 21) {
    return { timing: "late", label: `free ${days}d after you need it`, daysFromTarget: days };
  }
  if (days > 0) {
    return { timing: "soon", label: `free ${days}d late`, daysFromTarget: days };
  }
  return { timing: "ready", label: "ready for your date", daysFromTarget: days };
}

/** Days until the move-in date. Negative once it's passed. */
export function daysUntil(target: string, now = new Date()): number {
  if (!target) return 0;
  const date = new Date(`${target.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}
