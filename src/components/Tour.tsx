"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The welcome walk.
 *
 * Setup ends with a saved search and a person standing in an app they have
 * never seen, where the whole method (save, contact, tour, decide) is
 * invisible until you know to look for it. Five stops, on the real
 * interface rather than screenshots of it: the tour dims the room and
 * lights the one thing being explained, because pointing at the actual
 * button beats describing where the button will be.
 *
 * Deliberately skippable from every stop, and it never comes back on its
 * own once dismissed. A tour you can't leave is a lecture.
 */

export interface TourStop {
  /** What to light up. Missing, or not on screen, means a centered card. */
  target?: string;
  title: string;
  body: string;
}

const PAD = 8;
const CARD_W = 340;
const CARD_H = 220; // worst case, used only to pick above/below

export default function Tour({
  stops,
  at,
  onAt,
  onClose,
}: {
  stops: TourStop[];
  at: number;
  onAt: (n: number) => void;
  onClose: (finished: boolean) => void;
}) {
  const stop = stops[at];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /*
   * The target may not exist yet: advancing a stop can switch tabs, and the
   * next tab's DOM lands a few frames later. Poll briefly rather than
   * measuring once and giving up; past the deadline the card simply
   * centers, which reads fine and never strands the tour.
   */
  useLayoutEffect(() => {
    let alive = true;
    let raf = 0;
    const deadline = performance.now() + 900;
    setRect(null);

    const find = () => {
      if (!alive) return;
      const el = stop.target ? document.querySelector(stop.target) : null;
      if (el) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setRect(r);
          return;
        }
      }
      if (performance.now() < deadline) raf = requestAnimationFrame(find);
    };
    raf = requestAnimationFrame(find);

    const remeasure = () => {
      const el = stop.target ? document.querySelector(stop.target) : null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [at, stop.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
      else if (e.key === "ArrowRight" && at < stops.length - 1) onAt(at + 1);
      else if (e.key === "ArrowLeft" && at > 0) onAt(at - 1);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [at, stops.length, onAt, onClose]);

  if (!mounted || !stop) return null;

  // Below the target when there's room, above when there isn't, clamped to
  // the viewport either way. On a phone the card hugs the bottom instead:
  // thumbs live there, and a fixed spot beats one that jumps per stop.
  const vw = window.innerWidth;
  const phone = vw <= 640;
  let cardStyle: React.CSSProperties;
  if (phone || !rect) {
    cardStyle = {};
  } else {
    const below = rect.bottom + PAD + 12;
    const fitsBelow = below + CARD_H < window.innerHeight - 12;
    const top = fitsBelow ? below : Math.max(12, rect.top - PAD - 12 - CARD_H);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, vw - CARD_W - 12));
    cardStyle = { top, left, position: "fixed" };
  }

  const last = at === stops.length - 1;

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label="Quick tour">
      {rect ? (
        <div
          className="tour-spot"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      ) : (
        <div className="tour-dim" />
      )}

      <div className="tour-card" style={cardStyle} data-centered={!phone && !rect ? "true" : undefined}>
        <span className="tour-count">
          {at + 1} of {stops.length}
        </span>
        <b>{stop.title}</b>
        <p>{stop.body}</p>
        <div className="tour-nav">
          <button className="linkish tour-skip" onClick={() => onClose(false)}>
            Skip the tour
          </button>
          <div className="tour-steps">
            {at > 0 && (
              <button className="btn" onClick={() => onAt(at - 1)}>
                Back
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => (last ? onClose(true) : onAt(at + 1))}
            >
              {last ? "Start hunting" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
