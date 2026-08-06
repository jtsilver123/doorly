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
  /** How much of the body has left the browser, 0–1. */
  progress: number;
  bytes: number;
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
  return activeJobs(listingId).length;
}

function activeJobs(listingId?: string): UploadJob[] {
  return jobs.filter(
    (j) =>
      (j.state === "queued" || j.state === "uploading") &&
      (!listingId || j.listingId === listingId)
  );
}

/**
 * How far along everything still in flight is, weighted by size.
 *
 * Weighted, not averaged per file: a 40MB walkthrough queued behind three
 * snapshots would otherwise show 75% while the only part anyone is waiting
 * for hasn't started. The bar has to track the wait, not the file count.
 */
export function uploadProgress(listingId?: string): { done: number; total: number; ratio: number } {
  const active = activeJobs(listingId);
  const total = active.reduce((sum, j) => sum + j.bytes, 0);
  const done = active.reduce((sum, j) => sum + j.bytes * j.progress, 0);
  return { done, total, ratio: total > 0 ? done / total : 0 };
}

export function clearUploadError(id: number): void {
  jobs = jobs.filter((j) => j.id !== id);
  notify();
}

/** Abort one upload. The queue moves on to the next file by itself. */
export function cancelUpload(id: number): void {
  const job = jobs.find((j) => j.id === id);
  if (!job) return;
  if (job.state === "uploading") current?.abort();
  jobs = jobs.filter((j) => j.id !== id);
  notify();
}

/** Chrome and Safari both demand the handler exist to show their prompt. */
function guard(e: BeforeUnloadEvent) {
  e.preventDefault();
}

/*
 * Kept in step with the server's own limits — see lib/r2.ts, which explains
 * why the ceiling is a product decision and the part size is an engineering
 * one. Duplicated as plain numbers rather than imported because that module
 * reaches for the Cloudflare context, which does not exist in a browser.
 */
const MAX_BYTES = 200 * 1024 * 1024;
const PART_BYTES = 12 * 1024 * 1024;
const SINGLE_SHOT_BYTES = 12 * 1024 * 1024;

/** One request with a raw body, reporting progress as it drains. */
function send(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error("connection dropped — try again"));
    xhr.onabort = () => reject(new Error("upload cancelled"));
    current = xhr;
    xhr.send(body);
  });
}

function fail(res: { status: number; text: string }): never {
  let message = `upload failed (${res.status})`;
  try {
    message = JSON.parse(res.text).error ?? message;
  } catch {
    // Non-JSON error body (a proxy page, say) — keep the status line.
  }
  throw new Error(message);
}

/** The request in flight, so a cancel has something to abort. */
let current: XMLHttpRequest | null = null;

async function doUpload(job: UploadJob): Promise<void> {
  if (job.file.size > MAX_BYTES) {
    throw new Error(
      `too big (${Math.round(job.file.size / 1048576)}MB) — 200MB is the ceiling`
    );
  }
  const type = job.file.type || "application/octet-stream";
  const base = `/api/listings/${encodeURIComponent(job.listingId)}/media`;
  const track = (fraction: number) => {
    /*
     * Held just shy of 1. The last bytes leaving the browser is not the same
     * event as the server having stored them — the R2 write and the metadata
     * row still have to happen — and a bar that sits at 100% for four seconds
     * reads as stuck.
     */
    job.progress = Math.min(0.98, fraction);
    notify();
  };

  if (job.file.size <= SINGLE_SHOT_BYTES) {
    const res = await send(
      `${base}?name=${encodeURIComponent(job.file.name)}`,
      job.file,
      type,
      track
    );
    if (res.status < 200 || res.status >= 300) fail(res);
    job.progress = 1;
    notify();
    return;
  }

  /*
   * Big file: cut it up here and let R2 reassemble it.
   *
   * A 200MB walkthrough can't cross a Worker whole — Cloudflare bounds the
   * request body, the Worker has 128MB of memory, and R2 needs a known length
   * so the body gets buffered on the way through. Parts sidestep all three,
   * and they make a dropped connection cost one 12MB chunk instead of the
   * whole upload.
   */
  const createRes = await fetch(`${base}/multipart?action=create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "create",
      filename: job.file.name,
      contentType: type,
      size: job.file.size,
    }),
  });
  if (!createRes.ok) fail({ status: createRes.status, text: await createRes.text() });
  const { key, uploadId } = (await createRes.json()) as { key: string; uploadId: string };

  const total = Math.ceil(job.file.size / PART_BYTES);
  const parts: { partNumber: number; etag: string }[] = [];
  try {
    for (let i = 0; i < total; i++) {
      const chunk = job.file.slice(i * PART_BYTES, (i + 1) * PART_BYTES);
      const res = await send(
        `${base}/multipart?action=part&key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${i + 1}`,
        chunk,
        "application/octet-stream",
        // Whole-file progress, not per-part: the bar tracks the wait, and the
        // wait is the file.
        (fraction) => track((i * PART_BYTES + fraction * chunk.size) / job.file.size)
      );
      if (res.status < 200 || res.status >= 300) fail(res);
      parts.push(JSON.parse(res.text));
    }

    const done = await fetch(`${base}/multipart?action=complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "complete", key, uploadId, contentType: type, parts }),
    });
    if (!done.ok) fail({ status: done.status, text: await done.text() });
  } catch (err) {
    /*
     * Tell R2 to throw the parts away. Left dangling they'd sit in the bucket
     * indefinitely, invisible — an abandoned multipart upload is billed like
     * any other stored object but appears in no listing.
     */
    void fetch(`${base}/multipart?action=abort`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "abort", key, uploadId }),
      keepalive: true,
    }).catch(() => {});
    throw err;
  }

  job.progress = 1;
  notify();
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
      job.progress = 0;
      notify();
      try {
        await doUpload(job);
        job.state = "done";
      } catch (err) {
        job.state = "error";
        const message = err instanceof Error ? err.message : "upload failed";
        /*
         * `doUpload` already words the size and connection cases precisely.
         * The old blanket rewrite here replaced them with a wrong number, so
         * only genuinely opaque server refusals get a friendlier line now.
         */
        job.error = /payload too large|entity too large/i.test(message)
          ? "the server refused it — trim the clip"
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
      progress: 0,
      bytes: file.size,
      file,
    });
  }
  notify();
  void pump();
}
