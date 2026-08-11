"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { cookieDomainFor, originsFor } from "@/lib/hosts";

/**
 * Email + password auth. Deliberately the simplest thing that works: this is a
 * tool you and a few friends use, not a product, so there's no OAuth dance and
 * no password-strength theatre beyond what Supabase already enforces.
 */

export interface AuthResult {
  error?: string;
  message?: string;
}

/**
 * Where to send someone after they authenticate.
 *
 * Decided here rather than left to the middleware: a server-action redirect
 * doesn't re-enter middleware, so relying on it would flash the empty app
 * before bouncing to setup.
 *
 * The destination is absolute, because signing in happens on the marketing
 * host and the app answers on its own. Locally there's no such split and
 * these stay relative paths.
 */
async function landingPath(): Promise<string> {
  const host = (await headers()).get("host");
  const origins = originsFor(host);
  const onApp = (path: string) => (origins ? `${origins.app}${path}` : path);

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return origins ? `${origins.marketing}/login` : "/login";

  // An invite link that bounced through signup finishes its journey first —
  // the person clicked "join Emma's search", not "set up your own".
  const jar = await cookies();
  const invite = jar.get("pending_invite")?.value;
  if (invite) {
    jar.set("pending_invite", "", { domain: cookieDomainFor(host), path: "/", maxAge: 0 });
    return onApp(`/join/${invite}`);
  }

  const { count } = await supabase
    .from("saved_searches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", data.user.id);
  if (count) return onApp("/pipeline");

  // No search of their own, but a crew to work: scouts and partners came for
  // somebody else's pipeline, and setup would ask them to start their own.
  const { count: crews } = await supabase
    .from("crew_members")
    .select("crew_id", { count: "exact", head: true })
    .eq("user_id", data.user.id);
  return onApp(crews ? "/pipeline" : "/welcome");
}

export async function signIn(_prev: AuthResult, formData: FormData): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are both needed." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase says "Invalid login credentials" for both wrong password and
    // unknown account, which is the right thing — don't leak which it was.
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect(await landingPath());
}

export async function signUp(_prev: AuthResult, formData: FormData): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!email || !password) return { error: "Email and password are both needed." };
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (!name) return { error: "Tell us your name — it's how your crew sees you." };

  const origins = originsFor((await headers()).get("host"));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Into auth metadata AND the profile below: metadata survives even if
      // the profile write fails, and Google users get theirs the same way.
      data: { name },
      // Say where the confirmation link should land instead of leaning on
      // the project's Site URL, which is one dashboard edit away from
      // sending everybody to the wrong host.
      ...(origins
        ? { emailRedirectTo: `${origins.marketing}/auth/callback?next=${encodeURIComponent("/welcome")}` }
        : {}),
    },
  });
  if (error) {
    /*
     * Supabase's built-in mailer allows only a couple of messages an hour
     * across the whole project, and when it refuses, NO account is created
     * — the person is simply turned away. Its own wording ("email rate
     * limit exceeded") reads like our bug, so say what actually happened
     * and offer the door that always works.
     */
    if (/rate limit/i.test(error.message)) {
      return {
        error:
          "We couldn't send the confirmation email just now — our mail service is throttled. Try again in a few minutes, or use Continue with Google, which needs no email.",
      };
    }
    return { error: error.message };
  }

  /*
   * The address already has an account.
   *
   * Supabase answers a repeated signup with a success shaped exactly like a
   * new one — an obfuscated user, no session — so it never confirms to a
   * stranger which addresses are registered. It also sends no email. We used
   * to print "check your inbox" anyway, which is the one reply guaranteed to
   * waste somebody's afternoon: they wait for mail that was never sent.
   * An empty identities array is the documented tell.
   */
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return {
      error:
        "That email already has an account. Sign in instead — and if you started with Google, use Continue with Google.",
    };
  }

  // The whole point of asking: "via Emma" instead of "via emma.k.92". Only
  // possible immediately when signup returns a session (no email confirm).
  if (data.session && data.user) {
    await supabase.from("user_profile").upsert(
      {
        user_id: data.user.id,
        profile: { name },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  }

  // With email confirmation on, there's a session only after the link is
  // clicked. Say which happened rather than dumping the user on a blank app.
  if (!data.session) {
    return {
      message: `Check ${email} for a confirmation link, then sign in. It can take a minute, and it does land in spam sometimes.`,
    };
  }

  revalidatePath("/", "layout");
  redirect(await landingPath());
}

/**
 * Ask for a reset link.
 *
 * The reply is identical whether or not the address has an account, and that
 * is the whole security of this screen: a form that says "no such user" is a
 * free tool for working out who is registered. Everything real happens in the
 * inbox, where only the owner of the address can see it.
 *
 * The link lands on the marketing host because that is the origin Supabase is
 * configured to send people back to, the same constraint the Google callback
 * lives under.
 */
export async function requestReset(
  _prev: AuthResult,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter the email you signed up with." };

  const origins = originsFor((await headers()).get("host"));
  const base = origins ? origins.marketing : "";

  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(email, {
    // `next` carries the destination through whichever landing route the
    // email template uses — see auth/callback and auth/confirm, which both
    // honour it, so either the PKCE or the token-hash template works.
    redirectTo: `${base}/auth/callback?next=${encodeURIComponent("/reset")}`,
  });

  // Deliberately not branching on the result. A rate-limit or an unknown
  // address both end here, saying the same thing.
  return {
    message: `If ${email} has an account, a reset link is on its way. It expires in an hour.`,
  };
}

/**
 * Set the new password.
 *
 * Reached with a live session: the recovery link signs the user in before it
 * hands them this form, which is what authorises the change. A signed-in user
 * who simply wants a new password lands here too, and gets the same path.
 *
 * Other sessions are cut afterwards. Someone resetting a password has often
 * just decided that somebody else might have it, and leaving every other
 * logged-in device untouched would make the reset mostly ceremonial.
 */
export async function updatePassword(
  _prev: AuthResult,
  formData: FormData
): Promise<AuthResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "Those two don't match." };

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return {
      error: "That reset link has expired. Ask for a new one and use it within the hour.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  await supabase.auth.signOut({ scope: "others" });

  revalidatePath("/", "layout");
  redirect(await landingPath());
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  // Signing out from the app lands back on the marketing side, where the
  // sign-in form lives.
  const origins = originsFor((await headers()).get("host"));
  redirect(origins ? `${origins.marketing}/login` : "/login");
}
