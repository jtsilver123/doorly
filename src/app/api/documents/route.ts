import { NextResponse } from "next/server";
import { db, currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** The packet's papers, newest first, each with its private read URL. */
export async function GET() {
  try {
    await currentUserId();
    const supabase = await db();
    const { data, error } = await supabase
      .from("user_documents")
      .select("id, path, name, kind, size, slot, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({
      documents: (data ?? []).map((d) => ({
        ...d,
        url: `/api/media/${d.path}`,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not load documents" },
      { status: 500 }
    );
  }
}

/**
 * Re-file a paper into a different slot. Dumping everything in one drop and
 * sorting afterward beats deciding a category per file at upload time, and
 * this is the sorting half. RLS only lets the update touch your own rows, so
 * a miss means someone else's document or a stale id — same 404 either way.
 */
export async function PATCH(request: Request) {
  try {
    await currentUserId();
    const body = await request.json();
    const id = String(body.id ?? "");
    const slot = body.slot;
    if (!id || typeof slot !== "string" || slot.length > 64) {
      return NextResponse.json({ error: "bad request" }, { status: 400 });
    }
    const supabase = await db();
    const { data, error } = await supabase
      .from("user_documents")
      .update({ slot })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not move the document" },
      { status: 500 }
    );
  }
}
