import { redirect } from "next/navigation";
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
  const user = await currentUser();
  if (!user) redirect("/login");
  return <App />;
}
