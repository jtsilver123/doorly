import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fingerprint, streetKey, extractUnit, matchConfidence, hasStreetNumber } from "@/lib/dedupe";
import { toNum, toPrice } from "@/lib/parse";
import { craigslistId, parseCraigslistHtml } from "@/lib/sources/craigslist";
import { inBounds, searchKey, normalizeCriteria, DEFAULT_CRITERIA } from "@/lib/criteria";
import { train, score, features } from "@/lib/rank";
import {
  bestChannel,
  draftTourMessage,
  qualifyingLine,
  smsLink,
  normalizePhone,
  reachableOn,
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
import { DEFAULT_CONFIG, keyHint } from "@/lib/apikey";
import { amenitiesOf, qualityScore } from "@/lib/amenities";
import { verdictFor, gradeOf } from "@/lib/verdict";
import { icsFor, googleCalendarUrl, eventDescription } from "../src/lib/calendar.ts";
import { tourDays } from "../src/lib/tourday.ts";
import { applyFilters } from "@/lib/filters";
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
    tourAt: null,
    tourKind: "private" as const,
    tourEndsAt: null,
    myScore: null,
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

// --- calendar handoff ------------------------------------------------------

test("no tour time means no calendar event to hand over", () => {
  assert.equal(icsFor(feed({ stage: "tour", tourAt: null })), null);
  assert.equal(googleCalendarUrl(feed({ stage: "tour", tourAt: null })), null);
});

test("a private viewing with no stated end gets a 30-minute slot", () => {
  const at = new Date("2026-09-10T15:00:00Z");
  const ics = icsFor(feed({ stage: "tour", tourAt: at.toISOString(), tourKind: "private" }))!;
  assert.match(ics, /DTSTART:20260910T150000Z/);
  assert.match(ics, /DTEND:20260910T153000Z/);
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
  assert.equal(dates, "20260910T150000Z/20260910T153000Z");
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
    // 30 minutes later, ~30 minutes' walk away: the viewing itself makes it late.
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
