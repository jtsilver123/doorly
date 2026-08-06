"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  enqueueUploads,
  subscribeUploads,
  uploadJobs,
  pendingUploads,
  clearUploadError,
} from "@/lib/uploadQueue";
import Icon from "@/components/Icon";

/**
 * Your own footage from the viewing, pinned to the listing.
 *
 * Photos lie by omission — every listing looks the same after the fourth
 * tour, and the thing that decides it ("remember the traffic noise?", "the
 * bedroom fit test") is on someone's phone in a camera roll nobody can find.
 * Files go straight from the phone to storage (video can't ride through an
 * API route — serverless bodies cap at a few MB) via the module-level upload
 * queue, so closing this panel doesn't kill a half-sent walkthrough. Crew-
 * mates see each other's clips; only the person who shot one can delete it.
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
  const [pending, setPending] = useState(0);
  const [dragOver, setDragOver] = useState(false);
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

  // The queue is the source of truth for in-flight work; this panel just
  // mirrors it, and refreshes the grid when one of its own files lands.
  useEffect(() => {
    let had = pendingUploads(listingId);
    setPending(had);
    return subscribeUploads(() => {
      const now = pendingUploads(listingId);
      setPending(now);
      if (now < had) load();
      had = now;
    });
  }, [listingId, load]);

  const failures = uploadJobs().filter(
    (j) => j.listingId === listingId && j.state === "error"
  );

  return (
    <div
      className="tourmedia"
      data-drag={dragOver ? "true" : undefined}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        enqueueUploads(listingId, e.dataTransfer.files);
      }}
    >
      <div className="tourmedia-head">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <Icon name="plus" size={14} />
          {pending > 0
            ? `Uploading ${pending} — add more`
            : "Add video or photos"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            enqueueUploads(listingId, e.target.files ?? []);
            e.target.value = "";
          }}
        />
        {items.length === 0 && pending === 0 && (
          <span className="muted tourmedia-hint">
            What you film at the viewing lives here — or drop files anywhere
            in this box. Uploads keep going if you close the panel.
          </span>
        )}
      </div>

      {dragOver && (
        <div className="tourmedia-dropnote" aria-hidden="true">
          Drop to attach to this listing
        </div>
      )}

      {failures.map((job) => (
        <p key={job.id} className="warn-text tourmedia-error">
          {job.name}: {job.error}{" "}
          <button className="linkish" onClick={() => clearUploadError(job.id)}>
            Dismiss
          </button>
        </p>
      ))}

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
                  onClick={async () => {
                    const supabase = supabaseBrowser();
                    setItems((list) => list.filter((m) => m.id !== item.id));
                    await supabase.from("user_listing_media").delete().eq("id", item.id);
                    await supabase.storage.from("tour-media").remove([item.path]);
                  }}
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
