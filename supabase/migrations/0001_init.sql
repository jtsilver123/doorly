-- Homefinder schema.
--
-- Split in two halves:
--
--   Shared market data  (listings, listing_sources, observations, events)
--     One copy for everyone. The scraper writes it with the service role;
--     signed-in users can only read. If you and a friend both track Bushwick,
--     you share the scrape and the price history rather than doubling it.
--
--   Per-user state  (user_listing_state, contact_log, feedback, saved_searches)
--     Your pipeline stage, notes, who you emailed, what you liked. RLS scopes
--     every row to its owner, so adding users needs no code change.
--
-- Observations are append-only and are the source of truth: events and price
-- history are derived, so both can be rebuilt if the diff logic changes.

-- ---------------------------------------------------------------- shared ---

create table if not exists listings (
    id               text primary key,          -- `${source}-${source_id}` of first source seen
    fingerprint      text not null,             -- cross-site identity, see lib/dedupe.ts

    address          text not null default '',
    unit             text not null default '',
    neighborhood     text not null default '',
    borough          text not null default '',
    lat              double precision,
    lon              double precision,

    bedrooms         real not null default 0,
    bathrooms        real not null default 1,
    sqft             integer,
    price            integer not null,
    original_price   integer not null,          -- price the first time we saw it

    description      text not null default '',
    url              text not null default '',
    image_url        text,
    available_at     text,
    no_fee           boolean not null default false,
    amenities        jsonb not null default '[]'::jsonb,
    building_type    text not null default '',

    is_active        boolean not null default true,
    first_seen_at    timestamptz not null default now(),
    last_seen_at     timestamptz not null default now(),
    price_changed_at timestamptz,
    relisted_at      timestamptz
);

create index if not exists listings_active_idx on listings (is_active, first_seen_at desc);
create index if not exists listings_fp_idx     on listings (fingerprint);
create index if not exists listings_hood_idx   on listings (borough, neighborhood);
create index if not exists listings_price_idx  on listings (price);

-- The same apartment is often on two or three sites at once.
create table if not exists listing_sources (
    source         text not null,
    source_id      text not null,
    listing_id     text not null references listings (id) on delete cascade,
    url            text not null default '',
    is_active      boolean not null default true,
    first_seen_at  timestamptz not null default now(),
    last_seen_at   timestamptz not null default now(),
    primary key (source, source_id)
);

create index if not exists listing_sources_listing_idx on listing_sources (listing_id);

create table if not exists observations (
    id            bigserial primary key,
    listing_id    text not null references listings (id) on delete cascade,
    source        text not null,
    source_id     text not null,
    observed_at   timestamptz not null default now(),
    price         integer,
    status        text,
    content_hash  text not null,
    payload       jsonb not null
);

create index if not exists observations_src_idx     on observations (source, source_id, observed_at desc);
create index if not exists observations_listing_idx on observations (listing_id, observed_at desc);

create table if not exists events (
    id           bigserial primary key,
    listing_id   text not null references listings (id) on delete cascade,
    kind         text not null,
    old_value    text,
    new_value    text,
    detail       text not null default '',
    occurred_at  timestamptz not null default now()
);

create index if not exists events_time_idx    on events (occurred_at desc);
create index if not exists events_listing_idx on events (listing_id, occurred_at desc);
create index if not exists events_kind_idx    on events (kind, occurred_at desc);

create table if not exists poll_runs (
    id            bigserial primary key,
    started_at    timestamptz not null default now(),
    finished_at   timestamptz,
    fetched       integer not null default 0,
    new_listings  integer not null default 0,
    events        integer not null default 0,
    ok            boolean not null default true,
    message       text not null default ''
);

create index if not exists poll_runs_time_idx on poll_runs (started_at desc);

-- -------------------------------------------------------------- per-user ---

-- Your pipeline state for one listing. This is the CRM spine.
create table if not exists user_listing_state (
    user_id           uuid not null references auth.users (id) on delete cascade,
    listing_id        text not null references listings (id) on delete cascade,
    stage             text not null default 'inbox',
    stage_changed_at  timestamptz,
    starred           boolean not null default false,
    visited_at        timestamptz,
    notes             text not null default '',
    follow_up_at      timestamptz,
    events_seen_at    timestamptz,      -- everything older than this is "read"
    updated_at        timestamptz not null default now(),
    primary key (user_id, listing_id)
);

create index if not exists uls_stage_idx    on user_listing_state (user_id, stage);
create index if not exists uls_followup_idx on user_listing_state (user_id, follow_up_at);

-- Every time you reached out or heard back.
create table if not exists contact_log (
    id           bigserial primary key,
    user_id      uuid not null references auth.users (id) on delete cascade,
    listing_id   text not null references listings (id) on delete cascade,
    channel      text not null,               -- email | phone | text | portal | in_person
    direction    text not null default 'out', -- out | in
    who          text not null default '',
    note         text not null default '',
    occurred_at  timestamptz not null default now()
);

create index if not exists contact_log_idx on contact_log (user_id, listing_id, occurred_at desc);

create table if not exists feedback (
    id          bigserial primary key,
    user_id     uuid not null references auth.users (id) on delete cascade,
    listing_id  text not null references listings (id) on delete cascade,
    action      text not null,               -- like | pass
    created_at  timestamptz not null default now(),
    unique (user_id, listing_id)
);

create table if not exists saved_searches (
    id          bigserial primary key,
    user_id     uuid not null references auth.users (id) on delete cascade,
    label       text not null,
    criteria    jsonb not null,
    search_key  text not null,
    active      boolean not null default true,
    created_at  timestamptz not null default now(),
    unique (user_id, search_key)
);

create index if not exists saved_searches_active_idx on saved_searches (active);

-- ------------------------------------------------------------------ RLS ---

alter table listings           enable row level security;
alter table listing_sources    enable row level security;
alter table observations       enable row level security;
alter table events             enable row level security;
alter table poll_runs          enable row level security;
alter table user_listing_state enable row level security;
alter table contact_log        enable row level security;
alter table feedback           enable row level security;
alter table saved_searches     enable row level security;

-- Shared market data: any signed-in user reads; only the service role writes
-- (the scraper). No user-facing insert/update policies on purpose.
do $$
declare t text;
begin
  foreach t in array array['listings','listing_sources','observations','events','poll_runs']
  loop
    execute format(
      'drop policy if exists %I on %I', t || '_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

-- Per-user tables: you can only ever see and touch your own rows.
do $$
declare t text;
begin
  foreach t in array array['user_listing_state','contact_log','feedback','saved_searches']
  loop
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format(
      'create policy %I on %I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      t || '_own', t);
  end loop;
end $$;
