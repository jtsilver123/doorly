"use client";

import { useRef, useState } from "react";
import type { FeedListing } from "@/types";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_VARS,
  draftFollowUp,
  draftTourMessage,
  type Profile,
} from "@/lib/outreach";
import { useAutosave, saveLabel } from "@/lib/useAutosave";

/**
 * Your messages, in your words — one place for all three.
 *
 * The app writes three kinds of message: the opening pitch, the follow-up,
 * and the version for an agent you've already been talking to about another
 * place. They were scattered as hard-coded prose; now each is a template
 * the user owns, with variables that fill in per listing at send time.
 *
 * Blank means the built-in draft, which stays smart (it already knows about
 * repeat brokers and missing phone numbers). "Start from the default" hands
 * the built-in over as editable text, so customizing is an edit rather than
 * a blank page. The preview renders against a sample listing on every
 * keystroke — a typo'd variable shows itself as literal braces right there.
 */

/** The stand-in place every preview renders against. */
const SAMPLE = {
  address: "55 Morton Street",
  unit: "5J",
  price: 3500,
  bedrooms: 1,
  neighborhood: "West Village",
  myContactName: "Jane at Corcoran",
  contactName: "",
} as FeedListing;

const SAMPLE_PRIOR = { address: "12 Charles Street", unit: "3B" };

/** The stand-in for-sale place: pitching the owner to rent it instead. */
const SAMPLE_SALE = {
  ...SAMPLE,
  address: "210 West 10th Street",
  unit: "4A",
  price: 3400,
  forSale: true,
  salePrice: 815_000,
} as FeedListing;

const SLOTS = [
  {
    key: "first" as const,
    label: "First message",
    hint: "The opening pitch when you reach out about a place",
    preview: (p: Profile) => draftTourMessage(SAMPLE, p),
  },
  {
    key: "followUp" as const,
    label: "Follow-up",
    hint: "The nudge when they've gone quiet",
    preview: (p: Profile) => draftFollowUp(SAMPLE, p),
  },
  {
    key: "repeat" as const,
    label: "Same agent, new place",
    hint: "Reaching out about a new listing to an agent you've contacted before",
    preview: (p: Profile) => draftTourMessage(SAMPLE, p, SAMPLE_PRIOR),
  },
  {
    key: "sale" as const,
    label: "For-sale pitch",
    hint: "Asking the owner of a for-sale place to rent it to you instead",
    preview: (p: Profile) => draftTourMessage(SAMPLE_SALE, p),
  },
];

export default function MessageSettings({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
}) {
  const [templates, setTemplates] = useState({
    first: profile.templates?.first ?? "",
    followUp: profile.templates?.followUp ?? "",
    repeat: profile.templates?.repeat ?? "",
    sale: profile.templates?.sale ?? "",
  });
  const areas = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const saveState = useAutosave(templates, (next) =>
    onSave({ ...profile, templates: next })
  );

  /** Drop a variable at the cursor, keeping focus where the writing is. */
  function insert(key: string, token: string) {
    const el = areas.current[key];
    const current = templates[key as keyof typeof templates] ?? "";
    if (!el) {
      setTemplates({ ...templates, [key]: current + token });
      return;
    }
    const at = el.selectionStart ?? current.length;
    const next = current.slice(0, at) + token + current.slice(el.selectionEnd ?? at);
    setTemplates({ ...templates, [key]: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at + token.length, at + token.length);
    });
  }

  /** The profile as previews should see it: the drafts read live edits. */
  const effective: Profile = { ...profile, templates };

  return (
    <div className="surface" style={{ padding: 20, display: "grid", gap: 18 }}>
      <div>
        <div style={{ fontWeight: 600 }}>Your messages</div>
        <div className="muted" style={{ fontSize: 12 }}>
          The app writes these for you; here you make them sound like you.
          Blank keeps the built-in draft. Variables in braces fill in per
          listing when you hit send.
        </div>
      </div>

      {SLOTS.map((slot) => {
        const value = templates[slot.key];
        return (
          <div key={slot.key} className="msgslot">
            <div className="msgslot-head">
              <div>
                <b>{slot.label}</b>
                <span className="muted"> · {slot.hint}</span>
              </div>
              {value.trim() ? (
                <button
                  className="linkish"
                  onClick={() => setTemplates({ ...templates, [slot.key]: "" })}
                >
                  Use the smart default
                </button>
              ) : (
                <button
                  className="linkish"
                  onClick={() =>
                    setTemplates({ ...templates, [slot.key]: DEFAULT_TEMPLATES[slot.key] })
                  }
                >
                  Start from the default
                </button>
              )}
            </div>

            <textarea
              ref={(el) => {
                areas.current[slot.key] = el;
              }}
              className="field"
              rows={value ? Math.min(8, Math.max(3, value.split("\n").length + 1)) : 3}
              value={value}
              placeholder="Blank: the app writes this one for you"
              onChange={(e) => setTemplates({ ...templates, [slot.key]: e.target.value })}
            />

            <div className="msgslot-vars">
              {TEMPLATE_VARS.filter(
                (v) =>
                  (slot.key === "repeat" || v.token !== "{previous address}") &&
                  (slot.key === "sale" || v.token !== "{asking price}")
              ).map((v) => (
                <button
                  key={v.token}
                  className="pill msgvar"
                  title={v.hint}
                  onClick={() => insert(slot.key, v.token)}
                >
                  {v.token}
                </button>
              ))}
            </div>

            <div className="msgslot-preview">
              <span className="muted">How it reads for a sample place</span>
              <pre className="preview">{slot.preview(effective)}</pre>
            </div>
          </div>
        );
      })}

      <div className="savestate" data-state={saveState} role="status">
        {saveLabel(saveState)}
      </div>
    </div>
  );
}
