import { adminDb } from "@/lib/supabase";
import { medianOf } from "@/lib/estimate";

/**
 * What a neighborhood is actually asking, right now.
 *
 * The prose in a guide is written once and ages slowly. The rent does not,
 * and a neighborhood page carrying a number somebody typed in last spring is
 * worse than one carrying none. These come off the live corpus at request
 * time, with the sample size printed beside them, so a reader can tell the
 * difference between a median of forty listings and a median of six.
 *
 * A neighborhood with too few live listings gets null rather than a
 * confident-looking figure computed from three studios.
 */

export interface AreaStats {
  /** Live listings in the corpus for this neighborhood. */
  total: number;
  /** Median asking rent by bedroom count, or null when the sample is thin. */
  byBeds: { beds: number; label: string; median: number | null; sample: number }[];
  /** Share of live listings advertised with no broker fee. */
  noFeePct: number | null;
}

const BEDS: { beds: number; label: string }[] = [
  { beds: 0, label: "Studio" },
  { beds: 1, label: "1 bedroom" },
  { beds: 2, label: "2 bedrooms" },
  { beds: 3, label: "3 bedrooms" },
];

/** Below this a median is a coincidence rather than a market rate. */
const MIN_SAMPLE = 5;

export async function areaStats(neighborhood: string): Promise<AreaStats | null> {
  try {
    const supabase = adminDb();
    const { data, error } = await supabase
      .from("listings")
      .select("price, bedrooms, no_fee")
      .eq("neighborhood", neighborhood)
      .eq("is_active", true)
      .limit(1200);
    if (error) throw new Error(error.message);

    const rows = (data ?? []).filter((r) => Number(r.price) > 0);
    if (rows.length === 0) return null;

    const byBeds = BEDS.map(({ beds, label }) => {
      const prices = rows
        .filter((r) => Number(r.bedrooms) === beds)
        .map((r) => Number(r.price));
      return {
        beds,
        label,
        median: medianOf(prices, MIN_SAMPLE),
        sample: prices.length,
      };
    });

    const withFeeFlag = rows.filter((r) => r.no_fee != null);
    const noFeePct =
      withFeeFlag.length >= 20
        ? Math.round(
            (withFeeFlag.filter((r) => r.no_fee === true).length / withFeeFlag.length) * 100
          )
        : null;

    return { total: rows.length, byBeds, noFeePct };
  } catch {
    // A guide is worth reading without its numbers; it is not worth 500ing
    // over them.
    return null;
  }
}
