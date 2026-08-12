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
 * Bumped when the auth cookie's scope changes, so the one-time retirement
 * below runs once per browser rather than on every request forever.
 */
const SCOPE_MARK = "dl_scope1";

/**
 * Clear host-only auth cookies, so a stale copy can't shadow a real session.
 *
 * A browser will happily hold two cookies with the same name — one host-only
 * from before the marketing/app split, one domain-scoped from after — and send
 * both on every request. The server reads whichever the header order hands it,
 * so a stale copy can shadow a perfectly good session: sign in, get bounced
 * back to login, sign in again, forever. It survives a password reset, because
 * the password was never the problem.
 *
 * Two moments are safe to clear them, and this runs at both:
 *
 *  - Once per browser, marked by `SCOPE_MARK`, to retire cookies written
 *    before the split existed. Carrying their value over into a domain-scoped
 *    cookie would avoid a re-login, but it can't be done in one response:
 *    Next's cookie store is a map keyed by name, so it will not emit two
 *    Set-Cookie lines for one name and it clears any raw header appended
 *    alongside. So they're expired instead and everyone signs in once more.
 *
 *  - Any time auth cookies are present and still resolve to nobody. They are
 *    junk by definition then, there is no session left to protect, and this is
 *    what breaks the loop for a user already stuck in it — on every request,
 *    because a browser can acquire a stale copy again at any time.
 */
function clearHostOnlyCookies(
  request: NextRequest,
  response: NextResponse,
  domain: string,
  signedIn: boolean
): NextResponse {
  const marked = request.cookies.has(SCOPE_MARK);
  // Signed in and already past the one-time retirement: nothing to do, and
  // nothing worth risking.
  if (marked && signedIn) return response;
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
  if (!marked) {
    response.cookies.set(SCOPE_MARK, "1", { domain, path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const host = request.headers.get("host") ?? "";
  const path = request.nextUrl.pathname;
  const search = request.nextUrl.search;
  const isApi = path.startsWith("/api");
  const domain = cookieDomainFor(host);
  // Filled in once `getUser()` has run; every early return below happens
  // before there is any session to reason about.
  let signedIn = false;
  const finish = (res: NextResponse) =>
    domain ? clearHostOnlyCookies(request, res, domain, signedIn) : res;

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

  // One spelling of the marketing host. www serves the same Worker, and two
  // URLs for one page is how link previews, analytics and search results end
  // up split between them.
  if (host.split(":")[0].startsWith("www.") && origins) {
    return NextResponse.redirect(new URL(path + search, origins.marketing), 308);
  }

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
  signedIn = Boolean(user);

  const isAuthRoute =
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/auth") ||
    path.startsWith("/forgot") ||
    path.startsWith("/reset");
  /*
   * Setting a new password is the one auth screen a signed-in person is
   * allowed to sit on. A recovery link signs you in *before* it shows you the
   * form, so the usual "you're logged in, go to the app" bounce would throw
   * you off the page you were sent to — and it doubles as change-your-password
   * for anyone already in.
   */
  const isPasswordSet = path.startsWith("/reset");
  const isWelcome = path.startsWith("/welcome");
  // Invite links arrive from group chats, signed out more often than not.
  const isJoin = path.startsWith("/join/");
  // The cron endpoint authenticates with a shared secret, not a session.
  const isCron = path.startsWith("/api/cron");
  /*
   * The hunt estimator runs on the landing page, before an account exists.
   * The whole claim is "this is a definable process" — gating the definition
   * behind a sign-up would be the joke telling itself. It returns aggregate
   * counts and a median asking price; nothing personal crosses it.
   */
  const isPublicApi =
    path === "/api/estimate" ||
    // The feed serves a read-only corpus view to visitors — the route picks
    // guest vs personal by session, and guests never touch personal tables.
    path === "/api/feed" ||
    // A single listing's public record (events, price history) and its
    // building's city record read the same shared data. GET only: the
    // PATCH on the listing path stays gated. The media list rides along
    // for share-link visitors — the route itself only answers a ?via=
    // naming whose footage, with signed URLs; and the byte reader accepts
    // those signatures in place of a session.
    (request.method === "GET" &&
      /^\/api\/listings\/[^/]+(\/intel|\/records|\/history|\/media)?$/.test(path)) ||
    (request.method === "GET" && path.startsWith("/api/media/"));

  /*
   * The app itself is the shop window. A visitor lands straight on the
   * board and the listings — real corpus data, nobody's personal state —
   * and the account modal appears the moment they try to DO anything (the
   * write APIs still answer 401, and the client turns that into the
   * create-account flow). Only viewing is free; /you stays gated since an
   * account page for no account is a koan.
   */
  const isGuestShell =
    request.method === "GET" &&
    ["/pipeline", "/listings", "/compare", "/apply", "/app"].includes(path);

  /*
   * The social card rides along: link unfurlers have no session and give up
   * on a redirect. The service worker must load without a session too — the
   * browser fetches it in its own context, cookieless, and a 307 to /login
   * kills push silently. Both are served from whichever host asked.
   *
   * The root is the pitch on the marketing host and the app on the app host,
   * which is the whole point of the split.
   */
  const isLanding =
    path === "/opengraph-image" ||
    path === "/apple-icon" ||
    path === "/sw.js" ||
    // Crawler plumbing is public by definition: a robots file behind a
    // login redirect reads as "Disallow: nothing works".
    path === "/sitemap.xml" ||
    path === "/robots.txt" ||
    // Privacy and terms are the pages people read *before* deciding to sign
    // up, and the ones a store or a link-checker fetches with no session at
    // all. Gating them behind login is the classic way to make a policy page
    // useless.
    path === "/privacy" ||
    path === "/terms" ||
    (path === "/" && !onApp);

  /*
   * Signing in stays on the marketing host, always. Google's callback has to
   * land on an origin Supabase has been told to allow, and there is exactly
   * one of those — so the app host forwards its auth traffic home rather than
   * quietly failing the OAuth round trip.
   */
  if (onApp && isAuthRoute && origins) {
    return finish(NextResponse.redirect(new URL(path + search, origins.marketing), 307));
  }

  if (!user && !isAuthRoute && !isCron && !isPublicApi && !isLanding && !isGuestShell) {
    /*
     * APIs answer 401, pages redirect. A fetch() that gets a 307 to /login
     * follows it silently and hands the caller a login page with a 200 on it,
     * which the client then tries to parse as JSON. The error belongs at the
     * status code, where the client is actually looking.
     */
    if (isApi) {
      return finish(
        NextResponse.json({ error: "not signed in" }, { status: 401 })
      );
    }
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
  if (user && isAuthRoute && !path.startsWith("/auth") && !isPasswordSet) {
    const to = origins ? new URL("/pipeline", origins.app) : request.nextUrl.clone();
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

  // The app host's front door is the board, not the pitch. The old /app
  // address redirects too, hash and all — the hash never reaches the server,
  // so the browser carries #compare across and the client honors it.
  if (onApp && origins && (path === "/" || path === "/app")) {
    return finish(NextResponse.redirect(new URL(`/pipeline${search}`, origins.app), 307));
  }

  // The clean section addresses (/pipeline, /listings, /compare, /you)
  // rewrite to the app shell in next.config.ts. Config-level, not here: a
  // middleware rewrite re-enters the worker's router without this request's
  // context and bounced signed-in people to a login page they didn't need.
  return finish(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
