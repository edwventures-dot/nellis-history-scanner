const C = window.NellisCommon;
let rows = [];
let notWanted = [];
let sortStack = [{ key: 'score', dir: -1 }];
let selectedTags = new Set();
let selectedConditions = new Set();
let tagMode = 'all';
let conditionMode = 'all';
let columnFilters = [];
let columnFilterGroups = [];
let savedFilters = [];
let dailyQueryImport = { text: '', terms: [], filterName: 'Daily searches', updatedAt: '' };
let selectedRowKeys = new Set();
let lastSelectedRowKey = '';
let listingWindowId = null;
let listingTabId = null;
let selectedBackupFile = null;
let teamSyncBusy = false;
let adminHiddenRulesBusy = false;
let adminHiddenRules = [];
let lastAdminHiddenRulesLoadedAt = 0;
let currentPage = 1;
let pageSize = 250;
let lastFilteredRows = [];
let currentAuction = null;
let currentAuctionOnly = true;
let adminOverviewBusy = false;
let lastAdminOverviewLoadedAt = 0;

const DASHBOARD_PAGE_SIZE_KEY = 'dashboardPageSizeV1';
const DASHBOARD_COLLAPSE_KEY = 'dashboardCollapsedSectionsV1';
let collapsedSections = {};

const COLUMN_DEFS = {
  score: { label: 'Rank', type: 'number' },
  purchaseCount: { label: 'Repeat', type: 'number' },
  currentPrice: { label: 'Current', type: 'number' },
  estRetail: { label: 'Retail', type: 'number' },
  bids: { label: 'Bids', type: 'number' },
  userBidStatus: { label: 'Bid Status', type: 'text' },
  auctionGroupKey: { label: 'Auction group', type: 'text' },
  auctionLocation: { label: 'Pickup location', type: 'text' },
  auctionClosesRaw: { label: 'Auction closes', type: 'text' },
  title: { label: 'Listing', type: 'text' },
  conditionRating: { label: 'Condition rating', type: 'number' },
  itemTags: { label: 'Tags', type: 'text' },
  quality: { label: 'Quality', type: 'number' },
  lastSeenAt: { label: 'Last Modified', type: 'date' }
};

const NUMERIC_OPS = [
  ['lt', '<'],
  ['lte', '<='],
  ['eq', '='],
  ['gte', '>='],
  ['gt', '>'],
  ['neq', '!='],
  ['between', 'between']
];

const TEXT_OPS = [
  ['contains', 'contains'],
  ['notContains', 'does not contain'],
  ['startsWith', 'begins with'],
  ['endsWith', 'ends with'],
  ['equals', 'equals'],
  ['notEquals', 'does not equal'],
  ['blank', 'is blank'],
  ['notBlank', 'is not blank']
];

function valueFor(row, key) {
  const v = row[key];
  if (['score','purchaseCount','ratio','currentPrice','estRetail','bids','quality','conditionRating'].includes(key)) return Number(v || 0);
  if (key === 'lastSeenAt' || key === 'lastModifiedAt' || key === 'foundAt' || key === 'auctionClosesAt') return Date.parse(v || '') || 0;
  if (key === 'imageUrl') return row.imageUrl ? 1 : 0;
  if (key === 'userBidStatus') {
    const status = String(row.userBidStatus || '').toLowerCase();
    const order = { losing: 3, winning: 2, bid: 1 };
    return order[status] || 0;
  }
  if (key === 'itemCondition') return `${Number(row.conditionRating || 0).toString().padStart(2, '0')} ${String(row.itemCondition || '').toLowerCase()}`;
  return String(v || '').toLowerCase();
}

function compareRows(a, b, sort) {
  const av = valueFor(a, sort.key);
  const bv = valueFor(b, sort.key);
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
  return String(av).localeCompare(String(bv)) * sort.dir;
}

function formatDate(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function splitTags(tags) {
  return String(tags || '')
    .split(/;|,/)
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
}

function displayTagName(tag) {
  return String(tag || '').toLowerCase() === 'new' ? 'New' : String(tag || '');
}

function tagsForRow(row) {
  // Tags are the pink pills: used, major damage, no box, etc.
  // Null/blank tags from Nellis means there are no warning pills, so treat it as New.
  // Do not synthesize condition rating into tags.
  const tags = splitTags(row.itemTags);
  return Array.from(new Set(tags.length ? tags : ['new']));
}

function conditionRatingValue(row) {
  const explicit = String(row.itemCondition || '').match(/\b([0-5])\s*\/\s*5\b/);
  if (explicit) return Number(explicit[1]);
  const rating = Number(row.conditionRating);
  return Number.isFinite(rating) ? rating : null;
}

function conditionsForRow(row) {
  // Condition means only the 0-5 star rating. The pink pills stay in Tags.
  const rating = conditionRatingValue(row);
  return rating !== null ? [`${rating}/5`] : [];
}

function tagHtml(rowOrTags) {
  const parts = typeof rowOrTags === 'object' && rowOrTags !== null
    ? tagsForRow(rowOrTags)
    : (splitTags(rowOrTags).length ? splitTags(rowOrTags) : ['new']);
  return parts.map(t => `<span class="tag-pill ${t === 'new' ? 'new-tag' : ''}">${escapeHtml(displayTagName(t))}</span>`).join(' ');
}

function conditionHtml(row) {
  const rating = conditionRatingValue(row);
  if (rating === null) return '<span class="muted">none</span>';
  return `<div class="dash-stars" title="${rating}/5">${Array.from({ length: 5 }, (_, i) => `<span class="${i < rating ? 'on' : ''}">★</span>`).join('')}</div><span class="muted">${rating}/5</span>`;
}

function auctionHtml(row) {
  const loc = row.auctionLocation || row.locationName || '';
  const close = row.auctionClosesAt ? formatDate(row.auctionClosesAt) : (row.auctionClosesRaw || '');
  if (!loc && !close) return '<span class="muted">unknown</span>';
  const key = row.auctionGroupKey || '';
  return `<div class="auction-cell" title="${escapeHtml(key)}"><b>${escapeHtml(loc || 'Unknown pickup')}</b>${close ? `<br><span class="muted">${escapeHtml(close)}</span>` : ''}</div>`;
}

function imageHtml(row) {
  if (!row.imageUrl) return '<span class="muted">No image</span>';
  const href = row.url || row.imageUrl;
  return `<a class="listing-open-link" href="${escapeHtml(href)}" title="Open listing in a separate item window. Ctrl/middle-click keeps normal browser behavior."><img class="dash-thumb" src="${escapeHtml(row.imageUrl)}" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer"></a>`;
}

function rowKey(row) {
  return row.dedupeKey || row.url || `${row.title}|${row.currentPrice}`;
}

function notWantedKey(row) {
  return C.compactTitleKey(row.title);
}

function isNotWanted(row) {
  const key = notWantedKey(row);
  return !!key && notWanted.some(x => x && x.key === key);
}

function visibleBaseRows() {
  const activeGroup = currentAuctionOnly && currentAuction ? String(currentAuction.groupKey || '') : '';
  return rows.filter(r => {
    if (isNotWanted(r)) return false;
    if (activeGroup) return String(r.auctionGroupKey || '') === activeGroup;
    return true;
  });
}

function rowMatchesSelectedTags(row) {
  const selected = Array.from(selectedTags);
  if (!selected.length) return true;
  const tags = tagsForRow(row);
  if (tagMode === 'any') return selected.some(t => tags.includes(t));
  return selected.every(t => tags.includes(t));
}

function rowMatchesSelectedConditions(row) {
  const selected = Array.from(selectedConditions);
  if (!selected.length) return true;
  const conditions = conditionsForRow(row);
  if (conditionMode === 'any') return selected.some(t => conditions.includes(t));
  return selected.every(t => conditions.includes(t));
}

function valueForColumnFilter(row, key) {
  if (key === 'conditionRating') return conditionRatingValue(row) ?? 0;
  if (key === 'userBidStatus') return row.hasUserBid ? (row.userBidStatus || 'bid') : '';
  if (key === 'itemTags') return tagsForRow(row).join(' ');
  if (key === 'lastSeenAt') return row.lastSeenAt || row.lastModifiedAt || row.foundAt || '';
  return row[key];
}

function textFilterValue(value) {
  return C.normalizeText(value).trim();
}

function numberFilterValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseFilterNumbers(raw) {
  return String(raw || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
}

function rowMatchesColumnFilter(row, filter) {
  const def = COLUMN_DEFS[filter.key];
  if (!def) return true;
  const raw = valueForColumnFilter(row, filter.key);

  if (def.type === 'number') {
    const actual = numberFilterValue(raw);
    const nums = parseFilterNumbers(filter.value);
    const target = nums[0];
    if (filter.op === 'between') {
      if (nums.length < 2) return true;
      const lo = Math.min(nums[0], nums[1]);
      const hi = Math.max(nums[0], nums[1]);
      return actual >= lo && actual <= hi;
    }
    if (!Number.isFinite(target)) return true;
    if (filter.op === 'lt') return actual < target;
    if (filter.op === 'lte') return actual <= target;
    if (filter.op === 'eq') return actual === target;
    if (filter.op === 'gte') return actual >= target;
    if (filter.op === 'gt') return actual > target;
    if (filter.op === 'neq') return actual !== target;
    return true;
  }

  const actual = textFilterValue(raw);
  const target = textFilterValue(filter.value);
  if (filter.op === 'blank') return !actual;
  if (filter.op === 'notBlank') return !!actual;
  if (!target) return true;
  if (filter.op === 'contains') return actual.includes(target);
  if (filter.op === 'notContains') return !actual.includes(target);
  if (filter.op === 'startsWith') return actual.startsWith(target);
  if (filter.op === 'endsWith') return actual.endsWith(target);
  if (filter.op === 'equals') return actual === target;
  if (filter.op === 'notEquals') return actual !== target;
  return true;
}

function rowMatchesColumnFilters(row) {
  const standaloneOk = columnFilters.every(filter => rowMatchesColumnFilter(row, filter));
  if (!standaloneOk) return false;

  return columnFilterGroups.every(group => {
    const filters = Array.isArray(group.filters) ? group.filters : [];
    if (!filters.length) return true;
    if (group.mode === 'any') return filters.some(filter => rowMatchesColumnFilter(row, filter));
    return filters.every(filter => rowMatchesColumnFilter(row, filter));
  });
}

function opLabel(filter) {
  const def = COLUMN_DEFS[filter.key];
  const ops = def?.type === 'number' ? NUMERIC_OPS : TEXT_OPS;
  return (ops.find(([value]) => value === filter.op) || [filter.op, filter.op])[1];
}

function clonePlain(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return value; }
}

async function loadCollapsedSections() {
  const data = await chrome.storage.local.get(DASHBOARD_COLLAPSE_KEY);
  collapsedSections = data[DASHBOARD_COLLAPSE_KEY] || {};
}

async function saveCollapsedSections() {
  await chrome.storage.local.set({ [DASHBOARD_COLLAPSE_KEY]: collapsedSections });
}

function sectionTitleText(section, fallback) {
  const existing = section.querySelector(':scope > .tag-panel-title, :scope > h2, :scope > h3');
  const text = existing ? existing.textContent.replace(/\s+/g, ' ').trim() : '';
  return text || fallback || 'Section';
}

function ensureCollapsibleTitle(section, id, fallbackTitle) {
  let title = section.querySelector(':scope > .tag-panel-title, :scope > .collapsible-title');
  if (!title) {
    title = document.createElement('div');
    title.className = 'collapsible-title';
    title.textContent = fallbackTitle || 'Section';
    section.prepend(title);
  }

  title.classList.add('collapsible-title');
  if (title.querySelector(':scope > .collapse-toggle')) return title;

  const labelText = sectionTitleText(section, fallbackTitle);
  const originalHtml = title.dataset.originalTitleHtml || title.innerHTML || escapeHtml(labelText);
  title.dataset.originalTitleHtml = originalHtml;
  title.dataset.sectionLabel = labelText;
  title.innerHTML = '';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'collapse-toggle';
  button.dataset.collapseId = id;
  button.title = 'Collapse/expand this dashboard section';

  const label = document.createElement('span');
  label.className = 'collapse-label';
  label.innerHTML = originalHtml;

  const state = document.createElement('span');
  state.className = 'collapse-state';

  button.append(label, state);
  title.append(button);
  return title;
}

function syncCollapseUi(section, id) {
  const collapsed = !!collapsedSections[id];
  section.classList.toggle('collapsed', collapsed);
  const button = section.querySelector(':scope > .collapsible-title .collapse-toggle');
  const state = section.querySelector(':scope > .collapsible-title .collapse-state');
  if (button) button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (state) state.textContent = collapsed ? 'Show' : 'Hide';
}

function setupCollapsibleSection(section, id, fallbackTitle) {
  if (!section || section.dataset.collapsibleReady === '1') return;
  section.dataset.collapsibleReady = '1';
  section.dataset.collapseId = id;
  section.classList.add('collapsible-section');
  ensureCollapsibleTitle(section, id, fallbackTitle);
  syncCollapseUi(section, id);

  section.querySelector(':scope > .collapsible-title .collapse-toggle')?.addEventListener('click', async () => {
    collapsedSections[id] = !collapsedSections[id];
    syncCollapseUi(section, id);
    await saveCollapsedSections();
  });
}

function setupDashboardCollapsibles() {
  const sections = [
    ['summary', document.querySelector('.summary-grid'), 'Summary'],
    ['quick-filters', document.querySelector('.toolbar'), 'Quick filters'],
    ['admin-tools', document.querySelector('.admin-tools-panel'), 'Admin tools'],
    ['saved-filters', document.querySelector('.saved-filter-panel:not(.admin-tools-panel):not(.data-safety-panel):not(.daily-query-panel)'), 'Saved filters'],
    ['daily-query', document.querySelector('.daily-query-panel'), 'Daily query import'],
    ['not-wanted', document.querySelector('.not-wanted-panel'), 'Saved not-wanted rules'],
    ['available-tags', document.querySelector('#tagFilters')?.closest('.tag-panel'), 'Available tags'],
    ['condition-ratings', document.querySelector('#conditionFilters')?.closest('.tag-panel'), 'Available condition ratings'],
    ['column-filters', document.querySelector('.column-filter-panel'), 'Column filters']
  ];

  for (const [id, section, title] of sections) setupCollapsibleSection(section, id, title);
}

function currentFilterState() {
  return {
    searchText: document.getElementById('searchBox')?.value || '',
    showReturnedHistory: !!document.getElementById('returnedToggle')?.checked,
    minQuality: Number(document.getElementById('minQualityFilter')?.value || 0),
    selectedTags: Array.from(selectedTags),
    tagMode,
    selectedConditions: Array.from(selectedConditions),
    conditionMode,
    columnFilters: clonePlain(columnFilters) || [],
    columnFilterGroups: clonePlain(columnFilterGroups) || [],
    sortStack: clonePlain(sortStack) || []
  };
}

function setSelectValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function applyFilterState(state = {}) {
  const search = document.getElementById('searchBox');
  const returned = document.getElementById('returnedToggle');
  const quality = document.getElementById('minQualityFilter');
  if (search) search.value = state.searchText || '';
  if (returned) returned.checked = !!state.showReturnedHistory;
  if (quality) quality.value = Number(state.minQuality || 0);

  selectedTags = new Set(Array.isArray(state.selectedTags) ? state.selectedTags.map(String) : []);
  selectedConditions = new Set(Array.isArray(state.selectedConditions) ? state.selectedConditions.map(String) : []);
  tagMode = state.tagMode === 'any' ? 'any' : 'all';
  conditionMode = state.conditionMode === 'any' ? 'any' : 'all';
  setSelectValue('tagMode', tagMode);
  setSelectValue('conditionMode', conditionMode);

  columnFilters = Array.isArray(state.columnFilters) ? clonePlain(state.columnFilters) : [];
  columnFilterGroups = normalizeColumnFilterGroups(state.columnFilterGroups);
  if (Array.isArray(state.sortStack) && state.sortStack.length) {
    sortStack = state.sortStack
      .filter(s => s && COLUMN_DEFS[s.key])
      .map(s => ({ key: s.key, dir: Number(s.dir) === 1 ? 1 : -1 }));
    if (!sortStack.length) sortStack = [{ key: 'score', dir: -1 }];
  }

  selectedRowKeys.clear();
  render();
}

function clearActiveFilters() {
  applyFilterState({
    searchText: '',
    showReturnedHistory: false,
    minQuality: 0,
    selectedTags: [],
    selectedConditions: [],
    tagMode: 'all',
    conditionMode: 'all',
    columnFilters: [],
    columnFilterGroups: [],
    sortStack: [{ key: 'score', dir: -1 }]
  });
}

async function saveSavedFilters() {
  savedFilters = (savedFilters || [])
    .filter(f => f && f.name && f.state)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  await chrome.storage.local.set({ [C.STORAGE_KEYS.SAVED_FILTERS]: savedFilters });
  renderSavedFilters();
}

function renderSavedFilters() {
  const select = document.getElementById('savedFilterSelect');
  if (!select) return;
  const current = select.value;
  if (!savedFilters.length) {
    select.innerHTML = '<option value="">No saved filters yet</option>';
  } else {
    select.innerHTML = '<option value="">Select saved filter...</option>' + savedFilters.map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join('');
  }
  if (savedFilters.some(f => f.id === current)) select.value = current;

  const count = document.getElementById('savedFilterCount');
  if (count) count.textContent = String(savedFilters.length);
}

function decodeHtmlText(value) {
  const ta = document.createElement('textarea');
  ta.innerHTML = String(value || '');
  return ta.value;
}

function cleanDailyQueryTerm(value) {
  let s = decodeHtmlText(value)
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\+/g, ' ')
    .trim();
  try { s = decodeURIComponent(s); } catch {}
  s = C.displayText(s);
  if (!s || s.length > 120) return '';
  if (/^(http|https):\/\//i.test(s)) return '';
  return s;
}

function dedupeTerms(terms) {
  const seen = new Set();
  const out = [];
  for (const term of terms.map(cleanDailyQueryTerm).filter(Boolean)) {
    const key = C.normalizeText(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

function termsFromUrlCandidate(raw) {
  const candidate = decodeHtmlText(raw).trim();
  const terms = [];
  try {
    const url = new URL(candidate, 'https://www.nellisauction.com');
    for (const key of ['query', 'q', 'keyword', 'keywords', 'search', 'term']) {
      const value = url.searchParams.get(key);
      if (value) terms.push(value);
    }
  } catch {}
  return terms;
}

function extractDailyQueryTerms(text) {
  const src = String(text || '');
  const terms = [];

  for (const match of src.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    terms.push(...termsFromUrlCandidate(match[1]));
  }

  for (const match of src.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    terms.push(...termsFromUrlCandidate(match[0]));
  }

  for (const match of src.matchAll(/(?:^|[?&;\s])(?:query|q|keyword|keywords|search|term)=([^&\s"'<>]+)/gi)) {
    terms.push(match[1]);
  }

  const extracted = dedupeTerms(terms);
  if (extracted.length) return extracted;

  return dedupeTerms(src
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/[<>]/.test(line) && !/^#/.test(line))
  );
}

function renderDailyQueryStatus(terms = dailyQueryImport.terms, message = '') {
  const host = document.getElementById('dailyQueryStatus');
  if (!host) return;
  const list = dedupeTerms(terms || []);
  if (!list.length) {
    host.textContent = message || 'No daily query imported yet.';
    return;
  }
  const sample = list.slice(0, 24).map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join(' ');
  const more = list.length > 24 ? ` <span class="muted">+${list.length - 24} more</span>` : '';
  host.innerHTML = `${message ? escapeHtml(message) + ' ' : ''}${list.length} keyword(s): ${sample}${more}`;
}

async function saveDailyQueryImport(terms = null) {
  const text = document.getElementById('dailyQueryPaste')?.value || '';
  const name = (document.getElementById('dailyQueryFilterName')?.value || 'Daily searches').trim() || 'Daily searches';
  dailyQueryImport = {
    text,
    terms: dedupeTerms(terms || extractDailyQueryTerms(text)),
    filterName: name,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [C.STORAGE_KEYS.DAILY_QUERY]: dailyQueryImport });
  return dailyQueryImport.terms;
}

function setDailyQueryUiFromState() {
  const text = document.getElementById('dailyQueryPaste');
  const name = document.getElementById('dailyQueryFilterName');
  if (text) text.value = dailyQueryImport.text || '';
  if (name) name.value = dailyQueryImport.filterName || 'Daily searches';
  renderDailyQueryStatus(dailyQueryImport.terms || []);
}

async function loadDailyQueryImport() {
  const data = await chrome.storage.local.get(C.STORAGE_KEYS.DAILY_QUERY);
  const saved = data[C.STORAGE_KEYS.DAILY_QUERY] || {};
  dailyQueryImport = {
    text: String(saved.text || ''),
    terms: dedupeTerms(saved.terms || extractDailyQueryTerms(saved.text || '')),
    filterName: String(saved.filterName || 'Daily searches'),
    updatedAt: saved.updatedAt || ''
  };
  setDailyQueryUiFromState();
}

function upsertDailyQueryGroup(terms, options = {}) {
  const list = dedupeTerms(terms);
  if (!list.length) return false;
  const id = 'daily-query-keywords';
  const name = options.groupName || 'Daily query keywords';
  columnFilterGroups = normalizeColumnFilterGroups(columnFilterGroups)
    .filter(g => g.id !== id && !g.dailyQueryGroup && g.name !== name);
  columnFilterGroups.push({
    id,
    name,
    mode: 'any',
    dailyQueryGroup: true,
    filters: list.map(term => ({ key: 'title', op: 'contains', value: term }))
  });
  selectedRowKeys.clear();
  render();
  return true;
}

async function extractDailyQueryFromUi() {
  const terms = await saveDailyQueryImport();
  renderDailyQueryStatus(terms, 'Extracted.');
}

async function applyDailyQueryToActiveFilters() {
  const terms = await saveDailyQueryImport();
  if (!upsertDailyQueryGroup(terms)) {
    renderDailyQueryStatus([], 'No query keywords found to apply.');
    return;
  }
  renderDailyQueryStatus(terms, 'Applied as Listing contains OR group.');
}

async function saveDailyQueryAsFilter() {
  const terms = await saveDailyQueryImport();
  if (!upsertDailyQueryGroup(terms)) {
    renderDailyQueryStatus([], 'No query keywords found to save.');
    return;
  }

  const now = new Date().toISOString();
  const cleanName = (dailyQueryImport.filterName || 'Daily searches').trim() || 'Daily searches';
  const existing = savedFilters.find(f => f.name.toLowerCase() === cleanName.toLowerCase());
  const preset = {
    id: existing?.id || `filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleanName,
    state: currentFilterState(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    source: 'daily-query-import'
  };

  if (existing) Object.assign(existing, preset);
  else savedFilters.push(preset);
  await saveSavedFilters();
  const select = document.getElementById('savedFilterSelect');
  if (select) select.value = preset.id;
  renderDailyQueryStatus(terms, `Saved filter "${cleanName}".`);
}

async function clearDailyQueryImport() {
  dailyQueryImport = { text: '', terms: [], filterName: 'Daily searches', updatedAt: '' };
  await chrome.storage.local.set({ [C.STORAGE_KEYS.DAILY_QUERY]: dailyQueryImport });
  setDailyQueryUiFromState();
}

async function saveCurrentFilterPreset() {
  const input = document.getElementById('savedFilterName');
  const rawName = input ? input.value.trim() : '';
  const name = rawName || prompt('Name this dashboard filter:');
  if (!name || !String(name).trim()) return;

  const now = new Date().toISOString();
  const cleanName = String(name).trim();
  const existing = savedFilters.find(f => f.name.toLowerCase() === cleanName.toLowerCase());
  const preset = {
    id: existing?.id || `filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleanName,
    state: currentFilterState(),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  if (existing) Object.assign(existing, preset);
  else savedFilters.push(preset);
  if (input) input.value = '';
  await saveSavedFilters();
  const select = document.getElementById('savedFilterSelect');
  if (select) select.value = preset.id;
}

function applySelectedSavedFilter() {
  const id = document.getElementById('savedFilterSelect')?.value;
  const preset = savedFilters.find(f => f.id === id);
  if (!preset) return;
  applyFilterState(preset.state || {});
}

async function deleteSelectedSavedFilter() {
  const select = document.getElementById('savedFilterSelect');
  const id = select?.value;
  const preset = savedFilters.find(f => f.id === id);
  if (!preset) return;
  if (!confirm(`Delete saved filter "${preset.name}"?`)) return;
  savedFilters = savedFilters.filter(f => f.id !== id);
  await saveSavedFilters();
}

function renderNotWantedRules() {
  const host = document.getElementById('notWantedRules');
  if (!host) return;
  if (!notWanted.length) {
    host.innerHTML = '<span class="muted">No saved not-wanted rules. Mark rows as Not wanted to build the blacklist.</span>';
    return;
  }
  host.innerHTML = notWanted.map((rule, idx) => {
    const title = rule.title || rule.key || 'not wanted';
    const tags = rule.itemTags ? ` | ${rule.itemTags}` : '';
    const when = rule.createdAt ? `Saved ${formatDate(rule.createdAt)}` : 'Saved rule';
    return `<button type="button" class="tag-filter not-wanted-chip" data-remove-not-wanted-index="${idx}" title="Remove this not-wanted rule. ${escapeHtml(when)}">${escapeHtml(title.slice(0, 70))}${escapeHtml(tags.slice(0, 55))} <span>x</span></button>`;
  }).join('');
}

async function removeNotWantedAt(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= notWanted.length) return;
  notWanted.splice(idx, 1);
  await chrome.storage.local.set({ [C.STORAGE_KEYS.NOT_WANTED]: notWanted });
  render();
}


function newColumnGroupId() {
  return `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeColumnFilterGroups(groups) {
  return (Array.isArray(groups) ? groups : [])
    .filter(g => g && Array.isArray(g.filters))
    .map(g => ({
      id: g.id || newColumnGroupId(),
      name: String(g.name || 'Filter group').trim() || 'Filter group',
      mode: g.mode === 'all' ? 'all' : 'any',
      dailyQueryGroup: !!g.dailyQueryGroup,
      filters: g.filters
        .filter(f => f && COLUMN_DEFS[f.key])
        .map(f => ({ key: f.key, op: f.op, value: String(f.value || '').trim() }))
    }));
}

function groupModeLabel(mode) {
  return mode === 'all' ? 'ALL rows must match' : 'ANY row can match';
}

function createColumnFilterGroup() {
  const nameInput = document.getElementById('columnFilterGroupName');
  const modeInput = document.getElementById('columnFilterGroupMode');
  const name = (nameInput?.value || '').trim() || `Group ${columnFilterGroups.length + 1}`;
  const group = {
    id: newColumnGroupId(),
    name,
    mode: modeInput?.value === 'all' ? 'all' : 'any',
    filters: []
  };
  columnFilterGroups.push(group);
  if (nameInput) nameInput.value = '';
  render();
  const target = document.getElementById('columnFilterTarget');
  if (target) target.value = group.id;
}

function addGroupedColumnFilter(groupId, key, op, value) {
  const group = columnFilterGroups.find(g => g.id === groupId);
  if (!group) return false;
  const def = COLUMN_DEFS[key];
  if (!def) return false;
  if (!['blank', 'notBlank'].includes(op) && String(value || '').trim() === '') return false;
  group.filters.push({ key, op, value: String(value || '').trim() });
  render();
  return true;
}

function renderColumnFilterBuilder() {
  const field = document.getElementById('columnFilterField');
  const op = document.getElementById('columnFilterOp');
  const target = document.getElementById('columnFilterTarget');
  if (!field || !op) return;

  if (!field.options.length) {
    field.innerHTML = Object.entries(COLUMN_DEFS)
      .map(([key, def]) => `<option value="${escapeHtml(key)}">${escapeHtml(def.label)}</option>`)
      .join('');
  }

  if (target) {
    const oldTarget = target.value;
    target.innerHTML = '<option value="">Standalone AND filter</option>' + columnFilterGroups.map(group =>
      `<option value="${escapeHtml(group.id)}">Group: ${escapeHtml(group.name)} (${group.mode.toUpperCase()})</option>`
    ).join('');
    if (columnFilterGroups.some(g => g.id === oldTarget)) target.value = oldTarget;
  }

  const def = COLUMN_DEFS[field.value] || COLUMN_DEFS.score;
  const ops = def.type === 'number' ? NUMERIC_OPS : TEXT_OPS;
  const old = op.value;
  op.innerHTML = ops.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
  if (ops.some(([value]) => value === old)) op.value = old;
}

function renderColumnFilters() {
  const host = document.getElementById('columnFilters');
  if (!host) return;

  const parts = [];

  if (columnFilters.length) {
    parts.push(`<div class="column-filter-group-block"><div class="muted"><strong>Standalone AND filters</strong> - every filter below must match.</div><div class="tag-filters">${columnFilters.map((filter, idx) => {
      const def = COLUMN_DEFS[filter.key] || { label: filter.key };
      const valueText = ['blank', 'notBlank'].includes(filter.op) ? '' : ` ${escapeHtml(filter.value)}`;
      return `<button type="button" class="tag-filter active" data-column-filter-index="${idx}">${escapeHtml(def.label)} ${escapeHtml(opLabel(filter))}${valueText} <span>x</span></button>`;
    }).join('')}</div></div>`);
  }

  for (const group of columnFilterGroups) {
    const filters = Array.isArray(group.filters) ? group.filters : [];
    parts.push(`<div class="column-filter-group-block" data-column-filter-group="${escapeHtml(group.id)}">
      <div class="column-filter-group-head">
        <strong>${escapeHtml(group.name)}</strong>
        <span class="muted">${escapeHtml(groupModeLabel(group.mode))}</span>
        <button type="button" class="tiny danger" data-remove-column-filter-group="${escapeHtml(group.id)}" title="Remove this whole filter group">Remove group</button>
      </div>
      <div class="tag-filters">${filters.length ? filters.map((filter, idx) => {
        const def = COLUMN_DEFS[filter.key] || { label: filter.key };
        const valueText = ['blank', 'notBlank'].includes(filter.op) ? '' : ` ${escapeHtml(filter.value)}`;
        return `<button type="button" class="tag-filter active" data-column-filter-group-id="${escapeHtml(group.id)}" data-column-filter-group-index="${idx}">${escapeHtml(def.label)} ${escapeHtml(opLabel(filter))}${valueText} <span>x</span></button>`;
      }).join('') : '<span class="muted">Empty group. Add rows to this group using the selector above.</span>'}</div>
    </div>`);
  }

  if (!parts.length) {
    host.innerHTML = '<span class="muted">No column filters. Add standalone AND filters, or create an OR group for product names.</span>';
    return;
  }

  host.innerHTML = parts.join('');
}

function addColumnFilter(key, op, value) {
  const def = COLUMN_DEFS[key];
  if (!def) return;
  if (!['blank', 'notBlank'].includes(op) && String(value || '').trim() === '') return;
  columnFilters.push({ key, op, value: String(value || '').trim() });
  render();
}

function applyColumnFilterFromBuilder() {
  const key = document.getElementById('columnFilterField').value;
  const op = document.getElementById('columnFilterOp').value;
  const value = document.getElementById('columnFilterValue').value;
  const target = document.getElementById('columnFilterTarget')?.value || '';

  if (target) addGroupedColumnFilter(target, key, op, value);
  else addColumnFilter(key, op, value);

  document.getElementById('columnFilterValue').value = '';
}

function parsePromptFilter(key, raw) {
  const def = COLUMN_DEFS[key];
  const text = String(raw || '').trim();
  if (!def || !text) return null;

  if (def.type === 'number') {
    let m = text.match(/^(<=|>=|!=|=|<|>)\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      const opMap = { '<': 'lt', '<=': 'lte', '=': 'eq', '>=': 'gte', '>': 'gt', '!=': 'neq' };
      return { key, op: opMap[m[1]], value: m[2] };
    }
    m = text.match(/^between\s+(.+)$/i);
    if (m) return { key, op: 'between', value: m[1] };
    m = text.match(/^-?\d+(?:\.\d+)?$/);
    if (m) return { key, op: 'eq', value: text };
    return null;
  }

  const lowered = text.toLowerCase();
  const textOps = [
    ['starts with ', 'startsWith'],
    ['begins with ', 'startsWith'],
    ['contains ', 'contains'],
    ['does not contain ', 'notContains'],
    ['not contains ', 'notContains'],
    ['ends with ', 'endsWith'],
    ['equals ', 'equals'],
    ['not equals ', 'notEquals']
  ];
  for (const [prefix, op] of textOps) {
    if (lowered.startsWith(prefix)) return { key, op, value: text.slice(prefix.length).trim() };
  }
  if (text.startsWith('=')) return { key, op: 'equals', value: text.slice(1).trim() };
  if (text.startsWith('!')) return { key, op: 'notContains', value: text.slice(1).trim() };
  return { key, op: 'startsWith', value: text };
}

function promptColumnFilter(key) {
  const def = COLUMN_DEFS[key];
  if (!def) return;
  const example = def.type === 'number'
    ? 'Examples: <3, <=10, =0, >5, between 1 and 3'
    : 'Examples: begins with xyd, contains snow, =spotlight, !heavy';
  const raw = prompt(`Filter ${def.label}\n${example}`);
  const filter = parsePromptFilter(key, raw);
  if (filter) addColumnFilter(filter.key, filter.op, filter.value);
}

function filteredRows() {
  const q = C.normalizeText(document.getElementById('searchBox').value);
  const showReturns = document.getElementById('returnedToggle').checked;
  const minQuality = Number(document.getElementById('minQualityFilter')?.value || 0);
  return visibleBaseRows().filter(r => {
    if (!showReturns && Number(r.returnCount || 0) > 0 && Number(r.purchaseCount || 0) === 0) return false;
    if (Number(r.quality || 0) < minQuality) return false;
    if (!rowMatchesSelectedTags(r)) return false;
    if (!rowMatchesSelectedConditions(r)) return false;
    if (!rowMatchesColumnFilters(r)) return false;
    if (!q) return true;
    return C.normalizeText(`${r.title} ${r.matchName || ''} ${r.itemCondition} ${tagsForRow(r).join(' ')} ${r.userBidStatus || ''}`).includes(q);
  });
}

function displayRows() {
  const filtered = filteredRows();
  filtered.sort((a, b) => {
    for (const sort of sortStack) {
      const result = compareRows(a, b, sort);
      if (result !== 0) return result;
    }
    return 0;
  });
  return filtered;
}

function dashboardPageCount(total = lastFilteredRows.length) {
  return Math.max(1, Math.ceil(Number(total || 0) / Number(pageSize || 250)));
}

function clampDashboardPage(total = lastFilteredRows.length) {
  const max = dashboardPageCount(total);
  currentPage = Math.max(1, Math.min(max, Number(currentPage || 1)));
  return currentPage;
}

function resetDashboardPage() {
  currentPage = 1;
}

function currentDashboardPageRows(filtered) {
  const total = filtered.length;
  clampDashboardPage(total);
  const start = (currentPage - 1) * pageSize;
  const end = Math.min(total, start + pageSize);
  return { pageRows: filtered.slice(start, end), start, end, total, pageCount: dashboardPageCount(total) };
}

function updateDashboardPager(pageInfo) {
  const status = document.getElementById('renderWindowStatus');
  const pageInput = document.getElementById('pageNumberInput');
  const pageCount = document.getElementById('pageCountLabel');
  const prev = document.getElementById('prevPageBtn');
  const next = document.getElementById('nextPageBtn');
  const size = document.getElementById('pageSizeSelect');
  const total = Number(pageInfo?.total || 0);
  const start = total ? Number(pageInfo.start || 0) + 1 : 0;
  const end = Number(pageInfo?.end || 0);
  const maxPage = Number(pageInfo?.pageCount || 1);

  if (status) {
    status.textContent = total
      ? `Rendered ${start.toLocaleString()}-${end.toLocaleString()} of ${total.toLocaleString()} filtered rows. Images only load for this page.`
      : 'No rows match the current filters.';
  }
  if (pageInput) {
    pageInput.max = String(maxPage);
    pageInput.value = String(currentPage);
    pageInput.disabled = total === 0;
  }
  if (pageCount) pageCount.textContent = `of ${maxPage.toLocaleString()}`;
  if (prev) prev.disabled = currentPage <= 1 || total === 0;
  if (next) next.disabled = currentPage >= maxPage || total === 0;
  if (size) size.value = String(pageSize);
}

async function loadDashboardPagingPrefs() {
  try {
    const data = await chrome.storage.local.get(DASHBOARD_PAGE_SIZE_KEY);
    const saved = Number(data[DASHBOARD_PAGE_SIZE_KEY]);
    if ([100, 250, 500, 1000].includes(saved)) pageSize = saved;
  } catch {}
  const select = document.getElementById('pageSizeSelect');
  if (select) select.value = String(pageSize);
}

async function saveDashboardPagingPrefs() {
  try { await chrome.storage.local.set({ [DASHBOARD_PAGE_SIZE_KEY]: pageSize }); } catch {}
}

function updateSortHeaders() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const idx = sortStack.findIndex(s => s.key === th.dataset.sort);
    th.classList.toggle('sorted', idx >= 0);
    th.classList.toggle('filtered', columnFilters.some(f => f.key === th.dataset.sort) || columnFilterGroups.some(g => (g.filters || []).some(f => f.key === th.dataset.sort)));
    const label = th.dataset.baseLabel || th.textContent.replace(/\s+[▲▼]\d*$/, '');
    th.dataset.baseLabel = label;
    if (idx >= 0) th.textContent = `${label} ${sortStack[idx].dir === 1 ? '▲' : '▼'}${sortStack.length > 1 ? idx + 1 : ''}`;
    else th.textContent = label;
  });
}

function renderTagFilters() {
  const host = document.getElementById('tagFilters');
  if (!host) return;

  const counts = new Map();
  for (const row of visibleBaseRows()) {
    for (const tag of tagsForRow(row)) counts.set(tag, (counts.get(tag) || 0) + 1);
  }

  const available = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const tag of Array.from(selectedTags)) {
    if (!counts.has(tag)) selectedTags.delete(tag);
  }

  if (!available.length) {
    host.innerHTML = '<span class="muted">No tags found in captured listings yet.</span>';
    return;
  }

  host.innerHTML = available.map(([tag, count]) => `
    <button type="button" class="tag-filter ${selectedTags.has(tag) ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
      ${escapeHtml(displayTagName(tag))} <span>${count}</span>
    </button>
  `).join('');
}

function renderConditionFilters() {
  const host = document.getElementById('conditionFilters');
  if (!host) return;

  const counts = new Map();
  for (const row of visibleBaseRows()) {
    for (const condition of conditionsForRow(row)) counts.set(condition, (counts.get(condition) || 0) + 1);
  }

  const available = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const condition of Array.from(selectedConditions)) {
    if (!counts.has(condition)) selectedConditions.delete(condition);
  }

  if (!available.length) {
    host.innerHTML = '<span class="muted">No conditions found in captured listings yet.</span>';
    return;
  }

  host.innerHTML = available.map(([condition, count]) => `
    <button type="button" class="tag-filter ${selectedConditions.has(condition) ? 'active' : ''}" data-condition="${escapeHtml(condition)}">
      ${escapeHtml(condition)} <span>${count}</span>
    </button>
  `).join('');
}

function bidStatusHtml(row) {
  if (!row.hasUserBid && !row.userBidStatus) return '';
  const status = String(row.userBidStatus || 'bid').toLowerCase();
  const label = status === 'losing' ? 'Bid - losing' : status === 'winning' ? 'Bid - winning' : 'Bid placed';
  const cls = status === 'losing' ? 'lost' : 'active';
  return `<span class="bid-status-pill ${cls}">${escapeHtml(label)}</span>`;
}

function normalizeListingUrl(url) {
  try {
    const parsed = new URL(url, location.href);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function fallbackOpenListingWindow(url) {
  const width = Math.max(1000, Math.min(1500, Math.floor((screen.availWidth || 1500) * 0.82)));
  const height = Math.max(760, Math.min(1000, Math.floor((screen.availHeight || 1000) * 0.88)));
  const left = Math.max(0, Math.floor(((screen.availWidth || width) - width) / 2));
  const top = Math.max(0, Math.floor(((screen.availHeight || height) - height) / 2));
  window.open(url, 'nellisListingWindow', `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
}

async function openListingWindow(url) {
  const href = normalizeListingUrl(url);
  if (!href) return;

  const width = Math.max(1000, Math.min(1500, Math.floor((screen.availWidth || 1500) * 0.82)));
  const height = Math.max(760, Math.min(1000, Math.floor((screen.availHeight || 1000) * 0.88)));
  const left = Math.max(0, Math.floor(((screen.availWidth || width) - width) / 2));
  const top = Math.max(0, Math.floor(((screen.availHeight || height) - height) / 2));

  try {
    if (listingWindowId && listingTabId) {
      await chrome.tabs.update(listingTabId, { url: href, active: true });
      await chrome.windows.update(listingWindowId, { focused: true, width, height, left, top });
      return;
    }
  } catch {
    listingWindowId = null;
    listingTabId = null;
  }

  try {
    const win = await chrome.windows.create({ url: href, type: 'normal', focused: true, width, height, left, top });
    listingWindowId = win.id || null;
    listingTabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
  } catch {
    fallbackOpenListingWindow(href);
  }
}

function shouldUseNativeLinkBehavior(e) {
  return e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
}

function rowClass(row) {
  const status = String(row.userBidStatus || '').toLowerCase();
  if (status === 'losing') return 'row-bid-lost';
  if (row.hasUserBid || status === 'winning' || status === 'bid') return 'row-bid-active';
  return '';
}

function render() {
  renderSavedFilters();
  renderNotWantedRules();
  renderTagFilters();
  renderConditionFilters();
  renderColumnFilterBuilder();
  renderColumnFilters();
  const filtered = displayRows();
  lastFilteredRows = filtered;
  const pageInfo = currentDashboardPageRows(filtered);
  const pageRows = pageInfo.pageRows;
  const tbody = document.querySelector('#matchesTable tbody');
  const visibleKeys = new Set(filtered.map(rowKey));
  for (const key of Array.from(selectedRowKeys)) {
    if (!visibleKeys.has(key)) selectedRowKeys.delete(key);
  }
  tbody.innerHTML = pageRows.map(r => {
    const key = rowKey(r);
    const checked = selectedRowKeys.has(key) ? 'checked' : '';
    return `
    <tr class="${rowClass(r)}" data-row-key="${escapeHtml(key)}">
      <td><input type="checkbox" class="row-select" data-row-key="${escapeHtml(key)}" ${checked} aria-label="Select listing"></td>
      <td>${Math.round(Number(r.score || 0)).toLocaleString()}</td>
      <td>${imageHtml(r)}</td>
      <td>${Number(r.purchaseCount || 0)}${Number(r.returnCount || 0) ? `<span class="warn"> / ${r.returnCount} ret</span>` : ''}</td>
      <td>${C.numberToMoney(r.currentPrice)}</td>
      <td>${C.numberToMoney(r.estRetail)}</td>
      <td>${Number(r.bids || 0)}</td>
      <td>${bidStatusHtml(r)}</td>
      <td>${auctionHtml(r)}</td>
      <td><a class="listing-open-link" href="${escapeHtml(r.url)}" title="Open listing in a separate item window. Ctrl/middle-click keeps normal browser behavior.">${escapeHtml(r.title)}</a></td>
      <td>${conditionHtml(r)}</td>
      <td>${tagHtml(r)}</td>
      <td>${Number(r.quality || 0) ? `${Number(r.quality || 0)}%` : '<span class="muted">none</span>'}</td>
      <td>${formatDate(r.lastSeenAt || r.lastModifiedAt || r.foundAt)}</td>
      <td><button class="tiny danger" data-action="not-wanted" data-key="${escapeHtml(key)}" title="Hide this item and related future matches">Not wanted</button></td>
    </tr>`;
  }).join('');
  document.getElementById('matchesFound').textContent = rows.length;
  const visibleCount = document.getElementById('visibleMatches');
  if (visibleCount) visibleCount.textContent = filtered.length;
  const notWantedCount = document.getElementById('notWantedCount');
  if (notWantedCount) notWantedCount.textContent = notWanted.length;
  const selectedCount = document.getElementById('selectedCount');
  if (selectedCount) selectedCount.textContent = selectedRowKeys.size;
  renderAdminSelectionPreview();
  updateDashboardPager(pageInfo);
  const selectAll = document.getElementById('selectAllRows');
  if (selectAll) {
    const renderedKeys = pageRows.map(rowKey);
    selectAll.checked = renderedKeys.length > 0 && renderedKeys.every(k => selectedRowKeys.has(k));
    selectAll.indeterminate = renderedKeys.some(k => selectedRowKeys.has(k)) && !selectAll.checked;
  }
  updateSortHeaders();
}

async function refresh() {
  const data = await chrome.storage.local.get([C.STORAGE_KEYS.MATCHES, C.STORAGE_KEYS.SCAN_STATE, C.STORAGE_KEYS.NOT_WANTED, C.STORAGE_KEYS.SAVED_FILTERS, C.STORAGE_KEYS.TEAM_CURRENT_AUCTION, C.STORAGE_KEYS.SETTINGS]);
  const settings = { ...C.DEFAULT_SETTINGS, ...(data[C.STORAGE_KEYS.SETTINGS] || {}) };
  currentAuctionOnly = settings.teamCurrentAuctionOnly !== false;
  currentAuction = data[C.STORAGE_KEYS.TEAM_CURRENT_AUCTION] || null;
  rows = (data[C.STORAGE_KEYS.MATCHES] || []).map(r => ({
    ...r,
    lastSeenAt: r.lastSeenAt || r.lastModifiedAt || r.foundAt || '',
    lastModifiedAt: r.lastModifiedAt || r.lastSeenAt || r.foundAt || '',
    firstFoundAt: r.firstFoundAt || r.foundAt || ''
  }));
  notWanted = data[C.STORAGE_KEYS.NOT_WANTED] || [];
  savedFilters = data[C.STORAGE_KEYS.SAVED_FILTERS] || [];
  const state = data[C.STORAGE_KEYS.SCAN_STATE] || {};
  document.getElementById('pagesScanned').textContent = state.pagesScanned || 0;
  document.getElementById('listingsSeen').textContent = state.listingsSeen || 0;
  document.getElementById('matchesFound').textContent = rows.length;
  document.getElementById('runningState').textContent = state.running ? 'Running' : 'Idle';
  document.getElementById('subtitle').textContent = state.lastMessage || 'Captured listings from the scan.';
  renderCurrentAuctionStatus();
  render();
  refreshTeamSyncStatus();
}

function defaultDirFor(key) {
  return ['title','itemCondition','itemTags'].includes(key) ? 1 : -1;
}

async function flagNotWanted(row) {
  if (!row) return;
  addNotWantedPattern(row, new Date().toISOString());
  selectedRowKeys.delete(rowKey(row));
  await chrome.storage.local.set({
    [C.STORAGE_KEYS.NOT_WANTED]: notWanted
  });
  render();
}

async function forgetCapturedMatches() {
  if (!confirm('Forget all captured dashboard listings? This does not delete imported receipt history.')) return;
  await C.createInternalBackup('pre-forget-captured');
  rows = [];
  selectedRowKeys.clear();
  await chrome.storage.local.set({ [C.STORAGE_KEYS.MATCHES]: [] });
  render();
}

async function clearNotWanted() {
  if (!confirm('Clear the not-wanted list? Previously hidden related matches can appear again on future scans.')) return;
  await C.createInternalBackup('pre-clear-not-wanted');
  notWanted = [];
  await chrome.storage.local.set({ [C.STORAGE_KEYS.NOT_WANTED]: [] });
  render();
}


function addNotWantedPattern(row, now) {
  const key = notWantedKey(row);
  if (!key) return false;
  if (notWanted.some(x => x && x.key === key)) return false;
  notWanted.push({
    key,
    title: row.title,
    itemTags: tagsForRow(row).map(displayTagName).join('; '),
    itemCondition: row.itemCondition || '',
    createdAt: now
  });
  return true;
}

async function bulkNotWantedSelected() {
  const chosen = rows.filter(r => selectedRowKeys.has(rowKey(r)));
  if (!chosen.length) return;
  if (!confirm(`Mark ${chosen.length} selected listing(s) and related matches as not wanted?`)) return;
  const now = new Date().toISOString();
  let added = 0;
  for (const row of chosen) if (addNotWantedPattern(row, now)) added++;
  selectedRowKeys.clear();
  await chrome.storage.local.set({ [C.STORAGE_KEYS.NOT_WANTED]: notWanted });
  render();
}

function clearSelection() {
  selectedRowKeys.clear();
  render();
}

function setTeamSyncStatus(message, isError = false) {
  const el = document.getElementById('teamSyncStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('warn', !!isError);
}

function formatSyncSummary(sync = {}) {
  const last = sync.syncedAt || sync.autoSyncedAt || sync.lastPullAt || sync.lastPushAt || '';
  const lastText = last ? new Date(last).toLocaleString() : 'never';
  const pulled = (sync.lastAutoPull && sync.lastAutoPull.pulled) || sync.autoPulled || sync.pulled || sync.pulledChanged || 0;
  const pushed = sync.autoPushed || sync.pushed || 0;
  const skipped = sync.autoSkipped || sync.skipped || 0;
  const pruned = sync.prunedHidden || (sync.lastAutoReconcile && sync.lastAutoReconcile.pruned) || 0;
  const restored = sync.restoredMissing || (sync.lastAutoReconcile && sync.lastAutoReconcile.restored) || 0;
  return `Last sync: ${lastText}. Pulled ${Number(pulled || 0).toLocaleString()}, restored ${Number(restored || 0).toLocaleString()}, pushed ${Number(pushed || 0).toLocaleString()}, skipped ${Number(skipped || 0).toLocaleString()}, pruned ${Number(pruned || 0).toLocaleString()}.`;
}

function setAdminControlsVisible(visible) {
  document.getElementById('adminToolControls')?.classList.toggle('hidden', !visible);
  document.getElementById('adminSelectedPreview')?.classList.toggle('hidden', !visible);
}

function selectedAdminRows() {
  return rows.filter(r => selectedRowKeys.has(rowKey(r)));
}

function renderAdminSelectionPreview() {
  const selected = selectedAdminRows();
  const count = document.getElementById('adminSelectedCount');
  if (count) count.textContent = String(selected.length);
  const host = document.getElementById('adminSelectedPreview');
  if (!host) return;
  if (!selected.length) {
    host.textContent = 'Select dashboard rows to queue them here for admin hide.';
    return;
  }
  const sample = selected.slice(0, 8).map(r => `<span class="admin-selected-pill">${escapeHtml(r.title || r.url || 'Listing')} <b>${escapeHtml(C.numberToMoney(r.currentPrice || 0))}</b></span>`).join(' ');
  const more = selected.length > 8 ? ` <span class="muted">+${selected.length - 8} more</span>` : '';
  host.innerHTML = `${selected.length} selected to hide from regular dashboards: ${sample}${more}`;
}

function hiddenRuleLabel(rule) {
  const value = String(rule?.rule_value || '');
  const type = String(rule?.rule_type || 'rule');
  const match = rows.find(r =>
    (type === 'listing_url' && r.url === value) ||
    (type === 'nellis_item_id' && String(r.nellisItemId || '') === value) ||
    (type === 'first20_key' && C.compactTitleKey(r.title) === value) ||
    (type === 'normalized_title_key' && C.normalizeText(r.title) === value)
  );
  if (match?.title) return `${match.title} (${C.numberToMoney(match.currentPrice || 0)})`;
  if (type === 'listing_url') {
    try { return new URL(value).pathname || value; } catch { return value; }
  }
  return `${type}: ${value}`;
}

function renderAdminHiddenRules() {
  const host = document.getElementById('adminHiddenRules');
  if (!host) return;
  if (adminHiddenRulesBusy) {
    host.textContent = 'Loading hidden list...';
    return;
  }
  if (!adminHiddenRules.length) {
    host.textContent = 'No admin-hidden listings yet.';
    return;
  }
  host.classList.remove('muted');
  host.innerHTML = adminHiddenRules.slice(0, 100).map(rule => `
    <div class="admin-hidden-rule">
      <div>
        <strong>${escapeHtml(hiddenRuleLabel(rule))}</strong>
        <div class="muted">${escapeHtml(rule.rule_type || '')} · ${escapeHtml(formatDate(rule.hidden_at || rule.created_at))}${rule.reason ? ' · ' + escapeHtml(rule.reason) : ''}</div>
      </div>
      <button class="tiny" data-action="admin-unhide" data-rule-id="${escapeHtml(rule.id)}" title="Remove this admin-hidden rule so regular users can see it again after their next sync.">Unhide</button>
    </div>
  `).join('') + (adminHiddenRules.length > 100 ? `<div class="muted">Showing first 100 of ${adminHiddenRules.length} hidden rules.</div>` : '');
}


function renderCurrentAuctionStatus() {
  const host = document.getElementById('currentAuctionStatus');
  if (!host) return;
  if (!currentAuctionOnly) {
    host.textContent = 'Current auction group filter is off.';
    return;
  }
  if (!currentAuction || !currentAuction.groupKey) {
    host.textContent = 'Current auction group: not detected yet. Scan a current page or let cloud sync pull the latest group.';
    return;
  }
  const loc = currentAuction.location || 'Unknown pickup';
  const close = currentAuction.closesAt ? formatDate(currentAuction.closesAt) : (currentAuction.closesRaw || 'unknown close');
  host.innerHTML = `Current auction group: <strong>${escapeHtml(loc)}</strong> <span class="muted">${escapeHtml(close)}</span>`;
}

function renderAdminOverview(data) {
  const host = document.getElementById('adminOverview');
  const bidHost = document.getElementById('adminBidActivity');
  if (!host) return;
  if (!data) {
    host.textContent = 'Admin overview has not loaded yet.';
    if (bidHost) bidHost.textContent = '';
    return;
  }
  const totals = data.totals || {};
  const users = data.users || [];
  const summary = `
    <div class="admin-overview-summary">
      <span><b>${Number(totals.users || 0).toLocaleString()}</b> users</span>
      <span><b>${Number(totals.pushed || 0).toLocaleString()}</b> pushed</span>
      <span><b>${Number(totals.newRows || 0).toLocaleString()}</b> new</span>
      <span><b>${Number(totals.updatedRows || 0).toLocaleString()}</b> price/bid updates</span>
      <span><b>${Number(totals.pulled || 0).toLocaleString()}</b> pulled</span>
      <span><b>${Number(totals.bidSeen || 0).toLocaleString()}</b> bid sightings</span>
      <span><b>${C.numberToMoney(totals.bidAmountSeen || 0)}</b> seen bid/current value</span>
    </div>`;
  const userRows = users.map(u => `
    <tr>
      <td><b>${escapeHtml(u.display_name || u.email || 'User')}</b><br><span class="muted">${escapeHtml(u.role || '')}${u.devices?.length ? ' · ' + escapeHtml(u.devices.join(', ')) : ''}</span></td>
      <td>${Number(u.pushed || 0).toLocaleString()}</td>
      <td>${Number(u.newRows || 0).toLocaleString()}</td>
      <td>${Number(u.updatedRows || 0).toLocaleString()}</td>
      <td>${Number(u.skippedRows || 0).toLocaleString()}</td>
      <td>${Number(u.pulled || 0).toLocaleString()}</td>
      <td>${Number(u.pruned || 0).toLocaleString()} / ${Number(u.restored || 0).toLocaleString()}</td>
      <td>${Number(u.bidSeen || 0).toLocaleString()}<br><span class="muted">${C.numberToMoney(u.bidAmountSeen || 0)}</span></td>
      <td>${escapeHtml(formatDate(u.lastSyncAt || u.lastBidSeenAt))}</td>
    </tr>`).join('');
  host.classList.remove('muted');
  host.innerHTML = `${summary}
    <div class="admin-overview-table-wrap">
      <table class="mini-table">
        <thead><tr><th>User</th><th>Pushed</th><th>New</th><th>Updated</th><th>Skipped</th><th>Pulled</th><th>Hidden pruned/restored</th><th>Bid seen</th><th>Last activity</th></tr></thead>
        <tbody>${userRows || '<tr><td colspan="9" class="muted">No sync activity yet.</td></tr>'}</tbody>
      </table>
    </div>`;

  if (!bidHost) return;
  const bidRows = (data.bidActivity || []).slice(0, 80).map(b => `
    <tr>
      <td>${escapeHtml(formatDate(b.scanned_at))}</td>
      <td>${escapeHtml(b.user || 'User')}</td>
      <td><span class="bid-pill ${escapeHtml(String(b.status || '').toLowerCase())}">${escapeHtml(b.status || 'bid')}</span></td>
      <td>${C.numberToMoney(b.amount || b.current_price || 0)}</td>
      <td>${Number(b.bid_count || 0).toLocaleString()}</td>
      <td>${escapeHtml(b.auction_location || '')}</td>
      <td><a class="listing-open-link" href="${escapeHtml(b.url || '#')}">${escapeHtml(b.title || 'Listing')}</a></td>
    </tr>`).join('');
  bidHost.classList.remove('muted');
  bidHost.innerHTML = `<div class="tag-panel-title">Bid sightings <span class="muted">latest 80</span></div>
    <div class="admin-overview-table-wrap">
      <table class="mini-table">
        <thead><tr><th>Seen</th><th>User</th><th>Status</th><th>Amount/price</th><th>Bids</th><th>Auction</th><th>Listing</th></tr></thead>
        <tbody>${bidRows || '<tr><td colspan="7" class="muted">No bid statuses seen during scans yet.</td></tr>'}</tbody>
      </table>
    </div>`;
}

async function refreshAdminOverview(force = false) {
  if (adminOverviewBusy) return;
  if (!force && lastAdminOverviewLoadedAt && Date.now() - lastAdminOverviewLoadedAt < 120000) return;
  const host = document.getElementById('adminOverview');
  try {
    adminOverviewBusy = true;
    if (host) host.textContent = 'Loading admin overview...';
    const data = await C.teamAdminOverview(1500);
    lastAdminOverviewLoadedAt = Date.now();
    renderAdminOverview(data);
  } catch (err) {
    if (host) host.textContent = `Admin overview failed: ${err.message || err}`;
  } finally {
    adminOverviewBusy = false;
  }
}

async function refreshAdminHiddenRules(showStatus = false, force = false) {
  if (adminHiddenRulesBusy) return;
  if (!force && lastAdminHiddenRulesLoadedAt && Date.now() - lastAdminHiddenRulesLoadedAt < 60000) {
    renderAdminHiddenRules();
    return;
  }
  try {
    adminHiddenRulesBusy = true;
    renderAdminHiddenRules();
    adminHiddenRules = await C.teamListHiddenRules(500);
    lastAdminHiddenRulesLoadedAt = Date.now();
    if (showStatus) setTeamSyncStatus(`Loaded ${adminHiddenRules.length} admin-hidden rule(s). ${formatSyncSummary((await chrome.storage.local.get(C.STORAGE_KEYS.TEAM_SYNC_STATE))[C.STORAGE_KEYS.TEAM_SYNC_STATE] || {})}`);
  } catch (err) {
    const host = document.getElementById('adminHiddenRules');
    if (host) host.textContent = `Hidden list failed: ${err.message || err}`;
  } finally {
    adminHiddenRulesBusy = false;
    renderAdminHiddenRules();
  }
}

async function refreshTeamSyncStatus() {
  if (teamSyncBusy) return;
  try {
    const data = await chrome.storage.local.get([C.STORAGE_KEYS.SETTINGS, C.STORAGE_KEYS.TEAM_SYNC_STATE]);
    const sync = data[C.STORAGE_KEYS.TEAM_SYNC_STATE] || {};
    const status = await C.teamStatus();
    if (!status.signedIn) {
      setAdminControlsVisible(false);
      setTeamSyncStatus(`Not signed in. Sign in from the extension popup. ${formatSyncSummary(sync)}`);
      const hiddenHost = document.getElementById('adminHiddenRules');
      if (hiddenHost) hiddenHost.textContent = 'Sign in as admin to see hidden listings.';
      return;
    }
    const p = status.profile || {};
    const role = p.role || 'user';
    const isAdmin = role === 'admin';
    setAdminControlsVisible(isAdmin);
    setTeamSyncStatus(`Signed in as ${p.display_name || p.email || 'user'} (${role}). ${formatSyncSummary(sync)}`);
    renderCurrentAuctionStatus();
    if (isAdmin) {
      refreshAdminHiddenRules(false);
      refreshAdminOverview(false);
    } else {
      const hiddenHost = document.getElementById('adminHiddenRules');
      if (hiddenHost) hiddenHost.textContent = 'Admin-hidden list is only shown to admin users.';
      const overviewHost = document.getElementById('adminOverview');
      if (overviewHost) overviewHost.textContent = 'Admin overview is only shown to admin users.';
      const bidHost = document.getElementById('adminBidActivity');
      if (bidHost) bidHost.textContent = '';
    }
  } catch (err) {
    setAdminControlsVisible(false);
    setTeamSyncStatus(`Team status failed: ${err.message || err}`, true);
  }
}

async function saveTeamDeviceNameFromDashboard() {
  const data = await chrome.storage.local.get([C.STORAGE_KEYS.SETTINGS]);
  const settings = { ...C.DEFAULT_SETTINGS, ...(data[C.STORAGE_KEYS.SETTINGS] || {}) };
  settings.teamDeviceName = document.getElementById('teamDeviceNameDash')?.value || '';
  await chrome.storage.local.set({ [C.STORAGE_KEYS.SETTINGS]: settings });
  return settings.teamDeviceName;
}

async function teamSignInFromDashboard() {
  try {
    teamSyncBusy = true;
    setTeamSyncStatus('Signing in...');
    await saveTeamDeviceNameFromDashboard();
    const email = document.getElementById('teamEmailDash').value.trim();
    const password = document.getElementById('teamPasswordDash').value;
    const { profile } = await C.teamSignIn(email, password);
    document.getElementById('teamPasswordDash').value = '';
    setTeamSyncStatus(`Signed in as ${profile.display_name || profile.email} (${profile.role}).`);
  } catch (err) {
    setTeamSyncStatus(`Sign in failed: ${err.message || err}`, true);
  } finally {
    teamSyncBusy = false;
  }
}

async function teamSignOutFromDashboard() {
  try {
    teamSyncBusy = true;
    await C.teamSignOut();
    setTeamSyncStatus('Signed out.');
  } catch (err) {
    setTeamSyncStatus(`Sign out failed: ${err.message || err}`, true);
  } finally {
    teamSyncBusy = false;
  }
}

async function teamPushFromDashboard() {
  try {
    teamSyncBusy = true;
    const deviceName = await saveTeamDeviceNameFromDashboard();
    setTeamSyncStatus(`Pushing ${rows.length} local captured rows...`);
    const result = await C.teamPushListings(rows, deviceName || 'dashboard');
    setTeamSyncStatus(`Push checked ${result.considered || rows.length} rows: ${result.full || 0} new, ${result.live || 0} price/bid updates, ${result.skipped || 0} unchanged, ${result.snapshots || 0} snapshots.`);
  } catch (err) {
    setTeamSyncStatus(`Push failed: ${err.message || err}`, true);
  } finally {
    teamSyncBusy = false;
  }
}

async function teamPullFromDashboard() {
  try {
    teamSyncBusy = true;
    setTeamSyncStatus('Pulling shared rows...');
    const pulled = await C.teamPullListings();
    const merged = await C.teamMergeRowsIntoLocal(pulled, { pruneMissingShared: true });
    const now = new Date().toISOString();
    const result = { pulled: pulled.length, localTotal: merged.length, syncedAt: now, lastPullAt: now };
    await chrome.storage.local.set({ [C.STORAGE_KEYS.TEAM_SYNC_STATE]: result });
    setTeamSyncStatus(`Pulled ${pulled.length} shared rows. Pruned ${merged.teamPruned || 0} hidden/missing shared rows. Local total ${merged.length}.`);
    await refresh();
  } catch (err) {
    setTeamSyncStatus(`Pull failed: ${err.message || err}`, true);
  } finally {
    teamSyncBusy = false;
  }
}

async function teamSyncFromDashboard() {
  try {
    teamSyncBusy = true;
    const deviceName = await saveTeamDeviceNameFromDashboard();
    setTeamSyncStatus(`Syncing ${rows.length} local rows, then pulling shared rows...`);
    const result = await C.teamSyncListings(rows, deviceName || 'dashboard');
    setTeamSyncStatus(`Sync complete. New ${result.full || 0}, price/bid updates ${result.live || 0}, skipped ${result.skipped || 0}, pulled ${result.pulled || 0}, local total ${result.localTotal}.`);
    await refresh();
  } catch (err) {
    setTeamSyncStatus(`Sync failed: ${err.message || err}`, true);
  } finally {
    teamSyncBusy = false;
  }
}

async function teamAutoSyncNowFromDashboard() {
  try {
    teamSyncBusy = true;
    setTeamSyncStatus('Running quiet auto sync now...');
    const response = await chrome.runtime.sendMessage({
      type: 'TEAM_SILENT_SYNC_NOW',
      reason: 'dashboard-button',
      forceReconcile: true,
      restoreMissing: true
    });
    if (!response || response.ok === false) throw new Error(response?.error || 'Auto sync failed.');
    const result = response.result || {};
    const pull = result.pull || {};
    const reconcile = result.reconcile || {};
    setTeamSyncStatus(`Auto sync complete. Pulled ${Number(pull.pulled || 0).toLocaleString()}, restored ${Number(reconcile.restored || 0).toLocaleString()}, pruned ${Number(reconcile.pruned || 0).toLocaleString()}, local total ${Number(reconcile.localTotal || pull.localTotal || rows.length || 0).toLocaleString()}.`);
    await refresh();
  } catch (err) {
    setTeamSyncStatus(`Auto sync failed: ${err.message || err}`, true);
  } finally {
    teamSyncBusy = false;
  }
}

async function teamAdminHideSelectedFromDashboard() {
  try {
    const chosen = rows.filter(r => selectedRowKeys.has(rowKey(r)));
    if (!chosen.length) {
      setTeamSyncStatus('Select rows first.');
      return;
    }
    if (!confirm(`Admin-hide ${chosen.length} selected shared listing(s) from regular users? Admins will still see them.`)) return;
    teamSyncBusy = true;
    setTeamSyncStatus(`Admin-hiding ${chosen.length} selected listing(s)...`);
    const result = await C.teamHideListings(chosen, 'Admin hidden from regular user dashboards');
    selectedRowKeys.clear();
    setTeamSyncStatus(`Admin-hidden ${result.hidden} listing rule(s). Regular users will lose them on their next quiet sync.`);
    await refreshAdminHiddenRules(false, true);
    render();
  } catch (err) {
    setTeamSyncStatus(`Admin hide failed: ${err.message || err}`, true);
  } finally {
    teamSyncBusy = false;
  }
}

function setBackupStatus(message, isError = false) {
  const el = document.getElementById('backupStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('warn', !!isError);
}

async function exportFullBackupFromDashboard() {
  try {
    const backup = await C.exportFullBackup('manual-dashboard');
    setBackupStatus(`Exported full backup with ${Object.keys(backup.storage || {}).length} storage bucket(s) at ${backup.createdAt}.`);
  } catch (err) {
    setBackupStatus(`Backup failed: ${err.message || err}`, true);
  }
}

async function restoreSelectedBackupFromDashboard() {
  try {
    if (!selectedBackupFile) {
      setBackupStatus('Choose a backup JSON file first.', true);
      return;
    }
    const backup = await C.readBackupFile(selectedBackupFile);
    const created = backup.createdAt || 'unknown date';
    if (!confirm(`Restore backup from ${created}? This REPLACES current captured listings, receipts, saved filters, not-wanted rules, and settings.`)) return;
    const result = await C.restoreFullBackup(backup, 'replace');
    selectedBackupFile = null;
    const input = document.getElementById('backupFileInput');
    if (input) input.value = '';
    setBackupStatus(`Restored backup. ${result.restoredKeys} storage bucket(s) replaced. Reloading dashboard...`);
    await refresh();
  } catch (err) {
    setBackupStatus(`Restore failed: ${err.message || err}`, true);
  }
}

document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', e => {
  const key = th.dataset.sort;
  const existing = sortStack.find(s => s.key === key);
  if (e.shiftKey) {
    if (existing) existing.dir *= -1;
    else sortStack.push({ key, dir: defaultDirFor(key) });
  } else if (existing && sortStack.length === 1 && sortStack[0].key === key) {
    sortStack[0].dir *= -1;
  } else {
    sortStack = [{ key, dir: defaultDirFor(key) }];
  }
  resetDashboardPage();
  render();
}));

document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('contextmenu', e => {
  e.preventDefault();
  promptColumnFilter(th.dataset.sort);
}));

document.getElementById('columnFilterField').addEventListener('change', renderColumnFilterBuilder);
document.getElementById('createColumnFilterGroupBtn').addEventListener('click', createColumnFilterGroup);
document.getElementById('addColumnFilterBtn').addEventListener('click', applyColumnFilterFromBuilder);
document.getElementById('columnFilterValue').addEventListener('keydown', e => {
  if (e.key === 'Enter') applyColumnFilterFromBuilder();
});
document.getElementById('clearColumnFiltersBtn').addEventListener('click', () => {
  columnFilters = [];
  columnFilterGroups = [];
  render();
});
document.getElementById('columnFilters').addEventListener('click', e => {
  const standaloneButton = e.target.closest('[data-column-filter-index]');
  if (standaloneButton) {
    columnFilters.splice(Number(standaloneButton.dataset.columnFilterIndex), 1);
    render();
    return;
  }

  const groupFilterButton = e.target.closest('[data-column-filter-group-id][data-column-filter-group-index]');
  if (groupFilterButton) {
    const group = columnFilterGroups.find(g => g.id === groupFilterButton.dataset.columnFilterGroupId);
    if (group) group.filters.splice(Number(groupFilterButton.dataset.columnFilterGroupIndex), 1);
    render();
    return;
  }

  const removeGroupButton = e.target.closest('[data-remove-column-filter-group]');
  if (removeGroupButton) {
    columnFilterGroups = columnFilterGroups.filter(g => g.id !== removeGroupButton.dataset.removeColumnFilterGroup);
    render();
  }
});

document.getElementById('saveFilterBtn').addEventListener('click', saveCurrentFilterPreset);
document.getElementById('applySavedFilterBtn').addEventListener('click', applySelectedSavedFilter);
document.getElementById('deleteSavedFilterBtn').addEventListener('click', deleteSelectedSavedFilter);
document.getElementById('clearActiveFiltersBtn').addEventListener('click', clearActiveFilters);
document.getElementById('savedFilterSelect').addEventListener('change', applySelectedSavedFilter);
document.getElementById('savedFilterName').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveCurrentFilterPreset();
});


document.getElementById('extractDailyQueryBtn').addEventListener('click', extractDailyQueryFromUi);
document.getElementById('applyDailyQueryBtn').addEventListener('click', applyDailyQueryToActiveFilters);
document.getElementById('saveDailyQueryFilterBtn').addEventListener('click', saveDailyQueryAsFilter);
document.getElementById('clearDailyQueryBtn').addEventListener('click', clearDailyQueryImport);
document.getElementById('dailyQueryPaste').addEventListener('input', () => {
  renderDailyQueryStatus(extractDailyQueryTerms(document.getElementById('dailyQueryPaste').value), 'Preview:');
});
document.getElementById('dailyQueryFilterName').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveDailyQueryAsFilter();
});
document.getElementById('notWantedRules').addEventListener('click', e => {
  const button = e.target.closest('[data-remove-not-wanted-index]');
  if (!button) return;
  removeNotWantedAt(button.dataset.removeNotWantedIndex);
});

document.getElementById('tagFilters').addEventListener('click', e => {
  const button = e.target.closest('[data-tag]');
  if (!button) return;
  const tag = button.dataset.tag;
  if (selectedTags.has(tag)) selectedTags.delete(tag);
  else selectedTags.add(tag);
  render();
});

document.getElementById('conditionFilters').addEventListener('click', e => {
  const button = e.target.closest('[data-condition]');
  if (!button) return;
  const condition = button.dataset.condition;
  if (selectedConditions.has(condition)) selectedConditions.delete(condition);
  else selectedConditions.add(condition);
  render();
});

document.getElementById('tagMode').addEventListener('change', e => {
  tagMode = e.target.value === 'any' ? 'any' : 'all';
  render();
});

document.getElementById('conditionMode').addEventListener('change', e => {
  conditionMode = e.target.value === 'any' ? 'any' : 'all';
  render();
});

document.getElementById('clearTagsBtn').addEventListener('click', () => {
  selectedTags.clear();
  render();
});

document.getElementById('clearConditionsBtn').addEventListener('click', () => {
  selectedConditions.clear();
  render();
});

document.querySelector('#matchesTable tbody').addEventListener('click', e => {
  const link = e.target.closest('.listing-open-link');
  if (!link) return;
  if (shouldUseNativeLinkBehavior(e)) return;
  e.preventDefault();
  openListingWindow(link.href);
});

document.querySelector('#matchesTable tbody').addEventListener('click', e => {
  const box = e.target.closest('.row-select');
  if (!box) return;

  const key = box.dataset.rowKey;
  const checked = box.checked;
  const visibleKeys = (lastFilteredRows.length ? lastFilteredRows : displayRows()).map(rowKey);

  if (e.shiftKey && lastSelectedRowKey && visibleKeys.includes(lastSelectedRowKey) && visibleKeys.includes(key)) {
    const a = visibleKeys.indexOf(lastSelectedRowKey);
    const b = visibleKeys.indexOf(key);
    const [start, end] = a < b ? [a, b] : [b, a];
    for (const rangeKey of visibleKeys.slice(start, end + 1)) {
      if (checked) selectedRowKeys.add(rangeKey);
      else selectedRowKeys.delete(rangeKey);
    }
  } else {
    if (checked) selectedRowKeys.add(key);
    else selectedRowKeys.delete(key);
  }

  lastSelectedRowKey = key;
  render();
});

document.querySelector('#matchesTable tbody').addEventListener('click', e => {
  const button = e.target.closest('[data-action="not-wanted"]');
  if (!button) return;
  const row = rows.find(r => rowKey(r) === button.dataset.key);
  if (row) flagNotWanted(row);
});


document.getElementById('teamSignInDashBtn')?.addEventListener('click', teamSignInFromDashboard);
document.getElementById('teamSignOutDashBtn')?.addEventListener('click', teamSignOutFromDashboard);
document.getElementById('teamPushDashBtn')?.addEventListener('click', teamPushFromDashboard);
document.getElementById('teamPullDashBtn')?.addEventListener('click', teamPullFromDashboard);
document.getElementById('teamSyncDashBtn')?.addEventListener('click', teamSyncFromDashboard);
document.getElementById('teamAutoSyncNowBtn')?.addEventListener('click', teamAutoSyncNowFromDashboard);
document.getElementById('teamAdminHideSelectedBtn')?.addEventListener('click', teamAdminHideSelectedFromDashboard);
document.getElementById('refreshHiddenRulesBtn')?.addEventListener('click', () => refreshAdminHiddenRules(true, true));
document.getElementById('refreshAdminOverviewBtn')?.addEventListener('click', () => refreshAdminOverview(true));
document.getElementById('adminHiddenRules')?.addEventListener('click', async e => {
  const button = e.target.closest('[data-action="admin-unhide"]');
  if (!button) return;
  const id = button.dataset.ruleId;
  if (!id) return;
  if (!confirm('Unhide this listing/rule for regular users?')) return;
  try {
    const result = await C.teamUnhideRule(id);
    adminHiddenRules = adminHiddenRules.filter(r => r.id !== id);
    renderAdminHiddenRules();
    setTeamSyncStatus(`Unhid one admin rule and touched ${Number(result?.touched || 0).toLocaleString()} listing(s) so regular users can pull it back. ${formatSyncSummary((await chrome.storage.local.get(C.STORAGE_KEYS.TEAM_SYNC_STATE))[C.STORAGE_KEYS.TEAM_SYNC_STATE] || {})}`);
  } catch (err) {
    setTeamSyncStatus(`Unhide failed: ${err.message || err}`, true);
  }
});
document.getElementById('teamDeviceNameDash')?.addEventListener('change', saveTeamDeviceNameFromDashboard);
document.getElementById('teamPasswordDash')?.addEventListener('keydown', e => { if (e.key === 'Enter') teamSignInFromDashboard(); });

document.getElementById('searchBox').addEventListener('input', () => { resetDashboardPage(); render(); });
document.getElementById('minQualityFilter').addEventListener('input', () => { resetDashboardPage(); render(); });
document.getElementById('returnedToggle').addEventListener('change', () => { resetDashboardPage(); render(); });
document.getElementById('refreshBtn').addEventListener('click', refresh);
document.getElementById('exportBackupBtn')?.addEventListener('click', exportFullBackupFromDashboard);
document.getElementById('exportFullBackupBtn')?.addEventListener('click', exportFullBackupFromDashboard);
document.getElementById('backupFileInput')?.addEventListener('change', e => {
  selectedBackupFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
  setBackupStatus(selectedBackupFile ? `Selected backup file: ${selectedBackupFile.name}` : 'No backup file selected.');
});
document.getElementById('restoreBackupBtn')?.addEventListener('click', restoreSelectedBackupFromDashboard);
document.getElementById('forgetMatchesBtn').addEventListener('click', forgetCapturedMatches);
document.getElementById('clearNotWantedBtn').addEventListener('click', clearNotWanted);
document.getElementById('bulkNotWantedBtn').addEventListener('click', bulkNotWantedSelected);
document.getElementById('clearSelectionBtn').addEventListener('click', clearSelection);
document.getElementById('selectAllRows').addEventListener('change', e => {
  const pageStart = (currentPage - 1) * pageSize;
  const visible = (lastFilteredRows.length ? lastFilteredRows : displayRows()).slice(pageStart, pageStart + pageSize).map(rowKey);
  if (e.target.checked) visible.forEach(k => selectedRowKeys.add(k));
  else visible.forEach(k => selectedRowKeys.delete(k));
  render();
});
document.getElementById('prevPageBtn')?.addEventListener('click', () => {
  currentPage = Math.max(1, currentPage - 1);
  render();
});
document.getElementById('nextPageBtn')?.addEventListener('click', () => {
  currentPage = Math.min(dashboardPageCount(), currentPage + 1);
  render();
});
document.getElementById('pageNumberInput')?.addEventListener('change', e => {
  currentPage = Number(e.target.value || 1);
  clampDashboardPage();
  render();
});
document.getElementById('pageSizeSelect')?.addEventListener('change', async e => {
  const nextSize = Number(e.target.value || 250);
  pageSize = [100, 250, 500, 1000].includes(nextSize) ? nextSize : 250;
  currentPage = 1;
  await saveDashboardPagingPrefs();
  render();
});

document.getElementById('receiptsBtn').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('receipts.html') }));
document.getElementById('stopBtn').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'STOP_SCAN', reason: 'Stopped from dashboard.' }); refresh(); });
document.getElementById('exportBtn').addEventListener('click', () => {
  const headers = ['score','purchaseCount','returnCount','currentPrice','estRetail','bids','hasUserBid','userBidStatus','auctionLocation','auctionClosesRaw','auctionClosesAt','auctionGroupKey','title','url','imageUrl','itemCondition','itemTags','conditionRating','quality','matchName','avgCost','maxCost','receiptNumbers','firstFoundAt','lastSeenAt','lastModifiedAt','pageUrl'];
  const exportRows = displayRows().map(row => ({
    ...row,
    itemTags: tagsForRow(row).map(displayTagName).join('; ')
  }));
  C.downloadBlob(`nellis-captured-${new Date().toISOString().slice(0,10)}.csv`, C.rowsToCsv(exportRows, headers), 'text/csv');
});

async function initDashboard() {
  await loadDashboardPagingPrefs();
  await loadCollapsedSections();
  setupDashboardCollapsibles();
  await loadDailyQueryImport();
  await refresh();
  await refreshTeamSyncStatus();
  setInterval(refresh, 15000);
  setInterval(refreshTeamSyncStatus, 10000);
}

initDashboard();
