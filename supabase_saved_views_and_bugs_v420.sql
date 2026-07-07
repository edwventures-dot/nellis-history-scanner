-- Nellis Scanner/Web v4.2.0 / v1.5.0 support tables.
-- Safe for the Supabase SQL editor. Uses Auth + RLS; no service role key needed.

create extension if not exists pgcrypto;

create table if not exists public.nhs_saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null,
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, app, name)
);

create table if not exists public.nhs_app_bugs (
  id uuid primary key default gen_random_uuid(),
  app text not null,
  app_version text not null default '',
  title text not null,
  status text not null default 'open',
  severity text not null default 'bug',
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.nhs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists nhs_saved_views_set_updated_at on public.nhs_saved_views;
create trigger nhs_saved_views_set_updated_at
before update on public.nhs_saved_views
for each row execute function public.nhs_set_updated_at();

drop trigger if exists nhs_app_bugs_set_updated_at on public.nhs_app_bugs;
create trigger nhs_app_bugs_set_updated_at
before update on public.nhs_app_bugs
for each row execute function public.nhs_set_updated_at();

alter table public.nhs_saved_views enable row level security;
alter table public.nhs_app_bugs enable row level security;

drop policy if exists "saved views read own" on public.nhs_saved_views;
create policy "saved views read own"
on public.nhs_saved_views
for select
using (auth.uid() = user_id);

drop policy if exists "saved views insert own" on public.nhs_saved_views;
create policy "saved views insert own"
on public.nhs_saved_views
for insert
with check (auth.uid() = user_id);

drop policy if exists "saved views update own" on public.nhs_saved_views;
create policy "saved views update own"
on public.nhs_saved_views
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "saved views delete own" on public.nhs_saved_views;
create policy "saved views delete own"
on public.nhs_saved_views
for delete
using (auth.uid() = user_id);

drop policy if exists "bugs read own or admin" on public.nhs_app_bugs;
create policy "bugs read own or admin"
on public.nhs_app_bugs
for select
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.nhs_profiles p
    where p.user_id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "bugs insert own" on public.nhs_app_bugs;
create policy "bugs insert own"
on public.nhs_app_bugs
for insert
with check (auth.uid() = created_by);

drop policy if exists "bugs update own or admin" on public.nhs_app_bugs;
create policy "bugs update own or admin"
on public.nhs_app_bugs
for update
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.nhs_profiles p
    where p.user_id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  auth.uid() = created_by
  or exists (
    select 1 from public.nhs_profiles p
    where p.user_id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "bugs delete own or admin" on public.nhs_app_bugs;
create policy "bugs delete own or admin"
on public.nhs_app_bugs
for delete
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.nhs_profiles p
    where p.user_id = auth.uid()
      and p.role = 'admin'
  )
);
