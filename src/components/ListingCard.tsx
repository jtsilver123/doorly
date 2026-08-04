"use client";

import { useState } from "react";
import type { FeedListing } from "@/types";
import { LINK_PREFERENCE, SOURCE_LABEL, STAGE_LABEL } from "@/types";
import { CONTACT_ICON, CONTACT_LABEL, bestChannel } from "@/lib/outreach";

/** Sites this listing appears on, best-to-open first (Zillow, then StreetEasy). */
export function orderedSources(listing: FeedListing) {
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
  focused?: boolean;
  onOpen: (listing: FeedListing) => void;
  onStar: (listing: FeedListing) => void;
  onPass: (listing: FeedListing) => void;
  onReach: (listing: FeedListing) => void;
}

export default function ListingCard({
  listing,
  focused,
  onOpen,
  onStar,
  onPass,
  onReach,
}: Props) {
  const dropped = listing.price < listing.originalPrice;
  const rose = listing.price > listing.originalPrice;
  const delta = listing.price - listing.originalPrice;
  const reach = bestChannel(listing);
  // Listing CDNs expire URLs, so a dead image must fall back to the placeholder
  // rather than leaving a broken-image glyph in the grid.
  const [imageBroken, setImageBroken] = useState(false);
  const sources = orderedSources(listing);
  const primary = sources[0];

  return (
    <article
      className="card surface"
      data-focused={focused ? "true" : undefined}
      style={{ opacity: listing.isActive ? 1 : 0.55 }}
    >
      <button
        onClick={() => onOpen(listing)}
        className="card-media"
        aria-label={`Open ${listing.address}`}
      >
        {listing.imageUrl && !imageBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImageBroken(true)}
          />
        ) : (
          <span className="muted card-noimg">{listing.neighborhood || "No photo"}</span>
        )}

        <div className="card-badges">
          {!listing.isActive && <span className="chip">off market</span>}
          {dropped && <span className="chip chip-good">↓ {money(Math.abs(delta))}</span>}
          {rose && <span className="chip chip-warn">↑ {money(delta)}</span>}
          {listing.noFee && <span className="chip chip-accent">no fee</span>}
          {listing.needsFollowUp && <span className="chip chip-warn">follow up</span>}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onStar(listing);
          }}
          className="card-star"
          title={listing.starred ? "Unstar" : "Star"}
          style={{ color: listing.starred ? "#fbbf24" : "#fff" }}
        >
          {listing.starred ? "★" : "☆"}
        </button>
      </button>

      <div className="card-body">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <strong style={{ fontSize: 17, letterSpacing: "-0.01em" }}>
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

        <button className="card-title" onClick={() => onOpen(listing)}>
          {listing.address}
          {listing.unit ? ` #${listing.unit}` : ""}
        </button>

        <div className="muted" style={{ fontSize: 12 }}>
          {listing.neighborhood || listing.borough || "NYC"} ·{" "}
          {relative(listing.firstSeenAt)}
          {listing.daysOnMarket > 21 ? ` · ${listing.daysOnMarket}d listed` : ""}
        </div>

        {listing.score != null && (
          <div title={listing.scoreReasons.join(" · ")}>
            <div className="meter">
              <span style={{ width: `${listing.score}%` }} />
            </div>
            <div className="muted card-why">
              {listing.score}% · {listing.scoreReasons[0] ?? "—"}
            </div>
          </div>
        )}

        <div className="card-chips">
          {sources.map((s) => (
            <a
              key={s.source}
              className="chip"
              href={s.url}
              target="_blank"
              rel="noreferrer"
              title={`Open on ${SOURCE_LABEL[s.source]}`}
              onClick={(e) => e.stopPropagation()}
            >
              {SOURCE_LABEL[s.source]} ↗
            </a>
          ))}
          {listing.stage !== "inbox" && (
            <span className="chip chip-accent">{STAGE_LABEL[listing.stage]}</span>
          )}
          {listing.lastContactChannel && (
            <span className="chip" title={`Last contact ${relative(listing.lastContactAt!)}`}>
              {CONTACT_ICON[listing.lastContactChannel]}{" "}
              {CONTACT_LABEL[listing.lastContactChannel]}
              {listing.contactCount > 1 ? ` ×${listing.contactCount}` : ""}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
          {/* The label follows what this listing can actually do. There is no
              state where the primary button is present but does nothing. */}
          <button
            className="btn btn-primary"
            style={{ flex: 1, minWidth: 0 }}
            onClick={() => onReach(listing)}
            title={reach.hint}
          >
            {reach.label}
          </button>
          {primary && (
            <a
              className="btn"
              href={primary.url}
              target="_blank"
              rel="noreferrer"
              title={`Open on ${SOURCE_LABEL[primary.source]}`}
            >
              ↗
            </a>
          )}
          <button className="btn" onClick={() => onPass(listing)} title="Not for me (X)">
            ✕
          </button>
        </div>
      </div>
    </article>
  );
}
