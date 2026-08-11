import { NextResponse } from "next/server";
import { recheckWatch, WATCH_STAGES } from "@/lib/watch";
import { adminDb } from "@/lib/supabase";
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
 * Scheduled watch tick. Separate from /api/refresh so the cron path can
 * always demand the shared secret, while the in-app button stays
 * friction-free.
 *
 * The crawl this used to run — every saved search re-scraped hourly — is
 * gone: discovery belongs to the listing sites now (see the directory in
 * siteLinks.ts). What remains is the watch: each user's pipeline, re-checked
 * on their own key at their own cadence, so a price drop or a quiet
 * delisting on a place they're chasing still finds them within hours.
 *
 * One tick, many spenders, each on their own account — a user with no key
 * of their own is skipped rather than free-riding on someone else's budget.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace("Bearer ", "");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    // Everyone with anything on a board. No session here, so service role.
    const { data, error } = await adminDb()
      .from("user_listing_state")
      .select("user_id")
      .in("stage", WATCH_STAGES);
    if (error) throw new Error(error.message);
    const userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
    if (!userIds.length) {
      return NextResponse.json({ message: "nothing watched", users: 0 });
    }

    const runs: Record<string, unknown>[] = [];
    for (const userId of userIds) {
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
          recheckWatch(userId)
        );
        runs.push({
          user: userId,
          key: keyHint(ownKey),
          checked: result.checked,
          watched: result.watched,
          events: result.events,
          errors: result.errors.slice(0, 3),
        });
      } catch (err) {
        runs.push({
          user: userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ users: userIds.length, runs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "poll failed" },
      { status: 500 }
    );
  }
}
