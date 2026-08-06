import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The tour-footage bucket.
 *
 * Bytes live in R2, metadata stays in Postgres. That split is deliberate:
 * the rows carry who shot what and which listing it belongs to, and their
 * row-level policies already decide who may see a crew-mate's video — so
 * nothing here re-implements authorization, it just moves the bytes.
 */
export interface R2UploadedPart {
  partNumber: number;
  etag: string;
}

export interface R2MultipartUpload {
  uploadId: string;
  key: string;
  uploadPart(partNumber: number, value: ArrayBuffer): Promise<R2UploadedPart>;
  complete(parts: R2UploadedPart[]): Promise<unknown>;
  abort(): Promise<void>;
}

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
  createMultipartUpload(
    key: string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<R2MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload;
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
 * 200MB is a full walkthrough of a real apartment at phone quality — every
 * room, the closets, the street noise out the window — rather than the
 * ninety-second clip a smaller limit forces people to shoot.
 *
 * Nothing that large ever reaches a Worker in one piece. A single request is
 * bounded by Cloudflare's body limit and by the 128MB of memory a Worker gets,
 * and R2 refuses a stream whose length it doesn't know — so anything over
 * `PART_BYTES` is cut up in the browser and reassembled by R2 through a
 * multipart upload. The number below is a product decision; the one below it
 * is the engineering one.
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * How much of a file crosses the wire in one request.
 *
 * R2 requires every part except the last to be at least 5MB and wants them
 * uniform. 12MB keeps peak Worker memory an order of magnitude under the
 * limit, makes the largest allowed file 17 parts, and is small enough that
 * losing one to a dropped connection costs seconds rather than minutes.
 */
export const PART_BYTES = 12 * 1024 * 1024;

/** Below this a file goes up whole; there's no point paying for three round trips. */
export const SINGLE_SHOT_BYTES = 12 * 1024 * 1024;
