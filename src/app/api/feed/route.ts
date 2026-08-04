import { NextResponse } from "next/server";
import { loadFeed, type FeedFilters } from "@/lib/feed";
import type { Source, Stage } from "@/types";

export const dynamic = "force-dynamic";

function num(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const filters: FeedFilters = {
    stage: (params.get("stage") as Stage | "all" | "active") ?? undefined,
    source: (params.get("source") as Source | "all") ?? undefined,
    priceMin: num(params.get("priceMin")),
    priceMax: num(params.get("priceMax")),
    bedsMin: num(params.get("bedsMin")),
    bedsMax: num(params.get("bedsMax")),
    noFeeOnly: params.get("noFee") === "1",
    changedOnly: params.get("changed") === "1",
    starredOnly: params.get("starred") === "1",
    includeGone: params.get("gone") === "1",
    search: params.get("q") ?? undefined,
    sort: (params.get("sort") as FeedFilters["sort"]) ?? "best",
    areas: params.get("areas")?.split(",").filter(Boolean),
  };

  try {
    const listings = await loadFeed(filters);
    return NextResponse.json({ listings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "feed failed";
    return NextResponse.json({ error: message, listings: [] }, { status: 500 });
  }
}
