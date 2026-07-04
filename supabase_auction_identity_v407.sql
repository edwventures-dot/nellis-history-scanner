-- Nellis History Scanner v4.0.7 auction identity migration
-- Adds our own auction group identity: pickup location + auction closing date/time.

alter table public.nhs_listings
  add column if not exists auction_location text,
  add column if not exists auction_closes_raw text,
  add column if not exists auction_closes_at timestamptz,
  add column if not exists auction_group_key text;

alter table public.nhs_listing_snapshots
  add column if not exists auction_location text,
  add column if not exists auction_closes_raw text,
  add column if not exists auction_closes_at timestamptz,
  add column if not exists auction_group_key text;

create index if not exists nhs_listings_auction_group_key_idx
on public.nhs_listings(auction_group_key);

create index if not exists nhs_listings_auction_closes_at_idx
on public.nhs_listings(auction_closes_at desc);

create index if not exists nhs_listings_auction_location_idx
on public.nhs_listings(auction_location);

create index if not exists nhs_snapshots_auction_group_key_idx
on public.nhs_listing_snapshots(auction_group_key);

select 'Nellis History Scanner v4.0.7 auction identity columns installed' as status;
