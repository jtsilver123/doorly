/**
 * How long the remaining request budget lasts at a given pace.
 *
 * Lives in its own module, importable from the browser: apikey.ts (where this
 * logically belongs) pulls in the server-side Supabase client via next/headers,
 * and the whole point of this function is that the *client* recomputes it live
 * as the user plays with the schedule dropdown — the estimate's job is to
 * answer "what happens if I check more often?" before saving, not after.
 *
 * Returns null when nothing runs automatically: a manual-only key has no
 * expiry date, it spends only when the button is pressed.
 */
export function runwayDays(
  remaining: number,
  checksPerDay: number,
  perPoll: number
): number | null {
  if (checksPerDay <= 0) return null;
  const perDay = checksPerDay * Math.max(perPoll, 1);
  if (perDay <= 0) return null;
  return Math.max(0, Math.floor(remaining / perDay));
}
