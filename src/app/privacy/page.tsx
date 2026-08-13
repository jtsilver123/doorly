import type { Metadata } from "next";
import { currentUser } from "@/lib/supabase/server";
import { appUrl } from "@/lib/site";
import SiteChrome from "@/components/SiteChrome";

/**
 * The privacy policy.
 *
 * Written to describe what this app genuinely does rather than to cover
 * everything a template imagines it might — the whole product is an argument
 * about being told the truth, and a boilerplate policy claiming rights nobody
 * exercises would undercut it on the one page where people go looking for
 * exactly that.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy · DamnLease",
  description: "What DamnLease stores, why, and how to get rid of it.",
};

const UPDATED = "August 2026";

export default async function Privacy() {
  const user = await currentUser();
  return (
    <SiteChrome
      cta={user ? appUrl("/app") : "/signup"}
      ctaLabel={user ? "Back to the hunt" : "Start the hunt"}
      signedIn={Boolean(user)}
    >
      <article className="legal">
        <p className="overline">Privacy</p>
        <h1 className="display">What we keep, and why.</h1>
        <p className="legal-lede">
          DamnLease is a free tool made by one person. There is no advertising
          business behind it, no data brokerage, and nothing to gain from
          holding more of your information than the app needs to work. Last
          updated {UPDATED}.
        </p>

        <h2>What&apos;s stored</h2>
        <ul>
          <li>
            <b>Your account.</b> Your email address and a password hash. If
            you sign in with Google, the email and name Google hands back.
            Passwords are never stored in a form anyone can read.
          </li>
          <li>
            <b>Your search.</b> Neighborhoods, budget, bedroom count, move-in
            date, and the preferences that let the app score a listing against
            what you actually want.
          </li>
          <li>
            <b>Your pipeline.</b> The places you save, their stage, your notes
            and ratings, tour times, and any agent name or phone number you
            enter yourself.
          </li>
          <li>
            <b>Your footage.</b> Photos and video you upload after a viewing.
            These live in Cloudflare R2 and are served only to you and the
            crew you invited. The app checks who you are on every request.
          </li>
          <li>
            <b>Listing data.</b> Apartments pulled from public listing sites and
            from New York City&apos;s open data. This is about buildings, not
            about you.
          </li>
          <li>
            <b>Push subscriptions</b>, if you turn notifications on. That is
            a token from your browser which lets us send you an alert, and
            nothing else.
          </li>
        </ul>

        <h2>What isn&apos;t</h2>
        <ul>
          <li>
            No advertising or tracking pixels, no third-party analytics, no
            cross-site profile of you.
          </li>
          <li>
            Your data is never sold, rented, or shared with brokers, landlords,
            or listing sites. Nobody is paying to find out that you&apos;re
            looking.
          </li>
          <li>
            No agent, landlord or listing site is told you saved their listing,
            scored it badly, or walked away. Messages go out from your own
            phone or email, when you send them.
          </li>
          <li>
            No payment details, because the app is free and there is nothing to
            pay for.
          </li>
        </ul>

        <h2>Who else touches it</h2>
        <p>
          Three services, each doing one job: <b>Supabase</b> hosts the database
          and handles sign-in; <b>Cloudflare</b> runs the app and stores your
          uploads; <b>Google</b> is involved only if you choose to sign in with
          it. If you paste in your own listing-data API key, it&apos;s used for
          your searches and stored so the hourly refresh can keep running.
        </p>

        <h2>Crews</h2>
        <p>
          Inviting someone to your crew is what shares your pipeline with them:
          they can see the places you&apos;re tracking, your notes and your tour
          footage for that search. That&apos;s the point of the feature, but
          it is worth saying plainly: only invite people you would show the
          spreadsheet to. Removing someone cuts off their access.
        </p>

        <h2>Getting rid of it</h2>
        <p>
          Delete any listing, note, or file from inside the app and it is
          gone. The file is removed from storage, not just hidden. To delete
          your whole account and everything attached to it, email{" "}
          <a href="mailto:jtsilver123@gmail.com?subject=Delete%20my%20DamnLease%20account">
            jtsilver123@gmail.com
          </a>{" "}
          and it will be done. No retention period, no exit interview.
        </p>

        <h2>Changes</h2>
        <p>
          If this policy changes in a way that affects what&apos;s collected or
          who sees it, the date at the top changes and the app will say so.
        </p>

        <p className="legal-note">
          Questions about any of this go to{" "}
          <a href="mailto:jtsilver123@gmail.com?subject=DamnLease%20privacy">
            jtsilver123@gmail.com
          </a>
          , and get answered by the person who wrote the code.
        </p>
      </article>
    </SiteChrome>
  );
}
