import { NextResponse } from "next/server";
import { ingest } from "@/lib/ingest";
import { loadAllActiveSearches } from "@/lib/feed";
import { nextCheckDue } from "@/lib/apikey";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled poll. Separate from /api/refresh so the cron path can always demand
 * the shared secret, while the in-app refresh button stays friction-free.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace("Bearer ", "");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    // The cron ticks hourly; the user's setting decides whether to act on it.
    const { due, lastAt, intervalHours } = await nextCheckDue();
    if (!due) {
      return NextResponse.json({
        skipped: true,
        message: intervalHours
          ? `next check due ${intervalHours}h after ${lastAt ?? "never"}`
          : "automatic checks are off",
      });
    }

    // No session here, so gather every account's searches with the service role.
    const searches = await loadAllActiveSearches();
    if (!searches.length) {
      return NextResponse.json({ message: "no active searches", fetched: 0 });
    }
    const result = await ingest(searches);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "poll failed" },
      { status: 500 }
    );
  }
}
