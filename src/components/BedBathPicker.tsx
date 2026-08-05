"use client";

/**
 * Beds and baths, as a range you paint.
 *
 * The old control was eight preset chips — "1B1B", "2B2B", "Studio–1B" — a
 * vocabulary you had to learn before you could say what you wanted, and one
 * that couldn't say "studio through 2 bed" at all. Every listing site
 * converges on the same pattern for good reason: a segmented row where one
 * tap picks a size and a second tap stretches it into a range.
 *
 *   tap 2          → exactly 2 bed
 *   then tap Studio → studio through 2 bed
 *   tap 4+          → four or more
 *   tap Any         → no opinion
 *
 * Bathrooms stay single-select minimums — nobody hunts for "at most 1.5
 * baths".
 */

const BEDS: { value: number; label: string }[] = [
  { value: 0, label: "Studio" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4+" },
];

const BATHS: { value: number; label: string }[] = [
  { value: 0, label: "Any" },
  { value: 1, label: "1+" },
  { value: 1.5, label: "1.5+" },
  { value: 2, label: "2+" },
  { value: 3, label: "3+" },
];

export interface BedBathValue {
  bedMin: number;
  /** Null means "no ceiling" — Any, or an open-ended 4+. */
  bedMax: number | null;
  bathMin: number;
}

/** How the current selection reads back, for summaries. */
export function bedBathLabel({ bedMin, bedMax, bathMin }: BedBathValue): string {
  const name = (n: number) => (n === 0 ? "studio" : `${n} bed`);
  let beds: string;
  if (bedMin === 0 && bedMax == null) beds = "any size";
  else if (bedMax == null) beds = `${name(bedMin)} or more`;
  else if (bedMin === bedMax) beds = name(bedMin);
  else beds = `${name(bedMin)}–${name(bedMax)}`;
  return bathMin > 0 ? `${beds} · ${bathMin}+ bath` : beds;
}

export default function BedBathPicker({
  value,
  onChange,
}: {
  value: BedBathValue;
  onChange: (next: BedBathValue) => void;
}) {
  const { bedMin, bedMax, bathMin } = value;
  const isAny = bedMin === 0 && bedMax == null;

  function tapBed(n: number) {
    // 4+ is open-ended by construction.
    const asMax = n === 4 ? null : n;

    if (isAny) {
      onChange({ ...value, bedMin: n, bedMax: asMax });
      return;
    }
    // A single selection stretches into a range on the second tap…
    if (bedMin === bedMax || (bedMax == null && bedMin === 4)) {
      if (n === bedMin) {
        // …unless it's the same segment, which clears back to Any.
        onChange({ ...value, bedMin: 0, bedMax: null });
        return;
      }
      const lo = Math.min(bedMin, n);
      const hi = Math.max(bedMin, n);
      onChange({ ...value, bedMin: lo, bedMax: hi === 4 ? null : hi });
      return;
    }
    // A range starts over from the new tap.
    onChange({ ...value, bedMin: n, bedMax: asMax });
  }

  function inRange(n: number): boolean {
    if (isAny) return false;
    if (bedMax == null) return n >= bedMin;
    return n >= bedMin && n <= bedMax;
  }

  return (
    <div className="bedbath">
      <div className="bedbath-group">
        <span className="bedbath-label">
          Bedrooms
          <i>{isAny ? "tap one, tap another for a range" : bedBathLabel({ ...value, bathMin: 0 })}</i>
        </span>
        <div className="seg" role="group" aria-label="Bedrooms">
          <button
            type="button"
            className={isAny ? "is-on" : undefined}
            aria-pressed={isAny}
            onClick={() => onChange({ ...value, bedMin: 0, bedMax: null })}
          >
            Any
          </button>
          {BEDS.map((bed) => (
            <button
              key={bed.value}
              type="button"
              className={inRange(bed.value) ? "is-on" : undefined}
              aria-pressed={inRange(bed.value)}
              onClick={() => tapBed(bed.value)}
            >
              {bed.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bedbath-group">
        <span className="bedbath-label">Bathrooms</span>
        <div className="seg" role="group" aria-label="Bathrooms">
          {BATHS.map((bath) => (
            <button
              key={bath.value}
              type="button"
              className={bathMin === bath.value ? "is-on" : undefined}
              aria-pressed={bathMin === bath.value}
              onClick={() => onChange({ ...value, bathMin: bath.value })}
            >
              {bath.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
