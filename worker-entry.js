/**
 * The Worker, plus its heartbeat.
 *
 * OpenNext generates `.open-next/worker.js` fresh on every build, so it can't
 * be edited — this wraps it instead: the app's own `fetch` passes through
 * untouched, and a `scheduled` handler is added so the hourly poll lives on
 * the same Worker as the app rather than a second one that has to be kept in
 * sync (same secret, same URL, two places to forget).
 *
 * The tick deliberately makes a real HTTPS request to the app's public
 * endpoint instead of calling the handler in-process. Calling through would
 * run the entire poll — hundreds of listings, deduped and scored — inside the
 * scheduled invocation's own CPU budget. Going out and back in gives the poll
 * a fresh request context with its own budget, which is exactly how it
 * behaved when the schedule was a separate Worker. `global_fetch_strictly_public`
 * (see wrangler.jsonc) is what stops a Worker calling its own zone from
 * getting Cloudflare error 1042 instead of a response.
 *
 * One route is answered here rather than passed through: tour-footage uploads
 * stream into R2 straight off the socket, which is only possible while the
 * request is still the runtime's native one. See upload-handler.js for why
 * that matters — in short, going through Next forced the whole file into a
 * Worker's 128MB of memory and took the isolate down with it.
 *
 * The durable-object classes are re-exported because Wrangler resolves them
 * from the entry point, and OpenNext's caching machinery declares them.
 */
import worker from "./.open-next/worker.js";
import { handleUpload, handleMediaGet } from "./upload-handler.js";

export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from "./.open-next/worker.js";

export default {
  async fetch(request, env, ctx) {
    // Uploads and media reads both move bulk bytes, and both are answered
    // here — before Next — where the body is still the runtime's own stream.
    // See upload-handler.js for why that matters twice over. DELETE falls
    // through to the app, where the row-then-object dance lives.
    const handled =
      (await handleUpload(request, env)) ?? (await handleMediaGet(request, env));
    return handled ?? worker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    const base = env.NEXT_PUBLIC_SITE_URL || "https://damnlease.com";
    ctx.waitUntil(
      (async () => {
        try {
          const res = await fetch(`${base}/api/cron/poll`, {
            headers: { authorization: `Bearer ${env.CRON_SECRET}` },
            signal: AbortSignal.timeout(280_000),
          });
          console.log(`poll ${res.status}: ${(await res.text()).slice(0, 300)}`);
        } catch (err) {
          console.error("poll failed:", err instanceof Error ? err.message : String(err));
        }
      })()
    );
  },
};
