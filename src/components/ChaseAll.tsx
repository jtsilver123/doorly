"use client";

import { useEffect, useMemo, useState } from "react";
import type { FeedListing } from "@/types";
import {
  draftFollowUp,
  draftTourMessage,
  mailtoLink,
  smsLink,
  tourSubject,
  reachableOn,
  type Profile,
} from "@/lib/outreach";
import { brokerHistory } from "@/lib/leverage";
import Icon from "@/components/Icon";

/**
 * The chase run: every contacted place, followed up in one sitting.
 *
 * Mass outreach is the whole game — a dozen texts out, a dozen check-ins two
 * days later — and doing it card by card meant opening a dozen panels. This
 * lines them up oldest-silence-first, each with its own follow-up already
 * written (and aware when it's the same broker you texted about another
 * place), and one tap per row sends and logs it.
 *
 * One tap per row rather than one button for everything, because SMS has no
 * bulk API from a browser and each message is to a different person about a
 * different apartment. The run makes the dozen taps mindless, which is the
 * most a web app can honestly do.
 */
export default function ChaseAll({
  listings,
  all,
  profile,
  mode,
  onLog,
  onClose,
}: {
  /** The column being worked, whatever order it arrived in. */
  listings: FeedListing[];
  /** Everything, for same-broker memory. */
  all: FeedListing[];
  profile: Profile;
  /** "first" sends the opening pitch (Interested); "chase" the follow-up. */
  mode: "first" | "chase";
  /** Records the outreach in the contact log; the caller owns refresh. */
  onLog: (listing: FeedListing, channel: "text" | "email") => Promise<void> | void;
  onClose: () => void;
}) {
  const [done, setDone] = useState<Record<string, boolean>>({});

  // Window-level, not on the overlay div: an unfocused div never hears keys,
  // which left Escape dead and the modal only closeable by mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Longest silence first: the one closest to going cold leads.
  const queue = useMemo(
    () =>
      [...listings].sort((a, b) => {
        const at = a.lastContactAt ?? a.stageChangedAt ?? "";
        const bt = b.lastContactAt ?? b.stageChangedAt ?? "";
        return at.localeCompare(bt);
      }),
    [listings]
  );

  const daysQuiet = (l: FeedListing) => {
    const since = l.lastContactAt ?? l.stageChangedAt;
    if (!since) return null;
    return Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  };

  const draft = (l: FeedListing) => {
    const prior = brokerHistory(all, l)?.others[0] ?? null;
    return mode === "chase"
      ? draftFollowUp(l, profile, prior)
      : draftTourMessage(l, profile, prior);
  };

  const fire = async (l: FeedListing, channel: "text" | "email") => {
    const message = draft(l);
    const { phone, email } = reachableOn(l);
    setDone((d) => ({ ...d, [l.id]: true }));
    await onLog(l, channel);
    if (channel === "text") {
      window.location.href = smsLink(phone, message);
    } else {
      window.location.href = mailtoLink(email, tourSubject(l), message);
    }
  };

  const copy = async (l: FeedListing) => {
    try {
      await navigator.clipboard.writeText(draft(l));
      setDone((d) => ({ ...d, [l.id]: true }));
    } catch {
      /* clipboard denied; the row stays unticked, which is the truth */
    }
  };

  const remaining = queue.filter((l) => !done[l.id]).length;

  return (
    <div
      className="compare-modal"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compare-modal-panel" role="dialog" aria-modal="true" aria-label="Follow up with everyone">
        <div className="compare-modal-head">
          <div>
            <b>{mode === "chase" ? "Chase everyone" : "Reach out to everyone"}</b>
            <div className="muted" style={{ fontSize: 12 }}>
              {remaining === 0
                ? mode === "chase"
                  ? "All chased. Replies incoming."
                  : "All contacted. They're on the board's next column."
                : `${remaining} to go${mode === "chase" ? ", longest silence first" : ""}. Each message is already written.`}
            </div>
          </div>
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>

        <ul className="chase-list">
          {queue.map((l) => {
            const { phone, email, who } = reachableOn(l);
            const quiet = daysQuiet(l);
            return (
              <li key={l.id} data-done={done[l.id] ? "true" : undefined}>
                <div className="chase-who">
                  <b>
                    {l.address}
                    {l.unit ? ` #${l.unit}` : ""}
                  </b>
                  <span className="muted">
                    {who || "no name"}
                    {quiet != null &&
                      ` · quiet ${quiet === 0 ? "since today" : `${quiet}d`}`}
                  </span>
                </div>
                <div className="chase-actions">
                  {done[l.id] ? (
                    <span className="chase-done">
                      <Icon name="check" size={14} /> sent
                    </span>
                  ) : (
                    <>
                      {phone && (
                        <button className="btn btn-primary" onClick={() => fire(l, "text")}>
                          Text
                        </button>
                      )}
                      {email && (
                        <button className="btn" onClick={() => fire(l, "email")}>
                          Email
                        </button>
                      )}
                      <button
                        className="btn"
                        title="Copy the follow-up for the listing site's own form"
                        onClick={() => copy(l)}
                      >
                        Copy
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
