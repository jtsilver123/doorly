/**
 * Signed media URLs, for the one viewer who has no session: the person a
 * link was shared with.
 *
 * Footage bytes are cookie-gated (see upload-handler.js), which is right
 * for the app and a dead end for a recipient. Rather than making any
 * listing's footage public — strangers can track the same apartment, and
 * their walkthroughs are not each other's business — the guest media list
 * mints URLs that carry their own proof: an HMAC over the object path and
 * an expiry, keyed by a secret both runtimes already hold. Possession of a
 * fresh share page is the permission; the signature just makes that
 * checkable at the byte door without a session.
 *
 * Short-lived on purpose. The guest page re-mints on every visit, so
 * expiry costs a viewer nothing, and a leaked URL stops working in an hour
 * instead of forever.
 */

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const MEDIA_SIG_TTL_MS = 60 * 60 * 1000;

/** The signed claim is the path and its deadline, nothing else. */
const material = (path: string, exp: number) => `${path}|${exp}`;

export async function signMediaPath(
  secret: string,
  path: string,
  now = Date.now()
): Promise<{ exp: number; sig: string }> {
  const exp = now + MEDIA_SIG_TTL_MS;
  const key = await hmacKey(secret);
  const sig = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(material(path, exp))));
  return { exp, sig };
}

export async function verifyMediaSig(
  secret: string,
  path: string,
  exp: number,
  sig: string,
  now = Date.now()
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp < now) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const key = await hmacKey(secret);
  const bytes = new Uint8Array(sig.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(sig.slice(i * 2, i * 2 + 2), 16);
  }
  // subtle.verify is constant-time; comparing hex strings ourselves isn't.
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(material(path, exp)));
}
