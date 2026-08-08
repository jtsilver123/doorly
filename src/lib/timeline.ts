import type { FeedListing } from "@/types";

/**
 * The New York clock.
 *
 * This search is not open-ended browsing — it's a four-week sprint with a hard
 * date at the end, and the phases are set by how the city works rather than by
 * preference. New York requires 30 days' notice, so landlords list about 30
 * days before a unit is free: the inventory for 1 September appears across
 * early-to-mid August and is largely gone by the third week. Good units rent in
 * days, and viewings convert to applications the same afternoon.
 *
 * That makes *when you are* as important as what's available, because the right
 * action changes completely: browsing in week one, viewing hard in week two,
 * committing in week three, compromising in week four. A listing feed can't
 * tell you that. The timeline can.
 */

/**
 * When this listing last moved: the most recent of listed, price change and
 * relist. "How stale is this ad" is a question every card gets asked.
 */
export function lastChangeOf(l: {
  firstSeenAt: string;
  priceChangedAt: string | null;
  relistedAt: string | null;
}): { at: string; kind: "listed" | "price change" | "relisted" } {
  const candidates: { at: string; kind: "listed" | "price change" | "relisted" }[] = [
    { at: l.firstSeenAt, kind: "listed" },
  ];
  if (l.priceChangedAt) candidates.push({ at: l.priceChangedAt, kind: "price change" });
  if (l.relistedAt) candidates.push({ at: l.relistedAt, kind: "relisted" });
  return candidates.sort((a, b) => b.at.localeCompare(a.at))[0];
}

export type Phase = "early" | "prime" | "decide" | "crunch" | "final" | "past";

export interface PhaseInfo {
  phase: Phase;
  label: string;
  /** What to actually do right now. */
  advice: string;
  /** 0–1 position along the whole hunt, for the progress bar. */
  progress: number;
  daysLeft: number;
}

/** Where each phase starts, in days before move-in. */
const PHASE_STARTS: { phase: Phase; from: number; label: string; advice: string }[] = [
  {
    phase: "early",
    from: 45,
    label: "Scouting",
    advice:
      "Most listings up now are for earlier move-ins. Use this week to learn what your money buys and tune your search. Don't burn outreach on units that'll be gone.",
  },
  {
    phase: "prime",
    from: 25,
    label: "Prime window",
    advice:
      "Your inventory is listing right now. This is the widest choice you'll get. Book viewings aggressively; a place seen today can still be yours.",
  },
  {
    phase: "decide",
    from: 12,
    label: "Decide",
    advice:
      "The best units from this batch are going. Apply to anything you'd genuinely take. Hesitating a day is how people lose apartments here.",
  },
  {
    phase: "crunch",
    from: 4,
    label: "Crunch",
    advice:
      "Thin pickings. Widen the price ceiling or the neighborhoods, and consider a place that needs a week of overlap rent.",
  },
  {
    phase: "final",
    from: 0,
    label: "Final days",
    advice:
      "Take the best available option. A short-term sublet to bridge a few weeks beats signing somewhere you'll regret for a year.",
  },
];

/** Hunts realistically start about six weeks out; that's the bar's left edge. */
export const HUNT_LENGTH_DAYS = 45;

export function phaseFor(daysLeft: number): PhaseInfo {
  if (daysLeft < 0) {
    return {
      phase: "past",
      label: "Past your date",
      advice: "Your move-in date has passed. Update it under My details.",
      progress: 1,
      daysLeft,
    };
  }

  const match =
    PHASE_STARTS.find((p) => daysLeft >= p.from) ?? PHASE_STARTS[PHASE_STARTS.length - 1];

  const elapsed = HUNT_LENGTH_DAYS - Math.min(daysLeft, HUNT_LENGTH_DAYS);
  return {
    phase: match.phase,
    label: match.label,
    advice: match.advice,
    progress: Math.max(0, Math.min(1, elapsed / HUNT_LENGTH_DAYS)),
    daysLeft,
  };
}

/** Phase bands for drawing the bar, as fractions of the whole hunt. */
export function phaseBands(): { phase: Phase; label: string; width: number }[] {
  const edges = [HUNT_LENGTH_DAYS, 25, 12, 4, 0];
  const bands: { phase: Phase; label: string; width: number }[] = [];
  for (let i = 0; i < PHASE_STARTS.length; i++) {
    const start = edges[i];
    const end = edges[i + 1] ?? 0;
    bands.push({
      phase: PHASE_STARTS[i].phase,
      label: PHASE_STARTS[i].label,
      width: (start - end) / HUNT_LENGTH_DAYS,
    });
  }
  return bands;
}

/**
 * Are you contacting enough places to actually land one?
 *
 * The hunt is a funnel, and the failure mode is being too selective early: it
 * feels productive to shortlist and slow to email, and then week three arrives
 * with three replies and nothing booked. These are planning rules of thumb, not
 * measurements — but once you've sent enough messages to have a real reply
 * rate, your own numbers replace them, so the target self-corrects.
 */
export interface FunnelAssumptions {
  replyRate: number;      // contacted -> replied
  viewingRate: number;    // replied -> viewed
  applyRate: number;      // viewed -> applied
  successRate: number;    // applied -> signed
}

export const DEFAULT_FUNNEL: FunnelAssumptions = {
  replyRate: 0.45,
  viewingRate: 0.6,
  applyRate: 0.3,
  successRate: 0.6,
};

export interface Funnel {
  contacted: number;
  replied: number;
  viewed: number;
  applied: number;
  /** Outreach needed to land one lease, given the rates in play. */
  targetContacts: number;
  /** How many you should have sent by now to be on pace. */
  expectedByNow: number;
  onPace: boolean;
  /** True once there's enough data to use your own rates. */
  usingOwnRates: boolean;
}

export function funnelFor(
  listings: FeedListing[],
  daysLeft: number,
  assumptions: FunnelAssumptions = DEFAULT_FUNNEL
): Funnel {
  /*
   * Contacted is a claim the user can make two ways: by sending a message
   * through the app (a logged contact) or by dragging the card into the
   * Contacted column after texting from their own phone. Counting only the
   * log made the pace meter ignore the drag — "11 contacted" sat still
   * while the column grew, which read as broken because it was.
   */
  const reachedStages = ["contacted", "tour", "toured", "applied", "closed", "no_go"];
  const contacted = listings.filter(
    (l) => l.contactCount > 0 || reachedStages.includes(l.stage)
  ).length;
  // A reply is either logged inbound, or implied by the card moving past
  // Contacted after an outreach — nobody books a tour with a broker who
  // never answered.
  const replied = listings.filter(
    (l) =>
      l.hasReply ||
      (l.lastContactChannel != null && l.stage !== "contacted" && l.stage !== "inbox")
  ).length;
  const viewed = listings.filter((l) =>
    ["toured", "applied", "closed"].includes(l.stage)
  ).length;
  const applied = listings.filter((l) => ["applied", "closed"].includes(l.stage)).length;

  // Ten replies in is enough to trust your own rate over a generic one.
  const usingOwnRates = contacted >= 10;
  const rates: FunnelAssumptions = usingOwnRates
    ? { ...assumptions, replyRate: Math.max(0.05, replied / contacted) }
    : assumptions;

  const perLease =
    rates.replyRate * rates.viewingRate * rates.applyRate * rates.successRate;
  const targetContacts = Math.max(1, Math.ceil(1 / Math.max(perLease, 0.001)));

  // Outreach should be front-loaded: the inventory is here now, and a message
  // sent in the final week has no time left to convert.
  const elapsed = Math.max(0, HUNT_LENGTH_DAYS - Math.max(daysLeft, 0));
  const throughHunt = Math.min(1, elapsed / (HUNT_LENGTH_DAYS - 7));
  const expectedByNow = Math.ceil(targetContacts * throughHunt);

  return {
    contacted,
    replied,
    viewed,
    applied,
    targetContacts,
    expectedByNow,
    onPace: contacted >= expectedByNow,
    usingOwnRates,
  };
}

/**
 * The day's work, in priority order.
 *
 * A feed of 324 listings is a browsing tool. What actually gets you an
 * apartment is a short list of things to do before tonight, so this collapses
 * the whole database into that.
 */
export interface Action {
  key: string;
  title: string;
  detail: string;
  count: number;
  tone: "urgent" | "normal" | "good";
  /** Filter the feed should apply when this is clicked. */
  filter?: "followUp" | "new" | "starred" | "tour";
}

export function todaysActions(
  listings: FeedListing[],
  funnel: Funnel,
  info: PhaseInfo
): Action[] {
  const actions: Action[] = [];

  const chase = listings.filter((l) => l.needsFollowUp).length;
  if (chase > 0) {
    actions.push({
      key: "followUp",
      title: `Chase ${chase} silent ${chase === 1 ? "lead" : "leads"}`,
      detail: "Contacted 2+ days ago with no reply. One nudge usually does it.",
      count: chase,
      tone: "urgent",
      filter: "followUp",
    });
  }

  const tours = listings.filter((l) => l.stage === "tour").length;
  if (tours > 0) {
    actions.push({
      key: "tour",
      title: `${tours} ${tours === 1 ? "viewing" : "viewings"} booked`,
      detail: "Confirm the time the morning of. No-shows are common.",
      count: tours,
      tone: "good",
      filter: "tour",
    });
  }

  const fresh = listings.filter((l) => l.stage === "inbox" && l.daysOnMarket <= 2).length;
  if (fresh > 0) {
    actions.push({
      key: "new",
      title: `${fresh} new since yesterday`,
      detail:
        info.phase === "prime"
          ? "Peak window. Reach out to anything you'd live in."
          : "Triage these first; the newest listings get taken fastest.",
      count: fresh,
      tone: info.phase === "prime" ? "urgent" : "normal",
      filter: "new",
    });
  }

  if (!funnel.onPace && info.phase !== "early" && info.phase !== "past") {
    const behind = funnel.expectedByNow - funnel.contacted;
    actions.push({
      key: "pace",
      title: `Reach out to ${behind} more ${behind === 1 ? "place" : "places"}`,
      detail: `You've contacted ${funnel.contacted}. At your rate, landing one by your date takes about ${funnel.targetContacts}.`,
      count: behind,
      tone: "urgent",
    });
  }

  return actions;
}
