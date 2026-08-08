import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fingerprint, streetKey, extractUnit, matchConfidence, hasStreetNumber } from "@/lib/dedupe";
import { toNum, toPrice, addressSansUnit } from "@/lib/parse";
import { craigslistId, parseCraigslistHtml } from "@/lib/sources/craigslist";
import { inBounds, searchKey, normalizeCriteria, DEFAULT_CRITERIA } from "@/lib/criteria";
import { train, score, features } from "@/lib/rank";
import {
  bestChannel,
  draftTourMessage,
  draftFollowUp,
  qualifyingLine,
  smsLink,
  normalizePhone,
  reachableOn,
  renderTemplate,
  DEFAULT_PROFILE,
} from "@/lib/outreach";
import { nextAction } from "@/lib/nextAction";
import {
  effectiveRent,
  allInMonthly,
  moveInCost,
  moveInFit,
  DEFAULT_COSTS,
} from "@/lib/cost";
import { neighborhoodAt, withinAreas, locate } from "@/lib/geo";
import { neighborhoodAt as neighborhoodInPolygon } from "@/lib/nta";
import { phaseFor, phaseBands, funnelFor, todaysActions } from "@/lib/timeline";
import { statsFor, readDeal, flagsFor } from "@/lib/market";
import { runwayDays } from "@/lib/runway";
import { DEFAULT_CONFIG, keyHint, loadConfig, withConfig } from "@/lib/apikey";
import { amenitiesOf, qualityScore, amenityFacts } from "@/lib/amenities";
import { verdictFor, gradeOf } from "@/lib/verdict";
import { icsFor, googleCalendarUrl, eventDescription } from "@/lib/calendar";
import { tourDays } from "@/lib/tourday";
import { normalizeApartments } from "@/lib/sources/apartments";
import { amenityRowsFor } from "@/components/Compare";
import { sweepPlan } from "@/lib/sweep";
import { nextBedRange } from "@/components/BedBathPicker";
import {
  nearestStation,
  stationsWithin,
  routesWithin,
  subwayLabel,
  walkMinutes,
} from "@/lib/subway";
import { applyFilters, findPasted, addressFromListingUrl } from "@/lib/filters";
import { streeteasySearchUrl, zillowSearchUrl, siteJumps } from "@/lib/siteLinks";
import { parseFreePost, isFacebookUrl } from "@/lib/freepost";
import { originsFor, cookieDomainFor, isAppHost } from "@/lib/hosts";
import { nearAreas } from "@/lib/geo";
import { safeNext } from "@/lib/nextPath";
import { tourQuestions, looksGroundFloor } from "@/lib/tourPrep";
import { hpdAddress } from "@/lib/nycdata";
import {
  negotiationScript,
  incomeToAnnual,
  qualifyCheck,
  brokerHistory,
} from "@/lib/leverage";
import { commuteMinutes } from "@/lib/commute";
import { LAYOUT_PRESETS } from "@/types";
import type { Listing, FeedListing } from "@/types";

function listing(over: Partial<Listing> = {}): Listing {
  return {
    id: "streeteasy-1",
    source: "streeteasy",
    sourceId: "1",
    url: "https://streeteasy.com/x",
    price: 3500,
    bedrooms: 1,
    bathrooms: 1,
    sqft: 600,
    neighborhood: "West Village",
    borough: "Manhattan",
    address: "55 Morton Street",
    unit: "5J",
    lat: null,
    lon: null,
    imageUrl: null,
    images: [],
    availableAt: null,
    noFee: false,
    amenities: [],
    buildingType: "",
    listingStatus: "ACTIVE",
    description: "",
    contactPhone: "",
    contactName: "",
    contactEmail: "",
    availableText: "",
    monthsFree: 0,
    leaseMonths: 12,
    netEffectiveRent: null,
    ...over,
  };
}

// --- address canonicalization --------------------------------------------

test("streetKey collapses the ways sites write the same address", () => {
  const canonical = "55 morton st";
  assert.equal(streetKey("55 Morton Street"), canonical);
  assert.equal(streetKey("55 Morton St #5J"), canonical);
  assert.equal(streetKey("55 Morton St APT 5j"), canonical);
  assert.equal(streetKey("55 Morton Street, New York, NY 10014"), canonical);
});

test("streetKey normalizes directions and ordinals", () => {
  assert.equal(streetKey("123 West 45th Street"), streetKey("123 W 45 St"));
  assert.equal(streetKey("200 East 21st St"), "200 e 21 st");
});

test("extractUnit finds the unit in either notation", () => {
  assert.equal(extractUnit("55 Morton St #5J"), "5J");
  assert.equal(extractUnit("417 E 57th St APT 11C"), "11C");
  assert.equal(extractUnit("Unit 2R, sunny"), "2R");
  assert.equal(extractUnit("55 Morton Street"), "");
});

// --- cross-site identity --------------------------------------------------

test("the same apartment on three sites shares one fingerprint", () => {
  const se = listing({ address: "55 Morton Street", unit: "5J", price: 3295 });
  const zl = listing({
    id: "zillow-2",
    source: "zillow",
    address: "55 Morton St APT 5j",
    unit: "5J",
    price: 3295,
  });
  const hp = listing({
    id: "hotpads-3",
    source: "hotpads",
    address: "55 Morton St",
    unit: "5J",
    price: 3300,
  });
  assert.equal(fingerprint(se), fingerprint(zl));
  assert.equal(fingerprint(se), fingerprint(hp));
});

test("a price change does not fork a listing in two", () => {
  const before = listing({ price: 3500 });
  const after = listing({ price: 3200 });
  assert.equal(fingerprint(before), fingerprint(after));
});

test("different units in one building stay separate", () => {
  const a = listing({ unit: "5J" });
  const b = listing({ unit: "6K" });
  assert.notEqual(fingerprint(a), fingerprint(b));
  assert.equal(matchConfidence(a, b), 0);
});

test("listings with no street number never collapse together", () => {
  const a = listing({
    id: "craigslist-a",
    source: "craigslist",
    sourceId: "a",
    address: "Sunny studio!",
    unit: "",
  });
  const b = listing({
    id: "craigslist-b",
    source: "craigslist",
    sourceId: "b",
    address: "Cozy studio!",
    unit: "",
  });
  assert.notEqual(fingerprint(a), fingerprint(b));
  assert.ok(fingerprint(a).startsWith("id:"));
});

test("a missing unit still matches a known one at the same price", () => {
  const withUnit = listing({ unit: "5J", price: 3295 });
  const without = listing({ id: "hotpads-9", source: "hotpads", unit: "", address: "55 Morton St", price: 3295 });
  assert.ok(matchConfidence(withUnit, without) >= 0.7);
});

test("a wildly different price blocks a merge", () => {
  const cheap = listing({ unit: "", price: 3000 });
  const dear = listing({ id: "zillow-9", source: "zillow", unit: "", price: 9000 });
  assert.ok(matchConfidence(cheap, dear) < 0.8);
});

// --- defensive parsing ----------------------------------------------------

test("toNum unwraps the shapes these APIs actually return", () => {
  assert.equal(toNum(4995), 4995);
  assert.equal(toNum("$3,295/mo"), 3295);
  // Zillow sends price as an object on individual property results.
  assert.equal(toNum({ value: 4995, pricePerSquareFoot: 8 }), 4995);
  assert.equal(toNum(null), null);
  assert.equal(toNum("n/a"), null);
  assert.equal(toNum(Number.NaN), null);
});

test("toPrice rejects implausible rents instead of passing NaN through", () => {
  assert.equal(toPrice({ value: 4995 }), 4995);
  assert.equal(toPrice(undefined, null, 3200), 3200);
  assert.equal(toPrice(5), null);
  assert.equal(toPrice("free"), null);
});

test("a NaN price is rejected by the bounds check", () => {
  // NaN compares false against everything, so an explicit guard is the only
  // thing standing between a bad payload and a listing priced $NaN.
  const broken = listing({ price: Number.NaN });
  assert.equal(inBounds(broken, DEFAULT_CRITERIA), false);
});

test("inBounds honours price, beds and fee", () => {
  const c = { ...DEFAULT_CRITERIA, areas: [], priceMin: 3000, priceMax: 4000, bedMin: 0, bedMax: 1 };
  assert.ok(inBounds(listing({ price: 3500, bedrooms: 1 }), c));
  assert.ok(!inBounds(listing({ price: 4500 }), c));
  assert.ok(!inBounds(listing({ bedrooms: 3 }), c));
  assert.ok(!inBounds(listing({ noFee: false }), { ...c, noFeeOnly: true }));
});

test("searchKey is stable regardless of ordering", () => {
  const a = { ...DEFAULT_CRITERIA, areas: ["chelsea", "flatiron"] };
  const b = { ...DEFAULT_CRITERIA, areas: ["flatiron", "chelsea"] };
  assert.equal(searchKey(a), searchKey(b));
});

// --- craigslist -----------------------------------------------------------

test("craigslistId handles both the legacy and current URL formats", () => {
  assert.equal(
    craigslistId("https://newyork.craigslist.org/mnh/abo/d/slug/7891234567.html"),
    "7891234567"
  );
  // Current format: opaque trailing segment, no numeric id at all.
  assert.equal(
    craigslistId("https://www.craigslist.org/view/d/new-york-bright/nysfnVxrP9Y9QZh5cXF5L3"),
    "nysfnVxrP9Y9QZh5cXF5L3"
  );
  assert.equal(craigslistId("https://craigslist.org/short"), "");
});

test("parseCraigslistHtml reads price, title and JSON-LD beds", () => {
  const html = `
    <script type="application/ld+json">
    {"@type":"ItemList","itemListElement":[
      {"position":"0","item":{"name":"Sunny 1BR on Bedford","numberOfBedrooms":1,
       "numberOfBathroomsTotal":1,"latitude":40.72,"longitude":-73.95}}]}
    </script>
    <li class="cl-static-search-result" title="x">
      <a href="https://www.craigslist.org/view/d/sunny-1br/abcd1234efgh">
        <div class="title">Sunny 1BR</div>
        <div class="details">
          <div class="price">$3,400</div>
          <div class="location">East Village</div>
        </div>
      </a>
    </li>`;
  const [parsed] = parseCraigslistHtml(html);
  assert.equal(parsed.price, 3400);
  assert.equal(parsed.bedrooms, 1);
  assert.equal(parsed.sourceId, "abcd1234efgh");
  assert.equal(parsed.neighborhood, "East Village");
  assert.equal(parsed.source, "craigslist");
});

test("parseCraigslistHtml aligns JSON-LD with cards by 0-based position", () => {
  const html = `
    <script type="application/ld+json">
    {"@type":"ItemList","itemListElement":[
      {"position":"0","item":{"name":"First","numberOfBedrooms":0}},
      {"position":"1","item":{"name":"Second","numberOfBedrooms":2}}]}
    </script>
    <li class="cl-static-search-result"><a href="https://www.craigslist.org/view/d/a/aaaaaaaaaa">
      <div class="title">First</div><div class="price">$2,000</div></a></li>
    <li class="cl-static-search-result"><a href="https://www.craigslist.org/view/d/b/bbbbbbbbbb">
      <div class="title">Second</div><div class="price">$5,000</div></a></li>`;
  const parsed = parseCraigslistHtml(html);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].bedrooms, 0);
  assert.equal(parsed[1].bedrooms, 2);
});

// --- ranking --------------------------------------------------------------

test("features describe a listing as categorical tokens", () => {
  const tokens = features(listing({ noFee: true, neighborhood: "Chelsea" }));
  assert.ok(tokens.includes("hood:Chelsea"));
  assert.ok(tokens.includes("nofee:yes"));
  assert.ok(tokens.includes("beds:1"));
});

test("the model stays untrained until there is real signal", () => {
  assert.equal(train([]).trained, false);
  assert.equal(train([{ listing: listing(), liked: true }]).trained, false);
});

test("the model learns a neighborhood preference and explains itself", () => {
  const signals = [
    { listing: listing({ neighborhood: "West Village" }), liked: true },
    { listing: listing({ neighborhood: "West Village", unit: "2A" }), liked: true },
    { listing: listing({ neighborhood: "West Village", unit: "3B" }), liked: true },
    { listing: listing({ neighborhood: "Midtown", unit: "9Z" }), liked: false },
    { listing: listing({ neighborhood: "Midtown", unit: "8Y" }), liked: false },
  ];
  const model = train(signals);
  assert.equal(model.trained, true);

  const loved = score(listing({ neighborhood: "West Village" }), model, DEFAULT_CRITERIA);
  const meh = score(listing({ neighborhood: "Midtown" }), model, DEFAULT_CRITERIA);

  assert.ok(loved.score > meh.score, `${loved.score} should beat ${meh.score}`);
  assert.ok(loved.reasons.length > 0);
});

test("cold start falls back to criteria and still gives a reason", () => {
  const cold = train([]);
  const cheap = score(listing({ price: 2100 }), cold, DEFAULT_CRITERIA);
  const dear = score(listing({ price: 3990 }), cold, DEFAULT_CRITERIA);
  assert.ok(cheap.score > dear.score);
  assert.ok(cheap.reasons.length > 0);
});

// --- outreach -------------------------------------------------------------

function feed(over: Partial<FeedListing> = {}): FeedListing {
  return {
    ...listing(),
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    isActive: true,
    originalPrice: 3500,
    priceChangedAt: null,
    relistedAt: null,
    hasReply: false,
    alsoOn: [],
    stage: "inbox",
    stageChangedAt: null,
    starred: false,
    visitedAt: null,
    notes: "",
    followUpAt: null,
    myContactPhone: "",
    myContactEmail: "",
    myContactName: "",
    passReason: "",
    passedAt: null,
    applicationUrl: "",
    tourAt: null,
    tourKind: "private" as const,
    tourEndsAt: null,
    myScore: null,
    lean: 0,
    appResult: 0,
    secured: false,
    amenityMarks: {},
    addedById: null,
    pocId: null,
    contactCount: 0,
    lastContactAt: null,
    lastContactChannel: null,
    score: 80,
    scoreReasons: [],
    rating: 60,
    grade: "fair" as const,
    ratingHeadline: "",
    pros: [],
    cons: [],
    perks: [],
    daysOnMarket: 1,
    unseenEvents: 0,
    needsFollowUp: false,
    upfrontCost: 7020,
    dealVerdict: "market" as const,
    dealDelta: 0,
    dealLabel: "",
    flags: [],
    timing: "unknown" as const,
    timingLabel: "",
    effectiveRent: 3500,
    allInMonthly: 3502,
    priceHistory: [],
    ...over,
  };
}

test("the tour message names the address, the rent and the move-in date", () => {
  const message = draftTourMessage(feed(), {
    ...DEFAULT_PROFILE,
    name: "Jake",
    employer: "BetterCampus",
    moveInDate: "2026-09-01",
  });
  assert.match(message, /55 Morton Street #5J/);
  assert.match(message, /\$3,500/);
  assert.match(message, /Jake/);
  assert.match(message, /September 1/);
  // Qualifications belong to the packet, not to a first message asking for
  // a video — see "the opener does not read like an application".
  assert.doesNotMatch(message, /about me/i);
  // The small ask before the big one: video first, then the tour.
  assert.match(message, /video walkthrough/i);
  assert.match(message, /tour/i);
  assert.ok(message.indexOf("video") < message.indexOf("tour"));
});

test("the message greets the agent by first name when you know it", () => {
  const message = draftTourMessage(
    feed({ myContactName: "Jane at Corcoran" }),
    DEFAULT_PROFILE
  );
  assert.match(message, /^Hi Jane!/);
});

test("an empty profile still produces a sendable message", () => {
  const bare = { ...DEFAULT_PROFILE, employer: "", income: "", creditNote: "", proofs: [] };
  const message = draftTourMessage(feed(), bare);
  assert.match(message, /55 Morton Street/);
  assert.match(message, /video walkthrough/i);
});

test("the opener does not read like an application", () => {
  // Leading with income to someone who hasn't offered you anything yet reads
  // as pleading. The first ask is a ninety-second video, nothing more.
  const message = draftTourMessage(feed(), {
    ...DEFAULT_PROFILE,
    name: "Jake",
    employer: "BetterCampus",
    employment: "self_employed",
    income: "$240,000",
    proofs: ["2025 tax return", "proof of assets"],
  });
  assert.doesNotMatch(message, /\$240,000/);
  assert.doesNotMatch(message, /tax return/i);
  assert.doesNotMatch(message, /I own BetterCampus/);
  assert.doesNotMatch(message, /don't draw a salary/);
});

test("normalizePhone produces a dialable number", () => {
  assert.equal(normalizePhone("845-460-0910"), "+18454600910");
  assert.equal(normalizePhone("(212) 555 0134"), "+12125550134");
  assert.equal(normalizePhone(""), "");
});

test("smsLink works with and without a recipient", () => {
  assert.match(smsLink("845-460-0910", "hi"), /^sms:\+18454600910&body=hi$/);
  // No published phone: still open Messages with the draft ready.
  assert.match(smsLink("", "hi there"), /^sms:&body=hi%20there$/);
});

// --- qualifying as a business owner ---------------------------------------

test("a business owner with no salary names the gap and closes it", () => {
  const message = qualifyingLine({
    ...DEFAULT_PROFILE,
    name: "Jake",
    employer: "BetterCampus",
    employment: "self_employed",
    income: "",
    proofs: ["2025 tax return", "proof of assets", "business revenue"],
  });
  assert.match(message, /I own BetterCampus/);
  // The objection is answered in the message, not left for the landlord.
  assert.match(message, /don't draw a salary/);
  assert.match(message, /2025 tax return, proof of assets and business revenue/);
});

test("a salaried applicant does not get the no-salary caveat", () => {
  const message = qualifyingLine({
    ...DEFAULT_PROFILE,
    employer: "Acme",
    employment: "employed",
    income: "$180k/yr",
    proofs: ["recent paystubs"],
  });
  assert.match(message, /I work at Acme/);
  assert.match(message, /\$180k\/yr/);
  assert.doesNotMatch(message, /don't draw a salary/);
});

test("with no documents listed it still offers them on request", () => {
  const message = qualifyingLine({ ...DEFAULT_PROFILE, proofs: [] });
  assert.match(message, /on request/);
});

// --- adaptive outreach channel --------------------------------------------

test("the offered action matches what the listing actually has", () => {
  assert.equal(bestChannel({ contactPhone: "845-460-0910", url: "u" }).channel, "text");
  assert.equal(
    bestChannel({ contactPhone: "", contactEmail: "a@b.com", url: "u" }).channel,
    "email"
  );
  // The common case: no phone, no email — never offer a dead text button.
  assert.equal(bestChannel({ contactPhone: "", url: "u" }).channel, "portal");
});

test("income on the return is cited as documented, not self-reported", () => {
  const message = qualifyingLine({
    ...DEFAULT_PROFILE,
    employer: "BetterCampus",
    employment: "self_employed",
    income: "$240,000",
    proofs: ["2025 tax return", "proof of assets"],
  });
  assert.match(message, /I own BetterCampus/);
  assert.match(message, /2025 tax return shows \$240,000/);
  // Strength, not apology — and the return isn't listed twice.
  assert.doesNotMatch(message, /don't draw a salary/);
  assert.match(message, /proof of assets/);
  assert.equal(message.match(/tax return/g)?.length, 1);
});

// --- what you actually pay -------------------------------------------------

test("effective rent spreads free months across the lease term", () => {
  // $3,800 with 2 months free on a 14-month lease is really ~$3,257.
  assert.equal(
    effectiveRent({ price: 3800, monthsFree: 2, leaseMonths: 14 }),
    3257
  );
  // No concession means the sticker price is the real price.
  assert.equal(effectiveRent({ price: 3500 }), 3500);
  // The source's own net figure wins when it publishes one.
  assert.equal(
    effectiveRent({ price: 3800, monthsFree: 2, leaseMonths: 14, netEffectiveRent: 3300 }),
    3300
  );
  // A concession longer than the lease is nonsense; don't produce a free flat.
  assert.equal(effectiveRent({ price: 3500, monthsFree: 18, leaseMonths: 12 }), 3500);
});

test("move-in cost exposes the fee that monthly rent hides", () => {
  const withFee = { price: 3300, noFee: false };
  const noFee = { price: 3500, noFee: true };
  const assume = { ...DEFAULT_COSTS, brokerFeeMonths: 1 };

  const a = moveInCost(withFee, assume);
  const b = moveInCost(noFee, assume);
  // The cheaper-looking apartment costs more to actually move into.
  assert.ok(a.total > b.total, `${a.total} should exceed ${b.total}`);
  assert.ok(a.lines.some((l) => l.label === "Broker fee"));
  assert.ok(!b.lines.some((l) => l.label === "Broker fee"));
});

test("a deposit is not a cost, so it stays out of the monthly", () => {
  const cheap = allInMonthly({ price: 3000, noFee: true }, DEFAULT_COSTS);
  // Only the $20 application fee is sunk, spread over 12 months.
  assert.ok(cheap >= 3000 && cheap <= 3003, `got ${cheap}`);
});

test("move-in timing flags what can't be ready in time", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  assert.equal(moveInFit("2026-09-01", "2026-09-01", now).timing, "ready");
  assert.equal(moveInFit("2026-09-10", "2026-09-01", now).timing, "soon");
  assert.equal(moveInFit("2026-10-15", "2026-09-01", now).timing, "late");
  // Free since April and still listed: something is wrong with it.
  assert.equal(moveInFit("2026-04-01", "2026-09-01", now).timing, "stale");
  assert.equal(moveInFit(null, "2026-09-01", now).timing, "unknown");
});

// --- geography -------------------------------------------------------------

test("coordinates resolve to a neighborhood", () => {
  // 55 Morton Street, West Village.
  assert.equal(neighborhoodAt(40.7329, -74.0055), "West Village");
  // 52 Saint Marks Place, East Village.
  assert.equal(neighborhoodAt(40.7284, -73.9866), "East Village");
  // Middle of the Hudson: nothing is close enough to claim it.
  assert.equal(neighborhoodAt(40.73, -74.05), "");
  assert.equal(neighborhoodAt(null, null), "");
});

test("the search radius covers a neighborhood without swallowing the city", () => {
  const areas = ["west village", "east village", "chelsea", "flatiron"];
  // A West Village address is in.
  assert.ok(withinAreas(40.7329, -74.0025, areas));
  // Measured worst case: the furthest in-area listing sat 1.09km out.
  assert.ok(withinAreas(40.7329 + 0.0095, -74.0025, areas));
  // The Upper West Side is not a downtown neighborhood.
  assert.ok(!withinAreas(40.787, -73.9754, areas));
  // Neither is Brooklyn.
  assert.ok(!withinAreas(40.6702, -73.9812, areas));
});

test("in-bounds uses coordinates when it has them", () => {
  const criteria = { ...DEFAULT_CRITERIA, priceMin: 0, priceMax: 9000, bedMin: 0, bedMax: 4 };

  // Right place, but its text says nothing useful — coordinates carry it.
  const geoOnly = listing({ neighborhood: "", address: "no address", lat: 40.7329, lon: -74.0025 });
  assert.ok(inBounds(geoOnly, criteria));

  // Text claims West Village, coordinates say Upper West Side. Trust the map.
  const liar = listing({ neighborhood: "West Village", address: "1 West Village Way", lat: 40.787, lon: -73.9754 });
  assert.ok(!inBounds(liar, criteria));
});

test("without coordinates it still falls back to matching text", () => {
  const criteria = { ...DEFAULT_CRITERIA, priceMin: 0, priceMax: 9000, bedMin: 0, bedMax: 4 };
  // Craigslist rarely has coordinates, so the name has to be enough.
  const cl = listing({ source: "craigslist", neighborhood: "Chelsea", lat: null, lon: null });
  assert.ok(inBounds(cl, criteria));
  const elsewhere = listing({ source: "craigslist", neighborhood: "Astoria", address: "x", lat: null, lon: null });
  assert.ok(!inBounds(elsewhere, criteria));
});

// --- the New York clock ----------------------------------------------------

test("the phase tracks how the NYC listing cycle actually works", () => {
  // Six weeks out, the units listed are for earlier move-ins.
  assert.equal(phaseFor(50).phase, "early");
  // Four weeks out, your inventory is landing — this is the widest choice.
  assert.equal(phaseFor(28).phase, "prime");
  assert.equal(phaseFor(25).phase, "prime");
  // Two weeks out, the good ones from this batch are going.
  assert.equal(phaseFor(14).phase, "decide");
  assert.equal(phaseFor(8).phase, "crunch");
  assert.equal(phaseFor(2).phase, "final");
  assert.equal(phaseFor(-1).phase, "past");
});

test("progress runs left to right and every phase has advice", () => {
  const early = phaseFor(45);
  const late = phaseFor(2);
  assert.ok(early.progress < late.progress);
  assert.ok(early.progress >= 0 && late.progress <= 1);
  for (const days of [50, 28, 14, 8, 2]) {
    assert.ok(phaseFor(days).advice.length > 20, `no advice at ${days} days`);
  }
});

test("phase bands span the whole bar exactly once", () => {
  const total = phaseBands().reduce((sum, b) => sum + b.width, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `bands sum to ${total}`);
});

test("the funnel says how much outreach a lease actually takes", () => {
  const none = funnelFor([], 28);
  // Default rates compound to roughly one lease per 25-ish contacts.
  assert.ok(none.targetContacts >= 15 && none.targetContacts <= 60, `${none.targetContacts}`);
  // Nothing sent four weeks out is behind, and the app should say so.
  assert.equal(none.onPace, false);
  assert.ok(none.expectedByNow > 0);
});

test("your own reply rate replaces the assumption once there's data", () => {
  // 12 contacted, all still sitting at "contacted" — nobody replied.
  const contacted = Array.from({ length: 12 }, (_, i) =>
    feed({ id: `l${i}`, stage: "contacted", contactCount: 1, lastContactChannel: "email" })
  );
  const f = funnelFor(contacted, 20);
  assert.equal(f.usingOwnRates, true);
  assert.equal(f.contacted, 12);
  // A dismal reply rate means many more contacts are needed than the default.
  assert.ok(f.targetContacts > funnelFor([], 20).targetContacts);
});

test("today's actions lead with what's rotting", () => {
  const listings = [
    feed({ id: "a", needsFollowUp: true, stage: "contacted" }),
    feed({ id: "b", stage: "tour" }),
    feed({ id: "c", stage: "inbox", daysOnMarket: 1 }),
  ];
  const info = phaseFor(28);
  const actions = todaysActions(listings, funnelFor(listings, 28), info);
  // Silent leads first: they expire, and one nudge usually revives them.
  assert.equal(actions[0].key, "followUp");
  assert.ok(actions.some((a) => a.key === "tour"));
  assert.ok(actions.some((a) => a.key === "new"));
});

test("scouting week doesn't nag about pace", () => {
  // Six weeks out there is nothing worth contacting yet, so no pace warning.
  const actions = todaysActions([], funnelFor([], 50), phaseFor(50));
  assert.ok(!actions.some((a) => a.key === "pace"));
});

// --- is it a good price, and is it real? -----------------------------------

const CORPUS = [
  // Nine East Village 1-beds, median 3400.
  ...[3000, 3200, 3300, 3350, 3400, 3450, 3600, 3800, 4000].map((price) => ({
    neighborhood: "East Village", borough: "Manhattan", bedrooms: 1, price,
  })),
];

test("comparisons are drawn from genuinely similar listings", () => {
  const stats = statsFor(
    { neighborhood: "East Village", borough: "Manhattan", bedrooms: 1 },
    CORPUS
  );
  assert.ok(stats);
  assert.equal(stats!.median, 3400);
  assert.equal(stats!.count, 9);
  assert.match(stats!.scope, /East Village 1-beds/);
});

test("a thin comparison set widens instead of lying", () => {
  // Only two Flatiron studios: not enough to claim a median, so fall back.
  const thin = [
    { neighborhood: "Flatiron", borough: "Manhattan", bedrooms: 0, price: 3000 },
    { neighborhood: "Flatiron", borough: "Manhattan", bedrooms: 0, price: 3200 },
    ...CORPUS,
  ];
  const stats = statsFor(
    { neighborhood: "Flatiron", borough: "Manhattan", bedrooms: 0 },
    thin
  );
  // Nothing comparable at all -> say so rather than average two listings.
  assert.equal(stats, null);
});

test("the verdict says how far off market a price is", () => {
  const stats = statsFor({ neighborhood: "East Village", borough: "Manhattan", bedrooms: 1 }, CORPUS);
  assert.equal(readDeal(3400, stats).verdict, "market");
  assert.equal(readDeal(3000, stats).verdict, "good");   // ~12% under
  assert.equal(readDeal(2600, stats).verdict, "steal");  // ~24% under
  assert.equal(readDeal(4200, stats).verdict, "high");   // ~24% over
  // The scope is always stated, so the number can be judged.
  assert.match(readDeal(3000, stats).label, /median of 9 East Village 1-beds/);
});

test("with no comparable listings it declines to guess", () => {
  const deal = readDeal(3400, null);
  assert.equal(deal.verdict, "unknown");
  assert.match(deal.label, /Not enough/);
});

test("an impossibly cheap listing gets flagged, not celebrated", () => {
  const stats = statsFor({ neighborhood: "East Village", borough: "Manhattan", bedrooms: 1 }, CORPUS);
  const deal = readDeal(1900, stats); // 44% under median
  const flags = flagsFor(feed({ neighborhood: "East Village", price: 1900 }), deal);
  const bait = flags.find((f) => f.kind === "too-cheap");
  assert.ok(bait, "should flag a 44%-under listing");
  assert.equal(bait!.severity, "warn");
  assert.match(bait!.message, /never wire a deposit/);
});

test("a listing with no street number can't be matched to a building", () => {
  const flags = flagsFor(
    feed({ address: "Sunny renovated 1BR must see!!", imageUrl: null }),
    readDeal(3400, null)
  );
  assert.ok(flags.some((f) => f.kind === "vague-address" && f.severity === "warn"));
  assert.ok(flags.some((f) => f.kind === "no-photos"));
});

test("an ordinary listing carries no warnings", () => {
  const stats = statsFor({ neighborhood: "East Village", borough: "Manhattan", bedrooms: 1 }, CORPUS);
  const flags = flagsFor(
    feed({ address: "55 Morton Street", imageUrl: "x", neighborhood: "East Village", daysOnMarket: 3 }),
    readDeal(3400, stats)
  );
  assert.equal(flags.filter((f) => f.severity === "warn").length, 0);
});

test("a house number is not just any digit", () => {
  assert.ok(hasStreetNumber("55 Morton Street"));
  assert.ok(hasStreetNumber("417 E 57th St APT 11C"));
  assert.ok(hasStreetNumber("1 Wall St"));
  // Listing titles are full of numbers that aren't addresses.
  assert.ok(!hasStreetNumber("Sunny renovated 1BR must see!!"));
  assert.ok(!hasStreetNumber("24hr doorman, 2 bath, no fee"));
  assert.ok(!hasStreetNumber("Great deal , East village , heat included"));
  assert.ok(!hasStreetNumber(""));
});

test("a Craigslist title never poses as an address for deduping", () => {
  // Two unrelated posts that both happen to contain digits must not merge.
  const a = listing({ id: "craigslist-1", source: "craigslist", sourceId: "1", address: "Sunny 1BR in EV", unit: "" });
  const b = listing({ id: "craigslist-2", source: "craigslist", sourceId: "2", address: "Bright 1BR near park", unit: "" });
  assert.ok(fingerprint(a).startsWith("id:"));
  assert.ok(fingerprint(b).startsWith("id:"));
  assert.notEqual(fingerprint(a), fingerprint(b));
});

// --- bed and bath combinations ---------------------------------------------

test("bathrooms are a floor, not an exact match", () => {
  const twoByTwo = { ...DEFAULT_CRITERIA, areas: [], bedMin: 2, bedMax: 2, bathMin: 2,
    priceMin: 0, priceMax: 9000 };

  // Exactly 2B2B qualifies.
  assert.ok(inBounds(listing({ bedrooms: 2, bathrooms: 2 }), twoByTwo));
  // So does a 2-bed with more bathrooms — nobody searching 2B2B rejects 2B3B.
  assert.ok(inBounds(listing({ bedrooms: 2, bathrooms: 3 }), twoByTwo));
  // A 2B1B does not.
  assert.ok(!inBounds(listing({ bedrooms: 2, bathrooms: 1 }), twoByTwo));
});

test("2B1B and 2B2B are different searches", () => {
  const oneBath = { ...DEFAULT_CRITERIA, bedMin: 2, bedMax: 2, bathMin: 1 };
  const twoBath = { ...DEFAULT_CRITERIA, bedMin: 2, bedMax: 2, bathMin: 2 };
  // They must not collapse to one scrape, which is what the key controls.
  assert.notEqual(searchKey(oneBath), searchKey(twoBath));
  assert.match(searchKey(twoBath), /baths:2/);
  // No bath requirement leaves the key clean rather than encoding a zero.
  assert.ok(!searchKey({ ...DEFAULT_CRITERIA, bathMin: 0 }).includes("baths:"));
});

test("half baths survive normalization", () => {
  assert.equal(normalizeCriteria({ bathMin: 1.5 }).bathMin, 1.5);
  assert.equal(normalizeCriteria({ bathMin: 1.4 }).bathMin, 1.5);
  assert.equal(normalizeCriteria({ bathMin: -3 }).bathMin, 0);
  assert.equal(normalizeCriteria({}).bathMin, 0);
});

test("a listing with no bath count fails an explicit bath requirement", () => {
  const needsTwo = { ...DEFAULT_CRITERIA, areas: [], bedMin: 0, bedMax: 4, bathMin: 2,
    priceMin: 0, priceMax: 9000 };
  assert.ok(!inBounds(listing({ bathrooms: Number.NaN }), needsTwo));
  // But with no requirement, unknown bath counts are fine.
  assert.ok(inBounds(listing({ bathrooms: Number.NaN }), { ...needsTwo, bathMin: 0 }));
});

test("every layout preset is a coherent search", () => {
  for (const preset of LAYOUT_PRESETS) {
    const c = normalizeCriteria(preset);
    assert.ok(c.bedMin >= 0, preset.label);
    if (c.bedMax != null) assert.ok(c.bedMax >= c.bedMin, `${preset.label} bed range`);
    assert.ok(c.bathMin >= 0, `${preset.label} baths`);
  }
});

test("an unreadable poll history must not mean 'poll now'", () => {
  // Guarding a documented invariant: with ~5 requests a poll and 250 a month,
  // defaulting to "due" on an error would spend the budget in under two days.
  const source = readFileSync("src/lib/apikey.ts", "utf8");
  assert.match(source, /if \(!read\) return \{ due: false/);
});

// --- key runway --------------------------------------------------------------

test("the runway estimate reacts to the schedule", () => {
  // 250 left, 5 requests a poll: twice a day lasts 25 days, 8x/day lasts 6.
  assert.equal(runwayDays(250, 2, 5), 25);
  assert.equal(runwayDays(250, 8, 5), 6);
  // Checking more often must never *extend* the estimate.
  const paces = [1, 2, 4, 8].map((c) => runwayDays(250, c, 5)!);
  for (let i = 1; i < paces.length; i++) assert.ok(paces[i] <= paces[i - 1]);
});

test("manual-only has no expiry date", () => {
  assert.equal(runwayDays(250, 0, 5), null);
});

test("an exhausted key reads as zero days, not negative", () => {
  assert.equal(runwayDays(0, 2, 5), 0);
});

// --- amenities ------------------------------------------------------------

test("in-unit laundry is not confused with a shared basement machine", () => {
  const inUnit = amenitiesOf({
    amenities: ["Laundry: In Unit"],
    description: "",
    address: "",
  });
  const shared = amenitiesOf({
    amenities: ["Laundry: Shared"],
    description: "",
    address: "",
  });

  assert.ok(inUnit.includes("laundry_unit"));
  assert.ok(!inUnit.includes("laundry_building"), "in-unit implies building, saying both is noise");
  assert.ok(shared.includes("laundry_building"));
  assert.ok(!shared.includes("laundry_unit"));
});

test("amenities are found in free text as well as the amenity list", () => {
  const found = amenitiesOf({
    amenities: [],
    description: "Sun-drenched top floor with a private terrace and a dishwasher.",
    address: "",
  });
  assert.ok(found.includes("light"));
  assert.ok(found.includes("outdoor"));
  assert.ok(found.includes("dishwasher"));
});

test("amenities come back in decision order, not source order", () => {
  const found = amenitiesOf({
    amenities: ["Gym", "Elevator", "Laundry: In Unit"],
    description: "",
    address: "",
  });
  assert.deepEqual(found, ["laundry_unit", "elevator", "gym"]);
});

test("more amenities is a higher quality score", () => {
  assert.ok(qualityScore(["laundry_unit", "outdoor"]) > qualityScore(["gym"]));
  assert.equal(qualityScore([]), 0);
});

// --- the rating -----------------------------------------------------------

test("a cheap well-equipped flat rates above an expensive bare one", () => {
  const good = verdictFor(
    feed({
      dealVerdict: "good",
      dealDelta: -15,
      perks: ["laundry_unit", "dishwasher", "elevator", "outdoor"],
      allInMonthly: 3000,
    }),
    { ...DEFAULT_CRITERIA, priceMax: 3500 }
  );
  const bad = verdictFor(
    feed({
      dealVerdict: "high",
      dealDelta: 18,
      perks: [],
      allInMonthly: 3900,
    }),
    { ...DEFAULT_CRITERIA, priceMax: 3500 }
  );

  assert.ok(good.rating > bad.rating, `${good.rating} should beat ${bad.rating}`);
  assert.equal(good.grade, "excellent");
  assert.ok(good.pros.some((p) => /washer/i.test(p)));
  assert.ok(bad.cons.some((c) => /over budget/i.test(c)));
});

test("price alone can't carry a listing that describes itself and has nothing", () => {
  // Both listings say plenty about themselves, so the amenity component is
  // judged on both and the comparison is about the apartment, not about our
  // missing data.
  const blurb = "A".repeat(120);
  const base = {
    dealVerdict: "steal" as const,
    dealDelta: -22,
    allInMonthly: 3000,
    description: blurb,
  };
  const loaded = verdictFor(
    feed({ ...base, perks: ["laundry_unit", "dishwasher", "elevator"] }),
    DEFAULT_CRITERIA
  );
  const bare = verdictFor(feed({ ...base, perks: [] }), DEFAULT_CRITERIA);

  assert.ok(loaded.rating > bare.rating, "amenities have to move the number");
  assert.ok(bare.cons.some((c) => /laundry/i.test(c)));
});

test("renovation claims and subway distance move the rating", () => {
  const base = {
    dealVerdict: "good" as const,
    dealDelta: -10,
    allInMonthly: 3000,
    perks: ["laundry_unit"] as FeedListing["perks"],
  };
  const shiny = verdictFor(
    feed({ ...base, description: "Gut renovated with stainless steel appliances. ".repeat(4) }),
    DEFAULT_CRITERIA
  );
  const tired = verdictFor(
    feed({ ...base, description: "Sold as-is, needs TLC, bring your contractor. ".repeat(4) }),
    DEFAULT_CRITERIA
  );
  assert.ok(shiny.rating > tired.rating, `${shiny.rating} should beat ${tired.rating}`);
  assert.ok(shiny.pros.some((p) => /renovated/i.test(p)));
  assert.ok(tired.cons.some((c) => /needs work/i.test(c)));

  // 55 Morton (fixture coords) is minutes from the 1; the middle of nowhere
  // has no station and the location component sits out rather than punishing.
  const nowhere = verdictFor(
    feed({ ...base, lat: null, lon: null, description: "A".repeat(120) }),
    DEFAULT_CRITERIA
  );
  assert.ok(Number.isFinite(nowhere.rating));
});

test("a listing that says nothing isn't punished for our missing data", () => {
  // A sparse listing and a described-but-bare one are different claims. Only
  // the second is evidence the apartment lacks anything.
  const base = { dealVerdict: "good" as const, dealDelta: -10, allInMonthly: 3000, perks: [] };
  const silent = verdictFor(feed({ ...base, description: "", amenities: [] }), DEFAULT_CRITERIA);
  const describedBare = verdictFor(
    feed({ ...base, description: "A".repeat(120) }),
    DEFAULT_CRITERIA
  );

  assert.ok(
    silent.rating > describedBare.rating,
    `silent ${silent.rating} should not score below described-bare ${describedBare.rating}`
  );
  assert.ok(silent.cons.some((c) => /says almost nothing/i.test(c)));
  assert.ok(!silent.cons.some((c) => /No laundry/i.test(c)), "can't claim an absence we never saw");
});

test("the grade bands put most of the market in the middle", () => {
  // The bands exist to separate a market, not to condemn it. Guard the shape:
  // the bottom band must not be where most listings land.
  assert.equal(gradeOf(80), "excellent");
  assert.equal(gradeOf(60), "strong");
  assert.equal(gradeOf(48), "fair");
  assert.equal(gradeOf(30), "weak");
  // The observed median of the live corpus sits at 48 and must not read weak.
  assert.notEqual(gradeOf(48), "weak");
});

test("a bait-priced listing is penalised rather than rewarded", () => {
  const flagged = verdictFor(
    feed({
      dealVerdict: "steal",
      dealDelta: -45,
      perks: ["laundry_unit"],
      flags: [{ kind: "too-cheap", message: "Priced 45% below similar listings. Often bait.", severity: "warn" }],
    }),
    DEFAULT_CRITERIA
  );
  const clean = verdictFor(
    feed({ dealVerdict: "steal", dealDelta: -45, perks: ["laundry_unit"], flags: [] }),
    DEFAULT_CRITERIA
  );

  assert.ok(flagged.rating < clean.rating);
  assert.equal(flagged.headline, "Verify first");
});

test("a listing with no comparable listings is not punished for our missing data", () => {
  const unknown = verdictFor(
    feed({ dealVerdict: "unknown", dealDelta: 0, perks: ["laundry_unit", "dishwasher"] }),
    DEFAULT_CRITERIA
  );
  assert.ok(unknown.rating >= 45, `scored ${unknown.rating} with nothing wrong with it`);
});

test("every rating lands inside 1-100 whatever the inputs", () => {
  for (const over of [
    { dealDelta: -90, allInMonthly: 0 },
    { dealDelta: 300, allInMonthly: 99_000 },
    { score: null },
  ] as Partial<FeedListing>[]) {
    const { rating } = verdictFor(feed(over), DEFAULT_CRITERIA);
    assert.ok(rating >= 1 && rating <= 100, `got ${rating}`);
    assert.ok(Number.isFinite(rating));
  }
});

// --- filters --------------------------------------------------------------

test("filtering by source is any-of, not all-of", () => {
  const list = [
    feed({ id: "a", alsoOn: [{ source: "zillow", url: "u" }] }),
    feed({ id: "b", alsoOn: [{ source: "craigslist", url: "u" }] }),
  ];
  const hits = applyFilters(list, { stage: "all", sources: ["zillow", "hotpads"] });
  assert.deepEqual(hits.map((l) => l.id), ["a"]);
});

test("the default view hides what you've passed on", () => {
  const list = [feed({ id: "keep" }), feed({ id: "gone", stage: "passed" })];
  assert.deepEqual(
    applyFilters(list, {}).map((l) => l.id),
    ["keep"]
  );
});

test("a toured-and-declined place hides from browsing but not from 'everything'", () => {
  // "no_go" is the board's loss column: browsing ("all" or default) respects
  // the decision and hides it; "active" treats it as settled; "everything" is
  // what the board fetches, and the board needs its losses.
  const list = [
    feed({ id: "live", stage: "interested" }),
    feed({ id: "loss", stage: "no_go" }),
    feed({ id: "gone", stage: "passed" }),
  ];
  assert.deepEqual(applyFilters(list, { stage: "all" }).map((l) => l.id), ["live"]);
  assert.deepEqual(applyFilters(list, { stage: "active" }).map((l) => l.id), ["live"]);
  assert.deepEqual(
    applyFilters(list, { stage: "everything" }).map((l) => l.id).sort(),
    ["gone", "live", "loss"]
  );
  // Asking for the stage by name still works.
  assert.deepEqual(applyFilters(list, { stage: "no_go" }).map((l) => l.id), ["loss"]);
});

test("sorting on 'best' uses the rating the user actually sees", () => {
  const list = [feed({ id: "low", rating: 30 }), feed({ id: "high", rating: 90 })];
  assert.deepEqual(
    applyFilters(list, { sort: "best" }).map((l) => l.id),
    ["high", "low"]
  );
});

test("search matches address, neighborhood and your own notes", () => {
  const list = [
    feed({ id: "a", address: "55 Morton Street" }),
    feed({ id: "b", address: "1 Other Ave", neighborhood: "Chelsea" }),
    feed({ id: "c", address: "2 Third St", notes: "great morton light" }),
  ];
  assert.deepEqual(
    applyFilters(list, { search: "morton" }).map((l) => l.id).sort(),
    ["a", "c"]
  );
  assert.deepEqual(applyFilters(list, { search: "  " }).length, 3);
});

// --- neighborhood polygons -----------------------------------------------

test("a coordinate resolves to the neighborhood it is actually in", () => {
  // 545 East 12th Street — the nearest-centroid method called this
  // Stuyvesant Town, which is across 14th Street.
  assert.equal(neighborhoodInPolygon(40.7292, -73.9789)?.neighborhood, "East Village");
  // 348 West 21st Street, squarely in Chelsea.
  assert.equal(neighborhoodInPolygon(40.7449, -74.0003)?.neighborhood, "Chelsea");
});

test("polygon names are the ones the app lets you search for", () => {
  // The city calls this "Midtown South-Flatiron-Union Square".
  const hit = neighborhoodInPolygon(40.7401, -73.9903);
  assert.ok(hit);
  assert.ok(!hit!.neighborhood.includes("-"), `got administrative name "${hit!.neighborhood}"`);
});

test("a point in the water belongs to no neighborhood", () => {
  // Mid-Hudson, west of Chelsea. Inventing a label here is exactly how the
  // centroid approach produced confident wrong answers.
  assert.equal(neighborhoodInPolygon(40.745, -74.02), null);
});

test("locate falls back rather than returning nothing for an odd point", () => {
  const hit = locate(40.7292, -73.9789);
  assert.equal(hit.neighborhood, "East Village");
  assert.equal(hit.borough, "Manhattan");
});

// --- config without a session ---------------------------------------------

test("a stored key beats the environment fallback", () => {
  // The scheduled poll has no session, so it used to read no stored config at
  // all and fall through to process.env — which held the previous, exhausted
  // key. Merge order is what makes a key pasted in the app actually take
  // effect on the next automatic check.
  const stored = { realtyApiKey: "rt_new", pagesPerSource: 2 };
  const merged = {
    ...DEFAULT_CONFIG,
    ...stored,
    realtyApiKey: stored.realtyApiKey || "rt_env_stale",
  };
  assert.equal(merged.realtyApiKey, "rt_new");
  assert.equal(merged.pagesPerSource, 2, "saved page depth must survive the merge");
});

test("the environment key is used only when nothing is stored", () => {
  const stored: Partial<typeof DEFAULT_CONFIG> = {};
  const merged = {
    ...DEFAULT_CONFIG,
    ...stored,
    realtyApiKey: stored.realtyApiKey || "rt_env",
  };
  assert.equal(merged.realtyApiKey, "rt_env");
});

test("inside withConfig, every nested loadConfig sees the acting user's key", async () => {
  // The cron polls one user at a time; the fetchers deep inside each poll call
  // loadConfig themselves. The acting context must reach them — the bug this
  // pins was the scheduled poll billing everyone's searches to whichever user
  // saved a key most recently.
  const acting = { ...DEFAULT_CONFIG, realtyApiKey: "rt_actingUserKey000000" };
  const seen = await withConfig(acting, async () => {
    const inner = await loadConfig();
    return inner.realtyApiKey;
  });
  assert.equal(seen, "rt_actingUserKey000000");

  // Outside the context there is no session in a test, and the answer must
  // never be some other user's stored key — env default or nothing.
  const outside = await loadConfig();
  assert.notEqual(outside.realtyApiKey, "rt_actingUserKey000000");
});

test("keyHint identifies a key without exposing it", () => {
  assert.equal(keyHint("rt_EXAMPLEKEYNOTREAL123456"), "…123456");
  assert.equal(keyHint(""), "none");
  // Two different keys must produce different hints, or usage from an old key
  // would be counted against a new one.
  assert.notEqual(keyHint("rt_aaaaaaaaaaaaaaaaaaaa"), keyHint("rt_bbbbbbbbbbbbbbbbbbbb"));
});

// --- upsert batches --------------------------------------------------------

/** Mirror of ingest.ts's dedupeBy — see the note on that function. */
function dedupeForUpsert<T>(rows: T[], key: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(key(row), row);
  return [...byKey.values()];
}

test("an upsert batch never carries the same conflict key twice", () => {
  // Postgres rejects an ON CONFLICT DO UPDATE that would touch one row twice,
  // and rejects the entire statement with it — so a single collision used to
  // discard a whole poll. Two fingerprint groups collapse onto one id whenever
  // their sources already point at the same stored listing.
  const rows = [
    { id: "a", price: 3000 },
    { id: "b", price: 3100 },
    { id: "a", price: 3200 },
  ];
  const out = dedupeForUpsert(rows, (r) => r.id);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.id).sort(), ["a", "b"]);
  // Last wins: both rows describe the same apartment, and the later one came
  // from the richer source after merging.
  assert.equal(out.find((r) => r.id === "a")!.price, 3200);
});

test("dedupe keys on the whole conflict target, not one column", () => {
  const rows = [
    { source: "zillow", source_id: "1" },
    { source: "hotpads", source_id: "1" },
    { source: "zillow", source_id: "1" },
  ];
  const out = dedupeForUpsert(rows, (r) => `${r.source}:${r.source_id}`);
  assert.equal(out.length, 2, "same id on two sites is two different rows");
});

// --- what to offer, given the state ---------------------------------------

test("a booked tour with no time asks for the time, not another message", () => {
  const a = nextAction(feed({ stage: "tour", tourAt: null }));
  assert.equal(a.kind, "schedule");
  assert.match(a.label, /time/i);
  assert.ok(a.urgent, "a tour without a time is the thing to fix now");
});

test("a booked tour with a time shows the time", () => {
  const at = new Date(Date.now() + 3 * 86_400_000);
  at.setHours(15, 30, 0, 0);
  const a = nextAction(feed({ stage: "tour", tourAt: at.toISOString() }));
  assert.equal(a.kind, "tour");
  assert.match(a.label, /\d/, `expected a time, got "${a.label}"`);
  assert.ok(!/request a tour/i.test(a.label), "must not re-offer a tour already booked");
});

test("a passed tour offers the next step rather than the old one", () => {
  const a = nextAction(feed({ stage: "tour", tourAt: new Date(Date.now() - 86_400_000).toISOString() }));
  assert.equal(a.becomes, "toured");
});

test("nothing already done is ever offered again", () => {
  for (const stage of ["contacted", "applied", "closed"] as const) {
    const a = nextAction(feed({ stage }));
    assert.ok(
      !/request a tour|text for a tour/i.test(a.label),
      `${stage} offered "${a.label}"`
    );
  }
});

test("silence after contacting turns into a chase", () => {
  const quiet = nextAction(feed({ stage: "contacted", needsFollowUp: true }));
  assert.equal(quiet.kind, "chase");
  assert.ok(quiet.urgent);
  const waiting = nextAction(feed({ stage: "contacted", needsFollowUp: false }));
  assert.equal(waiting.kind, "wait");
});

test("a listing with no way to reach anyone asks for a number", () => {
  const a = nextAction(feed({ stage: "interested", contactPhone: "", contactEmail: "" }));
  assert.equal(a.kind, "add-contact");
});

// --- contact details you supplied yourself --------------------------------

test("your own number wins over whatever the listing published", () => {
  const both = reachableOn({ contactPhone: "212-000-0000", myContactPhone: "212-555-0134" });
  assert.equal(both.phone, "212-555-0134");
  assert.ok(both.mine);

  // And it turns a dead-end listing into a textable one, which is the whole
  // point: nothing in the live corpus publishes a phone number.
  const rescued = feed({ contactPhone: "", myContactPhone: "212-555-0134" });
  assert.equal(bestChannel(rescued).channel, "text");
  assert.equal(nextAction(rescued).kind, "reach");
});

test("a published number is still used when you haven't added one", () => {
  const from = reachableOn({ contactPhone: "212-000-0000", contactName: "Jane" });
  assert.equal(from.phone, "212-000-0000");
  assert.equal(from.who, "Jane");
  assert.ok(!from.mine);
});

test("whitespace is not a contact", () => {
  const blank = reachableOn({ contactPhone: "", myContactPhone: "   " });
  assert.equal(blank.phone, "");
  assert.equal(nextAction(feed({ stage: "interested", myContactPhone: "  " })).kind, "add-contact");
});

// --- tour prep questions ---------------------------------------------------

test("ground floor detection reads unit strings the way buildings label them", () => {
  assert.equal(looksGroundFloor("1B"), true);
  assert.equal(looksGroundFloor("#1F"), true);
  assert.equal(looksGroundFloor("G2"), true);
  assert.equal(looksGroundFloor("GARDEN"), true);
  assert.equal(looksGroundFloor("10C"), false); // "1" prefix must not match "10"
  assert.equal(looksGroundFloor("5J"), false);
  assert.equal(looksGroundFloor("", "Sunny garden-level one bedroom"), true);
});

test("tour questions come from this listing's gaps, not a generic checklist", () => {
  // Described but bare: no laundry, no elevator → the two classic asks.
  const bare = tourQuestions(
    feed({ description: "x".repeat(100), perks: [], unit: "5J" })
  );
  assert.ok(bare.some((q) => q.ask.toLowerCase().includes("laundromat")));
  assert.ok(bare.some((q) => q.ask.toLowerCase().includes("flights")));

  // Building laundry swaps the laundromat ask for the machines ask.
  const bldg = tourQuestions(
    feed({ description: "x".repeat(100), perks: ["laundry_building"], unit: "5J" })
  );
  assert.ok(!bldg.some((q) => q.ask.toLowerCase().includes("laundromat")));
  assert.ok(bldg.some((q) => q.ask.toLowerCase().includes("machines")));

  // Ground floor asks who's above, and ranks it first.
  const ground = tourQuestions(feed({ unit: "1B", description: "x".repeat(100) }));
  assert.ok(ground[0].ask.includes("above"));

  // A concession begets the net-vs-gross question; no-fee kills the fee one.
  const teaser = tourQuestions(feed({ effectiveRent: 3200, noFee: true }));
  assert.ok(teaser.some((q) => q.ask.includes("gross")));
  assert.ok(!teaser.some((q) => q.because.includes("no-fee")));

  // The list stays short enough to read at a door.
  assert.ok(tourQuestions(feed({ unit: "1B", description: "x".repeat(100) })).length <= 6);
});

// --- the renter's edges -----------------------------------------------------

test("addresses convert to the city's own HPD spelling", () => {
  // Probed against the live dataset: HPD writes "EAST 35 STREET".
  assert.deepEqual(hpdAddress("330 East 35th Street"), {
    houseNumber: "330",
    street: "EAST 35 STREET",
  });
  assert.deepEqual(hpdAddress("91 E 3rd St"), {
    houseNumber: "91",
    street: "EAST 3 STREET",
  });
  assert.deepEqual(hpdAddress("955 Metropolitan Ave"), {
    houseNumber: "955",
    street: "METROPOLITAN AVENUE",
  });
  // "St" mid-name is a saint, not a street suffix.
  assert.deepEqual(hpdAddress("120 St Marks Pl"), {
    houseNumber: "120",
    street: "ST MARKS PLACE",
  });
  assert.equal(hpdAddress("no number here"), null);
});

test("negotiation stance follows the comps", () => {
  const base = { address: "5 Test St", price: 4000, bedrooms: 1 };
  const over = negotiationScript({ ...base, dealDelta: 10, dealVerdict: "high" });
  assert.equal(over.stance, "push");
  assert.ok(over.message?.includes("$3,636") || over.message?.includes("3,6"));

  const steal = negotiationScript({ ...base, dealDelta: -15, dealVerdict: "steal" });
  assert.equal(steal.stance, "move-fast");
  assert.equal(steal.message, undefined); // no script for a place you should grab

  const market = negotiationScript({ ...base, dealDelta: 0, dealVerdict: "market" });
  assert.equal(market.stance, "nudge");
  assert.ok(market.message?.includes("free month"));
});

test("the 40× rule math is exact and income parsing is forgiving", () => {
  assert.equal(incomeToAnnual("$140,000"), 140000);
  assert.equal(incomeToAnnual("95k"), 95000);
  assert.equal(incomeToAnnual(""), null);
  assert.equal(incomeToAnnual("call me"), null);

  const short = qualifyCheck(3500, 120000);
  assert.equal(short.ok, false);
  assert.equal(short.needed, 140000);
  assert.equal(short.gap, 20000);
  assert.equal(qualifyCheck(2500, 120000).ok, true);
});

test("broker memory matches on the phone, however it's formatted", () => {
  const a = feed({ id: "a", contactPhone: "(212) 555-0134", contactName: "Josh" });
  const b = feed({ id: "b", address: "9 Other St", myContactPhone: "1-212-555-0134", stage: "contacted" });
  const c = feed({ id: "c", contactPhone: "(917) 555-9999" });
  const known = brokerHistory([a, b, c], a);
  assert.equal(known?.others.length, 1);
  assert.equal(known?.others[0].id, "b");
  // No number, no memory — names are too overloaded to match on.
  assert.equal(brokerHistory([a, b], feed({ id: "d", contactPhone: "" })), null);
});

test("commute estimates walk short hops and ride long ones", () => {
  // East Village to Midtown East: a real train ride, not a walk.
  const ride = commuteMinutes({ lat: 40.7265, lon: -73.9815 }, { lat: 40.7527, lon: -73.9772 });
  assert.ok(ride && ride.minutes >= 15 && ride.minutes <= 45, `got ${ride?.minutes}`);
  assert.ok(ride?.breakdown.includes("train"));

  // Two blocks apart: say "walk", never route a subway.
  const walk = commuteMinutes({ lat: 40.7265, lon: -73.9815 }, { lat: 40.728, lon: -73.983 });
  assert.ok(walk && walk.minutes <= 18);
  assert.ok(walk?.breakdown.includes("walk"));

  const nowhere = commuteMinutes({ lat: null, lon: null }, { lat: 40.75, lon: -73.98 });
  assert.equal(nowhere, null);
});

test("a declined place never proposes re-courting the agent", () => {
  const action = nextAction(feed({ stage: "no_go", passReason: "Fifth-floor walkup" }));
  assert.equal(action.kind, "done");
  assert.equal(action.hint, "Fifth-floor walkup");
  assert.equal(action.becomes, undefined);
});

// --- searching for an address ---------------------------------------------

test("an address matches however it's abbreviated", () => {
  const list = [feed({ id: "a", address: "91 East Third Street" })];
  for (const q of ["91 East Third Street", "91 E 3rd", "91 e third st", "91 East 3rd Street"]) {
    assert.equal(applyFilters(list, { search: q }).length, 1, `"${q}" found nothing`);
  }
});

test("words can be typed in any order", () => {
  const list = [feed({ id: "a", address: "55 Morton Street", unit: "5J" })];
  assert.equal(applyFilters(list, { search: "morton 5j" }).length, 1);
  assert.equal(applyFilters(list, { search: "5j morton" }).length, 1);
});

test("search still reaches neighborhoods and your own notes", () => {
  const list = [
    feed({ id: "a", address: "1 A St", neighborhood: "East Village" }),
    feed({ id: "b", address: "2 B St", notes: "great morning light" }),
  ];
  assert.deepEqual(applyFilters(list, { search: "east village" }).map((l) => l.id), ["a"]);
  assert.deepEqual(applyFilters(list, { search: "morning" }).map((l) => l.id), ["b"]);
});

test("a search that matches nothing returns nothing, not everything", () => {
  const list = [feed({ id: "a", address: "91 East Third Street" })];
  assert.equal(applyFilters(list, { search: "500 Fifth Avenue" }).length, 0);
});

// --- quick-add paste matching ----------------------------------------------

test("a pasted listing link matches by pathname, tracking junk and all", () => {
  const list = [
    feed({ id: "a", url: "https://streeteasy.com/building/foo/12" }),
    feed({ id: "b", url: "https://www.zillow.com/homedetails/91-e-3rd/456_zpid/" }),
  ];
  assert.equal(
    findPasted(list, "https://streeteasy.com/building/foo/12?utm_source=txt&featured=1")?.id,
    "a"
  );
  // Trailing slash and host casing are presentation, not identity.
  assert.equal(
    findPasted(list, "HTTPS://WWW.ZILLOW.COM/homedetails/91-e-3rd/456_zpid")?.id,
    "b"
  );
});

test("a pasted link also matches the same apartment on another site", () => {
  const list = [
    feed({
      id: "a",
      url: "https://streeteasy.com/building/foo/12",
      alsoOn: [{ source: "zillow", url: "https://www.zillow.com/homedetails/foo/9_zpid" }],
    }),
  ];
  assert.equal(
    findPasted(list, "https://www.zillow.com/homedetails/foo/9_zpid")?.id,
    "a"
  );
});

test("a site's front page is not a listing and matches nothing", () => {
  const list = [feed({ id: "a", url: "https://streeteasy.com/" })];
  assert.equal(findPasted(list, "https://streeteasy.com/"), undefined);
  assert.equal(findPasted(list, "https://streeteasy.com/for-rent"), undefined);
});

test("a link to an untracked copy still finds the same apartment from another site", () => {
  // Tracked from Zillow only; the paste is the StreetEasy tab. The slug
  // spells the address, and that has to be enough.
  const list = [
    feed({ id: "z3a", address: "239 E 10th St APT 3A", unit: "3A", url: "https://www.zillow.com/homedetails/112086548_zpid/" }),
  ];
  assert.equal(
    findPasted(list, "https://streeteasy.com/building/239-east-10-street-new_york/3a?from_map=1&lstt=junk")?.id,
    "z3a"
  );
  // And the other direction: a Zillow link against a StreetEasy-tracked row.
  const se = [
    feed({ id: "se", address: "239 East 10th Street", unit: "3A", url: "https://streeteasy.com/building/239-east-10-street-new_york/3a" }),
  ];
  assert.equal(
    findPasted(se, "https://www.zillow.com/homedetails/239-E-10th-St-APT-3A-New-York-NY-10003/112086548_zpid/")?.id,
    "se"
  );
});

test("slug fallback reads the address, not the ids and city suffixes", () => {
  assert.equal(
    addressFromListingUrl("https://streeteasy.com/building/239-east-10-street-new_york/3a"),
    "239 east 10 street 3a"
  );
  assert.equal(
    addressFromListingUrl("https://www.zillow.com/homedetails/239-E-10th-St-APT-3A-New-York-NY-10003/112086548_zpid/"),
    "239 e 10th st apt 3a"
  );
});

test("non-URL pastes fall through to the address search", () => {
  const list = [feed({ id: "a", address: "91 East Third Street" })];
  assert.equal(findPasted(list, "91 E 3rd")?.id, "a");
  assert.equal(findPasted(list, "500 Fifth Avenue"), undefined);
});

// --- calendar handoff ------------------------------------------------------

test("no tour time means no calendar event to hand over", () => {
  assert.equal(icsFor(feed({ stage: "tour", tourAt: null })), null);
  assert.equal(googleCalendarUrl(feed({ stage: "tour", tourAt: null })), null);
});

test("a private viewing with no stated end gets a 15-minute slot", () => {
  const at = new Date("2026-09-10T15:00:00Z");
  const ics = icsFor(feed({ stage: "tour", tourAt: at.toISOString(), tourKind: "private" }))!;
  assert.match(ics, /DTSTART:20260910T150000Z/);
  assert.match(ics, /DTEND:20260910T151500Z/);
});

test("an open house honours its own window rather than guessing", () => {
  const start = new Date("2026-09-12T16:00:00Z");
  const end = new Date("2026-09-12T18:00:00Z");
  const ics = icsFor(
    feed({
      stage: "tour",
      tourAt: start.toISOString(),
      tourEndsAt: end.toISOString(),
      tourKind: "open_house",
    })
  )!;
  assert.match(ics, /DTSTART:20260912T160000Z/);
  assert.match(ics, /DTEND:20260912T180000Z/);
  assert.match(ics, /SUMMARY:Open house/);
});

test("commas in an address are escaped, not left to truncate the field", () => {
  // An unescaped comma ends the LOCATION value early: the neighborhood and
  // city would silently vanish from the calendar entry.
  const ics = icsFor(
    feed({
      stage: "tour",
      tourAt: new Date("2026-09-10T15:00:00Z").toISOString(),
      address: "55 Morton Street",
      neighborhood: "West Village",
    })
  )!;
  const line = ics.split("\r\n").find((l) => l.startsWith("LOCATION:"))!;
  assert.ok(line.includes("\\,"), "commas must be backslash-escaped");
  assert.ok(!/[^\\],/.test(line), "no bare comma may survive in LOCATION");
});

test("newlines in the description become the two-character escape", () => {
  const ics = icsFor(
    feed({ stage: "tour", tourAt: new Date("2026-09-10T15:00:00Z").toISOString() })
  )!;
  // One property ends where the next unfolded line begins — continuations of
  // a folded value always start with a space.
  const lines = ics.split("\r\n");
  const at = lines.findIndex((l) => l.startsWith("DESCRIPTION:"));
  let body = lines[at];
  for (let i = at + 1; i < lines.length && lines[i].startsWith(" "); i++) {
    body += lines[i].slice(1);
  }
  assert.ok(body.includes("\\n"), "line breaks should be encoded as \\n");
  assert.ok(!body.includes("\n"), "no raw newline may survive in DESCRIPTION");
});

test("no line exceeds the 75-octet limit clients enforce", () => {
  const ics = icsFor(
    feed({
      stage: "tour",
      tourAt: new Date("2026-09-10T15:00:00Z").toISOString(),
      notes: "Ask about the boiler, the roof access, and whether the rent includes heat.",
    })
  )!;
  for (const line of ics.split("\r\n")) {
    assert.ok(line.length <= 75, `line too long (${line.length}): ${line.slice(0, 40)}…`);
  }
});

test("re-adding the same tour updates the event instead of duplicating it", () => {
  const at = new Date("2026-09-10T15:00:00Z").toISOString();
  const one = icsFor(feed({ id: "abc", stage: "tour", tourAt: at }))!;
  const two = icsFor(feed({ id: "abc", stage: "tour", tourAt: at }))!;
  const uid = (s: string) => s.split("\r\n").find((l) => l.startsWith("UID:"));
  assert.equal(uid(one), uid(two));
});

test("the event carries what you need at the door", () => {
  const body = eventDescription(
    feed({
      price: 3250,
      rating: 88,
      myContactPhone: "2125550134",
      myContactName: "Jane at Corcoran",
      notes: "Third floor walk-up",
    })
  );
  assert.match(body, /\$3,250/);
  assert.match(body, /88\/100/);
  assert.match(body, /\(212\) 555-0134/);
  assert.match(body, /Jane at Corcoran/);
  assert.match(body, /Third floor walk-up/);
});

test("the Google link carries the same window as the file", () => {
  const at = new Date("2026-09-10T15:00:00Z").toISOString();
  const url = googleCalendarUrl(feed({ stage: "tour", tourAt: at }))!;
  const dates = new URL(url).searchParams.get("dates");
  assert.equal(dates, "20260910T150000Z/20260910T151500Z");
});

// --- the tour day ----------------------------------------------------------

test("tours group by local day and order by time inside it", () => {
  const days = tourDays([
    feed({ id: "b", stage: "tour", tourAt: "2026-09-12T19:00:00Z", lat: 40.744, lon: -73.978 }),
    feed({ id: "a", stage: "tour", tourAt: "2026-09-12T17:00:00Z", lat: 40.727, lon: -73.984 }),
    feed({ id: "c", stage: "tour", tourAt: "2026-09-13T16:00:00Z", lat: 40.73, lon: -73.99 }),
    // No time set: a booked tour without a time can't be routed.
    feed({ id: "d", stage: "tour", tourAt: null }),
    // Not in the tour column at all.
    feed({ id: "e", stage: "interested", tourAt: "2026-09-12T18:00:00Z" }),
  ]);
  assert.equal(days.length, 2);
  assert.deepEqual(days[0].stops.map((s) => s.listing.id), ["a", "b"]);
  assert.deepEqual(days[1].stops.map((s) => s.listing.id), ["c"]);
});

test("the walk between stops is estimated and the first leg is null", () => {
  const days = tourDays([
    feed({ id: "a", stage: "tour", tourAt: "2026-09-12T17:00:00Z", lat: 40.727, lon: -73.984 }),
    feed({ id: "b", stage: "tour", tourAt: "2026-09-12T19:00:00Z", lat: 40.744, lon: -73.978 }),
  ]);
  const [first, second] = days[0].stops;
  assert.equal(first.walkMinutes, null);
  // ~1.9km straight-line, grid factor 1.3, 80m/min → about half an hour.
  assert.ok(second.walkMinutes! >= 25 && second.walkMinutes! <= 40, `${second.walkMinutes}`);
  assert.equal(second.tight, false);
});

test("a walk that cannot fit its gap is flagged tight", () => {
  const days = tourDays([
    feed({ id: "a", stage: "tour", tourAt: "2026-09-12T17:00:00Z", lat: 40.727, lon: -73.984 }),
    // 30 minutes later, ~30 minutes' walk away: even a 15-minute viewing
    // makes it late.
    feed({ id: "b", stage: "tour", tourAt: "2026-09-12T17:30:00Z", lat: 40.744, lon: -73.978 }),
  ]);
  assert.equal(days[0].stops[1].tight, true);
});

test("stops without coordinates keep their place but estimate nothing", () => {
  const days = tourDays([
    feed({ id: "a", stage: "tour", tourAt: "2026-09-12T17:00:00Z", lat: null, lon: null }),
    feed({ id: "b", stage: "tour", tourAt: "2026-09-12T19:00:00Z", lat: 40.744, lon: -73.978 }),
  ]);
  assert.equal(days[0].stops.length, 2);
  assert.equal(days[0].stops[1].walkMinutes, null);
});

// --- source normalisation --------------------------------------------------

test("an address handed over as an object is unwrapped, never stringified", () => {
  // Apartments.com sometimes returns `address: {streetAddress, city}`. The
  // old code called String() on it and stored the text "[object Object]",
  // which reached real cards.
  const [listing] = normalizeApartments([
    {
      id: "a1",
      address: { streetAddress: "225 East 10th Street", city: "New York" },
      rent: 3495,
      url: "https://apartments.com/x",
    } as never,
  ]);
  assert.equal(listing.address, "225 East 10th Street");
  assert.doesNotMatch(listing.address, /\[object/);
});

test("an address with no usable text is empty, not nonsense", () => {
  const [listing] = normalizeApartments([
    { id: "a2", address: { latitude: 40.7 }, rent: 3000, url: "u" } as never,
  ]);
  assert.equal(listing.address, "");
});

// --- compare: amenities as rows -------------------------------------------

test("every decision amenity is a row, spoken for or not", () => {
  const a = feed({ id: "a", amenities: ["Washer/Dryer in unit", "Dishwasher"] });
  const b = feed({ id: "b", amenities: ["Dishwasher"] });
  const labels = amenityRowsFor([a, b]).map((r) => r.label);
  assert.ok(labels.includes("W/D in unit"), "the differing amenity is a row");
  assert.ok(labels.includes("Dishwasher"), "agreement is still a row for decision amenities");
  // Silence is an answer now: nobody listing an elevator IS the elevator row.
  assert.ok(labels.includes("Elevator"), "unmentioned decision amenities still show");
  assert.ok(!labels.includes("Gym"), "a non-decision amenity nobody mentions is not a row");
});

test("decision rows lead, in decision order; the rest follow", () => {
  const a = feed({
    id: "a",
    amenities: ["gym", "washer and dryer in unit", "private balcony"],
  });
  const rows = amenityRowsFor([a]).map((r) => r.label);
  // All six decision rows, in their fixed order, then the trailing extras.
  assert.deepEqual(rows, [
    "W/D in unit",
    "Laundry in building",
    "Elevator",
    "Doorman",
    "Dishwasher",
    "Good light",
    "Outdoor space",
    "Gym",
  ]);
});

test("a decision row tells yes from no from never-said", () => {
  const a = feed({ id: "a", amenities: ["Elevator"] });
  const b = feed({ id: "b", description: "Sunny 3rd floor walk-up" });
  const c = feed({ id: "c" });
  const row = amenityRowsFor([a, b, c]).find((r) => r.label === "Elevator")!;
  assert.equal(row.value(a), "✓", "stated presence");
  assert.equal(row.value(b), "✗", "a walk-up is a stated absence");
  assert.equal(row.value(c), "—", "silence is neither");
  // And the fold rule must not eat these rows when finalists agree.
  assert.equal(row.alwaysShow, true);
});

// --- distance to the train -------------------------------------------------

test("the nearest station is found and named with its lines", () => {
  // 225 East 10th St, East Village — Astor Place (6) and 1 Av (L) are close.
  const near = nearestStation(40.72925, -73.98444)!;
  assert.ok(near, "a station is found");
  assert.ok(near.minutes >= 1 && near.minutes <= 12, `${near.minutes} min is walkable`);
  assert.match(near.routes, /^[A-Z0-9]+$/);
  assert.ok(subwayLabel(near).includes("min to"), subwayLabel(near));
});

test("a listing without coordinates reports nothing rather than guessing", () => {
  assert.equal(nearestStation(null, null), null);
  assert.equal(nearestStation(40.7, null), null);
  assert.equal(subwayLabel(null), "");
});

test("the bounding-box prefilter agrees with a full sweep", () => {
  // The box is an optimisation; if it ever disagreed with brute force it
  // would silently report the wrong station.
  for (const [lat, lon] of [
    [40.72925, -73.98444],
    [40.7580, -73.9855],
    [40.6782, -73.9442],
    [40.8448, -73.8648],
  ] as [number, number][]) {
    const viaBox = nearestStation(lat, lon)!;
    const all = stationsWithin(lat, lon, 10_000);
    assert.equal(viaBox.name, all[0].name, `${lat},${lon}`);
  }
});

test("a midtown address reaches several lines on foot", () => {
  // Times Square: the densest transfer in the system.
  const routes = routesWithin(40.7557, -73.9870, 10);
  assert.ok(routes.length >= 6, `expected many lines, got ${routes.join("")}`);
});

test("walking minutes never round down to zero", () => {
  assert.equal(walkMinutes(0), 1);
  assert.equal(walkMinutes(5), 1);
});

test("a Murray Hill address gets Grand Central, not a station past it", () => {
  // 144 East 40th Street. Grand Central (4/5/6/7/S) is ~400m; 33 St (6) is
  // ~640m. An earlier build averaged complex coordinates by repeated halving
  // rather than a true mean, which dragged big transfer complexes off their
  // real position and made the nearer station look further away.
  const near = nearestStation(40.7495, -73.9756)!;
  assert.match(near.name, /Grand Central/, `got ${near.name}`);
  assert.ok(near.minutes <= 8, `${near.minutes} min should be a short walk`);
});

test("the walk radius widens the list, and orders it nearest-first", () => {
  // Midtown East really does have only two stations inside twelve minutes —
  // the first version of this test assumed three and was wrong about the
  // city, not about the code. What must hold is ordering and monotonicity.
  const near = stationsWithin(40.7495, -73.9756, 12);
  const wide = stationsWithin(40.7495, -73.9756, 20);
  assert.ok(wide.length > near.length, "a longer walk reaches more stations");
  assert.deepEqual(
    [...near].sort((a, b) => a.meters - b.meters).map((s) => s.name),
    near.map((s) => s.name),
    "nearest first"
  );
  assert.ok(near.every((s) => s.minutes <= 12), "nothing over the limit");
});

// --- chasing silence -------------------------------------------------------

test("the follow-up is one short line, not the pitch again", () => {
  const first = draftTourMessage(feed(), { ...DEFAULT_PROFILE, name: "Jake" });
  const nudge = draftFollowUp(feed(), { ...DEFAULT_PROFILE, name: "Jake" });
  assert.ok(nudge.length < first.length / 2, `${nudge.length} vs ${first.length}`);
  assert.ok(!nudge.includes("\n\n"), "a nudge is one paragraph");
  assert.match(nudge, /still available/i);
  assert.match(nudge, /55 Morton Street #5J/);
  // The original ask is not repeated — that's what makes it a follow-up.
  assert.doesNotMatch(nudge, /video walkthrough/i);
});

test("the follow-up greets the agent by name when we have one", () => {
  const named = draftFollowUp(
    feed({ myContactName: "Jane at Corcoran" }),
    { ...DEFAULT_PROFILE, name: "Jake Silver" }
  );
  assert.match(named, /^Hi Jane —/);
  assert.match(named, /This is Jake\./);
});

// --- the delist circuit breaker --------------------------------------------

function sweepRows(source: string, active: number, gone: number) {
  return Array.from({ length: active }, (_, i) => ({ source, gone: i < gone }));
}

test("a partial fetch cannot delist half a source's inventory", () => {
  // The afternoon the corpus flapped: ~300 active, a poll saw only 121.
  const { sweepable, skipped } = sweepPlan(sweepRows("streeteasy", 200, 110));
  assert.ok(!sweepable.has("streeteasy"));
  assert.equal(skipped[0]?.gone, 110);
});

test("honest turnover still sweeps", () => {
  // 15 of 200 gone is a Tuesday, not an outage.
  const { sweepable, skipped } = sweepPlan(sweepRows("streeteasy", 200, 15));
  assert.ok(sweepable.has("streeteasy"));
  assert.equal(skipped.length, 0);
});

test("small sources can turn over completely without tripping the breaker", () => {
  // 8 of 9 gone on a tiny source is below MIN_GONE_COUNT — plausible churn,
  // and blocking it forever would keep dead listings alive.
  const { sweepable } = sweepPlan(sweepRows("craigslist", 9, 8));
  assert.ok(sweepable.has("craigslist"));
});

test("one bad source doesn't block the others' sweeps", () => {
  const rows = [...sweepRows("zillow", 100, 60), ...sweepRows("hotpads", 100, 5)];
  const { sweepable } = sweepPlan(rows);
  assert.ok(!sweepable.has("zillow"));
  assert.ok(sweepable.has("hotpads"));
});

test("exactly at the thresholds, the sweep still runs", () => {
  // 25% share or 10 rows is the boundary; the breaker trips strictly above.
  const share = sweepPlan(sweepRows("a", 100, 25));
  assert.ok(share.sweepable.has("a"));
  const count = sweepPlan(sweepRows("b", 20, 10));
  assert.ok(count.sweepable.has("b"));
});

// --- the bed-range picker --------------------------------------------------

test("tapping outside a painted range stretches it", () => {
  // Studio–1 painted, tap 2: "and 2-beds too", not a restart to bare 2.
  assert.deepEqual(nextBedRange({ bedMin: 0, bedMax: 1 }, 2), { bedMin: 0, bedMax: 2 });
  // 1–2 painted, tap Studio: stretches downward.
  assert.deepEqual(nextBedRange({ bedMin: 1, bedMax: 2 }, 0), { bedMin: 0, bedMax: 2 });
  // 1–2 painted, tap 4+: open-ended top.
  assert.deepEqual(nextBedRange({ bedMin: 1, bedMax: 2 }, 4), { bedMin: 1, bedMax: null });
});

test("tapping inside a range starts over; the singles ladder still works", () => {
  assert.deepEqual(nextBedRange({ bedMin: 0, bedMax: 2 }, 1), { bedMin: 1, bedMax: 1 });
  assert.deepEqual(nextBedRange({ bedMin: 0, bedMax: null }, 2), { bedMin: 2, bedMax: 2 });
  assert.deepEqual(nextBedRange({ bedMin: 2, bedMax: 2 }, 0), { bedMin: 0, bedMax: 2 });
  assert.deepEqual(nextBedRange({ bedMin: 2, bedMax: 2 }, 2), { bedMin: 0, bedMax: null });
});

// --- the marketing / app host split ----------------------------------------

test("a real domain splits into two origins and one cookie scope", () => {
  for (const host of ["damnlease.com", "www.damnlease.com", "app.damnlease.com"]) {
    assert.deepEqual(originsFor(host), {
      app: "https://app.damnlease.com",
      marketing: "https://damnlease.com",
    });
    // One cookie domain from either side, or the session doesn't survive
    // the hop from sign-in to the board.
    assert.equal(cookieDomainFor(host), ".damnlease.com");
  }
  assert.ok(isAppHost("app.damnlease.com"));
  assert.ok(!isAppHost("damnlease.com"));
});

test("local development gets no split and no cookie domain", () => {
  // Browsers drop a domain-scoped cookie on a bare host, and there is no
  // app.localhost to redirect anyone to — so every rule must no-op.
  for (const host of ["localhost:3000", "127.0.0.1:3000", "192.168.1.9", "", null]) {
    assert.equal(originsFor(host), null);
    assert.equal(cookieDomainFor(host), undefined);
  }
});

// --- neighborhood scoping --------------------------------------------------

test("a search is scoped by real boundaries, not a radius", () => {
  const search = ["east village", "west village", "chelsea", "gramercy"];
  // 232 East 26th Street sits in Kips Bay, ~1km from the Gramercy centroid —
  // close enough for the old circle, and plainly not in the search.
  assert.equal(withinAreas(40.7398, -73.9807, search), false);
  assert.equal(nearAreas(40.7398, -73.9807, search), true, "the old test let it through");

  // 91 East Third Street is genuinely in the East Village and must survive.
  assert.equal(withinAreas(40.7256, -73.9873, search), true);
});

test("coordinates in no neighborhood at all are excluded", () => {
  // The middle of the East River: a centroid radius would happily claim it.
  assert.equal(withinAreas(40.7461, -73.9645, ["east village", "williamsburg"]), false);
});

// --- what a pass teaches ---------------------------------------------------

function place(over: Partial<Listing> = {}): Listing {
  return {
    id: `l${Math.round(Number(over.price ?? 3000))}${over.neighborhood ?? ""}`,
    source: "streeteasy",
    sourceId: "x",
    address: "1 Test St",
    unit: "",
    neighborhood: "West Village",
    borough: "Manhattan",
    price: 3000,
    originalPrice: 3000,
    bedrooms: 1,
    bathrooms: 1,
    sqft: 500,
    noFee: false,
    amenities: [],
    description: "",
    imageUrl: "",
    images: [],
    url: "",
    lat: 40.73,
    lon: -74.0,
    firstSeenAt: "2026-08-01",
    lastSeenAt: "2026-08-01",
    ...over,
  } as Listing;
}

test("a pass on price stops blaming the neighborhood", () => {
  /*
   * The shape that actually poisons a model: the places you can afford happen
   * to be in one neighborhood, and the ones you turn down on price happen to
   * be in the one you want. Nothing here is a statement about the West
   * Village, but an unscoped pass reads it as four of them.
   */
  const signals = [
    ...[2500, 2600, 2700].map((price) => ({
      listing: place({ price, neighborhood: "Bushwick" }),
      liked: true,
    })),
    ...[4100, 4200, 4300, 4400].map((price) => ({
      listing: place({ price, neighborhood: "West Village" }),
      liked: false,
    })),
  ];

  const blind = train(signals);
  assert.ok(
    blind.weights["hood:West Village"] < 0,
    "unscoped, the model concludes you dislike the West Village"
  );

  // The same seven signals, with the passes saying they were about price.
  const scoped = train(signals.map((s) => (s.liked ? s : { ...s, reasons: ["price"] })));
  assert.ok(
    !(scoped.weights["hood:West Village"] < 0),
    "scoped, the neighborhood is never blamed"
  );
  assert.ok(scoped.weights["price:4000-4250"] < 0, "the price band takes the hit instead");
});

test("passing because it was already gone teaches nothing", () => {
  const liked = [{ listing: place({ price: 2600 }), liked: true }];
  const base = train(liked);
  const withGone = train([
    ...liked,
    { listing: place({ price: 2600, neighborhood: "Bushwick" }), liked: false, reasons: ["gone"] },
  ]);
  // A rented apartment is not a preference: no weight may move because of it.
  assert.deepEqual(withGone.weights, base.weights);
  assert.equal(withGone.passes, base.passes);
});

test("a reason the model has no feature for is dropped, not spread around", () => {
  const signals = [
    { listing: place({ price: 2600 }), liked: true },
    { listing: place({ price: 2700 }), liked: true },
    { listing: place({ price: 2800, neighborhood: "Bushwick" }), liked: false, reasons: ["layout"] },
  ];
  const model = train(signals);
  assert.equal(model.passes, 0, "a bad layout is not evidence about Bushwick");
  assert.ok(!("hood:Bushwick" in model.weights));
});

test("a pass with no reason still counts against the whole listing", () => {
  const model = train([
    { listing: place({ price: 2600 }), liked: true },
    { listing: place({ price: 2700 }), liked: true },
    { listing: place({ price: 2800, neighborhood: "Bushwick" }), liked: false },
  ]);
  assert.equal(model.passes, 1);
  assert.ok(model.weights["hood:Bushwick"] < 0);
});

// --- where an emailed link may send you ------------------------------------

test("a next parameter can only point back at this site", () => {
  // The whole attack: our domain in the mail, someone else's on arrival.
  for (const hostile of [
    "//evil.example.com",
    "///evil.example.com",
    "https://evil.example.com",
    "http://evil.example.com/x",
    "/\\evil.example.com",
    "javascript:alert(1)",
    "evil.example.com",
  ]) {
    assert.equal(safeNext(hostile), "/", `${hostile} must not survive`);
  }
});

test("ordinary destinations pass through untouched", () => {
  assert.equal(safeNext("/reset"), "/reset");
  assert.equal(safeNext("/app#feed"), "/app#feed");
  assert.equal(safeNext("/join/abc?x=1"), "/join/abc?x=1");
  // Missing or empty falls back, and the fallback is the caller's to choose.
  assert.equal(safeNext(null), "/");
  assert.equal(safeNext(undefined, "/app"), "/app");
  assert.equal(safeNext("", "/app"), "/app");
});

// --- what a listing says it has, says it lacks, and never mentions ---------

const amListing = (description: string, amenities: string[] = []) =>
  ({ description, amenities, address: "" });

test("a walk-up is an explicit no on the elevator", () => {
  const facts = amenityFacts(amListing("Charming 4th floor walk-up with great light"));
  assert.equal(facts.elevator, "no");
  assert.equal(facts.light, "yes");
  // Silence stays silence: nothing was said about laundry either way.
  assert.equal(facts.laundry_unit, "unknown");
});

test("hookups are plumbing, not a washer", () => {
  assert.equal(amenityFacts(amListing("W/D hookups in unit")).laundry_unit, "unknown");
  assert.equal(
    amenityFacts(amListing("washer and dryer in unit")).laundry_unit,
    "yes"
  );
});

test("an in-unit washer settles the building question too", () => {
  const facts = amenityFacts(amListing("", ["Laundry: In Unit", "Elevator", "Doorman"]));
  assert.equal(facts.laundry_unit, "yes");
  assert.equal(facts.laundry_building, "yes");
  assert.equal(facts.elevator, "yes");
  assert.equal(facts.doorman, "yes");
});

test("stated absence beats a stray keyword", () => {
  const facts = amenityFacts(amListing("No pets. No laundry in building, laundromat around the corner."));
  assert.equal(facts.pets, "no");
  assert.equal(facts.laundry_building, "no");
});

test("the chip list only carries confirmed yeses", () => {
  const keys = amenitiesOf(amListing("Walk-up. Dishwasher, no pets."));
  assert.ok(keys.includes("dishwasher"));
  assert.ok(!keys.includes("elevator"));
  assert.ok(!keys.includes("pets"));
});

/* --- site jumps: the saved search, opened on the big sites --------------- */

test("one neighborhood links straight to it on StreetEasy, filters riding along", () => {
  const url = streeteasySearchUrl({ ...DEFAULT_CRITERIA, areas: ["east-village"] });
  assert.equal(url, "https://streeteasy.com/for-rent/east-village/price:2000-4000%7Cbeds:0-1");
});

test("several areas in one borough widen to the borough; a mixed bag widens to nyc", () => {
  const manhattan = streeteasySearchUrl(DEFAULT_CRITERIA);
  assert.ok(manhattan.includes("/for-rent/manhattan/"));
  const mixed = streeteasySearchUrl({
    ...DEFAULT_CRITERIA,
    areas: ["east-village", "williamsburg"],
  });
  assert.ok(mixed.includes("/for-rent/nyc/"));
});

test("open-ended bed counts become a floor, and studios-only names the count", () => {
  const openEnded = streeteasySearchUrl({ ...DEFAULT_CRITERIA, bedMin: 2, bedMax: null });
  assert.ok(openEnded.endsWith("beds>=2"));
  const studios = streeteasySearchUrl({ ...DEFAULT_CRITERIA, bedMin: 0, bedMax: 0 });
  assert.ok(studios.endsWith("beds:0"));
});

test("zillow gets the neighborhood rentals page, or the city when spread out", () => {
  assert.equal(
    zillowSearchUrl({ ...DEFAULT_CRITERIA, areas: ["chelsea"] }),
    "https://www.zillow.com/chelsea-new-york-ny/rentals/"
  );
  assert.equal(zillowSearchUrl(DEFAULT_CRITERIA), "https://www.zillow.com/new-york-ny/rentals/");
});

test("the jump row carries both sites in cross-check order", () => {
  const jumps = siteJumps(DEFAULT_CRITERIA);
  assert.deepEqual(
    jumps.map((j) => j.source),
    ["streeteasy", "zillow"]
  );
});

/* --- the facebook paste: prose becoming a listing ------------------------ */

test("a group post yields its rent, size, neighborhood and phone", () => {
  const post = parseFreePost(
    "GYPSY HOUSING FIND! Sunny 2br in Bushwick, $2,850/month, no fee!! " +
      "Available Sept 1. Text Maria at (917) 555-0182. Deposit $5,700."
  );
  assert.equal(post.price, 2850);
  assert.equal(post.bedrooms, 2);
  assert.equal(post.neighborhood, "Bushwick");
  assert.equal(post.phone, "(917) 555-0182");
  assert.equal(post.noFee, true);
  assert.equal(post.looksLikeListing, true);
});

test("the rent beats the deposit when both are named", () => {
  const post = parseFreePost("Asking $3,200. First, last and deposit due: $9,600 total to move in.");
  assert.equal(post.price, 3200);
});

test("a studio is zero bedrooms, and a street line is captured when present", () => {
  const post = parseFreePost(
    "Studio at 184 Ludlow St #4F, $2,400, email sublet@example.com to see it this week"
  );
  assert.equal(post.bedrooms, 0);
  assert.equal(post.address, "184 Ludlow St #4F");
  assert.equal(post.email, "sublet@example.com");
});

test("a bare address is a lookup, not a listing", () => {
  assert.equal(parseFreePost("417 East 9th Street #3").looksLikeListing, false);
});

test("facebook doors are recognised in their many spellings", () => {
  assert.ok(isFacebookUrl("https://www.facebook.com/groups/gypsyhousing/posts/12345"));
  assert.ok(isFacebookUrl("https://fb.com/share/abc"));
  assert.ok(!isFacebookUrl("https://streeteasy.com/building/x"));
});

test("dragging a card into Contacted counts as contacted, log or no log", () => {
  const dragged = feed({ stage: "contacted", contactCount: 0 });
  const logged = feed({ stage: "interested", contactCount: 1 });
  const untouched = feed({ stage: "inbox", contactCount: 0 });
  const funnel = funnelFor([dragged, logged, untouched], 25);
  assert.equal(funnel.contacted, 2);
});

test("a logged reply counts as replied even while the card sits in Contacted", () => {
  const replied = feed({ stage: "contacted", contactCount: 1, hasReply: true });
  const waiting = feed({ stage: "contacted", contactCount: 1, hasReply: false });
  const funnel = funnelFor([replied, waiting], 25);
  assert.equal(funnel.replied, 1);
});

test("a stored address that repeats its unit stops saying it twice", () => {
  assert.equal(addressSansUnit("99 Suffolk St #2B", "2B"), "99 Suffolk St");
  assert.equal(addressSansUnit("25 W 13th St APT 2CS", "2CS"), "25 W 13th St");
  assert.equal(addressSansUnit("330 East 35th Street", "3"), "330 East 35th Street");
  assert.equal(addressSansUnit("184 Ludlow St", null), "184 Ludlow St");
});

/* --- your own words: templates over the built-in drafts ------------------ */

test("variables fill in per listing, and unknown braces survive to be seen", () => {
  const out = renderTemplate(
    "Hi {agent}, about {address} at {price} — {my name}. {typo}",
    feed({ address: "55 Morton Street", unit: "5J", price: 3500, myContactName: "Jane at Corcoran" }),
    { ...DEFAULT_PROFILE, name: "Jake Silver" }
  );
  assert.ok(out.includes("Hi Jane, about 55 Morton Street #5J at $3,500"));
  assert.ok(out.includes("Jake"));
  assert.ok(out.includes("{typo}"));
});

test("a saved first-contact template beats the built-in draft", () => {
  const profile = { ...DEFAULT_PROFILE, templates: { first: "Yo {agent}, is {address} free?" } };
  const msg = draftTourMessage(feed({ myContactName: "Jane Doe" }), profile);
  assert.equal(msg, "Yo Jane, is 55 Morton Street #5J free?");
});

test("the repeat template fires only when there is a prior thread", () => {
  const profile = {
    ...DEFAULT_PROFILE,
    templates: { first: "First about {address}.", repeat: "Us again: {previous address} then, {address} now." },
  };
  const withPrior = draftTourMessage(feed({}), profile, { address: "12 Charles Street", unit: "3B" });
  assert.equal(withPrior, "Us again: 12 Charles Street #3B then, 55 Morton Street #5J now.");
  const without = draftTourMessage(feed({}), profile);
  assert.equal(without, "First about 55 Morton Street #5J.");
});

test("a saved follow-up template carries the chase everywhere", () => {
  const profile = { ...DEFAULT_PROFILE, templates: { followUp: "Still free? {address}" } };
  assert.equal(draftFollowUp(feed({}), profile), "Still free? 55 Morton Street #5J");
});

test("the built-in follow-up names the earlier thread with the same agent", () => {
  const withPrior = draftFollowUp(feed({ myContactName: "Jennifer C" }), DEFAULT_PROFILE, {
    address: "121 East 12th Street",
    unit: "7J",
  });
  assert.ok(withPrior.includes("We were also in touch about 121 East 12th Street #7J"));
  const without = draftFollowUp(feed({ myContactName: "Jennifer C" }), DEFAULT_PROFILE);
  assert.ok(!withPrior.includes("undefined"));
  assert.ok(!without.includes("We were also in touch"));
});
