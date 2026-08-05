"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedListing } from "@/types";
import Icon from "@/components/Icon";

/**
 * Taking a place out of the running, and saying why.
 *
 * Solo, this is a one-tap dismiss and the dialog never appears. In a crew it
 * matters more: somebody went looking on your behalf, found this, and put it
 * in your pipeline. If it silently disappears they learn nothing, and the
 * next five they send have the same problem as this one.
 *
 * So the reasons are the ones that actually change what a scout sends next —
 * too expensive, wrong area, too small, bad building — plus a line of your
 * own. All optional: a required explanation would just mean nobody passes
 * anything, and a pipeline you can't clear is worse than a scout who repeats
 * themselves.
 */

const REASONS = [
  "Too expensive",
  "Wrong neighborhood",
  "Too small",
  "Building looks rough",
  "Bad layout",
  "Too far from the train",
  "Already gone",
];

export default function PassDialog({
  listing,
  finderName,
  onConfirm,
  onClose,
}: {
  listing: FeedListing;
  /** Who found it, when that isn't you. Null means no one to tell. */
  finderName: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(reason: string) {
    setPicked((list) =>
      list.includes(reason) ? list.filter((r) => r !== reason) : [...list, reason]
    );
  }

  const reason = [picked.join(", "), note.trim()].filter(Boolean).join(" — ");

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className="passdialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Pass on ${listing.address}`}
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="passdialog-head">
          <div>
            <h2>Passing on this one</h2>
            <p className="muted">
              {listing.address}
              {listing.unit ? ` #${listing.unit}` : ""}
              {finderName ? ` · ${finderName} found it` : ""}
            </p>
          </div>
          <button className="btn" onClick={onClose} aria-label="Cancel">
            <Icon name="close" size={15} />
          </button>
        </header>

        {finderName && (
          <p className="passdialog-why">
            {finderName} will see this, so the next places they send are closer
            to what you want.
          </p>
        )}

        <div className="passdialog-reasons" role="group" aria-label="Why">
          {REASONS.map((r) => (
            <button
              key={r}
              className={picked.includes(r) ? "pill is-on" : "pill"}
              aria-pressed={picked.includes(r)}
              onClick={() => toggle(r)}
            >
              {picked.includes(r) && <Icon name="check" size={12} />}
              {r}
            </button>
          ))}
        </div>

        <label className="passdialog-note">
          <span className="muted">Anything else</span>
          <textarea
            className="field"
            rows={2}
            value={note}
            placeholder={
              finderName
                ? "Photos looked staged, and the block is under scaffolding…"
                : "Why this one's out…"
            }
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="passdialog-foot">
          <button className="linkish" onClick={() => onConfirm("")}>
            Pass without a reason
          </button>
          <button className="btn btn-primary" onClick={() => onConfirm(reason)}>
            {finderName && reason ? `Pass and tell ${finderName}` : "Pass"}
          </button>
        </div>
      </div>
    </>
  );
}
