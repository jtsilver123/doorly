import { adminDb } from "@/lib/supabase";
import { pipelineOwnerId } from "@/lib/crew";
import { DEFAULT_CRITERIA, searchKey } from "@/lib/criteria";

/**
 * Hunts, plural.
 *
 * People move more than once. The board from the last time is worth keeping
 * — the places, the notes, the footage, the numbers — and it has no business
 * being the board you open on day one of the next search.
 *
 * The model is deliberately lazy. Everyone starts on a hunt that has no row
 * anywhere: `user_listing_state.hunt_id` defaults to the nil UUID, and that
 * is hunt one. A `hunts` row is written the first time somebody actually
 * starts a second, at which point the first one is given a row, an end date,
 * and its listings stamped in a single pass. Until then this file costs one
 * indexed lookup and changes nothing about how the app behaves.
 */

/** The hunt everybody is on before they have ever started another. */
export const FIRST_HUNT = "00000000-0000-0000-0000-000000000000";

export interface Hunt {
  id: string;
  startedAt: string;
  endedAt: string | null;
  wonListingId: string | null;
  label: string;
}

function toHunt(row: Record<string, unknown>): Hunt {
  return {
    id: row.id as string,
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string) ?? null,
    wonListingId: (row.won_listing_id as string) ?? null,
    label: (row.label as string) ?? "",
  };
}

/**
 * The hunt whose board is the live one.
 *
 * Falls back to the nil UUID rather than throwing or returning null: an
 * account that has never pressed the button has a perfectly good current
 * hunt, it just has no row describing it.
 */
export async function currentHuntId(ownerId?: string): Promise<string> {
  const owner = ownerId ?? (await pipelineOwnerId());
  const { data } = await adminDb()
    .from("hunts")
    .select("id")
    .eq("owner_id", owner)
    .is("ended_at", null)
    .maybeSingle();
  return (data?.id as string) ?? FIRST_HUNT;
}

/** Every hunt this pipeline has run, newest first. */
export async function listHunts(ownerId?: string): Promise<Hunt[]> {
  const owner = ownerId ?? (await pipelineOwnerId());
  const { data } = await adminDb()
    .from("hunts")
    .select("id, started_at, ended_at, won_listing_id, label")
    .eq("owner_id", owner)
    .order("started_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map(toHunt);
}

/**
 * Close the hunt in progress and open an empty one.
 *
 * What survives is everything about the person: their name, income,
 * employer, the documents in the packet, the crew. What resets is
 * everything about this particular search: the board, the saved criteria,
 * the move-in date. That split is the whole feature, because the reason
 * anyone comes back is that the tedious half is already done.
 *
 * The old board is not deleted. It is stamped with the closing hunt's id,
 * which is what takes it off the live board while leaving it readable.
 */
export async function startNewHunt(label = ""): Promise<Hunt> {
  const supabase = adminDb();
  const owner = await pipelineOwnerId();

  const { data: openRow } = await supabase
    .from("hunts")
    .select("id, started_at")
    .eq("owner_id", owner)
    .is("ended_at", null)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const closingId = (openRow?.id as string) ?? FIRST_HUNT;

  /*
   * What the hunt being closed ended on, if anything. Read before the rows
   * move so it describes the board as it was.
   */
  const { data: wonRow } = await supabase
    .from("user_listing_state")
    .select("listing_id")
    .eq("user_id", owner)
    .eq("hunt_id", closingId)
    .eq("secured", true)
    .limit(1)
    .maybeSingle();
  const wonListingId = (wonRow?.listing_id as string) ?? null;

  if (openRow) {
    const { error } = await supabase
      .from("hunts")
      .update({ ended_at: nowIso, won_listing_id: wonListingId })
      .eq("id", closingId);
    if (error) throw new Error(`hunt: ${error.message}`);
  } else {
    /*
     * The implicit first hunt, finally written down. Dated from the earliest
     * thing on its board rather than from now, so the record says when the
     * search actually began.
     */
    const { data: firstRow } = await supabase
      .from("user_listing_state")
      .select("updated_at")
      .eq("user_id", owner)
      .eq("hunt_id", FIRST_HUNT)
      .order("updated_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase.from("hunts").insert({
      id: FIRST_HUNT,
      owner_id: owner,
      started_at: (firstRow?.updated_at as string) ?? nowIso,
      ended_at: nowIso,
      won_listing_id: wonListingId,
    });
    if (error) throw new Error(`hunt: ${error.message}`);
  }

  const { data: created, error: newErr } = await supabase
    .from("hunts")
    .insert({ owner_id: owner, started_at: nowIso, label: label.slice(0, 80) })
    .select("id, started_at, ended_at, won_listing_id, label")
    .single();
  if (newErr) throw new Error(`hunt: ${newErr.message}`);

  /*
   * The saved search goes with the old hunt. Somebody moving again is
   * looking for something else, often somewhere else, and carrying last
   * year's price ceiling into the new board would quietly filter out the
   * whole market they are now shopping in.
   *
   * A stock one takes its place rather than none at all. The feed reads no
   * active search as no filter and shows the entire shared corpus, which is
   * thousands of apartments in boroughs you are not moving to — the opposite
   * of a clean start. This is the same search a new account is given, so day
   * one of the second hunt looks like day one of the first.
   */
  await supabase
    .from("saved_searches")
    .update({ active: false })
    .eq("user_id", owner)
    .eq("active", true);
  await supabase.from("saved_searches").insert({
    user_id: owner,
    label: "Studio / 1BR downtown",
    criteria: DEFAULT_CRITERIA,
    search_key: searchKey(DEFAULT_CRITERIA),
    active: true,
  });

  return toHunt(created as Record<string, unknown>);
}
