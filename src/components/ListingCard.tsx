"use client";

import { useState } from "react";
import type { FeedListing } from "@/types";
import type { Source } from "@/types";
import { linkPreference, SOURCE_LABEL, STAGE_LABEL } from "@/types";
import { CONTACT_ICON, CONTACT_LABEL } from "@/lib/outreach";
import { nextAction } from "@/lib/nextAction";
import { lastChangeOf } from "@/lib/timeline";
import SourceMark from "@/components/SourceMark";
import Perks from "@/components/Perks";
import { RatingDisc, MyScoreDisc, ProsConsLine } from "@/components/Rating";
import { nearestStation, subwayLabel } from "@/lib/subway";

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
  /** Tag-team attribution — "via Emma" — when someone else found it. */
  via?: string | null;
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
  via,
  onHover,
  onOpen,
  onStar,
  onPass,
  onReach,
}: Props) {
  const [imageBroken, setImageBroken] = useState(false);
  /** Which of the listing's photos the card is showing. */
  const [shot, setShot] = useState(0);
  const shots = listing.images.length ? listing.images : listing.imageUrl ? [listing.imageUrl] : [];

  const dropped = listing.price < listing.originalPrice;
  const rose = listing.price > listing.originalPrice;
  const delta = listing.price - listing.originalPrice;
  const action = nextAction(listing);
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
        {shots.length > 0 && !imageBroken && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shots[Math.min(shot, shots.length - 1)]}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImageBroken(true)}
          />
        )}

        {/* Flip through the photos right on the card — opening the panel
            just to see the second picture was a tax on every listing. */}
        {shots.length > 1 && !imageBroken && (
          <>
            <span
              role="button"
              tabIndex={0}
              className="card-flip is-prev"
              aria-label="Previous photo"
              onClick={(e) => {
                e.stopPropagation();
                setShot((s) => (s - 1 + shots.length) % shots.length);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setShot((s) => (s - 1 + shots.length) % shots.length);
                }
              }}
            >
              ‹
            </span>
            <span
              role="button"
              tabIndex={0}
              className="card-flip is-next"
              aria-label="Next photo"
              onClick={(e) => {
                e.stopPropagation();
                setShot((s) => (s + 1) % shots.length);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setShot((s) => (s + 1) % shots.length);
                }
              }}
            >
              ›
            </span>
            <span className="card-shotcount">
              {Math.min(shot + 1, shots.length)}/{shots.length}
            </span>
          </>
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
          {/* Once you've scored it yourself, your number is the one that
              matters — so it sits first among equals and the headline gives up
              its room rather than the two discs fighting for the corner. */}
          {listing.myScore != null && <MyScoreDisc score={listing.myScore} size="sm" />}
          {listing.myScore == null && (
            <span className="card-score-word">{listing.ratingHeadline}</span>
          )}
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
          {/* When the ad itself last moved — a drop or a relist newer than
              the listing date is the freshness that matters. */}
          {(() => {
            const change = lastChangeOf(listing);
            if (change.kind === "listed") return null;
            return (
              <>
                {" · "}
                <span title={new Date(change.at).toLocaleString()}>
                  {change.kind === "price change" ? "price moved" : "relisted"}{" "}
                  {relative(change.at)}
                </span>
              </>
            );
          })()}
          {/* The train, on every card. It's the fact that decides whether a
              cheap place in a far neighborhood is actually cheap. */}
          {(() => {
            const near = nearestStation(listing.lat, listing.lon);
            return near ? (
              <>
                {" · "}
                <span className="card-train" title={subwayLabel(near)}>
                  {near.minutes} min to {near.routes.split("").join("/")}
                </span>
              </>
            ) : null;
          })()}
        </div>

        <Perks keys={listing.perks} />

        <ProsConsLine listing={listing} />

        <div className="card-foot">
          {/* Status only shows when there is a status; an empty row of its own
              was costing every card a line to say nothing. */}
          {(listing.stage !== "inbox" || listing.lastContactChannel || via) && (
            <span className="srcrow">
              {listing.stage !== "inbox" && (
                <b className="tag tag-accent">{STAGE_LABEL[listing.stage]}</b>
              )}
              {/* Tag-team attribution: who found this one for you. */}
              {via && <b className="tag tag-grey">{via}</b>}
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
            {/* The action follows the state. A card at "Tour booked" shows
                when the tour is; one you've applied to doesn't invite you to
                ask for a viewing again. */}
            {action.kind === "wait" || action.kind === "done" ? (
              <span className="card-state">{action.label}</span>
            ) : (
              <button
                className={
                  action.urgent
                    ? "btn btn-primary btn-block is-urgent"
                    : "btn btn-primary btn-block"
                }
                onClick={() => onReach(listing)}
                title={action.hint}
              >
                {action.label}
              </button>
            )}
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
