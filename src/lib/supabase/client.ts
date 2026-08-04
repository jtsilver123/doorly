"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser client. Only used for sign-in, sign-up and sign-out. */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
