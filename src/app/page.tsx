import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import AuthArt from "@/components/AuthArt";
import Logo from "@/components/Logo";

/**
 * The front door — the marketing site, for everyone.
 *
 * The app lives at /app now; this page's job is the pitch, whether or not
 * you're signed in. For a stranger from a group chat that means one
 * enormous unmissable button; for a signed-in visitor the same buttons
 * simply open the app instead of the signup form.
 *
 * Server component on purpose: plain HTML with the map art rendered
 * server-side — nobody pays for the app bundle's hydration here.
 */

export const dynamic = "force-dynamic";

const STEPS: { title: string; body: string }[] = [
  {
    title: "Every site, one search",
    body: "StreetEasy, Zillow, Apartments.com, HotPads and Craigslist, checked twice a day and deduplicated — the same apartment posted four times is one card, not four tabs.",
  },
  {
    title: "A pipeline, not a pile of tabs",
    body: "One keystroke files each place — interested, contacted, tour booked, seen, applied. The board chases silence for you, so nothing rots in a tab you forgot.",
  },
  {
    title: "Text the agent in one tap",
    body: "The message is already written — the apartment, your move-in, the ask. Add a number you dug up yourself and the text button appears next to it.",
  },
  {
    title: "Tours land on your calendar",
    body: "One click puts the viewing in Google Calendar or an invite file — with the rent, the score, your notes and the agent's number for when you're at the door.",
  },
  {
    title: "Compare, then commit",
    body: "Decision night puts your finalists side by side — rent, true monthly, cash to move in — with the best value marked in every row and your own notes beside them.",
  },
];

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

  const user = await currentUser();
  const go = user ? "/app" : "/signup";
  const goLabel = user ? "Open Doorly" : "Secure a place";

  return (
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
        <AuthArt />
        <header className="landing-nav">
          <span className="landing-brand">
            <Logo size={26} />
            Doorly
          </span>
          <Link className="btn landing-signin" href={user ? "/app" : "/login"}>
            {user ? "Open the app" : "Sign in"}
          </Link>
        </header>

        <div className="landing-hero-inner">
          <h1>
            NYC apartments go in a day. <b>So&nbsp;will&nbsp;you.</b>
          </h1>
          <p>
            Doorly watches every listing site at once, scores each place
            against what you actually want, and drafts the message that gets
            you the viewing — so the search stops living in twelve browser
            tabs.
          </p>
          <div className="landing-cta">
            <Link className="landing-go" href={go}>
              {goLabel}
            </Link>
            <span className="landing-cta-sub">
              {user
                ? "Your pipeline is where you left it"
                : "Free · two minutes to set up · bring your roommate"}
            </span>
          </div>
        </div>
      </section>

      <section className="landing-steps">
        {STEPS.map((step, i) => (
          <article key={step.title}>
            <span className="landing-step-n">{i + 1}</span>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      {/* The objection everyone raises, answered head-on rather than dodged.
          A browsing site and a hunting tool are different machines. */}
      <section className="landing-vs">
        <h2>&ldquo;Why not just use Zillow?&rdquo;</h2>
        <p>
          Because Zillow is a catalog, and the hunt isn&apos;t browsing — it&apos;s
          texting agents, booking tours, comparing finalists and racing other
          applicants. That part currently lives in twelve tabs, a group chat
          and a spreadsheet. That part is Doorly.
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
        <p className="landing-vs-close">
          Zillow shows you apartments. <b>Doorly wins you one.</b>
        </p>
      </section>

      <section className="landing-team">
        <div>
          <h2>Hunt as a team</h2>
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

      <footer className="landing-foot">
        <span>
          <Logo size={18} /> Doorly
        </span>
        <span>
          Listing data belongs to the sites it comes from. Every message is one
          you send yourself.
        </span>
      </footer>
    </main>
  );
}
