import { loadConfig, keyHint, recordCall, getUsage } from "@/lib/apikey";

/**
 * Shared client for realtyapi.io.
 *
 * One key covers several sites, each on its own subdomain with its own paths:
 *
 *   streeteasy.realtyapi.io  /search/rent          richest NYC rental data
 *   zillow.realtyapi.io      /search/byaddress     huge coverage, coarser fields
 *   hotpads.realtyapi.io     /search/bylocation    Zillow-owned, overlapping
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

export type RealtyHost = "streeteasy" | "zillow" | "hotpads" | "realtor";

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
      `monthly request budget spent (${used}/${limit}) — add a new API key in Settings`,
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
  if (usage.remaining <= 0) {
    throw new BudgetExhaustedError(usage.used, usage.limit, host, path);
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

  if (!response.ok) {
    throw new RealtyApiError(`HTTP ${response.status}`, host, path);
  }

  const body = (await response.json()) as T & { error?: string; message?: string };

  if (body.error) throw new RealtyApiError(body.error, host, path);
  if (typeof body.message === "string" && /not found|invalid|unauthor/i.test(body.message)) {
    throw new RealtyApiError(body.message, host, path);
  }
  return body;
}
