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
/*
 * How many files this run started with, so the pill can say "2 of 3" rather
 * than counting down from a number nobody saw. Reset when the queue goes idle
 * and added to when more files are dropped mid-run, which is exactly what
 * happens when someone remembers the kitchen video.
 */
let batchTotal = 0;
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
/**
 * Which file of how many. `done` counts finished files, so the display reads
 * "2 of 3" while the second is in flight rather than after it lands.
 */
export function uploadBatch(): { at: number; total: number } {
  const left = activeJobs().length;
  return { at: Math.min(batchTotal, batchTotal - left + 1), total: batchTotal };
}

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

/**
 * How many times one chunk gets to fail before the file does.
 *
 * A phone on the move loses its radio, and an edge node recycles under load.
 * Losing an entire walkthrough to one of those is the worst possible outcome
 * for the thing someone drove across Brooklyn to film — and re-sending is
 * safe, because a repeat upload simply writes a new object.
 */
const TRIES = 3;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 5xx and dropped connections are worth another go; 4xx never is. */
function worthRetrying(res: { status: number } | null): boolean {
  return res === null || res.status >= 500 || res.status === 429;
}

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

  /*
   * One request, straight through to R2.
   *
   * This used to cut the file into parts and push each one through a Next
   * route, because R2 needs a known body length and Next's request wrapper
   * loses it — so the app had to buffer, and buffering a video inside a
   * Worker's 128MB is what was producing 503s and taking the whole isolate
   * down with it. `/api/upload` is answered by the Worker itself, before Next
   * sees it, where the body is still the runtime's own stream and goes to the
   * bucket without ever being assembled. No chunking, no reassembly, one hop
   * instead of several — which is most of why it was slow, too.
   *
   * Retried anyway: a phone losing its radio mid-upload is not a bug, and
   * re-sending is cheaper than making someone re-shoot a walkthrough.
   */
  const type = job.file.type || "application/octet-stream";
  const url = `/api/upload?listing=${encodeURIComponent(job.listingId)}&name=${encodeURIComponent(job.file.name)}`;

  let res: { status: number; text: string } | null = null;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      res = await send(url, job.file, type, (fraction) => {
        /*
         * Held just shy of 1. The last bytes leaving the browser is not the
         * same event as R2 having stored them and the metadata row landing,
         * and a bar that sits at 100% for four seconds reads as stuck.
         */
        job.progress = Math.min(0.98, fraction);
        notify();
      });
    } catch (err) {
      if (err instanceof Error && /cancelled/i.test(err.message)) throw err;
      res = null;
    }
    if (res && res.status >= 200 && res.status < 300) break;
    if (attempt === TRIES || !worthRetrying(res)) fail(res ?? { status: 0, text: "" });
    // Backing off rather than hammering: whatever went wrong upstream needs a
    // moment more than it needs the same 40MB again immediately.
    await wait(800 * attempt);
    job.progress = 0;
    notify();
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
  // A fresh run restarts the count; files added to a run in progress extend it.
  if (!running) batchTotal = 0;
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
    batchTotal++;
  }
  notify();
  void pump();
}
