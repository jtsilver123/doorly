"use client";


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

/** Cloudflare's request-body ceiling on this plan, minus room for headers. */
const MAX_BYTES = 60 * 1024 * 1024;

async function doUpload(job: UploadJob): Promise<void> {
  if (job.file.size > MAX_BYTES) {
    throw new Error(
      `too big (${Math.round(job.file.size / 1048576)}MB) — trim the clip or film at 1080p (60MB max)`
    );
  }

  /*
   * Straight to our own Worker, which streams it into R2.
   *
   * This used to hand the file to Supabase Storage from the browser. R2 is
   * the better home for video — free egress, so re-watching a walkthrough on
   * decision night costs nothing — and routing through the app means the
   * browser never holds a storage credential.
   */
  const res = await fetch(
    `/api/listings/${encodeURIComponent(job.listingId)}/media?name=${encodeURIComponent(job.file.name)}`,
    {
      method: "POST",
      headers: { "content-type": job.file.type || "application/octet-stream" },
      body: job.file,
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `upload failed (${res.status})`);
  }
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
