import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/supabase/server";
import { appUrl, siteUrl } from "@/lib/site";
import SiteChrome from "@/components/SiteChrome";
import { GUIDES, GUIDES_BY_BOROUGH } from "@/lib/guides";

/**
 * The index of neighborhood guides.
 *
 * Its job is to be the page that ranks for the general question and hands
 * people to the specific one, so it says what the guides actually contain
 * rather than welcoming anybody to anything.
 */

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "NYC neighborhood rent guides",
  description:
    "What renting actually costs in each New York neighborhood, what the trains really mean, and what to check at the viewing. Live asking rents, written by someone who has done it.",
  alternates: { canonical: siteUrl("/guides") },
  openGraph: {
    title: "NYC neighborhood rent guides",
    description:
      "Live asking rents and honest notes on renting in each New York neighborhood.",
    url: siteUrl("/guides"),
    siteName: "DamnLease",
    type: "website",
  },
};

export default async function Guides() {
  const user = await currentUser();
  const go = user ? appUrl("/app") : appUrl("/listings");
  const goLabel = user ? "Back to the hunt" : "Start the hunt";

  return (
    <SiteChrome cta={go} ctaLabel={goLabel}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "NYC neighborhood rent guides",
            itemListElement: GUIDES.map((g, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: `Renting in ${g.area}`,
              url: siteUrl(`/guides/${g.slug}`),
            })),
          }),
        }}
      />

      <article className="guide guide-index">
        <header className="guide-head">
          <p className="overline">Neighborhood guides</p>
          <h1 className="display">Where to live, and what it really costs.</h1>
          <p className="guide-standfirst">
            One page per neighborhood: what the blocks are actually like, the
            thing you find out in month two, and the rents people are asking
            this week off the same listings we track. No adjectives about
            vibrancy.
          </p>
        </header>

        {GUIDES_BY_BOROUGH.map(({ borough, guides }) => (
          <section key={borough} className="guide-group">
            <h2>{borough}</h2>
            <ul className="guide-cards">
              {guides.map((g) => (
                <li key={g.slug}>
                  <Link className="guide-card surface" href={`/guides/${g.slug}`}>
                    <b>{g.area}</b>
                    <span className="muted">{g.standfirst}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="guide-cta surface">
          <h2>Found somewhere?</h2>
          <p>
            Paste the listing into DamnLease and it runs the rest: the price
            checked against comparable apartments, the building&apos;s record
            from city data, the message to the agent already written, and a
            watch on the place until you decide. Free, and you can try it
            before signing up.
          </p>
          <Link className="landing-go landing-go-sm" href={go}>
            {goLabel}
          </Link>
        </section>
      </article>
    </SiteChrome>
  );
}
