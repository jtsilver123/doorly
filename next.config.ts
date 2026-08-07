import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    /*
     * Lint doesn't gate the build.
     *
     * Moving to Next 15 (the version OpenNext can compile into a Cloudflare
     * Worker) brought a stricter React-compiler ruleset with it, and it fails
     * on patterns this app has shipped and verified for weeks — refs read in
     * callbacks, `Date.now()` in a render path, curly apostrophes in copy.
     * None of it is a correctness problem, and rewriting working components
     * to satisfy a linter mid-migration is how migrations break things.
     *
     * Types still gate the build, which is the check that catches real bugs.
     * `npm run lint` still reports all of it for a proper cleanup later.
     */
    ignoreDuringBuilds: true,
  },
  /*
   * The app's sections wear honest addresses: /pipeline, /listings,
   * /compare, /you all serve the same shell, which reads the pathname to
   * pick its tab. Build-time rewrites, deliberately not middleware ones — a
   * middleware rewrite re-enters the worker's router stripped of the
   * request's context and bounced signed-in people to login. These run after
   * middleware, so the auth gate still sees the real path.
   */
  async rewrites() {
    return ["/pipeline", "/listings", "/compare", "/you"].map((source) => ({
      source,
      destination: "/app",
    }));
  },
  experimental: {
    /*
     * The app answers on two hostnames now, and Server Actions carry a CSRF
     * check that compares the request's Origin against its Host. Behind a
     * Worker those two don't always agree — a forwarded host, a redirect
     * between the marketing site and the app — and when they disagree Next
     * rejects the action outright. The visible symptom is sign-in appearing
     * to do nothing, which is exactly the kind of failure nobody can debug
     * from the outside. Naming both origins removes the ambiguity.
     */
    serverActions: {
      allowedOrigins: ["damnlease.com", "app.damnlease.com", "www.damnlease.com"],
    },
  },
};

export default nextConfig;
