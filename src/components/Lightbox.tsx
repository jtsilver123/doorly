"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";

/**
 * Full-screen media, over everything.
 *
 * Photos in a 200px card are for recognising a place, not for judging one. The
 * decision — is that a real bedroom, is that mould, is the window facing a
 * wall — happens at full size, and until now the only way to get there was to
 * open the listing in a new tab and lose your place.
 *
 * It reads like the photo apps people already have: arrow keys and on-screen
 * arrows on a pointer, swipe on touch, Escape or a tap on the backdrop to
 * leave. Video keeps native controls, because nobody wants a bespoke scrubber.
 */

export interface LightboxItem {
  url: string;
  kind: "photo" | "video";
  caption?: string;
}

export default function Lightbox({
  items,
  start = 0,
  onClose,
}: {
  items: LightboxItem[];
  start?: number;
  onClose: () => void;
}) {
  const [at, setAt] = useState(start);
  const panel = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      setAt((i) => {
        const next = i + delta;
        // Wrap: flipping past the last photo of five lands back on the first,
        // which is what every gallery on a phone does.
        if (next < 0) return items.length - 1;
        if (next >= items.length) return 0;
        return next;
      });
    },
    [items.length]
  );

  /*
   * Keys are bound to the document, not the panel: the panel takes focus on
   * open, but a click on a video's native controls moves focus into the video
   * element and a panel-scoped handler would stop responding.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // The page behind must not scroll while this is open — on iOS especially,
  // where a scrolling backdrop drags the viewer with it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const item = items[at];
  if (!item) return null;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.caption || "Media viewer"}
      ref={panel}
      tabIndex={-1}
      // Only a click on the backdrop itself closes. Without the target check,
      // releasing a drag that started on the image counts as a backdrop click
      // and the viewer vanishes mid-look.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const from = touchX.current;
        touchX.current = null;
        if (from === null || items.length < 2) return;
        const dx = (e.changedTouches[0]?.clientX ?? from) - from;
        // 45px, so a slightly untidy tap isn't read as a swipe.
        if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="lightbox-bar">
        {items.length > 1 && (
          <span className="lightbox-count">
            {at + 1} / {items.length}
          </span>
        )}
        <button className="lightbox-x" onClick={onClose} aria-label="Close viewer">
          <Icon name="close" size={18} />
        </button>
      </div>

      {items.length > 1 && (
        <>
          <button
            className="lightbox-nav lightbox-prev"
            onClick={() => go(-1)}
            aria-label="Previous"
          >
            <Icon name="chevron-left" size={22} />
          </button>
          <button
            className="lightbox-nav lightbox-next"
            onClick={() => go(1)}
            aria-label="Next"
          >
            <Icon name="chevron-right" size={22} />
          </button>
        </>
      )}

      <figure className="lightbox-stage">
        {item.kind === "video" ? (
          /*
           * Keyed by url so switching clips tears the element down instead of
           * swapping `src` on a playing one — which leaves the old audio
           * running in some browsers.
           */
          <video key={item.url} src={item.url} controls autoPlay playsInline />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.caption || `Photo ${at + 1}`} />
        )}
        {item.caption ? <figcaption>{item.caption}</figcaption> : null}
      </figure>
    </div>
  );
}
