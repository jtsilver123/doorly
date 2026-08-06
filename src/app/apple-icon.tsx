import { ImageResponse } from "next/og";

/**
 * The home-screen icon.
 *
 * iOS ignores SVG favicons entirely, so "Add to Home Screen" — which is how a
 * tool you open at the door of an apartment actually gets used — would fall
 * back to a screenshot of the page. This renders the real mark at the size
 * Apple asks for.
 *
 * Generated rather than committed as a binary, for the same reason the social
 * card is: one definition of the brand, no PNG quietly going stale after the
 * next palette change. No rounding here — iOS masks the corners itself, and
 * pre-rounding it means visible double-rounding.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 14,
          padding: "0 22px",
          backgroundColor: "#d6f84b",
        }}
      >
        <div style={{ height: 22, width: 90, borderRadius: 11, backgroundColor: "rgba(20,20,26,0.4)" }} />
        <div style={{ height: 42, width: 136, borderRadius: 10, backgroundColor: "#14141a" }} />
        <div style={{ height: 22, width: 106, borderRadius: 11, backgroundColor: "rgba(20,20,26,0.4)" }} />
      </div>
    ),
    size
  );
}
