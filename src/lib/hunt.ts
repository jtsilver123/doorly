import type { FeedListing } from "@/types";
import type { Profile } from "@/lib/outreach";

/**
 * When the hunt is over.
 *
 * Everything else in this app pushes forward: chase them, book it, decide,
 * you're behind pace. That is the right voice for six weeks and the wrong
 * one on the day after you sign, when the same machinery keeps re-pricing
 * apartments you turned down and telling you a settled move-in date is
 * approaching.
 *
 * Two different facts, deliberately kept apart:
 *
 * `won` is derived, not stored. A secured place is the flag the whole hunt
 * exists to set, so asking the board is always right and can never drift out
 * of sync with a copy of itself.
 *
 * `settled` is a decision. Somebody pressed a button saying put this away.
 * It is what quiets the board, and it is reversible, because leases fall
 * through between the handshake and the keys more often than anyone plans
 * for.
 */

/** The place that ended it, if one has. */
export function wonListing(listings: FeedListing[]): FeedListing | null {
  return listings.find((l) => l.secured) ?? null;
}

/**
 * Has this hunt been put to bed?
 *
 * Only ever true alongside a win: an archived hunt with nothing secured
 * would be a board that went quiet for no stated reason, which is worse
 * than a noisy one.
 */
export function isSettled(profile: Profile, listings: FeedListing[]): boolean {
  return Boolean(profile.huntSettledAt) && wonListing(listings) != null;
}

/**
 * Whether the app should still be driving: watching listings, counting down
 * to a move-in date, telling somebody they are behind pace.
 *
 * Note this goes quiet on a win rather than on the archive. Nobody should
 * have to find a button to stop the app spending their API budget on
 * apartments they have already declined.
 */
export function stillHunting(listings: FeedListing[]): boolean {
  return wonListing(listings) == null;
}
