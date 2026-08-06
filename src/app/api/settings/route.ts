import { NextResponse } from "next/server";
import { loadConfig, saveConfig, getUsage, keyHint, nextCheckDue } from "@/lib/apikey";
import { db, currentUserId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Never returns the key itself — only enough to recognise which one is set. */
export async function GET() {
  // The schedule readout is personal: your cadence, clocked from your own
  // last pull — not whoever in the userbase pulled most recently.
  const uid = await currentUserId().catch(() => undefined);
  const [config, usage, schedule] = await Promise.all([
    loadConfig(),
    getUsage(),
    nextCheckDue(uid).catch(() => ({ due: false, lastAt: null, intervalHours: 0 })),
  ]);

  // Measure what a poll actually costs rather than assuming it. Total spend on
  // this key divided by completed polls is self-correcting: it absorbs wide
  // vs narrow queries, extra bed values, retries — everything a formula would
  // have to guess at. The heuristic only covers the first run.
  let perPollEstimate = config.pagesPerSource * (config.wideQueries ? 5 : 14);
  try {
    const monthStart = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
    ).toISOString();
    const { count } = await (await db())
      .from("poll_runs")
      .select("id", { count: "exact", head: true })
      .eq("ok", true)
      .gte("started_at", monthStart);
    if (count && count > 0 && usage.used > 0) {
      perPollEstimate = Math.max(1, Math.round(usage.used / count));
    }
  } catch {
    // keep the heuristic
  }

  return NextResponse.json({
    usage,
    hasKey: Boolean(config.realtyApiKey),
    keyHint: keyHint(config.realtyApiKey),
    monthlyLimit: config.monthlyLimit,
    pagesPerSource: config.pagesPerSource,
    checksPerDay: config.checksPerDay,
    lastCheckedAt: schedule.lastAt,
    wideQueries: config.wideQueries,
    perPollEstimate,
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
