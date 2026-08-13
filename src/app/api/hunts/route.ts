import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/supabase";
import { listHunts, startNewHunt, currentHuntId } from "@/lib/hunts";
import { loadProfile, saveProfile } from "@/lib/feed";

export const dynamic = "force-dynamic";

/** The hunts this pipeline has run, and which one is live. */
export async function GET() {
  try {
    await currentUserId();
    const [hunts, current] = await Promise.all([listHunts(), currentHuntId()]);
    return NextResponse.json({ hunts, current });
  } catch {
    return NextResponse.json({ error: "sign in" }, { status: 401 });
  }
}

/**
 * Start again.
 *
 * Closes the hunt in progress and opens an empty one. The board that was
 * there stays readable as a record; what carries into the new one is
 * everything about the person rather than the search, which is the reason
 * anyone comes back to a tool like this a year later.
 */
export async function POST(request: Request) {
  try {
    await currentUserId();
    const body = await request.json().catch(() => ({}));
    const hunt = await startNewHunt(String(body.label ?? ""));

    /*
     * The profile keeps its documents, income and guarantor and loses the
     * two things that belonged to the finished search: the move-in date it
     * was paced against, and the note that the hunt had been put to bed.
     */
    const profile = await loadProfile();
    await saveProfile({ ...profile, moveInDate: "", huntSettledAt: null });

    return NextResponse.json({ hunt });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not start a new hunt" },
      { status: 500 }
    );
  }
}
