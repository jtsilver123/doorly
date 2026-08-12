import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { appUrl, siteUrl } from "@/lib/site";
import SiteChrome from "@/components/SiteChrome";
import { GUIDES, GUIDE_BY_SLUG } from "@/lib/guides";
import { areaStats } from "@/lib/areaStats";
import { directoryLanes } from "@/lib/siteLinks";
import type { SearchCriteria } from "@/types";
import { ALL_SOURCES } from "@/types";
import SiteLogo from "@/components/SiteLogo";
import Icon from "@/components/Icon";

/**
 * One neighborhood, honestly.
 *
 * The page exists to be found in a search, and the way to be found is to be
 * the most useful page on the subject rather than the most optimized one.
 * Three things are doing that work: prose written by someone who knows the
 * blocks (see lib/guides), live asking rents off the same corpus the app
 * uses, and the directory of sites with this neighborhood already selected,
 * which is a genuinely useful thing to hand someone at the end of a guide.
 *
 * Rendered on the server with no app bundle, because a stranger arriving
 * from Google should get text.
 */

export const dynamic = "force-dynamic";
/** Fresh enough that the rents mean something, cached enough to survive a rush. */
export const revalidate = 3600;

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

const money = (n: number) => `$${n.toLocaleString()}`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = GUIDE_BY_SLUG.get(slug);
  if (!guide) return {};
  // The root layout appends "· DamnLease" for us; adding it here too gave
  // every guide the brand twice in one title tag.
  const title = `Renting in ${guide.area}: rents, trains, and what to check`;
  return {
    title,
    description: guide.standfirst,
    alternates: { canonical: siteUrl(`/guides/${guide.slug}`) },
    openGraph: {
      title,
      description: guide.standfirst,
      url: siteUrl(`/guides/${guide.slug}`),
      siteName: "DamnLease",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: guide.standfirst,
    },
  };
}

export default async function Guide({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = GUIDE_BY_SLUG.get(slug);
  if (!guide) notFound();

  const [user, stats] = await Promise.all([currentUser(), areaStats(guide.area)]);
  const go = user ? appUrl("/app") : appUrl("/listings");
  const goLabel = user ? "Back to the hunt" : "Start the hunt";

  /* The directory, with this neighborhood already chosen. */
  const criteria: SearchCriteria = {
    areas: [guide.slug],
    bedMin: 0,
    bedMax: null,
    bathMin: 0,
    priceMin: 0,
    priceMax: 0,
    sources: [...ALL_SOURCES],
    noFeeOnly: false,
  };
  const lanes = directoryLanes(criteria);
  const nearby = guide.nearby
    .map((s) => GUIDE_BY_SLUG.get(s))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  const priced = stats?.byBeds.filter((b) => b.median != null) ?? [];

  return (
    <SiteChrome cta={go} ctaLabel={goLabel}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `Renting in ${guide.area}`,
            description: guide.standfirst,
            about: {
              "@type": "Place",
              name: `${guide.area}, ${guide.borough}, New York, NY`,
            },
            author: { "@type": "Person", name: "Jake" },
            publisher: { "@type": "Organization", name: "DamnLease" },
            mainEntityOfPage: siteUrl(`/guides/${guide.slug}`),
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Guides", item: siteUrl("/guides") },
              {
                "@type": "ListItem",
                position: 2,
                name: guide.area,
                item: siteUrl(`/guides/${guide.slug}`),
              },
            ],
          }),
        }}
      />

      <article className="guide">
        <header className="guide-head">
          <p className="overline">
            <Link href="/guides">Guides</Link> · {guide.borough}
          </p>
          <h1 className="display">Renting in {guide.area}</h1>
          <p className="guide-standfirst">{guide.standfirst}</p>
        </header>

        {/* The numbers first, because it is the first thing anyone wants and
            the thing every other neighborhood page gets out of date. */}
        {priced.length > 0 && (
          <section className="guide-rents" aria-label={`Asking rents in ${guide.area}`}>
            <h2 className="overline">Asking now</h2>
            <dl className="guide-figures">
              {priced.map((row) => (
                <div key={row.beds}>
                  <dt>{row.label}</dt>
                  <dd>{money(row.median!)}</dd>
                  <span className="muted">median of {row.sample} live</span>
                </div>
              ))}
            </dl>
            <p className="muted guide-fine">
              Median asking rent across {stats!.total.toLocaleString()} live{" "}
              {guide.area} listings we track, updated hourly.
              {stats!.noFeePct != null &&
                ` About ${stats!.noFeePct}% are advertised with no broker fee.`}{" "}
              Asking rent is what landlords want, not what everyone pays.
            </p>
          </section>
        )}

        <section className="guide-body">
          <h2>What it&apos;s like</h2>
          {guide.feel.map((para) => (
            <p key={para.slice(0, 24)}>{para}</p>
          ))}

          <h2>Who it suits</h2>
          <p>{guide.suits}</p>

          <h2>The catch</h2>
          <p>{guide.snag}</p>

          <h2>Getting around</h2>
          <p>{guide.transit}</p>

          <h2>What to check at the viewing</h2>
          <ul className="guide-checks">
            {guide.checks.map((c) => (
              <li key={c.slice(0, 24)}>{c}</li>
            ))}
          </ul>
        </section>

        {/* The useful ending: the sites, already pointed at this
            neighborhood. Everything above is reading; this is the thing to
            do next. */}
        <section className="guide-where">
          <h2>Where to look in {guide.area}</h2>
          <p className="muted">
            The apartments live on the listing sites. These open with{" "}
            {guide.area} already set.
          </p>
          {lanes.map((lane) => (
            <div key={lane.kind} className="guide-lane">
              <h3>{lane.title}</h3>
              <div className="guide-sites">
                {lane.sites.slice(0, 4).map((site) => (
                  <a
                    key={site.key}
                    className="guide-site"
                    href={site.url}
                    target="_blank"
                    rel="noreferrer nofollow"
                  >
                    <span className="guide-mark" aria-hidden="true">
                      <SiteLogo site={site.key} />
                    </span>
                    <span>
                      {site.name}
                      <Icon name="external" size={11} />
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="guide-cta surface">
          <h2>Then bring what you find back here</h2>
          <p>
            Paste any {guide.area} listing into DamnLease and it runs the rest:
            the price checked against comparable apartments, the building&apos;s
            record from city data, the message to the agent already written, and
            a watch on the place so a price cut or a quiet delisting reaches
            you first. Free, and you can try the whole thing before signing up.
          </p>
          <Link className="landing-go landing-go-sm" href={go}>
            {goLabel}
          </Link>
        </section>

        {nearby.length > 0 && (
          <nav className="guide-nearby" aria-label="Nearby neighborhoods">
            <h2 className="overline">Worth seeing too</h2>
            <ul>
              {nearby.map((n) => (
                <li key={n.slug}>
                  <Link href={`/guides/${n.slug}`}>
                    <b>{n.area}</b>
                    <span className="muted">{n.standfirst}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </article>
    </SiteChrome>
  );
}
