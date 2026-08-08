/**
 * Defensive coercion for third-party payloads.
 *
 * These APIs are not consistent about types. Zillow returns a rent as a plain
 * number in one result and as `{ value: 4995, pricePerSquareFoot: 8 }` in the
 * next; Craigslist gives "$3,295". Feeding either straight into Math.round
 * produces NaN, and NaN is uniquely dangerous here because every comparison
 * against it is false — so a NaN price slips through min/max bounds checks
 * instead of being rejected by them.
 */

/** Extract a finite number from a number, numeric string, or {value} wrapper. */
export function toNum(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  if (typeof input === "string") {
    const digits = input.replace(/[^0-9.\-]/g, "");
    if (!digits) return null;
    const parsed = Number.parseFloat(digits);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of ["value", "amount", "price", "min", "low"]) {
      if (key in record) {
        const nested = toNum(record[key]);
        if (nested != null) return nested;
      }
    }
  }
  return null;
}

/** A monthly rent we're willing to believe. Returns null for anything else. */
export function toPrice(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const value = toNum(candidate);
    if (value != null && value >= 100 && value <= 1_000_000) {
      return Math.round(value);
    }
  }
  return null;
}

/**
 * The address without its trailing unit clause. Some stored rows carry
 * "99 Suffolk St #2B" as the address AND "2B" as the unit — written before
 * the intake learned to split them — and every renderer that prints
 * "address #unit" would say the unit twice. Reading strips it once, so old
 * rows and new agree.
 */
export function addressSansUnit(address: string, unit: string | null): string {
  if (!unit) return address;
  const safe = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleaned = address
    .replace(new RegExp(`\\s*(?:#|Apt\\.?|Unit)\\s*${safe}\\s*$`, "i"), "")
    .trim();
  return cleaned || address;
}
