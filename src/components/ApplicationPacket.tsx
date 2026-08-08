"use client";

import { useCallback, useEffect, useState } from "react";
import { PROOF_OPTIONS, type Profile } from "@/lib/outreach";
import { buildPacket, packetText, packetSlots, packetReadiness } from "@/lib/packet";
import Icon from "@/components/Icon";
import { enqueueUploads, pendingUploads, subscribeUploads } from "@/lib/uploadQueue";

interface PacketDoc {
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

/** Where a file can be filed: every checklist slot plus the two shelves. */
function slotOptions(profile: Profile): { key: string; label: string }[] {
  return [
    ...packetSlots(profile).map((s) => ({
      key: s.key,
      label: s.guarantor ? s.label : s.label,
    })),
    ...MISC_SLOTS.map((s) => ({ key: s.key, label: s.label })),
  ];
}

/** The little "file under…" control every document row carries. */
function MoveSelect({
  value,
  options,
  onMove,
}: {
  value: string;
  options: { key: string; label: string }[];
  onMove: (slot: string) => void;
}) {
  return (
    <select
      className="field packet-move"
      value={value}
      aria-label="File this document under"
      onChange={(e) => onMove(e.target.value)}
    >
      {!value && <option value="">Sort into…</option>}
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
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
}: {
  slot: { key: string; label: string; hint?: string; wants: number };
  docs: PacketDoc[];
  onRemove: (doc: PacketDoc) => void;
  options: { key: string; label: string }[];
  onMove: (doc: PacketDoc, slot: string) => void;
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
      <label className="btn packet-addbtn">
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

  /*
   * The files are the checklist now. Loaded here so readiness, the slot
   * rows, and the packet summary all read one truth.
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
  const removeDoc = async (doc: PacketDoc) => {
    setDocs((list) => list.filter((d) => d.id !== doc.id));
    try {
      await fetch(`/api/media/${doc.path}`, { method: "DELETE" });
    } finally {
      loadDocs();
    }
  };
  /** Re-file after the fact: optimistic, then the server's word is final. */
  const moveDoc = async (doc: PacketDoc, slot: string) => {
    setDocs((list) => list.map((d) => (d.id === doc.id ? { ...d, slot } : d)));
    try {
      await fetch("/api/documents", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: doc.id, slot }),
      });
    } finally {
      loadDocs();
    }
  };
  const [dragOver, setDragOver] = useState(false);
  const options = slotOptions(profile);

  const slots = packetSlots(profile);
  const { percent, missing, satisfied } = packetReadiness(profile, docs);
  const sections = buildPacket(profile, [...documents, ...satisfied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(packetText(profile, [...documents, ...satisfied]));
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
        {/* True at the database: documents carry an owner-only policy, so
            crew mates who share the pipeline still can't open these. */}
        <div className="muted packet-privacy">
          <Icon name="check" size={12} /> Private to you. Nobody else can open
          these, including people searching with you.
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

      {/* The situation decides the checklist, so it's set right here: how
          you earn picks the B column, and a guarantor brings their own
          parallel stack — the same shape as the sheets management companies
          circulate. */}
      <div className="packet-situation">
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
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
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

    </div>
  );
}
