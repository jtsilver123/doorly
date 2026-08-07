import { NextResponse } from "next/server";
import { db, currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * The tour footage attached to one listing.
 *
 * Bytes are in R2 and metadata is in Postgres, so this lists the rows the
 * viewer is allowed to see — their own and their crew's, which the row-level
 * policy decides — and hands back URLs pointing at this app's own reader
 * rather than a signed third-party link that expires mid-scrub.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await currentUserId();
    const { id } = await params;
    const supabase = await db();
    const { data: rows, error } = await supabase
      .from("user_listing_media")
      .select("id, user_id, path, kind, caption, created_at")
      .eq("listing_id", id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return NextResponse.json({
      media: (rows ?? []).map((row) => ({
        ...row,
        url: `/api/media/${(row.path as string).split("/").map(encodeURIComponent).join("/")}`,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "media failed" },
      { status: 500 }
    );
  }
}

/*
 * Uploads no longer land here.
 *
 * They're answered by the Worker itself, at `/api/upload`, before Next sees
 * the request — see upload-handler.js. That's not a refactor for neatness:
 * R2 needs a body's length, Next's request wrapper loses it, and the only way
 * to satisfy R2 from inside a route handler was to read the whole file into a
 * Worker's 128MB of memory. A 44MB video killed the isolate, which took
 * unrelated requests down with it. Handled at the front door the body is
 * still a stream, and nothing is ever assembled.
 *
 * This stub exists for the tabs that don't know that yet. A page loaded
 * before the cutover still posts here, and without it they get a bare 405
 * that the queue can only render as "upload failed" — an error that looks
 * permanent and is cured by a reload. Say so.
 */
export async function POST() {
  return NextResponse.json(
    { error: "this tab is running an old version of DamnLease — reload the page and try again" },
    { status: 409 }
  );
}
