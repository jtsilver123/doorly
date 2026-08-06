import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase";
import { estimateHunt, medianOf } from "@/lib/estimate";

export const dynamic = "force-dynamic";

/**
 * What the hunt looks like, for someone who hasn't signed up yet.
 *
 * Deliberately public — it runs on the landing page, before an account exists,
 * and that's the point: the pitch is "this is a definable process", which is
 * worth nothing if you have to register to see the definition.
 *
 * Nothing personal crosses this endpoint in either direction. It reads
 * aggregate asking prices from the shared listing corpus — the same corpus
 * every search reads — and returns counts and a median. No rows, no
 * addresses, no user data.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    // Bounded hard: this is a public endpoint, and the values go into a
    // database filter. Nothing legitimate is longer than a neighborhood name.
    const areas = (url.searchParams.get("areas") ?? "")
      .split(",")
      .map((a) => a.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 8);
    const rawBeds = Number(url.searchParams.get("beds") ?? 1);
    // NaN survives min/max untouched and would end up in the query filter.
    const beds = Number.isFinite(rawBeds) ? Math.max(0, Math.min(4, Math.round(rawBeds))) : 1;
    const moveIn = url.searchParams.get("moveIn");

    const supabase = adminDb();
    let query = supabase.from("listings").select("price").eq("bedrooms", beds);
    if (areas.length) query = query.in("neighborhood", areas);
    // Enough to make a stable median without pulling the whole table onto a
    // page a stranger is only skimming.
    const { data, error } = await query.limit(600);
    if (error) throw new Error(error.message);

    const prices = (data ?? []).map((r) => Number(r.price)).filter((n) => n > 0);
    const daysToMoveIn = moveIn
      ? Math.round((new Date(moveIn).getTime() - Date.now()) / 86_400_000)
      : 60;

    const estimate = estimateHunt({
      matches: prices.length,
      medianRent: medianOf(prices),
      // A date already in the past means "as soon as possible", not negative
      // slack against a deadline that's gone.
      daysToMoveIn: Math.max(0, Number.isFinite(daysToMoveIn) ? daysToMoveIn : 60),
      neighborhoods: Math.max(1, areas.length),
    });

    return NextResponse.json({ ...estimate, sample: prices.length });
  } catch {
    // Never echo the upstream error: a database hiccup here once returned a
    // whole HTML error page inside this JSON, on an endpoint strangers can
    // hit. There is nothing a landing-page visitor can do with details anyway.
    return NextResponse.json({ error: "estimate failed" }, { status: 500 });
  }
}
