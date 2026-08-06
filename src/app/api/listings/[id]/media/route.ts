import { NextResponse } from "next/server";
import { db, currentUserId } from "@/lib/supabase";
import { mediaBucket, mediaKey, MAX_UPLOAD_BYTES } from "@/lib/r2";

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

/**
 * Taking an upload.
 *
 * The file streams from the phone through this Worker into R2 — no
 * intermediate copy, no third-party credential in the browser. The metadata
 * row is written only after the object lands, so a failed upload can't leave
 * a card pointing at nothing.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await currentUserId();
    const { id } = await params;
    const url = new URL(request.url);
    const filename = url.searchParams.get("name") ?? "upload";
    const contentType = request.headers.get("content-type") ?? "application/octet-stream";
    const kind = contentType.startsWith("video/") ? "video" : "photo";

    if (!contentType.startsWith("video/") && !contentType.startsWith("image/")) {
      return NextResponse.json({ error: "only photos and video" }, { status: 415 });
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "that file is too big — trim the clip or drop the resolution" },
        { status: 413 }
      );
    }
    if (!request.body) {
      return NextResponse.json({ error: "no file" }, { status: 400 });
    }

    /*
     * R2 refuses a stream whose length it doesn't know, and the body Next
     * hands a route handler is exactly that — piping it through a
     * FixedLengthStream doesn't help, because by then it isn't the runtime's
     * own stream any more. Reading it into a buffer gives R2 the known length
     * it wants. That buffer is why MAX_UPLOAD_BYTES is what it is: a Worker
     * gets 128MB of memory, and the file has to fit inside it with room to
     * spare.
     */
    const key = mediaKey(userId, id, filename);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "that file is too big — trim the clip or drop the resolution" },
        { status: 413 }
      );
    }
    await mediaBucket().put(key, bytes, { httpMetadata: { contentType } });

    const supabase = await db();
    const { error } = await supabase.from("user_listing_media").insert({
      user_id: userId,
      listing_id: id,
      path: key,
      kind,
    });
    if (error) {
      // Don't leave an orphan object paying rent for a row that never existed.
      await mediaBucket().delete(key).catch(() => {});
      throw new Error(error.message);
    }

    return NextResponse.json({ path: key, kind });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upload failed" },
      { status: 500 }
    );
  }
}
