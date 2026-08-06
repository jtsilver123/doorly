"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedListing } from "@/types";
import Icon from "@/components/Icon";
import { PASS_REASONS } from "@/lib/rank";

/**
 * Taking a place out of the running, and saying why.
 *
 * The reason has two readers, and they want different things. A crew-mate who
 * found this needs to know what was wrong so the next five are closer. The
 * ranking model needs to know *which part* was wrong, because a pass with no
 * reason has to count against every feature of the listing at once: turn down
 * a $4,200 West Village studio on price, and without a reason the model
 * quietly learns you dislike the West Village.
 *
 * So the chips are reason codes rather than free text, and the note underneath
 * stays free text. Everything is optional. A required explanation just means
 * nobody clears their pipeline, and a board you can't clear is worse than a
 * scout who repeats themselves.
 */

export default function PassDialog({
  listing,
  finderName,
  onConfirm,
  onClose,
}: {
  listing: FeedListing;
  /** Who found it, when that isn't you. Null means no one to tell. */
  finderName: string | null;
  /** The human-readable note, and the codes that scope what the model learns. */
  onConfirm: (reason: string, reasons: string[]) => void;
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

  const labelOf = (code: string) =>
    PASS_REASONS.find((r) => r.code === code)?.label ?? code;
  // The note a person reads, assembled from the same picks that scope the
  // model. One choice, two outputs, so the two can never describe different
  // decisions.
  const note_ = [picked.map(labelOf).join(", "), note.trim()].filter(Boolean).join(". ");

  // What this pass will and won't teach, said before it's made. The honest
  // cases are the ones that teach nothing: a place that's already rented is
  // not a preference, and a bad layout is a fact this model has no feature for.
  const teaching = picked.filter((c) => PASS_REASONS.find((r) => r.code === c)?.families.length);
  const learns =
    picked.length === 0
      ? "Without a reason this counts against everything about the place."
      : teaching.length === 0
        ? "Noted for your crew. Nothing here changes your scores, which is right: this isn't about taste."
        : "Your scores will stop favoring places like this one, and leave the rest alone.";

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
          {PASS_REASONS.map((r) => (
            <button
              key={r.code}
              className={picked.includes(r.code) ? "pill is-on" : "pill"}
              aria-pressed={picked.includes(r.code)}
              onClick={() => toggle(r.code)}
            >
              {picked.includes(r.code) && <Icon name="check" size={12} />}
              {r.label}
            </button>
          ))}
        </div>

        <p className="passdialog-learns" aria-live="polite">
          {learns}
        </p>

        <label className="passdialog-note">
          <span className="muted">Anything else</span>
          <textarea
            className="field"
            rows={2}
            value={note}
            placeholder={
              finderName
                ? "Photos looked staged, and the block is under scaffolding"
                : "Anything the chips don't cover"
            }
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="passdialog-foot">
          <button className="linkish" onClick={() => onConfirm("", [])}>
            Pass without a reason
          </button>
          <button className="btn btn-primary" onClick={() => onConfirm(note_, picked)}>
            {finderName && note_ ? `Pass and tell ${finderName}` : "Pass"}
          </button>
        </div>
      </div>
    </>
  );
}
