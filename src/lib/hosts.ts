/**
 * Where the marketing site ends and the app begins.
 *
 * The pitch lives on damnlease.com and the product lives on
 * app.damnlease.com — the split every product eventually makes, because the
 * two are different jobs: one is read by strangers deciding whether to care,
 * the other is used by people who already decided.
 *
 * The one thing that split breaks is the session: a cookie set on the apex is
 * invisible to a subdomain unless it names a domain. So every Supabase client
 * scopes its auth cookie to `.damnlease.com`, and signing in on the marketing
 * side carries into the app.
 *
 * Everything here is derived from the host the request actually arrived on
 * rather than hardcoded, which keeps two things true at once: a different
 * domain needs no code change, and localhost gets no split at all — browsers
 * refuse a cookie domain for a bare host, and there is no `app.localhost` to
 * redirect anyone to.
 */

/** Strip the port, and the subdomain we own, leaving the registrable name. */
function bareHost(host: string): string {
  return host.split(":")[0].replace(/^www\./, "").replace(/^app\./, "");
}

function isBareMachine(host: string): boolean {
  const name = host.split(":")[0];
  return name === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(name) || !name.includes(".");
}

/** Is this request hitting the app subdomain? */
export function isAppHost(host: string | null | undefined): boolean {
  return Boolean(host && host.split(":")[0].startsWith("app."));
}

/**
 * The cookie domain for a given request host — ".damnlease.com", so one
 * session spans both sides of the split. Undefined on localhost and raw IPs,
 * where a domain-scoped cookie is silently dropped by the browser.
 */
export function cookieDomainFor(host: string | null | undefined): string | undefined {
  if (!host || isBareMachine(host)) return undefined;
  return `.${bareHost(host)}`;
}

/**
 * The two origins this request's domain splits into, or null when the domain
 * can't be split (local dev, an IP, a preview host with no `app.` sibling).
 * Callers treat null as "stay exactly where you are".
 */
export function originsFor(
  host: string | null | undefined
): { app: string; marketing: string } | null {
  if (!host || isBareMachine(host)) return null;
  const bare = bareHost(host);
  return { app: `https://app.${bare}`, marketing: `https://${bare}` };
}

function configuredHost(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? "https://damnlease.com";
  try {
    return new URL(raw).host;
  } catch {
    return "damnlease.com";
  }
}

/**
 * The app's origin outside a request — push notifications and other links
 * built server-side, where there's no host header to read.
 */
export function appOrigin(): string {
  return originsFor(configuredHost())?.app ?? `https://${configuredHost()}`;
}

/** The cookie domain outside a request, for the browser client at boot. */
export function cookieDomain(): string | undefined {
  return cookieDomainFor(configuredHost());
}
