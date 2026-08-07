import { currentUser } from "@/lib/supabase/server";
import App from "@/components/App";

/**
 * The app itself, at its own address.
 *
 * The root is the marketing site for everyone now — the split every product
 * eventually makes, because "the landing page" and "where I work" are
 * different places you link people to. Without a custom domain this is a
 * path rather than an app. subdomain; the shape is the same and the session
 * cookie carries over for free.
 */
export const dynamic = "force-dynamic";

export default async function AppPage() {
  /*
   * The auth gate lives in middleware, which sees every address this shell
   * answers to — /app and the rewritten /pipeline, /listings, /compare,
   * /you. The page used to double-check and redirect on its own, but under
   * a config rewrite the worker hands this component a request whose
   * cookies don't survive the hop, so the second check called every
   * signed-in visitor signed-out and bounced them to /login. One gate, at
   * the door that actually sees the request.
   */
  await currentUser().catch(() => null);
  return <App />;
}
