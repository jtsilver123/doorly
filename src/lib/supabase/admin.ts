import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS, so it is the *only* thing allowed to write
 * shared market data — the scraper writes listings once for everybody.
 *
 * Never import this into anything that runs in the browser. It is used solely
 * by the ingest pipeline and the cron route.
 */
export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Scraping needs SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard → " +
        "Project Settings → API → service_role). Keep it server-side only."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
