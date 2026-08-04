import { NextResponse } from "next/server";
import { loadProfile, saveProfile } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ profile: await loadProfile() });
}

export async function PUT(request: Request) {
  const body = await request.json();
  await saveProfile(body.profile ?? {});
  return NextResponse.json({ ok: true });
}
