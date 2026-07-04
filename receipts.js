const C = window.NellisCommon;
const BASE = 'https://www.nellisauction.com';
const RECEIPT_DOWNLOADER_VERSION = '2.0.8';
let running = false;
let rows = [];
let summaries = [];
let failures = [];
let sortKey = 'invoiceDate';
let sortDir = -1;
let detailDebugs = [];
const MONEY_RE_SOURCE = String.raw`\(?\s*-?\s*\$\s*-?\s*[0-9,]+(?:\.\d{2})?\s*\)?`;
function moneyRegex(flags = 'g') { return new RegExp(MONEY_RE_SOURCE, flags); }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function getSettingsFromUi() {
  return {
    receiptSpeedMode: document.getElementById('receiptSpeedMode').value,
    receiptMaxPages: Number(document.getElementById('receiptMaxPages').value || 80),
    receiptDetailMode: document.getElementById('receiptDetailMode').value
  };
}

async function saveSettings() {
  const data = await chrome.storage.local.get([C.STORAGE_KEYS.SETTINGS]);
  await chrome.storage.local.set({ [C.STORAGE_KEYS.SETTINGS]: { ...C.DEFAULT_SETTINGS, ...(data[C.STORAGE_KEYS.SETTINGS] || {}), ...getSettingsFromUi() } });
}


function isStaleBadReceiptRow(row) {
  const status = String(row?.status || '');
  const name = C.displayText(row?.productName || '');
  if (/Parsed from link card/i.test(status)) return true;
  if (/^(Nellis Auction Logo|Watchlist|Contact Us|Facebook|Instagram|LinkedIn|Browse Auctions|nellisauction\.com)$/i.test(name)) return true;
  if (/^(AmericanExpress|Visa|Mastercard|Discover|Subtotal|Buyer Premium|Tax|Grand Total)$/i.test(name.replace(/:.*/, '').trim())) return true;
  return false;
}

async function loadSettings() {
  const data = await chrome.storage.local.get([C.STORAGE_KEYS.SETTINGS, C.STORAGE_KEYS.RECEIPT_ROWS, C.STORAGE_KEYS.RECEIPT_SUMMARIES, C.STORAGE_KEYS.RECEIPT_STATE]);
  const settings = { ...C.DEFAULT_SETTINGS, ...(data[C.STORAGE_KEYS.SETTINGS] || {}) };
  document.getElementById('receiptSpeedMode').value = settings.receiptSpeedMode;
  document.getElementById('receiptMaxPages').value = settings.receiptMaxPages;
  let detailMode = settings.receiptDetailMode || 'liveTabs';
  if (detailMode === 'details') detailMode = 'liveTabs';
  document.getElementById('receiptDetailMode').value = detailMode;
  const loadedRows = data[C.STORAGE_KEYS.RECEIPT_ROWS] || [];
  rows = loadedRows.filter(r => !isStaleBadReceiptRow(r));
  const staleRowsRemoved = loadedRows.length - rows.length;
  summaries = data[C.STORAGE_KEYS.RECEIPT_SUMMARIES] || [];
  const receiptState = data[C.STORAGE_KEYS.RECEIPT_STATE] || {};
  failures = receiptState.failures || [];
  detailDebugs = receiptState.detailDebugs || [];
  const state = { ...receiptState, extensionVersion: RECEIPT_DOWNLOADER_VERSION };
  if (staleRowsRemoved > 0) state.message = `v${RECEIPT_DOWNLOADER_VERSION}: removed ${staleRowsRemoved} stale fake rows from older parser. Run again for fresh data.`;
  renderAll(state);
  if (staleRowsRemoved > 0) await saveReceiptData();
}

function setStatus(text) {
  document.getElementById('statusText').textContent = text;
  chrome.storage.local.set({ [C.STORAGE_KEYS.RECEIPT_STATE]: currentState(text) });
}

function currentState(message = '') {
  return {
    extensionVersion: RECEIPT_DOWNLOADER_VERSION,
    running,
    message,
    pages: Number(document.getElementById('receiptPages').textContent || 0),
    receipts: summaries.length,
    items: rows.length,
    failures,
    detailDebugs
  };
}

function renderAll(state) {
  document.getElementById('receiptPages').textContent = state?.pages || 0;
  document.getElementById('receiptCount').textContent = summaries.length;
  document.getElementById('itemCount').textContent = rows.length;
  document.getElementById('failedCount').textContent = failures.length;
  if (state?.message) document.getElementById('statusText').textContent = state.message;
  renderTable();
}

function valueFor(row, key) {
  if (key === 'price') return Number(row.price || 0);
  if (key === 'refunded') return row.refunded ? 1 : 0;
  return String(row[key] || '').toLowerCase();
}

function renderTable() {
  const q = C.normalizeText(document.getElementById('searchBox').value);
  const failedOnly = document.getElementById('failedToggle').checked;
  let viewRows = failedOnly
    ? failures.map(f => ({ receiptNumber: f.receiptNumber, invoiceDate: f.invoiceDate || '', location: f.location || '', refunded: f.refunded || false, price: f.total || 0, productName: f.error, inventoryNumber: '', status: 'Failed', detailUrl: f.detailUrl }))
    : rows;
  if (q) viewRows = viewRows.filter(r => C.normalizeText(`${r.receiptNumber} ${r.productName} ${r.inventoryNumber} ${r.location} ${r.status}`).includes(q));
  viewRows.sort((a,b) => {
    const av = valueFor(a, sortKey); const bv = valueFor(b, sortKey);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
    return String(av).localeCompare(String(bv)) * sortDir;
  });
  document.querySelector('#receiptTable tbody').innerHTML = viewRows.map(r => `
    <tr>
      <td>${r.detailUrl ? `<a href="${r.detailUrl}" target="_blank" rel="noreferrer">${escapeHtml(r.receiptNumber)}</a>` : escapeHtml(r.receiptNumber)}</td>
      <td>${escapeHtml(r.invoiceDate || '')}</td>
      <td>${escapeHtml(r.location || '')}</td>
      <td>${r.refunded ? 'TRUE' : 'FALSE'}</td>
      <td>${C.numberToMoney(r.price)}</td>
      <td>${escapeHtml(r.productName || '')}</td>
      <td>${escapeHtml(r.inventoryNumber || '')}</td>
      <td>${escapeHtml(r.status || '')}</td>
    </tr>`).join('');
}

async function fetchLoggedIn(url) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'follow' });
  const text = await res.text();
  const finalUrl = res.url || url;
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  if (/\/login|sign[ -]?in/i.test(finalUrl) || /log in|sign in/i.test(text.slice(0, 3000))) {
    throw new Error('Nellis did not return the receipt page. Open Nellis receipts, log in, then run this again.');
  }
  return { text, finalUrl };
}


function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for receipt tab to load.'));
    }, timeoutMs);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError) return;
      if (tab && tab.status === 'complete') finish();
    });
  });
}

async function extractLiveReceiptPayload(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
      function badName(value) {
        const t = clean(value);
        if (!t || t.length < 5) return true;
        if (/^(subtotal|buyer premium|tax|grand total|total|americanexpress|visa|mastercard|discover|payment|receipt|purchased items|returned items)\b\s*:?.*/i.test(t)) return true;
        if (/^(from:|customer:|date:|receipt #)/i.test(t)) return true;
        if (/^\(?\s*-?\s*\$\s*-?\s*[0-9,]+(?:\.\d{2})?\s*\)?$/.test(t)) return true;
        if (/^inv\s*#/i.test(t)) return true;
        return false;
      }
      function moneyValues(text) {
        return Array.from(String(text || '').matchAll(/\(?\s*-?\s*\$\s*-?\s*[0-9,]+(?:\.\d{2})?\s*\)?/g)).map(m => m[0]);
      }
      function scoreContainer(el) {
        if (!el) return -999;
        const t = clean(el.textContent);
        let score = 0;
        if (/\bInv\s*#\s*\d{6,15}/i.test(t)) score += 10;
        if (moneyValues(t).length) score += 8;
        if (el.querySelector && el.querySelector('img[alt]')) score += 8;
        if (el.querySelector && el.querySelector('.text-secondary')) score += 4;
        if (t.length > 2500) score -= 20;
        if (t.length < 80) score -= 5;
        return score;
      }
      function findBestContainer(start) {
        let best = null;
        let bestScore = -999;
        let el = start;
        for (let i = 0; i < 10 && el; i++, el = el.parentElement) {
          const score = scoreContainer(el);
          if (score > bestScore) { best = el; bestScore = score; }
          const t = clean(el.textContent);
          if (score >= 22 && t.length < 1800) break;
        }
        return best;
      }
      function pickName(card, imgAlt) {
        const candidates = [];
        if (imgAlt) candidates.push(imgAlt);
        const els = Array.from(card.querySelectorAll('p, a, span, div, h1, h2, h3, h4'));
        for (const el of els) {
          const t = clean(el.textContent);
          if (!badName(t) && t.length <= 300) candidates.push(t);
        }
        candidates.sort((a, b) => b.length - a.length);
        return candidates.find(t => !badName(t)) || '';
      }
      function rowFromCard(card) {
        const cardText = clean(card.textContent);
        const inv = (cardText.match(/\bInv\s*#\s*(\d{6,15})\b/i) || ['', ''])[1];
        if (!inv) return null;
        const imgAlt = clean(card.querySelector('img[alt]')?.getAttribute('alt') || '');
        const name = pickName(card, imgAlt);
        if (badName(name)) return null;
        const money = moneyValues(cardText);
        if (!money.length) return null;
        const priceText = money[money.length - 1];
        return { productName: name, inventoryNumber: inv, priceText, source: 'Parsed from live DOM item row', snippet: cardText.slice(0, 500) };
      }
      const rowMap = new Map();
      const invElements = Array.from(document.querySelectorAll('body *')).filter(el => /\bInv\s*#\s*\d{6,15}/i.test(clean(el.textContent)));
      for (const el of invElements) {
        const card = findBestContainer(el);
        const row = card ? rowFromCard(card) : null;
        if (!row) continue;
        rowMap.set(`${row.inventoryNumber}|${row.productName}`, row);
      }
      for (const img of Array.from(document.querySelectorAll('img[alt]'))) {
        const alt = clean(img.getAttribute('alt'));
        if (badName(alt) || /nellis|logo/i.test(alt)) continue;
        const card = findBestContainer(img);
        const row = card ? rowFromCard(card) : null;
        if (!row) continue;
        rowMap.set(`${row.inventoryNumber}|${row.productName}`, row);
      }
      const bodyText = document.body ? clean(document.body.innerText || '') : '';
      return {
        url: location.href,
        title: document.title,
        html: document.documentElement.outerHTML,
        text: bodyText.slice(0, 10000),
        liveRows: Array.from(rowMap.values()),
        debug: {
          url: location.href,
          title: document.title,
          invTextCount: (bodyText.match(/\bInv\s*#/gi) || []).length,
          imageAltCount: document.querySelectorAll('img[alt]').length,
          moneyCount: (bodyText.match(/\(?\s*-?\s*\$\s*-?\s*[0-9,]+(?:\.\d{2})?\s*\)?/g) || []).length,
          firstText: bodyText.slice(0, 2500),
          firstRows: Array.from(rowMap.values()).slice(0, 5)
        }
      };
    }
  });
  return result && result[0] && result[0].result;
}

async function fetchLiveRenderedReceiptHtml(url, settings) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(tab.id);
    let payload = null;
    const maxWaitMs = settings.receiptSpeedMode === 'super' ? 6000 : 12000;
    const started = Date.now();
    do {
      await C.delay(settings.receiptSpeedMode === 'super' ? 700 : 1200);
      payload = await extractLiveReceiptPayload(tab.id);
      if (payload && Array.isArray(payload.liveRows) && payload.liveRows.length) break;
      if (payload && /\/login|sign[ -]?in/i.test(payload.url || '') || /log in|sign in/i.test(payload?.text || '')) break;
    } while (Date.now() - started < maxWaitMs);

    if (!payload || !payload.html) throw new Error('Could not read rendered receipt tab.');
    if (/\/login|sign[ -]?in/i.test(payload.url) || /log in|sign in/i.test(payload.text || '')) {
      throw new Error('The live receipt tab opened a login page. Log into Nellis, then run again.');
    }
    return { text: payload.html, plainText: payload.text || '', finalUrl: payload.url, liveRows: payload.liveRows || [], debug: payload.debug || null };
  } finally {
    if (tab && tab.id) { try { await chrome.tabs.remove(tab.id); } catch {} }
  }
}

function pageUrl(index) {
  if (index <= 0) return `${BASE}/dashboard/receipts`;
  return `${BASE}/dashboard/receipts?_p=${encodeURIComponent(`s:12,n:${index}`)}`;
}

function parseMoneyLabel(text, label) {
  const re = new RegExp(`${label}\\s*:?\\s*(\\(?-?\\$?\\s*[0-9,]+(?:\\.\\d{2})?\\)?)`, 'i');
  const m = text.match(re);
  return m ? C.moneyToNumber(m[1]) : 0;
}

function parseReceiptList(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = Array.from(doc.querySelectorAll('a[href*="/dashboard/receipts/"]'));
  const seen = new Set();
  const out = [];
  for (const a of links) {
    const href = new URL(a.getAttribute('href'), baseUrl || BASE).toString();
    const idMatch = href.match(/\/dashboard\/receipts\/(\d+)/);
    if (!idMatch || seen.has(idMatch[1])) continue;
    seen.add(idMatch[1]);
    let card = a;
    for (let i = 0; i < 8 && card.parentElement; i++) {
      card = card.parentElement;
      const t = C.displayText(card.textContent);
      if (t.includes('Subtotal:') && t.includes('Total:')) break;
    }
    const text = C.displayText(card.textContent);
    const aria = a.getAttribute('aria-label') || '';
    const dateMatch = aria.match(/from\s+(.+)$/i) || text.match(/^([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}\s+[AP]M)/);
    const invoiceDate = dateMatch ? C.displayText(dateMatch[1]) : '';
    let location = '';
    const locRe = invoiceDate ? new RegExp(`${escapeRegExp(invoiceDate)}\\s+(.+?)\\s*\\|\\s*#${idMatch[1]}`) : null;
    const locMatch = locRe ? text.match(locRe) : text.match(/\d{4},\s+\d{1,2}:\d{2}\s+[AP]M\s+(.+?)\s*\|\s*#\d+/);
    if (locMatch) location = C.displayText(locMatch[1]);
    const countMatch = text.match(/#\s+of\s+(Purchases|Returns|Items)\s+(\d+)/i);
    const kind = countMatch ? countMatch[1].toLowerCase() : (text.includes('$-') ? 'returns' : 'purchases');
    out.push({
      receiptNumber: idMatch[1],
      detailUrl: href,
      invoiceDate,
      location,
      kind,
      refunded: kind.includes('return') || parseMoneyLabel(text, 'Total') < 0,
      count: countMatch ? Number(countMatch[2]) : 0,
      subtotal: parseMoneyLabel(text, 'Subtotal'),
      tax: parseMoneyLabel(text, 'Tax'),
      buyerPremium: parseMoneyLabel(text, 'Buyer Premium'),
      total: parseMoneyLabel(text, 'Total'),
      status: 'Listed'
    });
  }
  const nextLink = Array.from(doc.querySelectorAll('a[href]')).find(a => /next/i.test(a.getAttribute('aria-label') || C.displayText(a.textContent || '')));
  const next = nextLink ? nextLink.getAttribute('href') : '';
  const last = Array.from(doc.querySelectorAll('a[href*="_p="]')).map(a => {
    try { return decodeURIComponent(new URL(a.getAttribute('href'), baseUrl || BASE).searchParams.get('_p') || '').match(/n:(\d+)/)?.[1]; } catch { return null; }
  }).filter(Boolean).map(Number).sort((a,b)=>b-a)[0];
  return { receipts: out, nextUrl: next ? new URL(next, baseUrl || BASE).toString() : '', lastPageIndex: Number.isFinite(last) ? last : null };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textsFromDoc(doc) {
  const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const txt = C.displayText(node.nodeValue);
      if (!txt || txt.length < 2) return NodeFilter.FILTER_REJECT;
      if (/^(EXPLORE|View Details|Receipts|My Auctions|Account|Privacy Policy)$/i.test(txt)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const arr = [];
  let n;
  while ((n = walker.nextNode())) arr.push(C.displayText(n.nodeValue));
  return arr;
}

function parseJsonLdOrScripts(html, summary) {
  const rows = [];
  const productNames = new Set();
  for (const m of html.matchAll(/"(?:name|productName|title|description)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
    let name = '';
    try { name = JSON.parse(`"${m[1]}"`); } catch { name = m[1]; }
    name = C.displayText(name);
    if (name.length < 8 || /receipt|subtotal|buyer premium|nellis auction/i.test(name)) continue;
    const key = C.normalizeText(name);
    if (productNames.has(key)) continue;
    productNames.add(key);
    rows.push(makeRow(summary, name, '', 0, 'Parsed from page data'));
  }
  return rows;
}


function isBadProductName(name) {
  const text = C.displayText(name);
  if (!text || text.length < 5) return true;
  if (/^(subtotal|buyer premium|tax|grand total|total|americanexpress|visa|mastercard|discover|payment|receipt|purchased items|returned items)\b\s*:?.*/i.test(text)) return true;
  if (/^(from:|customer:|date:|receipt #)/i.test(text)) return true;
  if (/^\(?-?\$\s*[0-9,]+(?:\.\d{2})?\)?$/.test(text)) return true;
  if (/^inv\s*#/i.test(text)) return true;
  if (/^(nellis auction logo|watchlist|contact us|facebook|instagram|linkedin|browse auctions|nellisauction\.com|logout|active|outbid|winning|won|lost|pick ups|appointments|profile details|wallet|communication preferences|saved searches|change password|my auctions|my account|rewards|fees|privacy policy|terms of use)$/i.test(text)) return true;
  return false;
}

function closestItemContainer(start) {
  let el = start;
  for (let i = 0; i < 10 && el; i++, el = el.parentElement) {
    const text = C.displayText(el.textContent);
    if (/\bInv\s*#/i.test(text) && /\(?\s*-?\s*\$\s*-?\s*[0-9,]+(?:\.\d{2})?\s*\)?/.test(text) && text.length < 1800) {
      return el;
    }
  }
  return null;
}

function parseItemRowsFromImages(doc, summary) {
  const out = [];
  const imgs = Array.from(doc.querySelectorAll('img[alt]'));
  for (const img of imgs) {
    const imageAlt = C.displayText(img.getAttribute('alt') || '');
    if (isBadProductName(imageAlt) || /nellis|logo/i.test(imageAlt)) continue;

    const card = closestItemContainer(img);
    if (!card) continue;

    const cardText = C.displayText(card.textContent);
    const inv = (cardText.match(/\bInv\s*#\s*(\d{6,15})\b/i) || ['', ''])[1];
    if (!inv) continue;

    const moneyMatches = Array.from(cardText.matchAll(/\(?\s*-?\s*\$\s*-?\s*[0-9,]+(?:\.\d{2})?\s*\)?/g)).map(m => m[0]);
    if (!moneyMatches.length) continue;
    let price = C.moneyToNumber(moneyMatches[moneyMatches.length - 1]);
    if (summary.refunded && price > 0) price = -price;

    const namedElement = Array.from(card.querySelectorAll('p, a, span, div'))
      .map(el => C.displayText(el.textContent))
      .filter(t => t && t.length >= 5 && !/\bInv\s*#/i.test(t) && !/^\(?-?\$/.test(t) && !/subtotal|buyer premium|tax|grand total|total/i.test(t))
      .sort((a, b) => b.length - a.length)[0];

    const name = isBadProductName(namedElement) ? imageAlt : namedElement;
    if (isBadProductName(name)) continue;

    out.push(makeRow(summary, name, inv, price, 'Parsed from receipt item row'));
  }
  return dedupeRows(out);
}


function parseDetailItemsFromText(fullText, summary) {
  const text = C.displayText(fullText || '');
  if (!/\bInv\s*#\s*\d{6,15}/i.test(text)) return [];

  const sectionMatch = text.match(/\b(?:PURCHASED|RETURNED)\s+ITEMS\b([\s\S]+?)\bPAYMENT\s+DETAILS\b/i);
  let section = sectionMatch ? sectionMatch[1] : text;

  // If a header/footer still leaked in, trim to the first plausible product marker.
  section = section.replace(/^.*?\b(?:PURCHASED|RETURNED)\s+ITEMS\b/i, '');

  const invPriceRe = new RegExp(`\\bInv\\s*#\\s*(\\d{6,15})\\s*(${MONEY_RE_SOURCE})`, 'gi');
  const matches = Array.from(section.matchAll(invPriceRe));
  if (!matches.length) return [];

  const out = [];
  let previousEnd = 0;
  for (const match of matches) {
    const rawName = section.slice(previousEnd, match.index);
    previousEnd = match.index + match[0].length;

    let name = C.displayText(rawName || '');
    name = name
      .replace(/^(?:PURCHASED|RETURNED)\s+ITEMS\s*/i, '')
      .replace(/\b(?:Company|Accessibility|Careers|Location & Hours|Services|Estate Sales|Help Center|Video Tutorials|FAQ|Help Desk|Contact Us|Facebook|Instagram|LinkedIn|YouTube|Terms of Service|Privacy Policy|Mobile App Policy|Browse Auctions|My Auctions|Active|Outbid|Watchlist|Winning|Won|Lost|Pick Ups|Appointments|Receipts|Purchases|Returns|Fees|My Account|Profile Details|Rewards|Coming Soon|Change Password|Wallet|Communication Preferences|Saved Searches|Logout)\b.*$/i, '')
      .trim();

    // Some DOM text glues a previous bad chunk in front of the product. Keep the last plausible long phrase.
    if (name.length > 500 || /Nellis Auction|Customer:|From:|Receipt #|Spotlight|My Auctions|CompanyAccessibility/i.test(name)) {
      const chunks = name
        .split(/(?:THANK YOU FOR SHOPPING WITH US|CompanyAccessibility|My Auctions|RECEIPT|Back \/ Receipts|Customer:|From:)/i)
        .map(C.displayText)
        .filter(Boolean);
      if (chunks.length) name = chunks[chunks.length - 1];
    }

    // Remove any accidental trailing old inventory/price blob from the name.
    name = name.replace(/\bInv\s*#\s*\d{6,15}\s*\(?\s*-?\s*\$\s*-?\s*[0-9,]+(?:\.\d{2})?\s*\)?\s*$/i, '').trim();

    if (isBadProductName(name)) continue;
    let price = C.moneyToNumber(match[2]);
    if (summary.refunded && price > 0) price = -price;
    out.push(makeRow(summary, name, match[1], price, 'Parsed from receipt text'));
  }
  return dedupeRows(out);
}

function parseDetailItems(html, summary) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const textRows = parseDetailItemsFromText(doc.body ? (doc.body.innerText || doc.body.textContent || '') : doc.textContent, summary);
  if (textRows.length) return textRows;

  const imageRows = parseItemRowsFromImages(doc, summary);
  if (imageRows.length) return imageRows;

  const detailRows = [];

  const tableRows = Array.from(doc.querySelectorAll('tr'));
  for (const tr of tableRows) {
    const txt = C.displayText(tr.textContent);
    if (txt.length < 10 || !txt.includes('$')) continue;
    const cells = Array.from(tr.querySelectorAll('td,th')).map(td => C.displayText(td.textContent)).filter(Boolean);
    const inv = (txt.match(/\b\d{8,12}\b/) || [''])[0];
    const money = Array.from(txt.matchAll(/\(?\s*-?\s*\$\s*-?\s*[0-9,]+(?:\.\d{2})?\s*\)?/g)).map(m => C.moneyToNumber(m[0]));
    let price = money.length ? money[money.length - 1] : 0;
    if (summary.refunded && price > 0) price = -price;
    let name = cells.find(c => c.length > 8 && !/^\$/.test(c) && !/^\d{8,12}$/.test(c) && !/price|inventory|subtotal|tax|buyer/i.test(c));
    if (!name) name = txt.replace(/\b\d{8,12}\b/g, '').replace(/\(?\s*-?\s*\$\s*-?\s*[0-9,]+(?:\.\d{2})?\s*\)?/g, '').trim();
    if (!isBadProductName(name) && inv) detailRows.push(makeRow(summary, name, inv, price, 'Parsed from table'));
  }

  if (detailRows.length) return dedupeRows(detailRows);


  // v2.0.4: Do not fall back to general links/text. Those areas include nav,
  // social links, footer, and payment summary junk that can look item-ish.
  // If we cannot find concrete item rows, fail loudly and export debug.
  return [];

}

function makeRow(summary, productName, inventoryNumber, price, status) {
  return {
    productName: C.displayText(productName),
    inventoryNumber: C.displayText(inventoryNumber),
    price: Number(price || 0),
    receiptNumber: summary.receiptNumber,
    invoiceDate: summary.invoiceDate,
    refunded: !!summary.refunded,
    location: summary.location,
    detailUrl: summary.detailUrl,
    status
  };
}

function dedupeRows(input) {
  const map = new Map();
  for (const r of input) {
    const key = `${C.normalizeText(r.productName)}|${r.inventoryNumber}|${r.receiptNumber}`;
    if (!map.has(key)) map.set(key, r);
  }
  return Array.from(map.values());
}

function rowsAsHistoryCsv() {
  const headers = ['Product Name','Inventory Number','Price','Receipt Number','Invoice Date','Refunded'];
  const csvRows = rows.map(r => ({
    'Product Name': C.displayText(String(r.productName || '').replace(/\bInv\s*#\s*\d{6,15}.*$/i, '')),
    'Inventory Number': r.inventoryNumber,
    'Price': r.price < 0 ? `($${Math.abs(r.price).toFixed(2)})` : `$${Math.abs(r.price).toFixed(2)}`,
    'Receipt Number': r.receiptNumber,
    'Invoice Date': r.invoiceDate,
    'Refunded': r.refunded ? 'TRUE' : 'FALSE'
  })).filter(r => r['Product Name'] && !isBadProductName(r['Product Name']));
  return C.rowsToCsv(csvRows, headers);
}

async function saveReceiptData() {
  await chrome.storage.local.set({
    [C.STORAGE_KEYS.RECEIPT_ROWS]: rows,
    [C.STORAGE_KEYS.RECEIPT_SUMMARIES]: summaries,
    [C.STORAGE_KEYS.RECEIPT_STATE]: currentState(document.getElementById('statusText').textContent)
  });
}

async function downloadReceipts() {
  await saveSettings();
  const settings = getSettingsFromUi();
  running = true;
  failures = [];
  rows = [];
  summaries = [];
  detailDebugs = [];
  renderAll({ pages: 0, message: 'Starting...' });

  let nextUrl = pageUrl(0);
  let pageIndex = 0;
  let knownLastPage = null;
  const seenReceiptIds = new Set();

  while (running && pageIndex < settings.receiptMaxPages && nextUrl) {
    setStatus(`Fetching receipt list page ${pageIndex + 1}...`);
    const listRes = await fetchLoggedIn(nextUrl);
    const parsed = parseReceiptList(listRes.text, listRes.finalUrl);
    if (knownLastPage == null && parsed.lastPageIndex != null) knownLastPage = parsed.lastPageIndex;
    const newReceipts = parsed.receipts.filter(r => !seenReceiptIds.has(r.receiptNumber));
    for (const r of newReceipts) seenReceiptIds.add(r.receiptNumber);
    summaries.push(...newReceipts);
    document.getElementById('receiptPages').textContent = pageIndex + 1;
    document.getElementById('receiptCount').textContent = summaries.length;
    await saveReceiptData();
    renderTable();

    if (settings.receiptDetailMode !== 'listOnly') {
      for (const receipt of newReceipts) {
        if (!running) break;
        try {
          setStatus(`${settings.receiptDetailMode === 'rawFetch' ? 'Fetching' : 'Opening live tab for'} receipt #${receipt.receiptNumber}...`);
          const detailRes = settings.receiptDetailMode === 'rawFetch'
            ? await fetchLoggedIn(receipt.detailUrl)
            : await fetchLiveRenderedReceiptHtml(receipt.detailUrl, settings);
          let itemRows = [];
          const debugEntry = {
            receiptNumber: receipt.receiptNumber,
            detailUrl: receipt.detailUrl,
            refunded: receipt.refunded,
            mode: settings.receiptDetailMode,
            liveDebug: detailRes.debug || null,
            rawLiveRows: Array.isArray(detailRes.liveRows) ? detailRes.liveRows.slice(0, 25) : [],
            parsedRows: [],
            htmlSampleOnFailure: ''
          };
          // The rendered receipt body text is the most reliable source. DOM card guessing can accidentally
          // walk into header/footer/nav containers, so only use liveRows as a last resort.
          itemRows = parseDetailItemsFromText(detailRes.plainText || '', receipt);
          if (!itemRows.length) itemRows = parseDetailItems(detailRes.text, receipt);
          if (!itemRows.length && Array.isArray(detailRes.liveRows) && detailRes.liveRows.length) {
            itemRows = detailRes.liveRows
              .filter(x => x && !isBadProductName(x.productName) && x.inventoryNumber && !/CompanyAccessibility|My Auctions|Nellis Auction Logo|Watchlist|Contact Us|Facebook|Instagram|LinkedIn|Browse Auctions/i.test(x.productName))
              .map(x => {
                let price = C.moneyToNumber(x.priceText);
                if (receipt.refunded && price > 0) price = -price;
                return makeRow(receipt, x.productName, x.inventoryNumber, price, x.source || 'Parsed from live DOM');
              });
          }
          debugEntry.parsedRows = itemRows.slice(0, 25);
          if (!itemRows.length) {
            debugEntry.htmlSampleOnFailure = String(detailRes.text || '').slice(0, 30000);
            failures.push({ ...receipt, error: 'No concrete product rows could be parsed from detail page. Export Debug has the receipt DOM sample.', debug: detailRes.debug || null });
          } else {
            rows.push(...itemRows);
          }
          detailDebugs.push(debugEntry);
        } catch (err) {
          failures.push({ ...receipt, error: err.message || String(err) });
        }
        document.getElementById('itemCount').textContent = rows.length;
        document.getElementById('failedCount').textContent = failures.length;
        renderTable();
        await saveReceiptData();
        await C.delay(C.getSpeedDelay(settings.receiptSpeedMode, 'receipt-detail'));
      }
    } else {
      rows.push(...newReceipts.map(r => makeRow(r, `Receipt summary only: ${r.kind} ${r.count || ''}`.trim(), '', r.subtotal || r.total || 0, 'List only')));
    }

    if (!running) break;
    pageIndex++;
    if (knownLastPage != null && pageIndex > knownLastPage) break;
    nextUrl = parsed.nextUrl || pageUrl(pageIndex);
    if (!newReceipts.length) break;
    await C.delay(C.getSpeedDelay(settings.receiptSpeedMode, 'receipt-list'));
  }
  running = false;
  await saveReceiptData();
  setStatus(`Done. ${summaries.length} receipts, ${rows.length} item rows, ${failures.length} failures.`);
  renderAll(currentState(document.getElementById('statusText').textContent));
}

document.getElementById('startBtn').addEventListener('click', () => {
  downloadReceipts().catch(err => {
    running = false;
    setStatus(`Download failed: ${err.message || err}`);
    renderAll(currentState(document.getElementById('statusText').textContent));
  });
});

document.getElementById('stopBtn').addEventListener('click', async () => {
  running = false;
  setStatus('Stopping after current request...');
  await saveReceiptData();
});

document.getElementById('clearBtn').addEventListener('click', async () => {
  running = false; rows = []; summaries = []; failures = []; detailDebugs = [];
  await chrome.storage.local.set({ [C.STORAGE_KEYS.RECEIPT_ROWS]: [], [C.STORAGE_KEYS.RECEIPT_SUMMARIES]: [], [C.STORAGE_KEYS.RECEIPT_STATE]: currentState('Cleared receipt data.') });
  renderAll(currentState('Cleared receipt data.'));
});

document.getElementById('openReceiptsBtn').addEventListener('click', () => chrome.tabs.create({ url: `${BASE}/dashboard/receipts` }));
document.getElementById('exportBtn').addEventListener('click', () => C.downloadBlob(`nellis-receipts-${new Date().toISOString().slice(0,10)}.csv`, rowsAsHistoryCsv(), 'text/csv'));
document.getElementById('debugBtn').addEventListener('click', () => {
  const payload = { exportedAt: new Date().toISOString(), extensionVersion: RECEIPT_DOWNLOADER_VERSION, staleBadRowsCurrentlyVisible: rows.filter(isStaleBadReceiptRow).length, summaries, rows, failures, detailDebugs };
  C.downloadBlob(`nellis-receipts-debug-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
});
document.getElementById('useHistoryBtn').addEventListener('click', async () => {
  const csvText = rowsAsHistoryCsv();
  const parsed = C.parseCsv(csvText);
  const built = C.buildPurchaseHistory(parsed);
  await chrome.storage.local.set({ [C.STORAGE_KEYS.HISTORY]: built.history, [C.STORAGE_KEYS.HISTORY_META]: built.meta });
  setStatus(`Saved as scanner history: ${built.meta.uniqueNames} unique names.`);
});

document.getElementById('searchBox').addEventListener('input', renderTable);
document.getElementById('failedToggle').addEventListener('change', renderTable);
for (const id of ['receiptSpeedMode','receiptMaxPages','receiptDetailMode']) document.getElementById(id).addEventListener('change', saveSettings);
document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
  const key = th.dataset.sort;
  if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = ['price','refunded'].includes(key) ? -1 : 1; }
  renderTable();
}));

loadSettings();
