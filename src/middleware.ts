import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cookieDomainFor, isAppHost, originsFor } from "@/lib/hosts";

/**
 * Session refresh, the marketing/app host split, and the auth gate.
 *
 * Runs on the edge runtime, which is what makes this app deployable to a
 * Cloudflare Worker: Next 16 moved middleware to `proxy.ts` and pinned it to
 * the Node runtime, and OpenNext can only compile edge middleware — the two
 * are mutually exclusive, so the app stays on Next 15 where middleware is
 * edge-native. Nothing here needs Node anyway: it reads cookies, asks
 * Supabase over HTTPS who the user is, and redirects.
 *
 * Supabase access tokens are short-lived, so every request refreshes the
 * session and writes the rotated cookies back — without this, users get signed
 * out mid-session.
 */

/**
 * Bumped when the auth cookie's scope changes, so the retirement below runs
 * exactly once per browser instead of on every request forever.
 */
const SCOPE_MARK = "dl_scope1";

/**
 * Retire the pre-split auth cookies, once per browser.
 *
 * Before the split, the session cookie was host-only on damnlease.com. New
 * ones name a domain so they reach the subdomain too — but a browser will
 * happily hold both, same name, and send both on every request. The server
 * sees one `Cookie:` line with two values for one name and picks by header
 * order; once Supabase rotates the token, one of those two is a stale refresh
 * token, and spending it can invalidate the real session. Sign-in loops that
 * survive a password reset are made of exactly this.
 *
 * Carrying the old value over into a domain-scoped cookie would avoid a
 * re-login, but it can't be done in one response: Next's cookie store is a map
 * keyed by name, so it will not emit two Set-Cookie lines for one name, and it
 * clears any raw header appended alongside. So the old cookies are simply
 * expired. Everyone signs in once more, and the ambiguous state never exists.
 */
function retireHostOnlyCookies(
  request: NextRequest,
  response: NextResponse,
  domain: string
): NextResponse {
  if (request.cookies.has(SCOPE_MARK)) return response;
  // Sign-in writes the replacement cookie through a different channel than
  // this one, so stay out of its way and pick this up on the next navigation.
  if (request.nextUrl.pathname.startsWith("/auth")) return response;

  const writing = new Set(response.cookies.getAll().map((c) => c.name));
  const stale = request.cookies.getAll().filter((c) => c.name.startsWith("sb-"));
  // A response already writing that cookie is refreshing the session; the map
  // holds one entry per name, so a tombstone here would overwrite the real
  // value. Leave it and try again next request.
  if (stale.some((c) => writing.has(c.name))) return response;

  for (const { name } of stale) {
    // Deleted without a domain, which targets the host-only cookie and leaves
    // its domain-scoped replacement — a different cookie — untouched.
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  response.cookies.set(SCOPE_MARK, "1", { domain, path: "/", maxAge: 60 * 60 * 24 * 365 });
  return response;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const host = request.headers.get("host") ?? "";
  const path = request.nextUrl.pathname;
  const search = request.nextUrl.search;
  const isApi = path.startsWith("/api");
  const domain = cookieDomainFor(host);
  const finish = (res: NextResponse) =>
    domain ? retireHostOnlyCookies(request, res, domain) : res;

  /*
   * One address. Vercel serves every deployment on its own generated
   * hostname too, and people bookmark whatever's in the bar — which strands
   * them on a frozen build with yesterday's UI against today's data. Any
   * .vercel.app host that isn't the canonical one bounces there, path and
   * query intact. APIs are exempt: the cron invokes by deployment URL, and
   * a redirect mid-cron is a silently skipped poll.
   */
  const canonical = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (canonical && host.endsWith(".vercel.app") && !canonical.includes(host) && !isApi) {
    return NextResponse.redirect(new URL(path + search, canonical), 308);
  }

  /*
   * The split. Null on localhost and IPs, where there's no `app.` sibling to
   * send anyone to — dev runs on one host and every rule below no-ops.
   */
  const origins = originsFor(host);
  const onApp = Boolean(origins) && isAppHost(host);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookieOptions: { domain },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute =
    path.startsWith("/login") || path.startsWith("/signup") || path.startsWith("/auth");
  const isWelcome = path.startsWith("/welcome");
  // Invite links arrive from group chats, signed out more often than not.
  const isJoin = path.startsWith("/join/");
  // The cron endpoint authenticates with a shared secret, not a session.
  const isCron = path.startsWith("/api/cron");

  /*
   * The social card rides along: link unfurlers have no session and give up
   * on a redirect. The service worker must load without a session too — the
   * browser fetches it in its own context, cookieless, and a 307 to /login
   * kills push silently. Both are served from whichever host asked.
   *
   * The root is the pitch on the marketing host and the app on the app host,
   * which is the whole point of the split.
   */
  const isLanding = path === "/opengraph-image" || path === "/sw.js" || (path === "/" && !onApp);

  /*
   * Signing in stays on the marketing host, always. Google's callback has to
   * land on an origin Supabase has been told to allow, and there is exactly
   * one of those — so the app host forwards its auth traffic home rather than
   * quietly failing the OAuth round trip.
   */
  if (onApp && isAuthRoute && origins) {
    return finish(NextResponse.redirect(new URL(path + search, origins.marketing), 307));
  }

  if (!user && !isAuthRoute && !isCron && !isLanding) {
    const to = origins ? new URL(`/login${search}`, origins.marketing) : request.nextUrl.clone();
    if (!origins) to.pathname = "/login";
    const redirectResponse = NextResponse.redirect(to);
    // Remember the invite across signup, so the link survives the detour.
    if (isJoin) {
      redirectResponse.cookies.set("pending_invite", path.split("/")[2] ?? "", {
        domain,
        path: "/",
        maxAge: 60 * 60 * 24,
        httpOnly: true,
        sameSite: "lax",
      });
    }
    return finish(redirectResponse);
  }

  // Just signed in: straight into the app, on the app's own host.
  if (user && isAuthRoute && !path.startsWith("/auth")) {
    const to = origins ? new URL("/app", origins.app) : request.nextUrl.clone();
    if (!origins) to.pathname = "/app";
    return finish(NextResponse.redirect(to));
  }

  /*
   * A signed-in account with no saved search has nothing to show, so send it
   * to setup. Checked here rather than in the page so every route is covered,
   * and skipped for API calls so onboarding itself can save. The landing is
   * also exempt — reading the pitch while signed in shouldn't teleport you to
   * setup.
   */
  if (user && !isWelcome && !isJoin && !isLanding && !isApi) {
    const { count } = await supabase
      .from("saved_searches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (!count) {
      // A crew member doesn't need a search of their own — the pipeline they
      // came for is the owner's. Only genuinely solo fresh accounts get setup.
      const { count: crews } = await supabase
        .from("crew_members")
        .select("crew_id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (!crews) {
        const to = origins ? new URL("/welcome", origins.app) : request.nextUrl.clone();
        if (!origins) to.pathname = "/welcome";
        return finish(NextResponse.redirect(to));
      }
    }
  }

  /*
   * Signed in and on the marketing host: move over. The pitch itself stays
   * put — someone re-reading the landing page shouldn't be yanked into the
   * product — and APIs stay put too, since a 307 on a POST is a body that
   * arrives twice or not at all.
   */
  if (user && origins && !onApp && !isLanding && !isApi && !isAuthRoute) {
    return finish(NextResponse.redirect(new URL(path + search, origins.app), 307));
  }

  // The app host's front door is the board, not the pitch.
  if (onApp && origins && path === "/") {
    return finish(NextResponse.redirect(new URL(`/app${search}`, origins.app), 307));
  }

  return finish(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
