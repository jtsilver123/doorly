# Homefinder

A personal Zillow for one apartment search. It watches StreetEasy, Zillow,
HotPads and Craigslist, merges the same apartment across all of them, records
what changes over time, learns which places you like, and runs your outreach —
so the job is fast, easy and organised instead of twelve browser tabs.

Built on top of [thatcherclough/APT](https://github.com/thatcherclough/APT):
the shared-listings / per-user-state architecture, the Craigslist scraper and
the RealtyAPI client all come from there. See [Credit](#credit).

## What it does

**Finds** — one poll hits four sites. StreetEasy has the best data (real unit
numbers, square footage, neighborhoods); Zillow has the broadest coverage and
the occasional leasing-office phone number; HotPads carries broker-exclusive
listings; Craigslist catches small landlords who post nowhere else.

**Deduplicates** — the same flat is typically on three sites at three slightly
different prices with three different addresses (`55 Morton Street #5J` /
`55 Morton St APT 5j` / `55 Morton St`). Homefinder collapses those into one
card that links out to each site, defaulting to Zillow because its listing
pages are the nicest to use.

**Tracks changes** — every poll writes an append-only observation. Price drops,
increases, relists, delistings and "now also on Zillow" become a timeline per
listing and a **What changed** feed across all of them. Price history is drawn
as a sparkline.

**Learns** — thumbs-down a place, or move one along your pipeline, and a small
model re-ranks everything. It explains itself: every score decomposes into
reasons ("likes neighborhood West Village", "no broker fee"), because a ranking
you can't interrogate isn't one you'll trust.

**Prices what you'd actually pay** — listing sites compare on sticker rent,
which is the wrong number twice over. A concession ("2 months free on a
14-month lease") makes a $3,800 listing really $3,257 — invisible if you filter
on gross. And a $3,300 with a broker fee costs more on day one than a $3,500
no-fee. Every card shows effective rent, cash-to-move-in, and an all-in
monthly, and you can sort on any of them.

**Knows your move-in date** — listings are checked against your target date:
ready, a bit late, too late, or suspiciously long-vacant. The sidebar counts
down the days.

**Gets you application-ready** — a renter résumé built from your profile, a
document checklist, and a readiness score. It matters most for the case that
looks weakest on a standard form: a business owner with no paystub. See
[Securing, not just finding](#securing-not-just-finding).

**Runs your outreach** — one tap drafts a tour request naming the address, the
rent, your qualifications and your move-in date, and opens Messages or Mail.
Sending logs the contact and advances the listing to *Contacted* automatically,
so the CRM stays true without extra bookkeeping. Cards show how you last
reached out — texted, emailed or called.

## Setup

```bash
npm install
cp .env.example .env.local     # fill in the values below
npm run poll                   # first fetch — populates the database
npm run dev                    # http://localhost:3000
```

| Variable | Needed? | What it's for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase publishable key |
| `REALTYAPI_KEY` | strongly recommended | StreetEasy, Zillow and HotPads. Without it only Craigslist runs. Can also be set in-app under **My details**, which takes precedence |
| `CRON_SECRET` | only when deployed | Protects the scheduled poll endpoint |

The schema lives in `supabase/migrations/`. Apply `0001_init.sql` then
`0002_solo_mode.sql` to a fresh project (Supabase SQL editor, or `supabase db push`).

Set your name, employer, income and move-in date under **My details** — those
fill in the tour message, so filling them once is what makes outreach one tap.

## Securing, not just finding

Finding an apartment and getting it are different problems, and the second is
where a strong applicant loses to a faster one. Three things here address it:

- **The application packet.** A one-page renter résumé — financial position,
  terms, documents ready — that goes out the moment a viewing goes well. In a
  market where the flat goes to the first complete file, having it pre-built is
  the whole game.
- **Income framing for owners.** A blank salary field reads as "can't pay". If
  you own a business and take no salary, the message and the packet cite the
  figure on your 2025 return as *documented* income rather than leaving a gap
  for the landlord to fill in. With no figure at all, it names the gap and
  closes it with the documents instead.
- **Readiness score.** The honest version of "am I ready to apply?" — it lists
  exactly what's still missing.

## Geography

Zillow, HotPads and Apartments.com return coordinates but no neighborhood, so
results used to be stamped with whichever area was queried — a guess that broke
whenever a search spilled over a boundary.

Resolving location from coordinates fixes that *and* pays for itself: because
narrowing now happens locally, one borough-wide request replaces four
neighborhood ones. **Wide mode costs 5 requests per poll instead of 14** — about
50 checks a month rather than 17.

Getting there took two attempts, both measured against StreetEasy's own labels:

| Approach | Accuracy |
|---|---|
| Bounding boxes, smallest wins | 39% — sub-areas swallow their parents |
| Nearest centroid (Voronoi), hand-placed | 48% |
| Nearest centroid, fitted to labelled data | 62% held-out |

62% is not good enough to *label* a listing confidently, and precise labelling
would need NYC's published NTA boundary polygons. But labelling isn't what the
optimization needs — it needs one reliable question answered: *is this inside my
search area?* Measured against the same data, **1.2km around a neighborhood's
fitted centre captures 100% of its listings** (furthest observed: 1.09km). That
radius is what `withinAreas` uses, and it's deliberately tuned for recall:
including a borderline listing costs you one card to skim, excluding a real one
means never seeing it.

`npm run geocheck` re-scores the centroids against whatever is in your database;
`npm run fitgeo` re-derives them and prints replacements.

## The request budget

The RealtyAPI free tier is **250 requests a month**, which is a real design
constraint rather than a footnote. At three pages per source per area a single
poll cost 30 requests — the whole month bought eight checks, one every four
days, in a market that moves in hours.

So: pages-per-source defaults to **1** (listings are sorted newest-first, so one
page catches everything fresh), which puts a poll at ~10 requests and the month
at ~25 checks. Usage is metered per call and shown in the sidebar; when the
budget runs out, polls fail with a message telling you to swap keys rather than
quietly reporting "no new listings". **Craigslist needs no key**, so it keeps
working when the quota is gone.

Paste a fresh key under **My details** → *API key & usage*. Usage is counted
per key, so a new key starts a new count.

## Keyboard

The feed is built for triage, so it's drivable without the mouse:

| Key | Action |
|---|---|
| `J` / `K` | move between listings |
| `E` | reach out (text, email or copy-and-open, whichever applies) |
| `S` | star |
| `X` | pass — also trains the ranker (undoable from the toast) |
| `O` | open on the best site |
| `↵` | open details |

## Layout

```
src/
  lib/
    sources/       one adapter per site, all emitting the same Listing shape
      streeteasy · zillow · hotpads · craigslist
    areas.ts       NYC geography, and what each site calls each place
    criteria.ts    saved-search model, canonical search key, bounds filter
    dedupe.ts      cross-site identity: street canonicalization, fingerprints
    ingest.ts      scrape -> merge -> diff -> events
    rank.ts        the preference model, and why it scored what it scored
    outreach.ts    tour-message drafting, sms:/mailto: links
    feed.ts        every read and write the UI needs
    parse.ts       defensive coercion for inconsistent upstream payloads
  app/             one page, four tabs, plus JSON API routes
  components/      ListingCard, ListingDrawer
tests/units.test.ts
scripts/           poll.ts (one polling pass), smoke.ts (source health check)
```

**Data model.** `listings` / `listing_sources` / `observations` / `events` are
shared market data. `user_listing_state` / `contact_log` / `feedback` /
`saved_searches` are yours, scoped by RLS. Observations are the source of
truth; events, price history and scores are derived, so they can be rebuilt if
the logic changes.

## Keeping it fresh

`npm run poll` does one pass. To have it run unattended, deploy and hit
`POST /api/refresh` with `x-cron: 1` and `Authorization: Bearer $CRON_SECRET`.
`vercel.json` schedules that every 30 minutes.

## Known limits

- **Apartments.com is included but unverified.** It *is* on this key
  (`apartments.realtyapi.io`) — an earlier probe hit the wrong path and wrongly
  concluded otherwise. The adapter is written from the published OpenAPI spec,
  but the per-listing field names were never seen against a live response
  because the key ran out of credits first. It reads every field through
  tolerant lookups and degrades rather than throwing; check `npm run smoke`
  output on the first run with a fresh key.
- **Concession data only arrives on new polls.** `monthsFree` /
  `netEffectivePrice` are captured from StreetEasy going forward; rows ingested
  before that show no concession, so effective rent equals sticker rent for
  them.
- **Phone numbers are rare.** Zero of 324 listings in a live sample had one;
  only Zillow publishes them at all. Rather than show a text button that can't
  text, the primary action adapts: *Text for tour* when there's a phone, *Email
  for tour* when there's an address, and otherwise *Copy & open listing*, which
  puts the draft on your clipboard and opens the site's own enquiry form. Every
  one of those logs the contact and advances the pipeline.
- **StreetEasy only searches by borough.** Neighborhood slugs and its own
  numeric area ids both return zero, so Homefinder queries the borough and
  narrows using the `areaName` on each listing.
- **Craigslist has no address field.** Its listing title is used instead, so
  Craigslist rows only dedupe against other sites when the title contains a real
  street address.
- **Images can 404.** Listing CDNs expire URLs; cards fall back to a
  placeholder rather than showing a broken image.
- **Neighborhood labels are approximate for Zillow/HotPads/Apartments.** They
  publish coordinates but no neighborhood, and nearest-centroid resolution is
  ~62% accurate against StreetEasy's labels. Area *filtering* is reliable (see
  [Geography](#geography)); the displayed name can be off near a boundary.
  Proper NTA polygons would fix it.
- **Solo mode.** There is no login: `user_id` defaults to a fixed UUID. The
  column and the RLS policies are already multi-user, so adding auth is a policy
  swap rather than a migration — see the comments in `0002_solo_mode.sql`.

## Credit

The starting point was [thatcherclough/APT](https://github.com/thatcherclough/APT).
Kept from it, with thanks:

- **The architecture** — shared listing data plus per-user state behind RLS.
  It's why sharing this with friends later is cheap.
- **The Craigslist scraper** — the JSON-LD + card-regex parsing approach.
- **The RealtyAPI client** and StreetEasy field mapping.

Two bugs in that original are fixed here: Craigslist changed its URLs from
`/1234567890.html` to opaque trailing slugs, which made the id regex match
nothing and silently return zero results on every run; and its JSON-LD
`position` is 0-based, not 1-based.
