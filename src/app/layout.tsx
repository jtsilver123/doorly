import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
