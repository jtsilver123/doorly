-- Cached building records from NYC Open Data, one row per listing.
-- The city's endpoints are free and unkeyed; the courtesy owed back is not
-- asking the same question twice a day. A week is the right staleness for
-- violations and bedbug filings — they move on inspection timescales.
create table if not exists building_intel (
  listing_id text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table building_intel enable row level security;
drop policy if exists "intel read" on building_intel;
create policy "intel read" on building_intel
  for select using (auth.role() = 'authenticated');
