# Nellis History Scanner v4.2.1

- Enlarges dashboard listing thumbnails to 176px.
- Uses contained product images instead of cropped thumbnails in the dashboard table.
- If Supabase says `permission denied for table nhs_app_bugs`, run `supabase_bug_table_grants_v421.sql`.

# Nellis History Scanner v4.2.0

- Stores dashboard saved filters/views in Supabase when `nhs_saved_views` exists.
- Keeps local saved filters as a fallback and merges them with cloud saved views after sign-in.
- Adds an admin **Clear hidden rules** action.
- Prunes admin-hidden rules older than 24 hours when admin hidden rules are loaded.
- Adds `supabase_saved_views_and_bugs_v420.sql` for saved views and app bug storage.

# Nellis History Scanner v4.1.3

- Fixes wrapped/sidebar event parsing so `Daily Auction - Katy - Jul 6th` and `Daily Auction - SW Houston - Jul 6th` stay separate.
- Keeps event grouping stable even when the Nellis sidebar wraps an event name across lines.

# Nellis History Scanner v4.1.2

- Captures Nellis **Event Name** values from the search filter sidebar, such as `Daily Auction - Katy - Jul 6th`.
- Uses event names as the shared auction group key when available, instead of guessing from pickup location plus close date.
- Blocks long product titles from being mistaken for pickup locations when reading the map-pin area.

# Nellis History Scanner v4.1.1

- Fixes pickup location detection for Nellis cards where the location is only shown next to the map-pin icon, like `Katy`.
- Accepts relative countdown values such as `14 hours` from the `Time Left` box and converts them into an approximate close date for auction grouping.
- Keeps the auction group key stable by using the date when the close value is only a relative countdown.

# Nellis History Scanner v4.0.8

- Improves auction location/close parsing from visible text, aria/title/data attributes, and flexible date formats.
- Backfills auction identity for older cloud rows the next time they are scanned/synced.
- Keeps regular live updates focused on price/bids, with auction identity only filled when non-empty/missing.

## Version 4.0.6

- Added **Auto sync now** button to popup and dashboard for testing the quiet background sync without bringing back manual push/pull clutter.
- Fixed admin unhide restore behavior: unhide now touches the matching listing so regular users can pull it back on the next changed-listing sync.
- Background visibility reconciliation can restore missing visible rows, not just prune hidden rows. This fixes the one-less-row guest dashboard after an admin unhide.
- Sync status now reports restored rows.

## Version 4.0.5

- Fixed slow dashboard scrolling/performance with 20k+ shared listings.
- Dashboard now renders a page/window of rows instead of dumping every listing into the table at once.
- Added paging controls above the listing table with 100/250/500/1000 row options.
- Images only load for the current rendered page, with async/low-priority thumbnail loading.
- Reduced automatic dashboard refresh churn from every 1.5 seconds to every 15 seconds. Quiet background sync still runs separately.
- Header checkbox now selects the currently rendered page instead of trying to select all filtered rows at once.

## Version 4.0.4

- Removed dashboard Data Safety panel and full-backup header clutter.
- Removed manual dashboard Team Sync controls; sync is quiet/background now.
- Kept popup sign-in/sign-out as the only normal team login UI.
- Kept last sync date/time visible in the dashboard admin tools section.
- Added Admin tools near the top of the dashboard:
  - preview selected listings queued for admin hide
  - admin-hide selected rows
  - show current admin-hidden rules
  - unhide individual hidden rules
- Removed manual popup Sync Now/Pull Shared buttons to avoid confusion.

# Nellis History Scanner

## Version 4.0.3

This is the **two-way quiet polling sync release**.

- Background sync now pulls server-side changes automatically, not just push-after-scan.
- On first sign-in/client setup, the background worker can do the first full shared pull silently.
- After the first pull, it asks Supabase only for rows changed since the last pull.
- Regular-user dashboards periodically reconcile visible shared rows so admin-hidden listings disappear locally without a warning banner.
- Pull timestamps now use the pull start time to avoid missing updates that happen while paging through results.

## Version 4.0.2

This is the **quiet dirty-sync release**.

- Added background team sync using Chrome alarms.
- Scan pages silently push only rows from the page that was just scanned.
- A listing is sent as a full shared row the first time the client thinks it is new.
- After a listing is known, sync only sends live changes: current price and bid count, plus timestamps/last-seen metadata.
- Unchanged listings are skipped instead of resynced.
- Manual **Sync now** reports new rows, price/bid updates, skipped rows, pulled rows, and local total.
- Background pull checks for changed shared listings since the last pull instead of redownloading the whole shared database every time.
- Pull shared still does a full paged pull when you explicitly click it.
- Added `alarms` permission for quiet background sync.

## Version 4.0.1

Supabase limits normal SELECT results to 1,000 rows per request by default. This build changes **Pull shared** and **Sync now** to pull shared listings in 1,000-row pages until all available rows are retrieved, up to a 100,000-row safety cap. This fixes the guest/regular-user dashboard only receiving the first 1,000 shared listings.

## Version 3.1.0

This is the **dashboard cleanup + team-sync prep release**.

- Added collapsible dashboard sections.
- Dashboard collapse state is remembered between sessions.
- Collapsible sections include Summary, Quick filters, Data safety, Saved filters, Daily query import, Not-wanted rules, Available tags, Available condition ratings, and Column filters.
- Kept the v3.0.0 data safety system: **Export full backup** from both the popup and dashboard.
- Kept **Restore selected backup** from both the popup and dashboard.
- Backup file is one JSON file containing local extension data:
  - captured listings
  - receipt rows and receipt summaries
  - imported purchase history
  - saved filters
  - daily query import
  - not-wanted rules
  - scan state
  - settings
- Added backup validation so random JSON does not restore by accident.
- Restore is currently **replace everything** only. That is intentional. Merge is where bugs go to breed.
- Before restoring, the extension attempts to create an internal pre-restore backup.
- On extension update, the background worker attempts to keep an internal pre-update backup.
- Added `unlimitedStorage` permission so the buying database has more room as captured history grows.

## Backup / restore workflow

1. Click **Export full backup** before installing a new experimental build.
2. Save the JSON somewhere real, not just Downloads purgatory.
3. If a new build breaks data, open the popup or dashboard.
4. Choose the JSON backup.
5. Click **Restore selected backup**.
6. Refresh the dashboard.

The backup is local-only. It is not uploaded anywhere by the extension.

## Version 2.9.0

- Added **Daily query import** on the dashboard.
- Paste a Chrome bookmark export, Nellis search URLs, or plain keyword lines.
- The importer extracts URL parameters like `query=`, `q=`, `keyword=`, `search=`, and `term=`.
- Extracted keywords become a grouped column filter: **Listing contains keyword1 OR keyword2 OR keyword3**.
- You can apply the imported keyword group to the active dashboard filters.
- You can save it as a reusable saved filter, including any existing filters like `Current < 3`.
- The pasted import text and extracted keyword list are remembered locally.

## Version 2.8.1

- Added synthetic **New** tag support. If Nellis gives a listing no warning/item tags, the dashboard treats that blank tag state as `New`.
- `New` appears in the Available tags filter, Tags column, search text, not-wanted rules, and CSV export.
- New scans store `New` directly when no item tags are found; old captured rows with blank tags display as `New` automatically.

## Version 2.8.0

- Added grouped column filters for AND/OR logic.
- Standalone column filters still behave as AND filters.
- New filter groups can be set to ANY/OR or ALL/AND.
- Example daily-buy setup: standalone `Current < 3` plus a `Go-to products` group set to ANY containing `Listing contains sdfr`, `Listing contains fifiif`, and `Listing contains fkfkfk`.
- Saved dashboard filters now include grouped column filters, so you can save this as a reusable daily buy list.

## Version 2.7.0

- Not-wanted rules are explicitly saved in local extension storage and survive rescans, dashboard refreshes, and forgetting captured listings.
- Added a Saved not-wanted rules panel on the dashboard. Click the `x` on a rule to remove that single blacklist entry instead of clearing them all.
- Added saved dashboard filters. Save the current filter setup by name and reapply it later.
- Saved filters include search text, returned-history toggle, quality filter, selected tags, selected condition ratings, column filters, tag/condition match modes, and sort order.


## Version 2.6.1 changes

- Dashboard listing clicks now open the item in a separate browser window instead of a new tab.
- The dashboard stays put while the item window comes forward.
- Reuses the same item window when possible, so clicking multiple listings does not create a tab graveyard.
- Ctrl-click, Cmd-click, Shift-click, Alt-click, and middle-click keep normal browser behavior.


## Version 2.6.0

- Added Shift-click range selection for dashboard row checkboxes.
- Tightened live listing capture so header/footer links like Spotlight, Accessibility, Location & Hours, and Home do not become fake captured listings.
- Added native tooltips to dashboard buttons and sortable headers.
- Enlarged thumbnails from 72px to 112px, with a small hover zoom.

## Version 2.5.0

- Dashboard now displays **Last Modified** / last seen time instead of prioritizing first-found time.
- Rescanning the same listing refreshes live data and updates `lastSeenAt` / `lastModifiedAt`.
- Added row checkboxes and bulk selection.
- Added **Selected not wanted** to mark multiple selected rows as not wanted in one shot.
- Added **Clear selection**.
- CSV export now includes `firstFoundAt`, `lastSeenAt`, and `lastModifiedAt`.

## Version 2.4.2

- Fixed Nellis star rating capture for the actual SVG classes like `fill-starRating-4` and `fill-starRating-5`.
- Condition still means only the 0-5 star system. Pink pills like `Used` stay under Tags.
- Added bid status capture from listing-card text/buttons.
  - Rows where you have bid are green.
  - Rows where you appear to be outbid/losing are red.
  - Added a Bid Status dashboard column and CSV export fields.
- Rescanning an already-captured listing now refreshes live fields like condition, bid count, current price, tags, image, and bid status instead of keeping stale data forever.
- Existing captured rows need to be rescanned to get the new condition and bid-status fields.


Chrome/Edge extension for pulling Nellis receipt history, scanning live Nellis search pages, and keeping a persistent dashboard of captured auction listings.

## Version 2.4.0 changes

- Fixed the **Max pages safety stop** input.
  - It is now a normal typeable text/numeric field.
  - The popup no longer refreshes over the box while you are typing.
  - You can paste or type values like `500` instead of clicking the little arrow button 400 times like a medieval accountant.
- Cleaned up **Condition** handling.
  - Condition now means only the 5-star rating.
  - Pink pills like `used`, `major damage`, `open box`, etc. stay under **Tags**.
  - Condition filters now show rating chips like `3/5`, `4/5`, `5/5` only.
- Added **column filters**.
  - Use the Column filters panel to add multiple filters at once.
  - Right-click a table header to quickly add a filter for that column.
  - Examples:
    - Bids `<3`
    - Listing `begins with xyd`
    - Current `<=20`
    - Tags `contains used`
    - Condition rating `>=3`
- Existing capture-everything behavior, persistent dashboard, tags, not-wanted rules, export, and multi-column sort remain.

## What it does

1. Optionally download/import your Nellis receipt history.
2. Scan Nellis search pages and capture every listing it can read.
3. Add history-match metadata when a listing title matches your purchase history title key.
4. Save captured listings locally until you tell it to forget them.
5. Let you filter, sort, tag-filter, condition-rating-filter, column-filter, quality-filter, export, and blacklist bad patterns from the dashboard.

## Install in Chrome or Edge

1. Download and unzip `nellis-history-scanner.zip`.
2. Open Chrome or Edge.
3. Go to `chrome://extensions` or `edge://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the unzipped `nellis-history-scanner` folder.
7. Pin/open the extension popup.

## Typical workflow

1. Open a Nellis search page.
2. Click **Start scan**.
3. Watch the dashboard fill with captured listings.
4. Use filters for current search work:
   - Quality threshold
   - Tags
   - Condition rating
   - Column filters
   - Text search
   - Returned history toggle
5. Click **Not wanted** on bad patterns so related listings stop showing up.
6. Use **Forget captured** only when you want to wipe saved dashboard listings.

Purchase history is still useful because it powers the **Quality** score, repeat count, return count, and history comparison metadata. It is no longer required just to scan and capture listings.

## Dashboard controls

- Search box: text filter across title, matched history name, condition rating, and tags.
- Quality >=: filters by history title-key match quality. Use `95` for strict matches only, `0` for all captured listings.
- Show returned history: includes rows where your purchase history was only returns/refunds.
- Tag mode:
  - **All selected tags** means a listing must have every selected tag.
  - **Any selected tag** means a listing can have at least one selected tag.
- Condition rating mode:
  - **All selected ratings** means a listing must match every selected rating.
  - **Any selected rating** means a listing can match at least one selected rating.
- Column filters:
  - Add exact filters like `Bids < 3` or `Listing begins with xyd`.
  - Multiple column filters stack together.
  - Right-click a column header for quick filter prompts.
- Multi-sort:
  - Click a column for normal sort.
  - Shift-click more columns to add secondary/third sorts.
- Not wanted:
  - Click **Not wanted** on one row, or select multiple rows and click **Selected not wanted**.
  - Removes current rows with the same title key.
  - Blocks future scanned listings with that same title key.

## Data storage

Everything is stored locally in Chrome/Edge extension storage:

- Imported purchase history
- Downloaded receipt rows/summaries
- Captured dashboard listings, including first-found and last-seen timestamps
- Not-wanted title patterns
- Scan settings/state

Nothing is sent to a server by this extension. The only network activity is normal browsing/scanning of Nellis pages while you are logged in.

## Notes

- History match logic is strict: lowercase title, remove spaces/special characters, compare the first 20 alphanumeric characters.
- Strict title-key matches report 95% quality.
- Unmatched listings report no/zero quality but are still captured.
- If Nellis changes the listing card layout, thumbnails/tags/condition ratings may need another tune-up.

## Team sync

This zip includes the Supabase/shared-database SQL and planning files:

- `SUPABASE_TEAM_SYNC_PLAN.md`
- `supabase_schema_v0.sql`

The shared-sync model is: users scan from their own Nellis accounts, the extension contributes listing data to Supabase, admins see all rows, and regular users do not see admin-hidden rows/patterns in their dashboards.



## v4.0.1 Shared pull pagination fix

Supabase limits normal SELECT results to 1,000 rows per request by default. This build changes **Pull shared** and **Sync now** to pull shared listings in 1,000-row pages until all available rows are retrieved, up to a 100,000-row safety cap. This fixes the guest/regular-user dashboard only receiving the first 1,000 shared listings.

## v4.0.0 Team Sync MVP

This build adds Supabase shared sync:

- Sign in with a Supabase Auth user from the popup or dashboard.
- Push local captured listings to the shared Supabase database.
- Pull shared listings found by other users into the local dashboard.
- Sync now = push local, then pull shared.
- Admin users can select rows and use **Admin hide selected** so regular users no longer see those shared listings in their dashboard. Admins still see all rows.
- Team auth tokens are stored locally but are excluded from full backup exports. Sign in again after restoring a backup.

This started as an MVP; current builds include quiet background polling sync. Manual Sync now is still useful for testing and forcing a refresh.


## v4.0.0 Supabase shared-sync MVP notes

Supabase project wired into this build:

- Project URL: `https://mensfqjsgbzdzqhoalic.supabase.co`
- Browser key type: Supabase publishable key

How to use shared sync:

1. Create Supabase Auth users in Supabase.
2. Create/confirm rows in `public.nhs_profiles` for users who need roles.
3. Install this extension build.
4. Sign in from the popup or dashboard Team sync panel.
5. Scan as normal. If signed in, each scanned page attempts to auto-push captured rows to Supabase.
6. Use **Sync now** from the dashboard or popup to push local captured rows and pull shared rows.
7. Admins can select dashboard rows and click **Admin hide selected**. This creates Supabase admin-hidden rules. Regular users will not see those rows when pulling shared listings. Admin users still see all rows.

This release is intentionally MVP-level:

- It does not try to control or modify Nellis accounts.
- It does not hide anything on the actual Nellis website.
- Admin hiding only affects the extension dashboard’s shared listing pull via Supabase RLS.
- Full backup export excludes Supabase auth tokens. Sign in again after restore.


## v4.0.8 - Auction Identity

Adds auction group identity based on pickup location + auction closing date/time. Run `supabase_auction_identity_v407.sql` in Supabase SQL Editor before relying on sync for this version. Existing rows are backfilled as they are scanned/pushed again.

## v4.1.3 - Event-name parser fix

- Keeps multiple Nellis sidebar event names separate even when the sidebar wraps text.
- Prevents combined labels like `Daily Auction - Katy - Jul 6th ... Daily Auction - SW Houston - Jul 6th`.

## v4.1.2 - Nellis event-name grouping

- Captures Nellis sidebar **Event Name** filters during search-page scans.
- Uses event names as the stable shared group key when available.
- Keeps pickup location as listing metadata, but no longer depends on location plus close date to identify the event.
- Adds product-title guards so a listing title is not mistaken for a pickup location/event label.

## v4.1.1 - Active auction mode + extension version badge

- Adds active-auction mode for the shared dashboard.
- The active auction is detected from the dominant scanned auction group: pickup location + auction close date/time.
- When a new auction group is detected, local shared rows from the old auction group are pruned from the normal dashboard.
- Background pull sync now asks Supabase for only the current auction group once one is known.
- If another machine scans a newer auction group, quiet polling can switch clients to that new group and do a fresh active-auction pull.
- Adds an admin overview in the dashboard showing users, devices, pushed/new/updated/skipped/pulled counts, hidden pruned/restored counts, and bid sightings captured during scans.
- Bid sightings use Nellis bid status seen on the card and show the visible bid/current price amount when an exact personal bid amount is not available.
