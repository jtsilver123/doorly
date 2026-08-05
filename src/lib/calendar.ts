import type { FeedListing } from "@/types";
import { SOURCE_LABEL } from "@/types";
import { reachableOn } from "@/lib/outreach";
import { formatPhone } from "@/lib/phone";

/**
 * Getting a viewing into the calendar you actually live in.
 *
 * A booked tour that exists only inside this app is a tour you will miss. You
 * check your phone's calendar on the way out the door, not a browser tab — so
 * the app has to hand the appointment over, with everything you'd want at the
 * door: what it costs, what floor, who to call when you're outside and the
 * buzzer doesn't work, and a link back to the listing.
 *
 * Two routes, because people's calendars differ: an .ics file (Apple
 * Calendar, Outlook, Fantastical — and Google, via import) and a Google
 * Calendar template URL for the browser.
 */

const money = (n: number) => `$${n.toLocaleString()}`;

/** UTC basic format: 20260805T150000Z. What both iCalendar and Google want. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * A private viewing is a slot; an open house is a window you arrive inside.
 * Without a stated end, 30 minutes is the honest guess for a showing.
 */
function windowFor(listing: FeedListing): { start: Date; end: Date } | null {
  if (!listing.tourAt) return null;
  const start = new Date(listing.tourAt);
  if (Number.isNaN(start.getTime())) return null;
  const stated = listing.tourEndsAt ? new Date(listing.tourEndsAt) : null;
  const end =
    stated && !Number.isNaN(stated.getTime()) && stated > start
      ? stated
      : new Date(start.getTime() + (listing.tourKind === "open_house" ? 60 : 30) * 60_000);
  return { start, end };
}

export function eventTitle(listing: FeedListing): string {
  const unit = listing.unit ? ` #${listing.unit}` : "";
  const what = listing.tourKind === "open_house" ? "Open house" : "Tour";
  return `${what} — ${listing.address}${unit}`;
}

export function eventLocation(listing: FeedListing): string {
  const unit = listing.unit ? ` #${listing.unit}` : "";
  // Neighborhood plus city, so the calendar's own maps link resolves it.
  return [`${listing.address}${unit}`, listing.neighborhood, "New York, NY"]
    .filter(Boolean)
    .join(", ");
}

/**
 * The body. Everything you'd otherwise be digging back into the app for while
 * standing on the sidewalk.
 */
export function eventDescription(listing: FeedListing): string {
  const { phone, email, who } = reachableOn(listing);
  const lines: string[] = [];

  lines.push(`${money(listing.price)}/mo · ${money(listing.upfrontCost)} to move in`);

  const size = [
    listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bed`,
    listing.bathrooms ? `${listing.bathrooms} bath` : "",
    listing.sqft ? `${listing.sqft} ft²` : "",
  ].filter(Boolean);
  if (size.length) lines.push(size.join(" · "));

  lines.push(`Doorly score: ${listing.rating}/100${listing.myScore != null ? ` · yours: ${listing.myScore}/100` : ""}`);
  if (listing.dealLabel) lines.push(listing.dealLabel);

  if (phone || email || who) {
    lines.push("");
    lines.push("Contact");
    if (who) lines.push(`  ${who}`);
    if (phone) lines.push(`  ${formatPhone(phone) || phone}`);
    if (email) lines.push(`  ${email}`);
  }

  if (listing.pros.length) {
    lines.push("");
    lines.push("Good");
    for (const pro of listing.pros.slice(0, 3)) lines.push(`  + ${pro}`);
  }
  if (listing.cons.length) {
    lines.push("");
    lines.push("Watch out");
    for (const con of listing.cons.slice(0, 3)) lines.push(`  - ${con}`);
  }

  // Questions you meant to ask are worth more at the door than in a database.
  if (listing.notes.trim()) {
    lines.push("");
    lines.push("Your notes");
    lines.push(`  ${listing.notes.trim()}`);
  }

  if (listing.url) {
    lines.push("");
    lines.push(`Listing (${SOURCE_LABEL[listing.source] ?? listing.source}): ${listing.url}`);
  }

  return lines.join("\n");
}

/**
 * iCalendar escaping: commas, semicolons and backslashes are structural in
 * the format, and a newline has to be the two characters `\n`, not an actual
 * line break — an unescaped comma in an address silently truncates the field.
 */
function esc(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * RFC 5545 says no line may exceed 75 octets, and a folded continuation
 * begins with a space. Long descriptions are the common case here, and
 * Outlook is the client that actually rejects an unfolded one.
 */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

/** The .ics file for one booked viewing, or null if there's no time set. */
export function icsFor(listing: FeedListing): string | null {
  const span = windowFor(listing);
  if (!span) return null;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Doorly//NYC apartment hunt//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // Stable per listing, so re-adding updates the event rather than
    // creating a second one next to it.
    `UID:doorly-tour-${listing.id}@doorlynyc.vercel.app`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(span.start)}`,
    `DTEND:${stamp(span.end)}`,
    `SUMMARY:${esc(eventTitle(listing))}`,
    `LOCATION:${esc(eventLocation(listing))}`,
    `DESCRIPTION:${esc(eventDescription(listing))}`,
    listing.url ? `URL:${esc(listing.url)}` : "",
    "BEGIN:VALARM",
    // An hour out is when you'd want to leave, not when it's too late.
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(eventTitle(listing))}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  // CRLF, which the spec requires and several clients enforce.
  return lines.map(fold).join("\r\n");
}

/** Google Calendar's prefilled-event URL. */
export function googleCalendarUrl(listing: FeedListing): string | null {
  const span = windowFor(listing);
  if (!span) return null;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: eventTitle(listing),
    dates: `${stamp(span.start)}/${stamp(span.end)}`,
    details: eventDescription(listing),
    location: eventLocation(listing),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Filename for the download: `tour-144-east-40th-street.ics`. */
export function icsFilename(listing: FeedListing): string {
  const slug = `${listing.address} ${listing.unit ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${listing.tourKind === "open_house" ? "open-house" : "tour"}-${slug || listing.id}.ics`;
}
