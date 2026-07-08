-- Fix for "permission denied for table nhs_app_bugs" after the v4.2.0 support tables exist.
-- Run this in the Supabase SQL Editor. It uses Auth + RLS; no service role key needed.

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.nhs_saved_views to authenticated;
grant select, insert, update, delete on table public.nhs_app_bugs to authenticated;
