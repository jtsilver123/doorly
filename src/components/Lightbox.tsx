"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 *
 * Rendered through a portal to `document.body`, which is not a detail. Its
 * callers live inside the listing drawer, and the drawer is a positioned,
 * animated element — so a `position: fixed` child was being laid out against
 * the drawer instead of the viewport, and its z-index was trapped in the
 * drawer's stacking context. The photo came up half off-screen with the
 * drawer's own tab bar and close button painted on top of it. Escaping to the
 * body is the only reliable fix; no z-index is large enough otherwise.
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
  const [shareState, setShareState] = useState<"idle" | "busy" | "done">("idle");
  const panel = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  // The button's "Sent"/"Saved" belongs to the file it was pressed on.
  useEffect(() => setShareState("idle"), [at]);

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

  // Portals need a DOM, and this renders on the server first.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const item = items[at];

  /**
   * The file itself, not a link to it.
   *
   * Your footage lives behind the session cookie, so a copied URL is a dead
   * end for anyone you'd send it to. Sharing hands over the actual bytes:
   * the native sheet with the file attached where one exists (a phone,
   * which is where forwarding happens), a plain download where it doesn't
   * (desktop, where the file lands ready to drop into any thread). Listing
   * photos ride the same button; when their host refuses a cross-origin
   * read, the public URL goes instead, which works fine for those.
   */
  async function shareCurrent() {
    if (!item || shareState === "busy") return;
    const done = () => {
      setShareState("done");
      setTimeout(() => setShareState("idle"), 1800);
    };
    setShareState("busy");
    const cleanUrl = item.url.split("#")[0];
    try {
      const res = await fetch(cleanUrl, { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();

      let name =
        decodeURIComponent(cleanUrl.split("?")[0].split("/").pop() ?? "") ||
        (item.kind === "video" ? "tour-video" : "photo");
      if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
        const sub = (blob.type.split("/")[1] || (item.kind === "video" ? "mp4" : "jpg"))
          .replace("jpeg", "jpg")
          .replace("quicktime", "mov");
        name += `.${sub}`;
      }
      const file = new File([blob], name, {
        type: blob.type || (item.kind === "video" ? "video/mp4" : "image/jpeg"),
      });

      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          setShareState("idle");
          return;
        } catch (err) {
          // Closing the sheet is an answer, not an error.
          if ((err as DOMException)?.name === "AbortError") {
            setShareState("idle");
            return;
          }
          // The sheet refused the file (some browsers balk at big videos);
          // fall through to handing it over as a download.
        }
      }

      const obj = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = obj;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can race the download in Firefox.
      setTimeout(() => URL.revokeObjectURL(obj), 10_000);
      done();
    } catch {
      // Couldn't read the bytes: a listing site photo refusing a
      // cross-origin fetch. Those URLs are public, so the link itself works.
      try {
        if (navigator.share) await navigator.share({ url: cleanUrl });
        else await navigator.clipboard.writeText(cleanUrl);
        done();
      } catch {
        setShareState("idle");
      }
    }
  }

  if (!item || !mounted) return null;

  return createPortal(
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
        <button
          className="lightbox-share"
          onClick={shareCurrent}
          disabled={shareState === "busy"}
          aria-label={item.kind === "video" ? "Share this video" : "Share this photo"}
        >
          <Icon name={shareState === "done" ? "check" : "share"} size={16} />
          <span>
            {shareState === "busy" ? "Preparing…" : shareState === "done" ? "Done" : "Share"}
          </span>
        </button>
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
           *
           * Muted, because browsers refuse unmuted autoplay — the old bare
           * autoPlay was silently blocked, leaving a black rectangle stuck
           * at 0:00 that read as a broken upload. Muted autoplay is allowed
           * everywhere, the clip is moving the moment the lightbox opens,
           * and the sound is one tap on the controls. The ref sets the
           * property directly since the attribute alone isn't always enough
           * for the autoplay policy check.
           */
          <video
            key={item.url}
            src={item.url}
            controls
            autoPlay
            muted
            playsInline
            preload="auto"
            ref={(el) => {
              if (el) el.muted = true;
            }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.caption || `Photo ${at + 1}`} />
        )}
        {item.caption ? <figcaption>{item.caption}</figcaption> : null}
      </figure>
    </div>,
    document.body
  );
}
