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

  if (!user && !isAuthRoute && !isCron) {
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
    to.pathname = "/";
    return NextResponse.redirect(to);
  }

  // A signed-in account with no saved search has nothing to show, so send it to
  // setup. Checked here rather than in the page so every route is covered, and
  // skipped for API calls so onboarding itself can save.
  if (user && !isWelcome && !isJoin && !path.startsWith("/api")) {
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
