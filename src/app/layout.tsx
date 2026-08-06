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
  title: "DamnLease",
  description:
    "Every NYC listing site, the building's violation record and the comps on the block — then the number to argue with and the message to send.",
  openGraph: {
    title: "DamnLease — Rent like you know someone.",
    description:
      "Every listing site in one list, each place priced against its own comps, the building's record pulled from city data, and the message already written. The other applicants have the listing photos.",
    url: "https://damnlease.com",
    siteName: "DamnLease",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DamnLease — Rent like you know someone.",
    description:
      "Every listing site in one list, priced against real comps, with the building's record and the message already written.",
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
