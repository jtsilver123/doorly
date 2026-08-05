-- Your own score, next to the computed one.
--
-- The 1-100 rating is built from price against comparables, amenities, budget
-- fit and timing — everything the listing publishes. It cannot know that the
-- kitchen photo looked staged, that the block was loud at 8pm, or that you
-- simply liked it. After a viewing you have an opinion the model doesn't have
-- access to, and it should be the one that sorts the list.
--
-- Kept beside the generated number rather than overwriting it: two numbers
-- that disagree is information, and a gut score that silently replaced the
-- analysis would lose the reason you shortlisted the place to begin with.
--
-- Per user, on user_listing_state, because an opinion is not a fact about the
-- apartment.
alter table public.user_listing_state
  add column if not exists my_score smallint;

alter table public.user_listing_state
  drop constraint if exists user_listing_state_my_score_range;

alter table public.user_listing_state
  add constraint user_listing_state_my_score_range
  check (my_score is null or (my_score >= 1 and my_score <= 100));
