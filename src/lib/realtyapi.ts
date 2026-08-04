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

export function hasRealtyKey(): boolean {
  return Boolean(process.env.REALTYAPI_KEY);
}

const TIMEOUT_MS = 45_000;

export async function realtyGet<T>(
  host: RealtyHost,
  path: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const apiKey = process.env.REALTYAPI_KEY;
  if (!apiKey) {
    throw new RealtyApiError("REALTYAPI_KEY is not set", host, path);
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
    const reason = err instanceof Error ? err.message : String(err);
    throw new RealtyApiError(`request failed: ${reason}`, host, path);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new RealtyApiError(`HTTP ${response.status}`, host, path);
  }

  const body = (await response.json()) as T & { error?: string; message?: string };

  // A 200 with an `error` field, or a "not found"-ish message, is a failure.
  if (body.error) {
    throw new RealtyApiError(body.error, host, path);
  }
  if (typeof body.message === "string" && /not found|invalid|unauthor/i.test(body.message)) {
    throw new RealtyApiError(body.message, host, path);
  }
  return body;
}
