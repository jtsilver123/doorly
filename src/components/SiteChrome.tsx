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
}: {
  children: React.ReactNode;
  cta: string;
  ctaLabel: string;
  transparentBar?: boolean;
}) {
  return (
    <div className="site" data-hero={transparentBar ? "true" : undefined}>
      <ScrollBar>
        <Link className="site-brand" href="/">
          <Logo size={24} />
          DamnLease
        </Link>
        <nav className="site-nav">
          <Link href="/#what-you-know">What you get</Link>
          <Link href="/#why">Why not Zillow</Link>
          <span className="site-free">Free</span>
        </nav>
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
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href="mailto:jtsilver123@gmail.com?subject=DamnLease%20feedback">Contact</a>
          </nav>
        </div>
        <p>
          Built by a frustrated renter, in New York, after one too many
          bidding wars. Free to use. Listing data belongs to the sites it comes
          from, and every message is one you send yourself.
        </p>
      </footer>
    </div>
  );
}
