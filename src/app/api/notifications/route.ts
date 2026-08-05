import { NextResponse } from "next/server";
import { db, currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** The bell's contents: latest first, with the unread count for the badge. */
export async function GET() {
  try {
    const supabase = await db();
    const userId = await currentUserId();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = data ?? [];
    return NextResponse.json({
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        listingId: n.listing_id,
        title: n.title,
        body: n.body,
        createdAt: n.created_at,
        read: n.read_at != null,
      })),
      unread: rows.filter((n) => n.read_at == null).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "notifications failed";
    return NextResponse.json({ error: message, notifications: [], unread: 0 }, { status: 500 });
  }
}

/** Opening the bell reads everything — badges are for the unseen, not a todo list. */
export async function PATCH() {
  try {
    const supabase = await db();
    const userId = await currentUserId();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "mark read failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
