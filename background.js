const K = {
  TEAM_SESSION: 'teamSupabaseSession',
  TEAM_PROFILE: 'teamSupabaseProfile',
  TEAM_SYNC_STATE: 'teamSyncState',
  TEAM_SYNC_CACHE: 'teamSyncCache',
  TEAM_CURRENT_AUCTION: 'teamCurrentAuction',
  MATCHES: 'scanMatches',
  NOT_WANTED: 'notWantedPatterns',
  SCAN_STATE: 'scanState',
  SETTINGS: 'settings',
  SAVED_FILTERS: 'dashboardFilterPresets',
  INTERNAL_BACKUPS: 'internalBackups'
};

const DEFAULT_SETTINGS = {
  speedMode: 'normal',
  minMatchScore: 0,
  minQualityFilter: 0,
  maxPages: 100,
  receiptMaxPages: 80,
  receiptSpeedMode: 'normal',
  receiptDetailMode: 'details',
  teamSyncEnabled: true,
  teamAutoSyncEnabled: true,
  teamAutoPushAfterScan: true,
  teamAutoPullMinutes: 2,
  teamVisibleReconcileMinutes: 2,
  teamCurrentAuctionOnly: true,
  teamDeviceName: ''
};

async function teamEnsureAlarm() {
  if (!chrome.alarms) return;
  const alarm = await chrome.alarms.get('team-silent-sync').catch(() => null);
  if (!alarm) await chrome.alarms.create('team-silent-sync', { periodInMinutes: 2 });
}

chrome.runtime.onStartup.addListener(() => {
  teamEnsureAlarm().catch(() => {});
});

chrome.runtime.onInstalled.addListener(async details => {
  const existing = await chrome.storage.local.get([K.SETTINGS, K.SCAN_STATE, K.MATCHES, K.NOT_WANTED, K.SAVED_FILTERS, K.INTERNAL_BACKUPS]);
  if (!existing[K.SETTINGS]) await chrome.storage.local.set({ [K.SETTINGS]: DEFAULT_SETTINGS });
  if (!existing[K.SCAN_STATE]) await chrome.storage.local.set({ [K.SCAN_STATE]: idleState() });
  if (!existing[K.MATCHES]) await chrome.storage.local.set({ [K.MATCHES]: [] });
  if (!existing[K.NOT_WANTED]) await chrome.storage.local.set({ [K.NOT_WANTED]: [] });
  if (!existing[K.SAVED_FILTERS]) await chrome.storage.local.set({ [K.SAVED_FILTERS]: [] });
  if (!existing[K.INTERNAL_BACKUPS]) await chrome.storage.local.set({ [K.INTERNAL_BACKUPS]: [] });

  await teamEnsureAlarm();

  if (details && details.reason === 'update') {
    await createInternalBackup(`auto-update-from-${details.previousVersion || 'unknown'}`);
    await teamPrimeSyncCacheFromLocal('update-prime').catch(() => {});
  }
});

async function createInternalBackup(reason) {
  try {
    const storage = await chrome.storage.local.get(null);
    const existing = Array.isArray(storage[K.INTERNAL_BACKUPS]) ? storage[K.INTERNAL_BACKUPS] : [];
    const snapshot = { ...storage };
    delete snapshot[K.INTERNAL_BACKUPS];
    const backup = {
      id: `${reason}-${Date.now()}`,
      app: 'Nellis History Scanner',
      backupFormatVersion: 1,
      extensionVersion: chrome.runtime.getManifest().version,
      createdAt: new Date().toISOString(),
      reason,
      storage: snapshot
    };
    await chrome.storage.local.set({ [K.INTERNAL_BACKUPS]: [backup, ...existing].slice(0, 3) });
  } catch (err) {
    console.warn('Nellis scanner internal backup failed:', err);
  }
}

async function teamPrimeSyncCacheFromLocal(reason = 'prime') {
  const data = await chrome.storage.local.get([K.MATCHES, K.TEAM_SYNC_STATE, K.TEAM_SYNC_CACHE]);
  const rows = data[K.MATCHES] || [];
  const sync = data[K.TEAM_SYNC_STATE] || {};
  const cache = data[K.TEAM_SYNC_CACHE] || {};
  if (!rows.length || Object.keys(cache).length) return { primed: 0 };
  if (!sync.syncedAt && !sync.pulled && !sync.pushed && !sync.localTotal) return { primed: 0 };
  for (const row of rows) teamRememberRow(cache, row, reason);
  await chrome.storage.local.set({ [K.TEAM_SYNC_CACHE]: cache });
  return { primed: rows.length };
}

function idleState(extra = {}) {
  return {
    running: false,
    startedAt: null,
    stoppedAt: null,
    pagesScanned: 0,
    listingsSeen: 0,
    matchesFound: 0,
    currentUrl: '',
    lastMessage: 'Idle',
    seenFingerprints: [],
    ...extra
  };
}

async function getState() {
  const data = await chrome.storage.local.get([K.SCAN_STATE]);
  return data[K.SCAN_STATE] || idleState();
}

async function setState(patch) {
  const state = await getState();
  const next = { ...state, ...patch };
  await chrome.storage.local.set({ [K.SCAN_STATE]: next });
  return next;
}

function compactTitleKey(value, length = 20) {
  const compact = String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (compact.length < length) return '';
  return compact.slice(0, length);
}

function notWantedKey(row) {
  return compactTitleKey(row && row.title);
}

function isNotWanted(row, notWanted) {
  const key = notWantedKey(row);
  if (!key) return false;
  return (notWanted || []).some(x => x && x.key === key);
}

async function mergeMatches(incoming) {
  const data = await chrome.storage.local.get([K.MATCHES, K.NOT_WANTED]);
  const notWanted = data[K.NOT_WANTED] || [];
  const current = data[K.MATCHES] || [];
  const map = new Map(current.map(m => [m.dedupeKey || m.url || `${m.title}|${m.currentPrice}`, m]));
  for (const raw of incoming || []) {
    const seenAt = raw.lastSeenAt || raw.lastModifiedAt || raw.foundAt || new Date().toISOString();
    const m = {
      ...raw,
      firstFoundAt: raw.firstFoundAt || raw.foundAt || seenAt,
      foundAt: raw.foundAt || seenAt,
      lastSeenAt: seenAt,
      lastModifiedAt: seenAt
    };
    if (isNotWanted(m, notWanted)) continue;
    const key = m.dedupeKey || m.url || `${m.title}|${m.currentPrice}`;
    const old = map.get(key);
    if (!old) {
      map.set(key, m);
    } else {
      // Keep the row persistent, but let fresh scans update live fields like
      // current price, bid count, condition rating, tags, thumbnail, and bid status.
      map.set(key, {
        ...old,
        ...m,
        score: Math.max(Number(old.score || 0), Number(m.score || 0)),
        foundAt: old.foundAt || old.firstFoundAt || m.foundAt,
        firstFoundAt: old.firstFoundAt || old.foundAt || m.firstFoundAt || m.foundAt,
        lastSeenAt: seenAt,
        lastModifiedAt: seenAt
      });
    }
  }
  const merged = Array.from(map.values()).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  await chrome.storage.local.set({ [K.MATCHES]: merged });
  return merged;
}

const SUPABASE_URL = 'https://mensfqjsgbzdzqhoalic.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mNiKTv8njWEzLrfEWUPUAg_IqE04a86';

function normalizeText(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[^a-zA-Z0-9.#+\-/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function displayText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function teamNowIso() {
  return new Date().toISOString();
}

function teamChunk(list, size = 200) {
  const out = [];
  for (let i = 0; i < (list || []).length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function teamTagsArray(tagsValue) {
  const parts = String(tagsValue || '')
    .split(/;|,/)
    .map(x => displayText(x).toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(parts.length ? parts : ['new']));
}

function teamItemIdFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(\d+)\/?$/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function isRelativeAuctionClose(value) {
  const raw = displayText(value);
  return /^(?:time\s+left\s*)?(?:in\s+)?\d+\s*(?:d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?:\s+\d+\s*(?:d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes))*$/i.test(raw);
}

function relativeAuctionCloseToIso(value) {
  const raw = displayText(value).replace(/^(?:time\s+left|in)\s*/i, '');
  if (!raw || !isRelativeAuctionClose(raw)) return '';
  let ms = 0;
  const re = /(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/ig;
  let m;
  while ((m = re.exec(raw))) {
    const n = Number(m[1]);
    const unit = String(m[2] || '').toLowerCase();
    if (!Number.isFinite(n)) continue;
    if (/^d|day/.test(unit)) ms += n * 24 * 60 * 60 * 1000;
    else if (/^h|hr|hour/.test(unit)) ms += n * 60 * 60 * 1000;
    else ms += n * 60 * 1000;
  }
  if (!ms) return '';
  const target = new Date(Date.now() + ms);
  target.setSeconds(0, 0);
  if (!/\b(?:m|min|minute)/i.test(raw)) target.setMinutes(0, 0, 0);
  return target.toISOString();
}

function parseAuctionCloseToIso(value) {
  const raw = displayText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}t/i.test(raw)) return raw;
  if (isRelativeAuctionClose(raw)) return relativeAuctionCloseToIso(raw);

  const now = new Date();
  const currentYear = now.getFullYear();
  const cleaned = raw
    .replace(/\b(closes?|auction closes?|closing|close date|close time|ends?|ending|time left)\b\s*:?/ig, ' ')
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/ig, '$1')
    .replace(/\bat\b/ig, ' ')
    .replace(/\b(today|tomorrow)\b/ig, match => {
      const d = new Date();
      if (/tomorrow/i.test(match)) d.setDate(d.getDate() + 1);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    })
    .replace(/\s+/g, ' ')
    .trim();

  const candidates = [cleaned];
  if (!/\b\d{4}\b/.test(cleaned)) {
    if (/^\d{1,2}[\/\-]\d{1,2}\b/.test(cleaned)) {
      candidates.push(cleaned.replace(/^(\d{1,2}[\/\-]\d{1,2})\b/, `$1/${currentYear}`));
    }
    candidates.push(`${cleaned} ${currentYear}`);
  }

  for (const candidate of candidates) {
    const t = Date.parse(candidate);
    if (Number.isFinite(t)) {
      const parsed = new Date(t);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return '';
}

function buildAuctionGroupKey(locationValue, closesValue, closesIsoValue = '') {
  const loc = normalizeText(locationValue).replace(/\s+/g, '-');
  const rawClose = displayText(closesValue);
  const iso = displayText(closesIsoValue) || parseAuctionCloseToIso(rawClose);
  const closeKey = iso ? (isRelativeAuctionClose(rawClose) ? iso.slice(0, 10) : iso.slice(0, 16)) : normalizeText(rawClose).replace(/\s+/g, '-');
  if (!loc && !closeKey) return '';
  return `${loc || 'unknown-location'}|${closeKey || 'unknown-close'}`;
}

async function teamSaveSession(session) {
  if (!session) return null;
  const normalized = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type || 'bearer',
    expires_in: session.expires_in,
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
    user: session.user || null,
    saved_at: teamNowIso()
  };
  await chrome.storage.local.set({ [K.TEAM_SESSION]: normalized });
  return normalized;
}

async function teamRefreshSession(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!res.ok) throw new Error(`refresh failed ${res.status}`);
  return await teamSaveSession(await res.json());
}

async function teamGetSession() {
  const data = await chrome.storage.local.get(K.TEAM_SESSION);
  let session = data[K.TEAM_SESSION] || null;
  if (!session?.access_token) return null;
  const expiresAt = Number(session.expires_at || 0);
  if (session.refresh_token && expiresAt && Date.now() / 1000 > expiresAt - 90) {
    try { session = await teamRefreshSession(session.refresh_token); } catch {}
  }
  return session;
}

async function teamLoadProfile(force = false) {
  if (!force) {
    const existing = await chrome.storage.local.get(K.TEAM_PROFILE);
    if (existing[K.TEAM_PROFILE]) return existing[K.TEAM_PROFILE];
  }
  const session = await teamGetSession();
  if (!session?.user?.id) return null;
  const uid = encodeURIComponent(session.user.id);
  const rows = await teamRequest(`/rest/v1/nhs_profiles?select=*&user_id=eq.${uid}&limit=1`);
  const profile = Array.isArray(rows) && rows[0] ? rows[0] : {
    user_id: session.user.id,
    email: session.user.email,
    display_name: session.user.email || 'User',
    role: 'user'
  };
  await chrome.storage.local.set({ [K.TEAM_PROFILE]: profile });
  return profile;
}

async function teamRequest(path, options = {}) {
  const session = await teamGetSession();
  if (!session?.access_token) throw new Error('not signed in');
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === 'object' ? (data.message || JSON.stringify(data)) : String(data || res.status));
  return data;
}

function teamLocalToRemote(row, userId) {
  const title = displayText(row.title);
  const url = displayText(row.url);
  const now = teamNowIso();
  const rating = row.conditionRating === null || row.conditionRating === undefined || row.conditionRating === ''
    ? null
    : Math.max(0, Math.min(5, Number(row.conditionRating) || 0));
  const lastSeen = row.lastSeenAt || row.lastModifiedAt || row.foundAt || now;
  const auctionLocation = displayText(row.auctionLocation || row.locationName || '');
  const auctionClosesRaw = displayText(row.auctionClosesRaw || '');
  const auctionClosesAt = displayText(row.auctionClosesAt || parseAuctionCloseToIso(auctionClosesRaw));
  const auctionGroupKey = displayText(row.auctionGroupKey || buildAuctionGroupKey(auctionLocation, auctionClosesRaw, auctionClosesAt));
  return {
    nellis_item_id: row.nellisItemId || teamItemIdFromUrl(url) || null,
    url,
    title,
    normalized_title_key: normalizeText(title),
    first20_key: compactTitleKey(title),
    thumbnail_url: row.imageUrl || null,
    current_price: Number(row.currentPrice || 0),
    retail_price: Number(row.estRetail || 0),
    bid_count: Number(row.bids || 0),
    condition_rating: rating,
    tags: teamTagsArray(row.itemTags),
    auction_location: auctionLocation || null,
    auction_closes_raw: auctionClosesRaw || null,
    auction_closes_at: auctionClosesAt || null,
    auction_group_key: auctionGroupKey || null,
    bid_status: row.userBidStatus || null,
    raw_payload: row || {},
    first_seen_at: row.firstFoundAt || row.foundAt || lastSeen,
    last_seen_at: lastSeen,
    last_modified_at: row.lastModifiedAt || lastSeen,
    first_seen_by: userId || null,
    last_seen_by: userId || null
  };
}

function teamLivePatch(row, userId) {
  const now = teamNowIso();
  const lastSeen = row.lastSeenAt || row.lastModifiedAt || row.foundAt || now;
  const patch = {
    current_price: Number(row.currentPrice || 0),
    bid_count: Number(row.bids || 0),
    last_seen_at: lastSeen,
    last_modified_at: row.lastModifiedAt || lastSeen,
    last_seen_by: userId || null
  };

  // Static auction identity normally should be written once, but older rows were
  // captured before these columns existed. Carry non-empty values on live patches
  // so old server rows can be backfilled without re-uploading everything.
  const auctionLocation = displayText(row.auctionLocation || row.locationName || '');
  const auctionClosesRaw = displayText(row.auctionClosesRaw || '');
  const auctionClosesAt = displayText(row.auctionClosesAt || parseAuctionCloseToIso(auctionClosesRaw));
  const auctionGroupKey = displayText(row.auctionGroupKey || buildAuctionGroupKey(auctionLocation, auctionClosesRaw, auctionClosesAt));
  if (auctionLocation) patch.auction_location = auctionLocation;
  if (auctionClosesRaw) patch.auction_closes_raw = auctionClosesRaw;
  if (auctionClosesAt) patch.auction_closes_at = auctionClosesAt;
  if (auctionGroupKey) patch.auction_group_key = auctionGroupKey;

  return patch;
}

function teamCacheKey(row) {
  return displayText(row && row.url);
}

function teamLiveSignature(row) {
  const price = Number(row && row.currentPrice || 0).toFixed(2);
  const bids = Number(row && row.bids || 0);
  return `${price}|${bids}`;
}

function teamFullSignature(row) {
  return [
    displayText(row && row.title),
    displayText(row && row.url),
    displayText(row && row.imageUrl),
    Number(row && row.estRetail || 0).toFixed(2),
    row && row.conditionRating === null ? '' : String((row && row.conditionRating) ?? ''),
    teamTagsArray(row && row.itemTags).join(';'),
    displayText(row && (row.auctionGroupKey || buildAuctionGroupKey(row.auctionLocation || row.locationName || '', row.auctionClosesRaw || '', row.auctionClosesAt || '')))
  ].join('|');
}

async function teamReadSyncCache() {
  const data = await chrome.storage.local.get(K.TEAM_SYNC_CACHE);
  const cache = data[K.TEAM_SYNC_CACHE];
  return cache && typeof cache === 'object' ? cache : {};
}

async function teamWriteSyncCache(cache) {
  await chrome.storage.local.set({ [K.TEAM_SYNC_CACHE]: cache || {} });
}

function teamRememberRow(cache, row, mode = 'known') {
  const key = teamCacheKey(row);
  if (!key) return;
  cache[key] = {
    known: true,
    mode,
    fullSig: teamFullSignature(row),
    liveSig: teamLiveSignature(row),
    price: Number(row.currentPrice || 0),
    bids: Number(row.bids || 0),
    lastSyncedAt: teamNowIso()
  };
}


function teamAuctionCandidateFromRows(rows) {
  const counts = new Map();
  for (const row of rows || []) {
    const key = displayText(row && (row.auctionGroupKey || buildAuctionGroupKey(row.auctionLocation || row.locationName || '', row.auctionClosesRaw || '', row.auctionClosesAt || '')));
    if (!key) continue;
    const existing = counts.get(key) || { groupKey: key, count: 0, location: '', closesRaw: '', closesAt: '', sampleTitle: '' };
    existing.count++;
    existing.location = existing.location || displayText(row.auctionLocation || row.locationName || '');
    existing.closesRaw = existing.closesRaw || displayText(row.auctionClosesRaw || '');
    existing.closesAt = existing.closesAt || displayText(row.auctionClosesAt || parseAuctionCloseToIso(existing.closesRaw));
    existing.sampleTitle = existing.sampleTitle || displayText(row.title || '');
    counts.set(key, existing);
  }
  if (!counts.size) return null;
  return Array.from(counts.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (Date.parse(b.closesAt || '') || 0) - (Date.parse(a.closesAt || '') || 0);
  })[0];
}

async function teamReadCurrentAuction() {
  const data = await chrome.storage.local.get(K.TEAM_CURRENT_AUCTION);
  return data[K.TEAM_CURRENT_AUCTION] || null;
}

async function teamWriteCurrentAuction(candidate, source = 'unknown') {
  if (!candidate || !candidate.groupKey) return { changed: false, current: await teamReadCurrentAuction() };
  const old = await teamReadCurrentAuction();
  const changed = old?.groupKey !== candidate.groupKey;
  const current = {
    ...old,
    ...candidate,
    source,
    detectedAt: teamNowIso(),
    previousGroupKey: changed ? (old?.groupKey || '') : (old?.previousGroupKey || '')
  };
  await chrome.storage.local.set({ [K.TEAM_CURRENT_AUCTION]: current });
  return { changed, current, previous: old || null };
}

async function teamPruneLocalToAuctionGroup(groupKey) {
  const key = displayText(groupKey);
  if (!key) return { pruned: 0, localTotal: 0 };
  const data = await chrome.storage.local.get(K.MATCHES);
  const current = data[K.MATCHES] || [];
  let pruned = 0;
  const next = current.filter(row => {
    const rowGroup = displayText(row && row.auctionGroupKey);
    if (!rowGroup) return false;
    if (rowGroup !== key) {
      pruned++;
      return false;
    }
    return true;
  });
  if (next.length !== current.length) await chrome.storage.local.set({ [K.MATCHES]: next });
  return { pruned, localTotal: next.length };
}

async function teamSetCurrentAuctionFromRows(rows, source = 'scan') {
  const candidate = teamAuctionCandidateFromRows(rows);
  if (!candidate) return { changed: false, current: await teamReadCurrentAuction(), pruned: 0 };
  const result = await teamWriteCurrentAuction(candidate, source);
  let prune = { pruned: 0 };
  if (result.changed) {
    prune = await teamPruneLocalToAuctionGroup(candidate.groupKey);
    const syncData = await chrome.storage.local.get(K.TEAM_SYNC_STATE);
    await chrome.storage.local.set({
      [K.TEAM_SYNC_STATE]: {
        ...(syncData[K.TEAM_SYNC_STATE] || {}),
        currentAuctionGroupKey: candidate.groupKey,
        currentAuctionSwitchedAt: teamNowIso(),
        lastPullAt: '',
        prunedOldAuctionRows: prune.pruned || 0
      }
    });
  }
  return { ...result, ...prune };
}

async function teamLatestAuctionFromServer() {
  const rows = await teamRequest('/rest/v1/nhs_listings?select=auction_group_key,auction_location,auction_closes_raw,auction_closes_at,last_seen_at,title&order=last_seen_at.desc&limit=75');
  const candidate = teamAuctionCandidateFromRows((Array.isArray(rows) ? rows : []).map(r => ({
    auctionGroupKey: r.auction_group_key,
    auctionLocation: r.auction_location,
    auctionClosesRaw: r.auction_closes_raw,
    auctionClosesAt: r.auction_closes_at,
    title: r.title
  })).filter(r => r.auctionGroupKey));
  if (!candidate) return null;
  const result = await teamWriteCurrentAuction(candidate, 'server-latest');
  return result.current;
}

async function teamResolveCurrentAuction(settings = {}) {
  if (settings.teamCurrentAuctionOnly === false) return null;
  const existing = await teamReadCurrentAuction();
  const minutes = Math.max(1, Math.min(10, Number(settings.teamAutoPullMinutes || 2)));
  const lastChecked = Date.parse(existing?.latestCheckedAt || existing?.detectedAt || '') || 0;
  if (existing?.groupKey && lastChecked && Date.now() - lastChecked < minutes * 60 * 1000) return existing;
  const latest = await teamLatestAuctionFromServer().catch(() => null);
  if (latest?.groupKey) {
    const current = { ...latest, latestCheckedAt: teamNowIso() };
    await chrome.storage.local.set({ [K.TEAM_CURRENT_AUCTION]: current });
    return current;
  }
  if (existing?.groupKey) {
    const touched = { ...existing, latestCheckedAt: teamNowIso() };
    await chrome.storage.local.set({ [K.TEAM_CURRENT_AUCTION]: touched });
    return touched;
  }
  return null;
}

function teamPlanDirtyRows(localRows, cache) {
  const usable = (localRows || []).filter(r => r && r.url && r.title);
  const fullRows = [];
  const liveRows = [];
  let skipped = 0;
  for (const row of usable) {
    const key = teamCacheKey(row);
    if (!key) continue;
    const entry = cache[key];
    const liveSig = teamLiveSignature(row);
    const fullSig = teamFullSignature(row);
    const alreadyKnown = !!entry?.known || !!row.teamListingId || !!row.teamSource;
    if (!alreadyKnown) fullRows.push(row);
    else if (!entry?.fullSig && fullSig) fullRows.push(row);
    else if (entry?.fullSig && entry.fullSig !== fullSig) fullRows.push(row);
    else if (entry?.liveSig !== liveSig) liveRows.push(row);
    else skipped++;
  }
  return { usable, fullRows, liveRows, skipped };
}

async function teamInsertSnapshotsFromRemoteRows(remoteRows, userId) {
  const snapshotRows = (Array.isArray(remoteRows) ? remoteRows : []).map(r => ({
    listing_id: r.id,
    scanned_by: userId,
    current_price: r.current_price,
    retail_price: r.retail_price,
    bid_count: r.bid_count,
    condition_rating: r.condition_rating,
    tags: r.tags || [],
    auction_location: r.auction_location || null,
    auction_closes_raw: r.auction_closes_raw || null,
    auction_closes_at: r.auction_closes_at || null,
    auction_group_key: r.auction_group_key || null,
    bid_status: r.bid_status,
    raw_payload: r.raw_payload || {}
  })).filter(r => r.listing_id);
  if (!snapshotRows.length) return 0;
  for (const chunk of teamChunk(snapshotRows, 150)) {
    await teamRequest('/rest/v1/nhs_listing_snapshots', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: chunk });
  }
  return snapshotRows.length;
}

async function teamDirtyPushRows(rows, deviceName = 'background') {
  const session = await teamGetSession();
  if (!session?.user?.id) return { pushed: 0, skipped: 0, reason: 'not signed in' };
  const settingsData = await chrome.storage.local.get(K.SETTINGS);
  const settings = { ...DEFAULT_SETTINGS, ...(settingsData[K.SETTINGS] || {}) };
  if (settings.teamAutoSyncEnabled === false || settings.teamAutoPushAfterScan === false) {
    return { pushed: 0, skipped: 0, reason: 'auto sync off' };
  }

  const cache = await teamReadSyncCache();
  const plan = teamPlanDirtyRows(rows || [], cache);
  let full = 0;
  let live = 0;
  let snapshots = 0;

  for (const chunk of teamChunk(plan.fullRows, 150)) {
    const body = chunk.map(row => teamLocalToRemote(row, session.user.id));
    const upserted = await teamRequest('/rest/v1/nhs_listings?on_conflict=url', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body
    });
    full += Array.isArray(upserted) ? upserted.length : body.length;
    snapshots += await teamInsertSnapshotsFromRemoteRows(upserted, session.user.id);
    chunk.forEach(row => teamRememberRow(cache, row, 'auto-full'));
  }

  for (const row of plan.liveRows) {
    const key = teamCacheKey(row);
    const patched = await teamRequest(`/rest/v1/nhs_listings?url=eq.${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: teamLivePatch(row, session.user.id)
    });
    const patchedRows = Array.isArray(patched) ? patched : [];
    live += patchedRows.length || 1;
    snapshots += await teamInsertSnapshotsFromRemoteRows(patchedRows, session.user.id);
    teamRememberRow(cache, row, 'auto-live');
  }

  await teamWriteSyncCache(cache);
  const pushed = full + live;
  const now = teamNowIso();
  const previous = await chrome.storage.local.get(K.TEAM_SYNC_STATE);
  const sync = {
    ...(previous[K.TEAM_SYNC_STATE] || {}),
    autoPushed: pushed,
    autoFull: full,
    autoLive: live,
    autoSkipped: plan.skipped,
    autoSnapshots: snapshots,
    autoSyncedAt: now,
    syncedAt: now
  };
  await chrome.storage.local.set({ [K.TEAM_SYNC_STATE]: sync });

  if (pushed) {
    await teamRequest('/rest/v1/nhs_sync_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: [{ user_id: session.user.id, device_name: deviceName, action: 'auto-dirty-push', item_count: pushed, details: { full, live, skipped: plan.skipped, snapshots } }]
    }).catch(() => {});
  }

  return { pushed, full, live, skipped: plan.skipped, snapshots, syncedAt: now };
}

function teamRemoteToLocal(row) {
  const raw = row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
  const tags = Array.isArray(row.tags) && row.tags.length ? row.tags.join('; ') : 'New';
  const rating = row.condition_rating === null || row.condition_rating === undefined ? null : Number(row.condition_rating);
  return {
    ...raw,
    teamListingId: row.id,
    teamSource: true,
    title: row.title || raw.title || '',
    url: row.url || raw.url || '',
    imageUrl: row.thumbnail_url || raw.imageUrl || '',
    currentPrice: Number(row.current_price || 0),
    estRetail: Number(row.retail_price || 0),
    bids: Number(row.bid_count || 0),
    conditionRating: Number.isFinite(rating) ? rating : null,
    itemCondition: Number.isFinite(rating) ? `${rating}/5` : (raw.itemCondition || ''),
    itemTags: tags,
    locationName: row.auction_location || raw.auctionLocation || raw.locationName || '',
    auctionLocation: row.auction_location || raw.auctionLocation || raw.locationName || '',
    auctionClosesRaw: row.auction_closes_raw || raw.auctionClosesRaw || '',
    auctionClosesAt: row.auction_closes_at || raw.auctionClosesAt || '',
    auctionGroupKey: row.auction_group_key || raw.auctionGroupKey || buildAuctionGroupKey(row.auction_location || raw.auctionLocation || raw.locationName || '', row.auction_closes_raw || raw.auctionClosesRaw || '', row.auction_closes_at || raw.auctionClosesAt || ''),
    userBidStatus: row.bid_status || raw.userBidStatus || '',
    hasUserBid: !!(row.bid_status || raw.hasUserBid),
    firstFoundAt: row.first_seen_at || raw.firstFoundAt || raw.foundAt || '',
    foundAt: row.first_seen_at || raw.foundAt || '',
    lastSeenAt: row.last_seen_at || raw.lastSeenAt || '',
    lastModifiedAt: row.last_modified_at || raw.lastModifiedAt || row.last_seen_at || '',
    dedupeKey: row.url || raw.dedupeKey || `${compactTitleKey(row.title)}|${row.current_price}`
  };
}

function teamMergeLiveFields(old, row) {
  return {
    ...old,
    teamListingId: row.teamListingId || old.teamListingId,
    teamSource: old.teamSource || row.teamSource,
    currentPrice: Number(row.currentPrice || 0),
    bids: Number(row.bids || 0),
    locationName: old.locationName || row.locationName || '',
    auctionLocation: old.auctionLocation || row.auctionLocation || row.locationName || '',
    auctionClosesRaw: old.auctionClosesRaw || row.auctionClosesRaw || '',
    auctionClosesAt: old.auctionClosesAt || row.auctionClosesAt || '',
    auctionGroupKey: old.auctionGroupKey || row.auctionGroupKey || '',
    lastSeenAt: row.lastSeenAt || old.lastSeenAt,
    lastModifiedAt: row.lastModifiedAt || old.lastModifiedAt
  };
}

async function teamFetchListingPages({ since = '', select = '*', order = '', maxRows = 100000, auctionGroupKey = '' } = {}) {
  const all = [];
  const selected = encodeURIComponent(select || '*');
  const orderBy = encodeURIComponent(order || (since ? 'updated_at.asc,id.asc' : 'last_seen_at.desc,id.asc'));
  const filters = [];
  if (since) filters.push(`updated_at=gt.${encodeURIComponent(since)}`);
  if (auctionGroupKey) filters.push(`auction_group_key=eq.${encodeURIComponent(auctionGroupKey)}`);
  const filter = filters.length ? `&${filters.join('&')}` : '';
  let truncated = false;

  for (let offset = 0; offset < maxRows; offset += 1000) {
    const take = Math.min(1000, maxRows - offset);
    const query = `/rest/v1/nhs_listings?select=${selected}&order=${orderBy}&limit=${take}&offset=${offset}${filter}`;
    const remote = await teamRequest(query);
    const page = Array.isArray(remote) ? remote : [];
    all.push(...page);
    if (page.length < take) return { rows: all, truncated: false };
  }

  truncated = true;
  return { rows: all, truncated };
}

async function teamMergeRemoteRowsIntoLocal(remoteRows, { pruneMissingShared = false } = {}) {
  const remoteLocalRows = (remoteRows || []).map(teamRemoteToLocal);
  const data = await chrome.storage.local.get(K.MATCHES);
  const current = data[K.MATCHES] || [];
  const cache = await teamReadSyncCache();
  const visibleRemoteKeys = new Set(remoteLocalRows.map(teamCacheKey).filter(Boolean));
  const map = new Map();
  let pruned = 0;

  for (const row of current) {
    const rowUrl = teamCacheKey(row);
    const key = row.dedupeKey || rowUrl || `${row.title}|${row.currentPrice}`;
    const sharedKnown = !!row.teamListingId || !!row.teamSource || !!cache[rowUrl]?.known;
    if (pruneMissingShared && sharedKnown && rowUrl && !visibleRemoteKeys.has(rowUrl)) {
      pruned++;
      continue;
    }
    map.set(key, row);
  }

  for (const remoteRow of remoteLocalRows) {
    const key = remoteRow.dedupeKey || remoteRow.url || `${remoteRow.title}|${remoteRow.currentPrice}`;
    const old = map.get(key);
    const merged = old ? teamMergeLiveFields(old, remoteRow) : remoteRow;
    map.set(key, merged);
    teamRememberRow(cache, merged, old ? 'auto-pulled-live' : 'auto-pulled-full');
  }

  const mergedRows = Array.from(map.values()).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  await chrome.storage.local.set({ [K.MATCHES]: mergedRows });
  await teamWriteSyncCache(cache);
  return { localTotal: mergedRows.length, pruned };
}

async function teamFetchOneListingByUrl(url) {
  if (!url) return [];
  const rows = await teamRequest(`/rest/v1/nhs_listings?select=*&url=eq.${encodeURIComponent(url)}&limit=1`);
  return Array.isArray(rows) ? rows : [];
}

async function teamReconcileVisibleRows(sync, settings, options = {}) {
  const profile = await teamLoadProfile(false).catch(() => null);
  if ((profile?.role || 'user') === 'admin') return { pruned: 0, restored: 0, skipped: true, reason: 'admin sees hidden rows' };

  const minutes = Math.max(1, Math.min(2, Number(settings.teamVisibleReconcileMinutes || 2)));
  const last = Date.parse(sync.lastVisibleReconcileAt || '') || 0;
  if (!options.force && last && Date.now() - last < minutes * 60 * 1000) {
    return { pruned: 0, restored: 0, skipped: true, reason: 'not due' };
  }

  const pullStartedAt = teamNowIso();
  const currentAuction = await teamResolveCurrentAuction(settings);
  const auctionGroupKey = currentAuction?.groupKey || '';
  const { rows, truncated } = await teamFetchListingPages({ select: 'url,updated_at,auction_group_key', order: 'updated_at.asc,id.asc', maxRows: 100000, auctionGroupKey });
  if (truncated) return { pruned: 0, restored: 0, skipped: true, reason: 'visible set too large' };

  const visibleUrls = new Set(rows.map(r => displayText(r.url)).filter(Boolean));
  const data = await chrome.storage.local.get([K.MATCHES, K.TEAM_SYNC_CACHE, K.TEAM_SYNC_STATE]);
  const current = data[K.MATCHES] || [];
  const cache = data[K.TEAM_SYNC_CACHE] || {};
  const localSharedUrls = new Set();
  let pruned = 0;

  const nextRows = current.filter(row => {
    const rowUrl = teamCacheKey(row);
    const sharedKnown = !!row.teamListingId || !!row.teamSource || !!cache[rowUrl]?.known;
    if (sharedKnown && rowUrl) localSharedUrls.add(rowUrl);
    if (sharedKnown && rowUrl && !visibleUrls.has(rowUrl)) {
      pruned++;
      return false;
    }
    return true;
  });

  let restored = 0;
  let restoredSkipped = 0;
  const shouldRestore = options.restoreMissing !== false;
  const restoreLimit = Math.max(0, Math.min(250, Number(options.restoreLimit || 50)));
  const missingUrls = shouldRestore ? Array.from(visibleUrls).filter(url => !localSharedUrls.has(url)) : [];
  const restoreUrls = missingUrls.slice(0, restoreLimit);
  const restoredRemoteRows = [];

  for (const url of restoreUrls) {
    const found = await teamFetchOneListingByUrl(url).catch(() => []);
    if (found && found.length) restoredRemoteRows.push(...found);
  }
  restored = restoredRemoteRows.length;
  restoredSkipped = Math.max(0, missingUrls.length - restoreUrls.length);

  if (pruned || restored) await chrome.storage.local.set({ [K.MATCHES]: nextRows });
  let localTotal = nextRows.length;
  if (restoredRemoteRows.length) {
    const merge = await teamMergeRemoteRowsIntoLocal(restoredRemoteRows, { pruneMissingShared: false });
    localTotal = merge.localTotal;
  }

  const latest = (data[K.TEAM_SYNC_STATE] || {});
  await chrome.storage.local.set({
    [K.TEAM_SYNC_STATE]: {
      ...latest,
      lastVisibleReconcileAt: pullStartedAt,
      prunedHidden: pruned,
      restoredMissing: restored,
      restoreMissingSkipped: restoredSkipped,
      localTotal,
      syncedAt: pullStartedAt
    }
  });
  return { pruned, restored, restoredSkipped, localTotal, syncedAt: pullStartedAt };
}

async function teamPullChangedListings() {
  const session = await teamGetSession();
  if (!session?.user?.id) return { pulled: 0, reason: 'not signed in' };
  const settingsData = await chrome.storage.local.get(K.SETTINGS);
  const settings = { ...DEFAULT_SETTINGS, ...(settingsData[K.SETTINGS] || {}) };
  if (settings.teamAutoSyncEnabled === false) return { pulled: 0, reason: 'auto sync off' };

  const syncData = await chrome.storage.local.get(K.TEAM_SYNC_STATE);
  const sync = syncData[K.TEAM_SYNC_STATE] || {};
  const currentAuction = await teamResolveCurrentAuction(settings);
  const auctionGroupKey = currentAuction?.groupKey || '';
  const auctionChanged = !!auctionGroupKey && sync.currentAuctionGroupKey !== auctionGroupKey;
  const since = auctionChanged ? '' : (sync.lastPullAt || '');
  const pullStartedAt = teamNowIso();
  const initialFullPull = !since;
  const { rows: all } = await teamFetchListingPages({ since, select: '*', order: since ? 'updated_at.asc,id.asc' : 'last_seen_at.desc,id.asc', maxRows: 100000, auctionGroupKey });
  const merge = (all.length || initialFullPull || auctionChanged) ? await teamMergeRemoteRowsIntoLocal(all, { pruneMissingShared: !!auctionGroupKey || initialFullPull }) : { localTotal: sync.localTotal, pruned: 0 };

  const next = {
    ...sync,
    autoPulled: all.length,
    autoPullMode: initialFullPull ? (auctionGroupKey ? 'current-auction-full' : 'initial-full') : 'changed',
    currentAuctionGroupKey: auctionGroupKey || sync.currentAuctionGroupKey || '',
    currentAuctionLabel: currentAuction ? `${currentAuction.location || ''} ${currentAuction.closesAt || currentAuction.closesRaw || ''}`.trim() : (sync.currentAuctionLabel || ''),
    prunedHidden: merge.pruned || 0,
    localTotal: merge.localTotal,
    lastPullAt: pullStartedAt,
    syncedAt: pullStartedAt
  };
  await chrome.storage.local.set({ [K.TEAM_SYNC_STATE]: next });
  return { pulled: all.length, pruned: merge.pruned || 0, initialFullPull, localTotal: merge.localTotal, syncedAt: pullStartedAt, currentAuctionGroupKey: auctionGroupKey || '' };
}

async function teamSilentAutoSync(reason = 'alarm', options = {}) {
  try {
    const data = await chrome.storage.local.get([K.SETTINGS, K.TEAM_SYNC_STATE]);
    const settings = { ...DEFAULT_SETTINGS, ...(data[K.SETTINGS] || {}) };
    if (settings.teamAutoSyncEnabled === false) return null;
    // Do not sweep-push the entire local archive from an alarm. Scan pages push
    // only the rows they just saw. The alarm pulls server-side changes and
    // occasionally reconciles visible rows so admin-hidden listings disappear
    // from regular-user dashboards.
    const pull = await teamPullChangedListings();
    const latest = await chrome.storage.local.get(K.TEAM_SYNC_STATE);
    const reconcile = await teamReconcileVisibleRows(latest[K.TEAM_SYNC_STATE] || {}, settings, { force: !!options.forceReconcile, restoreMissing: options.restoreMissing !== false, restoreLimit: options.restoreLimit || (options.forceReconcile ? 250 : 50) }).catch(err => ({ pruned: 0, restored: 0, error: err.message || String(err) }));
    const now = teamNowIso();
    const prev = await chrome.storage.local.get(K.TEAM_SYNC_STATE).catch(() => ({}));
    await chrome.storage.local.set({ [K.TEAM_SYNC_STATE]: { ...(prev[K.TEAM_SYNC_STATE] || {}), autoSyncedAt: now, lastAutoReason: reason, lastAutoPull: pull, lastAutoReconcile: reconcile, restoredMissing: reconcile.restored || 0, prunedHidden: reconcile.pruned || ((prev[K.TEAM_SYNC_STATE] || {}).prunedHidden || 0), syncedAt: now } });
    const session = await teamGetSession().catch(() => null);
    const changedCount = Number(pull?.pulled || 0) + Number(reconcile?.restored || 0) + Number(reconcile?.pruned || 0);
    if (session?.user?.id && (changedCount || /^dashboard|^popup|manual/i.test(String(reason || '')))) {
      await teamRequest('/rest/v1/nhs_sync_log', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: [{ user_id: session.user.id, device_name: settings.teamDeviceName || 'background', action: 'auto-pull-listings', item_count: Number(pull?.pulled || 0), details: { pulled: pull?.pulled || 0, pruned: reconcile?.pruned || 0, restored: reconcile?.restored || 0, reason, currentAuctionGroupKey: pull?.currentAuctionGroupKey || (prev[K.TEAM_SYNC_STATE] || {}).currentAuctionGroupKey || '' } }]
      }).catch(() => {});
    }
    return { pull, reconcile, reason };
  } catch (err) {
    console.warn('Nellis team silent sync failed:', err.message || err);
    const prev = await chrome.storage.local.get(K.TEAM_SYNC_STATE).catch(() => ({}));
    await chrome.storage.local.set({ [K.TEAM_SYNC_STATE]: { ...(prev[K.TEAM_SYNC_STATE] || {}), lastAutoSyncError: err.message || String(err), lastAutoSyncErrorAt: teamNowIso() } }).catch(() => {});
    return null;
  }
}
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm && alarm.name === 'team-silent-sync') teamSilentAutoSync('alarm');
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'TEAM_SILENT_SYNC_NOW') {
        const result = await teamSilentAutoSync(message.reason || 'manual-message', message || {});
        sendResponse({ ok: true, result });
        return;
      }

      if (message.type === 'START_SCAN') {
        const existing = await chrome.storage.local.get([K.MATCHES]);
        const state = idleState({
          running: true,
          startedAt: new Date().toISOString(),
          currentUrl: message.url || '',
          matchesFound: (existing[K.MATCHES] || []).length,
          lastMessage: 'Starting scan. Existing captured listings are being kept.'
        });
        await chrome.storage.local.set({ [K.SCAN_STATE]: state });
        sendResponse({ ok: true, state });
        return;
      }

      if (message.type === 'STOP_SCAN') {
        const state = await setState({ running: false, stoppedAt: new Date().toISOString(), lastMessage: message.reason || 'Stopped' });
        sendResponse({ ok: true, state });
        return;
      }

      if (message.type === 'PAGE_SCANNED') {
        const auctionSwitch = await teamSetCurrentAuctionFromRows(message.matches || [], 'scan-page').catch(() => null);
        const merged = await mergeMatches(message.matches || []);
        if (auctionSwitch?.current?.groupKey) await teamPruneLocalToAuctionGroup(auctionSwitch.current.groupKey).catch(() => null);
        const teamSync = await teamDirtyPushRows(message.matches || [], 'scan-page');
        const state = await getState();
        const seen = Array.from(new Set([...(state.seenFingerprints || []), message.fingerprint].filter(Boolean))).slice(-50);
        const next = await setState({
          pagesScanned: Number(state.pagesScanned || 0) + 1,
          listingsSeen: Number(state.listingsSeen || 0) + Number(message.listingsSeen || 0),
          matchesFound: merged.length,
          currentUrl: message.url || state.currentUrl,
          lastMessage: (message.lastMessage || `Scanned page ${Number(state.pagesScanned || 0) + 1}`) + (auctionSwitch?.changed ? ' New auction group detected.' : '') + (teamSync && teamSync.pushed ? ` Team sync pushed ${teamSync.pushed}.` : ''),
          seenFingerprints: seen
        });
        sendResponse({ ok: true, state: next, totalMatches: merged.length });
        return;
      }

      if (message.type === 'GET_SCAN_STATE') {
        const data = await chrome.storage.local.get([K.SCAN_STATE, K.MATCHES]);
        sendResponse({ ok: true, state: data[K.SCAN_STATE] || idleState(), matches: data[K.MATCHES] || [] });
        return;
      }

      sendResponse({ ok: false, error: 'Unknown message type' });
    } catch (err) {
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  })();
  return true;
});
