import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The tour-footage bucket.
 *
 * Bytes live in R2, metadata stays in Postgres. That split is deliberate:
 * the rows carry who shot what and which listing it belongs to, and their
 * row-level policies already decide who may see a crew-mate's video — so
 * nothing here re-implements authorization, it just moves the bytes.
 */
export interface MediaBucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
    size: number;
  } | null>;
  delete(key: string): Promise<void>;
}

export function mediaBucket(): MediaBucket {
  const env = getCloudflareContext().env as unknown as { MEDIA?: MediaBucket };
  if (!env.MEDIA) throw new Error("R2 bucket binding MEDIA is missing");
  return env.MEDIA;
}

/**
 * Where a file lives: the uploader's id first, so a path is self-describing
 * and a listing's footage from two crew-mates can't collide.
 */
export function mediaKey(userId: string, listingId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-80);
  return `${userId}/${listingId}/${Date.now()}-${safe}`;
}

/**
 * The upload ceiling, set by the Worker's 128MB of memory rather than by
 * Cloudflare's 100MB request-body limit — R2 needs a known length, so the
 * file is buffered on the way through and has to fit with room to spare.
 *
 * 60MB is a couple of minutes of 1080p from a phone, which is what a tour
 * clip actually is. Anything larger is refused in the browser, before the
 * upload starts, rather than failing two minutes into a progress bar.
 */
export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
