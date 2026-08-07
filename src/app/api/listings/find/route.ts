import { NextResponse } from "next/server";
import { findInCorpus } from "@/lib/feed";

export const dynamic = "force-dynamic";

/**
 * Quick-add's second opinion. The browser matches against its own feed first,
 * but the feed is criteria-scoped and a paste is a manual decision — so a
 * miss comes here, where the whole shared corpus answers.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown };
    const query = String(body.query ?? "").slice(0, 500);
    if (!query.trim()) return NextResponse.json({ id: null });
    return NextResponse.json({ id: await findInCorpus(query) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed" },
      { status: 500 }
    );
  }
}
