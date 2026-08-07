import { NextResponse } from "next/server";

/**
 * A tombstone with directions.
 *
 * The chunked upload lived here for part of one day before moving to the
 * Worker's front door at /api/upload. A tab from that window still posts
 * here, and a bare 404 renders in the queue as a permanent-looking failure
 * whose actual cure is a reload. Say the cure.
 */
export async function POST() {
  return NextResponse.json(
    { error: "this tab is running an old version of DamnLease — reload the page and try again" },
    { status: 409 }
  );
}
