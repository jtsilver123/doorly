import Link from "next/link";
import Logo from "@/components/Logo";
import ScrollBar from "@/components/ScrollBar";

/**
 * The marketing site's top bar and footer.
 *
 * Shared so the pitch, the privacy policy and the terms are recognisably one
 * site — a legal page that drops the header is the oldest tell that nobody
 * really wrote it. The bar carries the one thing worth saying before anything
 * else: this is free.
 */
export default function SiteChrome({
  children,
  cta,
  ctaLabel,
  /** The pitch paints its own dark hero behind a transparent bar. */
  transparentBar = false,
  /**
   * Whether there is a session. The bar was offering "Log in" beside "Back
   * to the hunt" to people who were plainly already logged in, which is
   * nonsense on its own and on a phone pushed the button that matters off
   * the side of the screen.
   */
  signedIn = false,
}: {
  children: React.ReactNode;
  cta: string;
  ctaLabel: string;
  transparentBar?: boolean;
  signedIn?: boolean;
}) {
  return (
    <div className="site" data-hero={transparentBar ? "true" : undefined}>
      <ScrollBar>
        <Link className="site-brand" href="/">
          <Logo size={24} />
          DamnLease
        </Link>
        <nav className="site-nav">
          {/* Named for the heading it lands on, so the scroll doesn't feel
              like it went somewhere else. */}
          <Link href="/#what-you-know">What you know</Link>
          <Link href="/guides">Neighborhoods</Link>
          <Link href="/#about">About</Link>
          <span className="site-free">Free</span>
        </nav>
        {/* The returning hunter's door. The whole page sells the start of a
            hunt; without this, someone mid-hunt on a new phone had no way
            back into theirs from the front page at all. Pointless once
            they have a session, and on a phone it costs the CTA its room. */}
        {!signedIn && (
          <Link className="site-login" href="/login">
            Log in
          </Link>
        )}
        <Link className="btn site-cta" href={cta}>
          {ctaLabel}
        </Link>
      </ScrollBar>

      {children}

      <footer className="site-foot">
        <div className="site-foot-top">
          <span className="site-brand site-brand-sm">
            <Logo size={20} />
            DamnLease
          </span>
          <nav>
            <Link href="/guides">Neighborhoods</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href="mailto:jtsilver123@gmail.com?subject=DamnLease%20feedback">Contact</a>
          </nav>
        </div>
        <p>
          Built by a frustrated renter in New York, after one too many
          bidding wars. Free to use. Listing data belongs to the sites it
          comes from, and every message is one you send yourself.
        </p>
      </footer>
    </div>
  );
}
