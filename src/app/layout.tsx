import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

/**
 * The typeface. Singular.
 *
 * One family, stretched across its own width axis, does the job two families
 * used to. Archivo is a variable font with `wdth` as well as `wght`, so the
 * same file that sets a dense table of rents at normal width also sets the
 * headline at 125% — poster-wide, near-black, unmistakably one voice rather
 * than a serif borrowed to look editorial.
 *
 * That's the brand argument, not a technical one. A product claiming to know
 * what the market is really doing shouldn't sound like two different
 * companies between the pitch and the pipeline. It should sound like the same
 * flat, exact voice getting louder.
 *
 * Practically it's also the cheapest possible type system: one woff2 covers
 * every weight and width in the app. Self-hosted at build time by next/font,
 * so there's no third-party request, no layout shift, no flash of fallback.
 */

const archivo = Archivo({
  subsets: ["latin"],
  // The width axis is the whole point; without it `font-stretch` is inert
  // and every headline quietly collapses back to normal.
  axes: ["wdth"],
  variable: "--font-sans-real",
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute base for the social card URL — link unfurlers won't chase a
  // relative path.
  metadataBase: new URL("https://damnlease.com"),
  /*
   * Written for the searches people actually type on their worst apartment
   * day: "nyc apartment search tracker", "apartment hunting spreadsheet",
   * "rental CRM". The phrases live in honest sentences, not a keyword pile —
   * stuffing reads worse to Google than to humans now.
   */
  title: {
    default: "DamnLease · NYC apartment hunting, run like a pipeline",
    template: "%s · DamnLease",
  },
  description:
    "A free CRM for finding an NYC apartment. Every rental listing site checked hourly, priced against real comps, tracked through outreach, tours, and applications. The spreadsheet, retired.",
  keywords: [
    "NYC apartment search",
    "apartment hunting tracker",
    "rental search CRM",
    "find an apartment in New York",
    "apartment hunting spreadsheet replacement",
    "StreetEasy tracker",
    "NYC rental pipeline",
  ],
  alternates: { canonical: "https://damnlease.com" },
  openGraph: {
    title: "DamnLease — Be first, not lucky.",
    description:
      "A good NYC apartment is gone in a day, and it goes to whoever replied first. Every listing site checked hourly, each place priced against its own comps, the building's record from city data, and your message already written.",
    url: "https://damnlease.com",
    siteName: "DamnLease",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DamnLease — Be first, not lucky.",
    description:
      "Gone in a day, to whoever replied first. Every listing site checked hourly, priced against real comps, message already written.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1eee5" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
