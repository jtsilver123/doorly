import Link from "next/link";
import { redirect } from "next/navigation";
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
  searchParams: Promise<{ code?: string }>;
}) {
  /*
   * A `?code=` on the root is a misrouted OAuth callback.
   *
   * When Supabase doesn't recognise the redirect target (an allowlist miss),
   * it falls back to its configured Site URL — the bare origin, no path. The
   * dashboard setting is the real fix, but the app shouldn't strand a valid
   * sign-in code on the landing page while a setting is wrong somewhere else.
   */
  const { code } = await searchParams;
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}`);

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
