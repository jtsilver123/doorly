import { NextResponse } from "next/server";
import { recheckWatch } from "@/lib/watch";
import { loadConfig, withConfig } from "@/lib/apikey";
import { currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Manual "check my places" from the UI.
 *
 * This used to run the full crawl — every saved search, every source, every
 * page. Discovery now happens on the listing sites themselves, so the button
 * re-checks the places on the caller's board instead: one request per place,
 * on the caller's own key, and any price move or delisting lands as a
 * timeline event.
 */
export async function POST() {
  try {
    const userId = await currentUserId().catch(() => undefined);
    if (!userId) {
      return NextResponse.json({ error: "sign in to check your places" }, { status: 401 });
    }
    const config = await loadConfig();
    const result = await withConfig(config, () => recheckWatch(userId));
    return NextResponse.json({
      ...result,
      // The first error is the one worth surfacing; the rest usually rhyme.
      error: result.errors[0],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "refresh failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
