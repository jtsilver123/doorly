import { adminDb, currentUserId } from "@/lib/supabase";
import type { Profile } from "@/lib/outreach";

/**
 * Tag-team.
 *
 * A crew is a group of people around one pipeline — the pipeline of whoever
 * created it. Two roles, matching the two ways people actually hunt together:
 *
 *   scout    a friend or parent helping someone who'll live alone. They can
 *            put places into the pipeline (attributed to them) and see how
 *            it's going, but the hunt belongs to the person moving.
 *
 *   partner  a roommate or couple searching as one. Full access to the shared
 *            pipeline, and every listing carries a *point person* so both of
 *            you never text the same agent.
 *
 * Being in a crew points your pipeline reads and writes at the crew owner's
 * rows — that's `pipelineOwnerId()`, used by every state query in feed.ts.
 * Feedback (the taste model) and saved searches stay personal.
 *
 * Everything here goes through the admin client on purpose: membership is the
 * thing RLS policies are *built from*, so resolving it can't itself depend on
 * them. Every function still authenticates the caller first.
 */

export type CrewRole = "partner" | "scout";

export interface CrewMember {
  userId: string;
  email: string;
  name: string;
  role: CrewRole | "owner";
  isYou: boolean;
}

export interface CrewInfo {
  id: string;
  name: string;
  /** Your role in it. The owner acts as a partner with admin rights. */
  role: CrewRole | "owner";
  ownerId: string;
  members: CrewMember[];
}

interface MembershipRow {
  crew_id: string;
  role: string;
  crews: { id: string; name: string; owner: string } | null;
}

/** The crew the signed-in user belongs to (owning one counts), or null. */
export async function crewOf(userId?: string): Promise<CrewInfo | null> {
  const uid = userId ?? (await currentUserId());
  const admin = adminDb();

  // Owner first, member second — the unique index keeps it to one of each.
  const [{ data: owned }, { data: membership }] = await Promise.all([
    admin.from("crews").select("id, name, owner").eq("owner", uid).maybeSingle(),
    admin
      .from("crew_members")
      .select("crew_id, role, crews (id, name, owner)")
      .eq("user_id", uid)
      .maybeSingle<MembershipRow>(),
  ]);

  const crew = owned ?? membership?.crews ?? null;
  if (!crew) return null;
  const role: CrewInfo["role"] = owned ? "owner" : (membership!.role as CrewRole);

  // Everyone in it, named. Names come from profiles; emails from auth, since
  // a profile might be empty and "somebody" is not an attribution.
  const { data: memberRows } = await admin
    .from("crew_members")
    .select("user_id, role")
    .eq("crew_id", crew.id);
  const ids = [crew.owner, ...(memberRows ?? []).map((m) => m.user_id)];

  const [{ data: profiles }, { data: authUsers }] = await Promise.all([
    admin.from("user_profile").select("user_id, profile").in("user_id", ids),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const nameOf = new Map(
    (profiles ?? []).map((p) => [p.user_id, ((p.profile as Profile)?.name ?? "").trim()])
  );
  const emailOf = new Map(
    (authUsers?.users ?? []).map((u) => [u.id, u.email ?? ""])
  );

  const member = (id: string, role: CrewMember["role"]): CrewMember => ({
    userId: id,
    email: emailOf.get(id) ?? "",
    name: nameOf.get(id) || (emailOf.get(id) ?? "").split("@")[0] || "Someone",
    role,
    isYou: id === uid,
  });

  return {
    id: crew.id,
    name: crew.name,
    role,
    ownerId: crew.owner,
    members: [
      member(crew.owner, "owner"),
      ...(memberRows ?? []).map((m) => member(m.user_id, m.role as CrewRole)),
    ],
  };
}

/**
 * Whose pipeline your actions land in: the crew owner's if you're in a crew,
 * your own otherwise. Every user_listing_state / contact_log query routes
 * through this.
 */
export async function pipelineOwnerId(): Promise<string> {
  const uid = await currentUserId();
  const crew = await crewOf(uid);
  return crew ? crew.ownerId : uid;
}

export async function createCrew(name: string): Promise<CrewInfo> {
  const uid = await currentUserId();
  const existing = await crewOf(uid);
  if (existing) return existing;
  const { error } = await adminDb()
    .from("crews")
    .insert({ name: name.trim() || "Our search", owner: uid });
  if (error) throw new Error(error.message);
  return (await crewOf(uid))!;
}

/** A single-use invite link. The token is the authorisation. */
export async function createInvite(role: CrewRole): Promise<string> {
  const uid = await currentUserId();
  const crew = await crewOf(uid);
  if (!crew || crew.role !== "owner") throw new Error("only the crew owner can invite");
  const { data, error } = await adminDb()
    .from("crew_invites")
    .insert({ crew_id: crew.id, role, created_by: uid })
    .select("token")
    .single();
  if (error) throw new Error(error.message);
  return data.token as string;
}

export async function acceptInvite(token: string): Promise<{ crewName: string }> {
  const uid = await currentUserId();
  const admin = adminDb();

  const { data: invite } = await admin
    .from("crew_invites")
    .select("token, crew_id, role, accepted_by, crews (name, owner)")
    .eq("token", token)
    .maybeSingle();
  if (!invite) throw new Error("This invite doesn't exist — ask for a fresh link.");
  if (invite.accepted_by && invite.accepted_by !== uid) {
    throw new Error("This invite was already used — ask for a fresh link.");
  }
  const crewMeta = invite.crews as unknown as { name: string; owner: string };
  if (crewMeta.owner === uid) return { crewName: crewMeta.name };

  // One crew per person: joining a second one is a swap the UI should make
  // explicit, not something a link click does silently.
  const already = await crewOf(uid);
  if (already && already.id !== invite.crew_id) {
    throw new Error(
      `You're already searching with "${already.name}" — leave that crew first, then use this link again.`
    );
  }

  const { error } = await admin.from("crew_members").upsert(
    { crew_id: invite.crew_id, user_id: uid, role: invite.role },
    { onConflict: "crew_id,user_id" }
  );
  if (error) throw new Error(error.message);
  await admin
    .from("crew_invites")
    .update({ accepted_by: uid, accepted_at: new Date().toISOString() })
    .eq("token", token);
  return { crewName: crewMeta.name };
}

/** Leaving as a member, or removing someone as the owner. */
export async function removeMember(targetUserId: string): Promise<void> {
  const uid = await currentUserId();
  const crew = await crewOf(uid);
  if (!crew) return;
  const removingSelf = targetUserId === uid;
  if (!removingSelf && crew.role !== "owner") {
    throw new Error("only the crew owner can remove people");
  }
  if (removingSelf && crew.role === "owner") {
    // The owner leaving is the crew ending — their pipeline is the crew.
    const { error } = await adminDb().from("crews").delete().eq("id", crew.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await adminDb()
    .from("crew_members")
    .delete()
    .eq("crew_id", crew.id)
    .eq("user_id", targetUserId);
  if (error) throw new Error(error.message);
}
