# Supabase Team Sync Plan

This is the next major track after local backup/restore. The extension does not sync yet in v3.1.0; this file documents the intended v4.0.0 direction.

## Goal

Multiple people scan Nellis from their own accounts/machines. Each machine contributes captured listing data into one shared database.

Admins see everything. Regular users see shared listings except listings/patterns the admin has hidden from regular dashboards.

This is dashboard filtering only. It does not modify Nellis, steal credentials, share cookies, or interfere with user accounts.

## Roles

- `admin`: sees all shared data and can hide listings/patterns from regular users.
- `user`: sees shared listings except admin-hidden rows/patterns.
- `guest`: optional limited role, same as user unless we decide otherwise.

Initial users discussed:

- Trey: admin
- guest: user/guest

## MVP v4.0.0

1. Supabase settings screen in extension:
   - project URL
   - anon key
   - login/logout
   - local device name
   - sync on/off

2. Auth:
   - users log in through Supabase Auth.
   - admin role lives in a profile table.

3. Sync captured listings:
   - local scan still works first.
   - push captured listings to Supabase.
   - pull shared listings into dashboard.

4. Admin hide:
   - admin can hide a listing or normalized title pattern from regular dashboards.
   - regular users do not see hidden rows.
   - admins can still see/restore hidden rows.

5. Preserve local backup:
   - full local JSON export still works.
   - Supabase sync is additive, not a replacement for backup.

## Later

- shared saved filters
- per-user bid/win tracking
- daily snapshots
- trends dashboard
- export shared database backup
- admin user management screen
