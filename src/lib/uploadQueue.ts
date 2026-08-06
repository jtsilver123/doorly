"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Uploads that outlive the panel that started them.
 *
 * A 200MB walkthrough takes real minutes on hotel wifi, and the natural next
 * move — close the panel, open the next listing — was silently racing the
 * upload. So the queue lives at module level, owned by nobody's component
 * tree: the drawer hands files over and may die freely, a global pill shows
 * what's still moving, and the browser warns before a real tab-close (the
 * one thing no web app can survive) while anything is in flight.
 */

export interface UploadJob {
  id: number;
  listingId: string;
  name: string;
  kind: "photo" | "video";
  state: "queued" | "uploading" | "done" | "error";
  error?: string;
  file: File;
}

let jobs: UploadJob[] = [];
let seq = 0;
let running = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function subscribeUploads(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function uploadJobs(): UploadJob[] {
  return jobs;
}

export function pendingUploads(listingId?: string): number {
  return jobs.filter(
    (j) =>
      (j.state === "queued" || j.state === "uploading") &&
      (!listingId || j.listingId === listingId)
  ).length;
}

export function clearUploadError(id: number): void {
  jobs = jobs.filter((j) => j.id !== id);
  notify();
}

/** Chrome and Safari both demand the handler exist to show their prompt. */
function guard(e: BeforeUnloadEvent) {
  e.preventDefault();
}

async function doUpload(job: UploadJob): Promise<void> {
  const supabase = supabaseBrowser();
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user?.id;
  if (!uid) throw new Error("signed out");

  const safe = job.file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${uid}/${job.listingId}/${Date.now()}-${safe}`;
  const { error: upErr } = await supabase.storage
    .from("tour-media")
    .upload(path, job.file, { contentType: job.file.type || undefined });
  if (upErr) throw new Error(upErr.message);
  const { error: rowErr } = await supabase.from("user_listing_media").insert({
    user_id: uid,
    listing_id: job.listingId,
    path,
    kind: job.kind,
  });
  if (rowErr) throw new Error(rowErr.message);
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  window.addEventListener("beforeunload", guard);
  try {
    for (;;) {
      const job = jobs.find((j) => j.state === "queued");
      if (!job) break;
      job.state = "uploading";
      notify();
      try {
        await doUpload(job);
        job.state = "done";
      } catch (err) {
        job.state = "error";
        const message = err instanceof Error ? err.message : "upload failed";
        job.error = /exceeded|size|payload/i.test(message)
          ? "over the 250MB limit — trim the clip"
          : message;
      }
      notify();
    }
  } finally {
    window.removeEventListener("beforeunload", guard);
    running = false;
    // Finished rows linger a beat so "done" is visible, then clear; errors
    // stay until dismissed.
    setTimeout(() => {
      jobs = jobs.filter((j) => j.state !== "done");
      notify();
    }, 3500);
  }
}

export function enqueueUploads(listingId: string, files: File[] | FileList): void {
  for (const file of [...files]) {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) continue;
    jobs.push({
      id: ++seq,
      listingId,
      name: file.name,
      kind: file.type.startsWith("video/") ? "video" : "photo",
      state: "queued",
      file,
    });
  }
  notify();
  void pump();
}
