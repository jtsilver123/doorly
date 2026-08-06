import { NextResponse } from "next/server";
import { db, adminDb, currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * The tour footage attached to one listing.
 *
 * Files upload straight from the browser to storage (a serverless route
 * can't relay video), so this route's job is the reading side: list the
 * rows this user may see — their own and their crew's, which RLS already
 * decides — and mint short-lived signed URLs for a private bucket.
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

    // Signed by the service role: the storage read policy exists for direct
    // access, but signing through one place keeps expiry consistent.
    const storage = adminDb().storage.from("tour-media");
    const media = await Promise.all(
      (rows ?? []).map(async (row) => {
        const { data } = await storage.createSignedUrl(row.path as string, 3600);
        return { ...row, url: data?.signedUrl ?? null };
      })
    );
    return NextResponse.json({ media: media.filter((m) => m.url) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "media failed" },
      { status: 500 }
    );
  }
}
