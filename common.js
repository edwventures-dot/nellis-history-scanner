(() => {
  const STORAGE_KEYS = {
    TEAM_SESSION: 'teamSupabaseSession',
    TEAM_PROFILE: 'teamSupabaseProfile',
    TEAM_SYNC_STATE: 'teamSyncState',
    TEAM_SYNC_CACHE: 'teamSyncCache',
    TEAM_CURRENT_AUCTION: 'teamCurrentAuction',
    HISTORY: 'purchaseHistory',
    HISTORY_META: 'purchaseHistoryMeta',
    MATCHES: 'scanMatches',
    NOT_WANTED: 'notWantedPatterns',
    SAVED_FILTERS: 'dashboardFilterPresets',
    DAILY_QUERY: 'dailyQueryImport',
    SCAN_STATE: 'scanState',
    SETTINGS: 'settings',
    RECEIPT_ROWS: 'receiptRows',
    RECEIPT_SUMMARIES: 'receiptSummaries',
    RECEIPT_STATE: 'receiptState',
    INTERNAL_BACKUPS: 'internalBackups'
  };

  const APP_VERSION = '4.1.3';
  const BACKUP_FORMAT_VERSION = 1;

  const DEFAULT_SETTINGS = {
    speedMode: 'normal',
    minMatchScore: 0,
    minQualityFilter: 0,
    maxPages: 100,
    receiptMaxPages: 80,
    receiptSpeedMode: 'normal',
    receiptDetailMode: 'liveTabs',
    teamSyncEnabled: true,
    teamAutoSyncEnabled: true,
    teamAutoPushAfterScan: true,
    teamAutoPullMinutes: 2,
    teamVisibleReconcileMinutes: 2,
    teamCurrentAuctionOnly: false,
    teamActiveAuctionsOnly: true,
    teamDeviceName: ''
  };

  function normalizeText(value) {
    return String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[^a-zA-Z0-9.#+\-/ ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function displayText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
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

  function tokenize(value) {
    const stop = new Set(['the','and','with','for','from','new','open','box','pack','set','pcs','piece','pieces','lot','brand','black','white','red','blue','green','gray','grey','silver','size','inch','in','of','a','an','to','by','on']);
    return normalizeText(value)
      .split(' ')
      .map(t => t.trim())
      .filter(t => t.length >= 2 && !stop.has(t));
  }

  function tokenSet(value) {
    return new Set(tokenize(value));
  }

  function moneyToNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value || '').trim();
    if (!s) return 0;
    let negative = false;
    if (/^\(.*\)$/.test(s)) negative = true;
    if (s.includes('-')) negative = true;
    s = s.replace(/[(),$\s]/g, '').replace(/[^0-9.\-]/g, '');
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return 0;
    return negative ? -Math.abs(n) : n;
  }

  function numberToMoney(value) {
    const n = Number(value || 0);
    const sign = n < 0 ? '-' : '';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  }

  function parseBoolean(value) {
    const s = String(value || '').trim().toLowerCase();
    return ['true','yes','y','1','refund','refunded','return','returned'].includes(s);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const src = String(text || '').replace(/^\ufeff/, '');
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      const next = src[i + 1];
      if (quoted) {
        if (c === '"' && next === '"') {
          cell += '"';
          i++;
        } else if (c === '"') {
          quoted = false;
        } else {
          cell += c;
        }
      } else {
        if (c === '"') quoted = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (c !== '\r') cell += c;
      }
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows.shift().map(h => h.trim());
    return rows.filter(r => r.some(v => String(v || '').trim())).map(r => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = r[i] ?? '');
      Object.defineProperty(obj, '__cells', { value: r.slice(), enumerable: false });
      Object.defineProperty(obj, '__headers', { value: headers.slice(), enumerable: false });
      return obj;
    });
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function rowsToCsv(rows, headers) {
    const cols = headers || Object.keys(rows[0] || {});
    return [cols.join(','), ...rows.map(r => cols.map(h => csvEscape(r[h])).join(','))].join('\n');
  }

  function getField(raw, names) {
    for (const name of names) {
      if (raw && raw[name] != null && String(raw[name]).trim() !== '') return raw[name];
    }
    const headers = raw && raw.__headers ? raw.__headers : [];
    const cells = raw && raw.__cells ? raw.__cells : [];
    for (const name of names) {
      const wanted = normalizeText(name).replace(/\s+/g, '');
      const idx = headers.findIndex(h => normalizeText(h).replace(/\s+/g, '') === wanted);
      if (idx >= 0 && cells[idx] != null && String(cells[idx]).trim() !== '') return cells[idx];
    }
    return '';
  }

  function cleanProductName(value) {
    let s = displayText(value);
    s = s.replace(/^\ufeff/, '');
    s = s.replace(/\bInv\s*#\s*\d{5,20}.*$/i, '').trim();
    s = s.replace(/\$\s*-?\d[\d,]*(?:\.\d{2})?\s*$/i, '').trim();
    return s;
  }

  function isBadHistoryProductName(value) {
    const s = displayText(value);
    if (!s) return true;
    if (/^(AmericanExpress|Subtotal:?|Buyer Premium:?|Tax:?|Grand Total:?|Payment Details|Method|Card|Amount)$/i.test(s)) return true;
    if (/^(Nellis Auction Logo|Watchlist|Contact Us|Facebook|Instagram|LinkedIn|YouTube|Browse Auctions|nellisauction\.com)$/i.test(s)) return true;
    if (/CompanyAccessibility|My AuctionsActive|Profile DetailsRewards|Terms of Service|Privacy Policy/i.test(s)) return true;
    if (/^Receipt summary only:/i.test(s)) return true;
    return false;
  }

  function buildPurchaseHistory(csvRows) {
    const groups = new Map();
    let positiveRows = 0;
    let refundedRows = 0;
    for (const raw of csvRows || []) {
      let productName = cleanProductName(getField(raw, ['Product Name', 'productName', 'Title', 'title', 'Name', 'name', '']));
      if (!productName && raw && raw.__cells && raw.__cells.length) productName = cleanProductName(raw.__cells[0]);
      if (isBadHistoryProductName(productName)) continue;
      const price = moneyToNumber(getField(raw, ['Price', 'price', 'Subtotal', 'subtotal', 'Amount', 'amount']));
      const refunded = parseBoolean(getField(raw, ['Refunded', 'refunded', 'Returned', 'returned'])) || price < 0;
      if (refunded) refundedRows++; else positiveRows++;
      const key = normalizeText(productName);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          matchKey: compactTitleKey(productName),
          productName,
          tokens: Array.from(tokenSet(productName)),
          purchaseCount: 0,
          returnCount: 0,
          totalCost: 0,
          maxCost: 0,
          minCost: 0,
          avgCost: 0,
          latestDate: '',
          receiptNumbers: [],
          sampleRows: []
        });
      }
      const g = groups.get(key);
      const absPrice = Math.abs(price || 0);
      if (refunded) g.returnCount += 1;
      else {
        g.purchaseCount += 1;
        g.totalCost += absPrice;
        g.maxCost = Math.max(g.maxCost || 0, absPrice);
        g.minCost = g.minCost ? Math.min(g.minCost, absPrice) : absPrice;
      }
      const receipt = displayText(getField(raw, ['Receipt Number', 'receiptNumber', 'Receipt', 'receiptId']));
      if (receipt && !g.receiptNumbers.includes(receipt)) g.receiptNumbers.push(receipt);
      const date = displayText(getField(raw, ['Invoice Date', 'invoiceDate', 'Date', 'date']));
      if (date) g.latestDate = date;
      if (g.sampleRows.length < 5) g.sampleRows.push(raw);
    }
    const history = Array.from(groups.values()).map(g => ({
      ...g,
      avgCost: g.purchaseCount ? g.totalCost / g.purchaseCount : 0,
      totalCost: Number(g.totalCost.toFixed(2)),
      maxCost: Number((g.maxCost || 0).toFixed(2)),
      minCost: Number((g.minCost || 0).toFixed(2)),
      tokens: g.tokens
    }));
    return {
      history,
      meta: {
        importedAt: new Date().toISOString(),
        rawRows: (csvRows || []).length,
        positiveRows,
        refundedRows,
        uniqueNames: history.length
      }
    };
  }

  function similarity(title, historyItem) {
    const listingKey = compactTitleKey(title);
    const historyKey = historyItem.matchKey || compactTitleKey(historyItem.productName);
    if (!listingKey || !historyKey) return 0;
    return listingKey === historyKey ? 95 : 0;
  }

  function findBestHistoryMatch(title, history, minScore) {
    let best = null;
    for (const h of history || []) {
      const score = similarity(title, h);
      if (!best || score > best.quality) best = { history: h, quality: score };
    }
    if (!best || best.quality < minScore) return null;
    return best;
  }

  function rankMatch(listing, hist, quality) {
    const avgCost = hist.avgCost || hist.maxCost || 0;
    const estRetail = Number(listing.estRetail || 0);
    const ratio = avgCost > 0 && estRetail > 0 ? estRetail / avgCost : 0;
    const repeatComponent = (hist.purchaseCount || 0) * 100000;
    const ratioComponent = ratio * 1000;
    const costComponent = avgCost;
    const returnPenalty = (hist.returnCount || 0) * 15000;
    const qualityComponent = Number(quality || 0);
    return Math.round(repeatComponent + ratioComponent + costComponent + qualityComponent - returnPenalty);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function jitter(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function getSpeedDelay(mode, type) {
    const fast = mode === 'super';
    if (type === 'receipt-list') return fast ? jitter(500, 1000) : jitter(1200, 2400);
    if (type === 'receipt-detail') return fast ? jitter(450, 950) : jitter(1000, 2200);
    if (type === 'scan-page') return fast ? jitter(1400, 2600) : jitter(3200, 6500);
    return fast ? jitter(500, 1000) : jitter(1200, 2200);
  }

  function absoluteUrl(url, base) {
    try { return new URL(url, base || location.href).toString(); }
    catch { return url || ''; }
  }

  function downloadBlob(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function backupFilename(prefix = 'nellis-full-backup') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${prefix}-${stamp}.json`;
  }

  function cleanStorageForBackup(storage) {
    const copy = { ...(storage || {}) };
    delete copy[STORAGE_KEYS.INTERNAL_BACKUPS];
    // Do not export auth tokens into backup files. Users can sign in again after restore.
    delete copy[STORAGE_KEYS.TEAM_SESSION];
    return copy;
  }

  async function buildFullBackup(reason = 'manual') {
    const storage = await chrome.storage.local.get(null);
    return {
      app: 'Nellis History Scanner',
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      extensionVersion: chrome.runtime?.getManifest?.().version || APP_VERSION,
      createdAt: new Date().toISOString(),
      reason,
      storage: cleanStorageForBackup(storage)
    };
  }

  function validateFullBackup(backup) {
    if (!backup || typeof backup !== 'object') throw new Error('Backup file is not valid JSON.');
    if (backup.app !== 'Nellis History Scanner') throw new Error('This does not look like a Nellis History Scanner backup.');
    if (!backup.storage || typeof backup.storage !== 'object') throw new Error('Backup is missing stored data.');
    if (Number(backup.backupFormatVersion || 0) < 1) throw new Error('Backup format version is missing or unsupported.');
    return true;
  }

  async function exportFullBackup(reason = 'manual') {
    const backup = await buildFullBackup(reason);
    const json = JSON.stringify(backup, null, 2);
    downloadBlob(backupFilename(), json, 'application/json');
    return backup;
  }

  async function createInternalBackup(reason = 'internal') {
    const backup = await buildFullBackup(reason);
    const current = await chrome.storage.local.get(STORAGE_KEYS.INTERNAL_BACKUPS);
    const existing = Array.isArray(current[STORAGE_KEYS.INTERNAL_BACKUPS]) ? current[STORAGE_KEYS.INTERNAL_BACKUPS] : [];
    const lightBackup = {
      id: `${reason}-${Date.now()}`,
      createdAt: backup.createdAt,
      reason,
      extensionVersion: backup.extensionVersion,
      backupFormatVersion: backup.backupFormatVersion,
      storage: backup.storage
    };
    const next = [lightBackup, ...existing].slice(0, 3);
    await chrome.storage.local.set({ [STORAGE_KEYS.INTERNAL_BACKUPS]: next });
    return lightBackup;
  }

  async function restoreFullBackup(backup, mode = 'replace') {
    validateFullBackup(backup);
    await createInternalBackup('pre-restore');
    const incoming = cleanStorageForBackup(backup.storage);
    if (mode === 'merge') {
      await chrome.storage.local.set(incoming);
      return { mode, restoredKeys: Object.keys(incoming).length };
    }
    const beforeClear = await chrome.storage.local.get(STORAGE_KEYS.INTERNAL_BACKUPS);
    await chrome.storage.local.clear();
    await chrome.storage.local.set(incoming);
    if (beforeClear[STORAGE_KEYS.INTERNAL_BACKUPS]) {
      await chrome.storage.local.set({ [STORAGE_KEYS.INTERNAL_BACKUPS]: beforeClear[STORAGE_KEYS.INTERNAL_BACKUPS] });
    }
    return { mode: 'replace', restoredKeys: Object.keys(incoming).length };
  }

  async function readBackupFile(file) {
    if (!file) throw new Error('Choose a backup JSON file first.');
    const text = await file.text();
    const backup = JSON.parse(text);
    validateFullBackup(backup);
    return backup;
  }


  const SUPABASE_URL = 'https://mensfqjsgbzdzqhoalic.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mNiKTv8njWEzLrfEWUPUAg_IqE04a86';

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
    const clean = Array.from(new Set(parts.length ? parts : ['new']));
    return clean;
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

  function buildAuctionGroupKey(locationValue, closesValue, closesIsoValue = '', eventNameValue = '') {
    const eventName = displayText(eventNameValue);
    if (eventName) return `event|${normalizeText(eventName).replace(/\s+/g, '-')}`;
    const loc = normalizeText(locationValue).replace(/\s+/g, '-');
    const rawClose = displayText(closesValue);
    const iso = displayText(closesIsoValue) || parseAuctionCloseToIso(rawClose);
    const closeKey = iso ? (isRelativeAuctionClose(rawClose) ? iso.slice(0, 10) : iso.slice(0, 16)) : normalizeText(rawClose).replace(/\s+/g, '-');
    if (!loc && !closeKey) return '';
    return `${loc || 'unknown-location'}|${closeKey || 'unknown-close'}`;
  }

  async function teamGetSession() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.TEAM_SESSION);
    const session = data[STORAGE_KEYS.TEAM_SESSION] || null;
    if (!session || !session.access_token) return null;

    const expiresAt = Number(session.expires_at || 0);
    if (session.refresh_token && expiresAt && Date.now() / 1000 > expiresAt - 90) {
      try { return await teamRefreshSession(session.refresh_token); }
      catch { return session; }
    }
    return session;
  }

  async function teamSaveSession(session) {
    if (!session) {
      await chrome.storage.local.remove([STORAGE_KEYS.TEAM_SESSION, STORAGE_KEYS.TEAM_PROFILE]);
      return null;
    }
    const normalized = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      token_type: session.token_type || 'bearer',
      expires_in: session.expires_in,
      expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
      user: session.user || null,
      saved_at: teamNowIso()
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.TEAM_SESSION]: normalized });
    return normalized;
  }

  async function teamAuthFetch(path, body) {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error_description || json.msg || json.message || `Supabase auth HTTP ${res.status}`);
    return json;
  }

  async function teamSignIn(email, password) {
    if (!email || !password) throw new Error('Enter email and password.');
    const session = await teamAuthFetch('/auth/v1/token?grant_type=password', { email, password });
    const saved = await teamSaveSession(session);
    const profile = await teamLoadProfile(true);
    chrome.runtime.sendMessage({ type: 'TEAM_SILENT_SYNC_NOW', reason: 'signed-in' }).catch(() => {});
    return { session: saved, profile };
  }

  async function teamRefreshSession(refreshToken) {
    const session = await teamAuthFetch('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
    return await teamSaveSession(session);
  }

  async function teamSignOut() {
    const session = await teamGetSession();
    if (session?.access_token) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.access_token}`
        }
      }).catch(() => {});
    }
    await teamSaveSession(null);
    return true;
  }

  async function teamRequest(path, options = {}) {
    const session = await teamGetSession();
    if (!session?.access_token) throw new Error('Not signed in to Nellis Team Sync.');
    const headers = {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = data && typeof data === 'object' ? (data.message || data.msg || data.error || JSON.stringify(data)) : (data || `HTTP ${res.status}`);
      throw new Error(msg);
    }
    return data;
  }

  async function teamLoadProfile(force = false) {
    if (!force) {
      const existing = await chrome.storage.local.get(STORAGE_KEYS.TEAM_PROFILE);
      if (existing[STORAGE_KEYS.TEAM_PROFILE]) return existing[STORAGE_KEYS.TEAM_PROFILE];
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
    await chrome.storage.local.set({ [STORAGE_KEYS.TEAM_PROFILE]: profile });
    return profile;
  }

  function teamRemoteToLocal(row) {
    const raw = row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
    const tags = Array.isArray(row.tags) && row.tags.length ? row.tags.join('; ') : 'New';
    const rating = row.condition_rating === null || row.condition_rating === undefined ? null : Number(row.condition_rating);
    const auctionEventName = row.auction_event_name || raw.auctionEventName || raw.eventName || '';
    const eventGroupKey = auctionEventName ? buildAuctionGroupKey(row.auction_location || raw.auctionLocation || raw.locationName || '', row.auction_closes_raw || raw.auctionClosesRaw || '', row.auction_closes_at || raw.auctionClosesAt || '', auctionEventName) : '';
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
      auctionEventName,
      locationName: row.auction_location || raw.auctionLocation || raw.locationName || '',
      auctionLocation: row.auction_location || raw.auctionLocation || raw.locationName || '',
      auctionClosesRaw: row.auction_closes_raw || raw.auctionClosesRaw || '',
      auctionClosesAt: row.auction_closes_at || raw.auctionClosesAt || '',
      auctionGroupKey: eventGroupKey || row.auction_group_key || raw.auctionGroupKey || buildAuctionGroupKey(row.auction_location || raw.auctionLocation || raw.locationName || '', row.auction_closes_raw || raw.auctionClosesRaw || '', row.auction_closes_at || raw.auctionClosesAt || ''),
      userBidStatus: row.bid_status || raw.userBidStatus || '',
      hasUserBid: !!(row.bid_status || raw.hasUserBid),
      firstFoundAt: row.first_seen_at || raw.firstFoundAt || raw.foundAt || '',
      foundAt: row.first_seen_at || raw.foundAt || '',
      lastSeenAt: row.last_seen_at || raw.lastSeenAt || '',
      lastModifiedAt: row.last_modified_at || raw.lastModifiedAt || row.last_seen_at || '',
      dedupeKey: row.url || raw.dedupeKey || `${compactTitleKey(row.title)}|${row.current_price}`
    };
  }

  function teamLocalToRemote(row, userId) {
    const title = displayText(row.title);
    const url = displayText(row.url);
    const now = teamNowIso();
    const firstSeen = row.firstFoundAt || row.foundAt || row.lastSeenAt || now;
    const lastSeen = row.lastSeenAt || row.lastModifiedAt || row.foundAt || now;
    const rating = row.conditionRating === null || row.conditionRating === undefined || row.conditionRating === ''
      ? null
      : Math.max(0, Math.min(5, Number(row.conditionRating) || 0));
    const auctionLocation = displayText(row.auctionLocation || row.locationName || '');
    const auctionClosesRaw = displayText(row.auctionClosesRaw || '');
    const auctionClosesAt = displayText(row.auctionClosesAt || parseAuctionCloseToIso(auctionClosesRaw));
    const auctionEventName = displayText(row.auctionEventName || row.eventName || '');
    const auctionGroupKey = auctionEventName
      ? buildAuctionGroupKey(auctionLocation, auctionClosesRaw, auctionClosesAt, auctionEventName)
      : displayText(row.auctionGroupKey || buildAuctionGroupKey(auctionLocation, auctionClosesRaw, auctionClosesAt));
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
      first_seen_at: firstSeen,
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
  const auctionEventName = displayText(row.auctionEventName || row.eventName || '');
  const auctionGroupKey = auctionEventName
    ? buildAuctionGroupKey(auctionLocation, auctionClosesRaw, auctionClosesAt, auctionEventName)
    : displayText(row.auctionGroupKey || buildAuctionGroupKey(auctionLocation, auctionClosesRaw, auctionClosesAt));
  if (auctionLocation) patch.auction_location = auctionLocation;
  if (auctionClosesRaw) patch.auction_closes_raw = auctionClosesRaw;
  if (auctionClosesAt) patch.auction_closes_at = auctionClosesAt;
  if (auctionGroupKey) patch.auction_group_key = auctionGroupKey;
  if (auctionEventName) patch.raw_payload = row || {};

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
      displayText(row && (row.auctionEventName || '')),
      displayText(row && (row.auctionEventName
        ? buildAuctionGroupKey(row.auctionLocation || row.locationName || '', row.auctionClosesRaw || '', row.auctionClosesAt || '', row.auctionEventName || '')
        : (row.auctionGroupKey || buildAuctionGroupKey(row.auctionLocation || row.locationName || '', row.auctionClosesRaw || '', row.auctionClosesAt || ''))))
    ].join('|');
  }

  async function teamReadSyncCache() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.TEAM_SYNC_CACHE);
    const cache = data[STORAGE_KEYS.TEAM_SYNC_CACHE];
    return cache && typeof cache === 'object' ? cache : {};
  }

  async function teamWriteSyncCache(cache) {
    await chrome.storage.local.set({ [STORAGE_KEYS.TEAM_SYNC_CACHE]: cache || {} });
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
      const key = displayText(row && (row.auctionEventName
        ? buildAuctionGroupKey(row.auctionLocation || row.locationName || '', row.auctionClosesRaw || '', row.auctionClosesAt || '', row.auctionEventName || '')
        : (row.auctionGroupKey || buildAuctionGroupKey(row.auctionLocation || row.locationName || '', row.auctionClosesRaw || '', row.auctionClosesAt || ''))));
      if (!key) continue;
      const existing = counts.get(key) || { groupKey: key, count: 0, eventName: '', location: '', closesRaw: '', closesAt: '', sampleTitle: '' };
      existing.count++;
      existing.eventName = existing.eventName || displayText(row.auctionEventName || '');
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
    const data = await chrome.storage.local.get(STORAGE_KEYS.TEAM_CURRENT_AUCTION);
    return data[STORAGE_KEYS.TEAM_CURRENT_AUCTION] || null;
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
    await chrome.storage.local.set({ [STORAGE_KEYS.TEAM_CURRENT_AUCTION]: current });
    return { changed, current, previous: old || null };
  }

  async function teamPruneLocalToAuctionGroup(groupKey) {
    const key = displayText(groupKey);
    if (!key) return { pruned: 0, localTotal: 0 };
    const data = await chrome.storage.local.get(STORAGE_KEYS.MATCHES);
    const current = data[STORAGE_KEYS.MATCHES] || [];
    let pruned = 0;
    const next = current.filter(row => {
      const rowGroup = displayText(row && row.auctionGroupKey);
      if (!rowGroup) return false;
      if (rowGroup !== key) { pruned++; return false; }
      return true;
    });
    if (next.length !== current.length) await chrome.storage.local.set({ [STORAGE_KEYS.MATCHES]: next });
    return { pruned, localTotal: next.length };
  }

  async function teamLatestAuctionFromServer() {
    const rows = await teamRequest('/rest/v1/nhs_listings?select=auction_group_key,auction_location,auction_closes_raw,auction_closes_at,last_seen_at,title,raw_payload&order=last_seen_at.desc&limit=75');
    const candidate = teamAuctionCandidateFromRows((Array.isArray(rows) ? rows : []).map(r => ({
      auctionEventName: r.raw_payload?.auctionEventName || r.raw_payload?.eventName || '',
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
      await chrome.storage.local.set({ [STORAGE_KEYS.TEAM_CURRENT_AUCTION]: { ...latest, latestCheckedAt: teamNowIso() } });
      return { ...latest, latestCheckedAt: teamNowIso() };
    }
    if (existing?.groupKey) {
      const touched = { ...existing, latestCheckedAt: teamNowIso() };
      await chrome.storage.local.set({ [STORAGE_KEYS.TEAM_CURRENT_AUCTION]: touched });
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

      if (!alreadyKnown) {
        fullRows.push(row);
      } else if (!entry?.fullSig && fullSig) {
        fullRows.push(row);
      } else if (entry?.fullSig && entry.fullSig !== fullSig) {
        fullRows.push(row);
      } else if (entry?.liveSig !== liveSig) {
        liveRows.push(row);
      } else {
        skipped++;
      }
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
      await teamRequest('/rest/v1/nhs_listing_snapshots', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: chunk
      });
    }
    return snapshotRows.length;
  }

  async function teamPushListings(localRows, deviceName = '') {
    const session = await teamGetSession();
    if (!session?.user?.id) throw new Error('Sign in before syncing.');

    const cache = await teamReadSyncCache();
    const plan = teamPlanDirtyRows(localRows || [], cache);
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
      chunk.forEach(row => teamRememberRow(cache, row, 'full'));
    }

    for (const row of plan.liveRows) {
      const key = teamCacheKey(row);
      const encodedUrl = encodeURIComponent(key);
      const patched = await teamRequest(`/rest/v1/nhs_listings?url=eq.${encodedUrl}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: teamLivePatch(row, session.user.id)
      });
      const patchedRows = Array.isArray(patched) ? patched : [];
      live += patchedRows.length || 1;
      snapshots += await teamInsertSnapshotsFromRemoteRows(patchedRows, session.user.id);
      teamRememberRow(cache, row, 'live');
    }

    await teamWriteSyncCache(cache);

    const pushed = full + live;
    await teamRequest('/rest/v1/nhs_sync_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: [{
        user_id: session.user.id,
        device_name: deviceName || '',
        action: 'dirty-push-listings',
        item_count: pushed,
        details: { full, live, skipped: plan.skipped, snapshots }
      }]
    }).catch(() => {});

    const result = { pushed, full, live, skipped: plan.skipped, considered: plan.usable.length, snapshots, lastPushAt: teamNowIso() };
    const data = await chrome.storage.local.get(STORAGE_KEYS.TEAM_SYNC_STATE);
    await chrome.storage.local.set({ [STORAGE_KEYS.TEAM_SYNC_STATE]: { ...(data[STORAGE_KEYS.TEAM_SYNC_STATE] || {}), ...result } });
    return result;
  }

  async function teamPullListings(limit = 100000, pageSize = 1000, options = {}) {
    const maxRows = Math.max(1, Number(limit || 100000));
    const batchSize = Math.min(1000, Math.max(1, Number(pageSize || 1000)));
    const all = [];
    const since = options && options.since ? String(options.since) : '';
    const settingsData = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const settings = { ...DEFAULT_SETTINGS, ...(settingsData[STORAGE_KEYS.SETTINGS] || {}) };
    // v4.1.1: do not automatically collapse sync to one "current" auction group.
    // Nellis can have several active auction/location/date groups at the same time.
    // By default pull all active/unended auction groups, and only use a single group
    // when the caller explicitly asks for one.
    const auctionGroupKey = options && options.auctionGroupKey ? String(options.auctionGroupKey) : '';
    const activeOnly = options && Object.prototype.hasOwnProperty.call(options, 'activeOnly')
      ? !!options.activeOnly
      : settings.teamActiveAuctionsOnly !== false;
    const filters = [];
    if (since) filters.push(`updated_at=gt.${encodeURIComponent(since)}`);
    if (auctionGroupKey) filters.push(`auction_group_key=eq.${encodeURIComponent(auctionGroupKey)}`);
    if (activeOnly && !auctionGroupKey) filters.push(`auction_closes_at=gte.${encodeURIComponent(teamNowIso())}`);
    const filter = filters.length ? `&${filters.join('&')}` : '';
    const order = since ? 'updated_at.asc,id.asc' : 'last_seen_at.desc,id.asc';

    for (let offset = 0; offset < maxRows; offset += batchSize) {
      const take = Math.min(batchSize, maxRows - offset);
      const query = `/rest/v1/nhs_listings?select=*&order=${order}&limit=${take}&offset=${offset}${filter}`;
      const remote = await teamRequest(query);
      const page = Array.isArray(remote) ? remote : [];
      all.push(...page);
      if (page.length < take) break;
    }

    return all.map(teamRemoteToLocal);
  }

  function teamMergeLiveFields(old, row) {
    return {
      ...old,
      teamListingId: row.teamListingId || old.teamListingId,
      teamSource: old.teamSource || row.teamSource,
      currentPrice: Number(row.currentPrice || 0),
      bids: Number(row.bids || 0),
      auctionEventName: row.auctionEventName || old.auctionEventName || '',
      locationName: old.locationName || row.locationName || '',
      auctionLocation: old.auctionLocation || row.auctionLocation || row.locationName || '',
      auctionClosesRaw: old.auctionClosesRaw || row.auctionClosesRaw || '',
      auctionClosesAt: old.auctionClosesAt || row.auctionClosesAt || '',
      auctionGroupKey: row.auctionGroupKey || old.auctionGroupKey || '',
      lastSeenAt: row.lastSeenAt || old.lastSeenAt,
      lastModifiedAt: row.lastModifiedAt || old.lastModifiedAt
    };
  }

  async function teamMergeRowsIntoLocal(remoteRows, options = {}) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.MATCHES);
    const current = data[STORAGE_KEYS.MATCHES] || [];
    const cache = await teamReadSyncCache();
    const remoteList = Array.isArray(remoteRows) ? remoteRows : [];
    const visibleRemoteKeys = new Set(remoteList.map(teamCacheKey).filter(Boolean));
    const pruneMissingShared = !!options.pruneMissingShared;
    const map = new Map();
    let pruned = 0;

    for (const row of current) {
      const key = teamCacheKey(row) || row.dedupeKey || `${row.title}|${row.currentPrice}`;
      const sharedKnown = !!row.teamListingId || !!row.teamSource || !!cache[teamCacheKey(row)]?.known;
      if (pruneMissingShared && sharedKnown && teamCacheKey(row) && !visibleRemoteKeys.has(teamCacheKey(row))) {
        pruned++;
        continue;
      }
      map.set(key, row);
    }

    for (const row of remoteList) {
      const key = row.dedupeKey || row.url || `${row.title}|${row.currentPrice}`;
      const old = map.get(key);
      const merged = old ? teamMergeLiveFields(old, row) : row;
      map.set(key, merged);
      teamRememberRow(cache, merged, old ? 'pulled-live' : 'pulled-full');
    }

    const merged = Array.from(map.values()).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    merged.teamPruned = pruned;
    await chrome.storage.local.set({ [STORAGE_KEYS.MATCHES]: merged });
    await teamWriteSyncCache(cache);
    return merged;
  }

  async function teamPullChangedListings(deviceName = '', options = {}) {
    const data = await chrome.storage.local.get([STORAGE_KEYS.TEAM_SYNC_STATE, STORAGE_KEYS.SETTINGS]);
    const sync = data[STORAGE_KEYS.TEAM_SYNC_STATE] || {};
    const settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
    const activeOnly = settings.teamActiveAuctionsOnly !== false;
    const activeModeChanged = !!sync.currentAuctionGroupKey || /current-auction/i.test(String(sync.autoPullMode || ''));
    const pullStartedAt = teamNowIso();
    const lastFull = Date.parse(sync.lastActiveFullPullAt || '') || 0;
    const fullDue = activeOnly && (!lastFull || Date.now() - lastFull > 10 * 60 * 1000);
    const forceFullPull = !!options.forceFullPull || activeModeChanged || fullDue;
    const since = forceFullPull ? '' : (sync.lastPullAt || '');
    const initialFullPull = !since;

    const pulled = await teamPullListings(100000, 1000, { since, activeOnly });
    const merged = (pulled.length || initialFullPull || forceFullPull) ? await teamMergeRowsIntoLocal(pulled, { pruneMissingShared: activeOnly || initialFullPull || forceFullPull }) : null;
    const next = {
      ...sync,
      pulledChanged: initialFullPull ? 0 : pulled.length,
      pulledInitial: initialFullPull ? pulled.length : sync.pulledInitial,
      currentAuctionGroupKey: '',
      currentAuctionLabel: activeOnly ? 'All active auction groups' : 'All shared listings',
      activeAuctionMode: activeOnly,
      autoPullMode: initialFullPull ? (activeOnly ? 'active-auctions-full' : 'all-full') : 'changed',
      prunedHidden: merged?.teamPruned || 0,
      localTotal: merged ? merged.length : sync.localTotal,
      lastPullAt: pullStartedAt,
      lastActiveFullPullAt: initialFullPull || forceFullPull ? pullStartedAt : sync.lastActiveFullPullAt,
      syncedAt: pullStartedAt,
      deviceName: deviceName || sync.deviceName || ''
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.TEAM_SYNC_STATE]: next });
    return { pulled: pulled.length, localTotal: merged ? merged.length : next.localTotal, pruned: merged?.teamPruned || 0, initialFullPull, syncedAt: pullStartedAt, currentAuctionGroupKey: '', activeOnly };
  }

  async function teamSyncListings(localRows, deviceName = '') {
    const push = await teamPushListings(localRows || [], deviceName);
    let pulled = await teamPullChangedListings(deviceName);
    if (pulled && pulled.skipped) {
      const all = await teamPullListings();
      const mergedAll = await teamMergeRowsIntoLocal(all);
      pulled = { pulled: all.length, localTotal: mergedAll.length };
    }
    const now = teamNowIso();
    const result = {
      pushed: push.pushed,
      full: push.full,
      live: push.live,
      skipped: push.skipped,
      snapshots: push.snapshots,
      pulled: pulled.pulled || 0,
      localTotal: pulled.localTotal,
      syncedAt: now,
      lastPullAt: now,
      lastPushAt: push.lastPushAt || now
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.TEAM_SYNC_STATE]: result });
    return result;
  }

  async function teamHideListings(localRows, reason = 'Admin hidden from shared dashboard') {
    const session = await teamGetSession();
    if (!session?.user?.id) throw new Error('Sign in before hiding shared listings.');
    const profile = await teamLoadProfile(true);
    if (profile?.role !== 'admin') throw new Error('Only admin users can hide listings from regular users.');
    const rules = [];
    for (const row of localRows || []) {
      if (row?.url) rules.push({ rule_type: 'listing_url', rule_value: row.url, reason, hidden_by: session.user.id });
      else if (row?.title) rules.push({ rule_type: 'first20_key', rule_value: compactTitleKey(row.title), reason, hidden_by: session.user.id });
    }
    if (!rules.length) return { hidden: 0 };
    await teamRequest('/rest/v1/nhs_admin_hidden_rules?on_conflict=rule_type,rule_value', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: rules
    });
    return { hidden: rules.length };
  }


  async function teamListHiddenRules(limit = 500) {
    const profile = await teamLoadProfile(false);
    if (profile?.role !== 'admin') return [];
    const maxRows = Math.max(1, Math.min(1000, Number(limit || 500)));
    const rows = await teamRequest(`/rest/v1/nhs_admin_hidden_rules?select=*&order=hidden_at.desc&limit=${maxRows}`);
    return Array.isArray(rows) ? rows : [];
  }

  function teamRuleListingFilter(rule) {
    const type = String(rule?.rule_type || '');
    const value = String(rule?.rule_value || '');
    if (!type || !value) return '';
    if (type === 'listing_url') return `url=eq.${encodeURIComponent(value)}`;
    if (type === 'nellis_item_id') return `nellis_item_id=eq.${encodeURIComponent(value)}`;
    if (type === 'first20_key') return `first20_key=eq.${encodeURIComponent(value)}`;
    if (type === 'normalized_title_key') return `normalized_title_key=eq.${encodeURIComponent(value)}`;
    return '';
  }

  async function teamTouchListingsForRule(rule) {
    const filter = teamRuleListingFilter(rule);
    if (!filter) return 0;
    const touched = await teamRequest(`/rest/v1/nhs_listings?select=id&${filter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { last_modified_at: teamNowIso() }
    });
    return Array.isArray(touched) ? touched.length : 0;
  }

  async function teamUnhideRule(ruleId) {
    const profile = await teamLoadProfile(true);
    if (profile?.role !== 'admin') throw new Error('Only admin users can unhide listings.');
    if (!ruleId) throw new Error('Missing hidden rule id.');
    const existing = await teamRequest(`/rest/v1/nhs_admin_hidden_rules?select=*&id=eq.${encodeURIComponent(ruleId)}&limit=1`);
    const rule = Array.isArray(existing) ? existing[0] : null;
    await teamRequest(`/rest/v1/nhs_admin_hidden_rules?id=eq.${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
    const touched = rule ? await teamTouchListingsForRule(rule).catch(() => 0) : 0;
    return { unhidden: true, touched };
  }


  async function teamAdminOverview(limit = 1000) {
    const profile = await teamLoadProfile(true);
    if (profile?.role !== 'admin') throw new Error('Only admin users can view admin overview.');
    const max = Math.max(100, Math.min(5000, Number(limit || 1000)));

    const [profilesRaw, logsRaw, snapshotsRaw, currentAuction] = await Promise.all([
      teamRequest('/rest/v1/nhs_profiles?select=user_id,email,display_name,role&order=display_name.asc'),
      teamRequest(`/rest/v1/nhs_sync_log?select=*&order=created_at.desc&limit=${max}`),
      teamRequest(`/rest/v1/nhs_listing_snapshots?select=id,listing_id,scanned_at,scanned_by,current_price,bid_count,bid_status,auction_group_key,auction_location,auction_closes_at,raw_payload&order=scanned_at.desc&limit=${max}`),
      teamReadCurrentAuction().catch(() => null)
    ]);

    const profiles = Array.isArray(profilesRaw) ? profilesRaw : [];
    const logs = Array.isArray(logsRaw) ? logsRaw : [];
    const snapshots = Array.isArray(snapshotsRaw) ? snapshotsRaw : [];
    const byUser = new Map();

    function ensureUser(userId) {
      const key = userId || 'unknown';
      if (!byUser.has(key)) {
        const p = profiles.find(x => x.user_id === userId) || {};
        byUser.set(key, {
          user_id: userId || '',
          display_name: p.display_name || p.email || (userId ? userId.slice(0, 8) : 'Unknown'),
          email: p.email || '',
          role: p.role || '',
          devices: new Set(),
          pushed: 0,
          newRows: 0,
          updatedRows: 0,
          skippedRows: 0,
          pulled: 0,
          pruned: 0,
          restored: 0,
          snapshots: 0,
          bidSeen: 0,
          bidAmountSeen: 0,
          bidStatuses: {},
          lastSyncAt: '',
          lastBidSeenAt: ''
        });
      }
      return byUser.get(key);
    }

    for (const p of profiles) ensureUser(p.user_id);

    function maxIso(a, b) {
      if (!a) return b || '';
      if (!b) return a || '';
      return Date.parse(a) >= Date.parse(b) ? a : b;
    }

    for (const log of logs) {
      const u = ensureUser(log.user_id);
      if (log.device_name) u.devices.add(log.device_name);
      u.lastSyncAt = maxIso(u.lastSyncAt, log.created_at);
      const details = log.details && typeof log.details === 'object' ? log.details : {};
      const action = String(log.action || '').toLowerCase();
      if (action.includes('push')) {
        u.pushed += Number(log.item_count || 0);
        u.newRows += Number(details.full || 0);
        u.updatedRows += Number(details.live || 0);
        u.skippedRows += Number(details.skipped || 0);
        u.snapshots += Number(details.snapshots || 0);
      }
      if (action.includes('pull') || action.includes('sync')) {
        u.pulled += Number(details.pulled ?? log.item_count ?? 0);
        u.pruned += Number(details.pruned || 0);
        u.restored += Number(details.restored || 0);
      }
    }

    const bidSnapshots = snapshots.filter(s => {
      const raw = s.raw_payload && typeof s.raw_payload === 'object' ? s.raw_payload : {};
      return !!(s.bid_status || raw.userBidStatus || raw.hasUserBid);
    }).slice(0, 500);

    const listingIds = Array.from(new Set(bidSnapshots.map(s => s.listing_id).filter(Boolean)));
    const listingMap = new Map();
    for (const chunk of teamChunk(listingIds, 100)) {
      const ids = encodeURIComponent(`(${chunk.join(',')})`);
      const listingRows = await teamRequest(`/rest/v1/nhs_listings?select=id,title,url,current_price,bid_count,auction_group_key,auction_location,auction_closes_at&id=in.${ids}`).catch(() => []);
      for (const row of (Array.isArray(listingRows) ? listingRows : [])) listingMap.set(row.id, row);
    }

    const bidActivity = bidSnapshots.map(s => {
      const raw = s.raw_payload && typeof s.raw_payload === 'object' ? s.raw_payload : {};
      const listing = listingMap.get(s.listing_id) || {};
      const status = s.bid_status || raw.userBidStatus || 'bid';
      const amount = Number(raw.userBidAmount || raw.bidAmount || raw.yourBidAmount || s.current_price || 0);
      const u = ensureUser(s.scanned_by);
      u.bidSeen += 1;
      u.bidAmountSeen += amount;
      u.bidStatuses[status] = (u.bidStatuses[status] || 0) + 1;
      u.lastBidSeenAt = maxIso(u.lastBidSeenAt, s.scanned_at);
      return {
        scanned_at: s.scanned_at,
        user_id: s.scanned_by || '',
        user: u.display_name,
        status,
        amount,
        current_price: Number(s.current_price || 0),
        bid_count: Number(s.bid_count || 0),
        title: listing.title || raw.title || 'Listing',
        url: listing.url || raw.url || '',
        auction_group_key: s.auction_group_key || listing.auction_group_key || raw.auctionGroupKey || '',
        auction_location: s.auction_location || listing.auction_location || raw.auctionLocation || '',
        auction_closes_at: s.auction_closes_at || listing.auction_closes_at || raw.auctionClosesAt || ''
      };
    });

    const users = Array.from(byUser.values()).map(u => ({
      ...u,
      devices: Array.from(u.devices).filter(Boolean)
    })).sort((a, b) => (Date.parse(b.lastSyncAt || b.lastBidSeenAt || '') || 0) - (Date.parse(a.lastSyncAt || a.lastBidSeenAt || '') || 0));

    return {
      generatedAt: teamNowIso(),
      currentAuction,
      users,
      logs: logs.slice(0, 100),
      bidActivity,
      totals: {
        users: users.length,
        pushed: users.reduce((sum, u) => sum + Number(u.pushed || 0), 0),
        newRows: users.reduce((sum, u) => sum + Number(u.newRows || 0), 0),
        updatedRows: users.reduce((sum, u) => sum + Number(u.updatedRows || 0), 0),
        pulled: users.reduce((sum, u) => sum + Number(u.pulled || 0), 0),
        bidSeen: users.reduce((sum, u) => sum + Number(u.bidSeen || 0), 0),
        bidAmountSeen: users.reduce((sum, u) => sum + Number(u.bidAmountSeen || 0), 0)
      }
    };
  }

  async function teamStatus() {
    const session = await teamGetSession();
    if (!session?.access_token) return { signedIn: false, profile: null, session: null };
    const profile = await teamLoadProfile(false);
    return { signedIn: true, profile, session };
  }

  window.NellisCommon = {
    STORAGE_KEYS,
    APP_VERSION,
    BACKUP_FORMAT_VERSION,
    DEFAULT_SETTINGS,
    normalizeText,
    displayText,
    compactTitleKey,
    tokenize,
    tokenSet,
    moneyToNumber,
    numberToMoney,
    parseBoolean,
    parseCsv,
    getField,
    cleanProductName,
    isBadHistoryProductName,
    csvEscape,
    rowsToCsv,
    buildPurchaseHistory,
    similarity,
    findBestHistoryMatch,
    rankMatch,
    delay,
    jitter,
    getSpeedDelay,
    absoluteUrl,
    downloadBlob,
    backupFilename,
    buildFullBackup,
    exportFullBackup,
    createInternalBackup,
    validateFullBackup,
    restoreFullBackup,
    readBackupFile,
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    teamSignIn,
    teamSignOut,
    teamGetSession,
    teamLoadProfile,
    teamStatus,
    teamPushListings,
    teamPullListings,
    teamPullChangedListings,
    teamMergeRowsIntoLocal,
    teamSyncListings,
    teamHideListings,
    teamListHiddenRules,
    teamUnhideRule,
    teamAdminOverview,
    teamReadCurrentAuction,
    teamResolveCurrentAuction,
    teamTagsArray,
    teamRemoteToLocal,
    teamLocalToRemote,
    parseAuctionCloseToIso,
    buildAuctionGroupKey
  };
})();
