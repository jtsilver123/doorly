import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * One-shot geocoding for commute anchors, via Nominatim (OpenStreetMap).
 *
 * Only called when someone saves an anchor — a handful of requests per
 * account, ever — which is squarely inside Nominatim's usage policy. The
 * viewbox biases matches into the city so "1 Madison Ave" doesn't land in
 * Toledo.
 */
export async function GET(request: Request) {
  try {
    await currentUserId();
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 3) return NextResponse.json({ error: "too short" }, { status: 400 });

    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us" +
      "&viewbox=-74.30,40.95,-73.65,40.48&bounded=1&q=" +
      encodeURIComponent(q);
    const res = await fetch(url, {
      headers: { "user-agent": "damnlease-nyc/1.0 (apartment hunt tool)" },
      cache: "no-store",
    });
    const body = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    if (!body.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      lat: Number(body[0].lat),
      lon: Number(body[0].lon),
      label: body[0].display_name.split(",").slice(0, 2).join(","),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "geocode failed" },
      { status: 500 }
    );
  }
}
