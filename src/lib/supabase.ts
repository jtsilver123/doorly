import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer, currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The database handle the app reads and writes through.
 *
 * Always request-scoped, never a module singleton: a cached client would carry
 * one user's session into another user's request. Every call re-reads the
 * cookies, so RLS decides what's visible rather than the application.
 */
export async function db(): Promise<SupabaseClient> {
  return supabaseServer();
}

/** Service-role handle. Ingest only — it bypasses RLS by design. */
export function adminDb(): SupabaseClient {
  return supabaseAdmin();
}

/** Signed-in user's id. Throws rather than silently reading someone else's rows. */
export async function currentUserId(): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error("not signed in");
  return user.id;
}

export { currentUser };
