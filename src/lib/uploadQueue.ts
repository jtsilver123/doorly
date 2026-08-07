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
 * Which file of how many. `at` advances while a file is in flight, so the
 * pill reads "2 of 3" during the second rather than after it.
 */
export function uploadBatch(): { at: number; total: number } {
  const left = activeJobs().length;
  return { at: Math.min(batchTotal, batchTotal - left + 1), total: batchTotal };
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

/*
 * The edge accepts at most 100MB per request, measured empirically: a 105MB
 * probe got a raw 413 with the Worker never invoked. But the binding numbers
 * are tighter than the edge's: the Worker accrues CPU per byte it relays, and
 * production logs showed minute-long transfers on phone connections being
 * killed with exceededCpu partway through. Small parts keep every single
 * request short enough to stay inside that budget, cheap to retry when a
 * radio drops, and small enough that the server's buffering fallback can
 * never threaten an isolate. Only files that fit in one small request skip
 * the multipart dance entirely.
 */
const SINGLE_SHOT_BYTES = 24 * 1024 * 1024;
const PART_BYTES = 16 * 1024 * 1024;

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

/*
 * Some phone pickers hand over files with an empty MIME type — an iPhone
 * .MOV arriving as type "" was silently skipped by the image-or-video gate,
 * which reads to the person as "I selected my videos and nothing happened".
 * The extension is the fallback identity, and it also becomes the stored
 * content-type so playback gets a real one instead of octet-stream.
 */
const EXT_TYPES: Record<string, string> = {
  mov: "video/quicktime",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  webm: "video/webm",
  "3gp": "video/3gpp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
};

function sniffType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPES[ext] ?? "";
}

/** 5xx and dropped connections are worth another go; 4xx never is. */
function worthRetrying(res: { status: number } | null): boolean {
  return res === null || res.status >= 500 || res.status === 429;
}

/*
 * How long a request may sit with zero progress before it's declared dead.
 *
 * Not a total timeout — a big part on hotel wifi legitimately takes minutes,
 * and killing it for being slow would be self-harm. What's being caught is
 * the stall: a phone that walked out of coverage keeps the socket open
 * without moving a byte, and without this the bar froze at 40% forever with
 * no error and no retry.
 */
const STALL_MS = 75 * 1000;

/** One request with a raw body, reporting progress as it drains. */
function send(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stalled = false;
    let watchdog: ReturnType<typeof setTimeout>;
    const rearm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, STALL_MS);
    };
    const settle = <T,>(fn: (v: T) => void) => (v: T) => {
      clearTimeout(watchdog);
      fn(v);
    };
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      rearm();
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = settle(() => resolve({ status: xhr.status, text: xhr.responseText }));
    xhr.onerror = settle(() => reject(new Error("connection dropped. Try again")));
    // A stall wears the same abort event as a user cancel; the flag is what
    // routes one to the retry loop and the other out of it.
    xhr.onabort = settle(() =>
      reject(new Error(stalled ? "connection stalled" : "upload cancelled"))
    );
    current = xhr;
    rearm();
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
      `too big (${Math.round(job.file.size / 1048576)}MB). 200MB is the ceiling`
    );
  }
  const type = sniffType(job.file) || "application/octet-stream";
  const track = (fraction: number) => {
    /*
     * Held just shy of 1. The last bytes leaving the browser is not the same
     * event as R2 having stored them and the metadata row landing, and a bar
     * that sits at 100% for four seconds reads as stuck.
     */
    job.progress = Math.min(0.98, fraction);
    notify();
  };

  const attempt = async (url: string, body: Blob, onProgress: (f: number) => void) => {
    let res: { status: number; text: string } | null = null;
    for (let tries = 1; tries <= TRIES; tries++) {
      try {
        res = await send(url, body, type, onProgress);
      } catch (err) {
        if (err instanceof Error && /cancelled/i.test(err.message)) throw err;
        res = null;
      }
      if (res && res.status >= 200 && res.status < 300) return res;
      if (tries === TRIES || !worthRetrying(res)) fail(res ?? { status: 0, text: "" });
      // Backing off rather than hammering: whatever went wrong upstream needs
      // a moment more than it needs the same bytes again immediately.
      await wait(800 * tries);
    }
    fail(res ?? { status: 0, text: "" });
  };

  if (job.file.size <= SINGLE_SHOT_BYTES) {
    await attempt(
      `/api/upload?listing=${encodeURIComponent(job.listingId)}&name=${encodeURIComponent(job.file.name)}`,
      job.file,
      track
    );
    job.progress = 1;
    notify();
    return;
  }

  /*
   * Past the edge's per-request cap: parts. Each one is an ordinary request
   * the size the edge is happy with; R2 stitches them back into one object,
   * and the metadata row is written on complete — so a torn upload can't
   * leave a card pointing at nothing.
   */
  const createRes = await fetch(
    `/api/upload?action=create&listing=${encodeURIComponent(job.listingId)}&name=${encodeURIComponent(job.file.name)}&type=${encodeURIComponent(type)}`,
    { method: "POST" }
  );
  if (!createRes.ok) fail({ status: createRes.status, text: await createRes.text() });
  const { key, uploadId } = (await createRes.json()) as { key: string; uploadId: string };

  const total = Math.ceil(job.file.size / PART_BYTES);
  const parts: { partNumber: number; etag: string }[] = [];
  try {
    for (let i = 0; i < total; i++) {
      const chunk = job.file.slice(i * PART_BYTES, (i + 1) * PART_BYTES);
      const res = await attempt(
        `/api/upload?action=part&key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${i + 1}`,
        chunk,
        // Whole-file progress: the bar tracks the wait, and the wait is the
        // file. A retry rewinds to this part's start rather than lying.
        (f) => track((i * PART_BYTES + f * chunk.size) / job.file.size)
      );
      parts.push(JSON.parse(res!.text));
    }
    // A cancel that lands between the last part and assembly: the XHR is
    // already gone, so the only trace is the job's absence from the queue.
    // Without this check the file completed anyway and reappeared, uploaded,
    // on a listing the person had explicitly told it to stop for.
    if (!jobs.some((j) => j.id === job.id)) throw new Error("upload cancelled");
    const done = await fetch(`/api/upload?action=complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key,
        uploadId,
        parts,
        listingId: job.listingId,
        contentType: type,
      }),
    });
    if (!done.ok) fail({ status: done.status, text: await done.text() });
  } catch (err) {
    // Abandoned parts sit invisibly in the bucket and bill like objects;
    // aborting is what frees them. keepalive so a closing tab still sends it.
    void fetch(`/api/upload?action=abort`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, uploadId }),
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
  // A fresh run restarts the count; files added to a run in progress extend it.
  if (!running) batchTotal = 0;
  for (const file of [...files]) {
    const type = sniffType(file);
    if (!type.startsWith("image/") && !type.startsWith("video/")) continue;
    jobs.push({
      id: ++seq,
      listingId,
      name: file.name,
      kind: type.startsWith("video/") ? "video" : "photo",
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
