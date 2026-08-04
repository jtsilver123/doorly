export type Source =
  | "streeteasy"
  | "craigslist"
  | "zillow"
  | "hotpads"
  | "apartments"
  | "email"
  | "manual";

export const ALL_SOURCES: Source[] = [
  "streeteasy",
  "zillow",
  "apartments",
  "hotpads",
  "craigslist",
];

export const SOURCE_LABEL: Record<Source, string> = {
  streeteasy: "StreetEasy",
  craigslist: "Craigslist",
  zillow: "Zillow",
  hotpads: "HotPads",
  apartments: "Apartments.com",
  email: "Email alert",
  manual: "Added by me",
};

/**
 * Which site to link to when the same apartment is on several.
 * Zillow first by preference — the listing pages are the nicest to actually use.
 */
export const LINK_PREFERENCE: Source[] = [
  "zillow",
  "streeteasy",
  "apartments",
  "hotpads",
  "craigslist",
  "email",
  "manual",
];

/**
 * A listing as a source adapter returns it. Every adapter normalizes into this
 * shape, so ingest/dedupe/ranking never care which site something came from.
 */
export interface Listing {
  /** Globally unique: `${source}-${sourceId}`. */
  id: string;
  source: Source;
  sourceId: string;
  url: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  sqft: number | null;
  neighborhood: string;
  borough: string;
  address: string;
  unit: string;
  lat: number | null;
  lon: number | null;
  imageUrl: string | null;
  availableAt: string | null;
  noFee: boolean;
  amenities: string[];
  buildingType: string;
  listingStatus: string;
  description: string;
  /** Leasing office / broker phone, when the source exposes one. */
  contactPhone: string;
  /** Broker or management company name. */
  contactName: string;
  /** Broker email, when the source exposes one. Rare, but reliable when present. */
  contactEmail: string;
  /** Raw availability string from the source ("2026-09-01", "Immediate"). */
  availableText: string;
  /** Months of free rent offered as a concession. 0 when there's no deal. */
  monthsFree: number;
  /** Lease length the concession is spread over. 12 unless stated. */
  leaseMonths: number;
  /** Source-supplied net effective rent, when it publishes one. */
  netEffectiveRent: number | null;
}

/**
 * Where a listing sits in your process. This is the CRM spine: everything
 * except `inbox` and `passed` means you've taken an action on it.
 */
export type Stage =
  | "inbox"        // seen, not triaged
  | "interested"   // shortlisted, no contact yet
  | "contacted"    // reached out, waiting to hear back
  | "tour"         // tour booked
  | "toured"       // been there
  | "applied"      // application in
  | "closed"       // signed, or you moved on for good
  | "passed";      // explicitly not for you

export const STAGES: Stage[] = [
  "inbox",
  "interested",
  "contacted",
  "tour",
  "toured",
  "applied",
  "closed",
  "passed",
];

export const STAGE_LABEL: Record<Stage, string> = {
  inbox: "Inbox",
  interested: "Interested",
  contacted: "Contacted",
  tour: "Tour booked",
  toured: "Toured",
  applied: "Applied",
  closed: "Closed",
  passed: "Passed",
};

/** Stages that represent an active pursuit, in pipeline order. */
export const PIPELINE_STAGES: Stage[] = [
  "interested",
  "contacted",
  "tour",
  "toured",
  "applied",
];

/** A listing joined with everything the app knows about it. What the UI renders. */
export interface FeedListing extends Listing {
  firstSeenAt: string;
  lastSeenAt: string;
  isActive: boolean;
  /** Price when we first saw it — lets the UI show "was $3,400". */
  originalPrice: number;
  priceChangedAt: string | null;
  relistedAt: string | null;
  /** Other sites the same apartment is listed on. */
  alsoOn: { source: Source; url: string }[];
  stage: Stage;
  stageChangedAt: string | null;
  starred: boolean;
  visitedAt: string | null;
  notes: string;
  /** Next thing you told yourself to do, and when. */
  followUpAt: string | null;
  contactCount: number;
  lastContactAt: string | null;
  /** How you last reached out — shown on the card so it's visible at a glance. */
  lastContactChannel: ContactChannel | null;
  score: number | null;
  scoreReasons: string[];
  daysOnMarket: number;
  unseenEvents: number;
  /** Contacted, still sitting at "contacted", and gone quiet. Chases itself. */
  needsFollowUp: boolean;
  /** Cash needed on day one — the number that decides if you can take it. */
  upfrontCost: number;
  /** How this price compares to genuinely similar listings. */
  dealVerdict: "steal" | "good" | "market" | "high" | "unknown";
  dealDelta: number;
  dealLabel: string;
  /** Reasons to look twice before spending an evening on it. */
  flags: { kind: string; message: string; severity: "warn" | "info" }[];
  /** Rent after concessions — what you actually pay each month. */
  effectiveRent: number;
  /** Rent after concessions *and* amortized move-in costs. The true monthly. */
  allInMonthly: number;
  /** Whether it's free in time for your move-in date. */
  timing: "ready" | "soon" | "late" | "stale" | "unknown";
  timingLabel: string;
  priceHistory: PricePoint[];
}

export interface PricePoint {
  price: number;
  at: string;
}

export type EventKind =
  | "new"
  | "price_drop"
  | "price_rise"
  | "delisted"
  | "back_on_market"
  | "relisted"
  | "also_listed_on"
  | "updated";

export const EVENT_LABEL: Record<EventKind, string> = {
  new: "New listing",
  price_drop: "Price drop",
  price_rise: "Price increase",
  delisted: "Off market",
  back_on_market: "Back on market",
  relisted: "Relisted",
  also_listed_on: "Also listed on",
  updated: "Details changed",
};

export interface ListingEvent {
  id: number;
  listingId: string;
  kind: EventKind;
  oldValue: string | null;
  newValue: string | null;
  detail: string;
  occurredAt: string;
  acknowledged: boolean;
}

/** One logged interaction: an email you sent, a call, a reply you got. */
export type ContactChannel = "email" | "phone" | "text" | "portal" | "in_person";

export interface ContactLog {
  id: number;
  listingId: string;
  channel: ContactChannel;
  direction: "out" | "in";
  who: string;
  note: string;
  occurredAt: string;
}

/** A saved search. Criteria drive both the scrape and the in-bounds filter. */
export interface SearchCriteria {
  /** Area slugs from lib/areas.ts, e.g. ["brooklyn"] or ["williamsburg","astoria"]. */
  areas: string[];
  bedMin: number;
  bedMax: number | null;
  /**
   * Minimum bathrooms. 0 means "don't care". Every source treats baths as
   * "N or more" rather than a range, which matches how people search — "2B2B"
   * is a floor, not an exact spec.
   */
  bathMin: number;
  priceMin: number;
  priceMax: number;
  sources: Source[];
  noFeeOnly: boolean;
}

/**
 * The layouts people actually ask for, in the shorthand they use.
 * "2B1B" is a far more natural way to say it than two separate dropdowns.
 */
export const LAYOUT_PRESETS: {
  label: string;
  bedMin: number;
  bedMax: number | null;
  bathMin: number;
}[] = [
  { label: "Studio", bedMin: 0, bedMax: 0, bathMin: 0 },
  { label: "1B1B", bedMin: 1, bedMax: 1, bathMin: 1 },
  { label: "2B1B", bedMin: 2, bedMax: 2, bathMin: 1 },
  { label: "2B2B", bedMin: 2, bedMax: 2, bathMin: 2 },
  { label: "3B1B", bedMin: 3, bedMax: 3, bathMin: 1 },
  { label: "3B2B", bedMin: 3, bedMax: 3, bathMin: 2 },
  { label: "Studio–1B", bedMin: 0, bedMax: 1, bathMin: 0 },
  { label: "2B+", bedMin: 2, bedMax: null, bathMin: 0 },
];

export interface SavedSearch {
  id: number;
  label: string;
  criteria: SearchCriteria;
  searchKey: string;
  active: boolean;
}

// --- StreetEasy upstream shape (via realtyapi.io) -------------------------

export interface StreetEasyListing {
  node: {
    id: string;
    areaName: string;
    availableAt: string | null;
    bedroomCount: number;
    buildingType: string;
    fullBathroomCount: number;
    halfBathroomCount: number;
    geoPoint: { latitude: number; longitude: number } | null;
    leadMedia: { photo: { key: string } | null } | null;
    livingAreaSize: number;
    noFee: boolean;
    monthsFree: number;
    netEffectivePrice: number;
    leaseTermMonths: number | null;
    price: number;
    sourceGroupLabel: string;
    status: string;
    street: string;
    unit: string;
    urlPath: string;
  };
}

export interface SearchParams {
  location: string;
  page?: string;
  priceRange?: string;
  beds?: string;
  baths?: string;
  sort_by?: string;
  status?: string;
}

export interface SearchResponse {
  message: string;
  status: string;
  search_results: {
    totalCount: number;
    pageInfo: { currentPage: number; hasNextPage: boolean; totalPages: number };
    listings: StreetEasyListing[];
  };
}
