/**
 * The delist circuit breaker, as a pure decision.
 *
 * Extracted from the ingest pipeline so the one rule that can empty a
 * pipeline is unit-tested rather than trusted. History: a source that
 * returned its first page and then rate-limited reported "ok", and the
 * sweep delisted everything on its deeper pages — half the corpus flapped
 * off- and back-on-market four times in one afternoon, and the user's
 * board emptied mid-hunt.
 *
 * The rule: real markets don't shed a quarter of their inventory between
 * two polls. A source whose sweep would delist more than MAX_GONE_SHARE of
 * its active rows (and more than MIN_GONE_COUNT of them, so tiny sources
 * can still turn over honestly) is reporting a partial fetch, not a market
 * move — its sweep is skipped and the skip is logged.
 */

export const MAX_GONE_SHARE = 0.25;
export const MIN_GONE_COUNT = 10;

export interface SweepSkip {
  source: string;
  gone: number;
  active: number;
}

export function sweepPlan(rows: { source: string; gone: boolean }[]): {
  sweepable: Set<string>;
  skipped: SweepSkip[];
} {
  const active = new Map<string, number>();
  const gone = new Map<string, number>();
  for (const row of rows) {
    active.set(row.source, (active.get(row.source) ?? 0) + 1);
    if (row.gone) gone.set(row.source, (gone.get(row.source) ?? 0) + 1);
  }

  const sweepable = new Set<string>();
  const skipped: SweepSkip[] = [];
  for (const [source, total] of active) {
    const missing = gone.get(source) ?? 0;
    if (missing > MIN_GONE_COUNT && missing / total > MAX_GONE_SHARE) {
      skipped.push({ source, gone: missing, active: total });
      continue;
    }
    sweepable.add(source);
  }
  return { sweepable, skipped };
}
