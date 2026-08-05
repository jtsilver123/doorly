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
export function draftTourMessage(listing: FeedListing, profile: Profile): string {
  const who = profile.name ? `This is ${profile.name}.` : "";
  const unit = listing.unit ? ` #${listing.unit}` : "";
  const address = `${listing.address}${unit}`;
  const price = listing.price ? ` (listed at $${listing.price.toLocaleString()}/mo)` : "";

  const qualifierLine = qualifyingLine(profile);

  const moveIn = profile.moveInDate
    ? ` I'm looking to move in around ${formatMoveIn(profile.moveInDate)}.`
    : "";

  const callback = [profile.phone, profile.email].filter(Boolean).join(" / ");
  const callbackLine = callback ? ` You can reach me here or at ${callback}.` : "";

  return [
    `Hi! ${who} I saw your listing at ${address}${price} and I'd love to see it as soon as possible — today or tomorrow if there's any availability.`,
    `${qualifierLine}${moveIn} I can sign quickly and have documents ready to go.`,
    `What times work for a viewing?${callbackLine}`,
    profile.extra,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The qualification sentence.
 *
 * This is the part that decides whether you get a viewing. A self-employed
 * applicant who lists no salary reads as unqualified, so when there's no income
 * figure we say why *and* lead with the documents — answering the landlord's
 * objection before they raise it, rather than leaving a gap for them to fill in.
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

  const opener = parts.length
    ? `I'm a qualified renter — ${joinList(parts)}.`
    : "I'm a qualified renter.";

  // Only apologise for a missing salary when there is genuinely no figure to
  // give. With income on the return, that framing would undersell you.
  const salaryGap = !profile.income && owner;
  const docs = profile.proofs.filter(Boolean);

  if (!docs.length) {
    return `${opener} I can provide proof of income, references and credit on request.`;
  }

  const citedReturn = Boolean(profile.income) && owner;
  const remaining = citedReturn
    ? docs.filter((d) => !/tax return/i.test(d))
    : docs;

  if (!remaining.length) {
    return `${opener} Happy to share documentation up front.`;
  }

  const docLine = salaryGap
    ? `I don't draw a salary from it, but I can show ${joinList(remaining)} up front.`
    : `I can also show ${joinList(remaining)} up front.`;

  return `${opener} ${docLine}`;
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
