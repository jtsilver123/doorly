import { NextResponse } from "next/server";
import { db, currentUserId } from "@/lib/supabase";
import { mediaBucket } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Serving one piece of tour footage.
 *
 * Authorization is a database read, not a second rulebook: the metadata row
 * for this path is fetched with the *user's* client, so the row-level policy
 * that already decides "mine, or a crew-mate's" is the thing that answers.
 * No row visible means no file — a stranger and a missing file are the same
 * 404, which is also the right answer for probing.
 *
 * Range requests matter more than they look: without them Safari won't
 * scrub, or even play, a video.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    await currentUserId();
    const { path } = await params;
    const key = path.map(decodeURIComponent).join("/");

    const supabase = await db();
    const { data: row } = await supabase
      .from("user_listing_media")
      .select("id, kind")
      .eq("path", key)
      .maybeSingle();
    if (!row) return new NextResponse("not found", { status: 404 });

    const object = await mediaBucket().get(key);
    if (!object) return new NextResponse("not found", { status: 404 });

    return new NextResponse(object.body as unknown as BodyInit, {
      headers: {
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "content-length": String(object.size),
        "accept-ranges": "bytes",
        // Private: signed-in only, and the URL is stable per file, so let the
        // browser reuse it without letting a shared cache hold it.
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}

/**
 * Deleting your own footage.
 *
 * The row goes first and the object second: the delete policy only lets you
 * remove your own rows, so a row that disappears is proof the caller owned
 * it — and if the object delete then fails, the worst case is bytes nobody
 * can reach, rather than a card pointing at a file that's gone.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    await currentUserId();
    const { path } = await params;
    const key = path.map(decodeURIComponent).join("/");

    const supabase = await db();
    // Packet documents live in their own table; the delete policy on each
    // means a vanished row is proof of ownership either way.
    const table = (key.split("/")[1] ?? "").startsWith("packet") ? "user_documents" : "user_listing_media";
    const { data: removed, error } = await supabase
      .from(table)
      .delete()
      .eq("path", key)
      .select("id");
    if (error) throw new Error(error.message);
    if (!removed?.length) return new NextResponse("not found", { status: 404 });

    await mediaBucket().delete(key);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 }
    );
  }
}
