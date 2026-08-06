-- Your own footage from tours, pinned to the listing.
--
-- Files go straight from the phone to storage (an API route can't relay
-- video — serverless bodies cap at a few MB), so the bucket and its policies
-- carry the access rules: you upload under your own user-id prefix, you and
-- your crew can watch, only you can delete. The metadata row is what the app
-- lists; the storage object is what a signed URL plays.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tour-media', 'tour-media', false,
  262144000, -- 250MB: a couple of minutes of phone video
  array['image/jpeg','image/png','image/webp','image/heic','image/heif',
        'video/mp4','video/quicktime','video/webm']
)
on conflict (id) do nothing;

create table if not exists user_listing_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  listing_id text not null,
  path text not null unique,
  kind text not null default 'photo', -- photo | video
  caption text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists user_listing_media_listing on user_listing_media (listing_id);
alter table user_listing_media enable row level security;

-- Crew-mates see each other's footage: the pipeline is shared work, and
-- "watch the video Kat took" is the whole point of attaching it.
drop policy if exists "media insert own" on user_listing_media;
create policy "media insert own" on user_listing_media
  for insert with check (auth.uid() = user_id);

drop policy if exists "media read own or crew" on user_listing_media;
create policy "media read own or crew" on user_listing_media
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from crew_members a
      join crew_members b on a.crew_id = b.crew_id
      where a.user_id = auth.uid() and b.user_id = user_listing_media.user_id
    )
  );

drop policy if exists "media delete own" on user_listing_media;
create policy "media delete own" on user_listing_media
  for delete using (auth.uid() = user_id);

-- Storage: uploads land under {userId}/{listingId}/...; the prefix is the
-- ownership check.
drop policy if exists "tour media upload own" on storage.objects;
create policy "tour media upload own" on storage.objects
  for insert with check (
    bucket_id = 'tour-media'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "tour media read own or crew" on storage.objects;
create policy "tour media read own or crew" on storage.objects
  for select using (
    bucket_id = 'tour-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from crew_members a
        join crew_members b on a.crew_id = b.crew_id
        where a.user_id = auth.uid()
          and b.user_id::text = (storage.foldername(name))[1]
      )
    )
  );

drop policy if exists "tour media delete own" on storage.objects;
create policy "tour media delete own" on storage.objects
  for delete using (
    bucket_id = 'tour-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
