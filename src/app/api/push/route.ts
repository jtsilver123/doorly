import { NextResponse } from "next/server";
import { db, currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * A browser saying yes to device notifications.
 *
 * The endpoint is the primary key, so re-subscribing the same browser (which
 * happens on every permission re-grant) updates in place instead of piling
 * up rows that all push to the same phone.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return NextResponse.json({ error: "not a push subscription" }, { status: 400 });
    }
    const supabase = await db();
    await supabase.from("push_subscriptions").upsert(
      {
        endpoint: body.endpoint,
        user_id: await currentUserId(),
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      { onConflict: "endpoint" }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "subscribe failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Turning device notifications off for this browser. */
export async function DELETE(request: Request) {
  try {
    const { endpoint } = (await request.json()) as { endpoint?: string };
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    const supabase = await db();
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", await currentUserId());
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unsubscribe failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
