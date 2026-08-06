"use client";

import { createBrowserClient } from "@supabase/ssr";
import { cookieDomainFor } from "@/lib/hosts";

/** Browser client. Only used for sign-in, sign-up and sign-out. */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      /*
       * Scoped to the whole domain, not the host it was set on. Signing in
       * happens on damnlease.com and the app runs on app.damnlease.com; a
       * host-only cookie would leave the user signed in on the page they
       * signed in from and signed out on the one they were headed to.
       * Undefined on localhost, where the browser drops a domain cookie.
       */
      cookieOptions: {
        domain: cookieDomainFor(
          typeof window === "undefined" ? undefined : window.location.hostname
        ),
      },
    }
  );
}
