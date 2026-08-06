-- Why a place was passed on.
--
-- A pass with no reason has to be read as "something here was wrong", so the
-- ranking model counts it against every feature of the listing. That is the
-- honest reading of no information, and it is also how the model poisons
-- itself: pass a $4,200 West Village studio because of the price, and it
-- learns you dislike the West Village.
--
-- Storing the reason codes lets the negative land only on the features the
-- reason actually implicates. Codes rather than the free text that was already
-- being kept on listing_state, because that text is a note to a crew-mate and
-- this is an input to a model; the two want different things and should not
-- share a column.
alter table public.feedback
  add column if not exists reasons text[] not null default '{}';

comment on column public.feedback.reasons is
  'Pass reason codes (see PASS_REASONS in lib/rank.ts). Scopes which model features the pass counts against; an empty array means the whole listing.';
