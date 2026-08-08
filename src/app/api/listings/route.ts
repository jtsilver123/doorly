import { NextResponse } from "next/server";
import { addManualListing } from "@/lib/feed";
import { currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // The add writes with the service role, so the person has to be real.
  try {
    await currentUserId();
  } catch {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const body = await request.json();
  // Only the address is required. Somebody pasting one from a text message
  // rarely has the rent to hand, and refusing the add until they do is how a
  // tip stays in the text message it arrived in.
  if (!body.address) {
    return NextResponse.json({ error: "An address is required." }, { status: 400 });
  }
  try {
    const id = await addManualListing({
      url: String(body.url ?? ""),
      source: body.source === "facebook" ? "facebook" : "manual",
      address: String(body.address),
      price: Number(body.price),
      bedrooms: body.bedrooms == null ? undefined : Number(body.bedrooms),
      neighborhood: body.neighborhood ? String(body.neighborhood) : undefined,
      unit: body.unit ? String(body.unit) : undefined,
      contactName: body.contactName ? String(body.contactName) : undefined,
      contactPhone: body.contactPhone ? String(body.contactPhone) : undefined,
      contactEmail: body.contactEmail ? String(body.contactEmail) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      forSale: Boolean(body.forSale),
      salePrice: body.salePrice ? Number(body.salePrice) : undefined,
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "add failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
