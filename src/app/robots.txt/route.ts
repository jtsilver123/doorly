import { isAppHost } from "@/lib/hosts";

export const dynamic = "force-dynamic";

/**
 * Host-aware robots: the same worker serves the pitch and the product, and
 * they want opposite treatment. The marketing host invites crawlers and
 * points them at the sitemap; the app host — a session-gated tool whose
 * every page is someone's private hunt — asks them all to leave. The
 * recovery pages are excluded on the marketing side too, matching their own
 * noindex meta.
 */
export function GET(request: Request) {
  const host = request.headers.get("host") ?? "";
  const body = isAppHost(host)
    ? `User-agent: *
Disallow: /
`
    : `User-agent: *
Allow: /
Disallow: /forgot
Disallow: /reset
Disallow: /auth/
Disallow: /join/
Disallow: /welcome

Sitemap: https://damnlease.com/sitemap.xml
`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
