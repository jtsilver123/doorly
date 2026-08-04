-- Solo mode.
--
-- v1 has no login: one person, their own deployment. So user_id keeps its shape
-- (uuid, on every per-user table, compared against auth.uid() in the policies)
-- but stops referencing auth.users and defaults to a fixed UUID.
--
-- Turning on real multi-user auth later is a policy swap, not a migration: drop
-- the *_solo policies below, re-add the auth.users FK, and the *_own policies
-- (user_id = auth.uid()) from 0001 already do the right thing.

alter table user_listing_state drop constraint if exists user_listing_state_user_id_fkey;
alter table contact_log        drop constraint if exists contact_log_user_id_fkey;
alter table feedback           drop constraint if exists feedback_user_id_fkey;
alter table saved_searches     drop constraint if exists saved_searches_user_id_fkey;

alter table user_listing_state alter column user_id set default '00000000-0000-0000-0000-000000000001';
alter table contact_log        alter column user_id set default '00000000-0000-0000-0000-000000000001';
alter table feedback           alter column user_id set default '00000000-0000-0000-0000-000000000001';
alter table saved_searches     alter column user_id set default '00000000-0000-0000-0000-000000000001';

do $$
declare t text;
begin
  foreach t in array array['listings','listing_sources','observations','events','poll_runs']
  loop
    execute format('drop policy if exists %I on %I', t || '_solo', t);
    execute format('create policy %I on %I for all to anon using (true) with check (true)', t || '_solo', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['user_listing_state','contact_log','feedback','saved_searches']
  loop
    execute format('drop policy if exists %I on %I', t || '_solo', t);
    execute format(
      'create policy %I on %I for all to anon
         using (user_id = ''00000000-0000-0000-0000-000000000001''::uuid)
         with check (user_id = ''00000000-0000-0000-0000-000000000001''::uuid)',
      t || '_solo', t);
  end loop;
end $$;

-- Outreach needs someone to contact. Zillow puts a leasing-office number on the
-- card; HotPads and StreetEasy give a broker/management name. Nothing has both.
alter table listings add column if not exists contact_phone  text not null default '';
alter table listings add column if not exists contact_name   text not null default '';
alter table listings add column if not exists available_text text not null default '';

create index if not exists listings_phone_idx on listings (contact_phone) where contact_phone <> '';

-- The details that go into a tour request: name, employer, income, move-in date.
create table if not exists user_profile (
    user_id      uuid primary key default '00000000-0000-0000-0000-000000000001',
    profile      jsonb not null default '{}'::jsonb,
    updated_at   timestamptz not null default now()
);

alter table user_profile enable row level security;

drop policy if exists user_profile_own on user_profile;
create policy user_profile_own on user_profile for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists user_profile_solo on user_profile;
create policy user_profile_solo on user_profile for all to anon
  using (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  with check (user_id = '00000000-0000-0000-0000-000000000001'::uuid);
