/**
 * Tour footage, streamed straight into R2.
 *
 * This is the one route that deliberately never reaches Next, and the reason
 * is a single line of the R2 API: a bucket needs to know a body's length
 * before it will store it. Next hands a route handler a re-wrapped request
 * whose stream has lost that, so the only way to satisfy R2 from inside the
 * app was to read the whole file into memory first — and a Worker gets 128MB.
 * A 44MB video pushed it over, the isolate was killed, and everything sharing
 * it died too: a 503 on the upload, a 1102 on the app, and a sign-in that
 * appeared to do nothing for someone who had signed in fine the day before.
 *
 * Handled here, at the Worker's own front door, the request is still the
 * runtime's native `Request`. Its body goes into the bucket as a stream, with
 * `content-length` intact, and peak memory is a buffer of a few kilobytes no
 * matter how big the file is. One hop, no chunking, no ceiling worth naming.
 *
 * Authorization is not skipped, only moved. The Supabase session cookie is
 * read, the access token inside it is verified against Supabase, and the
 * metadata row is written back through PostgREST *as that user* — so the same
 * row-level policies that govern every other write still decide this one. The
 * object key is derived from the verified user id, never from the client, so
 * a caller cannot write into anyone else's prefix.
 */

/** Matches the app's own key layout — see lib/r2.ts. */
function mediaKey(userId, listingId, filename) {
  const safe = String(filename).replace(/[^\w.\-]+/g, "_").slice(-80);
  return `${userId}/${listingId}/${Date.now()}-${safe}`;
}

/**
 * Pull the Supabase access token out of the cookie header.
 *
 * `@supabase/ssr` stores the whole session as `base64-` + base64 JSON, and
 * splits it across `...auth-token.0`, `.1` when it outgrows a cookie. Both
 * shapes have to be handled, and the chunks reassembled in index order rather
 * than the order the browser happened to send them.
 */
function accessTokenFrom(cookieHeader, supabaseUrl) {
  if (!cookieHeader) return null;
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const base = `sb-${ref}-auth-token`;

  const parts = [];
  for (const piece of cookieHeader.split(";")) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    const name = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (name === base) parts.push([0, value]);
    else if (name.startsWith(`${base}.`)) {
      const n = Number(name.slice(base.length + 1));
      if (Number.isFinite(n)) parts.push([n, value]);
    }
  }
  if (!parts.length) return null;

  let raw = parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join("");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Already decoded; the browser only percent-encodes some of these.
  }
  if (!raw.startsWith("base64-")) return null;
  try {
    return JSON.parse(atob(raw.slice(7))).access_token ?? null;
  } catch {
    return null;
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Handles `POST /api/upload`. Returns null for anything else, so the caller
 * falls through to the app untouched.
 */
export async function handleUpload(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/upload" || request.method !== "POST") return null;

  try {
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey || !env.MEDIA) {
      return json({ error: "uploads are not configured" }, 500);
    }

    const token = accessTokenFrom(request.headers.get("cookie"), supabaseUrl);
    if (!token) return json({ error: "not signed in" }, 401);

    // Verified against Supabase rather than merely decoded: an expired or
    // forged token has to fail here, not at the database.
    const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    });
    if (!who.ok) return json({ error: "session expired — reload and try again" }, 401);
    const userId = (await who.json()).id;
    if (!userId) return json({ error: "not signed in" }, 401);

    const listingId = url.searchParams.get("listing");
    const filename = url.searchParams.get("name") || "upload";
    const contentType = request.headers.get("content-type") || "application/octet-stream";
    if (!listingId) return json({ error: "no listing" }, 400);
    if (!contentType.startsWith("video/") && !contentType.startsWith("image/")) {
      return json({ error: "only photos and video" }, 415);
    }
    if (!request.body) return json({ error: "no file" }, 400);

    /*
     * The whole point. `request.body` is the runtime's own stream and the
     * request still carries `content-length`, which is the length R2 wants —
     * so the bytes go from the socket to the bucket without ever being
     * assembled in memory.
     */
    const key = mediaKey(userId, listingId, filename);
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType } });

    // Written as the user, so row-level security governs this insert exactly
    // as it governs every other one.
    const insert = await fetch(`${supabaseUrl}/rest/v1/user_listing_media`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        listing_id: listingId,
        path: key,
        kind: contentType.startsWith("video/") ? "video" : "photo",
      }),
    });
    if (!insert.ok) {
      // Don't leave an orphan object paying rent for a row that never existed.
      await env.MEDIA.delete(key).catch(() => {});
      return json({ error: (await insert.text()).slice(0, 200) || "could not save" }, 500);
    }

    return json({ path: key });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "upload failed" }, 500);
  }
}
