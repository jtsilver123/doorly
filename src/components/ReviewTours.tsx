"use client";

import { useEffect, useState } from "react";
import type { FeedListing } from "@/types";
import Icon from "@/components/Icon";
import { RatingDisc } from "@/components/Rating";

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
 * The layout is a screening room: the footage owns the left on a dark
 * stage (one clip big, the rest as a filmstrip), and everything that
 * informs the call sits on the right where the buttons are. Arrow keys
 * move between places, because a review is a flow, not four clicks.
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
  const [heroAt, setHeroAt] = useState(0);
  const [media, setMedia] = useState<
    Record<string, { id: string; kind: string; url: string }[]>
  >({});
  const current = listings[at];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setAt((n) => Math.min(n + 1, listings.length - 1));
      if (e.key === "ArrowLeft") setAt((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, listings.length]);

  // A new place starts on its first clip.
  useEffect(() => setHeroAt(0), [current?.id]);

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
  /*
   * One list whatever the source: your footage when you filmed, the
   * listing's own photos when you didn't. The banner below says which.
   */
  const usingListingPhotos = clips !== undefined && clips.length === 0;
  const items: { id: string; kind: string; url: string }[] =
    clips === undefined
      ? []
      : clips.length > 0
        ? clips.slice(0, 8)
        : (current.images?.length ? current.images.slice(0, 6) : current.imageUrl ? [current.imageUrl] : []).map(
            (url) => ({ id: url, kind: "image", url })
          );
  const hero = items[Math.min(heroAt, Math.max(items.length - 1, 0))];

  const touredOn = current.stageChangedAt
    ? new Date(current.stageChangedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <div
      className="compare-modal"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compare-modal-panel review-panel" role="dialog" aria-modal="true" aria-label="Review your tours">
        <div className="review-grid">
          {/* --- the screening room ---------------------------------------- */}
          <div className="review-stage">
            {clips === undefined ? (
              <span className="muted review-stage-note">Loading your footage…</span>
            ) : hero ? (
              <>
                {hero.kind === "video" ? (
                  // #t paints frame one instead of a black box awaiting play.
                  <video key={hero.id} src={`${hero.url}#t=0.01`} controls playsInline preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={hero.id} src={hero.url} alt="Tour footage" />
                )}
                {items.length > 1 && (
                  <div className="review-strip" role="tablist" aria-label="Clips from this tour">
                    {items.map((m, i) => (
                      <button
                        key={m.id}
                        className={i === heroAt ? "review-still is-on" : "review-still"}
                        role="tab"
                        aria-selected={i === heroAt}
                        aria-label={`Clip ${i + 1}`}
                        onClick={() => setHeroAt(i)}
                      >
                        {m.kind === "video" ? (
                          <>
                            <video src={`${m.url}#t=0.01`} preload="metadata" muted playsInline />
                            <span className="review-still-play" aria-hidden="true">
                              <Icon name="play" size={12} />
                            </span>
                          </>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.url} alt="" loading="lazy" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {usingListingPhotos && (
                  <span className="review-stage-note muted">
                    No footage from your tour; these are the listing&apos;s own photos
                  </span>
                )}
              </>
            ) : (
              <span className="muted review-stage-note">
                Nothing filmed here, and the listing has no photos.
              </span>
            )}
          </div>

          {/* --- the call -------------------------------------------------- */}
          <div className="review-rail">
            <div className="review-rail-head">
              <div>
                <b>Review your tours</b>
                {listings.length > 1 && (
                  <div className="review-dots" aria-label={`Place ${at + 1} of ${listings.length}`}>
                    {listings.length <= 8 ? (
                      listings.map((l, i) => (
                        <span key={l.id} className={i === at ? "dot is-on" : "dot"} />
                      ))
                    ) : (
                      <span className="muted">{at + 1} of {listings.length}</span>
                    )}
                  </div>
                )}
              </div>
              <button className="btn" onClick={onClose}>
                Done
              </button>
            </div>

            <div className="review-place">
              <div className="review-place-top">
                <RatingDisc rating={current.rating} grade={current.grade} size="sm" />
                <button className="linkish review-addr" onClick={() => onOpen(current)} title="Open the full panel">
                  {current.address}
                  {current.unit ? ` #${current.unit}` : ""}
                </button>
              </div>
              <span className="muted">
                {current.neighborhood} · {money(current.price)}/mo ·{" "}
                {current.bedrooms === 0 ? "Studio" : `${current.bedrooms}bd`}/
                {current.bathrooms}ba
                {touredOn ? ` · toured ${touredOn}` : ""}
              </span>
              {current.ratingHeadline && (
                <span className="review-headline">{current.ratingHeadline}</span>
              )}
              {current.notes && <p className="review-notes">&ldquo;{current.notes}&rdquo;</p>}
            </div>

            <div className="review-verdict">
              <button
                className={current.lean === 1 ? "lean-btn review-thumb is-on" : "lean-btn review-thumb"}
                data-lean={1}
                onClick={() => decide(current.lean === 1 ? 0 : 1)}
              >
                <Icon name="thumbup" size={18} />
                Could live here
              </button>
              <button
                className={current.lean === -1 ? "lean-btn review-thumb is-on" : "lean-btn review-thumb"}
                data-lean={-1}
                onClick={() => decide(current.lean === -1 ? 0 : -1)}
              >
                <Icon name="thumbdown" size={18} />
                Not it
              </button>
            </div>

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
              <span className="muted review-keys">or use ← →</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
