-- Your own answers to the amenity questions, keyed by amenity ("elevator":
-- "yes"). What you saw on the tour outranks what the listing said; absence of
-- a key defers back to the listing-derived fact.
alter table user_listing_state add column if not exists amenity_marks jsonb not null default '{}'::jsonb;
