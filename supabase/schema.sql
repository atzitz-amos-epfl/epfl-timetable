-- My Studies: account sync.
-- Run once in the Supabase dashboard (SQL Editor > New query > paste > Run).
--
-- One row per user holds the planner, course corrections and agenda as JSON. Row-level security makes each
-- row readable and writable only by its owner, so the public "anon" key in the web app can't reach other rows.

create table if not exists public.user_data (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.user_data enable row level security;

drop policy if exists "Read own data" on public.user_data;
create policy "Read own data" on public.user_data
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Create own data" on public.user_data;
create policy "Create own data" on public.user_data
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Update own data" on public.user_data;
create policy "Update own data" on public.user_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Delete own data" on public.user_data;
create policy "Delete own data" on public.user_data
  for delete to authenticated using ((select auth.uid()) = user_id);

-- The server stamps every write; the app only writes when the row is still at the version it last saw,
-- so two devices can't overwrite each other's changes.
create or replace function public.user_data_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch
  before insert or update on public.user_data
  for each row execute function public.user_data_touch();
