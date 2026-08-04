import type { Profile } from "@/lib/outreach";

/**
 * The renter résumé.
 *
 * Finding an apartment and getting it are different problems, and this app was
 * only solving the first. In a market this tight the apartment goes to whoever
 * applies first with a complete file — so the winning move is to have the file
 * ready before you walk in, not to assemble it after they say yes.
 *
 * It matters most for exactly the case that looks weakest on a standard form:
 * a business owner with no paystub. A landlord's screening question is "can
 * this person pay?", and a blank salary field reads as "no". A one-page summary
 * that answers it with documented figures — and says which documents back each
 * one — turns the unusual income into a non-issue before it becomes an
 * objection.
 */

export interface PacketSection {
  heading: string;
  lines: string[];
}

/** Documents a NYC landlord or management company typically asks for. */
export const DOCUMENT_CHECKLIST = [
  "Photo ID",
  "2025 tax return",
  "Bank statements (2–3 months)",
  "Proof of assets",
  "Business formation / ownership docs",
  "Letter from accountant",
  "Credit report",
  "Landlord reference",
  "Completed application form",
] as const;

function money(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /^[$]/.test(trimmed) ? trimmed : `$${trimmed}`;
}

export function buildPacket(profile: Profile, documentsHeld: string[]): PacketSection[] {
  const owner = profile.employment === "self_employed";
  const sections: PacketSection[] = [];

  const who: string[] = [];
  if (profile.name) who.push(profile.name);
  const contact = [profile.phone, profile.email].filter(Boolean).join(" · ");
  if (contact) who.push(contact);
  sections.push({ heading: profile.name || "Applicant", lines: who.slice(1) });

  // Income first. It is the only question the screener actually has.
  const financial: string[] = [];
  if (profile.employer) {
    financial.push(
      owner
        ? `Owner, ${profile.employer}`
        : `Employed at ${profile.employer}`
    );
  }
  if (profile.income) {
    financial.push(
      owner
        ? `${money(profile.income)} income reported on 2025 federal tax return`
        : `${money(profile.income)} annual income`
    );
  }
  if (owner && !profile.income) {
    financial.push(
      "Income is drawn from business profit rather than salary; tax return and " +
        "bank statements available to verify."
    );
  }
  if (owner) {
    financial.push("Proof of assets available on request.");
  }
  if (profile.creditNote) financial.push(profile.creditNote);
  sections.push({ heading: "Financial position", lines: financial });

  const terms: string[] = [];
  if (profile.moveInDate) {
    const date = new Date(`${profile.moveInDate}T12:00:00Z`);
    terms.push(
      `Target move-in: ${Number.isNaN(date.getTime())
        ? profile.moveInDate
        : date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          })}`
    );
  }
  terms.push("Prepared to sign a 12-month lease and pay on standard terms.");
  terms.push("Documents below can be sent within the hour.");
  sections.push({ heading: "Terms", lines: terms });

  const held = DOCUMENT_CHECKLIST.filter((doc) => documentsHeld.includes(doc));
  const missing = DOCUMENT_CHECKLIST.filter((doc) => !documentsHeld.includes(doc));
  sections.push({
    heading: "Documents ready",
    lines: held.length ? held.map((d) => `✓ ${d}`) : ["(none marked ready yet)"],
  });
  if (missing.length && held.length) {
    sections.push({
      heading: "Available on request",
      lines: missing.map((d) => `· ${d}`),
    });
  }

  if (profile.extra) sections.push({ heading: "Notes", lines: [profile.extra] });

  return sections;
}

/** Plain text, for pasting into an email or printing. */
export function packetText(profile: Profile, documentsHeld: string[]): string {
  const sections = buildPacket(profile, documentsHeld);
  const out: string[] = [];

  const [header, ...rest] = sections;
  out.push(header.heading.toUpperCase());
  for (const line of header.lines) out.push(line);
  out.push("");

  for (const section of rest) {
    out.push(section.heading);
    out.push("-".repeat(section.heading.length));
    for (const line of section.lines) out.push(line);
    out.push("");
  }
  return out.join("\n").trim();
}

/** How complete the file is — the number that predicts whether you win. */
export function readiness(profile: Profile, documentsHeld: string[]): {
  percent: number;
  missing: string[];
} {
  const essentials = [
    ["your name", Boolean(profile.name)],
    ["a phone number", Boolean(profile.phone)],
    ["an email", Boolean(profile.email)],
    ["your business or employer", Boolean(profile.employer)],
    ["an income figure", Boolean(profile.income)],
    ["a move-in date", Boolean(profile.moveInDate)],
    ["photo ID", documentsHeld.includes("Photo ID")],
    ["your 2025 tax return", documentsHeld.includes("2025 tax return")],
    ["bank statements", documentsHeld.includes("Bank statements (2–3 months)")],
    ["proof of assets", documentsHeld.includes("Proof of assets")],
  ] as const;

  const missing = essentials.filter(([, ok]) => !ok).map(([label]) => label);
  const percent = Math.round(((essentials.length - missing.length) / essentials.length) * 100);
  return { percent, missing };
}
