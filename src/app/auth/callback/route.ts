import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { cookieDomainFor, originsFor } from "@/lib/hosts";
import { safeNext } from "@/lib/nextPath";

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
  /*
   * Where to go once the code is spent. A password-reset link points here with
   * `next=/reset`; everything else lands on the board. Only same-site paths are
   * honoured, so a crafted link can't turn our own callback into an open
   * redirect to somebody else's site.
   */
  const requested = request.nextUrl.searchParams.get("next");
  const next = requested ? safeNext(requested, "") || null : null;

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
      const origins = originsFor(host);
      /*
       * A reset has to finish on the marketing host, because that is where the
       * form lives and where the session cookie was just written. Everything
       * else belongs on the app host.
       */
      const base = next
        ? (origins?.marketing ?? request.url)
        : (origins?.app ?? request.url);
      const to = NextResponse.redirect(
        new URL(next ?? (invite ? `/join/${invite}` : "/app"), base)
      );
      // Set with a domain, so it only clears when deleted with the same one.
      if (invite) to.cookies.set("pending_invite", "", { domain: cookieDomainFor(host), path: "/", maxAge: 0 });
      return to;
    }
  }

  // This route lands both the Google round trip and the password-reset link,
  // so the failure has to name neither.
  const to = new URL(next === "/reset" ? "/reset" : "/login", request.url);
  to.searchParams.set(
    "error",
    next === "/reset"
      ? "That reset link has expired or was already used. Ask for a new one."
      : "That sign-in link didn't complete. Try again."
  );
  return NextResponse.redirect(to);
}
