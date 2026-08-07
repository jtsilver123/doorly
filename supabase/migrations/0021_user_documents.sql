-- The application packet's actual papers: pay stubs, IDs, bank statements,
-- uploaded once and organized, so applying is grab-and-go instead of a
-- scramble through a phone's downloads folder. Strictly private per user.
create table if not exists user_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null unique,
  name text not null default '',
  kind text not null default '',
  size bigint,
  created_at timestamptz not null default now()
);
alter table user_documents enable row level security;
create policy "own documents" on user_documents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
