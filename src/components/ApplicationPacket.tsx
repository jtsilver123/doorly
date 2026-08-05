"use client";

import { useState } from "react";
import type { Profile } from "@/lib/outreach";
import { DEFAULT_COSTS, type CostAssumptions } from "@/lib/cost";
import { DOCUMENT_CHECKLIST, buildPacket, packetText, readiness } from "@/lib/packet";

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
  const costs: CostAssumptions = profile.costs ?? DEFAULT_COSTS;
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
    const parsed = Number(value);
    onSave({
      ...profile,
      costs: { ...costs, [key]: Number.isFinite(parsed) ? parsed : 0 },
    });
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
              {documents.includes(doc) ? "✓ " : ""}
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
                value={String(costs[key])}
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
      </div>
    </div>
  );
}
