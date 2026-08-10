/**
 * Fuzzy matching for things you half-remember.
 *
 * A hunt's board holds places you know by fragments: "ludlow", "the one in
 * bushwick", "35th". Exact search fails all three the moment you misplace a
 * word or a number, and an apartment you can't find on your own board is an
 * apartment you stop working.
 *
 * Two matchers, in order of confidence. A substring hit is unambiguous and
 * scores highest, better the earlier and the more word-initial it is. Failing
 * that, the query's letters have to appear in order — "38lud" finds "38
 * Ludlow Street" — with runs of adjacent letters worth more than scattered
 * ones, because scattered letters are usually coincidence.
 *
 * Scores are only ever compared against each other, so the scale is
 * arbitrary; what matters is that a real match always outranks a lucky one.
 */

const START_BONUS = 12;
const RUN_BONUS = 6;

/** Higher is better. Null means no match at all. */
export function fuzzyScore(text: string, query: string): number | null {
  const hay = text.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return null;
  if (!hay) return null;

  // 1 — the whole query, verbatim.
  const at = hay.indexOf(needle);
  if (at >= 0) {
    const wordStart = at === 0 || /[\s,#-]/.test(hay[at - 1]);
    return 1000 - at + (wordStart ? START_BONUS * 4 : 0) + needle.length * 2;
  }

  // 2 — every letter, in order, gaps allowed.
  let score = 0;
  let cursor = 0;
  let run = 0;
  for (const ch of needle) {
    // Spaces in the query are joins, not letters: "38 lud" should find
    // "38 Ludlow" the same as "38lud" does.
    if (ch === " ") {
      run = 0;
      continue;
    }
    const found = hay.indexOf(ch, cursor);
    if (found < 0) return null;
    const wordStart = found === 0 || /[\s,#-]/.test(hay[found - 1]);
    if (wordStart) score += START_BONUS;
    if (found === cursor) {
      run += 1;
      score += RUN_BONUS * Math.min(run, 4);
    } else {
      run = 0;
    }
    score += Math.max(0, 8 - (found - cursor));
    cursor = found + 1;
  }
  return score;
}

/**
 * The best score across several fields, weighted: an address hit beats the
 * same letters buried in a note, because that's what people mean.
 */
export function fuzzyBest(
  fields: { text: string; weight?: number }[],
  query: string
): number | null {
  let best: number | null = null;
  for (const field of fields) {
    const score = fuzzyScore(field.text, query);
    if (score == null) continue;
    const weighted = score * (field.weight ?? 1);
    if (best == null || weighted > best) best = weighted;
  }
  return best;
}
