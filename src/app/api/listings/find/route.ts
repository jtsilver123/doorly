import { NextResponse } from "next/server";
import { findInCorpus, pullListingByAddress } from "@/lib/feed";
import { currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * A pasted link or address, turned into a lookup term the byaddress
 * endpoint can answer: URLs surrender the slug segment that looks like a
 * street address; bare text is already the term. New York rides along
 * when the paste doesn't say it, since every listing here is.
 */
function lookupTermFrom(query: string): string | null {
  const q = query.trim();
  let term: string | null = null;
  if (!/^https?:\/\//i.test(q)) {
    term = q.length >= 8 && /\d/.test(q) ? q : null;
  } else {
    try {
      const seg = new URL(q).pathname
        .split("/")
        .filter(Boolean)
        .find((s) => /\d/.test(s) && /[a-z]/i.test(s));
      term = seg
        ? seg
            .replace(/\d+_zpid$/i, "")
            .replace(/[-_]+/g, " ")
            .trim()
        : null;
    } catch {
      term = null;
    }
  }
  if (!term) return null;
  return /new\s*york|,\s*ny\b/i.test(term) ? term : `${term}, New York, NY`;
}

/**
 * Quick-add's second opinion. The browser matches against its own feed first,
 * but the feed is criteria-scoped and a paste is a manual decision — so a
 * miss comes here, where the whole shared corpus answers. With `pull` set, a
 * corpus miss goes one step further: a single targeted upstream request for
 * exactly that place, instead of the full poll this used to cost.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown; pull?: unknown };
    const query = String(body.query ?? "").slice(0, 500);
    if (!query.trim()) return NextResponse.json({ id: null });

    const known = await findInCorpus(query);
    if (known || !body.pull) return NextResponse.json({ id: known });

    // The pull spends a shared-budget request, so it needs a real person.
    await currentUserId();
    const term = lookupTermFrom(query);
    if (!term) return NextResponse.json({ id: null });
    const pulled = await pullListingByAddress(term);
    return NextResponse.json({ id: pulled, pulled: Boolean(pulled) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed" },
      { status: 500 }
    );
  }
}
