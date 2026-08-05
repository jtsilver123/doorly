-- Columns the code writes but the schema never declared.
--
-- listings.contact_email had been written since broker outreach was added and
-- never existed. PostgREST rejects the whole row on an unknown column, so every
-- poll persisted nothing at all: listing_sources then failed its foreign key,
-- observations failed with it, and the run still reported a healthy count of
-- "new listings" that had only ever been counted in memory. 201 listings were
-- fetched and the table stayed at exactly 324.
--
-- The rest already existed in the live database but were applied by hand and
-- never recorded, so this file also closes the gap between the repo and
-- production. IF NOT EXISTS keeps it safe against either state.
alter table public.listings add column if not exists contact_email text not null default '';
alter table public.listings add column if not exists contact_phone text not null default '';
alter table public.listings add column if not exists contact_name  text not null default '';
alter table public.listings add column if not exists available_text text not null default '';
alter table public.listings add column if not exists months_free   numeric not null default 0;
alter table public.listings add column if not exists lease_months  integer not null default 12;
alter table public.listings add column if not exists net_effective_rent integer;
