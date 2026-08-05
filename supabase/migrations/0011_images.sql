-- Every photo the sources published for a listing, hero first.
--
-- The search feeds were already paying for these: HotPads and Apartments.com
-- return full photo arrays on every search row, and the app was keeping one.
-- Stored on the merged listing (not per source) because cross-site dedupe
-- means the StreetEasy card can wear the HotPads gallery for the same unit.
alter table listings
  add column if not exists images jsonb not null default '[]'::jsonb;
