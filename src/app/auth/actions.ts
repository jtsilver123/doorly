"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
  const { count } = await supabase
    .from("saved_searches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", data.user.id);
  return count ? "/" : "/welcome";
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
  if (!email || !password) return { error: "Email and password are both needed." };
  if (password.length < 8) return { error: "Use at least 8 characters." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

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
