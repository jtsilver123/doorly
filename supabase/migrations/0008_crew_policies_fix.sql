-- Fixing 0007's policies: they referenced crew_members from crew_members'
-- own policy (and crews' policy referenced crew_members whose policy
-- references crews), which Postgres rejects at query time as infinite
-- recursion — every crew query errored, and the middleware read that error
-- as "not in a crew".
--
-- The standard cure: security-definer helpers that read membership with RLS
-- off. Policies then reference the function, never the guarded tables.

create or replace function public.my_crew_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select crew_id from crew_members where user_id = auth.uid()
  union
  select id from crews where owner = auth.uid()
$$;

-- The pipeline owners whose rows this user may work: their own crew's.
create or replace function public.my_crew_owner_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select c.owner from crews c
  join crew_members m on m.crew_id = c.id
  where m.user_id = auth.uid()
$$;

-- Everyone in this user's crew, both directions — for reading names.
create or replace function public.my_crew_fellow_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select m.user_id from crew_members m where m.crew_id in (select public.my_crew_ids())
  union
  select c.owner from crews c where c.id in (select public.my_crew_ids())
$$;

drop policy if exists crews_see on crews;
create policy crews_see on crews for select to authenticated
  using (id in (select public.my_crew_ids()));

drop policy if exists crew_members_see on crew_members;
create policy crew_members_see on crew_members for select to authenticated
  using (crew_id in (select public.my_crew_ids()));

drop policy if exists crew_members_leave on crew_members;
create policy crew_members_leave on crew_members for delete to authenticated
  using (user_id = (select auth.uid())
         or crew_id in (select id from crews where owner = (select auth.uid())));

drop policy if exists uls_crew on user_listing_state;
create policy uls_crew on user_listing_state for all to authenticated
  using (user_id in (select public.my_crew_owner_ids()))
  with check (user_id in (select public.my_crew_owner_ids()));

drop policy if exists contact_log_crew on contact_log;
create policy contact_log_crew on contact_log for all to authenticated
  using (user_id in (select public.my_crew_owner_ids()))
  with check (user_id in (select public.my_crew_owner_ids()));

drop policy if exists user_profile_crew on user_profile;
create policy user_profile_crew on user_profile for select to authenticated
  using (user_id in (select public.my_crew_fellow_ids()));
