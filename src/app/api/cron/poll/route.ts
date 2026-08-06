import { NextResponse } from "next/server";
import { ingest } from "@/lib/ingest";
import { loadAllActiveSearches } from "@/lib/feed";
import {
  loadConfigFor,
  nextCheckDue,
  storedKeyFor,
  withConfig,
  keyHint,
} from "@/lib/apikey";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled poll. Separate from /api/refresh so the cron path can always demand
 * the shared secret, while the in-app refresh button stays friction-free.
 *
 * One tick, many spenders — each on their own account. The first version
 * pooled every account's searches into one ingest and paid for all of it with
 * "the most recently updated" key, which meant whoever pasted a key last was
 * silently billed for the whole userbase. Now the tick walks users one at a
 * time: their searches, their key, their cadence. A user with no key of their
 * own is skipped — no free-riding on someone else's budget — but every pull
 * still lands in the shared listings corpus, so freshness is communal even
 * though spending never is.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace("Bearer ", "");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    // No session here, so gather every account's searches with the service role.
    const searches = await loadAllActiveSearches();
    if (!searches.length) {
      return NextResponse.json({ message: "no active searches", fetched: 0 });
    }

    const byUser = new Map<string, typeof searches>();
    for (const search of searches) {
      if (!search.userId) continue;
      byUser.set(search.userId, [...(byUser.get(search.userId) ?? []), search]);
    }

    const runs: Record<string, unknown>[] = [];
    for (const [userId, theirSearches] of byUser) {
      const config = await loadConfigFor(userId);
      // Their own saved key only. The env fallback exists for the app's own
      // requests, not as a communal pool an hourly cron may drain.
      const ownKey = await storedKeyFor(userId);
      if (!ownKey) {
        runs.push({ user: userId, skipped: "no key of their own" });
        continue;
      }

      const { due, lastAt, intervalHours } = await nextCheckDue(userId);
      if (!due) {
        runs.push({
          user: userId,
          skipped: intervalHours
            ? `due ${intervalHours}h after ${lastAt ?? "never"}`
            : "automatic checks off",
        });
        continue;
      }

      try {
        const result = await withConfig({ ...config, realtyApiKey: ownKey }, () =>
          ingest(theirSearches, { userId })
        );
        runs.push({
          user: userId,
          key: keyHint(ownKey),
          fetched: result.fetched,
          newListings: result.newListings,
          errors: result.errors.slice(0, 3),
        });
      } catch (err) {
        runs.push({
          user: userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ users: byUser.size, runs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "poll failed" },
      { status: 500 }
    );
  }
}
