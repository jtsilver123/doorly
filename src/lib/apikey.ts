import { db, currentUserId } from "@/lib/supabase";

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
}

export const DEFAULT_CONFIG: AppConfig = {
  realtyApiKey: "",
  monthlyLimit: DEFAULT_MONTHLY_LIMIT,
  pagesPerSource: 1,
  wideQueries: true,
};

let cache: { value: AppConfig; at: number } | null = null;
const CACHE_MS = 15_000;

export async function loadConfig(): Promise<AppConfig> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  let stored: Partial<AppConfig> = {};
  try {
    const { data } = await (await db())
      .from("app_config")
      .select("config")
      .eq("user_id", await currentUserId())
      .maybeSingle();
    stored = (data?.config as Partial<AppConfig>) ?? {};
  } catch {
    // A missing table or offline database must not stop a poll that could
    // still run from the environment variable.
  }

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
  try {
    const { count } = await (await db())
      .from("api_usage")
      .select("id", { count: "exact", head: true })
      .eq("key_hint", hint)
      .gte("called_at", monthStart());
    used = count ?? 0;
  } catch {
    used = 0;
  }
  return {
    used,
    limit: config.monthlyLimit,
    remaining: Math.max(0, config.monthlyLimit - used),
    keyHint: hint,
    since: monthStart(),
  };
}

/** Fire-and-forget: metering must never be able to fail a real request. */
export async function recordCall(
  hint: string,
  host: string,
  path: string,
  ok: boolean
): Promise<void> {
  try {
    await (await db()).from("api_usage").insert({ key_hint: hint, host, path, ok });
  } catch {
    /* ignore */
  }
}
