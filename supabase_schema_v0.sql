-- Draft starter schema for Nellis History Scanner team sync.
-- Do not run blindly in production; review before applying.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'user' check (role in ('admin', 'user', 'guest')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nellis_listings (
  id uuid primary key default gen_random_uuid(),
  nellis_item_id text,
  url text not null,
  dedupe_key text not null unique,
  title text not null default '',
  normalized_title_key text not null default '',
  image_url text,
  current_price numeric,
  bids integer,
  condition_rating integer check (condition_rating is null or condition_rating between 0 and 5),
  item_tags text[] not null default '{}',
  user_bid_status text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  last_seen_by uuid references public.profiles(id),
  scan_count integer not null default 1,
  admin_hidden boolean not null default false,
  admin_hidden_reason text,
  admin_hidden_by uuid references public.profiles(id),
  admin_hidden_at timestamptz
);

create index if not exists nellis_listings_title_key_idx on public.nellis_listings(normalized_title_key);
create index if not exists nellis_listings_hidden_idx on public.nellis_listings(admin_hidden);
create index if not exists nellis_listings_last_seen_idx on public.nellis_listings(last_seen_at desc);

create table if not exists public.nellis_listing_snapshots (
  id bigserial primary key,
  listing_id uuid not null references public.nellis_listings(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  scanned_by uuid references public.profiles(id),
  current_price numeric,
  bids integer,
  condition_rating integer check (condition_rating is null or condition_rating between 0 and 5),
  item_tags text[] not null default '{}',
  user_bid_status text
);

create index if not exists nellis_snapshots_listing_time_idx on public.nellis_listing_snapshots(listing_id, scanned_at desc);

create table if not exists public.admin_hidden_patterns (
  id uuid primary key default gen_random_uuid(),
  normalized_title_key text not null,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  active boolean not null default true
);

create index if not exists admin_hidden_patterns_key_idx on public.admin_hidden_patterns(normalized_title_key);

alter table public.profiles enable row level security;
alter table public.nellis_listings enable row level security;
alter table public.nellis_listing_snapshots enable row level security;
alter table public.admin_hidden_patterns enable row level security;

-- Helper view-ish policy logic: admin = profile.role = 'admin'.
-- Profiles: users can see themselves; admins can see all.
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select using (
  id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Listings: admins see all; regular users see only non-hidden.
drop policy if exists listings_select_visible on public.nellis_listings;
create policy listings_select_visible on public.nellis_listings
for select using (
  admin_hidden = false
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Any authenticated user can upsert scan data through the client/app.
drop policy if exists listings_insert_authenticated on public.nellis_listings;
create policy listings_insert_authenticated on public.nellis_listings
for insert with check (auth.uid() is not null);

drop policy if exists listings_update_authenticated on public.nellis_listings;
create policy listings_update_authenticated on public.nellis_listings
for update using (auth.uid() is not null)
with check (auth.uid() is not null);

-- Snapshots: authenticated users insert; admins see all; regular users can see snapshots for visible listings.
drop policy if exists snapshots_insert_authenticated on public.nellis_listing_snapshots;
create policy snapshots_insert_authenticated on public.nellis_listing_snapshots
for insert with check (auth.uid() is not null);

drop policy if exists snapshots_select_visible on public.nellis_listing_snapshots;
create policy snapshots_select_visible on public.nellis_listing_snapshots
for select using (
  exists (
    select 1
    from public.nellis_listings l
    where l.id = listing_id
      and (
        l.admin_hidden = false
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
      )
  )
);

-- Admin hidden patterns: admins manage and see them. Regular users do not need to know.
drop policy if exists hidden_patterns_admin_select on public.admin_hidden_patterns;
create policy hidden_patterns_admin_select on public.admin_hidden_patterns
for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists hidden_patterns_admin_write on public.admin_hidden_patterns;
create policy hidden_patterns_admin_write on public.admin_hidden_patterns
for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
