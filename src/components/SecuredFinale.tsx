"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FeedListing } from "@/types";
import { huntStory } from "@/lib/finale";
import { siteUrl } from "@/lib/site";
import Icon from "@/components/Icon";

/**
 * The last screen of the hunt.
 *
 * Marking a place secured used to fire confetti and leave you on a kanban
 * board, which is a strange place to be standing at the end of six weeks of
 * work. This is the ending: the apartment, the date, and every number the app
 * has been quietly keeping since the first place went on the board.
 *
 * The numbers arrive on their own rather than behind a button, because the
 * question this screen answers is one nobody thinks to ask on the day and
 * everybody asks a week later. Nothing here is decorative arithmetic: each
 * figure comes from rows the person created, and anything unknowable is
 * simply absent (see huntStory).
 *
 * It shows once per apartment. A victory lap that reruns every time you open
 * the board stops being a victory lap.
 */

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function SecuredFinale({
  listing,
  listings,
  settled,
  meId,
  onClose,
  onSettle,
  onInsights,
}: {
  listing: FeedListing;
  listings: FeedListing[];
  /** Already put away, so the offer to do it would be a dead button. */
  settled?: boolean;
  /** Whose footage rides along on the shared link. */
  meId?: string | null;
  onClose: () => void;
  /**
   * Close the hunt: the board becomes a record and stops behaving like a
   * job. Offered here rather than done automatically, because a signed
   * lease and a set of keys are not the same week.
   */
  onSettle?: () => void;
  /** The full funnel read, for whoever wants the rest of the numbers. */
  onInsights: () => void;
}) {
  const story = useMemo(() => huntStory(listings, listing), [listings, listing]);
  const { steps } = story;

  /*
   * The reveal. Sections fade up in sequence rather than all at once, which
   * is the difference between a screen appearing and a screen being handed
   * to you. Held in state rather than pure CSS delays so reduced-motion can
   * skip straight to the end without every child needing its own media query.
   */
  const [shown, setShown] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(4);
      return;
    }
    const timers = [260, 620, 1020, 1400].map((ms, i) =>
      window.setTimeout(() => setShown(i + 1), ms)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /*
   * Listing photos rot: sources expire their CDN links, and a dead one
   * renders as a large grey rectangle, which on this screen would be the
   * biggest thing on it. A failed load drops the frame entirely rather than
   * leaving the hole.
   */
  const [shotBroken, setShotBroken] = useState(false);
  const source = listing.images[0] ?? listing.imageUrl ?? null;
  const shot = shotBroken ? null : source;
  const moveIn = listing.availableAt ? new Date(listing.availableAt) : null;

  /** The funnel, as the shape the hunt actually took. */
  const funnel = [
    { label: "Saved", n: steps.saved },
    { label: "Contacted", n: steps.contacted },
    { label: "Replied", n: steps.replied },
    { label: "Toured", n: steps.toured },
    { label: "Applied", n: steps.applied },
    { label: "Signed", n: Math.max(steps.won, 1) },
  ].filter((row, i) => i === 0 || row.n > 0);
  const peak = Math.max(steps.saved, 1);

  /** The stat strip. Only figures the data actually supports. */
  const stats: { value: string; label: string }[] = [];
  if (story.days != null) {
    stats.push({ value: String(story.days), label: story.days === 1 ? "day" : "days hunting" });
  }
  stats.push({ value: String(steps.saved), label: steps.saved === 1 ? "place tracked" : "places tracked" });
  if (story.messages > 0) {
    stats.push({
      value: String(story.messages),
      label: story.messages === 1 ? "message sent" : "messages sent",
    });
  }
  if (steps.toured > 0) {
    stats.push({ value: String(steps.toured), label: steps.toured === 1 ? "place seen" : "places seen" });
  }

  /**
   * Telling people.
   *
   * This is the one screen in the app anybody actually wants to forward, and
   * without a button the only way to do it is a screenshot. It shares the
   * app's own view of the apartment rather than the listing site's: that link
   * works signed out and carries your own tour footage, so whoever opens it
   * sees the place the way you saw it.
   *
   * The message is built from the same story as the screen, so the two can't
   * disagree, and it leaves out anything the data doesn't support. The native
   * sheet where there is one, since forwarding happens on a phone; the
   * clipboard everywhere else.
   */
  const [shared, setShared] = useState(false);
  async function share() {
    const url = siteUrl(
      `/app?place=${encodeURIComponent(listing.id)}${
        meId ? `&via=${encodeURIComponent(meId)}` : ""
      }`
    );
    const where = listing.neighborhood ? ` in ${listing.neighborhood}` : "";
    const effort = [
      story.days != null ? `${story.days} ${story.days === 1 ? "day" : "days"}` : null,
      steps.saved > 1 ? `${steps.saved} places` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    const text = `${listing.address}. ${money(listing.price)}/mo${where}.${
      effort ? ` Took ${effort} to get here.` : ""
    }`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "I got the place", text, url });
        return;
      } catch {
        // Cancelled, or the sheet refused. The clipboard still works.
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      setShared(false);
    }
  }

  return (
    <div className="finale" role="presentation">
      <div
        className="finale-panel"
        role="dialog"
        aria-modal="true"
        aria-label="You got the place"
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="finale-scroll">
          <header className="finale-head" data-in={shown >= 1 ? "yes" : undefined}>
            <span className="overline finale-over">The hunt is over</span>
            <h1 className="display finale-title">You got the place.</h1>
          </header>

          {/* The apartment itself, big. Every other screen in this app shows
              it at card size beside four competitors. A listing with no
              photo gets no frame: an empty grey rectangle is the largest
              thing on the screen and it says nothing. */}
          <div
            className="finale-place"
            data-shot={shot ? "yes" : undefined}
            data-in={shown >= 1 ? "yes" : undefined}
          >
            {shot && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="finale-shot"
                src={shot}
                alt=""
                onError={() => setShotBroken(true)}
              />
            )}
            <div className="finale-place-body">
              <b className="finale-address">{listing.address}</b>
              <span className="muted finale-where">
                {[
                  listing.neighborhood,
                  listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bed`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="finale-rent">
                {money(listing.price)}
                <small>/mo</small>
              </span>
              {moveIn && (
                <span className="muted finale-when">
                  Yours from{" "}
                  {moveIn.toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </span>
              )}
            </div>
          </div>

          {stats.length > 0 && (
            <div className="finale-stats" data-in={shown >= 2 ? "yes" : undefined}>
              {stats.map((stat) => (
                <div className="finale-stat" key={stat.label}>
                  <b>{stat.value}</b>
                  <span>{stat.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* The analytics, opened for you. This is the one day the funnel
              reads as a story instead of a to-do list. */}
          <section className="finale-funnel" data-in={shown >= 3 ? "yes" : undefined}>
            <h2 className="overline">What it took</h2>
            <div className="finale-bars">
              {funnel.map((row) => (
                <div className="finale-bar" key={row.label}>
                  <span className="finale-bar-label">{row.label}</span>
                  <span className="finale-bar-track">
                    <i style={{ width: `${Math.max((row.n / peak) * 100, 4)}%` }} />
                  </span>
                  <b className="finale-bar-n">{row.n}</b>
                </div>
              ))}
            </div>
            <p className="finale-line">{summarize(story)}</p>
          </section>

          <div className="finale-actions" data-in={shown >= 4 ? "yes" : undefined}>
            <button className="btn btn-primary finale-done" onClick={onClose}>
              Done
            </button>
            <button
              className={shared ? "btn finale-share is-done" : "btn finale-share"}
              onClick={share}
              aria-label={`Share that you got ${listing.address}`}
            >
              <Icon name={shared ? "check" : "share"} size={15} />
              <span>{shared ? "Link copied" : "Share the news"}</span>
            </button>
            {/* The board has already stopped chasing; this closes it. Offered
                rather than assumed, because the week between a handshake and
                a set of keys is when people keep a backup warm. */}
            {onSettle && !settled && (
              <button className="linkish" onClick={onSettle}>
                Put this hunt to bed
              </button>
            )}
            <button className="linkish" onClick={onInsights}>
              See the full read
            </button>
          </div>
          {onSettle && !settled && (
            <p className="finale-note" data-in={shown >= 4 ? "yes" : undefined}>
              Nothing is being watched any more. Closing the hunt keeps
              everything as a record and you can reopen it if the deal moves.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One sentence about how this hunt went, in its own numbers.
 *
 * Ordered by what's actually interesting: beating the market on price, then
 * beating the places you saw, then the sheer volume of noes it took. Falls
 * back to the plain fact, which on the day is enough.
 */
function summarize(story: ReturnType<typeof huntStory>): string {
  const { won, vsMarket, vsToured, passed, steps } = story;
  if (vsMarket != null && vsMarket <= -4) {
    return `You signed at ${Math.abs(Math.round(vsMarket))}% under what comparable places were asking. That is the whole point of doing this with a system.`;
  }
  if (vsToured != null && vsToured < -50) {
    return `At ${money(won.price)} it was ${money(Math.abs(vsToured))} a month cheaper than the average place you walked through. The tours paid for themselves.`;
  }
  if (passed >= 5) {
    return `${passed} places went in the no pile to get here. That is the part of the hunt nobody sees, and it is the part that worked.`;
  }
  if (steps.contacted >= 5) {
    return `${steps.contacted} landlords and agents heard from you. One of them said yes, which is the only number that was ever going to matter.`;
  }
  return "Signed, and off the market. Everything above is yours to keep.";
}
