"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import Icon from "@/components/Icon";

/**
 * Your own footage from the viewing, pinned to the listing.
 *
 * Photos lie by omission — every listing looks the same after the fourth
 * tour, and the thing that decides it ("remember the traffic noise?", "the
 * bedroom fit test") is on someone's phone in a camera roll nobody can find.
 * So the panel takes the files right there: straight from the phone into
 * storage (video can't ride through an API route — serverless bodies cap at
 * a few MB), a metadata row for the listing, signed URLs to play it back.
 * Crew-mates see each other's clips; only the person who shot one can
 * delete it.
 */

interface MediaItem {
  id: string;
  user_id: string;
  path: string;
  kind: "photo" | "video";
  caption: string;
  created_at: string;
  url: string;
}

export default function TourMedia({ listingId }: { listingId: string }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/listings/${encodeURIComponent(listingId)}/media`);
      const body = await res.json();
      if (body.media) setItems(body.media);
    } catch {
      // The section quietly stays empty; uploads will surface real errors.
    }
  }, [listingId]);

  useEffect(() => {
    load();
    // getSession, not getUser: the id is only for showing delete buttons
    // (RLS enforces the real rule), and the session is already in cookies —
    // no network round-trip needed.
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => setMe(data.session?.user?.id ?? null));
  }, [load]);

  async function upload(file: File) {
    setError("");
    const supabase = supabaseBrowser();
    const { data: auth } = await supabase.auth.getSession();
    const uid = auth.session?.user?.id;
    if (!uid) return;

    const kind = file.type.startsWith("video") ? "video" : "photo";
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `${uid}/${listingId}/${Date.now()}-${safe}`;
    setBusy(kind === "video" ? "Uploading video…" : "Uploading photo…");
    try {
      const { error: upErr } = await supabase.storage
        .from("tour-media")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) throw new Error(upErr.message);
      const { error: rowErr } = await supabase.from("user_listing_media").insert({
        user_id: uid,
        listing_id: listingId,
        path,
        kind,
      });
      if (rowErr) throw new Error(rowErr.message);
      await load();
    } catch (err) {
      setError(
        err instanceof Error && /exceeded|size/i.test(err.message)
          ? "That file is over the 250MB limit — trim the clip and try again."
          : `Upload didn't stick — ${err instanceof Error ? err.message : "try again"}.`
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(item: MediaItem) {
    const supabase = supabaseBrowser();
    // Optimistic: the row is the source of truth, the object follows.
    setItems((list) => list.filter((m) => m.id !== item.id));
    await supabase.from("user_listing_media").delete().eq("id", item.id);
    await supabase.storage.from("tour-media").remove([item.path]);
  }

  return (
    <div className="tourmedia">
      <div className="tourmedia-head">
        <button
          className="btn"
          onClick={() => fileRef.current?.click()}
          disabled={busy != null}
        >
          <Icon name="plus" size={14} />
          {busy ?? "Add video or photos"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            for (const file of files) await upload(file);
          }}
        />
        {items.length === 0 && !busy && (
          <span className="muted tourmedia-hint">
            What you film at the viewing lives here — the traffic noise, the
            water pressure, whether the couch fits.
          </span>
        )}
      </div>

      {error && <p className="warn-text tourmedia-error">{error}</p>}

      {items.length > 0 && (
        <div className="tourmedia-grid">
          {items.map((item) => (
            <figure key={item.id} className="tourmedia-item">
              {item.kind === "video" ? (
                <video src={item.url} controls playsInline preload="metadata" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.caption || "Tour photo"} loading="lazy" />
              )}
              {item.user_id === me && (
                <button
                  className="tourmedia-del"
                  onClick={() => remove(item)}
                  aria-label="Delete this file"
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
