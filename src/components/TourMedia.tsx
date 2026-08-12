"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  enqueueUploads,
  subscribeUploads,
  uploadJobs,
  pendingUploads,
  clearUploadError,
  cancelUpload,
} from "@/lib/uploadQueue";
import Icon from "@/components/Icon";
import Lightbox from "@/components/Lightbox";

/**
 * Your own footage from the viewing, pinned to the listing.
 *
 * Photos lie by omission — every listing looks the same after the fourth
 * tour, and the thing that decides it ("remember the traffic noise?", "the
 * bedroom fit test") is on someone's phone in a camera roll nobody can find.
 * Files stream from the phone through this app's own Worker into R2 via the
 * module-level upload queue, so closing this panel doesn't kill a half-sent
 * walkthrough and the browser never holds a storage credential. Crew-mates
 * see each other's clips; only the person who shot one can delete it.
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
  const [viewing, setViewing] = useState<number | null>(null);
  // Bumped on every queue event so the in-flight rows below re-render with
  // fresh percentages; the queue itself owns the numbers.
  const [, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    // A visitor has no footage; skip the guaranteed 401.
    if (!document.cookie.includes("-auth-token")) return;
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
      setTick((n) => n + 1);
      if (now < had) load();
      had = now;
    });
  }, [listingId, load]);

  const mine = uploadJobs().filter((j) => j.listingId === listingId);
  const failures = mine.filter((j) => j.state === "error");
  const inFlight = mine.filter((j) => j.state === "queued" || j.state === "uploading");

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
          {pending > 0 ? `Uploading ${pending}. Add more` : "Add video or photos"}
        </button>
        <input
          ref={fileRef}
          type="file"
          // Extensions spelled out alongside the wildcards: some pickers
          // filter by MIME type and hide files the OS never typed, which is
          // exactly how a .MOV can vanish from its own upload dialog.
          accept="image/*,video/*,.mov,.mp4,.m4v,.webm,.3gp,.3g2,.mkv,.avi,.wmv,.mpg,.mpeg,.mts,.m2ts,.ogv,.jpg,.jpeg,.jfif,.png,.gif,.webp,.heic,.heif,.avif,.bmp,.tif,.tiff"
          multiple
          hidden
          onChange={(e) => {
            enqueueUploads(listingId, e.target.files ?? []);
            e.target.value = "";
          }}
        />
        {items.length === 0 && pending === 0 && (
          <span className="muted tourmedia-hint">
            What you film at the viewing lives here, or drop files anywhere
            in this box. Up to 400MB each; uploads keep going if you close the
            panel.
          </span>
        )}
      </div>

      {dragOver && (
        <div className="tourmedia-dropnote" aria-hidden="true">
          Drop to attach to this listing
        </div>
      )}

      {inFlight.length > 0 && (
        <ul className="uprows">
          {inFlight.map((job) => {
            const pct = Math.round(job.progress * 100);
            return (
              <li key={job.id} className="uprow">
                <Icon name={job.kind === "video" ? "video" : "image"} size={14} />
                <span className="uprow-name">{job.name}</span>
                <span className="uprow-pct">
                  {job.state === "queued" ? "waiting" : `${pct}%`}
                </span>
                <button
                  className="uprow-x"
                  onClick={() => cancelUpload(job.id)}
                  aria-label={`Cancel upload of ${job.name}`}
                >
                  <Icon name="close" size={12} />
                </button>
                <div
                  className="uploadbar uprow-bar"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span
                    style={{ width: `${Math.max(2, pct)}%` }}
                    data-idle={job.state === "queued" ? "true" : undefined}
                  />
                </div>
              </li>
            );
          })}
        </ul>
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
          {items.map((item, i) => (
            <figure key={item.id} className="tourmedia-item">
              {/*
                * The tile opens the viewer rather than playing in place. A
                * 150px video with native controls is unwatchable — the scrubber
                * is wider than the picture — and the whole reason the footage
                * exists is to be looked at properly on decision night.
                */}
              <button
                className="tourmedia-open"
                onClick={() => setViewing(i)}
                aria-label={`View ${item.kind === "video" ? "video" : "photo"} full screen`}
              >
                {item.kind === "video" ? (
                  <>
                    {/* #t paints frame one, so a tile is a thumbnail, not a
                        black square. */}
                    <video src={`${item.url}#t=0.01`} playsInline preload="metadata" muted />
                    <span className="tourmedia-play" aria-hidden="true">
                      <Icon name="play" size={16} />
                    </span>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.caption || "Tour photo"} loading="lazy" />
                )}
              </button>
              {item.user_id === me && (
                <button
                  className="tourmedia-del"
                  onClick={async () => {
                    // The route drops the row and the R2 object together, so a
                    // delete can't leave bytes paying rent with nothing
                    // pointing at them.
                    setItems((list) => list.filter((m) => m.id !== item.id));
                    await fetch(
                      `/api/media/${item.path.split("/").map(encodeURIComponent).join("/")}`,
                      { method: "DELETE" }
                    );
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

      {viewing !== null && (
        <Lightbox
          items={items.map((m) => ({ url: m.url, kind: m.kind, caption: m.caption }))}
          start={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
