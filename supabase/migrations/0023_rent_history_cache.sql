-- The place's past rents, fetched once from the listing site's own record
-- and kept: history only grows, and a cached answer costs no API credits.
create table if not exists listing_rent_history (
  listing_id text primary key references listings(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  events jsonb not null default '[]'::jsonb
);

-- Corpus data, served through the app's own routes only (service role);
-- no direct client access, same posture as the rest of the corpus.
alter table listing_rent_history enable row level security;
