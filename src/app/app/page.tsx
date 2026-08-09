import type { Metadata } from "next";
import { currentUser } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase";
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

/**
 * The unfurl card for a shared place.
 *
 * A share lands in a text thread, and the thread renders whatever the URL's
 * tags say — which used to be the generic marketing card, so "look at this
 * one" arrived wearing the logo instead of the apartment. When the address
 * carries ?place=, the card becomes the place itself: its photo, its rent,
 * its neighborhood. That's corpus data, already public through the guest
 * shell this same URL opens, so the service-role read leaks nothing the
 * page wouldn't show.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ place?: string }>;
}): Promise<Metadata> {
  const { place } = await searchParams;
  if (!place) return {};
  try {
    const { data: row } = await adminDb()
      .from("listings")
      .select("address, unit, neighborhood, borough, price, bedrooms, bathrooms, image_url, images")
      .eq("id", place)
      .maybeSingle();
    if (!row) return {};

    const title = `${row.address}${row.unit ? ` #${row.unit}` : ""}`;
    const beds = row.bedrooms === 0 ? "Studio" : `${row.bedrooms} bed`;
    const where = row.neighborhood || row.borough || "NYC";
    const description = `$${Number(row.price).toLocaleString()}/mo · ${beds} · ${where}. Shared from a DamnLease apartment hunt.`;
    const image: string | null = row.images?.[0] ?? row.image_url ?? null;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        siteName: "DamnLease",
        type: "website",
        ...(image ? { images: [{ url: image, alt: title }] } : {}),
      },
      twitter: {
        card: image ? "summary_large_image" : "summary",
        title,
        description,
        ...(image ? { images: [image] } : {}),
      },
    };
  } catch {
    // A bad or stale id shares the app's own card rather than erroring.
    return {};
  }
}

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
