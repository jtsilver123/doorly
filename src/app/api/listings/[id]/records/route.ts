import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase";
import {
  fetchHpdRecords,
  fetch311Records,
  mergeRecords,
  type BuildingRecords,
} from "@/lib/nycdata";

export const dynamic = "force-dynamic";

const TTL_MS = 7 * 86_400_000;

/**
 * Every report on one listing's building, in two halves.
 *
 * `?feed=hpd` is the building's own file: violations and bedbug filings,
 * about 25KB, back in a few hundred milliseconds. `?feed=311` is every call
 * within a block, five times the payload and the slow one. The page asks for
 * both at once and draws whichever lands first, so the most damning half is
 * on screen while the bulky one is still in flight. No `feed` returns the
 * merged whole, for anything that wants it in one piece.
 *
 * Each half caches in its own columns for a week, for the same reason as the
 * summary: these are free public endpoints with no key, and the courtesy owed
 * is not asking twice a day. Public, like the summary, since it is public
 * record about a building.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const feed = new URL(req.url).searchParams.get("feed");
    const wantHpd = feed !== "311";
    const want311 = feed !== "hpd";
    const supabase = adminDb();

    const { data: cached } = await supabase
      .from("building_intel")
      .select("records, records_at, records_311, records_311_at")
      .eq("listing_id", id)
      .maybeSingle();

    const fresh = (at: unknown) =>
      typeof at === "string" && Date.now() - new Date(at).getTime() < TTL_MS;

    const hpdHit =
      wantHpd && cached?.records && fresh(cached.records_at)
        ? (cached.records as unknown as BuildingRecords)
        : null;
    const callsHit =
      want311 && cached?.records_311 && fresh(cached.records_311_at)
        ? (cached.records_311 as unknown as BuildingRecords)
        : null;

    // Everything asked for is already on file: answer without touching the
    // city at all, and without reading the listing row.
    if ((!wantHpd || hpdHit) && (!want311 || callsHit)) {
      const records =
        hpdHit && callsHit ? mergeRecords(hpdHit, callsHit) : (hpdHit ?? callsHit)!;
      return NextResponse.json({ records, cached: true });
    }

    const { data: listing } = await supabase
      .from("listings")
      .select("address, borough, lat, lon")
      .eq("id", id)
      .maybeSingle();
    if (!listing) return NextResponse.json({ error: "unknown listing" }, { status: 404 });

    const address = listing.address as string;
    const borough = (listing.borough as string) ?? "";

    const [hpd, calls] = await Promise.all([
      wantHpd ? (hpdHit ?? fetchHpdRecords(address, borough)) : null,
      want311
        ? (callsHit ??
          fetch311Records(address, listing.lat as number | null, listing.lon as number | null))
        : null,
    ]);

    /*
     * Only a complete half gets written down.
     *
     * When a city endpoint times out its dataset comes back empty, and an
     * empty dataset is indistinguishable from a clean building. Caching that
     * for a week would tell every later reader that a building with two
     * hundred violations has none, which is worse than any error message. A
     * partial result is still served — half the record beats none — it just
     * doesn't get to be the answer next time.
     *
     * `fetched_at` is never touched here, so a records write can't make a
     * stale summary look fresh.
     */
    const now = new Date().toISOString();
    const write: Record<string, unknown> = { listing_id: id };
    if (hpd && !hpdHit && !hpd.partial) {
      write.records = hpd;
      write.records_at = now;
    }
    if (calls && !callsHit && !calls.partial) {
      write.records_311 = calls;
      write.records_311_at = now;
    }
    if (Object.keys(write).length > 1) {
      await supabase.from("building_intel").upsert(write, { onConflict: "listing_id" });
    }

    const records = hpd && calls ? mergeRecords(hpd, calls) : (hpd ?? calls)!;
    return NextResponse.json({ records, cached: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "records failed" },
      { status: 500 }
    );
  }
}
