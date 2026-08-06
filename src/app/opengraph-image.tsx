import { ImageResponse } from "next/og";

/**
 * The social card — what iMessage, Slack and Twitter show when someone pastes
 * the link into a group chat. Which, for a product whose whole growth loop is
 * "someone pastes the link into a group chat", is the front door before the
 * front door.
 *
 * Generated, not a static file, so it can never drift from the brand: same
 * navy, same facade mark with its one lit window, same voice.
 */

export const alt = "DamnLease — find your NYC apartment before everybody else does";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
          backgroundImage: "linear-gradient(150deg, #1e415f 0%, #16324f 46%, #0a1929 100%)",
          color: "#f4f6f8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {/* The facade, one window lit. */}
          <svg width="88" height="88" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="2.5" width="18" height="19" rx="2.5" fill="#dceaf5" />
            <rect x="6.5" y="6" width="4" height="4" rx="0.8" fill="#16324f" opacity="0.55" />
            <rect x="13.5" y="6" width="4" height="4" rx="0.8" fill="#16324f" opacity="0.55" />
            <rect x="6.5" y="12" width="4" height="4" rx="0.8" fill="#16324f" opacity="0.55" />
            <rect x="13.5" y="12" width="4" height="4" rx="0.8" fill="#ffd66b" />
          </svg>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2 }}>DamnLease</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              letterSpacing: -3,
              lineHeight: 1.05,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>NYC apartments go in a day.</span>
            <span style={{ color: "#ffd66b" }}>So will you.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                padding: "16px 34px",
                backgroundColor: "#2fbf71",
                borderRadius: 16,
                fontSize: 30,
                fontWeight: 700,
                color: "#ffffff",
              }}
            >
              Secure a place
            </div>
            <div style={{ fontSize: 26, color: "rgba(244,246,248,0.7)" }}>
              Every listing site, one list · scored 1–100 · hunt as a team
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
