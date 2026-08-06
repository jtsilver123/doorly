import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase";
import { appUrl } from "@/lib/site";
import SiteChrome from "@/components/SiteChrome";
import Reveal from "@/components/Reveal";
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
    title: "What the line actually rents for",
    body: "Every listing measured against its own comps — same building, same line, same bedroom count. You get the number that's over, by how much, and the script that says so politely.",
  },
  {
    label: "The building",
    title: "The record nobody puts in the listing",
    body: "Open HPD violations, bedbug filings and the block's 311 noise complaints, pulled from city data. The photos won't tell you the boiler's been out twice this year.",
  },
  {
    label: "The clock",
    title: "How long it's really been sitting",
    body: "First seen, every price change since, and the day it quietly relisted under a new ID. A place that's been up three weeks negotiates very differently from one posted this morning.",
  },
  {
    label: "The cost",
    title: "What you'll actually hand over",
    body: "Concession spread across the lease, broker fee amortized, cash due at signing — and whether your income clears the 40× rule before you fall for it.",
  },
  {
    label: "The move",
    title: "The message, already written",
    body: "Named, specific, human, and sent from your own phone. First reply usually gets the viewing, and most people take four hours to write theirs.",
  },
  {
    label: "The crew",
    title: "One board, not a group chat",
    body: "Your roommate sees the same pipeline, the same tour videos, the same notes — and who's on point for which agent. Nothing gets asked twice.",
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
  const goLabel = user ? "Open the board" : "Start hunting";

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
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var h=location.hash.replace("#","");if(["today","feed","changes","pipeline","compare","profile"].indexOf(h)>=0){location.replace("/app"+location.search+location.hash)}})()`,
        }}
      />

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <p className="overline landing-eyebrow">
            New York City rentals · free, forever
          </p>
          <h1 className="display">
            Rent like you <span className="mark">know someone.</span>
          </h1>
          <p className="landing-sub">
            Five people are going to see that apartment today. Four of them
            know what the listing told them. DamnLease reads every listing
            site, the building&apos;s violation record and the comps on the
            block, then hands you the number to argue with and the message to
            send.
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

      {/* Who made this, and why it costs nothing — the two questions a
          stranger has after the pitch lands. */}
      <section className="landing-maker">
        <Reveal>
          <p className="overline">Why it&apos;s free</p>
          <p className="landing-maker-body">
            I built DamnLease because I lost an apartment I wanted by four
            hours, to someone who saw the listing first. Then I did it again.
            The tools renters get are catalogs built for the people selling;
            everything that decides the outcome — the real price, the
            building&apos;s record, who replied first — you&apos;re expected to
            work out alone, in twelve tabs, at midnight.
          </p>
          <p className="landing-maker-body">
            So this is the thing I wanted. It&apos;s{" "}
            <span className="mark">completely free</span>, there&apos;s no paid
            tier waiting behind a feature, and nothing about you is sold to
            anyone — there&apos;s no business model here to make that
            tempting. Use it, bring your roommate, and go take a place off
            somebody.
          </p>
          <p className="landing-maker-sign">— a frustrated renter, New York</p>
        </Reveal>
      </section>

      {/* The objection everyone raises, answered head-on rather than dodged.
          A browsing site and a hunting tool are different machines. */}
      <section className="landing-vs" id="why">
        <h2 className="display">&ldquo;Why not just use Zillow?&rdquo;</h2>
        <p className="landing-vs-lede">
          Because a listing site is a catalog, and the hunt isn&apos;t
          browsing. It&apos;s texting agents, booking tours, comparing
          finalists and beating four other applications to the same
          apartment. That part currently lives in twelve tabs, a group chat
          and a spreadsheet.
        </p>
        <ul className="landing-vs-rows">
          {(
            [
              [
                "Every site at once",
                "StreetEasy, Zillow, Apartments.com, HotPads and Craigslist, deduplicated — in NYC no single site has the inventory.",
                "One site's slice of the market",
              ],
              [
                "What it really costs",
                "Concessions spread over the lease, fees amortized, cash to move in — and whether your income clears the 40× rule.",
                "The asking rent",
              ],
              [
                "A price check with teeth",
                "Every listing measured against its own comps, with a ready-to-send negotiation script — or a warning to move fast instead.",
                "“Contact agent”",
              ],
              [
                "The building's record",
                "Open HPD violations, bedbug filings and the block's 311 noise complaints, from city data.",
                "The listing's own photos",
              ],
              [
                "A pipeline that chases",
                "Every place you pursue tracked from first text to signed lease; silence gets flagged and follow-ups draft themselves.",
                "Browser tabs and memory",
              ],
              [
                "A crew, not a group chat",
                "One shared board with your roommate or family — tours, videos from viewings, and who's on point for which agent.",
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
            which agent. Living alone? Let your friends and family scout —
            every find carries their name, and the final say stays yours.
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
