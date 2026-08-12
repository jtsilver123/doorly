import { NextResponse } from "next/server";
import { db, currentUserId, adminDb } from "@/lib/supabase";
import { signMediaPath } from "@/lib/mediaSign";

export const dynamic = "force-dynamic";

const mediaUrl = (path: string) =>
  `/api/media/${path.split("/").map(encodeURIComponent).join("/")}`;

/**
 * The tour footage attached to one listing.
 *
 * Bytes are in R2 and metadata is in Postgres, so this lists the rows the
 * viewer is allowed to see — their own and their crew's, which the row-level
 * policy decides — and hands back URLs pointing at this app's own reader
 * rather than a signed third-party link that expires mid-scrub.
 *
 * A visitor with no session gets one narrower door: `?via=<user>` — the tail
 * a share link carries — lists that user's footage only, with each URL
 * carrying a short-lived signature the byte reader accepts in place of a
 * cookie. Whoever was sent the page sees the walkthrough the sender meant to
 * show; a stranger who merely knows the listing id sees nothing, because the
 * `via` they'd have to name is the secret they don't have.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const signedIn = await currentUserId().then(
      () => true,
      () => false
    );

    if (signedIn) {
      const supabase = await db();
      const { data: rows, error } = await supabase
        .from("user_listing_media")
        .select("id, user_id, path, kind, caption, created_at")
        .eq("listing_id", id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return NextResponse.json({
        media: (rows ?? []).map((row) => ({ ...row, url: mediaUrl(row.path as string) })),
      });
    }

    const via = new URL(req.url).searchParams.get("via") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(via)) return NextResponse.json({ media: [] });
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) return NextResponse.json({ media: [] });

    const { data: rows, error } = await adminDb()
      .from("user_listing_media")
      .select("id, user_id, path, kind, caption, created_at")
      .eq("listing_id", id)
      .eq("user_id", via)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const media = await Promise.all(
      (rows ?? []).map(async (row) => {
        const { exp, sig } = await signMediaPath(secret, row.path as string);
        return { ...row, url: `${mediaUrl(row.path as string)}?exp=${exp}&sig=${sig}` };
      })
    );
    return NextResponse.json({ media });
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
