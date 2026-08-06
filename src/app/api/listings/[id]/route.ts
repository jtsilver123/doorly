import { NextResponse } from "next/server";
import {
  addContact,
  loadListingDetail,
  recordFeedback,
  setListingFields,
  setStage,
  passListing,
  undoPass,
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
      case "star": {
        const starred = Boolean(body.starred);
        await setListingFields(id, { starred });
        // Starring is liking, and anything liked belongs on the board:
        // recordFeedback trains the ranker and promotes inbox → interested.
        if (starred) await recordFeedback(id, "like");
        break;
      }

      case "poc":
        // Who owns talking to the agent for this one — tag-team only.
        await setListingFields(id, {
          poc_user_id: body.userId ? String(body.userId) : null,
        });
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
      case "contactDetails":
        // Yours, not the listing's: a number you dug up isn't a fact about the
        // apartment, and shouldn't be published to anyone else searching it.
        await setListingFields(id, {
          contact_phone: String(body.phone ?? "").slice(0, 40),
          contact_email: String(body.email ?? "").slice(0, 200),
          contact_name: String(body.who ?? "").slice(0, 120),
        });
        break;

      case "applicationUrl": {
        // Pasted from a text thread, so be forgiving: bare domains get a
        // scheme, anything else non-empty that can't parse is dropped.
        let url = String(body.url ?? "").trim().slice(0, 500);
        if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
        try {
          if (url) new URL(url);
        } catch {
          url = "";
        }
        await setListingFields(id, { application_url: url });
        break;
      }

      case "tourAt":
        await setListingFields(id, {
          tour_at: body.tourAt ? String(body.tourAt) : null,
          tour_kind: body.tourKind === "open_house" ? "open_house" : "private",
          // An end time only means something for an open-house window.
          tour_ends_at:
            body.tourKind === "open_house" && body.tourEndsAt
              ? String(body.tourEndsAt)
              : null,
        });
        // A time implies the tour is booked; saying so saves a second click.
        if (body.tourAt) await setStage(id, "tour");
        break;

      case "myScore": {
        // Null clears it and hands the listing back to the computed rating.
        // Anything else is clamped rather than rejected — a slider or a typed
        // "150" should land on 100, not throw away the edit.
        const raw = body.myScore;
        const parsed = raw == null || raw === "" ? null : Number(raw);
        const score =
          parsed == null || !Number.isFinite(parsed)
            ? null
            : Math.min(100, Math.max(1, Math.round(parsed)));
        await setListingFields(id, { my_score: score });
        break;
      }

      case "pass":
        // The reason travels with the pass so the two can't disagree.
        await passListing(id, String(body.reason ?? ""));
        break;

      case "unpass":
        await undoPass(id);
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
