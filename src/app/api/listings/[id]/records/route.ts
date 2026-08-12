import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase";
import { fetchBuildingRecords } from "@/lib/nycdata";

export const dynamic = "force-dynamic";

const TTL_MS = 7 * 86_400_000;

/**
 * Every report on one listing's building: HPD violations, 311 complaints on
 * the block, bedbug filings. The long version of the record summary, fetched
 * only when somebody opens it.
 *
 * Cached a week in its own columns, for the same reason as the summary: this
 * is four Socrata queries against free public endpoints, and the courtesy
 * owed for that is not asking twice a day. Public like the summary is, since
 * it's public record about a building and half of what makes the demo drawer
 * worth reading.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = adminDb();

    const { data: cached } = await supabase
      .from("building_intel")
      .select("records, records_at")
      .eq("listing_id", id)
      .maybeSingle();
    if (
      cached?.records &&
      cached.records_at &&
      Date.now() - new Date(cached.records_at as string).getTime() < TTL_MS
    ) {
      return NextResponse.json({ records: cached.records, cached: true });
    }

    const { data: listing } = await supabase
      .from("listings")
      .select("address, borough, lat, lon")
      .eq("id", id)
      .maybeSingle();
    if (!listing) return NextResponse.json({ error: "unknown listing" }, { status: 404 });

    const records = await fetchBuildingRecords(
      listing.address as string,
      (listing.borough as string) ?? "",
      listing.lat as number | null,
      listing.lon as number | null
    );

    /*
     * Only a complete answer gets written down.
     *
     * When a city endpoint times out its dataset comes back empty, and an
     * empty dataset is indistinguishable from a clean building. Caching that
     * for a week would tell every later reader that a building with two
     * hundred violations has none, which is worse than any error message.
     * A partial result is still served — half the record beats none — it
     * just doesn't get to be the answer next time.
     *
     * Upsert, because the summary may never have been fetched for this
     * listing; a row keyed only on records would collide with the intel
     * route's own insert. fetched_at is left alone so this write can't make
     * a stale summary look fresh.
     */
    if (!records.partial) {
      await supabase
        .from("building_intel")
        .upsert(
          { listing_id: id, records, records_at: new Date().toISOString() },
          { onConflict: "listing_id" }
        );
    }
    return NextResponse.json({ records, cached: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "records failed" },
      { status: 500 }
    );
  }
}
