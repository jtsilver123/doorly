"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Content that arrives as you reach it.
 *
 * A small, one-way move: eight pixels up and a fade, once, when the block
 * first crosses into view. That's the whole budget — anything springier reads
 * as a template, and this brand's argument is that it's precise.
 *
 * Three rules it follows that most scroll animations don't:
 *  - It disconnects after firing, so scrolling back up doesn't re-run it.
 *  - It starts *visible* and only hides itself once the observer is running,
 *    so a reader with JavaScript off or a crawler reading the page sees
 *    everything rather than a blank column.
 *  - It obeys `prefers-reduced-motion` by never hiding anything at all.
 */
export default function Reveal({
  children,
  /** Stagger, in ms, so a list arrives as a sequence rather than a slab. */
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) return;

    const el = ref.current;
    if (!el) return;
    // Already on screen at load (the first block usually is): leave it alone
    // rather than fading in something the reader is already looking at.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) return;

    setShown(false);
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setShown(true);
        io.disconnect();
      },
      { rootMargin: "0px 0px -12% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className ? `reveal ${className}` : "reveal"}
      data-shown={shown ? "true" : "false"}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
