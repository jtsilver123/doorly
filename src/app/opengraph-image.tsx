import { ImageResponse } from "next/og";

/**
 * The social card — what iMessage, Slack and Twitter show when someone pastes
 * the link into a group chat. Which, for a product whose whole growth loop is
 * "someone pastes the link into a group chat", is the front door before the
 * front door.
 *
 * Generated, not a static file, so it can never drift from the brand: the
 * same flat ink field, the same four-window mark, and the same one acid
 * highlight doing the same job it does everywhere else — marking the part
 * that's the point.
 */

const INK = "#14141a";
const BONE = "#f4f2ea";
const ACID = "#d6f84b";

export const alt = "DamnLease — rent like you know someone";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/*
 * The brand's own typeface, vendored as TrueType.
 *
 * Satori — what renders this card — cannot read woff2, which is the only
 * format next/font produces, so the card would otherwise be set in whatever
 * generic sans the renderer falls back to. That's the one asset where a
 * mismatched face actually costs something: this is what a stranger sees in
 * a group chat, before they've seen anything else.
 *
 * Read through `import.meta.url` rather than `fs`, so it works whether the
 * route is prerendered at build or re-rendered in a Worker, and committed
 * rather than fetched so the build never depends on Google being up.
 */
async function brandFont(): Promise<Buffer | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    return await readFile(join(process.cwd(), "src/app/archivo-bold.ttf"));
  } catch {
    // A card in the fallback sans beats no card at all — and note the caller
    // omits `fonts` entirely rather than passing an empty array, which Satori
    // treats as a fatal "no fonts loaded" rather than as "use the default".
    return null;
  }
}

export default async function OpengraphImage() {
  const font = await brandFont();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: INK,
          color: BONE,
          fontFamily: font ? "Archivo" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {/* Three lines, the middle one marked. */}
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
            <rect x="3.5" y="3.5" width="12" height="3" rx="1.5" fill={BONE} opacity="0.32" />
            <rect x="1.5" y="9.5" width="21" height="5.5" rx="1.2" fill={ACID} />
            <rect x="3.5" y="18" width="15" height="3" rx="1.5" fill={BONE} opacity="0.32" />
          </svg>
          <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: -1 }}>DamnLease</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {/*
           * Two rows rather than one wrapped line: the highlight has to sit
           * tight around "know someone" alone, and Satori won't inline-wrap a
           * background the way a browser does.
           */}
          <div style={{ display: "flex", fontSize: 92, fontWeight: 700, letterSpacing: -4 }}>
            Rent like you
          </div>
          {/*
            * The period lives inside the highlight. Left outside as its own
            * flex item it sat off the baseline and read as a stray dot — and
            * a highlighter that stops one character short of the end of the
            * phrase looks like a mistake rather than a mark.
            */}
          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                padding: "2px 16px 12px",
                backgroundColor: ACID,
                color: INK,
                fontSize: 92,
                fontWeight: 700,
                letterSpacing: -4,
                borderRadius: 5,
              }}
            >
              know someone.
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 27, color: "rgba(244,242,234,0.68)" }}>
            Every listing site · priced against real comps · the building&apos;s record ·
            the message already written
          </div>
        </div>
      </div>
    ),
    font
      ? { ...size, fonts: [{ name: "Archivo", data: font, weight: 700 as const, style: "normal" as const }] }
      : size
  );
}
