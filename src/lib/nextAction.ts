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

/** Human time for a booked viewing: "Today 3:00 PM", "Thu 11:30 AM". */
export function tourWhen(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const days = Math.floor((at.getTime() - Date.now()) / DAY);
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sameDay = new Date().toDateString() === at.toDateString();
  if (sameDay) return `Today ${time}`;
  if (days >= 0 && days < 6) {
    return `${at.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  }
  return `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
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
      const soon = new Date(listing.tourAt).getTime() - Date.now();
      return {
        kind: "tour",
        label: tourWhen(listing.tourAt),
        hint: soon < 0 ? "Tour has passed — how was it?" : "Viewing booked",
        becomes: soon < 0 ? "toured" : undefined,
        urgent: soon < DAY,
      };
    }

    case "contacted":
      return listing.needsFollowUp
        ? {
            kind: "chase",
            label: "Chase them",
            hint: "Contacted 2+ days ago with no reply",
            urgent: true,
          }
        : { kind: "wait", label: "Waiting on reply", hint: "You've reached out" };

    case "toured":
      return {
        kind: "apply",
        label: "Apply for it",
        hint: "You've seen it — the first complete application usually wins",
        becomes: "applied",
      };

    case "applied":
      return { kind: "wait", label: "Application in", hint: "Waiting on the landlord" };

    case "closed":
      return { kind: "done", label: "Closed", hint: "Nothing left to do here" };

    default:
      // inbox, interested, passed — nothing has happened yet.
      if (!reachable) {
        return {
          kind: "add-contact",
          label: "Add a number",
          hint: "Nothing published — paste one in and you can text them straight from here",
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
