import { test } from "node:test";
import assert from "node:assert/strict";

import { fingerprint, streetKey, extractUnit, matchConfidence } from "@/lib/dedupe";
import { toNum, toPrice } from "@/lib/parse";
import { craigslistId, parseCraigslistHtml } from "@/lib/sources/craigslist";
import { inBounds, searchKey, DEFAULT_CRITERIA } from "@/lib/criteria";
import { train, score, features } from "@/lib/rank";
import { draftTourMessage, smsLink, normalizePhone, DEFAULT_PROFILE } from "@/lib/outreach";
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
    availableText: "",
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
    contactCount: 0,
    lastContactAt: null,
    lastContactChannel: null,
    score: 80,
    scoreReasons: [],
    daysOnMarket: 1,
    unseenEvents: 0,
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
  assert.match(message, /qualified renter/i);
  assert.match(message, /September 1/);
});

test("the message still qualifies you when the profile is empty", () => {
  const message = draftTourMessage(feed(), DEFAULT_PROFILE);
  assert.match(message, /qualified renter/i);
  assert.match(message, /55 Morton Street/);
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
