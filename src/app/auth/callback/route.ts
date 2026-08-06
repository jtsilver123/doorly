import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { cookieDomainFor, originsFor } from "@/lib/hosts";

/**
 * OAuth landing.
 *
 * Google (via Supabase) sends the browser back here with a one-time code;
 * exchanging it is what actually signs the user in. PKCE end to end — the
 * browser client planted the verifier cookie before it left, so the code is
 * useless to anyone who merely intercepts the redirect.
 *
 * After that it follows the same rules as password sign-in: a pending crew
 * invite finishes its journey first, and the middleware's welcome gate
 * handles fresh accounts from there.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const invite = request.cookies.get("pending_invite")?.value;
      /*
       * Sign-in happens on the marketing host — it's the origin Supabase is
       * configured to allow — but the destination is the app, which lives on
       * its own. The session cookie is domain-scoped, so it comes along.
       */
      const host = request.headers.get("host");
      const base = originsFor(host)?.app ?? request.url;
      const to = NextResponse.redirect(new URL(invite ? `/join/${invite}` : "/app", base));
      // Set with a domain, so it only clears when deleted with the same one.
      if (invite) to.cookies.set("pending_invite", "", { domain: cookieDomainFor(host), path: "/", maxAge: 0 });
      return to;
    }
  }

  const to = new URL("/login", request.url);
  to.searchParams.set("error", "Google sign-in didn't complete — try again.");
  return NextResponse.redirect(to);
}
