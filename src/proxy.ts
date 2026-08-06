import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh + auth gate. (Next 16 renamed `middleware` to `proxy`.)
 *
 * Supabase access tokens are short-lived, so every request refreshes the
 * session and writes the rotated cookies back — without this, users get signed
 * out mid-session. It also keeps signed-out visitors out of the app itself.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  /*
   * One address. Vercel serves every deployment on its own generated
   * hostname too, and people bookmark whatever's in the bar — which strands
   * them on a frozen build with yesterday's UI against today's data. Any
   * .vercel.app host that isn't the canonical one bounces there, path and
   * query intact. APIs are exempt: the cron invokes by deployment URL, and
   * a redirect mid-cron is a silently skipped poll.
   */
  const canonical = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const host = request.headers.get("host") ?? "";
  if (
    canonical &&
    host.endsWith(".vercel.app") &&
    !canonical.includes(host) &&
    !request.nextUrl.pathname.startsWith("/api")
  ) {
    return NextResponse.redirect(
      new URL(request.nextUrl.pathname + request.nextUrl.search, canonical),
      308
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
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

  const path = request.nextUrl.pathname;
  const isAuthRoute =
    path.startsWith("/login") || path.startsWith("/signup") || path.startsWith("/auth");
  const isWelcome = path.startsWith("/welcome");
  // Invite links arrive from group chats, signed out more often than not.
  const isJoin = path.startsWith("/join/");
  // The cron endpoint authenticates with a shared secret, not a session.
  const isCron = path.startsWith("/api/cron");

  // The root is the marketing site for everyone now — the app lives at /app.
  // The social card rides along: link unfurlers have no session and give up
  // on a redirect.
  // The service worker must load without a session — the browser fetches it
  // in its own context, cookieless, and a 307 to /login kills push silently.
  const isLanding =
    path === "/" || path === "/opengraph-image" || path === "/sw.js";

  if (!user && !isAuthRoute && !isCron && !isLanding) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    const redirectResponse = NextResponse.redirect(to);
    // Remember the invite across signup, so the link survives the detour.
    if (isJoin) {
      redirectResponse.cookies.set("pending_invite", path.split("/")[2] ?? "", {
        path: "/",
        maxAge: 60 * 60 * 24,
        httpOnly: true,
        sameSite: "lax",
      });
    }
    return redirectResponse;
  }
  if (user && isAuthRoute && !path.startsWith("/auth")) {
    const to = request.nextUrl.clone();
    to.pathname = "/app";
    return NextResponse.redirect(to);
  }

  // A signed-in account with no saved search has nothing to show, so send it to
  // setup. Checked here rather than in the page so every route is covered, and
  // skipped for API calls so onboarding itself can save. The landing is also
  // exempt — reading the pitch while signed in shouldn't teleport you to setup.
  if (user && !isWelcome && !isJoin && !isLanding && !path.startsWith("/api")) {
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
        const to = request.nextUrl.clone();
        to.pathname = "/welcome";
        return NextResponse.redirect(to);
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
