import type { FeedListing } from "@/types";

/**
 * The three edges a renter actually has: knowing the comps, knowing the 40×
 * rule before falling in love, and remembering which broker they already
 * talked to. All pure functions over data the app already holds, pinned by
 * tests — this file is negotiating advice, and wrong advice with confident
 * copy is worse than none.
 */

// --- what to say about the price -------------------------------------------

export interface Negotiation {
  stance: "push" | "nudge" | "move-fast";
  /** Ready to send, when there's something worth saying. */
  message?: string;
  /** The one-line explanation of the stance. */
  note: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Round an ask to something a human would actually say. */
const askable = (n: number) => Math.round(n / 25) * 25;

export function negotiationScript(listing: {
  address: string;
  price: number;
  bedrooms: number;
  dealDelta: number;
  dealVerdict: FeedListing["dealVerdict"];
}): Negotiation {
  const size = listing.bedrooms === 0 ? "studios" : `${listing.bedrooms}-beds`;
  const median =
    listing.dealVerdict === "unknown"
      ? null
      : Math.round(listing.price / (1 + listing.dealDelta / 100));

  if (listing.dealVerdict === "unknown") {
    return {
      stance: "nudge",
      note: "Not enough similar listings to argue from — ask for a free month anyway; the worst answer is no.",
      message: `Hi — very interested in ${listing.address}. Is there any flexibility on a free month or fees for a quick, complete application? I can move fast.`,
    };
  }

  // Meaningfully over the going rate: argue from the comps.
  if (listing.dealDelta >= 5 && median) {
    const ask = askable(median * 1.02);
    return {
      stance: "push",
      note: `Listed ${listing.dealDelta}% over comparable ${size} — the comps are your leverage.`,
      message: `Hi — I'm seriously interested in ${listing.address}. Comparable ${size} nearby are listing around ${money(median)}, so the asking rent reads high. Would the owner consider ${money(ask)}, or one month free at the current rent? I have my documents ready and can sign quickly.`,
    };
  }

  // Meaningfully under: negotiating risks the apartment. Say so.
  if (listing.dealDelta <= -8) {
    return {
      stance: "move-fast",
      note: `Already ${Math.abs(listing.dealDelta)}% under the comps — negotiating risks losing it to a faster application. Spend your energy on speed.`,
    };
  }

  return {
    stance: "nudge",
    note: "Priced about at market — no comp leverage, but a clean fast application is worth a free month to many owners.",
    message: `Hi — very interested in ${listing.address}. The rent looks in line with the market; would the owner consider one free month or waiving fees for a complete application this week?`,
  };
}

// --- the 40× rule -----------------------------------------------------------

/** "95k", "$95,000", "95000" → 95000. Null when it doesn't parse. */
export function incomeToAnnual(income: string): number | null {
  const cleaned = income.trim().toLowerCase().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const k = cleaned.match(/^(\d+(?:\.\d+)?)k$/);
  const n = k ? Number(k[1]) * 1000 : Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface Qualify {
  ok: boolean;
  /** Annual income the 40× rule wants for this rent. */
  needed: number;
  /** How far short, annualized. 0 when ok. */
  gap: number;
}

export function qualifyCheck(price: number, annualIncome: number): Qualify {
  const needed = price * 40;
  return {
    ok: annualIncome >= needed,
    needed,
    gap: Math.max(0, needed - annualIncome),
  };
}

// --- broker memory ----------------------------------------------------------

const phoneKey = (raw: string) => raw.replace(/\D+/g, "").replace(/^1(?=\d{10}$)/, "");

export interface BrokerHistory {
  name: string;
  phone: string;
  others: { id: string; address: string; unit: string; stage: FeedListing["stage"]; lastContactAt: string | null }[];
}

/**
 * The same agent shows up across listings — brokerages carry inventory. If
 * you've already texted them about two other places, the third message
 * should say so instead of reading like a stranger's form letter.
 */
export function brokerHistory(
  listings: FeedListing[],
  current: FeedListing
): BrokerHistory | null {
  const key = phoneKey(current.myContactPhone || current.contactPhone);
  if (key.length < 10) return null;
  const others = listings
    .filter(
      (l) =>
        l.id !== current.id &&
        phoneKey(l.myContactPhone || l.contactPhone) === key
    )
    .map((l) => ({
      id: l.id,
      address: l.address,
      unit: l.unit,
      stage: l.stage,
      lastContactAt: l.lastContactAt,
    }));
  if (!others.length) return null;
  return {
    name: current.myContactName || current.contactName || "This contact",
    phone: key,
    others,
  };
}
