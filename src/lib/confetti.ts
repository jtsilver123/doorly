/**
 * A one-second celebration for landing a place on the board.
 *
 * Plain DOM on purpose: a burst is fire-and-forget, and threading a canvas
 * library through React state for ninety falling rectangles would be more
 * ceremony than the moment. Pieces ride CSS animations (compositor work, no
 * per-frame JS), the layer ignores pointer events so nothing under it goes
 * dead, and the whole thing removes itself.
 *
 * Skipped entirely under prefers-reduced-motion — a celebration that makes
 * someone motion-sick celebrates nothing.
 */
export function burstConfetti(): void {
  if (typeof document === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // One burst at a time; mashing the button shouldn't snow the screen over.
  if (document.querySelector(".confetti")) return;

  const host = document.createElement("div");
  host.className = "confetti";
  host.setAttribute("aria-hidden", "true");

  const colors = ["var(--action)", "var(--warn)", "var(--good)", "var(--accent)"];
  for (let i = 0; i < 90; i++) {
    const piece = document.createElement("i");
    piece.style.setProperty("--x", `${Math.random() * 100}vw`);
    piece.style.setProperty("--dx", `${(Math.random() - 0.5) * 34}vw`);
    piece.style.setProperty("--t", `${1 + Math.random()}s`);
    piece.style.setProperty("--r", `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.setProperty("--d", `${Math.random() * 0.3}s`);
    piece.style.background = colors[i % colors.length];
    if (i % 3 === 0) piece.style.borderRadius = "50%";
    host.appendChild(piece);
  }

  document.body.appendChild(host);
  setTimeout(() => host.remove(), 2600);
}
