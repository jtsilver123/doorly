import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase";
import { fetchBuildingIntel } from "@/lib/nycdata";

export const dynamic = "force-dynamic";

const TTL_MS = 7 * 86_400_000;

/**
 * The building's public record for one listing, cached a week — violations
 * and bedbug filings move on inspection timescales, and the city's open
 * endpoints deserve better than the same question twice a day.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Public city data about a building, cached a week server-side — the
    // one thing on this route that was ever private was the login wall.
    // Guests get it too; it's half the demo drawer's substance.
    const { id } = await params;
    const supabase = adminDb();

    const { data: cached } = await supabase
      .from("building_intel")
      .select("payload, fetched_at")
      .eq("listing_id", id)
      .maybeSingle();
    if (
      cached &&
      Date.now() - new Date(cached.fetched_at as string).getTime() < TTL_MS
    ) {
      return NextResponse.json({ intel: cached.payload, cached: true });
    }

    const { data: listing } = await supabase
      .from("listings")
      .select("address, borough, lat, lon")
      .eq("id", id)
      .maybeSingle();
    if (!listing) return NextResponse.json({ error: "unknown listing" }, { status: 404 });

    const intel = await fetchBuildingIntel(
      listing.address as string,
      (listing.borough as string) ?? "",
      listing.lat as number | null,
      listing.lon as number | null
    );
    await supabase
      .from("building_intel")
      .upsert(
        { listing_id: id, payload: intel, fetched_at: new Date().toISOString() },
        { onConflict: "listing_id" }
      );
    return NextResponse.json({ intel, cached: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "intel failed" },
      { status: 500 }
    );
  }
}
