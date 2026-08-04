import type { ContactChannel, FeedListing } from "@/types";

/**
 * Drafting the "can I see this today?" text.
 *
 * In a market this fast the bottleneck is how quickly you get a viewing, so the
 * goal is one tap from seeing a listing to a filled-in Messages window. The
 * draft leads with the address (agents juggle dozens), states the qualifying
 * facts unprompted, and asks for a specific next step.
 */

export interface Profile {
  name: string;
  employer: string;
  income: string;
  /** ISO date, e.g. "2026-09-01". */
  moveInDate: string;
  creditNote: string;
  phone: string;
  email: string;
  extra: string;
}

export const DEFAULT_PROFILE: Profile = {
  name: "",
  employer: "",
  income: "",
  moveInDate: "2026-09-01",
  creditNote: "credit in the 700s, no pets, non-smoker",
  phone: "",
  email: "",
  extra: "",
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

  const qualifiers: string[] = [];
  if (profile.employer) qualifiers.push(`I work at ${profile.employer}`);
  if (profile.income) qualifiers.push(`my income is ${profile.income}`);
  if (profile.creditNote) qualifiers.push(profile.creditNote);

  const qualifierLine = qualifiers.length
    ? `I'm a qualified renter — ${joinList(qualifiers)}.`
    : "I'm a qualified renter and can provide proof of income, references and credit on request.";

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
