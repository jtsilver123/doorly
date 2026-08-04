import { NextResponse } from "next/server";
import { db, currentUserId } from "@/lib/supabase";
import { loadSearches } from "@/lib/feed";
import { normalizeCriteria, searchKey } from "@/lib/criteria";
import { saveProfile } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ searches: await loadSearches() });
  } catch {
    return NextResponse.json({ searches: [] });
  }
}

/** Creates or replaces a saved search. Used by onboarding and by editing. */
export async function POST(request: Request) {
  const body = await request.json();
  const criteria = normalizeCriteria(body.criteria ?? {});
  if (!criteria.areas.length) {
    return NextResponse.json({ error: "Pick at least one neighborhood." }, { status: 400 });
  }

  try {
    const supabase = await db();
    const userId = await currentUserId();

    const { error } = await supabase.from("saved_searches").upsert(
      {
        user_id: userId,
        label: String(body.label || "My search"),
        criteria,
        search_key: searchKey(criteria),
        active: true,
      },
      { onConflict: "user_id,search_key" }
    );
    if (error) throw new Error(error.message);

    // Onboarding sends the move-in date alongside the search, since both are
    // answers to the same question: what are you actually looking for?
    if (body.moveInDate || body.name) {
      await saveProfile({
        ...(body.name ? { name: String(body.name) } : {}),
        ...(body.moveInDate ? { moveInDate: String(body.moveInDate) } : {}),
      });
    }

    return NextResponse.json({ ok: true, searches: await loadSearches() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { searchKey: key } = await request.json();
  try {
    const supabase = await db();
    await supabase
      .from("saved_searches")
      .delete()
      .eq("user_id", await currentUserId())
      .eq("search_key", String(key));
    return NextResponse.json({ ok: true, searches: await loadSearches() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
