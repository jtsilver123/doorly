-- An open house is not a booked viewing.
--
-- Most NYC viewings are open houses: a two-hour window on a Saturday that you
-- turn up to, with no appointment and nobody expecting you by name. The app
-- treated every tour as a confirmed slot, which produced two wrong things —
-- it nagged you to "pin down when" on something that already had a time, and
-- it showed a single moment for what is actually a range you can arrive
-- anywhere inside.
--
-- Defaults to 'private' so every tour already in the pipeline keeps meaning
-- exactly what it meant before this ran.
alter table public.user_listing_state
  add column if not exists tour_kind text not null default 'private';

-- Only an open house has one. A private viewing ends when it ends.
alter table public.user_listing_state
  add column if not exists tour_ends_at timestamptz;

alter table public.user_listing_state
  drop constraint if exists user_listing_state_tour_kind;

alter table public.user_listing_state
  add constraint user_listing_state_tour_kind
  check (tour_kind in ('private', 'open_house'));
