import type { FeedListing } from "@/types";

/**
 * What your own numbers say about how you're hunting.
 *
 * The pace meter answers "am I doing enough"; this answers "is what I'm
 * doing working". Each hand-off in the funnel — saved to contacted,
 * contacted to replied, replied to toured, toured to applied — is a rate,
 * and a rate that's off points at a specific habit: hoarding listings
 * without texting, touring everything instead of filtering on the posting,
 * applying to nothing because no place survives your own visits.
 *
 * The advice engine is thresholds over those rates, and it deliberately
 * shuts up when the sample is small. Three data points make a mood, not a
 * pattern, and being lectured on conversion after one tour would be
 * insufferable.
 */

export interface FunnelSteps {
  /** In the pipeline at all: starred or past inbox. */
  saved: number;
  /** Outreach sent, by logged message or by dragging the card. */
  contacted: number;
  replied: number;
  /** Actually stood in the place (or a tour time now in the past). */
  toured: number;
  applied: number;
  /** Approved by the landlord but not yet taken: a yes waiting on yours. */
  approved: number;
  /** Signed and taken, the flag the hunt exists to set. */
  won: number;
}

export interface Insight {
  key: string;
  tone: "win" | "push" | "calm";
  title: string;
  body: string;
}

export interface HuntInsights {
  steps: FunnelSteps;
  /** Rate of each step against the one before it; null until the base exists. */
  rates: {
    contactRate: number | null;
    replyRate: number | null;
    tourRate: number | null;
    applyRate: number | null;
  };
  insights: Insight[];
}

const AFTER_CONTACT = ["contacted", "tour", "toured", "applied", "closed", "no_go"];
const TOURED = ["toured", "applied", "closed", "no_go"];
const APPLIED = ["applied", "closed"];

export function countSteps(listings: FeedListing[], now = new Date()): FunnelSteps {
  const tracked = listings.filter(
    (l) => l.starred || (l.stage !== "inbox" && l.stage !== "passed")
  );
  const ids = (rows: FeedListing[]) => new Set(rows.map((l) => l.id));

  const applied = ids(tracked.filter((l) => APPLIED.includes(l.stage) || l.appResult !== 0));
  const toured = ids(
    tracked.filter(
      (l) =>
        TOURED.includes(l.stage) ||
        (l.stage === "tour" && l.tourAt != null && new Date(l.tourAt) < now)
    )
  );
  // Same read as the pace meter: an explicit inbound, or a card that moved
  // past Contacted after an outreach — tours don't get booked by silence.
  const replied = ids(
    tracked.filter(
      (l) =>
        l.hasReply ||
        (l.lastContactChannel != null && !["inbox", "interested", "contacted"].includes(l.stage))
    )
  );
  const contacted = ids(
    tracked.filter(
      (l) => l.contactCount > 0 || l.lastContactAt != null || AFTER_CONTACT.includes(l.stage)
    )
  );

  /*
   * Reaching a step means passing through every step before it, logged or
   * not: nobody tours a place that never answered, even when the reply
   * lived on their own phone. Folding each step into the ones above keeps
   * every rate at or under 100%, where funnels live.
   */
  for (const id of applied) toured.add(id);
  for (const id of toured) replied.add(id);
  for (const id of replied) contacted.add(id);

  /*
   * An approval is the landlord's yes; signed is yours. Only `secured`
   * counts as won — calling a place signed while the person is still
   * deciding overstates the hunt and understates the decision in front
   * of them.
   */
  const approved = tracked.filter((l) => l.appResult === 1 && !l.secured);
  const won = tracked.filter((l) => l.secured);
  return {
    saved: tracked.length,
    contacted: contacted.size,
    replied: replied.size,
    toured: toured.size,
    applied: applied.size,
    approved: approved.length,
    won: won.length,
  };
}

const pct = (part: number, whole: number): number | null =>
  whole > 0 ? part / whole : null;

export function readHunt(listings: FeedListing[], now = new Date()): HuntInsights {
  const steps = countSteps(listings, now);
  const rates = {
    contactRate: pct(steps.contacted, steps.saved),
    replyRate: pct(steps.replied, steps.contacted),
    tourRate: pct(steps.toured, steps.replied),
    applyRate: pct(steps.applied, steps.toured),
  };

  const insights: Insight[] = [];

  if (steps.won > 0) {
    insights.push({
      key: "won",
      tone: "win",
      title: "You landed one",
      body: `${steps.contacted} reached out, ${steps.toured} toured, ${steps.applied} applied, one signed. That's the whole funnel doing its job.`,
    });
  } else if (steps.approved > 0) {
    // The most time-sensitive state on the board: their yes is in, and
    // it only holds until a better application shows up behind yours.
    insights.push({
      key: "approved",
      tone: "win",
      title: "They said yes",
      body: `You're approved on ${steps.approved === 1 ? "a place" : `${steps.approved} places`}. An approval is not a lease: it holds only until the next application looks better. Decide while it's still yours to decide, then mark it taken here.`,
    });
  }

  /*
   * Ordered by how early in the funnel the leak is: a leak upstream starves
   * every stage after it, so it's always the first thing worth fixing.
   */
  if (rates.contactRate != null && steps.saved >= 8 && rates.contactRate < 0.4) {
    insights.push({
      key: "hoarding",
      tone: "push",
      title: "Saving more than you're chasing",
      body: `You've saved ${steps.saved} places but reached out on ${steps.contacted}. A saved place isn't in play until somebody knows you want it, and the first message is already written on every card. Send it the day you save.`,
    });
  }
  if (rates.replyRate != null && steps.contacted >= 8 && rates.replyRate < 0.25) {
    insights.push({
      key: "quiet",
      tone: "push",
      title: "Outreach isn't landing",
      body: `${steps.replied} of ${steps.contacted} messages got an answer. Two days of silence earns a nudge, and Chase all on the Contacted column drafts those for you. Text beats email here, and short beats thorough.`,
    });
  }
  if (rates.tourRate != null && steps.replied >= 5 && rates.tourRate < 0.4) {
    insights.push({
      key: "stalling",
      tone: "push",
      title: "Replies aren't turning into viewings",
      body: `Agents answer and then the thread goes quiet: ${steps.toured} tours from ${steps.replied} replies. Offer two concrete times instead of asking what works. Specific gets booked, polite gets queued.`,
    });
  }
  if (rates.applyRate != null && steps.toured >= 4 && rates.applyRate < 0.34) {
    insights.push({
      key: "sightseeing",
      tone: "push",
      title: "Touring a lot, applying to little",
      body: `${steps.toured} tours have produced ${steps.applied} application${steps.applied === 1 ? "" : "s"}. A tour costs an evening, and most of what kills a place in person was already in the posting. Read the cons and the building's record before booking, and ask for a video walkthrough first: a place that fails on camera costs you nothing.`,
    });
  }
  if (
    steps.won === 0 &&
    steps.approved === 0 &&
    rates.applyRate != null &&
    steps.applied >= 3 &&
    rates.applyRate >= 0.7
  ) {
    insights.push({
      key: "losing",
      tone: "push",
      title: "Applying plenty, no yes yet",
      body: `${steps.applied} applications in and nothing signed. In this market that's usually speed or paperwork: apply the same day you tour, and keep the packet complete so nothing stalls on a missing document.`,
    });
  }

  if (insights.length === 0) {
    insights.push(
      steps.saved < 3
        ? {
            key: "early",
            tone: "calm",
            title: "Too early to read",
            body: "Conversion rates need a few places in play before they mean anything. Save what looks right, text them the same day, and this page starts earning its keep.",
          }
        : {
            key: "healthy",
            tone: "calm",
            title: "The funnel looks healthy",
            body: "No stage is leaking more than the market takes from everyone. Keep the pace up and let the numbers keep score.",
          }
    );
  }

  // Two at most: the earliest leak plus one, not a wall of homework.
  return { steps, rates, insights: insights.slice(0, 2) };
}
