import { NextResponse } from "next/server";
import { loadConfig, saveConfig, getUsage, keyHint, nextCheckDue } from "@/lib/apikey";

export const dynamic = "force-dynamic";

/** Never returns the key itself — only enough to recognise which one is set. */
export async function GET() {
  const [config, usage, schedule] = await Promise.all([
    loadConfig(),
    getUsage(),
    nextCheckDue().catch(() => ({ due: false, lastAt: null, intervalHours: 0 })),
  ]);
  return NextResponse.json({
    usage,
    hasKey: Boolean(config.realtyApiKey),
    keyHint: keyHint(config.realtyApiKey),
    monthlyLimit: config.monthlyLimit,
    pagesPerSource: config.pagesPerSource,
    checksPerDay: config.checksPerDay,
    lastCheckedAt: schedule.lastAt,
  });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const patch: Record<string, unknown> = {};

  if (typeof body.realtyApiKey === "string" && body.realtyApiKey.trim()) {
    patch.realtyApiKey = body.realtyApiKey.trim();
  }
  if (Number.isFinite(Number(body.monthlyLimit))) {
    patch.monthlyLimit = Math.max(1, Math.floor(Number(body.monthlyLimit)));
  }
  if (Number.isFinite(Number(body.checksPerDay))) {
    patch.checksPerDay = Math.min(24, Math.max(0, Math.floor(Number(body.checksPerDay))));
  }
  if (Number.isFinite(Number(body.pagesPerSource))) {
    patch.pagesPerSource = Math.min(5, Math.max(1, Math.floor(Number(body.pagesPerSource))));
  }

  await saveConfig(patch);
  return NextResponse.json({ ok: true, usage: await getUsage() });
}
