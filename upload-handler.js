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

/** Resolve the session cookie to a verified user id, or null. */
async function verifiedUser(request, env) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;
  const token = accessTokenFrom(request.headers.get("cookie"), supabaseUrl);
  if (!token) return null;
  const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
  });
  if (!who.ok) return null;
  const id = (await who.json()).id;
  return id ? { id, token } : null;
}

/**
 * Handles `GET /api/media/<key>`. Returns null for anything else.
 *
 * Here for the same reason the upload is: the video was uploading fine and
 * then dying on playback with "Worker exceeded CPU time limit". Streaming a
 * 60MB file through Next means every chunk crosses the JS boundary twice, and
 * a phone's video element opens several parallel range requests per clip —
 * multiplied together they blew the CPU budget, which a user reads as "my
 * upload failed" because the tile they just uploaded never appears.
 *
 * At the front door the bytes go from R2 to the socket natively, and Range is
 * honoured for real: R2 reads only the requested slice, and the 206 that
 * Safari's scrubber depends on actually comes back as one.
 *
 * Authorization is the same shape as everywhere else: the metadata row is
 * fetched through PostgREST *as the viewer*, so row-level security decides
 * whether this is their file or their crew-mate's. No row, no bytes.
 */
export async function handleMediaGet(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/media/") || request.method !== "GET") return null;

  try {
    const key = url.pathname
      .slice("/api/media/".length)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
    if (!key || key.includes("..")) return json({ error: "bad path" }, 400);

    const user = await verifiedUser(request, env);
    if (!user) return json({ error: "not signed in" }, 401);

    // RLS does the deciding: own rows and crew rows are visible, and a 404
    // deliberately looks the same whether the file is missing or not theirs.
    const row = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/user_listing_media?path=eq.${encodeURIComponent(key)}&select=id&limit=1`,
      {
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          authorization: `Bearer ${user.token}`,
        },
      }
    );
    if (!row.ok || (await row.json()).length === 0) {
      return json({ error: "not found" }, 404);
    }

    /*
     * Range, parsed the way media elements actually send it: "bytes=0-1" to
     * probe, "bytes=N-" to resume, "bytes=-N" for the tail. Serving 200-full
     * to a range probe is what makes Safari refuse to scrub.
     *
     * Every ranged read is clamped to an 8MB window, whatever was asked for.
     * Chrome opens "bytes=0-" and holds that one response for the entire
     * playback, which on a phone connection means minutes of wall time — and
     * streaming accrues CPU per byte pumped, which is what was killing long
     * plays with exceededCpu partway through a clip. A short 206 is the
     * standard answer: the player reads the content-range, sees there's more,
     * and asks for the next window, so a two-minute stream becomes a handful
     * of invocations that each stay comfortably inside the budget.
     */
    const WINDOW = 8 * 1024 * 1024;
    const rangeHeader = request.headers.get("range");
    let range;
    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (m && (m[1] !== "" || m[2] !== "")) {
        if (m[1] === "") range = { suffix: Math.min(Number(m[2]), WINDOW) };
        else if (m[2] === "") range = { offset: Number(m[1]), length: WINDOW };
        else
          range = {
            offset: Number(m[1]),
            length: Math.min(Number(m[2]) - Number(m[1]) + 1, WINDOW),
          };
      }
    }

    let object;
    try {
      object = await env.MEDIA.get(key, range ? { range } : undefined);
    } catch (err) {
      // The clamp can push a window past the end of the file ("bytes=N-" near
      // the tail becomes offset N, length 8MB). If R2 rejects that instead of
      // clamping, ask again open-ended — by definition under 8MB remains.
      if (range && "length" in range) {
        object = await env.MEDIA.get(key, { range: { offset: range.offset } });
        if (object) range = { offset: range.offset };
      }
      if (!object) throw err;
    }
    if (!object) return json({ error: "not found" }, 404);

    const total = object.size;
    const headers = new Headers({
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      etag: object.httpEtag ?? "",
    });

    if (range) {
      const offset =
        "suffix" in range ? Math.max(0, total - range.suffix) : range.offset;
      const length =
        "suffix" in range
          ? Math.min(range.suffix, total)
          : Math.min(range.length ?? total - offset, total - offset);
      headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${total}`);
      headers.set("content-length", String(length));
      return new Response(object.body, { status: 206, headers });
    }

    /*
     * No Range header and a big file: hand back the first window as a 206
     * anyway. Technically a bent rule — 206 answers a Range request — but the
     * only no-range readers of a 100MB+ object are a navigation straight to
     * the file or a bulk download, both of which either recover via ranges or
     * were going to die mid-stream with the Worker anyway. Photos and small
     * clips, which is everything an <img> tag asks for, still get their
     * ordinary 200.
     */
    if (total > 4 * WINDOW) {
      const first = await env.MEDIA.get(key, { range: { offset: 0, length: WINDOW } });
      if (first) {
        // The full-body read above never gets consumed on this path.
        try { object.body?.cancel(); } catch { /* already closed */ }
        headers.set("content-range", `bytes 0-${WINDOW - 1}/${total}`);
        headers.set("content-length", String(WINDOW));
        return new Response(first.body, { status: 206, headers });
      }
    }

    headers.set("content-length", String(total));
    return new Response(object.body, { status: 200, headers });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "read failed" }, 500);
  }
}

/**
 * Big files, in parts — because the edge won't take them whole.
 *
 * Cloudflare's zone plan caps a request body at 100MB, measured before this
 * Worker runs, and a thirty-second 4K phone clip is 120 to 200. The probe
 * that established this got a raw HTML 413 back with our code never invoked.
 * So the browser slices anything past the single-shot threshold into parts
 * that fit comfortably under the cap, and R2's own multipart machinery
 * reassembles them — each part streamed through this Worker the same way a
 * whole file is, so memory stays flat no matter the total.
 *
 * Every action re-verifies the session, and the object key is prefix-checked
 * against the verified user id, so an uploadId can't be replayed by anyone
 * who didn't start it.
 */
async function handleMultipart(request, env, url, user) {
  const action = url.searchParams.get("action");
  const owns = (key) => key.startsWith(`${user.id}/`);

  if (action === "create") {
    const listingId = url.searchParams.get("listing");
    const filename = url.searchParams.get("name") || "upload";
    const contentType = url.searchParams.get("type") || "application/octet-stream";
    if (!listingId) return json({ error: "no listing" }, 400);
    if (!contentType.startsWith("video/") && !contentType.startsWith("image/")) {
      return json({ error: "only photos and video" }, 415);
    }
    const key = mediaKey(user.id, listingId, filename);
    const upload = await env.MEDIA.createMultipartUpload(key, {
      httpMetadata: { contentType },
    });
    return json({ key, uploadId: upload.uploadId });
  }

  if (action === "part") {
    const key = url.searchParams.get("key") ?? "";
    const uploadId = url.searchParams.get("uploadId") ?? "";
    const partNumber = Number(url.searchParams.get("partNumber") ?? 0);
    if (!key || !uploadId || !partNumber) return json({ error: "bad part request" }, 400);
    if (!owns(key)) return json({ error: "not yours" }, 403);
    if (!request.body) return json({ error: "no bytes" }, 400);
    const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
    /*
     * Streamed like the single-shot path: at the front door the body still
     * carries its content-length, which is all R2 asks for. If the runtime
     * ever refuses the stream, the part is small enough (32MB by client
     * contract) that buffering it once is a safe fallback rather than the
     * isolate-killer buffering a whole video was.
     */
    let part;
    try {
      part = await upload.uploadPart(partNumber, request.body);
    } catch {
      const bytes = await request.arrayBuffer().catch(() => null);
      if (!bytes) return json({ error: "part upload failed" }, 500);
      part = await upload.uploadPart(partNumber, bytes);
    }
    return json({ partNumber: part.partNumber, etag: part.etag });
  }

  if (action === "complete" || action === "abort") {
    const body = await request.json().catch(() => null);
    if (!body?.key || !body?.uploadId) return json({ error: "bad request" }, 400);
    if (!owns(body.key)) return json({ error: "not yours" }, 403);
    const upload = env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);

    if (action === "abort") {
      // Abandoned parts sit invisibly and bill like stored objects; aborting
      // is the only thing that frees them.
      await upload.abort().catch(() => {});
      return json({ ok: true });
    }

    await upload.complete(
      [...(body.parts ?? [])].sort((a, b) => a.partNumber - b.partNumber)
    );
    // The row only after the object exists, written as the user so RLS
    // still governs it — same order, same reason as the single-shot path.
    const insert = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/user_listing_media`, {
      method: "POST",
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        authorization: `Bearer ${user.token}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: user.id,
        listing_id: body.listingId,
        path: body.key,
        kind: (body.contentType ?? "").startsWith("video/") ? "video" : "photo",
      }),
    });
    if (!insert.ok) {
      await env.MEDIA.delete(body.key).catch(() => {});
      return json({ error: (await insert.text()).slice(0, 200) || "could not save" }, 500);
    }
    return json({ path: body.key });
  }

  return json({ error: "unknown action" }, 400);
}

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

    // Verified against Supabase rather than merely decoded: an expired or
    // forged token has to fail here, not at the database.
    const user = await verifiedUser(request, env);
    if (!user) return json({ error: "session expired, reload and try again" }, 401);

    // Chunked transfers carry an `action`; whole files don't.
    if (url.searchParams.get("action")) return handleMultipart(request, env, url, user);

    const userId = user.id;
    const token = user.token;

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
