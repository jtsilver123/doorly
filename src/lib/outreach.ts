import type { ContactChannel, FeedListing, Source } from "@/types";
import { DEFAULT_PREFERRED_SOURCE } from "@/types";
import { DEFAULT_COSTS, type CostAssumptions } from "@/lib/cost";

/**
 * Drafting the "can I see this today?" text.
 *
 * In a market this fast the bottleneck is how quickly you get a viewing, so the
 * goal is one tap from seeing a listing to a filled-in Messages window. The
 * draft leads with the address (agents juggle dozens), states the qualifying
 * facts unprompted, and asks for a specific next step.
 */

/** How you earn, which decides how the qualification line has to be written. */
export type Employment = "self_employed" | "employed" | "other";

export interface Profile {
  name: string;
  /** Business name if self-employed, employer otherwise. */
  employer: string;
  employment: Employment;
  /** Optional. Business owners who take no salary should leave this blank. */
  income: string;
  /** What you can show *instead of* (or alongside) a paystub. */
  proofs: string[];
  /** ISO date, e.g. "2026-09-01". */
  moveInDate: string;
  creditNote: string;
  phone: string;
  email: string;
  extra: string;
  /** Which documents you actually have to hand, for the application packet. */
  documents: string[];
  /** What you assume it costs to move in. Tunable — the rules vary. */
  costs: CostAssumptions;
  /**
   * Which listing site to open when the same apartment is on several. Personal
   * enough to be worth asking rather than assuming.
   */
  preferredSource: Source;
}

/** The documents a NYC landlord actually asks for. */
export const PROOF_OPTIONS = [
  "2025 tax return",
  "proof of assets",
  "business revenue",
  "bank statements",
  "recent paystubs",
  "employment letter",
  "landlord reference",
  "guarantor available",
];

export const DEFAULT_PROFILE: Profile = {
  name: "",
  employer: "",
  employment: "self_employed",
  income: "",
  proofs: ["2025 tax return", "proof of assets", "business revenue"],
  moveInDate: "2026-09-01",
  creditNote: "",
  phone: "",
  email: "",
  extra: "",
  documents: [],
  costs: DEFAULT_COSTS,
  preferredSource: DEFAULT_PREFERRED_SOURCE,
};

function formatMoveIn(iso: string): string {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function listingLabel(listing: FeedListing): string {
  const unit = listing.unit ? ` #${listing.unit}` : "";
  const where = listing.neighborhood ? ` in ${listing.neighborhood}` : "";
  return `${listing.address}${unit}${where}`;
}

/**
 * The message body. Kept to a few sentences on purpose — long texts from
 * strangers get ignored, and every clause here answers a question the agent
 * would otherwise have to ask.
 */
/** "Jane at Corcoran" -> "Jane". The greeting wants a name, not a title. */
function firstNameOf(full: string): string {
  const word = (full || "").trim().split(/\s+/)[0] ?? "";
  // "Jane," off a hastily-typed contact still greets as "Jane".
  return word.replace(/[^\p{L}'-]/gu, "");
}

/**
 * The message itself.
 *
 * The old draft read like a mortgage application with a greeting stapled on —
 * six facts about creditworthiness before any human being would have said why
 * they were writing. Agents skim; a wall of qualifications from a stranger
 * reads as a form letter and gets a form-letter reply.
 *
 * So it talks the way you'd actually text someone: their name if we have it,
 * which apartment, and one concrete easy ask — a quick video — before the
 * bigger one, the tour. The qualifications still ride along, but as a "bit
 * about me" near the end, where they land as reassurance instead of a resume.
 */
export function draftTourMessage(listing: FeedListing, profile: Profile): string {
  const agent = firstNameOf(listing.myContactName || listing.contactName || "");
  const greeting = agent ? `Hi ${agent}!` : "Hi there!";
  const me = profile.name ? `I'm ${firstNameOf(profile.name)} —` : "";

  const unit = listing.unit ? ` #${listing.unit}` : "";
  const size =
    listing.bedrooms === 0
      ? "studio"
      : Number.isFinite(listing.bedrooms)
        ? `${listing.bedrooms} bed`
        : "place";
  const price = listing.price ? ` listed at $${listing.price.toLocaleString()}` : "";
  const opener = [
    greeting,
    me,
    `I came across the ${size} at ${listing.address}${unit}${price} and it looks great.`,
  ]
    .filter(Boolean)
    .join(" ");

  // The small ask first. A video costs the agent ninety seconds and filters
  // out the places that photograph better than they live — then the tour ask
  // is already teed up for the ones that survive.
  const ask =
    "Any chance you could send a quick video walkthrough when you get a minute? If it looks as good as the photos, I'd love to come tour it right after — I'm flexible on timing.";

  /*
   * No qualifications in the opener.
   *
   * The draft used to lead the second paragraph with income, employment and
   * the documents on hand. It reads as an application to someone who hasn't
   * offered you anything yet — and on a first message to a broker the only
   * question on the table is whether they'll send a video. The packet exists
   * for the moment that question is settled.
   */
  const about = profile.moveInDate
    ? `Hoping to move in around ${formatMoveIn(profile.moveInDate)}.`
    : "";

  const callback = [profile.phone, profile.email].filter(Boolean).join(" / ");
  const thanks = callback
    ? `Thanks so much! You can reach me here or at ${callback}.`
    : "Thanks so much!";

  return [opener, ask, about, thanks, profile.extra].filter(Boolean).join("\n\n");
}

/**
 * The qualification sentence.
 *
 * No longer in the first message — that opener is asking for a video, and
 * leading with your income reads as applying to someone who hasn't offered
 * you anything. It belongs to the application packet, which is the document
 * for the moment the question is actually on the table.
 */
export function qualifyingLine(profile: Profile): string {
  const parts: string[] = [];

  const owner = profile.employment === "self_employed";

  if (profile.employer) {
    parts.push(owner ? `I own ${profile.employer}` : `I work at ${profile.employer}`);
  }
  if (profile.income) {
    // Attributing the figure to the return is what makes it credible for an
    // owner who takes no salary — it's documented, not self-reported.
    parts.push(
      owner
        ? `my 2025 tax return shows ${profile.income}`
        : `my income is ${profile.income}`
    );
  }
  if (profile.creditNote) parts.push(profile.creditNote);

  // "A bit about me" rather than "I'm a qualified renter" — the second is a
  // claim, the first is a person. The facts underneath are identical.
  const opener = parts.length ? `A bit about me — ${joinList(parts)}.` : "";

  // Only apologise for a missing salary when there is genuinely no figure to
  // give. With income on the return, that framing would undersell you.
  const salaryGap = !profile.income && owner;
  const docs = profile.proofs.filter(Boolean);

  const withOpener = (rest: string) => (opener ? `${opener} ${rest}` : rest);

  if (!docs.length) {
    return withOpener("Happy to share proof of income, references and credit on request.");
  }

  const citedReturn = Boolean(profile.income) && owner;
  const remaining = citedReturn
    ? docs.filter((d) => !/tax return/i.test(d))
    : docs;

  if (!remaining.length) {
    return withOpener("Happy to share documentation up front.");
  }

  const docLine = salaryGap
    ? `I don't draw a salary from it, but I can show ${joinList(remaining)} up front.`
    : `I can also share ${joinList(remaining)} up front.`;

  return withOpener(docLine);
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Digits only, so `sms:` gets something a dialer accepts. */
export function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

/**
 * `sms:` deep link. iOS wants `&body=`, macOS wants `?body=`; using `?` with an
 * `&` immediately after satisfies both, which is the long-standing trick for
 * making one link work on an iPhone and a Mac.
 */
export function smsLink(phone: string, body: string): string {
  const target = normalizePhone(phone);
  const encoded = encodeURIComponent(body);
  return target ? `sms:${target}&body=${encoded}` : `sms:&body=${encoded}`;
}

/**
 * The follow-up.
 *
 * Chasing silence with the original message again is the one thing that
 * reliably doesn't work: it reads as a bot, and it makes the recipient
 * re-read three paragraphs they already skipped. A nudge is one line, names
 * the apartment so they don't have to scroll, and gives them the cheapest
 * possible way to answer — a yes/no about whether it's still there.
 *
 * Deliberately no re-pitch and no new ask. The only goal is a reply.
 */
export function draftFollowUp(listing: FeedListing, profile: Profile): string {
  const agent = firstNameOf(listing.myContactName || listing.contactName || "");
  const greeting = agent ? `Hi ${agent} —` : "Hi —";
  const unit = listing.unit ? ` #${listing.unit}` : "";
  const me = profile.name ? ` This is ${firstNameOf(profile.name)}.` : "";
  return (
    `${greeting} following up on ${listing.address}${unit}.${me} ` +
    `Is it still available? Happy to come see it whenever suits you.`
  );
}

export function tourSubject(listing: FeedListing): string {
  const unit = listing.unit ? ` #${listing.unit}` : "";
  return `Viewing request — ${listing.address}${unit}`;
}

/**
 * `mailto:` deep link. Same draft as the text; email is the only channel that
 * works when a listing publishes an address but no phone, which is most of
 * StreetEasy.
 */
export function mailtoLink(email: string, subject: string, body: string): string {
  const params = new URLSearchParams({ subject, body });
  // URLSearchParams encodes spaces as "+", which mail clients render literally.
  const query = params.toString().replace(/\+/g, "%20");
  return `mailto:${email}?${query}`;
}

/**
 * What you can actually do with this listing right now.
 *
 * Almost no NYC listing publishes a phone number — 0 of 324 in a live sample —
 * so a button that promises a text message is usually a dead end. The channel
 * adapts to what the listing actually has, and there is deliberately no fourth
 * state where the button does nothing:
 *
 *   phone  -> text     the fastest channel, when it exists
 *   email  -> email    reliable, works from any device
 *   neither-> portal   copy the draft and open the listing's own contact form
 */
export type Reachable = {
  channel: ContactChannel;
  label: string;
  hint: string;
};

/**
 * What the listing can be reached on, counting anything you added yourself.
 *
 * Your own number wins over the published one. It's usually the only one:
 * nothing in the live corpus publishes a phone, so a number here came from
 * calling around or a sign in a window, and it is by definition better than
 * the nothing the site gave us.
 */
export function reachableOn(listing: {
  contactPhone?: string;
  contactEmail?: string;
  contactName?: string;
  myContactPhone?: string;
  myContactEmail?: string;
  myContactName?: string;
}): { phone: string; email: string; who: string; mine: boolean } {
  const phone = listing.myContactPhone?.trim() || listing.contactPhone?.trim() || "";
  const email = listing.myContactEmail?.trim() || listing.contactEmail?.trim() || "";
  return {
    phone,
    email,
    who: listing.myContactName?.trim() || listing.contactName?.trim() || "",
    mine: Boolean(listing.myContactPhone?.trim() || listing.myContactEmail?.trim()),
  };
}

export function bestChannel(listing: {
  contactPhone: string;
  contactEmail?: string;
  myContactPhone?: string;
  myContactEmail?: string;
  url: string;
}): Reachable {
  const { phone, email } = reachableOn(listing);
  /**
   * One label across all three channels, on purpose.
   *
   * The button used to name its mechanism — "Text for tour", "Copy & open
   * listing" — which made the most important action on the card read
   * differently depending on data the renter can't see and doesn't care about.
   * Worse, "Copy & open listing" describes a clipboard operation rather than
   * the thing you actually want, so the strongest call to action on the page
   * sounded like a chore. The goal is identical every time; only the plumbing
   * differs, and the plumbing belongs in the tooltip.
   */
  if (phone) {
    return {
      channel: "text",
      label: "Text for a tour",
      hint: "Opens Messages with your introduction already written",
    };
  }
  if (email) {
    return {
      channel: "email",
      label: "Request a tour",
      hint: "Opens your email app with the message already written",
    };
  }
  return {
    channel: "portal",
    label: "Request a tour",
    hint: "No phone or email published — copies your message and opens their contact form",
  };
}

/**
 * How a contact was made, for display. Worth showing prominently: when you're
 * chasing a dozen places at once, "did I text them or email them?" is the
 * question you actually need answered before following up.
 */
export const CONTACT_LABEL: Record<ContactChannel, string> = {
  text: "Texted",
  email: "Emailed",
  phone: "Called",
  portal: "Site form",
  in_person: "In person",
};

export const CONTACT_ICON: Record<ContactChannel, string> = {
  text: "💬",
  email: "✉️",
  phone: "📞",
  portal: "🌐",
  in_person: "🤝",
};
