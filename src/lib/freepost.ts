import { AREAS } from "@/lib/areas";

/**
 * Reading a Facebook-group post the way a person does.
 *
 * The NYC group listings ("Gypsy Housing", the neighborhood boards) are
 * unstructured prose: a price somewhere, "2br" somewhere else, a
 * neighborhood name, sometimes a phone number, never a schema. Meta closed
 * the group APIs and its terms bar scraping, so the honest intake is a
 * paste — and this parser's job is to make the paste cost nothing, by
 * pre-filling everything a regex can defensibly claim. Every guess lands in
 * an editable form; nothing here writes to the database on its own.
 */

export interface FreePost {
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  neighborhood: string | null;
  phone: string | null;
  email: string | null;
  /** A street-shaped line, when the post names one. Often absent on purpose. */
  address: string | null;
  noFee: boolean;
  /** Whether the text looks like a listing at all, vs a search query. */
  looksLikeListing: boolean;
  /** A sale listing pasted with rental intent: pitch the owner to rent it. */
  forSale: boolean;
  /** The asking price, when the paste is a sale listing. */
  salePrice: number | null;
}

const PRICE_RE = /\$\s?(\d{1,2}[,.]?\d{3})(?!\d)/g;
const BEDS_RE = /(\d+(?:\.\d)?)\s*(?:br|bed(?:room)?s?)\b|\bstudio\b/i;
const BATHS_RE = /(\d+(?:\.\d)?)\s*(?:ba(?:th(?:room)?s?)?)\b/i;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const ADDRESS_RE =
  /\b(\d{1,4}(?:-\d{1,4})?\s+(?:[A-Z][A-Za-z'.]*\s){0,3}(?:St(?:reet)?|Ave(?:nue)?|Pl(?:ace)?|Rd|Road|Blvd|Boulevard|Dr(?:ive)?|Ln|Lane|Ct|Court|Ter(?:race)?|Pkwy|Parkway|Broadway|Bowery)\b\.?(?:\s*(?:#|Apt\.?|Unit)\s*\w+)?)/i;

/** Six figures and up, or "$1.2M" / "$895k": the shape of an asking price. */
const SALE_PRICE_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d{6,9})(?!\d)|\$\s?(\d+(?:\.\d+)?)\s?([kKmM])\b/g;

/** The asking price, when the paste reads like a sale rather than a rental. */
function bestSalePrice(text: string): number | null {
  const seen: number[] = [];
  for (const m of text.matchAll(SALE_PRICE_RE)) {
    const n = m[1]
      ? Number(m[1].replace(/,/g, ""))
      : Number(m[2]) * (m[3].toLowerCase() === "m" ? 1_000_000 : 1_000);
    if (n >= 100_000 && n <= 100_000_000) seen.push(n);
  }
  return seen.length ? Math.min(...seen) : null;
}

/**
 * What rent to open with when pitching the owner of a for-sale place: about
 * a 5% gross yield on their ask, per month, rounded to something a person
 * would actually say. Low enough to be worth their while considering, high
 * enough to be taken seriously.
 */
export function suggestedRentFor(salePrice: number): number {
  return Math.max(500, Math.round((salePrice * 0.05) / 12 / 50) * 50);
}

/** The rent, not the deposit: of all dollar figures, the plausible monthly one. */
function bestPrice(text: string): number | null {
  const seen: number[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const n = Number(m[1].replace(/[,.]/g, ""));
    if (n >= 500 && n <= 25_000) seen.push(n);
  }
  if (!seen.length) return null;
  // "Rent $3,200, deposit $6,400" — the rent is usually the smallest
  // four-digit figure, since deposits and broker fees stack multiples of it.
  return Math.min(...seen);
}

export function parseFreePost(text: string): FreePost {
  const beds = text.match(BEDS_RE);
  const baths = text.match(BATHS_RE);
  const phone = text.match(PHONE_RE);
  const email = text.match(EMAIL_RE);
  const address = text.match(ADDRESS_RE);

  // Longest label first, so "East Williamsburg" doesn't resolve to
  // "Williamsburg" by accident.
  const hood =
    [...AREAS]
      .filter((a) => !a.isBorough)
      .sort((a, b) => b.label.length - a.label.length)
      .find((a) => new RegExp(`\\b${a.label}\\b`, "i").test(text)) ?? null;

  const price = bestPrice(text);
  // "For sale" said out loud, or a six-figure ask with no monthly figure:
  // either way this is a sale listing pasted with rental intent.
  const salePrice = bestSalePrice(text);
  const forSale =
    salePrice != null && (/for\s+sale|asking|list(?:ed|ing)?\s+price|in\s+contract/i.test(text) || price == null);
  return {
    price,
    forSale,
    salePrice: forSale ? salePrice : null,
    bedrooms: beds ? (beds[0].toLowerCase() === "studio" ? 0 : Math.round(Number(beds[1]))) : null,
    bathrooms: baths ? Number(baths[1]) : null,
    neighborhood: hood?.label ?? null,
    phone: phone ? `(${phone[1]}) ${phone[2]}-${phone[3]}` : null,
    email: email ? email[0] : null,
    address: address ? address[1].trim() : null,
    noFee: /no\s*(?:broker'?s?\s*)?fee/i.test(text),
    // A listing has a price and some substance; a bare address or a link is
    // a lookup, and belongs to the corpus search instead. An asking price
    // counts — a sale paste rarely mentions rent.
    looksLikeListing: (price != null || salePrice != null) && text.trim().length > 40,
  };
}

/** Facebook's many door signs, including share links. */
export function isFacebookUrl(text: string): boolean {
  return /(?:^|\/\/|\.)(?:facebook\.com|fb\.com|fb\.watch|m\.me)\//i.test(text.trim());
}
