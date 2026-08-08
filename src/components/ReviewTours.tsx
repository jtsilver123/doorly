"use client";

import { useEffect, useState } from "react";
import type { FeedListing } from "@/types";
import Icon from "@/components/Icon";

const money = (n: number) => `$${n.toLocaleString()}`;

/**
 * Review mode: the tours you took, replayed one place at a time.
 *
 * After a day of viewings the places blur, and the board's little thumb
 * buttons ask for a verdict without showing the evidence. This walks the
 * Toured column with each place's own footage and facts on screen, takes a
 * thumb, and moves to the next — the whole day judged in a minute, while
 * the kitchens are still distinguishable.
 *
 * The thumb is the same soft lean as the card's: a gut call on record,
 * never a stage move.
 */
export default function ReviewTours({
  listings,
  onLean,
  onOpen,
  onClose,
}: {
  listings: FeedListing[];
  onLean: (listing: FeedListing, lean: number) => void;
  onOpen: (listing: FeedListing) => void;
  onClose: () => void;
}) {
  const [at, setAt] = useState(0);
  const [media, setMedia] = useState<
    Record<string, { id: string; kind: string; url: string }[]>
  >({});
  const current = listings[at];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Footage arrives per place as it comes on screen, not all up front.
  useEffect(() => {
    if (!current || media[current.id]) return;
    fetch(`/api/listings/${encodeURIComponent(current.id)}/media`)
      .then((r) => r.json())
      .then((b) => setMedia((m) => ({ ...m, [current.id]: b.media ?? [] })))
      .catch(() => setMedia((m) => ({ ...m, [current.id]: [] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) return null;

  const decide = (lean: number) => {
    onLean(current, lean);
    if (at < listings.length - 1) setAt(at + 1);
    else onClose();
  };

  const clips = media[current.id];
  const shots = clips ?? [];
  const gallery = shots.length
    ? null
    : current.images?.length
      ? current.images.slice(0, 4)
      : current.imageUrl
        ? [current.imageUrl]
        : [];

  return (
    <div
      className="compare-modal"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compare-modal-panel review-panel" role="dialog" aria-modal="true" aria-label="Review your tours">
        <div className="compare-modal-head">
          <div>
            <b>Review your tours</b>
            <div className="muted" style={{ fontSize: 12 }}>
              {at + 1} of {listings.length} · your footage, your call
            </div>
          </div>
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="review-place">
          <button className="linkish review-addr" onClick={() => onOpen(current)} title="Open the full panel">
            {current.address}
            {current.unit ? ` #${current.unit}` : ""}
          </button>
          <span className="muted">
            {current.neighborhood} · {money(current.price)}/mo ·{" "}
            {current.bedrooms === 0 ? "Studio" : `${current.bedrooms}bd`}/
            {current.bathrooms}ba
          </span>
          {current.notes && <p className="review-notes">&ldquo;{current.notes}&rdquo;</p>}
        </div>

        <div className="review-media">
          {clips === undefined ? (
            <span className="muted">Loading your footage…</span>
          ) : shots.length > 0 ? (
            shots.slice(0, 6).map((m) =>
              m.kind === "video" ? (
                // #t paints frame one instead of a black box awaiting play.
                <video key={m.id} src={`${m.url}#t=0.01`} controls playsInline preload="metadata" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={m.id} src={m.url} alt="Tour footage" loading="lazy" />
              )
            )
          ) : gallery && gallery.length > 0 ? (
            <>
              {gallery.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="Listing photo" loading="lazy" />
              ))}
              <span className="muted review-nofootage">
                No footage from your tour, so these are the listing&apos;s own photos
              </span>
            </>
          ) : (
            <span className="muted">Nothing filmed here, and the listing has no photos.</span>
          )}
        </div>

        <div className="review-verdict">
          <button
            className={current.lean === -1 ? "lean-btn review-thumb is-on" : "lean-btn review-thumb"}
            data-lean={-1}
            onClick={() => decide(current.lean === -1 ? 0 : -1)}
          >
            <Icon name="thumbdown" size={20} />
            Not it
          </button>
          <div className="review-nav">
            <button className="btn" disabled={at === 0} onClick={() => setAt(at - 1)}>
              <Icon name="chevron-left" size={14} /> Prev
            </button>
            <button
              className="btn"
              disabled={at === listings.length - 1}
              onClick={() => setAt(at + 1)}
            >
              Next <Icon name="chevron-right" size={14} />
            </button>
          </div>
          <button
            className={current.lean === 1 ? "lean-btn review-thumb is-on" : "lean-btn review-thumb"}
            data-lean={1}
            onClick={() => decide(current.lean === 1 ? 0 : 1)}
          >
            <Icon name="thumbup" size={20} />
            Could live here
          </button>
        </div>
      </div>
    </div>
  );
}
