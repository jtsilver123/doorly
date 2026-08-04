import { NextResponse } from "next/server";
import { ingest } from "@/lib/ingest";
import { ensureDefaultSearch } from "@/lib/feed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Manual "check for new listings" from the UI, and the target for a scheduled
 * cron. When CRON_SECRET is set, unattended callers must present it; requests
 * from the app itself (no secret configured) are allowed through so local use
 * needs no setup.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace("Bearer ", "");
  const isCron = request.headers.get("x-cron") === "1";
  if (isCron && secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const searches = await ensureDefaultSearch();
    const result = await ingest(searches);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "refresh failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
