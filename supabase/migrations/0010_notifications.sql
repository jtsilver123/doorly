-- The notification spine: what happened that you'd want to know about
-- without having the app open.
--
-- Three kinds, matching the three things worth interrupting someone for:
--   crew_add   someone put a place in your shared pipeline
--   watched    a place you're pursuing changed under you
--   good_drop  a price fell enough that a place became worth a look
create table if not exists public.notifications (
    id         bigint generated always as identity primary key,
    user_id    uuid not null,
    kind       text not null check (kind in ('crew_add', 'watched', 'good_drop')),
    listing_id text,
    title      text not null,
    body       text not null default '',
    created_at timestamptz not null default now(),
    read_at    timestamptz
);

create index if not exists notifications_user_fresh
  on public.notifications (user_id, created_at desc);

-- One row per browser that said yes to device notifications. The endpoint is
-- the identity: re-subscribing the same browser updates rather than piles up.
create table if not exists public.push_subscriptions (
    endpoint   text primary key,
    user_id    uuid not null,
    p256dh     text not null,
    auth       text not null,
    created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;

-- Yours to read and mark read; only the server (service role) writes them.
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists notifications_mark on public.notifications;
create policy notifications_mark on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
