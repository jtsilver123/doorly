import { NextResponse } from "next/server";
import { addManualListing } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.address || !body.price) {
    return NextResponse.json(
      { error: "address and price are required" },
      { status: 400 }
    );
  }
  try {
    const id = await addManualListing({
      url: String(body.url ?? ""),
      address: String(body.address),
      price: Number(body.price),
      bedrooms: body.bedrooms == null ? undefined : Number(body.bedrooms),
      neighborhood: body.neighborhood ? String(body.neighborhood) : undefined,
      unit: body.unit ? String(body.unit) : undefined,
      contactName: body.contactName ? String(body.contactName) : undefined,
      contactPhone: body.contactPhone ? String(body.contactPhone) : undefined,
      contactEmail: body.contactEmail ? String(body.contactEmail) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "add failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
