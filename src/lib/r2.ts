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
 * The upload ceiling.
 *
 * 400MB is a long walkthrough of a real apartment at modern phone quality —
 * every room, the closets, the street noise out the window, shot in the 4K
 * a recent phone defaults to — rather than the ninety-second clip a smaller
 * limit forces people to shoot.
 *
 * Nothing that large is ever held in memory. The upload is answered by the
 * Worker itself (see upload-handler.js), where each part is still the
 * runtime's own stream and goes into the bucket without being assembled —
 * which is what makes a number this size a product decision rather than an
 * engineering one.
 */
export const MAX_UPLOAD_BYTES = 400 * 1024 * 1024;


