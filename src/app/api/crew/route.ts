import { NextResponse } from "next/server";
import {
  acceptInvite,
  createCrew,
  createInvite,
  crewOf,
  removeMember,
  type CrewRole,
} from "@/lib/crew";

export const dynamic = "force-dynamic";

/** The crew you're in, with its roster. `{ crew: null }` when solo. */
export async function GET() {
  try {
    const crew = await crewOf();
    return NextResponse.json({ crew });
  } catch (err) {
    const message = err instanceof Error ? err.message : "crew failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Every crew mutation, keyed by `action` — same shape as the listing route. */
export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "create": {
        const crew = await createCrew(String(body.name ?? ""));
        return NextResponse.json({ crew });
      }
      case "invite": {
        const role: CrewRole = body.role === "partner" ? "partner" : "scout";
        const token = await createInvite(role);
        return NextResponse.json({ token });
      }
      case "accept": {
        const joined = await acceptInvite(String(body.token ?? ""));
        return NextResponse.json({ joined });
      }
      case "remove": {
        await removeMember(String(body.userId ?? ""));
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "crew failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
