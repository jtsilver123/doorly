-- Why you passed, for the person who found it.
--
-- A scout drops a place into the shared pipeline and it silently vanishes.
-- They get no signal, so they keep sending the same kind of thing, and the
-- one person who volunteered to help learns nothing from the help they gave.
--
-- The reason goes on the shared state row rather than into a message thread:
-- the crew already reads these rows, so a note here reaches the finder
-- without inventing an inbox nobody would check.
alter table public.user_listing_state
  add column if not exists pass_reason text not null default '';

-- Separate from stage_changed_at, which moves on every transition. This is
-- specifically when it left the running, so "passed last Tuesday" survives a
-- later un-pass and re-pass.
alter table public.user_listing_state
  add column if not exists passed_at timestamptz;
