"use client";

import type { FeedListing } from "@/types";
import type { Profile } from "@/lib/outreach";
import { moveInCost } from "@/lib/cost";
import ApplicationPacket from "@/components/ApplicationPacket";
import Icon from "@/components/Icon";

/**
 * The Apply tab: the application step promoted from a settings panel to a
 * place you work.
 *
 * Applying is where the hunt is won or lost, and it used to be split across
 * two hiding spots: the packet lived in account settings (framed as
 * configuration, not work), and each place's application link lived at the
 * bottom of its drawer. This page puts the active question first — which
 * places are at the applying stage and what does each still need — with the
 * packet right below, since the packet is what every one of those
 * applications is waiting on.
 */

const money = (n: number) => `$${n.toLocaleString()}`;

/** Work order: verdicts pending first, then ready-to-apply, then booked. */
const GROUPS: { stage: FeedListing["stage"]; title: string; hint: string }[] = [
  {
    stage: "applied",
    title: "Application in",
    hint: "Waiting on a verdict. Chase after 3 quiet days",
  },
  {
    stage: "toured",
    title: "Seen it, can apply",
    hint: "You've toured these. First complete file wins",
  },
  {
    stage: "tour",
    title: "Viewing booked",
    hint: "Bring the packet. Applying at the tour beats applying after",
  },
];

function rowStatus(l: FeedListing): string | null {
  if (l.stage === "applied") {
    if (l.secured && l.appResult === 1) return "secured";
    if (l.appResult === 1) return "accepted";
    if (l.appResult === -1) return "denied";
    return "waiting";
  }
  if (l.stage === "toured" && l.lean === 1) return "leaning yes";
  if (l.stage === "toured" && l.lean === -1) return "leaning no";
  return null;
}

export default function ApplyHub({
  listings,
  profile,
  onSave,
  onOpen,
  onOpenApply,
}: {
  listings: FeedListing[];
  profile: Profile;
  onSave: (p: Profile) => void;
  onOpen: (l: FeedListing) => void;
  /** Open the drawer scrolled to its Apply section (link field lives there). */
  onOpenApply: (l: FeedListing) => void;
}) {
  const inPlay = GROUPS.map((g) => ({
    ...g,
    rows: listings.filter((l) => l.stage === g.stage),
  }));
  const any = inPlay.some((g) => g.rows.length > 0);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="surface" style={{ padding: 20, display: "grid", gap: 14 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Applications</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Every place at the applying stage, what it costs to take, and where
            its application lives.
          </div>
        </div>

        {!any && (
          <div className="muted" style={{ fontSize: 13 }}>
            Nothing here yet. Places you tour or apply to show up on this page
            with their application links and move-in math.
          </div>
        )}

        {inPlay
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <div key={g.stage} style={{ display: "grid", gap: 8 }}>
              <div className="applyhub-group">
                <b>{g.title}</b>
                <span className="muted"> · {g.hint}</span>
              </div>
              {g.rows.map((l) => {
                const cost = moveInCost(l, profile.costs);
                const status = rowStatus(l);
                return (
                  <div key={l.id} className="applyrow" data-status={status ?? undefined}>
                    <button className="applyrow-place" onClick={() => onOpen(l)}>
                      <span className="applyrow-addr">
                        {l.address}
                        {l.unit ? ` #${l.unit}` : ""}
                      </span>
                      <span className="muted applyrow-meta">
                        {l.neighborhood} · {money(l.price)}/mo · {money(cost.total)} to move in
                        {l.noFee ? " · no fee" : ""}
                      </span>
                    </button>
                    {status && <span className="applyrow-status">{status}</span>}
                    {l.applicationUrl ? (
                      <a
                        className="btn"
                        href={l.applicationUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open application <Icon name="external" size={11} />
                      </a>
                    ) : (
                      <button className="btn" onClick={() => onOpenApply(l)}>
                        Add the link
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
      </div>

      {/* The packet is what every application above is waiting on, so it
          lives on the same page — moved here from account settings. */}
      <ApplicationPacket profile={profile} onSave={onSave} />
    </div>
  );
}
