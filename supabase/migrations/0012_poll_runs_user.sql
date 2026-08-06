-- Who spent the requests. Polls now run per user on that user's own key, so
-- the run log carries the spender — the per-user cadence check reads it, and
-- it makes "whose key paid for this" answerable after the fact.
alter table poll_runs
  add column if not exists user_id uuid;
create index if not exists poll_runs_user_started
  on poll_runs (user_id, started_at desc);
