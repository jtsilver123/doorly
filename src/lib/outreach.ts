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
export type Employment = "self_employed" | "employed" | "student" | "other";

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
  /** Someone signs with you. Their papers join the checklist when true. */
  hasGuarantor?: boolean;
  /** How the guarantor earns, which shapes which of their papers are needed. */
  guarantorEmployment?: Employment;
  /** Foreign national: landlords ask for passport and visa pages too. */
  foreignNational?: boolean;
  /** What you assume it costs to move in. Tunable — the rules vary. */
  costs: CostAssumptions;
  /**
   * Which pushes to feel. The in-app bell always records everything; these
   * only gate what reaches the device. Absent keys mean on.
   */
  notify?: {
    crewAdds?: boolean;
    watched?: boolean;
    goodDrops?: boolean;
  };
  /**
   * Which listing site to open when the same apartment is on several. Personal
   * enough to be worth asking rather than assuming.
   */
  preferredSource: Source;
  /**
   * Commute anchors: work, the partner's office, the gym. Geocoded once when
   * saved; every listing then wears a door-to-door estimate per anchor.
   */
  anchors?: { label: string; address: string; lat: number; lon: number }[];
  /**
   * Your own words for the three messages the app writes. Empty or absent
   * means the built-in draft; a saved template wins everywhere drafts are
   * used — the card button, the drawer, the bulk runs. Variables in braces
   * ({agent}, {address}...) fill in per listing at send time.
   */
  templates?: {
    first?: string;
    followUp?: string;
    /** Reaching out about a new place to an agent you've contacted before. */
    repeat?: string;
    /** Pitching the owner of a for-sale place on renting it to you instead. */
    sale?: string;
  };
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
/** A prior thread with the same agent, so the draft can say so. */
export interface PriorContact {
  address: string;
  unit?: string;
}

/* --- your own words ------------------------------------------------------
 *
 * The variables a template can carry. Names are what a person would say,
 * not code: {agent}, {address}, {price}. Unknown braces pass through
 * untouched, so a typo shows itself in the preview instead of vanishing.
 */
export const TEMPLATE_VARS: { token: string; hint: string }[] = [
  { token: "{agent}", hint: "the agent's first name, or 'there'" },
  { token: "{address}", hint: "address with unit" },
  { token: "{neighborhood}", hint: "the neighborhood" },
  { token: "{price}", hint: "asking rent" },
  { token: "{beds}", hint: "studio / 2 bed" },
  { token: "{my name}", hint: "your first name" },
  { token: "{my phone}", hint: "your phone" },
  { token: "{my email}", hint: "your email" },
  { token: "{move in}", hint: "your target date" },
  { token: "{previous address}", hint: "the place you contacted them about before" },
  { token: "{asking price}", hint: "what they want for it, on a for-sale place" },
];

export function renderTemplate(
  template: string,
  listing: FeedListing,
  profile: Profile,
  prior?: PriorContact | null
): string {
  const unit = listing.unit ? ` #${listing.unit}` : "";
  const values: Record<string, string> = {
    "{agent}": firstNameOf(listing.myContactName || listing.contactName || "") || "there",
    "{address}": `${listing.address}${unit}`,
    "{neighborhood}": listing.neighborhood || listing.borough || "the area",
    "{price}": listing.price ? `$${listing.price.toLocaleString()}` : "",
    "{beds}":
      listing.bedrooms === 0
        ? "studio"
        : Number.isFinite(listing.bedrooms)
          ? `${listing.bedrooms} bed`
          : "place",
    "{my name}": firstNameOf(profile.name || ""),
    "{my phone}": profile.phone || "",
    "{my email}": profile.email || "",
    "{move in}": formatMoveIn(profile.moveInDate),
    "{previous address}": prior
      ? `${prior.address}${prior.unit ? ` #${prior.unit}` : ""}`
      : "",
    "{asking price}": listing.salePrice ? `$${listing.salePrice.toLocaleString()}` : "",
  };
  let out = template;
  for (const [token, value] of Object.entries(values)) {
    out = out.split(token).join(value);
  }
  // A blank variable can orphan its sentence's spacing; tidy the seams
  // without touching the words.
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The built-in drafts, spelled as templates. "Start from the default" hands
 * these to the editor so customizing is an edit, never a blank page.
 */
/*
 * The voice rule for every default: written the way a person texts, not the
 * way software writes. Lead with the question, say who you are in one
 * clause, one concrete ask, done. No "I came across", no "it looks great",
 * no "when you get a minute" — a broker reads fifty of these a day, and the
 * ones that get answered are the ones that are easy to answer.
 */
export const DEFAULT_TEMPLATES = {
  first:
    "Hi {agent}, is the {beds} at {address} listed at {price} still available? I'm {my name}, looking to move around {move in}.\n\nCould you send a quick video walkthrough? If it holds up I'll come tour right after.\n\nThanks! You can reach me here or at {my phone}.",
  followUp:
    "Hi {agent} — {my name} again, about {address}. Still available? I can come see it whenever works.",
  repeat:
    "Hi {agent}, it's {my name} — we talked about {previous address}. Is the {beds} at {address} listed at {price} available too? Happy to see both in one trip if that's easier.\n\nThanks! You can reach me here or at {my phone}.",
  sale:
    "Hi {agent}, I'm {my name}. I saw {address} is on the market at {asking price}. Different idea: would the owner rent it instead of selling, or while it sells? I'd sign a 12-month lease at around {price}/mo.\n\nDocuments ready, flexible on the start date. I could be in by {move in}. Worth putting to them? You can reach me here or at {my phone}.",
} as const;

export function draftTourMessage(
  listing: FeedListing,
  profile: Profile,
  prior?: PriorContact | null
): string {
  // Your words beat ours. The repeat variant only fires when there is a
  // prior thread to mention; otherwise the first-contact template carries.
  // A for-sale place gets the pitch instead of a tour ask — asking to tour
  // a place that's for sale as if it were a rental reads as a wrong number.
  const t = profile.templates;
  if (listing.forSale) {
    if (t?.sale?.trim()) return renderTemplate(t.sale, listing, profile, prior);
    // No offer rent set yet: drop the number rather than say "around /mo".
    const template =
      listing.price > 0
        ? DEFAULT_TEMPLATES.sale
        : DEFAULT_TEMPLATES.sale.replace(
            " I'd sign a 12-month lease at around {price}/mo.",
            " I'd sign a 12-month lease at a fair market rent."
          );
    return renderTemplate(template, listing, profile, prior);
  }
  if (prior && t?.repeat?.trim()) return renderTemplate(t.repeat, listing, profile, prior);
  if (t?.first?.trim()) return renderTemplate(t.first, listing, profile, prior);
  const agent = firstNameOf(listing.myContactName || listing.contactName || "");
  const greeting = agent ? `Hi ${agent},` : "Hi,";

  const unit = listing.unit ? ` #${listing.unit}` : "";
  const size =
    listing.bedrooms === 0
      ? "studio"
      : Number.isFinite(listing.bedrooms)
        ? `${listing.bedrooms} bed`
        : "place";
  const price = listing.price ? ` listed at $${listing.price.toLocaleString()}` : "";
  const first = firstNameOf(profile.name || "");
  /*
   * The question leads. A broker triages fifty messages a day, and the one
   * that opens with what it wants is the one that's easy to answer. Third
   * message to the same agent says so out loud — brokers remember repeat
   * interest, and that's exactly the leverage the broker-memory panel
   * tells the user to use.
   */
  const opener = prior
    ? [
        greeting,
        first ? `it's ${first} —` : "",
        `we talked about ${prior.address}${prior.unit ? ` #${prior.unit}` : ""}.`,
        `Is the ${size} at ${listing.address}${unit}${price} available too?`,
      ]
        .filter(Boolean)
        .join(" ")
    : [
        greeting,
        `is the ${size} at ${listing.address}${unit}${price} still available?`,
        first
          ? `I'm ${first}${profile.moveInDate ? `, looking to move around ${formatMoveIn(profile.moveInDate)}` : ""}.`
          : profile.moveInDate
            ? `Looking to move around ${formatMoveIn(profile.moveInDate)}.`
            : "",
      ]
        .filter(Boolean)
        .join(" ");

  // The small ask first. A video costs the agent ninety seconds and filters
  // out the places that photograph better than they live — then the tour ask
  // is already teed up for the ones that survive. Qualifications stay out:
  // income and documents belong to the packet, once there's a yes to apply to.
  const ask = "Could you send a quick video walkthrough? If it holds up I'll come tour right after.";

  const callback = [profile.phone, profile.email].filter(Boolean).join(" / ");
  const thanks = callback ? `Thanks! You can reach me here or at ${callback}.` : "Thanks!";

  return [opener, ask, thanks, profile.extra].filter(Boolean).join("\n\n");
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
export function draftFollowUp(
  listing: FeedListing,
  profile: Profile,
  prior?: PriorContact | null
): string {
  if (profile.templates?.followUp?.trim()) {
    return renderTemplate(profile.templates.followUp, listing, profile, prior);
  }
  const agent = firstNameOf(listing.myContactName || listing.contactName || "");
  const greeting = agent ? `Hi ${agent} —` : "Hi —";
  const unit = listing.unit ? ` #${listing.unit}` : "";
  const first = firstNameOf(profile.name || "");
  // "Jake again" carries both who you are and that you've asked before, in
  // two words — a nudge should read in one glance.
  const me = first ? `${first} again,` : "checking back";
  const also = prior
    ? ` (We were also in touch about ${prior.address}${prior.unit ? ` #${prior.unit}` : ""}.)`
    : "";
  // Chasing a rent pitch asks a different question than chasing a rental:
  // not "is it available" but "what did the owner think".
  if (listing.forSale) {
    return (
      `${greeting} ${me} about ${listing.address}${unit}.${also} ` +
      `Any word from the owner on renting it out? Happy to talk numbers whenever.`
    );
  }
  return (
    `${greeting} ${me} about ${listing.address}${unit}.${also} ` +
    `Still available? I can come see it whenever works.`
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
  forSale?: boolean;
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
   *
   * The one honest exception: a for-sale place isn't asked for a tour, it's
   * pitched — and the button should say the play, not the wrong ask.
   */
  const goal = listing.forSale ? "Pitch renting it" : null;
  if (phone) {
    return {
      channel: "text",
      label: goal ?? "Text for a tour",
      hint: "Opens Messages with your introduction already written",
    };
  }
  if (email) {
    return {
      channel: "email",
      label: goal ?? "Request a tour",
      hint: "Opens your email app with the message already written",
    };
  }
  return {
    channel: "portal",
    label: goal ?? "Request a tour",
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
