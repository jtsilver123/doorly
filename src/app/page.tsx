import Link from "next/link";
import { currentUser } from "@/lib/supabase/server";
import App from "@/components/App";
import AuthArt from "@/components/AuthArt";
import Logo from "@/components/Logo";

/**
 * The front door.
 *
 * Signed in, this is the app. Signed out, it's the pitch — a real landing
 * page rather than a login wall, because the first thing a link from a group
 * chat should do is explain why this exists, and the second thing is one
 * enormous unmissable button.
 *
 * Server component on purpose: the split keeps the landing page in plain
 * HTML with the map art rendered server-side, and only signed-in visitors
 * pay for the client app bundle's hydration.
 */

export const dynamic = "force-dynamic";

const STEPS: { title: string; body: string }[] = [
  {
    title: "Every site, one list",
    body: "StreetEasy, Zillow, Apartments.com, HotPads and Craigslist, checked twice a day and deduplicated — the same apartment posted four times is one card, not four tabs.",
  },
  {
    title: "A score you can argue with",
    body: "Every place gets 1–100 against real comparables and your own budget, with the reasons spelled out. Add your own score after the viewing; yours wins.",
  },
  {
    title: "First complete application wins",
    body: "One tap drafts the text — the agent's name, the apartment, video first. Your income, documents and move-in date ride along, ready before the viewing ends.",
  },
];

export default async function Home() {
  const user = await currentUser();
  if (user) return <App />;

  return (
    <main className="landing">
      <section className="landing-hero">
        <AuthArt />
        <header className="landing-nav">
          <span className="landing-brand">
            <Logo size={26} />
            Doorly
          </span>
          <Link className="btn landing-signin" href="/login">
            Sign in
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
            <Link className="landing-go" href="/signup">
              Secure a place
            </Link>
            <span className="landing-cta-sub">
              Free · two minutes to set up · bring your roommate
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

      <section className="landing-team">
        <div>
          <h2>Hunt as a team</h2>
          <p>
            Moving in with someone? Share one pipeline and split who talks to
            which agent. Living alone? Let your friends and family scout —
            every find carries their name, and the final say stays yours.
          </p>
        </div>
        <Link className="landing-go landing-go-sm" href="/signup">
          Secure a place
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
