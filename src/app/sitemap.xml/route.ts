import { NextResponse } from "next/server";
import { GUIDES } from "@/lib/guides";

export const dynamic = "force-static";

/**
 * The marketing site's map, for crawlers.
 *
 * Only the pages a stranger can read belong here: the pitch, the legal
 * pages, and the two doors in. The app itself lives behind a session on
 * another host and is deliberately absent — as are the recovery pages
 * (noindexed; a password-reset form has no business ranking) and invite
 * links (private by construction).
 *
 * URLs are absolute to the marketing host no matter which host serves the
 * request, because a sitemap's job is to name canonical addresses.
 */
const BASE = "https://damnlease.com";

const PAGES: { path: string; priority: number; changefreq: string }[] = [
  { path: "/", priority: 1.0, changefreq: "weekly" },
  { path: "/guides", priority: 0.9, changefreq: "weekly" },
  { path: "/signup", priority: 0.8, changefreq: "monthly" },
  { path: "/login", priority: 0.5, changefreq: "monthly" },
  { path: "/privacy", priority: 0.3, changefreq: "yearly" },
  { path: "/terms", priority: 0.3, changefreq: "yearly" },
  // Every neighborhood guide. They carry live rents off the corpus, so they
  // genuinely change week to week rather than being declared to.
  ...GUIDES.map((g) => ({
    path: `/guides/${g.slug}`,
    priority: 0.8,
    changefreq: "weekly",
  })),
];

export function GET() {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map(
  (p) => `  <url>
    <loc>${BASE}${p.path === "/" ? "" : p.path}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority.toFixed(1)}</priority>
  </url>`
).join("\n")}
</urlset>
`;
  return new NextResponse(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
