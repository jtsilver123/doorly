/**
 * The heartbeat.
 *
 * All this does is knock on the app's own poll endpoint once an hour with the
 * shared secret. Every decision — whose key pays, who is due, what gets
 * fetched — stays in the app where it is tested; moving the *schedule* here
 * simply buys a schedule Vercel's Hobby plan won't sell (one cron a day).
 *
 * Deliberately not a rewrite of the poller: a worker that duplicated that
 * logic would be a second implementation to keep honest, and the first one to
 * drift.
 */
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },

  /**
   * The same job on demand, for testing and for "check now" from outside the
   * app. Requires the same secret, so it isn't a free way to spend everyone's
   * API budget.
   */
  async fetch(request, env) {
    const provided = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    const result = await run(env);
    return Response.json(result);
  },
};

async function run(env) {
  const started = Date.now();
  try {
    const res = await fetch(env.POLL_URL, {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      // The poll walks every user and can take minutes; Workers only charge
      // CPU time, so waiting on it is free.
      signal: AbortSignal.timeout(280_000),
    });
    const body = await res.text();
    const ms = Date.now() - started;
    // Logged to `wrangler tail` — the run log lives in the database anyway.
    console.log(`poll ${res.status} in ${ms}ms: ${body.slice(0, 400)}`);
    return { ok: res.ok, status: res.status, ms };
  } catch (err) {
    console.error("poll failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: String(err) };
  }
}
