"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

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
 * Decided here rather than left to the proxy: a server-action redirect doesn't
 * re-enter middleware, so relying on it would flash the empty app before
 * bouncing to setup.
 */
async function landingPath(): Promise<string> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return "/login";

  // An invite link that bounced through signup finishes its journey first —
  // the person clicked "join Emma's search", not "set up your own".
  const jar = await cookies();
  const invite = jar.get("pending_invite")?.value;
  if (invite) {
    jar.delete("pending_invite");
    return `/join/${invite}`;
  }

  const { count } = await supabase
    .from("saved_searches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", data.user.id);
  if (count) return "/";

  // No search of their own, but a crew to work: scouts and partners came for
  // somebody else's pipeline, and setup would ask them to start their own.
  const { count: crews } = await supabase
    .from("crew_members")
    .select("crew_id", { count: "exact", head: true })
    .eq("user_id", data.user.id);
  return crews ? "/" : "/welcome";
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

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // Into auth metadata AND the profile below: metadata survives even if
    // the profile write fails, and Google users get theirs the same way.
    options: { data: { name } },
  });
  if (error) return { error: error.message };

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
    return { message: `Check ${email} for a confirmation link, then sign in.` };
  }

  revalidatePath("/", "layout");
  redirect(await landingPath());
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
