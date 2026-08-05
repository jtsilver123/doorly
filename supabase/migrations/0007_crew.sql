-- Tag-team.
--
-- Two ways people hunt together, one mechanism:
--
--   Living alone, with help    Friends and family join as *scouts*: they can
--                              drop places into your pipeline — every card
--                              marked with who recommended it — but the hunt
--                              stays yours.
--
--   Living together            Roommates or partners join as *partners*: one
--                              shared pipeline both fill and both work, with a
--                              per-listing *point person* so two people never
--                              both text the same agent.
--
-- The model: a crew is a group around one pipeline — the creator's. Joining a
-- crew points your pipeline at theirs; RLS below grants members access to the
-- owner's rows. Taste feedback and saved searches stay personal: what to look
-- for is an opinion, the pipeline is the shared work.

create table if not exists crews (
    id          uuid primary key default gen_random_uuid(),
    name        text not null default 'Our search',
    owner       uuid not null references auth.users (id) on delete cascade,
    created_at  timestamptz not null default now()
);

create table if not exists crew_members (
    crew_id    uuid not null references crews (id) on delete cascade,
    user_id    uuid not null references auth.users (id) on delete cascade,
    role       text not null default 'partner' check (role in ('partner', 'scout')),
    joined_at  timestamptz not null default now(),
    primary key (crew_id, user_id)
);

-- One crew per person, in both directions: your pipeline can't point two
-- places at once, and an owner splitting attention across crews is nobody's
-- use case.
create unique index if not exists crew_members_one_crew on crew_members (user_id);

-- Invites are links, not emails: the person doing the inviting is standing in
-- a group chat, and a URL is the thing they can paste there. The token *is*
-- the authorisation, so it's a uuid, single-use, and revocable by deletion.
create table if not exists crew_invites (
    token       uuid primary key default gen_random_uuid(),
    crew_id     uuid not null references crews (id) on delete cascade,
    role        text not null default 'scout' check (role in ('partner', 'scout')),
    created_by  uuid not null,
    created_at  timestamptz not null default now(),
    accepted_by uuid,
    accepted_at timestamptz
);

-- Who put this listing in the pipeline, and who owns talking to the agent.
-- On the state row rather than a side table: attribution is pipeline state.
alter table public.user_listing_state add column if not exists added_by    uuid;
alter table public.user_listing_state add column if not exists poc_user_id uuid;

-- ------------------------------------------------------------------ RLS ---

alter table crews        enable row level security;
alter table crew_members enable row level security;
alter table crew_invites enable row level security;

-- Your crew: visible to everyone in it, created by its owner, deleted by its
-- owner. Membership rows are managed by the owner (and the accept flow runs
-- with the service role, which bypasses RLS); anyone can leave.
drop policy if exists crews_see on crews;
create policy crews_see on crews for select to authenticated
  using (owner = (select auth.uid())
         or id in (select crew_id from crew_members where user_id = (select auth.uid())));

drop policy if exists crews_create on crews;
create policy crews_create on crews for insert to authenticated
  with check (owner = (select auth.uid()));

drop policy if exists crews_delete on crews;
create policy crews_delete on crews for delete to authenticated
  using (owner = (select auth.uid()));

drop policy if exists crew_members_see on crew_members;
create policy crew_members_see on crew_members for select to authenticated
  using (user_id = (select auth.uid())
         or crew_id in (select crew_id from crew_members where user_id = (select auth.uid()))
         or crew_id in (select id from crews where owner = (select auth.uid())));

drop policy if exists crew_members_leave on crew_members;
create policy crew_members_leave on crew_members for delete to authenticated
  using (user_id = (select auth.uid())
         or crew_id in (select id from crews where owner = (select auth.uid())));

drop policy if exists crew_invites_own on crew_invites;
create policy crew_invites_own on crew_invites for all to authenticated
  using (crew_id in (select id from crews where owner = (select auth.uid())))
  with check (crew_id in (select id from crews where owner = (select auth.uid())));

-- Crew members work the owner's pipeline: the owner's state rows and contact
-- log open up to everyone in the crew. Feedback and saved searches don't.
drop policy if exists uls_crew on user_listing_state;
create policy uls_crew on user_listing_state for all to authenticated
  using (user_id in (
    select c.owner from crews c
    join crew_members m on m.crew_id = c.id
    where m.user_id = (select auth.uid())))
  with check (user_id in (
    select c.owner from crews c
    join crew_members m on m.crew_id = c.id
    where m.user_id = (select auth.uid())));

drop policy if exists contact_log_crew on contact_log;
create policy contact_log_crew on contact_log for all to authenticated
  using (user_id in (
    select c.owner from crews c
    join crew_members m on m.crew_id = c.id
    where m.user_id = (select auth.uid())))
  with check (user_id in (
    select c.owner from crews c
    join crew_members m on m.crew_id = c.id
    where m.user_id = (select auth.uid())));

-- Crew members can see each other's names — that's what attribution renders.
drop policy if exists user_profile_crew on user_profile;
create policy user_profile_crew on user_profile for select to authenticated
  using (user_id in (
    select m2.user_id from crew_members m1
    join crew_members m2 on m2.crew_id = m1.crew_id
    where m1.user_id = (select auth.uid()))
    or user_id in (
    select c.owner from crews c
    join crew_members m on m.crew_id = c.id
    where m.user_id = (select auth.uid()))
    or user_id in (
    select m.user_id from crew_members m
    join crews c on c.id = m.crew_id
    where c.owner = (select auth.uid())));
