"use client";

import { useState } from "react";
import type { FeedListing } from "@/types";
import type { Source } from "@/types";
import { linkPreference, SOURCE_LABEL, STAGE_LABEL } from "@/types";
import { CONTACT_ICON, CONTACT_LABEL, bestChannel } from "@/lib/outreach";
import SourceMark from "@/components/SourceMark";
import Perks from "@/components/Perks";
import { RatingDisc, ProsConsLine } from "@/components/Rating";

/**
 * A listing card.
 *
 * Built around one rule: every card is the same height and the same shape, so
 * scanning the grid means comparing numbers in fixed positions rather than
 * re-reading a new layout each time. The previous version let content dictate
 * height, which left ragged gaps and made two identical apartments look
 * different from each other.
 *
 * The order answers the questions in the order they get asked: how good is it
 * (the rating), what does it cost, what do I actually get, where is it, what's
 * the catch, and how do I reach them. Source, status and actions sit in a fixed
 * footer so they can never push the numbers around.
 */

export function orderedSources(listing: FeedListing, favourite?: Source | null) {
  const order = linkPreference(favourite);
  return [...listing.alsoOn]
    .filter((s) => s.url)
    .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
}

const money = (n: number) => `$${n.toLocaleString()}`;

function relative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "new today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface Props {
  listing: FeedListing;
  focused?: boolean;
  /** Hovered on the map. Mirrors the card's own hover state so the two link. */
  linked?: boolean;
  /** Which site to open first when the apartment is on several. */
  preferredSource?: Source;
  onHover?: (id: string | null) => void;
  onOpen: (listing: FeedListing) => void;
  onStar: (listing: FeedListing) => void;
  onPass: (listing: FeedListing) => void;
  onReach: (listing: FeedListing) => void;
}

export default function ListingCard({
  listing,
  focused,
  linked,
  preferredSource,
  onHover,
  onOpen,
  onStar,
  onPass,
  onReach,
}: Props) {
  const [imageBroken, setImageBroken] = useState(false);

  const dropped = listing.price < listing.originalPrice;
  const rose = listing.price > listing.originalPrice;
  const delta = listing.price - listing.originalPrice;
  const reach = bestChannel(listing);
  const sources = orderedSources(listing, preferredSource);
  const primary = sources[0];
  const warn = listing.flags.find((f) => f.severity === "warn");
  const size = listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bed`;

  return (
    <article
      className="card"
      data-focused={focused ? "true" : undefined}
      data-linked={linked ? "true" : undefined}
      data-gone={!listing.isActive ? "true" : undefined}
      onMouseEnter={() => onHover?.(listing.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <button
        className="card-media"
        onClick={() => onOpen(listing)}
        aria-label={`Open ${listing.address}`}
      >
        {/* The label sits *under* the photo rather than instead of it. An
            <img> that never resolves — a slow CDN, an ad-blocker eating
            photos.zillowstatic.com, an offline phone — fires no error event, so
            a swap-on-error left a silent blank rectangle. Something is always
            behind it now, which doubles as the loading placeholder. */}
        <span className="card-noimg" aria-hidden="true">
          {listing.neighborhood || listing.borough || "No photo"}
        </span>
        {listing.imageUrl && !imageBroken && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImageBroken(true)}
          />
        )}

        {/* At most two badges — more than that and none of them get read. */}
        <span className="card-badges">
          {!listing.isActive && <b className="tag tag-grey">Off market</b>}
          {dropped && <b className="tag tag-green">↓ {money(Math.abs(delta))}</b>}
          {rose && <b className="tag tag-amber">↑ {money(delta)}</b>}
          {listing.noFee && <b className="tag tag-green">No fee</b>}
          {warn && (
            <b className="tag tag-amber" title={warn.message}>
              Verify
            </b>
          )}
        </span>

        {/* The score sits on the photo because it's the first thing to read,
            and the verdict beside it stops it being an unexplained number. */}
        <span className="card-score">
          <RatingDisc rating={listing.rating} grade={listing.grade} />
          <span className="card-score-word">{listing.ratingHeadline}</span>
        </span>

        {/* Save was a ghost that only appeared on hover, so on a touch screen
            it did not exist and on a desktop most people never found it. Both
            judgments sit here permanently now, and dismiss is separated from
            the primary action so a mis-click costs nothing. */}
        <span className="card-judge">
          <button
            className="card-star"
            onClick={(e) => {
              e.stopPropagation();
              onStar(listing);
            }}
            aria-label={listing.starred ? "Remove from saved" : "Save this listing"}
            aria-pressed={listing.starred}
            data-on={listing.starred ? "true" : undefined}
          >
            {listing.starred ? "★" : "☆"}
          </button>
          <button
            className="card-pass"
            onClick={(e) => {
              e.stopPropagation();
              onPass(listing);
            }}
            title="Not for me"
            aria-label={`Not for me: ${listing.address}`}
          >
            ✕
          </button>
        </span>
      </button>

      <div className="card-body">
        <button className="card-headline" onClick={() => onOpen(listing)}>
          <span className="card-price">{money(listing.price)}</span>
          <span className="card-size">{size}</span>
        </button>

        <div className="card-sub">
          {money(listing.upfrontCost)} to move in
          {listing.sqft ? ` · ${listing.sqft} ft²` : ""}
        </div>

        <button className="card-address" onClick={() => onOpen(listing)}>
          {listing.address}
          {listing.unit ? ` #${listing.unit}` : ""}
        </button>

        <div className="card-where">
          {listing.neighborhood || listing.borough || "NYC"} · {relative(listing.firstSeenAt)}
        </div>

        <Perks keys={listing.perks} />

        <ProsConsLine listing={listing} />

        <div className="card-foot">
          {/* Status only shows when there is a status; an empty row of its own
              was costing every card a line to say nothing. */}
          {(listing.stage !== "inbox" || listing.lastContactChannel) && (
            <span className="srcrow">
              {listing.stage !== "inbox" && (
                <b className="tag tag-accent">{STAGE_LABEL[listing.stage]}</b>
              )}
              {listing.lastContactChannel && (
                <b
                  className="tag tag-grey"
                  title={`Last contact ${relative(listing.lastContactAt!)}`}
                >
                  {CONTACT_ICON[listing.lastContactChannel]}{" "}
                  {CONTACT_LABEL[listing.lastContactChannel]}
                </b>
              )}
            </span>
          )}

          <div className="card-actions">
            <span className="srcrow card-srcs">
              {sources.map((s) => (
                <SourceMark key={s.source} source={s.source} href={s.url} />
              ))}
            </span>
            <button
              className="btn btn-primary btn-block"
              onClick={() => onReach(listing)}
              title={reach.hint}
            >
              {reach.label}
            </button>
            {primary && (
              <a
                className="btn btn-icon"
                href={primary.url}
                target="_blank"
                rel="noreferrer"
                title={`Open on ${SOURCE_LABEL[primary.source]}`}
                aria-label={`Open on ${SOURCE_LABEL[primary.source]}`}
              >
                ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
