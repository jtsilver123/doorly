import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * In solo mode every per-user row carries this id. It is the default on the
 * column, so inserts can omit it; queries still filter by it explicitly so that
 * switching to real auth is a one-line change here.
 */
export const SOLO_USER_ID = "00000000-0000-0000-0000-000000000001";

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and fill in " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Current user id. Swap this for the session user when auth lands. */
export function currentUserId(): string {
  return SOLO_USER_ID;
}
