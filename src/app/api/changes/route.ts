import { NextResponse } from "next/server";
import { loadChanges } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ changes: await loadChanges(200) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "changes failed";
    return NextResponse.json({ error: message, changes: [] }, { status: 500 });
  }
}
