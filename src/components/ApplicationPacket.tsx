"use client";

import { useCallback, useEffect, useState } from "react";
import type { Profile } from "@/lib/outreach";
import { DEFAULT_COSTS, type CostAssumptions } from "@/lib/cost";
import { DOCUMENT_CHECKLIST, buildPacket, packetText, readiness } from "@/lib/packet";
import { useAutosave, saveLabel } from "@/lib/useAutosave";
import Icon from "@/components/Icon";
import { enqueueUploads, pendingUploads, subscribeUploads } from "@/lib/uploadQueue";

interface PacketDoc {
  id: string;
  path: string;
  name: string;
  kind: string;
  size: number | null;
  created_at: string;
  url: string;
}

const docSize = (bytes: number | null) =>
  bytes == null
    ? ""
    : bytes >= 1048576
      ? `${(bytes / 1048576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * The papers themselves, not just a checklist about them.
 *
 * Ticking "pay stubs ✓" was a promise; a PDF sitting here is the thing
 * itself. Uploads ride the same queue as tour footage (progress pill,
 * retries, stall watchdog) under the reserved "packet" scope, stored
 * private-per-user and readable only through the authenticated media route.
 */
function PacketDocs() {
  const [docs, setDocs] = useState<PacketDoc[]>([]);
  const [uploading, setUploading] = useState(0);

  const load = useCallback(async () => {
    try {
      const body = await fetch("/api/documents").then((r) => r.json());
      setDocs(body.documents ?? []);
    } catch {
      /* the next upload or visit retries */
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh when the queue drains — that's the moment new rows exist.
    return subscribeUploads(() => {
      const left = pendingUploads("packet");
      setUploading(left);
      if (left === 0) load();
    });
  }, [load]);

  const remove = async (doc: PacketDoc) => {
    setDocs((list) => list.filter((d) => d.id !== doc.id));
    try {
      await fetch(`/api/media/${doc.path}`, { method: "DELETE" });
    } finally {
      load();
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        The files themselves
      </span>
      <label className="packet-drop">
        <input
          type="file"
          multiple
          accept=".pdf,.doc,.docx,image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) {
              enqueueUploads("packet", e.target.files);
              setUploading(pendingUploads("packet"));
            }
            e.target.value = "";
          }}
        />
        <Icon name="image" size={15} />
        {uploading > 0
          ? `Uploading ${uploading} file${uploading === 1 ? "" : "s"}…`
          : "Add pay stubs, ID, bank statements. PDFs and photos"}
      </label>
      {docs.length > 0 && (
        <ul className="packet-docs">
          {docs.map((doc) => (
            <li key={doc.id}>
              <a href={doc.url} target="_blank" rel="noreferrer" title="Open in a new tab">
                {doc.name || doc.path.split("/").pop()}
              </a>
              <span className="muted">
                {docSize(doc.size)}
                {doc.size != null ? " · " : ""}
                {new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
              <button
                className="btn-icon packet-remove"
                aria-label={`Delete ${doc.name}`}
                title="Delete"
                onClick={() => remove(doc)}
              >
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The application packet, and the assumptions behind the cost figures.
 *
 * Finding a flat and getting it are different problems. This panel is the
 * second one: a one-page summary you can send the moment a viewing goes well,
 * plus a checklist of what you've actually gathered. The readiness percentage
 * is the honest version of "am I ready to apply?" — in a market where the
 * apartment goes to the first complete file, it's the number that decides
 * whether the search ends this month.
 */
export default function ApplicationPacket({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
}) {
  const [copied, setCopied] = useState(false);
  const documents = profile.documents ?? [];
  /**
   * The cost fields are typed into, so they go through a draft and a debounce
   * — writing "1.5" used to persist "1" and then "1." on the way there. The
   * document chips stay immediate: a click is already a finished thought.
   */
  const stored: CostAssumptions = profile.costs ?? DEFAULT_COSTS;
  const asText = (c: CostAssumptions) =>
    Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) as Record<
      keyof CostAssumptions,
      string
    >;
  const [costText, setCostText] = useState(() => asText(stored));
  const costs: CostAssumptions = {
    prepaidMonths: Number(costText.prepaidMonths) || 0,
    depositMonths: Number(costText.depositMonths) || 0,
    brokerFeeMonths: Number(costText.brokerFeeMonths) || 0,
    applicationFee: Number(costText.applicationFee) || 0,
  };
  const saveState = useAutosave(costs, (next) => onSave({ ...profile, costs: next }));

  const sections = buildPacket(profile, documents);
  const { percent, missing } = readiness(profile, documents);

  function toggleDoc(doc: string) {
    onSave({
      ...profile,
      documents: documents.includes(doc)
        ? documents.filter((d) => d !== doc)
        : [...documents, doc],
    });
  }

  function setCost(key: keyof CostAssumptions, value: string) {
    // Digits and one dot; the half-typed "1." lives in text, so the value can
    // pass through it on the way to "1.5" instead of snapping back to "1".
    if (/^\d*\.?\d*$/.test(value)) setCostText({ ...costText, [key]: value });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(packetText(profile, documents));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="surface" style={{ padding: 20, display: "grid", gap: 16 }}>
      <div>
        <div style={{ fontWeight: 600 }}>Application packet</div>
        <div className="muted" style={{ fontSize: 12 }}>
          The apartment goes to the first complete application. Have yours ready
          before the viewing, not after.
        </div>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span>Ready to apply</span>
          <strong className={percent >= 80 ? "" : "warn-text"}>{percent}%</strong>
        </div>
        <div className="meter">
          <span
            style={{
              width: `${percent}%`,
              background: percent >= 80 ? "var(--good)" : "var(--warn)",
            }}
          />
        </div>
        {missing.length > 0 && (
          <div className="muted" style={{ fontSize: 11 }}>
            Still needed: {missing.join(", ")}
          </div>
        )}
      </div>

      <PacketDocs />

      <div style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Documents you have
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DOCUMENT_CHECKLIST.map((doc) => (
            <button
              key={doc}
              className={documents.includes(doc) ? "btn btn-primary" : "btn"}
              style={{ fontSize: 12, padding: "4px 9px" }}
              onClick={() => toggleDoc(doc)}
            >
              {documents.includes(doc) && <Icon name="check" size={13} />}
              {doc}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Preview
          </span>
          <button className="btn" style={{ fontSize: 12, padding: "4px 9px" }} onClick={copy}>
            {copied ? "Copied" : "Copy packet"}
          </button>
        </div>
        <div className="preview" style={{ display: "grid", gap: 10 }}>
          {sections.map((section) => (
            <div key={section.heading}>
              <strong>{section.heading}</strong>
              {section.lines.map((line, i) => (
                <div key={i} className="muted">
                  {line}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Move-in cost assumptions
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(
            [
              ["prepaidMonths", "Months up front"],
              ["depositMonths", "Deposit (months)"],
              ["brokerFeeMonths", "Broker fee (months)"],
              ["applicationFee", "Application fee ($)"],
            ] as [keyof CostAssumptions, string][]
          ).map(([key, label]) => (
            <label key={key} style={{ display: "grid", gap: 4, fontSize: 12, flex: "1 1 110px" }}>
              <span className="muted">{label}</span>
              <input
                className="field"
                value={costText[key]}
                inputMode="decimal"
                onChange={(e) => setCost(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          New York caps deposits at one month and application fees at $20, and
          NYC&apos;s FARE Act moved broker fees to whoever hired the broker — so
          the broker-fee default is 0. Raise it if a listing still charges one;
          every card&apos;s move-in figure updates.
        </div>
        <div className="savestate" data-state={saveState} role="status">
          {saveLabel(saveState)}
        </div>
      </div>
    </div>
  );
}
