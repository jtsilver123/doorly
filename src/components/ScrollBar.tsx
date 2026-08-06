"use client";

import { useEffect, useState } from "react";

/**
 * The top bar, and the one thing it does when you scroll.
 *
 * Over the hero it's invisible — bone type on ink, no chrome, nothing between
 * the reader and the headline. The moment the page moves it takes on a
 * background and a hairline, because a transparent bar over body copy is
 * unreadable and a bar that was never transparent wastes the best 60 pixels
 * on the page.
 *
 * A `passive` scroll listener that only ever flips a boolean: the class does
 * the animating, so scrolling never waits on React.
 */
export default function ScrollBar({ children }: { children: React.ReactNode }) {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="site-bar" data-stuck={stuck ? "true" : undefined}>
      {children}
    </header>
  );
}
