import { NextResponse } from "next/server";
import {
  addContact,
  loadListingDetail,
  recordFeedback,
  setListingFields,
  setStage,
} from "@/lib/feed";
import type { ContactLog, Stage } from "@/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const detail = await loadListingDetail(id);
    return NextResponse.json(detail ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "detail failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** One endpoint for every per-listing mutation, keyed by `action`. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "stage":
        await setStage(id, body.stage as Stage);
        break;
      case "star":
        await setListingFields(id, { starred: Boolean(body.starred) });
        break;
      case "notes":
        await setListingFields(id, { notes: String(body.notes ?? "") });
        break;
      case "followUp":
        await setListingFields(id, {
          follow_up_at: (body.followUpAt as string | null) ?? null,
        });
        break;
      case "visit":
        await setListingFields(id, { visited_at: new Date().toISOString() });
        break;
      case "seen":
        await setListingFields(id, { events_seen_at: new Date().toISOString() });
        break;
      case "feedback":
        await recordFeedback(id, body.value === "like" ? "like" : "pass");
        break;
      case "contact":
        await addContact(id, {
          channel: (body.channel as ContactLog["channel"]) ?? "email",
          direction: body.direction === "in" ? "in" : "out",
          who: String(body.who ?? ""),
          note: String(body.note ?? ""),
        });
        break;
      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
