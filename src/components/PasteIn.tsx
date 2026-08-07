"use client";

import { useEffect, useState } from "react";
import type { FreePost } from "@/lib/freepost";

/**
 * The paste-in form: a Facebook-group post (or any tip) becoming a listing.
 *
 * Meta closed the group APIs and its terms bar scraping, so the group
 * boards can't be polled the way the listing sites are. What CAN be honest
 * and fast is the paste: copy the post, drop it in either paste box, and
 * this form opens with everything the parser could read already filled in.
 * One look, one button, and the tip is a real card — drafts, tracking,
 * compare, the whole machine — instead of a screenshot in your camera roll.
 *
 * Everything is editable because the parser is guessing. The address field
 * is the only requirement, same as the API: group posts often name no
 * address at all, and "Ludlow & Rivington area" typed by hand beats a
 * refused add.
 */
export default function PasteIn({
  text,
  url,
  parsed,
  onDone,
  onClose,
}: {
  /** The pasted post, verbatim; becomes the listing's notes. */
  text: string;
  /** A pasted link, when that's what arrived. */
  url: string;
  parsed: FreePost;
  /** Called with the new listing id after a successful add. */
  onDone: (id: string) => void;
  onClose: () => void;
}) {
  const [address, setAddress] = useState(parsed.address ?? "");
  const [neighborhood, setNeighborhood] = useState(parsed.neighborhood ?? "");
  const [price, setPrice] = useState(parsed.price ? String(parsed.price) : "");
  const [bedrooms, setBedrooms] = useState(
    parsed.bedrooms != null ? String(parsed.bedrooms) : ""
  );
  const [phone, setPhone] = useState(parsed.phone ?? "");
  const [email, setEmail] = useState(parsed.email ?? "");
  const [link, setLink] = useState(url);
  const [fromFacebook, setFromFacebook] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!address.trim()) {
      setError("It needs at least an address, or a cross-street to go find.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: fromFacebook ? "facebook" : "manual",
          address: address.trim(),
          neighborhood: neighborhood.trim() || undefined,
          price: Number(price) || 0,
          bedrooms: bedrooms === "" ? undefined : Number(bedrooms),
          contactPhone: phone.trim() || undefined,
          contactEmail: email.trim() || undefined,
          url: link.trim(),
          notes: text.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (body.error) {
        setError(body.error);
        setBusy(false);
        return;
      }
      onDone(body.id);
    } catch {
      setError("The add didn't stick. Try once more.");
      setBusy(false);
    }
  }

  return (
    <div
      className="compare-modal"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compare-modal-panel" role="dialog" aria-modal="true" aria-label="Add the pasted place">
        <div className="compare-modal-head">
          <div>
            <b>Pull it in</b>
            <div className="muted" style={{ fontSize: 12 }}>
              Read from your paste. Fix anything it guessed wrong.
            </div>
          </div>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>

        <div className="pastein-grid">
          <label className="pastein-wide">
            <span className="muted">Address or cross-streets</span>
            <input
              className="field"
              value={address}
              placeholder="184 Ludlow St, or Ludlow & Rivington"
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label>
            <span className="muted">Rent</span>
            <input
              className="field"
              inputMode="numeric"
              value={price}
              placeholder="3200"
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
            />
          </label>
          <label>
            <span className="muted">Bedrooms</span>
            <input
              className="field"
              inputMode="numeric"
              value={bedrooms}
              placeholder="0 for studio"
              onChange={(e) => setBedrooms(e.target.value.replace(/[^\d]/g, ""))}
            />
          </label>
          <label>
            <span className="muted">Neighborhood</span>
            <input
              className="field"
              value={neighborhood}
              placeholder="Lower East Side"
              onChange={(e) => setNeighborhood(e.target.value)}
            />
          </label>
          <label>
            <span className="muted">Their phone</span>
            <input
              className="field"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label>
            <span className="muted">Their email</span>
            <input
              className="field"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            <span className="muted">Link to the post</span>
            <input
              className="field"
              inputMode="url"
              value={link}
              placeholder="https://facebook.com/groups/…"
              onChange={(e) => setLink(e.target.value)}
            />
          </label>
          <label className="packet-toggle pastein-wide">
            <input
              type="checkbox"
              checked={fromFacebook}
              onChange={(e) => setFromFacebook(e.target.checked)}
            />
            From a Facebook group
          </label>
        </div>

        {text.trim() && (
          <p className="pastein-note muted">
            The post itself rides along as the listing&apos;s notes.
          </p>
        )}
        {error && (
          <p className="pastein-error" role="alert">
            {error}
          </p>
        )}

        <button className="btn btn-primary" disabled={busy} onClick={submit}>
          {busy ? "Adding…" : "Add it to the board"}
        </button>
      </div>
    </div>
  );
}
