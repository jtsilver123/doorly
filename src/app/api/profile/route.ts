import { NextResponse } from "next/server";
import { loadProfile, saveProfile } from "@/lib/feed";
import { currentUser } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const [profile, user] = await Promise.all([loadProfile(), currentUser()]);
  return NextResponse.json({ profile, email: user?.email ?? "" });
}

export async function PUT(request: Request) {
  const body = await request.json();
  await saveProfile(body.profile ?? {});
  return NextResponse.json({ ok: true });
}
