"use client";

import type { FeedListing } from "@/types";
import { LINK_PREFERENCE, SOURCE_LABEL, STAGE_LABEL } from "@/types";
import { CONTACT_ICON, CONTACT_LABEL } from "@/lib/outreach";

/** Sites this listing appears on, best-to-open first (Zillow, then StreetEasy). */
function orderedSources(listing: FeedListing) {
  return [...listing.alsoOn]
    .filter((s) => s.url)
    .sort(
      (a, b) => LINK_PREFERENCE.indexOf(a.source) - LINK_PREFERENCE.indexOf(b.source)
    );
}

function money(n: number): string {
  return `$${n.toLocaleString()}`;
}

function relative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface Props {
  listing: FeedListing;
  onOpen: (listing: FeedListing) => void;
  onStar: (listing: FeedListing) => void;
  onPass: (listing: FeedListing) => void;
  onText: (listing: FeedListing) => void;
}

export default function ListingCard({ listing, onOpen, onStar, onPass, onText }: Props) {
  const dropped = listing.price < listing.originalPrice;
  const rose = listing.price > listing.originalPrice;
  const delta = listing.price - listing.originalPrice;

  return (
    <article
      className="surface"
      style={{
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        opacity: listing.isActive ? 1 : 0.6,
      }}
    >
      <button
        onClick={() => onOpen(listing)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "block",
          position: "relative",
          aspectRatio: "16 / 10",
          background: "var(--surface-2)",
        }}
        aria-label={`Open ${listing.address}`}
      >
        {listing.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt=""
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            className="muted"
            style={{
              display: "grid",
              placeItems: "center",
              height: "100%",
              fontSize: 12,
            }}
          >
            no photo
          </div>
        )}

        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            maxWidth: "calc(100% - 16px)",
          }}
        >
          {!listing.isActive && <span className="chip">off market</span>}
          {dropped && (
            <span className="chip chip-good">↓ {money(Math.abs(delta))}</span>
          )}
          {rose && <span className="chip chip-warn">↑ {money(delta)}</span>}
          {listing.noFee && <span className="chip chip-accent">no fee</span>}
          {listing.unseenEvents > 0 && (
            <span className="chip chip-accent">{listing.unseenEvents} new</span>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onStar(listing);
          }}
          title={listing.starred ? "Unstar" : "Star"}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            border: "none",
            borderRadius: 8,
            width: 30,
            height: 30,
            background: "rgba(0,0,0,0.45)",
            color: listing.starred ? "#fbbf24" : "#fff",
            fontSize: 15,
            lineHeight: 1,
          }}
        >
          {listing.starred ? "★" : "☆"}
        </button>
      </button>

      <div style={{ padding: 12, display: "grid", gap: 8, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <strong style={{ fontSize: 18, letterSpacing: "-0.01em" }}>
            {money(listing.price)}
          </strong>
          {(dropped || rose) && (
            <span
              className="muted"
              style={{ fontSize: 12, textDecoration: "line-through" }}
            >
              {money(listing.originalPrice)}
            </span>
          )}
          <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
            {listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bed`}
            {listing.sqft ? ` · ${listing.sqft} ft²` : ""}
          </span>
        </div>

        <button
          onClick={() => onOpen(listing)}
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.35,
          }}
        >
          {listing.address}
          {listing.unit ? ` #${listing.unit}` : ""}
        </button>

        <div className="muted" style={{ fontSize: 12 }}>
          {listing.neighborhood || listing.borough || "NYC"} · seen{" "}
          {relative(listing.firstSeenAt)}
          {listing.daysOnMarket > 21 ? ` · ${listing.daysOnMarket}d on market` : ""}
        </div>

        {listing.score != null && (
          <div title={listing.scoreReasons.join(" · ")}>
            <div className="meter">
              <span style={{ width: `${listing.score}%` }} />
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {listing.score}% match · {listing.scoreReasons[0] ?? "—"}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: "auto" }}>
          {/* Each site it was found on opens directly, best-UI site first. */}
          {orderedSources(listing).map((s) => (
            <a
              key={s.source}
              className="chip"
              href={s.url}
              target="_blank"
              rel="noreferrer"
              title={`Open on ${SOURCE_LABEL[s.source]}`}
              style={{ textDecoration: "none" }}
            >
              {SOURCE_LABEL[s.source]} ↗
            </a>
          ))}
          {listing.stage !== "inbox" && (
            <span className="chip chip-accent">{STAGE_LABEL[listing.stage]}</span>
          )}
          {listing.lastContactChannel && (
            <span className="chip" title={`Last contacted ${relative(listing.lastContactAt!)}`}>
              {CONTACT_ICON[listing.lastContactChannel]}{" "}
              {CONTACT_LABEL[listing.lastContactChannel]}
              {listing.contactCount > 1 ? ` ×${listing.contactCount}` : ""}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => onText(listing)}
            title="Draft a tour request text"
          >
            Text for tour
          </button>
          <a
            className="btn"
            href={orderedSources(listing)[0]?.url ?? listing.url}
            target="_blank"
            rel="noreferrer"
            title={`Open on ${SOURCE_LABEL[orderedSources(listing)[0]?.source ?? listing.source]}`}
          >
            Open
          </a>
          <button className="btn" onClick={() => onPass(listing)} title="Not for me">
            ✕
          </button>
        </div>
      </div>
    </article>
  );
}
