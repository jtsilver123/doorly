import { loadConfig, keyHint, recordCall, getUsage, NO_CREDITS_PATH } from "@/lib/apikey";

/**
 * Shared client for realtyapi.io.
 *
 * One key covers several sites, each on its own subdomain with its own paths:
 *
 *   streeteasy.realtyapi.io  /search/rent          richest NYC rental data
 *   zillow.realtyapi.io      /search/byaddress     huge coverage, coarser fields
 *   hotpads.realtyapi.io     /search/bylocation    Zillow-owned, overlapping
 *   apartments.realtyapi.io  /search/bylocation    big-building inventory, and
 *                                                  the only search that filters
 *                                                  by availability window
 *   realtor.realtyapi.io     /search/bylocation    thin for NYC rentals
 *
 * Every response is 200 even on failure — errors come back as a JSON body with
 * an `error`/`message` field — so callers must check the payload, not the status.
 *
 * Requests are metered against a monthly budget (see apikey.ts). When the
 * budget is gone every call throws BudgetExhaustedError rather than silently
 * returning nothing, so the UI can say "you're out of requests" instead of
 * "no new listings".
 */

export type RealtyHost =
  | "streeteasy"
  | "zillow"
  | "hotpads"
  | "apartments"
  | "realtor";

export class RealtyApiError extends Error {
  constructor(
    message: string,
    readonly host: RealtyHost,
    readonly path: string
  ) {
    super(message);
    this.name = "RealtyApiError";
  }
}

export class BudgetExhaustedError extends RealtyApiError {
  constructor(used: number, limit: number, host: RealtyHost, path: string) {
    super(
      `out of API credits (${used}/${limit} used) — paste a new key under My details. ` +
        `Craigslist keeps working without one.`,
      host,
      path
    );
    this.name = "BudgetExhaustedError";
  }
}

export async function hasRealtyKey(): Promise<boolean> {
  return Boolean((await loadConfig()).realtyApiKey);
}

const TIMEOUT_MS = 45_000;

/*
 * A per-poll ceiling on upstream calls, set by ingest for the duration of a
 * run. The platform allows ~50 subrequests per invocation, and a poll's
 * database work needs most of the headroom that isn't spent here; without a
 * ledger, a generous pages-per-source setting fanned out enough requests to
 * hit the platform cap mid-run, at which point every later call — including
 * the bookkeeping that closes out the run — died. Sorted-by-newest queries
 * front-load the value anyway: the pages this trims are the stale end.
 */
let pollBudget: number | null = null;

/**
 * Deepest page any one source may fetch in a single check, whatever the
 * pages-per-source setting says. The setting still governs monthly budget
 * planning; this governs what fits in one invocation. Newest-first sorting
 * means page 3 and beyond of a twice-daily check is almost always yesterday's
 * inventory again.
 */
export const POLL_PAGE_CAP = 2;

export function limitPollRequests(n: number): void {
  pollBudget = n;
}

export function endPollRequests(): void {
  pollBudget = null;
}

export async function realtyGet<T>(
  host: RealtyHost,
  path: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const config = await loadConfig();
  const apiKey = config.realtyApiKey;
  if (!apiKey) {
    throw new RealtyApiError("no RealtyAPI key configured", host, path);
  }

  const hint = keyHint(apiKey);
  const usage = await getUsage();
  // Two ways to be out: the local count reaching the limit, or upstream
  // having already refused this key. A known-dead key shouldn't burn a whole
  // poll re-learning it every few hours — but a key someone topped up must
  // be able to come back, so after six quiet hours one probe gets through.
  const RETRY_AFTER_MS = 6 * 3_600_000;
  const refusalFresh =
    usage.refusedAt != null &&
    Date.now() - new Date(usage.refusedAt).getTime() < RETRY_AFTER_MS;
  if (usage.remaining <= 0 || (usage.exhausted && refusalFresh)) {
    throw new BudgetExhaustedError(usage.used, usage.limit, host, path);
  }

  if (pollBudget !== null) {
    if (pollBudget <= 0) {
      throw new RealtyApiError("trimmed: per-check request cap", host, path);
    }
    pollBudget--;
  }

  const url = new URL(`https://${host}.realtyapi.io${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "x-realtyapi-key": apiKey },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    // A failed call still counts against the quota upstream, so record it.
    void recordCall(hint, host, path, false);
    const reason = err instanceof Error ? err.message : String(err);
    throw new RealtyApiError(`request failed: ${reason}`, host, path);
  } finally {
    clearTimeout(timer);
  }

  void recordCall(hint, host, path, response.ok);

  // 402 is the upstream's own "you're out of credits". Trust it over our local
  // counter, which only sees requests made through this app — probing, other
  // tools, or a key that arrived already part-spent all go unseen by us.
  // Logged under the sentinel so the usage meter can say "key is dead"
  // instead of showing a healthy count that upstream disagrees with.
  if (response.status === 402) {
    void recordCall(hint, host, NO_CREDITS_PATH, false);
    throw new BudgetExhaustedError(usage.limit, usage.limit, host, path);
  }
  if (!response.ok) {
    throw new RealtyApiError(`HTTP ${response.status}`, host, path);
  }

  const body = (await response.json()) as T & { error?: string; message?: string };

  // Some hosts answer 200 with the credit error in the body instead.
  const creditText = `${body.error ?? ""} ${body.message ?? ""}`;
  if (/not enough credits|quota|402/i.test(creditText)) {
    void recordCall(hint, host, NO_CREDITS_PATH, false);
    throw new BudgetExhaustedError(usage.limit, usage.limit, host, path);
  }

  if (body.error) throw new RealtyApiError(body.error, host, path);
  if (typeof body.message === "string" && /not found|invalid|unauthor/i.test(body.message)) {
    throw new RealtyApiError(body.message, host, path);
  }
  return body;
}
