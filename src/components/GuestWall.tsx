"use client";

import Icon from "@/components/Icon";

/**
 * The wall, where a wall is the honest answer.
 *
 * Most of this app is a shop window on purpose: a visitor sees the real
 * market, the real directory, the real method, and only meets an account
 * when they try to change something. That generosity has an edge, though,
 * and the edge is anything that is *the person's own file* rather than the
 * market's — the application packet, their documents, their settings.
 *
 * Rendering those as empty forms to someone with no account is worse than
 * refusing them: "0% ready · Still needed: Government photo ID" invites a
 * stranger to start uploading a passport into an account that doesn't
 * exist, and a Copy button that yields an empty template teaches that the
 * feature is broken rather than locked. So those surfaces show this
 * instead: what the thing is for, what it does on the day it matters, and
 * the one control that unlocks it.
 */

export default function GuestWall({
  title,
  body,
  points,
  cta = "Create your free account",
  onJoin,
}: {
  title: string;
  /** One line, in the voice of the moment the feature earns its keep. */
  body: string;
  /** What the account actually buys here. Three at most; they're read. */
  points: string[];
  cta?: string;
  onJoin: () => void;
}) {
  return (
    <div className="surface guestwall">
      <span className="guestwall-lock" aria-hidden="true">
        <Icon name="profile" size={18} />
      </span>
      <h2>{title}</h2>
      <p className="muted guestwall-body">{body}</p>
      <ul className="guestwall-points">
        {points.map((point) => (
          <li key={point}>
            <Icon name="check" size={14} />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary guestwall-cta" onClick={onJoin}>
        {cta}
      </button>
      <span className="muted guestwall-free">
        Free, forever. Everything you&rsquo;ve looked at stays where it is.
      </span>
    </div>
  );
}
