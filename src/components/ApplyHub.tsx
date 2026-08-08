"use client";

import { useCallback, useEffect, useState } from "react";
import type { FeedListing } from "@/types";
import type { Profile } from "@/lib/outreach";
import { moveInCost } from "@/lib/cost";
import { packetReadiness, packetText } from "@/lib/packet";
import { tourWhen } from "@/lib/nextAction";
import { pendingUploads, subscribeUploads } from "@/lib/uploadQueue";
import ApplicationPacket, { type PacketDoc } from "@/components/ApplicationPacket";
import Icon from "@/components/Icon";

/**
 * The Apply tab: the application step promoted from a settings panel to a
 * place you work.
 *
 * The page reads top to bottom in the order the question gets asked: am I
 * ready (the hero), where am I applying (the rows), and the packet that
 * both of those depend on. One documents fetch up here feeds all three —
 * the hero's number and the packet's checklist can never disagree.
 */

const money = (n: number) => `$${n.toLocaleString()}`;

/** "Aug 6", for row stamps where the year is never in question. */
const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";

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

/** The when-line each group's rows carry: the date that group turns on. */
function rowStamp(l: FeedListing): string {
  if (l.stage === "applied") {
    const at = day(l.stageChangedAt);
    return at ? `applied ${at}` : "";
  }
  if (l.stage === "toured") {
    const at = day(l.stageChangedAt);
    return at ? `toured ${at}` : "";
  }
  if (l.stage === "tour") {
    return l.tourAt ? `viewing ${tourWhen(l.tourAt)}` : "no time set";
  }
  return "";
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
  /*
   * The papers, loaded once for the whole page. The packet renders them,
   * the hero counts them, and an upload finishing anywhere refreshes both.
   */
  const [docs, setDocs] = useState<PacketDoc[]>([]);
  const loadDocs = useCallback(async () => {
    try {
      const body = await fetch("/api/documents").then((r) => r.json());
      setDocs(body.documents ?? []);
    } catch {
      /* the next upload or visit retries */
    }
  }, []);
  useEffect(() => {
    loadDocs();
    return subscribeUploads(() => {
      if (pendingUploads() === 0) loadDocs();
    });
  }, [loadDocs]);

  const { percent, missing, satisfied } = packetReadiness(profile, docs);
  const [copied, setCopied] = useState(false);
  async function copyPacket() {
    try {
      await navigator.clipboard.writeText(
        packetText(profile, [...(profile.documents ?? []), ...satisfied])
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const inPlay = GROUPS.map((g) => ({
    ...g,
    rows: listings.filter((l) => l.stage === g.stage),
  }));
  const any = inPlay.some((g) => g.rows.length > 0);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Am I ready? The number the whole page exists to move. */}
      <div className="surface applyhero" data-ready={percent >= 80 ? "true" : undefined}>
        <div className="applyhero-num">
          <b>{percent}%</b>
          <span className="muted">packet ready</span>
        </div>
        <div className="applyhero-body">
          <div className="meter applyhero-meter">
            <span
              style={{
                width: `${percent}%`,
                background: percent >= 80 ? "var(--good)" : "var(--warn)",
              }}
            />
          </div>
          <span className="muted applyhero-note">
            {percent >= 100
              ? "Everything's in. Send it the moment a viewing goes well"
              : missing.length > 0
                ? `Still needed: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` +${missing.length - 3} more` : ""}`
                : "Add your documents below and this fills up"}
          </span>
        </div>
        <button className="btn applyhero-copy" onClick={copyPacket}>
          {copied ? "Copied" : "Copy packet"}
        </button>
      </div>

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
                <span className="applyhub-count">{g.rows.length}</span>
                <span className="muted"> · {g.hint}</span>
              </div>
              {g.rows.map((l) => {
                const cost = moveInCost(l, profile.costs);
                const status = rowStatus(l);
                const stamp = rowStamp(l);
                return (
                  <div key={l.id} className="applyrow" data-status={status ?? undefined}>
                    <button
                      className="applyrow-place"
                      onClick={() => onOpen(l)}
                      title="Open the full listing"
                    >
                      <span className="applyrow-addr">
                        {l.address}
                        {l.unit ? ` #${l.unit}` : ""}
                        <Icon name="chevron" size={11} className="applyrow-chev" />
                      </span>
                      <span className="muted applyrow-meta">
                        {l.neighborhood} · {money(l.price)}/mo · {money(cost.total)} to move in
                        {l.noFee ? " · no fee" : ""}
                        {stamp ? ` · ${stamp}` : ""}
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

      {/* The packet is what every application above is waiting on. */}
      <ApplicationPacket
        profile={profile}
        onSave={onSave}
        docs={docs}
        onDocsChanged={loadDocs}
      />
    </div>
  );
}
