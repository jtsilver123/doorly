import type { FeedListing, Stage } from "@/types";
import { bestChannel, reachableOn } from "@/lib/outreach";

/**
 * What to offer, given where a listing actually is.
 *
 * Every card and every panel used to show "Request a tour", including on
 * places with a tour already booked and places you'd applied to. A button that
 * proposes something you've already done is worse than no button: it makes you
 * check whether the app has lost track of you.
 *
 * One source of truth for the whole app, so the card, the panel and the
 * pipeline can never disagree about what comes next.
 */

export type ActionKind =
  | "reach"       // ask for a viewing
  | "chase"       // asked, heard nothing
  | "schedule"    // they said yes, no time set
  | "tour"        // time set, go
  | "decide"      // seen it
  | "apply"       // decided
  | "wait"        // application in
  | "done"        // signed, or over
  | "add-contact"; // nothing to reach them on

export interface NextAction {
  kind: ActionKind;
  /** The button. Short enough for a card footer. */
  label: string;
  /** One line under it, when there's room. */
  hint: string;
  /** Advances to this stage when taken, if it advances at all. */
  becomes?: Stage;
  /** Overdue, or the tour is today. Renders warm. */
  urgent?: boolean;
}

const DAY = 86_400_000;

/**
 * A day the way people say it: "Today", "Tomorrow", then the weekday
 * while that's unambiguous, then a date. Shared by every surface that
 * names a future day, so the board, the panel and the footer can never
 * disagree about what to call Wednesday.
 */
export function dayWord(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(at) - midnight(now)) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return at.toLocaleDateString("en-US", { weekday: "short" });
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Human time for a booked viewing: "Today 3:00 PM", "Tomorrow 11:30 AM". */
export function tourWhen(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dayWord(iso)} ${time}`;
}

export function nextAction(listing: FeedListing): NextAction {
  const { phone, email } = reachableOn(listing);
  const reachable = Boolean(phone || email);

  switch (listing.stage) {
    case "tour": {
      // A booked tour with no time is a label, not a plan — and the thing you
      // need is a time, not another message.
      if (!listing.tourAt) {
        return {
          kind: "schedule",
          label: "Set the time",
          hint: "They said yes — pin down when, so it shows up in your day",
          urgent: true,
        };
      }
      const openHouse = listing.tourKind === "open_house";
      // An open house isn't over until its window closes — arriving after the
      // start time is entirely the point of a window.
      const overAt = new Date(
        (openHouse && listing.tourEndsAt) || listing.tourAt
      ).getTime();
      const soon = new Date(listing.tourAt).getTime() - Date.now();
      const passed = overAt - Date.now() < 0;
      return {
        kind: "tour",
        label: openHouse
          ? `Open house ${tourWhen(listing.tourAt)}`
          : tourWhen(listing.tourAt),
        hint: passed
          ? openHouse
            ? "The window's closed — did you make it?"
            : "Tour has passed — how was it?"
          : openHouse
            ? `Show up any time${listing.tourEndsAt ? ` until ${tourWhen(listing.tourEndsAt)}` : ""} — no appointment needed`
            : "Viewing booked",
        becomes: passed ? "toured" : undefined,
        urgent: soon < DAY,
      };
    }

    case "contacted":
      // They answered: the thread is live, and the only move that converts a
      // live thread is a booked viewing.
      if (listing.hasReply) {
        return {
          kind: "schedule",
          label: "Book the viewing",
          hint: "They replied — lock a time while it's warm",
          becomes: "tour",
          urgent: true,
        };
      }
      return listing.needsFollowUp
        ? {
            kind: "chase",
            label: "Chase them",
            hint: "Contacted 2+ days ago with no reply",
            urgent: true,
          }
        : { kind: "wait", label: "Waiting on reply", hint: "You've reached out" };

    case "toured": {
      /*
       * "Still deciding" is a commitment with an expiry, not a parking
       * spot. While the check-back day holds, the card waits quietly with
       * the reason on it; the moment it passes, deciding becomes the next
       * action and renders warm — an apartment doesn't wait for you to
       * finish thinking.
       */
      if (listing.followUpAt) {
        const at = new Date(listing.followUpAt);
        const overdue = at.getTime() <= Date.now();
        if (!overdue) {
          return {
            kind: "wait",
            label: "Deciding",
            hint:
              listing.followUpNote ||
              `You gave yourself until ${dayWord(listing.followUpAt).toLowerCase()}`,
          };
        }
        return {
          kind: "decide",
          label: "Decide on this one",
          hint: listing.followUpNote
            ? `You were waiting on: ${listing.followUpNote}`
            : "Your check-back day has passed. Yes or no",
          urgent: true,
        };
      }
      return {
        kind: "apply",
        label: "Apply for it",
        hint: "You've seen it — the first complete application usually wins",
        becomes: "applied",
      };
    }

    case "applied":
      return { kind: "wait", label: "Application in", hint: "Waiting on the landlord" };

    case "closed":
      return { kind: "done", label: "Closed", hint: "Nothing left to do here" };

    case "no_go":
      // You saw it and said no. Offering outreach here would propose
      // re-courting a place you've already declined.
      return {
        kind: "done",
        label: "Not for you",
        hint: listing.passReason || "You toured it and passed",
      };

    default:
      // inbox, interested, passed — nothing has happened yet.
      if (!reachable) {
        return {
          kind: "add-contact",
          label: "Add a number",
          hint: "Nothing published — paste one in and you can text them straight from here",
        };
      }
      // A for-sale place isn't toured into renting — it's pitched into it.
      if (listing.forSale) {
        return {
          kind: "reach",
          label: "Pitch renting it",
          hint: "They're selling — ask if the owner would rent it to you instead",
          becomes: "contacted",
        };
      }
      return {
        kind: "reach",
        label: bestChannel(listing).label,
        hint: bestChannel(listing).hint,
        becomes: "contacted",
      };
  }
}
