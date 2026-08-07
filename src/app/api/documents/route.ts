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
