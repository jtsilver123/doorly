import { AsyncLocalStorage } from "node:async_hooks";
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

/**
 * Whose key pays for a request is decided per user, never globally.
 *
 * The first multi-account bug this file shipped: with no session, the poll
 * read "the most recently updated config row" — which meant the scheduled
 * check billed every account's searches to whichever user pasted a key last.
 * Keys are personal budgets. Two rules now, and everything here serves them:
 *
 *   1  A key someone saves is spent only on that person's own pulls.
 *   2  What a pull fetches lands in the shared corpus for everyone — the
 *      spender pays requests, everybody gets the freshness.
 *
 * The poll runs outside any session, so the acting user's config travels via
 * AsyncLocalStorage: the cron resolves each user's config explicitly and runs
 * their ingest inside `withConfig`, and every nested `loadConfig()` — the
 * source fetchers, the budget gate — sees that user and no one else.
 */
const actingConfig = new AsyncLocalStorage<AppConfig>();

export function withConfig<T>(config: AppConfig, fn: () => Promise<T>): Promise<T> {
  return actingConfig.run(config, fn);
}

/** Per-user, not global: a shared cache slot was a 15-second key leak. */
const cache = new Map<string, { value: AppConfig; at: number }>();
const CACHE_MS = 15_000;

function withDefaults(stored: Partial<AppConfig>): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    // A key saved in the app wins; the env var is the house fallback.
    realtyApiKey: stored.realtyApiKey || process.env.REALTYAPI_KEY || "",
  };
}

/** A specific user's settings, service-role read — the cron's path. */
export async function loadConfigFor(userId: string): Promise<AppConfig> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let stored: Partial<AppConfig> = {};
  try {
    const { data } = await adminDb()
      .from("app_config")
      .select("config")
      .eq("user_id", userId)
      .maybeSingle();
    stored = (data?.config as Partial<AppConfig>) ?? {};
  } catch {
    // Missing table or offline database — defaults plus the env fallback.
  }
  const value = withDefaults(stored);
  cache.set(userId, { value, at: Date.now() });
  return value;
}

/**
 * The key this user saved themselves — no env fallback. The cron uses this to
 * decide whether a user participates in scheduled pulls at all: spending is
 * strictly opt-in by pasting your own key.
 */
export async function storedKeyFor(userId: string): Promise<string> {
  try {
    const { data } = await adminDb()
      .from("app_config")
      .select("config")
      .eq("user_id", userId)
      .maybeSingle();
    return ((data?.config as Partial<AppConfig>)?.realtyApiKey ?? "").trim();
  } catch {
    return "";
  }
}

export async function loadConfig(): Promise<AppConfig> {
  // Inside a poll, the acting user's config was resolved up front.
  const acting = actingConfig.getStore();
  if (acting) return acting;

  try {
    return await loadConfigFor(await currentUserId());
  } catch {
    // No session and no acting context: environment defaults only. Never
    // another user's stored row — that's someone else's budget.
    return withDefaults({});
  }
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<void> {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  const uid = await currentUserId();
  await (await db())
    .from("app_config")
    .upsert(
      { user_id: uid, config: next, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  cache.delete(uid);
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
  /**
   * Upstream said "no credits" more recently than it served a request. The
   * local count can look healthy while this is true — the key was spent
   * somewhere we can't see — and the refusal is the truth worth showing.
   */
  exhausted: boolean;
  /** When upstream last refused, so the gate can re-probe occasionally. */
  refusedAt: string | null;
}

/*
 * One poll calls realtyGet dozens of times, and each budget check used to be
 * three database reads. On Cloudflare's free plan an invocation gets 50
 * subrequests TOTAL — the checks alone were spending triple the whole
 * allowance, which killed polls halfway through and left their run rows
 * orphaned. Within a few seconds the answer can't meaningfully change, so
 * one read serves the whole burst.
 */
const usageCache = new Map<string, { at: number; promise: Promise<Usage> }>();
const USAGE_CACHE_MS = 30_000;

export async function getUsage(): Promise<Usage> {
  const config = await loadConfig();
  const hint = keyHint(config.realtyApiKey);
  const cached = usageCache.get(hint);
  if (cached && Date.now() - cached.at < USAGE_CACHE_MS) {
    return cached.promise;
  }
  /*
   * The promise goes in the cache, not the value. A poll fires its calls
   * concurrently, so with a value cache every one of them missed (nobody had
   * finished the first read yet) and the stampede re-ran the three reads per
   * call — which is the exact spend this cache exists to prevent.
   */
  const promise = readUsage(config, hint);
  usageCache.set(hint, { at: Date.now(), promise });
  promise.catch(() => usageCache.delete(hint));
  return promise;
}

async function readUsage(
  config: AppConfig,
  hint: string
): Promise<Usage> {
  let used = 0;
  let exhausted = false;
  let refusedAtOut: string | null = null;
  for (const getClient of [async () => await db(), async () => adminDb()]) {
    try {
      const client = await getClient();
      const { count, error } = await client
        .from("api_usage")
        .select("id", { count: "exact", head: true })
        .eq("key_hint", hint)
        .neq("path", NO_CREDITS_PATH)
        .gte("called_at", monthStart());
      if (error) continue;
      used = count ?? 0;

      // Dead until a call succeeds again: the latest refusal outranking the
      // latest served request means every real call is bouncing right now.
      // Scoped to this month so an upstream credit reset clears the flag on
      // its own instead of poisoning a refilled key forever.
      const [{ data: refusal }, { data: served }] = await Promise.all([
        client
          .from("api_usage")
          .select("called_at")
          .eq("key_hint", hint)
          .eq("path", NO_CREDITS_PATH)
          .gte("called_at", monthStart())
          .order("called_at", { ascending: false })
          .limit(1),
        client
          .from("api_usage")
          .select("called_at")
          .eq("key_hint", hint)
          .eq("ok", true)
          .neq("path", NO_CREDITS_PATH)
          .gte("called_at", monthStart())
          .order("called_at", { ascending: false })
          .limit(1),
      ]);
      const refusedAt = refusal?.[0]?.called_at as string | undefined;
      const servedAt = served?.[0]?.called_at as string | undefined;
      exhausted = Boolean(refusedAt && (!servedAt || refusedAt > servedAt));
      refusedAtOut = exhausted ? (refusedAt ?? null) : null;
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
    exhausted,
    refusedAt: refusedAtOut,
  };
}

/**
 * Is another automatic check due — for this user, on this user's cadence?
 *
 * Guards the request budget as much as the schedule: at ~5 requests a poll and
 * 250 a month, hourly checking would exhaust a free key in under two days.
 * The clock is per user: your 2×/day counts your own successful pulls, not
 * whoever pulled most recently — otherwise one eager account's polls would
 * silence everyone else's schedule forever.
 */
export async function nextCheckDue(userId?: string): Promise<{
  due: boolean;
  lastAt: string | null;
  intervalHours: number;
}> {
  const config = userId ? await loadConfigFor(userId) : await loadConfig();
  if (config.checksPerDay <= 0) {
    return { due: false, lastAt: null, intervalHours: 0 };
  }
  const intervalHours = 24 / config.checksPerDay;

  // Called from two places with different auth: the cron route (no session, so
  // it needs the service role) and the settings route (session, no service key
  // required). Try both rather than assuming either.
  // Any completed run counts, not only ok=true ones. A run that carried
  // warnings (a skipped sweep, one flaky source) still spent its requests —
  // pacing off "perfect runs only" made a user whose every poll warns re-poll
  // on every hourly tick, which is exactly the budget burn this guards.
  let lastAt: string | null = null;
  let read = false;
  for (const getClient of [
    () => adminDb(),
    async () => await db(),
  ]) {
    try {
      const client = await getClient();
      let query = client.from("poll_runs").select("started_at");
      if (userId) query = query.eq("user_id", userId);
      const { data, error } = await query
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

/**
 * The marker row for "upstream refused this key for lack of credits".
 *
 * The local counter only sees requests made through this app, so a key spent
 * elsewhere — or one that arrived already drained — reads as healthy here
 * while every real call bounces. The refusal itself is the truth, so it gets
 * logged under this sentinel path and the usage meter believes it over its
 * own arithmetic. Excluded from the "used" count: a refusal isn't a request
 * the quota served.
 */
export const NO_CREDITS_PATH = "__no_credits__";

/**
 * Fire-and-forget: metering must never be able to fail a real request.
 *
 * Buffered, not immediate: a poll makes dozens of calls, and a row-per-call
 * insert was a subrequest-per-call on a platform that hands out 50 per
 * invocation. Rows accumulate and land as one insert — either when the short
 * timer fires, or when the poll calls `flushCallRecords` on its way out. A
 * worker dying with an unflushed buffer under-counts by one burst, which the
 * meter's arithmetic already treats as approximate.
 */
const pendingCalls: { key_hint: string; host: string; path: string; ok: boolean }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function recordCall(hint: string, host: string, path: string, ok: boolean): void {
  pendingCalls.push({ key_hint: hint, host, path, ok });
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      void flushCallRecords();
    }, 1000);
  }
}

export async function flushCallRecords(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pendingCalls.length) return;
  const rows = pendingCalls.splice(0, pendingCalls.length);
  for (const getClient of [async () => await db(), async () => adminDb()]) {
    try {
      const { error } = await (await getClient()).from("api_usage").insert(rows);
      if (!error) return;
    } catch {
      // Fall through to the service role.
    }
  }
}
