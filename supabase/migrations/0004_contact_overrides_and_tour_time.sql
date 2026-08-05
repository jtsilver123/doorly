-- Contact details you found yourself, and when the viewing actually is.
--
-- No listing site publishes a broker phone number — zero of 324 in the live
-- corpus — so the outreach flow dead-ends at exactly the step it exists for.
-- People get numbers by calling around, from a friend, off a sign in a window;
-- those belong on the listing rather than in a notes field the app can't act
-- on. Stored per user rather than on the shared listing, because a number one
-- person dug up isn't a fact about the apartment.
alter table public.user_listing_state add column if not exists contact_phone text not null default '';
alter table public.user_listing_state add column if not exists contact_email text not null default '';
alter table public.user_listing_state add column if not exists contact_name  text not null default '';

-- "Tour booked" without a time is a status, not a plan.
alter table public.user_listing_state add column if not exists tour_at timestamptz;
