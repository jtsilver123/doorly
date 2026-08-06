"use client";

import { useRef, useState } from "react";
import Icon from "@/components/Icon";

/**
 * Every photo the sources published, in one strip you can actually flip
 * through — arrows on a pointer, a native swipe on touch.
 *
 * Scroll-snap rather than a stateful carousel: the browser owns the gesture,
 * momentum and snapping, so swiping works exactly like the photo apps people
 * already know, and the only JavaScript left is keeping the counter honest
 * and pointing the arrows. Broken URLs drop out of the strip instead of
 * rendering as grey squares — sources recycle CDN links and some die.
 *
 * Parents key this by listing id so the strip resets when the panel moves to
 * another apartment.
 */
export default function PhotoGallery({
  images,
  alt,
  placeholder,
}: {
  images: string[];
  /** Alt text for the lead photo; the rest are numbered off it. */
  alt: string;
  /** What to show when there are no photos at all: the neighborhood name. */
  placeholder: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [urls, setUrls] = useState(images);
  const [at, setAt] = useState(0);

  const go = (delta: number) => {
    const el = strip.current;
    if (!el) return;
    const next = Math.max(0, Math.min(urls.length - 1, at + delta));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="drawer-photo gallery">
      <span className="drawer-photo-alt" aria-hidden="true">
        {placeholder}
      </span>

      {urls.length > 0 && (
        <div
          className="gallery-strip"
          ref={strip}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
        >
          {urls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={i === 0 ? alt : `${alt} — photo ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"}
              onError={() => setUrls((list) => list.filter((u) => u !== url))}
            />
          ))}
        </div>
      )}

      {urls.length > 1 && (
        <>
          <button
            className="gallery-arrow is-prev"
            onClick={() => go(-1)}
            disabled={at === 0}
            aria-label="Previous photo"
          >
            <Icon name="chevron-left" size={18} />
          </button>
          <button
            className="gallery-arrow is-next"
            onClick={() => go(1)}
            disabled={at >= urls.length - 1}
            aria-label="Next photo"
          >
            <Icon name="chevron-right" size={18} />
          </button>
          <span className="gallery-count" aria-live="polite">
            {Math.min(at + 1, urls.length)} / {urls.length}
          </span>
        </>
      )}

      {/* One photo is data, not breakage — say so, or the missing arrows read
          as the gallery being broken. The site link has the rest. */}
      {urls.length === 1 && (
        <span className="gallery-count">1 photo — more on the listing site</span>
      )}
    </div>
  );
}
