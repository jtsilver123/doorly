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

/**
 * The checklist as slots that hold real files.
 *
 * Modeled on what NYC management companies actually circulate (the "all
 * documents from A and B" sheet): everyone needs ID and bank statements,
 * the B column depends on how you earn, foreign nationals add passport and
 * visa pages, and a guarantor brings their own parallel stack. A slot with
 * fewer files than it wants is a requirement, not a nag.
 */
export interface PacketSlot {
  key: string;
  label: string;
  hint?: string;
  /** How many files before this slot reads complete. */
  wants: number;
  guarantor?: boolean;
}

export function packetSlots(profile: Profile): PacketSlot[] {
  const slots: PacketSlot[] = [
    { key: "photo_id", label: "Government photo ID", wants: 1 },
    {
      key: "bank_statements",
      label: "Bank statements",
      hint: "2 most recent, same account",
      wants: 2,
    },
  ];
  if (profile.foreignNational) {
    slots.push({ key: "passport", label: "Passport page", wants: 1 });
    slots.push({ key: "visa", label: "Visa page", wants: 1 });
  }
  switch (profile.employment) {
    case "self_employed":
      slots.push({
        key: "cpa_letter",
        label: "CPA letter",
        hint: "position, last 2 years' adjusted gross income",
        wants: 1,
      });
      slots.push({
        key: "tax_returns",
        label: "Tax returns",
        hint: "last 2 years, first 2 pages of each 1040",
        wants: 2,
      });
      break;
    case "student":
      slots.push({
        key: "enrollment",
        label: "Enrollment or acceptance letter",
        wants: 1,
      });
      slots.push({ key: "class_schedule", label: "Class schedule", wants: 1 });
      if (profile.foreignNational) {
        slots.push({
          key: "i20",
          label: "I-20",
          hint: "signed by the school and by you",
          wants: 1,
        });
      }
      break;
    default:
      slots.push({
        key: "employment_letter",
        label: "Employment letter",
        hint: "position, salary, tenure; signed within 60 days",
        wants: 1,
      });
      slots.push({ key: "paystubs", label: "Pay stubs", hint: "2 most recent", wants: 2 });
      slots.push({
        key: "tax_returns",
        label: "Tax returns",
        hint: "last 2 years, first 2 pages of each 1040",
        wants: 2,
      });
  }
  if (profile.hasGuarantor) {
    slots.push({ key: "g_photo_id", label: "Guarantor photo ID", wants: 1, guarantor: true });
    // The guarantor's income proof depends on how THEY earn, same as yours.
    switch (profile.guarantorEmployment ?? "employed") {
      case "self_employed":
        slots.push({
          key: "g_cpa_letter",
          label: "Guarantor CPA letter",
          hint: "position, last 2 years' adjusted gross income",
          wants: 1,
          guarantor: true,
        });
        break;
      case "employed":
        slots.push({
          key: "g_employment_letter",
          label: "Guarantor employment letter",
          hint: "position, salary, tenure; signed within 60 days",
          wants: 1,
          guarantor: true,
        });
        slots.push({
          key: "g_paystubs",
          label: "Guarantor pay stubs",
          hint: "2 most recent",
          wants: 2,
          guarantor: true,
        });
        break;
      default:
        slots.push({
          key: "g_income",
          label: "Guarantor income proof",
          hint: "whatever documents their income",
          wants: 1,
          guarantor: true,
        });
    }
    slots.push(
      {
        key: "g_tax_returns",
        label: "Guarantor tax returns",
        hint: "last 2 years",
        wants: 2,
        guarantor: true,
      },
      {
        key: "g_bank_statements",
        label: "Guarantor bank statements",
        hint: "2 most recent",
        wants: 2,
        guarantor: true,
      }
    );
  }
  return slots;
}

/**
 * Readiness measured in files, not checkboxes. A slot counts for as many
 * files as it wants and no more, so a fifth bank statement can't paper over
 * a missing ID.
 */
export function packetReadiness(
  profile: Profile,
  docs: { slot: string }[]
): { percent: number; missing: string[]; satisfied: string[] } {
  const slots = packetSlots(profile);
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(d.slot, (counts.get(d.slot) ?? 0) + 1);
  let have = 0;
  let want = 0;
  const missing: string[] = [];
  const satisfied: string[] = [];
  for (const slot of slots) {
    const got = Math.min(counts.get(slot.key) ?? 0, slot.wants);
    have += got;
    want += slot.wants;
    if (got < slot.wants) missing.push(slot.label);
    else satisfied.push(slot.label);
  }
  return {
    percent: want > 0 ? Math.round((have / want) * 100) : 0,
    missing,
    satisfied,
  };
}

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
