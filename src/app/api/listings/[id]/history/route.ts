import { NextResponse } from "next/server";
import { adminDb, currentUserId } from "@/lib/supabase";
import { fetchZillowPriceHistory } from "@/lib/sources/zillow";
import { BudgetExhaustedError, RealtyApiError } from "@/lib/realtyapi";
import type { RentEvent } from "@/lib/rentHistory";

export const dynamic = "force-dynamic";

/**
 * A place's past rents, from the listing site's own record.
 *
 * Two verbs on purpose. GET is free: it reads the cache and never spends an
 * API credit, so the drawer can ask on every open. POST spends one request
 * against the shared budget and only ever runs when a signed-in person
 * pressed the button that says so — history rarely changes, and the cache
 * has no expiry because a past that's already happened doesn't update.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data } = await adminDb()
      .from("listing_rent_history")
      .select("events, fetched_at")
      .eq("listing_id", id)
      .maybeSingle();
    if (!data) return NextResponse.json({ events: null });
    return NextResponse.json({ events: data.events, fetchedAt: data.fetched_at });
  } catch {
    return NextResponse.json({ events: null });
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await currentUserId();
    const { id } = await params;
    const supabase = adminDb();

    // Someone else may have paid for this answer already.
    const { data: cached } = await supabase
      .from("listing_rent_history")
      .select("events, fetched_at")
      .eq("listing_id", id)
      .maybeSingle();
    if (cached) {
      return NextResponse.json({ events: cached.events, fetchedAt: cached.fetched_at });
    }

    /*
     * The zpid is the key into Zillow's record. A zillow-sourced listing
     * carries it in its own id; anything else may still have a zillow row
     * among its cross-listings, whose source_id is the raw zpid.
     */
    let zpid: string | null = id.startsWith("zillow-") ? id.slice("zillow-".length) : null;
    if (!zpid) {
      const { data: src } = await supabase
        .from("listing_sources")
        .select("source_id")
        .eq("listing_id", id)
        .eq("source", "zillow")
        .maybeSingle();
      if (src?.source_id) zpid = String(src.source_id).replace(/^zillow-/, "");
    }

    /*
     * A StreetEasy-only listing can still have a Zillow twin: the same unit
     * posted to both sites as two rows we never linked. Matching on address
     * AND unit finds it for free, without spending a request. Address alone
     * would be wrong — 4F and 12B in one building are different rents, and
     * a confident wrong history is worse than none.
     */
    if (!zpid) {
      const { data: self } = await supabase
        .from("listings")
        .select("address, unit")
        .eq("id", id)
        .maybeSingle();
      if (self?.address) {
        const { data: twins } = await supabase
          .from("listings")
          .select("id, unit")
          .ilike("address", self.address.trim())
          .neq("id", id)
          .limit(20);
        const sameUnit = (twins ?? []).filter(
          (t) => (t.unit ?? "").trim().toLowerCase() === (self.unit ?? "").trim().toLowerCase()
        );
        if (sameUnit.length) {
          const { data: twinSrc } = await supabase
            .from("listing_sources")
            .select("source_id")
            .eq("source", "zillow")
            .in(
              "listing_id",
              sameUnit.map((t) => t.id)
            )
            .limit(1)
            .maybeSingle();
          if (twinSrc?.source_id) zpid = String(twinSrc.source_id).replace(/^zillow-/, "");
        }
      }
    }

    if (!zpid) {
      /*
       * Only Zillow publishes a rent history through this API — StreetEasy's
       * side exposes search and nothing else — so a place Zillow has never
       * carried has no history to fetch anywhere. Say that plainly instead
       * of implying the person did something wrong.
       */
      return NextResponse.json({
        events: null,
        noSource: true,
        error:
          "Rent history only comes from Zillow's record, and this unit isn't in it. Nothing to pull for this one.",
      });
    }

    /*
     * Only a fetch that actually happened gets cached. The helper throws on
     * failure precisely so a keyless or out-of-credits attempt can't write
     * an empty row that reads as "this place has no history" to everyone
     * who opens it afterwards. A genuinely blank record does cache — that
     * answer cost a credit and doesn't change.
     */
    const events: RentEvent[] = await fetchZillowPriceHistory(zpid);
    await supabase
      .from("listing_rent_history")
      .upsert({ listing_id: id, events, fetched_at: new Date().toISOString() });

    return NextResponse.json({ events, fetchedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      return NextResponse.json({ events: null, error: err.message }, { status: 402 });
    }
    if (err instanceof RealtyApiError) {
      const friendly = /no RealtyAPI key/i.test(err.message)
        ? "Pulling history needs an API key. Paste yours under Data & refresh."
        : err.message;
      return NextResponse.json({ events: null, error: friendly }, { status: 502 });
    }
    return NextResponse.json({ events: null, error: "not signed in" }, { status: 401 });
  }
}
