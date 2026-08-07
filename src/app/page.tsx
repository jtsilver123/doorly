import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase";
import { appUrl } from "@/lib/site";
import SiteChrome from "@/components/SiteChrome";
import Reveal from "@/components/Reveal";
import HuntEstimator from "@/components/HuntEstimator";
import CountUp from "@/components/CountUp";

/**
 * The front door — the marketing site, for everyone.
 *
 * The app lives at app.damnlease.com; this page's job is the pitch, whether
 * or not you're signed in. For a stranger from a group chat that means one
 * unmissable button; for a signed-in visitor the same buttons open the app.
 *
 * The argument it makes is deliberately not "we have features". It's that you
 * walk into the viewing knowing things the other four applicants don't — what
 * the line actually rents for, what the building's record says, how long the
 * listing has really been up. Every section is a version of that sentence.
 *
 * Server component on purpose: plain HTML, no app bundle, no hydration.
 */

export const dynamic = "force-dynamic";

/** What you know at the door that the other applicants don't. */
const EDGE: { label: string; title: string; body: string }[] = [
  {
    label: "The price",
    title: "What this place should really cost",
    body: "Every listing gets checked against apartments just like it: same building, same layout, same bedrooms. You see how much too high the rent is, and get a polite script that says so.",
  },
  {
    label: "The building",
    title: "The record nobody puts in the listing",
    body: "Open violations, bedbug reports, and noise complaints on the block, straight from city records. The photos won't tell you the boiler broke twice this year.",
  },
  {
    label: "The clock",
    title: "How long it's really been sitting",
    body: "When it first showed up, every price cut since, and the day it was quietly posted again as new. A place that has sat for three weeks is much easier to bargain with than one posted this morning.",
  },
  {
    label: "The cost",
    title: "What you'll actually hand over",
    body: "The real monthly rent once free months are counted in, the broker fee, the cash you need on day one, and whether your income passes the 40x rule, all before you fall for the place.",
  },
  {
    label: "The move",
    title: "The message, already written",
    body: "Named, specific, human, and sent from your own phone. The first reply usually gets the tour, and most people take four hours to write theirs.",
  },
  {
    label: "The crew",
    title: "One board, not a group chat",
    body: "Your roommate sees the same board, the same tour videos, the same notes, and who is talking to which agent. Nobody asks the same question twice.",
  },
];

/**
 * Live numbers for the proof strip.
 *
 * Claims are cheap; a count is not. This is the corpus everyone's search
 * reads from, so it's the honest thing to put on the page — and it costs two
 * `head: true` counts, which fetch no rows.
 *
 * Guarded hard: the landing page must render for a stranger even if the
 * database is unreachable, so a failure here just hides the strip.
 */
async function corpus(): Promise<{ tracked: number; fresh: number } | null> {
  try {
    const supabase = adminDb();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const [all, recent] = await Promise.all([
      supabase.from("listings").select("id", { count: "exact", head: true }),
      supabase
        .from("listings")
        .select("id", { count: "exact", head: true })
        .gte("first_seen_at", dayAgo),
    ]);
    if (!all.count) return null;
    return { tracked: all.count, fresh: recent.count ?? 0 };
  } catch {
    return null;
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; place?: string }>;
}) {
  /*
   * A `?code=` on the root is a misrouted OAuth callback.
   *
   * When Supabase doesn't recognise the redirect target (an allowlist miss),
   * it falls back to its configured Site URL — the bare origin, no path. The
   * dashboard setting is the real fix, but the app shouldn't strand a valid
   * sign-in code on the landing page while a setting is wrong somewhere else.
   */
  const { code, place } = await searchParams;
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}`);

  /*
   * `?place=` on the root is an app link from before the app moved to /app —
   * a share sent last week, a push delivered yesterday. Links people already
   * have must keep opening the listing they point at.
   */
  if (place) redirect(`/app?place=${encodeURIComponent(place)}`);

  const [user, counts] = await Promise.all([currentUser(), corpus()]);
  // Signed in, the product is a hostname away — link straight there rather
  // than bouncing through a redirect the app would only issue anyway.
  const go = user ? appUrl("/app") : "/signup";
  const goLabel = user ? "Back to the hunt" : "Start the hunt";

  return (
    <SiteChrome
      cta={go}
      ctaLabel={goLabel}
      transparentBar
    >
    <main className="landing">
      {/* Old bookmarks look like /#pipeline — the app lived on the root
          before it moved to /app, and hashes never reach the server. Anyone
          arriving with an app-shaped hash meant the app, not the pitch. */}
      {/* Structured data: the app as a (free) product, so search results can
          say so without guessing. Honest fields only. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "DamnLease",
            applicationCategory: "LifestyleApplication",
            operatingSystem: "Web",
            url: "https://damnlease.com",
            description:
              "A free CRM for the NYC apartment hunt: every listing site checked hourly, real comps on every price, and a pipeline from first text to signed lease.",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            creator: { "@type": "Person", name: "Jake" },
          }),
        }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var h=location.hash.replace("#","");if(["today","feed","changes","pipeline","compare","profile"].indexOf(h)>=0){location.replace("/app"+location.search+location.hash)}})()`,
        }}
      />

      <section className="landing-hero">
        <div className="landing-hero-grid">
        <div className="landing-hero-inner">
          <p className="overline landing-eyebrow">
            New York City rentals · free, forever
          </p>
          <h1 className="display">
            Be <span className="mark">first</span>, not lucky.
          </h1>
          <p className="landing-sub">
            A good New York apartment is gone in a day. It goes to whoever
            replies first. DamnLease checks every listing site every hour,
            tells you what a place is really worth the minute it shows up,
            and writes your message to the agent for you. You reply while
            everyone else is still opening tabs.
          </p>
          <div className="landing-cta">
            <Link className="landing-go" href={go}>
              {goLabel}
            </Link>
            <span className="landing-cta-sub">
              {user
                ? "Your pipeline is where you left it"
                : "Completely free · two minutes to set up · bring your roommate"}
            </span>
          </div>
        </div>

        {/* The claim, performed. See HuntEstimator. */}
        <HuntEstimator cta={go} ctaLabel={user ? "Back to the hunt" : "Secure a place"} />
        </div>

        {counts ? (
          <dl className="landing-proof">
            <div>
              <dt>Listings tracked</dt>
              <dd>
                <CountUp to={counts.tracked} />
              </dd>
            </div>
            <div>
              <dt>New in the last 24h</dt>
              <dd>
                <CountUp to={counts.fresh} />
              </dd>
            </div>
            <div>
              <dt>Sites watched</dt>
              <dd>5</dd>
            </div>
            <div>
              <dt>Checked</dt>
              <dd>Hourly</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>$0</dd>
            </div>
          </dl>
        ) : null}
      </section>

      {/* The leg up, itemised. Each row is a thing you say out loud at the
          viewing that the person behind you in line can't. */}
      <section className="landing-edge" id="what-you-know">
        <Reveal>
          <h2 className="display">What you walk in knowing.</h2>
        </Reveal>
        <ul className="landing-edge-rows">
          {EDGE.map((row, i) => (
            <li key={row.title}>
              <Reveal className="landing-edge-inner" delay={i * 60}>
                <span className="overline">{row.label}</span>
                <div>
                  <h3>{row.title}</h3>
                  <p>{row.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      {/* Who made this, why it costs nothing, and what it can't do — the
          three questions a stranger has after the pitch lands, answered in
          that order because the third one is what makes the first two
          believable. */}
      <section className="landing-maker" id="about">
        <Reveal>
          <p className="overline">About</p>
          <h2 className="display">Made by a frustrated renter.</h2>
          <p className="landing-maker-body">
            I lost an apartment I wanted by four hours, to someone who saw
            the listing first. Then it happened again. The tools renters get
            are catalogs built for the people selling. Everything that really
            decides it, the true price, the building&apos;s record, who
            replied first, you have to figure out alone, in twelve tabs, at
            midnight.
          </p>
          <p className="landing-maker-body">
            So I built the thing I wanted. It is{" "}
            <span className="mark">completely free</span>. There is no paid
            version hiding the good parts, and nothing about you gets sold,
            because there is no business here to sell it for. One person
            builds it, in New York, mostly at night.
          </p>
        </Reveal>

        <Reveal delay={80}>
          <h3 className="landing-honest-h">What it can&apos;t do, so you hear it from me</h3>
          <ul className="landing-honest">
            <li>
              <b>New York only.</b> The building records, the price checks,
              and the commute times all come from this city&apos;s data.
              Anywhere else it would just be a worse spreadsheet.
            </li>
            <li>
              <b>It doesn&apos;t see every apartment.</b> Five listing sites,
              checked every hour. Buildings that only post on their own
              website, and the ones that never get listed at all, are
              invisible to it. They are invisible to Zillow too.
            </li>
            <li>
              <b>The numbers are estimates.</b> Price checks, monthly costs,
              and scores come from outside data that can be old or wrong. Use
              them to ask sharper questions at the viewing, not to sign
              anything.
            </li>
            <li>
              <b>It won&apos;t message anyone for you.</b> It writes the
              text, you send it from your own phone. That is deliberate. An
              agent can tell, and a bot gets ignored.
            </li>
            <li>
              <b>It&apos;s young.</b> A handful of people use it. If
              something breaks, email me and I will actually fix it.
            </li>
          </ul>
          <p className="landing-maker-sign">
            Jake, New York ·{" "}
            <a href="mailto:jtsilver123@gmail.com?subject=DamnLease">
              jtsilver123@gmail.com
            </a>
          </p>
        </Reveal>
      </section>

      <section className="landing-vs" id="why">
        <h2 className="display">&ldquo;Why not just use Zillow?&rdquo;</h2>
        <p className="landing-vs-lede">
          Because a listing site is a catalog, and hunting is not browsing.
          Hunting is texting agents, booking tours, comparing your finalists,
          and beating four other people to the same apartment. Right now that
          part lives in twelve tabs, a group chat, and a spreadsheet.
        </p>
        <ul className="landing-vs-rows">
          {(
            [
              [
                "Every site at once",
                "StreetEasy, Zillow, Apartments.com, HotPads, and Craigslist, with the copies merged into one. No single site has all of New York.",
                "One site's slice of the market",
              ],
              [
                "What it really costs",
                "The real rent once free months are counted in, the fees, the cash to move in, and whether your income passes the 40x rule.",
                "The asking rent",
              ],
              [
                "A price check with teeth",
                "Every listing checked against places just like it, with a bargaining script ready to send, or a warning to move fast instead.",
                "“Contact agent”",
              ],
              [
                "The building's record",
                "Open violations, bedbug reports, and the block's noise complaints, from city records.",
                "The listing's own photos",
              ],
              [
                "A pipeline that chases",
                "Every place you chase, tracked from first text to signed lease. Silence gets flagged, and follow-ups write themselves.",
                "Browser tabs and memory",
              ],
              [
                "A crew, not a group chat",
                "One shared board with your roommate or family: tours, videos from viewings, and who is on point for which agent.",
                "Forwarded links",
              ],
            ] as [string, string, string][]
          ).map(([title, ours, theirs]) => (
            <li key={title}>
              <h3>{title}</h3>
              <p>{ours}</p>
              <span className="landing-vs-them">Listing sites: {theirs}</span>
            </li>
          ))}
        </ul>
        <p className="landing-vs-close display">
          Zillow shows you apartments. <span className="mark">DamnLease wins you one.</span>
        </p>
      </section>

      <section className="landing-team">
        <div>
          <h2 className="display">Hunt as a crew.</h2>
          <p>
            Moving in with someone? Share one pipeline and split who talks to
            which agent. Living alone? Let friends and family scout for you.
            Every find carries their name, and the final say stays yours.
          </p>
        </div>
        <Link className="landing-go landing-go-sm" href={go}>
          {goLabel}
        </Link>
      </section>

    </main>
    </SiteChrome>
  );
}
