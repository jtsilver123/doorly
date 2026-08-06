import { NextResponse } from "next/server";
import { db, currentUserId } from "@/lib/supabase";
import { mediaBucket, mediaKey, MAX_UPLOAD_BYTES } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Big files, in pieces.
 *
 * A 200MB walkthrough can't cross a Worker in one request — Cloudflare bounds
 * the body and the Worker only has 128MB of memory, while R2 insists on
 * knowing a body's length up front, which means buffering. So the browser cuts
 * the file up and R2 reassembles it: `create` opens a multipart upload, `part`
 * takes one chunk at a time, and `complete` stitches them and writes the
 * metadata row that makes the file visible.
 *
 * Every action re-checks the session and re-derives the object key from the
 * caller's own user id, so a key handed back by `create` can't be replayed by
 * anyone else — and the row is written only after R2 confirms the object, so a
 * cancelled upload can't leave a card pointing at nothing.
 */

interface CreateBody {
  action: "create";
  filename: string;
  contentType: string;
  size: number;
}

interface CompleteBody {
  action: "complete";
  key: string;
  uploadId: string;
  contentType: string;
  parts: { partNumber: number; etag: string }[];
}

interface AbortBody {
  action: "abort";
  key: string;
  uploadId: string;
}

/**
 * The key belongs to the caller, or it isn't theirs to write.
 *
 * `mediaKey` puts the uploader's id first, so this is a prefix check rather
 * than a lookup — and it's what stops a second session from appending parts to
 * someone else's in-flight upload with a guessed uploadId.
 */
function ownsKey(key: string, userId: string, listingId: string): boolean {
  return key.startsWith(`${userId}/${listingId}/`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await currentUserId();
    const { id } = await params;
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    /*
     * One chunk of bytes. Sent as a raw body with the part number in the
     * query, because a JSON envelope would mean base64 and a third more
     * traffic on the slowest step.
     */
    if (action === "part") {
      const key = url.searchParams.get("key") ?? "";
      const uploadId = url.searchParams.get("uploadId") ?? "";
      const partNumber = Number(url.searchParams.get("partNumber") ?? 0);
      if (!key || !uploadId || !partNumber) {
        return NextResponse.json({ error: "bad part request" }, { status: 400 });
      }
      if (!ownsKey(key, userId, id)) {
        return NextResponse.json({ error: "not yours" }, { status: 403 });
      }
      const upload = mediaBucket().resumeMultipartUpload(key, uploadId);
      const part = await upload.uploadPart(partNumber, await request.arrayBuffer());
      return NextResponse.json({ partNumber: part.partNumber, etag: part.etag });
    }

    const body = (await request.json()) as CreateBody | CompleteBody | AbortBody;

    if (body.action === "create") {
      if (!body.contentType.startsWith("video/") && !body.contentType.startsWith("image/")) {
        return NextResponse.json({ error: "only photos and video" }, { status: 415 });
      }
      if (body.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: "that file is too big — trim the clip or drop the resolution" },
          { status: 413 }
        );
      }
      const key = mediaKey(userId, id, body.filename);
      const upload = await mediaBucket().createMultipartUpload(key, {
        httpMetadata: { contentType: body.contentType },
      });
      return NextResponse.json({ key, uploadId: upload.uploadId });
    }

    if (body.action === "complete") {
      if (!ownsKey(body.key, userId, id)) {
        return NextResponse.json({ error: "not yours" }, { status: 403 });
      }
      const upload = mediaBucket().resumeMultipartUpload(body.key, body.uploadId);
      // R2 rejects an out-of-order manifest, and a browser that finished part
      // 4 before part 3 will report them that way.
      await upload.complete([...body.parts].sort((a, b) => a.partNumber - b.partNumber));

      const supabase = await db();
      const { error } = await supabase.from("user_listing_media").insert({
        user_id: userId,
        listing_id: id,
        path: body.key,
        kind: body.contentType.startsWith("video/") ? "video" : "photo",
      });
      if (error) {
        // Don't leave an orphan object paying rent for a row that never existed.
        await mediaBucket().delete(body.key).catch(() => {});
        throw new Error(error.message);
      }
      return NextResponse.json({ path: body.key });
    }

    if (body.action === "abort") {
      if (!ownsKey(body.key, userId, id)) {
        return NextResponse.json({ error: "not yours" }, { status: 403 });
      }
      await mediaBucket().resumeMultipartUpload(body.key, body.uploadId).abort();
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upload failed" },
      { status: 500 }
    );
  }
}
