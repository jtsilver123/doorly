/**
 * Reading a place's past rents.
 *
 * The listing tells you what they want now; the history tells you how this
 * landlord behaves — what the place actually listed for over the years,
 * how hard the rent climbs, and whether today's ask is a step or a leap.
 * That's negotiation material: "it listed at $2,850 fourteen months ago"
 * is a better opening than any feeling about the market.
 *
 * The raw feed mixes rental and sale events, so the first job is telling
 * them apart. Price is the honest signal: NYC rents live in the hundreds
 * to low tens of thousands, sale prices start six figures. Event names
 * help when present, but they vary by source year and aren't trusted alone.
 */

export interface RentEvent {
  date: string;
  price: number;
  event: string;
  /** The source's own rental-vs-sale word; absent on older cached rows. */
  rental?: boolean;
}

export interface RentPast {
  /** Rental events only, oldest first, consecutive duplicates folded. */
  rents: RentEvent[];
  /** Years between the earliest and latest rental asks, when > 0. */
  yearsSpanned: number | null;
  /** Compound annual growth of the rental ask across that span. */
  annualPct: number | null;
  /** Today's ask against the most recent past listing cycle. */
  vsPast: { pct: number; price: number; year: number } | null;
}

const RENT_MIN = 400;
const RENT_MAX = 45_000;
const SALE_WORDS = /sold|sale|foreclos|deed/i;

export function readRentPast(raw: RentEvent[], askingNow: number): RentPast {
  const rents = raw
    .filter(
      (e) =>
        e.rental !== false &&
        e.price >= RENT_MIN &&
        e.price <= RENT_MAX &&
        !SALE_WORDS.test(e.event) &&
        !Number.isNaN(new Date(e.date).getTime())
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    // The same ask restated (relist, small correction) is one fact, not two.
    .filter((e, i, list) => i === 0 || e.price !== list[i - 1].price);

  if (rents.length === 0) {
    return { rents, yearsSpanned: null, annualPct: null, vsPast: null };
  }

  const first = rents[0];
  const last = rents[rents.length - 1];
  const years =
    (new Date(last.date).getTime() - new Date(first.date).getTime()) /
    (365.25 * 86_400_000);

  /*
   * Under a year of history, an "annual" rate is an extrapolation wearing a
   * percent sign; the span has to earn the unit before we print it.
   */
  let annualPct: number | null = null;
  if (years >= 1 && first.price > 0 && last.price !== first.price) {
    annualPct = (Math.pow(last.price / first.price, 1 / years) - 1) * 100;
  }

  /*
   * "Versus its past": today's ask against the most recent listing cycle
   * that isn't just this listing being posted. Nine months of distance
   * separates a prior tenancy from a price tweak on the current ad.
   */
  const cutoff = Date.now() - 270 * 86_400_000;
  const prior = [...rents].reverse().find((e) => new Date(e.date).getTime() < cutoff);
  let vsPast: RentPast["vsPast"] = null;
  if (prior && askingNow > 0) {
    vsPast = {
      pct: ((askingNow - prior.price) / prior.price) * 100,
      price: prior.price,
      year: new Date(prior.date).getUTCFullYear(),
    };
  }

  return {
    rents,
    yearsSpanned: years > 0 ? years : null,
    annualPct,
    vsPast,
  };
}
