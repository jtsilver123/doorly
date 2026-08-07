import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNext } from "@/lib/nextPath";

/**
 * Target of the confirmation link in Supabase's email, for templates that use
 * a token hash rather than the PKCE code that `/auth/callback` handles. Both
 * shapes are supported because the template is configured in a dashboard, not
 * in this repo, and a password reset that only works for one of them is a
 * support ticket nobody can debug from the outside.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token_hash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  // Same-site paths only; see lib/nextPath.
  const next = safeNext(params.get("next"));

  if (token_hash && type) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  const to = new URL("/login", request.url);
  to.searchParams.set("error", "That confirmation link is invalid or has expired.");
  return NextResponse.redirect(to);
}
