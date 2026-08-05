import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Instrument_Sans } from "next/font/google";
import "./globals.css";

/**
 * The typefaces.
 *
 * The app ran on `system-ui` — which is to say, on nothing. A stack with no
 * opinion produces screens with no voice, and it's the first thing that makes
 * software look like a template.
 *
 * Two faces, one family of intent. Instrument Serif carries the brand and the
 * headlines: it's an editorial face, and an apartment hunt is closer to
 * reading a listings page in a newspaper than to filling in a dashboard.
 * Instrument Sans does the work — dense metadata, prices, controls — with the
 * tall x-height and tabular figures that a wall of rents needs.
 *
 * Self-hosted at build time by next/font, so there's no third-party request,
 * no layout shift, and no flash of the fallback.
 */

const display = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans-real",
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute base for the social card URL — link unfurlers won't chase a
  // relative path.
  metadataBase: new URL("https://doorlynyc.vercel.app"),
  title: "Doorly",
  description:
    "Doorly watches every NYC listing site at once, scores each apartment 1–100 for you, and drafts the message that gets the viewing.",
  openGraph: {
    title: "Doorly — NYC apartments go in a day. So will you.",
    description:
      "Every listing site in one list, each place scored against what you actually want, and one-tap outreach. Hunt solo or as a team.",
    url: "https://doorlynyc.vercel.app",
    siteName: "Doorly",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Doorly — NYC apartments go in a day. So will you.",
    description:
      "Every listing site in one list, each place scored against what you actually want, and one-tap outreach.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0f151c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
