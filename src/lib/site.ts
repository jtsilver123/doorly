/**
 * Where this app actually lives.
 *
 * Every Vercel deployment answers on several hostnames: the production alias
 * (damnlease.com), a project-scoped one, and a unique per-deployment
 * URL. All but the alias sit behind Vercel's deployment protection, so a
 * visitor who lands there is bounced to a Vercel login page.
 *
 * That matters for OAuth. The sign-in flow used `window.location.origin` for
 * its return address, which is the host the browser happened to be on — so
 * opening the app on a deployment URL sent Google's callback back to a
 * protected host, and the round trip ended on "Log in to Vercel" instead of
 * in the app. The redirect target has to be the canonical site, not wherever
 * you started.
 *
 * `NEXT_PUBLIC_SITE_URL` is the answer in every deployed environment; the
 * fallback to `location.origin` keeps localhost working without configuration.
 */

const CONFIGURED = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");

export function siteOrigin(): string {
  if (CONFIGURED) return CONFIGURED;
  if (typeof window !== "undefined") return window.location.origin;
  return "https://damnlease.com";
}

/** An absolute URL on the canonical host. `path` should start with "/". */
export function siteUrl(path: string): string {
  return `${siteOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}
