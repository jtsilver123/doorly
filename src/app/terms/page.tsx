import type { Metadata } from "next";
import { currentUser } from "@/lib/supabase/server";
import { appUrl } from "@/lib/site";
import SiteChrome from "@/components/SiteChrome";

/**
 * The terms.
 *
 * Short on purpose. The honest version of the agreement between a free tool
 * and the person using it fits on one screen, and the parts that actually
 * matter — the listing data is somebody else's, the numbers are estimates,
 * this is not a broker — are the parts a template would bury.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms — DamnLease",
  description: "The short version of what DamnLease is and isn't.",
};

const UPDATED = "August 2026";

export default async function Terms() {
  const user = await currentUser();
  return (
    <SiteChrome cta={user ? appUrl("/app") : "/signup"} ctaLabel={user ? "Open the board" : "Start hunting"}>
      <article className="legal">
        <p className="overline">Terms of use</p>
        <h1 className="display">The short version.</h1>
        <p className="legal-lede">
          DamnLease is a free tool for keeping track of an apartment search. By
          using it you&apos;re agreeing to the following, which is all of it.
          Last updated {UPDATED}.
        </p>

        <h2>It&apos;s free</h2>
        <p>
          No fee, no trial, no card, no paid tier waiting behind a feature. If
          that ever changes, existing accounts get told before it does — not
          after.
        </p>

        <h2>What DamnLease is not</h2>
        <ul>
          <li>
            <b>Not a broker or an agent.</b> It doesn&apos;t represent you,
            list apartments, hold deposits or take part in your lease. Every
            message to an agent is sent by you, from your own phone or email.
          </li>
          <li>
            <b>Not legal, financial or tax advice.</b> The income checks, fee
            maths and negotiation scripts are arithmetic and suggestions, not
            counsel.
          </li>
          <li>
            <b>Not the source of the listings.</b> Apartments come from public
            listing sites and from New York City open data. That content
            belongs to whoever published it.
          </li>
        </ul>

        <h2>The numbers are estimates</h2>
        <p>
          Scores, comps, true monthly cost, cash to move in, commute times and
          building records are computed from third-party data that can be
          stale, incomplete or simply wrong. They exist to help you ask better
          questions at the viewing, not to be relied on as fact. Confirm
          anything that matters before you sign a lease or hand over money.
        </p>

        <h2>Your account</h2>
        <p>
          Keep your password to yourself; you&apos;re responsible for what
          happens under your account. Inviting someone to your crew gives them
          access to that search — its listings, notes and footage — until you
          remove them.
        </p>

        <h2>What you upload</h2>
        <p>
          Your photos and video stay yours. You give DamnLease only the
          permission it needs to store them and show them back to you and your
          crew. Don&apos;t upload anything you don&apos;t have the right to,
          and don&apos;t film people who haven&apos;t agreed to it.
        </p>

        <h2>Fair use</h2>
        <p>
          Don&apos;t scrape the app, hammer it with automated requests, resell
          the data, or use it to harass anyone. Accounts doing any of that get
          switched off.
        </p>

        <h2>No warranty, and limits</h2>
        <p>
          The app is provided as it is, with no guarantee that it will be
          available, accurate, or that you&apos;ll get the apartment. To the
          extent the law allows, the author isn&apos;t liable for losses
          arising from using it — including an apartment you missed, a lease
          you signed, or data that turned out to be wrong. This is a free tool
          built by one renter, not a service with a support contract.
        </p>

        <h2>Ending it</h2>
        <p>
          Stop using it whenever you like, and email{" "}
          <a href="mailto:jtsilver123@gmail.com?subject=Delete%20my%20DamnLease%20account">
            jtsilver123@gmail.com
          </a>{" "}
          to have the account and everything in it deleted. The app may be
          discontinued at some point; if that happens you&apos;ll get enough
          warning to export what you care about.
        </p>

        <p className="legal-note">
          These terms are governed by the law of the State of New York.
          Questions go to{" "}
          <a href="mailto:jtsilver123@gmail.com?subject=DamnLease%20terms">
            jtsilver123@gmail.com
          </a>
          .
        </p>
      </article>
    </SiteChrome>
  );
}
