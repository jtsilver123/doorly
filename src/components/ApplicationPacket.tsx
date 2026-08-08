"use client";

import { useState } from "react";
import { PROOF_OPTIONS, type Profile } from "@/lib/outreach";
import { buildPacket, packetSlots, packetReadiness } from "@/lib/packet";
import Icon from "@/components/Icon";
import { enqueueUploads } from "@/lib/uploadQueue";

export interface PacketDoc {
  id: string;
  path: string;
  name: string;
  kind: string;
  size: number | null;
  slot: string;
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
 * The two catch-alls that hold what no checklist slot names: reference
 * letters, credit reports, the odd W-2 — one shelf for your papers, one for
 * the guarantor's. Neither counts toward readiness; they exist so a real
 * folder of documents has somewhere honest to live.
 */
const MISC_SLOTS = [
  { key: "misc", label: "Extras, yours", hint: "reference letters, credit report, W-2s" },
  { key: "g_misc", label: "Extras, guarantor's", hint: "their extra papers" },
] as const;

/**
 * Where a file can be filed, grouped by whose paper it is. The flat list
 * read as a jumble once the guarantor's stack joined it; "whose is this"
 * is the first question anyway, so the dropdown asks it first. Inside the
 * guarantor group the "Guarantor " prefix drops — the group already says it.
 */
function slotOptions(profile: Profile): {
  mine: { key: string; label: string }[];
  theirs: { key: string; label: string }[];
} {
  const slots = packetSlots(profile);
  const mine = [
    ...slots.filter((s) => !s.guarantor).map((s) => ({ key: s.key, label: s.label })),
    { key: "misc", label: "Extras" },
  ];
  const theirs = profile.hasGuarantor
    ? [
        ...slots
          .filter((s) => s.guarantor)
          .map((s) => ({ key: s.key, label: s.label.replace(/^Guarantor\s+/, "") })),
        { key: "g_misc", label: "Extras" },
      ]
    : [];
  return { mine, theirs };
}

/** The little "file under…" control every document row carries. */
function MoveSelect({
  value,
  options,
  onMove,
}: {
  value: string;
  options: ReturnType<typeof slotOptions>;
  onMove: (slot: string) => void;
}) {
  const known = [...options.mine, ...options.theirs].some((o) => o.key === value);
  return (
    <select
      className="field packet-move"
      value={value}
      aria-label="File this document under"
      onChange={(e) => onMove(e.target.value)}
    >
      {!value && <option value="">Sort into…</option>}
      {/* A doc can sit in a slot the current setup no longer offers, e.g.
          a guarantor paper after the guarantor toggle went off. Keep its
          home listed so the select never shows blank. */}
      {value && !known && <option value={value}>{value}</option>}
      <optgroup label="Yours">
        {options.mine.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </optgroup>
      {options.theirs.length > 0 && (
        <optgroup label="Guarantor's">
          {options.theirs.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/**
 * One checklist requirement, holding its actual files.
 *
 * "Photo ID ✓" used to be a promise; here the requirement is only met when
 * a real file sits in the slot — uploaded through the same queue as tour
 * footage, tagged with the slot it satisfies, private per user.
 */
function SlotRow({
  slot,
  docs,
  onRemove,
  options,
  onMove,
  onGate,
}: {
  slot: { key: string; label: string; hint?: string; wants: number };
  docs: PacketDoc[];
  onRemove: (doc: PacketDoc) => void;
  options: ReturnType<typeof slotOptions>;
  onMove: (doc: PacketDoc, slot: string) => void;
  onGate?: () => boolean;
}) {
  const mine = docs.filter((d) => d.slot === slot.key);
  const met = mine.length >= slot.wants;
  return (
    <li className="packet-slot" data-met={met ? "true" : undefined}>
      <span className="packet-slot-mark" aria-hidden="true">
        {met ? <Icon name="check" size={13} /> : mine.length > 0 ? `${mine.length}/${slot.wants}` : ""}
      </span>
      <div className="packet-slot-body">
        <div className="packet-slot-name">
          <b>{slot.label}</b>
          {slot.hint && <span className="muted"> · {slot.hint}</span>}
        </div>
        {mine.length > 0 && (
          <div className="packet-slot-files">
            {mine.map((doc) => (
              <span key={doc.id} className="packet-file">
                <a href={doc.url} target="_blank" rel="noreferrer">
                  {doc.name || doc.path.split("/").pop()}
                </a>
                <MoveSelect value={doc.slot} options={options} onMove={(s) => onMove(doc, s)} />
                <button
                  className="packet-remove"
                  aria-label={`Delete ${doc.name}`}
                  title="Delete"
                  onClick={() => onRemove(doc)}
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <label
        className="btn packet-addbtn"
        onClick={(e) => {
          if (onGate?.()) e.preventDefault();
        }}
      >
        <input
          type="file"
          multiple
          accept=".pdf,.doc,.docx,image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) enqueueUploads(`packet:${slot.key}`, e.target.files);
            e.target.value = "";
          }}
        />
        {met ? "Add more" : "Add file"}
      </label>
    </li>
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
  docs,
  onDocsChanged,
  onGate,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
  /** The papers, owned by the page so the hero and this list agree. */
  docs: PacketDoc[];
  onDocsChanged: () => void;
  /** True when the viewer can't upload yet (guest) — and says so itself. */
  onGate?: () => boolean;
}) {
  const documents = profile.documents ?? [];
  const removeDoc = async (doc: PacketDoc) => {
    try {
      await fetch(`/api/media/${doc.path}`, { method: "DELETE" });
    } finally {
      onDocsChanged();
    }
  };
  /** Re-file after the fact; the server's word comes back via the reload. */
  const moveDoc = async (doc: PacketDoc, slot: string) => {
    try {
      await fetch("/api/documents", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: doc.id, slot }),
      });
    } finally {
      onDocsChanged();
    }
  };
  const [dragOver, setDragOver] = useState(false);
  const options = slotOptions(profile);

  const slots = packetSlots(profile);
  const { satisfied } = packetReadiness(profile, docs);
  const sections = buildPacket(profile, [...documents, ...satisfied]);

  return (
    <div className="surface" style={{ padding: 20, display: "grid", gap: 16 }}>
      <div>
        <div style={{ fontWeight: 600 }}>Application packet</div>
        <div className="muted" style={{ fontSize: 12 }}>
          The apartment goes to the first complete application. Have yours ready
          before the viewing, not after.
        </div>
        {/* True at the database: documents carry an owner-only policy, so
            crew mates who share the pipeline still can't open these. */}
        <div className="muted packet-privacy">
          <Icon name="check" size={12} /> Private to you. Nobody else can open
          these, including people searching with you.
        </div>
      </div>

      {/* The situation decides the checklist, so it's set right here: how
          you earn picks the B column, and a guarantor brings their own
          parallel stack — the same shape as the sheets management companies
          circulate. */}
      <div className="packet-situation">
        <span className="packet-situation-why muted">
          Your situation sets the checklist below
        </span>
        <label>
          <span className="muted">How you earn</span>
          <select
            className="field"
            value={profile.employment}
            onChange={(e) => onSave({ ...profile, employment: e.target.value as Profile["employment"] })}
          >
            <option value="employed">Employed</option>
            <option value="self_employed">Self-employed</option>
            <option value="student">Student</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="packet-toggle">
          <input
            type="checkbox"
            checked={Boolean(profile.hasGuarantor)}
            onChange={(e) => onSave({ ...profile, hasGuarantor: e.target.checked })}
          />
          I have a guarantor
        </label>
        {profile.hasGuarantor && (
          <label>
            <span className="muted">How they earn</span>
            <select
              className="field"
              value={profile.guarantorEmployment ?? "employed"}
              onChange={(e) =>
                onSave({ ...profile, guarantorEmployment: e.target.value as Profile["employment"] })
              }
            >
              <option value="employed">Employed</option>
              <option value="self_employed">Self-employed</option>
              <option value="other">Other</option>
            </select>
          </label>
        )}
        <label className="packet-toggle">
          <input
            type="checkbox"
            checked={Boolean(profile.foreignNational)}
            onChange={(e) => onSave({ ...profile, foreignNational: e.target.checked })}
          />
          Foreign national
        </label>
      </div>

      {/* What your outreach messages offer to show. Lives here with the
          files it refers to, not on the details tab. */}
      <div style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Offered in your messages as ready to share
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PROOF_OPTIONS.map((proof) => (
            <button
              key={proof}
              className={profile.proofs.includes(proof) ? "btn btn-primary" : "btn"}
              style={{ fontSize: 12, padding: "4px 9px" }}
              onClick={() =>
                onSave({
                  ...profile,
                  proofs: profile.proofs.includes(proof)
                    ? profile.proofs.filter((p) => p !== proof)
                    : [...profile.proofs, proof],
                })
              }
            >
              {proof}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {/* The fast path: everything from the downloads folder in one drop,
            sorted into slots afterward with the little selects. Deciding a
            category per file at upload time is what makes people not upload. */}
        <label
          className={dragOver ? "packet-drop packet-massdrop is-over" : "packet-drop packet-massdrop"}
          // A guest's click offers the account instead of the file picker.
          onClick={(e) => {
            if (onGate?.()) e.preventDefault();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (onGate?.()) return;
            if (e.dataTransfer.files?.length) enqueueUploads("packet", e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            multiple
            accept=".pdf,.doc,.docx,image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files?.length) enqueueUploads("packet", e.target.files);
              e.target.value = "";
            }}
          />
          <Icon name="plus" size={15} />
          Drop all your files here at once. Sort them into their spots after
        </label>

        {docs.filter((d) => !d.slot).length > 0 && (
          <>
            <span className="muted" style={{ fontSize: 12 }}>
              Not sorted yet. Tell each one where it belongs
            </span>
            <ul className="packet-docs">
              {docs
                .filter((d) => !d.slot)
                .map((doc) => (
                  <li key={doc.id}>
                    <a href={doc.url} target="_blank" rel="noreferrer">
                      {doc.name || doc.path.split("/").pop()}
                    </a>
                    <span className="muted">
                      {docSize(doc.size)}
                      {doc.size != null ? " · " : ""}
                      {new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <MoveSelect value="" options={options} onMove={(s) => moveDoc(doc, s)} />
                    <button
                      className="btn-icon packet-remove"
                      aria-label={`Delete ${doc.name}`}
                      title="Delete"
                      onClick={() => removeDoc(doc)}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}

        <span className="muted" style={{ fontSize: 12 }}>
          Your documents. A requirement is met by a file, not a checkbox
        </span>
        <ul className="packet-slots">
          {slots
            .filter((slot) => !slot.guarantor)
            .map((slot) => (
              <SlotRow
                key={slot.key}
                slot={slot}
                docs={docs}
                onRemove={removeDoc}
                options={options}
                onMove={moveDoc}
                onGate={onGate}
              />
            ))}
        </ul>
        {profile.hasGuarantor && (
          <>
            <span className="muted" style={{ fontSize: 12 }}>
              Guarantor documents
            </span>
            <ul className="packet-slots">
              {slots
                .filter((slot) => slot.guarantor)
                .map((slot) => (
                  <SlotRow
                    key={slot.key}
                    slot={slot}
                    docs={docs}
                    onRemove={removeDoc}
                    options={options}
                    onMove={moveDoc}
                    onGate={onGate}
                  />
                ))}
            </ul>
          </>
        )}

        {/* The two shelves for what no slot names. Neither moves the meter;
            they exist so every real paper has an honest home. The guarantor
            shelf shows once there IS a guarantor, or once it holds a file. */}
        {MISC_SLOTS.filter(
          (m) =>
            m.key === "misc" ||
            profile.hasGuarantor ||
            docs.some((d) => d.slot === m.key)
        ).map((m) => {
          const mine = docs.filter((d) => d.slot === m.key);
          return (
            <div key={m.key} style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                {m.label} · {m.hint}
              </span>
              {mine.length > 0 ? (
                <ul className="packet-docs">
                  {mine.map((doc) => (
                    <li key={doc.id}>
                      <a href={doc.url} target="_blank" rel="noreferrer">
                        {doc.name || doc.path.split("/").pop()}
                      </a>
                      <span className="muted">{docSize(doc.size)}</span>
                      <MoveSelect value={doc.slot} options={options} onMove={(s) => moveDoc(doc, s)} />
                      <button
                        className="btn-icon packet-remove"
                        aria-label={`Delete ${doc.name}`}
                        title="Delete"
                        onClick={() => removeDoc(doc)}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="muted" style={{ fontSize: 11 }}>
                  Nothing here yet. Drop files above and sort them in
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* The one-page summary the copy button sends, folded away: worth a
          glance, not permanent screen. Copying lives in the hero above. */}
      <details className="packet-preview">
        <summary>
          <Icon name="chevron" size={12} />
          What the copied packet says
        </summary>
        <div className="preview" style={{ display: "grid", gap: 10, marginTop: 8 }}>
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
      </details>
    </div>
  );
}
