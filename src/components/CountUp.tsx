"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that arrives by counting.
 *
 * Only used on the proof strip, and for a reason: "4,182 listings tracked" is
 * the page's one factual claim, and watching it climb is what makes a reader
 * register it as a live measurement rather than as marketing copy that
 * happens to contain a digit.
 *
 * It counts once, on a `requestAnimationFrame` loop, eased so it decelerates
 * into the real figure. Reduced motion, or no rAF, gets the final number
 * immediately — and the server-rendered HTML already contains it, so this
 * never blanks out for a crawler.
 */
export default function CountUp({ to, duration = 900 }: { to: number; duration?: number }) {
  const [n, setN] = useState(to);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Small numbers aren't worth animating — "5" ticking up from zero is a
    // distraction, not a measurement.
    if (to < 20) return;

    let raf = 0;
    const begin = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - begin) / duration);
      // easeOutCubic: fast off the mark, settling rather than stopping.
      setN(Math.round(to * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    setN(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);

  return <>{n.toLocaleString()}</>;
}
