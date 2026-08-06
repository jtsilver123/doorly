import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * How this app becomes a Cloudflare Worker.
 *
 * OpenNext is a build adapter, not a framework: the App Router, the server
 * components, the route handlers and `src/proxy.ts` all stay exactly as they
 * are, and this compiles them into a Worker. That's the whole reason to take
 * this route over "rewrite it Cloudflare-native" — a rewrite would mean
 * rebuilding thirty route handlers and every server component by hand, in the
 * middle of a live apartment hunt, to arrive at the same behaviour.
 *
 * No incremental cache is configured: this app renders everything
 * force-dynamic (prices and availability go stale in hours, so caching them
 * is a bug, not a win), which means there's nothing for a cache layer to do.
 */
export default defineCloudflareConfig({});
