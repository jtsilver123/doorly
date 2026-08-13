import webpush from "web-push";
import { adminDb } from "@/lib/supabase";
import { appUrl } from "@/lib/site";
import { FIRST_HUNT } from "@/lib/hunts";
import type { Profile } from "@/lib/outreach";

/**
 * Telling people things while the app is closed.
 *
 * Three kinds, chosen for interrupt-worthiness rather than completeness —
 * a notification channel that reports everything is a channel that gets
 * muted in a week:
 *
 *   crew_add   someone put a place in your shared pipeline
 *   watched    a place you're actually pursuing changed under you
 *   good_drop  a price fell enough that a place became worth a look
 *
 * Each kind has its own preference, all defaulting on; the in-app bell
 * always gets every row, and the preference only gates the device push —
 * turning off pushes shouldn't make the app itself forget what happened.
 */

export type NotifyKind = "crew_add" | "watched" | "good_drop";

export interface NotifyPrefs {
  crewAdds: boolean;
  watched: boolean;
  goodDrops: boolean;
}

export const DEFAULT_NOTIFY: NotifyPrefs = {
  crewAdds: true,
  watched: true,
  goodDrops: true,
};

const PREF_KEY: Record<NotifyKind, keyof NotifyPrefs> = {
  crew_add: "crewAdds",
  watched: "watched",
  good_drop: "goodDrops",
};

export interface Notice {
  userId: string;
  kind: NotifyKind;
  listingId: string | null;
  title: string;
  body: string;
}

let vapidReady = false;

function vapid(): boolean {
  if (vapidReady) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:hello@damnlease.com",
    pub,
    priv
  );
  vapidReady = true;
  return true;
}

/**
 * Store the notices and push the ones each user asked to feel.
 *
 * Runs with the service role because it's called from the poll, where there
 * is no session. Push failures are expected traffic — a browser that revoked
 * permission returns 404/410, and that's the signal to drop its subscription
 * rather than an error to report.
 */
export async function deliver(notices: Notice[]): Promise<void> {
  if (!notices.length) return;
  const db = adminDb();

  const { error } = await db.from("notifications").insert(
    notices.map((n) => ({
      user_id: n.userId,
      kind: n.kind,
      listing_id: n.listingId,
      title: n.title.slice(0, 200),
      body: n.body.slice(0, 500),
    }))
  );
  if (error) return; // storage failed; don't push what we couldn't record

  if (!vapid()) return;

  const userIds = [...new Set(notices.map((n) => n.userId))];

  const [{ data: subs }, { data: profiles }] = await Promise.all([
    db.from("push_subscriptions").select("*").in("user_id", userIds),
    db.from("user_profile").select("user_id, profile").in("user_id", userIds),
  ]);
  if (!subs?.length) return;

  const prefsOf = new Map<string, NotifyPrefs>(
    (profiles ?? []).map((p) => [
      p.user_id as string,
      { ...DEFAULT_NOTIFY, ...((p.profile as Profile & { notify?: Partial<NotifyPrefs> })?.notify ?? {}) },
    ])
  );

  const dead: string[] = [];
  await Promise.all(
    notices.flatMap((notice) => {
      const prefs = prefsOf.get(notice.userId) ?? DEFAULT_NOTIFY;
      if (!prefs[PREF_KEY[notice.kind]]) return [];
      return (subs ?? [])
        .filter((s) => s.user_id === notice.userId)
        .map(async (s) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: s.endpoint,
                keys: { p256dh: s.p256dh, auth: s.auth },
              },
              JSON.stringify({
                title: notice.title,
                body: notice.body,
                url: notice.listingId
                  ? appUrl(`/app?place=${encodeURIComponent(notice.listingId)}`)
                  : appUrl("/app"),
              })
            );
          } catch (err) {
            const code = (err as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) dead.push(s.endpoint);
          }
        });
    })
  );

  if (dead.length) {
    await db.from("push_subscriptions").delete().in("endpoint", dead);
  }
}

const money = (n: number) => `$${n.toLocaleString()}`;

/**
 * Notices for a batch of poll events.
 *
 * `watched` goes to anyone pursuing the listing (pipeline or starred).
 * `good_drop` goes to every account with a pipeline row anywhere — the
 * audience that has an active hunt — when a drop is big enough to matter:
 * 3%+ or $100+. Small wobbles stay in the Changes tab where they belong.
 */
export async function noticesForEvents(
  events: {
    listing_id: string;
    kind: string;
    old_value?: string | null;
    new_value?: string | null;
  }[]
): Promise<Notice[]> {
  const interesting = events.filter((e) =>
    ["price_drop", "price_rise", "delisted", "back_on_market"].includes(e.kind)
  );
  if (!interesting.length) return [];

  const db = adminDb();
  const ids = [...new Set(interesting.map((e) => e.listing_id))];

  const [{ data: states }, { data: listings }, { data: hunters }, { data: openHunts }] =
    await Promise.all([
      db
        .from("user_listing_state")
        .select("user_id, listing_id, stage, starred, hunt_id")
        .in("listing_id", ids),
      db.from("listings").select("id, address, unit, neighborhood, price").in("id", ids),
      // Everyone with an active hunt, for good drops.
      db.from("user_listing_state").select("user_id, hunt_id"),
      db.from("hunts").select("id, owner_id").is("ended_at", null),
    ]);

  /*
   * A row on a hunt somebody has closed is a record, and pinging them about
   * a price move on it would be the app chasing a search that is over. The
   * live hunt is the one open row, or the nil UUID for anyone who has never
   * started a second — see lib/hunts.
   */
  const openBy = new Map(
    ((openHunts ?? []) as Record<string, unknown>[]).map((h) => [
      h.owner_id as string,
      h.id as string,
    ])
  );
  const live = (row: { user_id: unknown; hunt_id?: unknown }) =>
    (row.hunt_id as string) === (openBy.get(row.user_id as string) ?? FIRST_HUNT);

  const listingBy = new Map((listings ?? []).map((l) => [l.id as string, l]));
  const everyone = [
    ...new Set((hunters ?? []).filter(live).map((h) => h.user_id as string)),
  ];

  const watchers = new Map<string, string[]>();
  for (const s of states ?? []) {
    const pursuing =
      live(s) &&
      ((s.starred as boolean) ||
        !["inbox", "passed", "no_go"].includes(s.stage as string));
    if (!pursuing) continue;
    const list = watchers.get(s.listing_id as string) ?? [];
    list.push(s.user_id as string);
    watchers.set(s.listing_id as string, list);
  }

  const out: Notice[] = [];
  for (const e of interesting) {
    const listing = listingBy.get(e.listing_id);
    if (!listing) continue;
    const name = `${listing.address}${listing.unit ? ` #${listing.unit}` : ""}`;
    const from = Number(e.old_value);
    const to = Number(e.new_value);
    const hasMove = Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > 0;

    const title =
      e.kind === "price_drop"
        ? `Price drop — ${name}`
        : e.kind === "price_rise"
          ? `Price increase — ${name}`
          : e.kind === "delisted"
            ? `Off market — ${name}`
            : `Back on market — ${name}`;
    const body = hasMove
      ? `${money(from)} → ${money(to)} · ${listing.neighborhood ?? ""}`
      : (listing.neighborhood as string) ?? "";

    // The people pursuing it hear about every change.
    for (const userId of watchers.get(e.listing_id) ?? []) {
      out.push({ userId, kind: "watched", listingId: e.listing_id, title, body });
    }

    // A big enough drop is news even if nobody's on it yet.
    if (e.kind === "price_drop" && hasMove) {
      const meaningful = from - to >= 100 || (from - to) / from >= 0.03;
      if (meaningful) {
        const already = new Set(watchers.get(e.listing_id) ?? []);
        for (const userId of everyone) {
          if (already.has(userId)) continue;
          out.push({
            userId,
            kind: "good_drop",
            listingId: e.listing_id,
            title: `Worth a look — ${name}`,
            body: `Dropped ${money(from - to)} to ${money(to)} · ${listing.neighborhood ?? ""}`,
          });
        }
      }
    }
  }
  return out;
}
