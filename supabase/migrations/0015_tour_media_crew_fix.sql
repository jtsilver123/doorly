-- Crew visibility for tour media, done right.
--
-- The first policy joined crew_members to itself, which missed the crew
-- OWNER entirely — owners live on crews.owner and have no membership row —
-- and would anyway have been filtered by crew_members' own RLS mid-policy.
-- A security-definer helper answers the real question ("do these two people
-- share a crew, counting owners?") without either trap.
create or replace function shares_crew_with(other uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from (
      select id from crews where owner = auth.uid()
      union
      select crew_id from crew_members where user_id = auth.uid()
    ) mine
    join (
      select id from crews where owner = other
      union
      select crew_id from crew_members where user_id = other
    ) theirs on mine.id = theirs.id
  );
$$;

drop policy if exists "media read own or crew" on user_listing_media;
create policy "media read own or crew" on user_listing_media
  for select using (
    auth.uid() = user_id or shares_crew_with(user_id)
  );

drop policy if exists "tour media read own or crew" on storage.objects;
create policy "tour media read own or crew" on storage.objects
  for select using (
    bucket_id = 'tour-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or shares_crew_with(((storage.foldername(name))[1])::uuid)
    )
  );
