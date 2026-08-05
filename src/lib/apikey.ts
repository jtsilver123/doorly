import { db, adminDb, currentUserId } from "@/lib/supabase";

/**
 * API key handling and the monthly request budget.
 *
 * The RealtyAPI free tier allows 250 requests a month, which is a real
 * constraint rather than a footnote: at three pages per source per area a
 * single poll cost 30 requests, so the whole month's allowance bought eight
 * polls — roughly one every four days, in a market where listings move in
 * hours. So the key is swappable from the UI, usage is counted rather than
 * guessed, and polling stops before it blows the budget instead of failing
 * halfway through with a broken half-ingest.
 */

/** Free-tier allowance. Override in settings if you upgrade. */
export const DEFAULT_MONTHLY_LIMIT = 250;

export interface AppConfig {
  realtyApiKey: string;
  monthlyLimit: number;
  /** Pages fetched per source per area. 1 is enough when sorting by newest. */
  pagesPerSource: number;
  /**
   * Query one borough instead of each neighborhood, narrowing locally by
   * coordinates. Roughly a third of the requests for the same coverage.
   */
  wideQueries: boolean;
  /**
   * How often to check automatically, per day. 0 means manual only.
   *
   * The schedule can't live in vercel.json because that's fixed at deploy time
   * and this is a per-person preference. Instead the cron ticks hourly and the
   * route decides whether enough time has passed — so changing this takes
   * effect immediately, with no redeploy.
   */
  checksPerDay: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  realtyApiKey: "",
  monthlyLimit: DEFAULT_MONTHLY_LIMIT,
  pagesPerSource: 1,
  wideQueries: true,
  checksPerDay: 2,
};

let cache: { value: AppConfig; at: number } | null = null;
const CACHE_MS = 15_000;

/**
 * The stored settings, read whether or not there's a signed-in session.
 *
 * This is the bug that made a freshly pasted key look like it hadn't saved.
 * `currentUserId()` throws when there is no session, and the scheduled poll
 * has no session — so every automatic check fell into the catch, read no
 * stored config at all, and ran on `process.env.REALTYAPI_KEY`. That env var
 * still held the previous, exhausted key, so the cron kept calling a dead key
 * while the app showed the new one saved and working. The chosen page depth
 * and check frequency were silently ignored the same way.
 *
 * With no session we fall back to the service role and take the most recently
 * updated row. That is exactly right while this is one person's tool, and it
 * is the wrong answer the moment two accounts keep different keys — at which
 * point the poll needs to load config per search owner rather than globally.
 */
async function readStored(): Promise<Partial<AppConfig>> {
  try {
    const { data } = await (await db())
      .from("app_config")
      .select("config")
      .eq("user_id", await currentUserId())
      .maybeSingle();
    if (data?.config) return data.config as Partial<AppConfig>;
  } catch {
    // No session, or no database. Try the service role below.
  }

  try {
    const { data } = await adminDb()
      .from("app_config")
      .select("config")
      .order("updated_at", { ascending: false })
      .limit(1);
    return ((data?.[0]?.config as Partial<AppConfig>) ?? {}) as Partial<AppConfig>;
  } catch {
    // A missing table or offline database must not stop a poll that could
    // still run from the environment variable.
    return {};
  }
}

export async function loadConfig(): Promise<AppConfig> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const stored = await readStored();
  const value: AppConfig = {
    ...DEFAULT_CONFIG,
    ...stored,
    // A key saved in the app wins; the env var is the fallback.
    realtyApiKey: stored.realtyApiKey || process.env.REALTYAPI_KEY || "",
  };
  cache = { value, at: Date.now() };
  return value;
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<void> {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  await (await db())
    .from("app_config")
    .upsert(
      { user_id: await currentUserId(), config: next, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  cache = null;
}

/** Last 6 characters only — enough to tell two keys apart, useless if leaked. */
export function keyHint(key: string): string {
  return key ? `…${key.slice(-6)}` : "none";
}

function monthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export interface Usage {
  used: number;
  limit: number;
  remaining: number;
  keyHint: string;
  since: string;
}

export async function getUsage(): Promise<Usage> {
  const config = await loadConfig();
  const hint = keyHint(config.realtyApiKey);
  let used = 0;
  for (const getClient of [async () => await db(), async () => adminDb()]) {
    try {
      const { count, error } = await (await getClient())
        .from("api_usage")
        .select("id", { count: "exact", head: true })
        .eq("key_hint", hint)
        .gte("called_at", monthStart());
      if (error) continue;
      used = count ?? 0;
      break;
    } catch {
      // Try the service role; a poll has no session to read with.
    }
  }
  return {
    used,
    limit: config.monthlyLimit,
    remaining: Math.max(0, config.monthlyLimit - used),
    keyHint: hint,
    since: monthStart(),
  };
}

/**
 * Is another automatic check due?
 *
 * Guards the request budget as much as the schedule: at ~5 requests a poll and
 * 250 a month, hourly checking would exhaust a free key in under two days.
 */
export async function nextCheckDue(): Promise<{
  due: boolean;
  lastAt: string | null;
  intervalHours: number;
}> {
  const config = await loadConfig();
  if (config.checksPerDay <= 0) {
    return { due: false, lastAt: null, intervalHours: 0 };
  }
  const intervalHours = 24 / config.checksPerDay;

  // Called from two places with different auth: the cron route (no session, so
  // it needs the service role) and the settings route (session, no service key
  // required). Try both rather than assuming either.
  let lastAt: string | null = null;
  let read = false;
  for (const getClient of [
    () => adminDb(),
    async () => await db(),
  ]) {
    try {
      const client = await getClient();
      const { data, error } = await client
        .from("poll_runs")
        .select("started_at")
        .eq("ok", true)
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) continue;
      lastAt = (data?.[0]?.started_at as string) ?? null;
      read = true;
      break;
    } catch {
      // try the next one
    }
  }

  // If the last run can't be read, do nothing. Guessing "due" would make every
  // hourly tick poll and spend a month's request budget in under two days;
  // guessing "not due" only delays a check until the next tick.
  if (!read) return { due: false, lastAt: null, intervalHours };

  if (!lastAt) return { due: true, lastAt: null, intervalHours };
  const elapsedHours = (Date.now() - new Date(lastAt).getTime()) / 3_600_000;
  // Small tolerance so an hourly tick isn't skipped by a few seconds of drift.
  return { due: elapsedHours >= intervalHours - 0.1, lastAt, intervalHours };
}

/** Fire-and-forget: metering must never be able to fail a real request. */
export async function recordCall(
  hint: string,
  host: string,
  path: string,
  ok: boolean
): Promise<void> {
  const row = { key_hint: hint, host, path, ok };
  for (const getClient of [async () => await db(), async () => adminDb()]) {
    try {
      const { error } = await (await getClient()).from("api_usage").insert(row);
      if (!error) return;
    } catch {
      // Fall through to the service role.
    }
  }
}
