"use client";

import { useState } from "react";
import type { Profile } from "@/lib/outreach";
import { DEFAULT_COSTS, type CostAssumptions } from "@/lib/cost";
import { useAutosave, saveLabel } from "@/lib/useAutosave";

/**
 * When you're moving and what moving in costs.
 *
 * Lives with the search preferences rather than the application packet: the
 * date drives the timeline's pace and the cost levers shape the "to move in"
 * figure on every card in the feed — search-time levers, not applying-time
 * ones.
 */
export default function MoveInCosts({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
}) {
  const stored: CostAssumptions = profile.costs ?? DEFAULT_COSTS;
  const asText = (c: CostAssumptions) =>
    Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) as Record<
      keyof CostAssumptions,
      string
    >;
  const [costText, setCostText] = useState(() => asText(stored));
  const [moveInDate, setMoveInDate] = useState(profile.moveInDate ?? "");
  const costs: CostAssumptions = {
    prepaidMonths: Number(costText.prepaidMonths) || 0,
    depositMonths: Number(costText.depositMonths) || 0,
    brokerFeeMonths: Number(costText.brokerFeeMonths) || 0,
    applicationFee: Number(costText.applicationFee) || 0,
  };
  const saveState = useAutosave({ costs, moveInDate }, (next) =>
    onSave({ ...profile, costs: next.costs, moveInDate: next.moveInDate })
  );

  function setCost(key: keyof CostAssumptions, value: string) {
    // Digits and one dot; the half-typed "1." lives in text, so the value can
    // pass through it on the way to "1.5" instead of snapping back to "1".
    if (/^\d*\.?\d*$/.test(value)) setCostText({ ...costText, [key]: value });
  }

  return (
    <div className="surface" style={{ padding: 20, display: "grid", gap: 10 }}>
      <div>
        <div style={{ fontWeight: 600 }}>Move-in date and costs</div>
        <div className="muted" style={{ fontSize: 12 }}>
          The date sets the pace everywhere; the costs shape the &ldquo;to move
          in&rdquo; figure on every card.
        </div>
      </div>
      <label style={{ display: "grid", gap: 4, fontSize: 12, maxWidth: 200 }}>
        <span className="muted">Target move-in</span>
        <input
          className="field"
          type="date"
          value={moveInDate}
          onChange={(e) => setMoveInDate(e.target.value)}
        />
      </label>
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
        NYC&apos;s FARE Act moved broker fees to whoever hired the broker, so
        the broker-fee default is 0. Raise it if a listing still charges one;
        every card&apos;s move-in figure updates.
      </div>
      <div className="savestate" data-state={saveState} role="status">
        {saveLabel(saveState)}
      </div>
    </div>
  );
}
