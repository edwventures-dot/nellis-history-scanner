(async () => {
  const C = window.NellisCommon;
  if (!C || window.__nellisHistoryScannerLoaded) return;
  window.__nellisHistoryScannerLoaded = true;

  async function storageGet(keys) {
    return await chrome.storage.local.get(keys);
  }

  function textOf(node) {
    return C.displayText(node ? node.textContent : '');
  }

  function linesOf(node) {
    const source = node ? (node.innerText || node.textContent || '') : '';
    return String(source)
      .split(/\n+/)
      .map(x => C.displayText(x))
      .filter(Boolean);
  }

  function escapedLabelRegex(label, suffix = '') {
    return new RegExp(String.raw`^\*?\s*${label}${suffix}`, 'i');
  }

  function parseMoneyAfterLabel(node, labels) {
    const lines = linesOf(node);
    for (const label of labels) {
      const exact = escapedLabelRegex(label, String.raw`\s*$`);
      const sameLine = escapedLabelRegex(label, String.raw`\s*:?\s*(\$?\s*[()0-9,.-]+)`);
      for (let i = 0; i < lines.length; i++) {
        const same = lines[i].match(sameLine);
        if (same) return Math.abs(C.moneyToNumber(same[1]));
        if (!exact.test(lines[i])) continue;
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
          const value = lines[j];
          if (/^\*?\s*(current|estimated|est\.?|retail|bids?|buyer|premium|location|pickup|closes?)\b/i.test(value)) break;
          if (/\$\s*[0-9,]+(?:\.[0-9]{2})?/.test(value)) return Math.abs(C.moneyToNumber(value));
        }
      }
    }
    const clean = C.displayText(node ? node.textContent || '' : '');
    for (const label of labels) {
      const re = new RegExp(String.raw`\b${label}\b\s*:?\s*\$?\s*([()0-9,.-]+)`, 'i');
      const m = clean.match(re);
      if (m) return Math.abs(C.moneyToNumber(m[1]));
    }
    return 0;
  }

  function parseBids(node) {
    const lines = linesOf(node);
    const labels = ['BIDS?', 'Bid Count'];
    for (const label of labels) {
      const exact = escapedLabelRegex(label, String.raw`\s*$`);
      const sameLine = escapedLabelRegex(label, String.raw`\s*:?\s*([0-9]{1,4})\s*$`);
      for (let i = 0; i < lines.length; i++) {
        const same = lines[i].match(sameLine);
        if (same) return Number(same[1]);
        if (!exact.test(lines[i])) continue;
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
          const value = lines[j];
          if (/^\*?\s*(current|estimated|est\.?|retail|buyer|premium|location|pickup|closes?)\b/i.test(value)) break;
          if (/^\d{1,4}$/.test(value)) return Number(value);
          if (/\$|\.|%/.test(value)) continue;
        }
      }
    }
    const clean = C.displayText(node ? node.textContent || '' : '');
    const m = clean.match(/\b(?:bids?|bid count)\b\s*:?\s*([0-9]{1,4})\b/i);
    return m ? Number(m[1]) : 0;
  }

  function parseTextAfterLabel(node, labels, options = {}) {
    const lines = linesOf(node);
    const stop = options.stop || /^\*?\s*(current|estimated|est\.?|retail|bids?|buyer|premium|location|pickup|closes?|ends?|condition|watchlist)\b/i;
    const maxWords = Number(options.maxWords || 12);
    for (const label of labels) {
      const exact = escapedLabelRegex(label, String.raw`\s*$`);
      const sameLine = escapedLabelRegex(label, String.raw`\s*:?\s*(.+)$`);
      for (let i = 0; i < lines.length; i++) {
        const same = lines[i].match(sameLine);
        if (same && same[1]) {
          const value = C.displayText(same[1]);
          if (value && !stop.test(value)) return value.split(/\s+/).slice(0, maxWords).join(' ');
        }
        if (!exact.test(lines[i])) continue;
        for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
          const value = C.displayText(lines[j]);
          if (!value) continue;
          if (stop.test(value)) break;
          return value.split(/\s+/).slice(0, maxWords).join(' ');
        }
      }
    }
    return '';
  }

  function attributeTextOf(node) {
    const root = node || document;
    const attrs = ['aria-label', 'title', 'alt', 'datetime', 'data-testid', 'data-test-id', 'data-auction-id', 'data-auction', 'data-event', 'data-event-name', 'data-location', 'data-pickup-location', 'data-close', 'data-closes', 'data-closes-at', 'data-ending-at'];
    const out = [];
    const nodes = Array.from(root.querySelectorAll ? root.querySelectorAll('*') : []).slice(0, 260);
    for (const el of nodes) {
      for (const name of attrs) {
        const value = el.getAttribute ? el.getAttribute(name) : '';
        if (value && String(value).length <= 180) out.push(value);
      }
      if (el.dataset) {
        for (const [key, value] of Object.entries(el.dataset)) {
          if (!value || String(value).length > 180) continue;
          if (/auction|event|pickup|location|close|closing|end|time/i.test(key)) out.push(value);
        }
      }
    }
    return C.displayText(out.join('\n'));
  }

  function combinedTextOf(node) {
    return C.displayText([textOf(node), attributeTextOf(node)].filter(Boolean).join('\n'));
  }

  function attributeLinesOf(node) {
    return attributeTextOf(node)
      .split(/\n+/)
      .map(x => C.displayText(x))
      .filter(Boolean);
  }

  function cleanAuctionPart(value) {
    return C.displayText(value)
      .replace(/^[:\-–—|]+\s*/, '')
      .replace(/^(event\s+name|event|pickup\s+location|pickup|auction\s+location|location|warehouse|facility|site|auction\s+closes|closes\s+at|closes|closing|close\s+date|close\s+time|ends\s+at|ends|ending|time\s+left)\b\s*[:\-–—]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stopAtKnownField(value) {
    return C.displayText(value)
      .replace(/\s+\$\s*[0-9,]+(?:\.\d{2})?.*$/i, '')
      .replace(/\s+\b(?:current|estimated|est\.?|retail|bids?|bid\s+count|buyer|premium|condition|watchlist|star\s+rating|add\s+to|remove\s+from)\b.*$/i, '')
      .trim();
  }

  function looksLikeBadAuctionValue(value) {
    const v = C.displayText(value);
    if (!v || v.length < 2 || v.length > 90) return true;
    if (/^\$|^\d+\s*bids?\b|buyer premium|estimated retail|current (?:bid|price)|watchlist|star rating/i.test(v)) return true;
    if (/^(new|used|open box|major damage|minor damage|appears new|condition)$/i.test(v)) return true;
    if (looksLikeListingTitleValue(v)) return true;
    return false;
  }

  function looksLikeListingTitleValue(value) {
    const v = C.displayText(value);
    if (!v || v.length < 28) return false;
    if (/[,$]/.test(v) && /\b(?:with|for|pack|set|inch|foot|feet|ft|mount|helmet|bike|skateboard|barrier|belt|mens?|womens?|kids?|youth)\b/i.test(v)) return true;
    if (/\b(?:with|for)\b/i.test(v) && v.length > 40) return true;
    if (/[A-Z]{2,}\d|(?:\/|,)\s*[A-Z]/.test(v) && v.length > 36) return true;
    return false;
  }

  function looksLikeEventName(value) {
    const v = C.displayText(value);
    if (!v || v.length < 8 || v.length > 140) return false;
    if (!/-/.test(v)) return false;
    return /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(v)
      || /\bauction\b/i.test(v);
  }

  function eventLocationFromName(value) {
    const parts = C.displayText(value).split(/\s+-\s+/).map(x => C.displayText(x)).filter(Boolean);
    if (parts.length < 3) return '';
    const last = parts[parts.length - 1];
    if (!/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(last)) return '';
    return parts[parts.length - 2] || '';
  }

  let pageEventCache = null;
  function extractPageEventNames() {
    if (pageEventCache) return pageEventCache;
    const raw = String(document.body?.innerText || '');
    const blockMatch = raw.match(/\bEvent Name\b([\s\S]{0,1800}?)(?=\bEvent Type\b|\bAdult Content\b|\bBrand\b|\bCategory\b|$)/i);
    const block = blockMatch ? blockMatch[1] : raw.slice(0, 3000);
    const text = C.displayText(block.replace(/\n+/g, ' '));
    const month = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    const eventRe = new RegExp(`([A-Z][A-Za-z0-9 &'()/]+(?:\\s*-\\s*[A-Za-z0-9 &'()/]+){1,4}\\s*-\\s*${month}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?)(?:\\s+\\d+)?`, 'ig');
    const seen = new Set();
    const events = [];
    let match;
    while ((match = eventRe.exec(text))) {
      const name = C.displayText(match[1]);
      const key = C.normalizeText(name);
      if (!looksLikeEventName(name) || seen.has(key)) continue;
      seen.add(key);
      events.push({ name, location: eventLocationFromName(name) });
    }
    pageEventCache = events;
    return events;
  }

  function findPageEventForLocation(locationValue) {
    const events = extractPageEventNames();
    if (!events.length) return '';
    const loc = C.normalizeText(locationValue);
    if (loc) {
      const matches = events.filter(event => {
        const eventLoc = C.normalizeText(event.location);
        return eventLoc && (eventLoc === loc || eventLoc.includes(loc) || loc.includes(eventLoc));
      });
      if (matches.length === 1) return matches[0].name;
    }
    return events.length === 1 ? events[0].name : '';
  }

  function findLabelValueFromLines(lines, labelRe, valueLooksUseful) {
    const stopRe = /^\*?\s*(current|estimated|est\.?|retail|bids?|bid\s+count|buyer|premium|condition|watchlist|star\s+rating|add\s+to|remove\s+from)\b/i;
    for (let i = 0; i < lines.length; i++) {
      const line = C.displayText(lines[i]);
      if (!line || !labelRe.test(line)) continue;
      let after = cleanAuctionPart(line.replace(labelRe, ''));
      after = stopAtKnownField(after);
      if (after && !looksLikeBadAuctionValue(after) && (!valueLooksUseful || valueLooksUseful(after))) return after;
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        let value = C.displayText(lines[j]);
        if (!value) continue;
        if (stopRe.test(value) || labelRe.test(value)) break;
        value = stopAtKnownField(cleanAuctionPart(value));
        if (value && !looksLikeBadAuctionValue(value) && (!valueLooksUseful || valueLooksUseful(value))) return value;
      }
    }
    return '';
  }

  function looksLikeCloseValue(value) {
    const v = C.displayText(value);
    if (!v) return false;
    if (/\b(?:today|tomorrow)\b.*\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(v)) return true;
    if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(v)) return true;
    if (/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/.test(v)) return true;
    if (/\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(v) && /\b(?:closes?|ends?|ending|close|today|tomorrow)\b/i.test(v)) return true;
    if (/^(?:time\s+left\s*)?(?:in\s+)?\d+\s*(?:d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?:\s+\d+\s*(?:d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes))*$/i.test(v)) return true;
    return false;
  }

  function findDateTimeInText(value) {
    const text = C.displayText(value).replace(/\b(\d{1,2})(st|nd|rd|th)\b/ig, '$1');
    const patterns = [
      /\b(?:today|tomorrow)\s*(?:at\s*)?\d{1,2}:\d{2}\s*(?:am|pm)\b/i,
      /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s*(?:\d{4})?\s*(?:at\s*)?\d{1,2}:\d{2}\s*(?:am|pm)?\b/i,
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s*(?:\d{4})?\s*(?:at\s*)?\d{1,2}:\d{2}\s*(?:am|pm)?\b/i,
      /\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\s*(?:at\s*)?\d{1,2}:\d{2}\s*(?:am|pm)?\b/i
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) return C.displayText(m[0]);
    }
    return '';
  }

  function findLocationFromPageUrl() {
    try {
      const params = new URL(location.href).searchParams;
      const names = ['pickupLocation', 'pickup_location', 'location', 'locations', 'warehouse', 'facility', 'site'];
      for (const name of names) {
        const value = params.get(name);
        if (!value) continue;
        const clean = C.displayText(decodeURIComponent(value).replace(/[+_\-]+/g, ' '));
        if (/[a-z]/i.test(clean) && clean.length >= 2 && clean.length <= 60) return clean;
      }
    } catch {}
    return '';
  }

  function findLocationByMapPin(card) {
    const svgs = Array.from(card?.querySelectorAll?.('svg') || []);
    for (const svg of svgs) {
      const viewBox = C.displayText(svg.getAttribute('viewBox') || '');
      const pathText = Array.from(svg.querySelectorAll('path')).map(p => p.getAttribute('d') || '').join(' ');
      const cls = C.displayText(svg.getAttribute('class') || '');
      const looksLikePin = viewBox === '0 0 384 512' && /M352\s+192|384\s+192|160-160|86\s+0\s+192\s+0/i.test(pathText);
      if (!looksLikePin) continue;

      let node = svg.parentElement;
      for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
        const candidates = [];
        const labeled = Array.from(node.querySelectorAll('span,p,strong,div'))
          .map(el => C.displayText(el.textContent || ''))
          .filter(v => v && v.length <= 80);
        candidates.push(...labeled);
        candidates.push(C.displayText(node.innerText || node.textContent || ''));

        for (const raw of candidates) {
          let value = stopAtKnownField(cleanAuctionPart(raw));
          value = value.replace(/^(pickup|location)\s*/i, '').trim();
          if (!value || looksLikeBadAuctionValue(value) || looksLikeCloseValue(value)) continue;
          if (/\b(?:time left|current price|est\.? retail|bids?|buyer'?s? prem|place bid|min bid|used|minor damage|major damage|new)\b/i.test(value)) continue;
          if (!/[a-z]/i.test(value) || value.length > 50) continue;
          return value;
        }
        if (node === card) break;
      }
    }
    return '';
  }

  function extractAuctionIdentity(card) {
    const visibleLines = linesOf(card);
    const attrLines = attributeLinesOf(card);
    const lines = [...visibleLines, ...attrLines];
    const text = combinedTextOf(card);

    let auctionLocation = parseTextAfterLabel(card, [
      'Pickup Location', 'Pickup Site', 'Pickup At', 'Pickup', 'Auction Location', 'Warehouse', 'Facility', 'Location'
    ], {
      stop: /^\*?\s*(current|estimated|est\.?|retail|bids?|buyer|premium|closes?|closing|ends?|condition|watchlist)\b/i,
      maxWords: 10
    });

    if (!auctionLocation) {
      auctionLocation = findLabelValueFromLines(
        lines,
        /^\*?\s*(?:pickup\s+location|pickup\s+site|pickup\s+at|pickup|auction\s+location|warehouse|facility|location)\b\s*[:\-–—]?\s*/i,
        value => !looksLikeCloseValue(value)
      );
    }

    if (!auctionLocation) {
      const locationMatch = text.match(/(?:pickup\s+location|pickup\s+site|pickup\s+at|auction\s+location|warehouse|facility|location)\s*[:\-–—]\s*([A-Za-z][A-Za-z0-9 .,&'/-]{2,70})/i);
      auctionLocation = locationMatch ? stopAtKnownField(cleanAuctionPart(locationMatch[1])) : '';
    }

    if (!auctionLocation) auctionLocation = findLocationByMapPin(card);
    if (!auctionLocation) auctionLocation = findLocationFromPageUrl();
    if (looksLikeBadAuctionValue(auctionLocation) || looksLikeCloseValue(auctionLocation)) auctionLocation = '';

    let auctionEventName = parseTextAfterLabel(card, [
      'Event Name', 'Event'
    ], {
      stop: /^\*?\s*(current|estimated|est\.?|retail|bids?|buyer|premium|location|pickup|closes?|closing|ends?|condition|watchlist|event\s+type)\b/i,
      maxWords: 20
    });

    if (!auctionEventName || !looksLikeEventName(auctionEventName)) {
      const eventValue = findLabelValueFromLines(
        lines,
        /^\*?\s*(?:event\s+name|event)\b\s*[:\-–—]?\s*/i,
        looksLikeEventName
      );
      if (eventValue) auctionEventName = eventValue;
    }

    if (!auctionEventName || !looksLikeEventName(auctionEventName)) {
      auctionEventName = findPageEventForLocation(auctionLocation);
    }

    if (!looksLikeEventName(auctionEventName)) auctionEventName = '';

    let auctionClosesRaw = parseTextAfterLabel(card, [
      'Auction Closes', 'Closes At', 'Closes', 'Closing', 'Close Date', 'Close Time', 'Ends At', 'Ends', 'Ending', 'Time Left'
    ], {
      stop: /^\*?\s*(current|estimated|est\.?|retail|bids?|buyer|premium|location|pickup|condition|watchlist)\b/i,
      maxWords: 16
    });

    if (!auctionClosesRaw || !looksLikeCloseValue(auctionClosesRaw)) {
      const lineValue = findLabelValueFromLines(
        lines,
        /^\*?\s*(?:auction\s+closes|closes\s+at|closes|closing|close\s+date|close\s+time|ends\s+at|ends|ending|time\s+left)\b\s*[:\-–—]?\s*/i,
        looksLikeCloseValue
      );
      if (lineValue) auctionClosesRaw = lineValue;
    }

    if (!auctionClosesRaw || !looksLikeCloseValue(auctionClosesRaw)) {
      const closeMatch = text.match(/(?:auction\s+)?(?:closes?|closing|ends?|ending|close\s+(?:date|time)|time\s+left)\s*[:\-–—]?\s*([A-Za-z0-9,:/\- ]{4,90})(?=\s+(?:current|estimated|retail|bids?|buyer|premium|location|pickup|condition|watchlist)\b|$)/i);
      auctionClosesRaw = closeMatch ? stopAtKnownField(cleanAuctionPart(closeMatch[1])) : auctionClosesRaw;
    }

    if (!auctionClosesRaw || !looksLikeCloseValue(auctionClosesRaw)) {
      const dateFound = findDateTimeInText(text);
      if (dateFound) auctionClosesRaw = dateFound;
    }

    if (!looksLikeCloseValue(auctionClosesRaw)) auctionClosesRaw = '';
    const auctionClosesAt = C.parseAuctionCloseToIso ? C.parseAuctionCloseToIso(auctionClosesRaw) : '';
    const auctionGroupKey = C.buildAuctionGroupKey ? C.buildAuctionGroupKey(auctionLocation, auctionClosesRaw, auctionClosesAt, auctionEventName) : '';
    return { auctionEventName, auctionLocation, locationName: auctionLocation, auctionClosesRaw, auctionClosesAt, auctionGroupKey };
  }

  function getImageUrl(card, title = '') {
    const imgs = Array.from(card?.querySelectorAll?.('img') || []);
    if (!imgs.length) return '';
    const titleKey = C.normalizeText(title).slice(0, 28);
    const candidates = imgs.map(img => {
      const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
      const srcFromSet = srcset.split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean).pop() || '';
      const src = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || srcFromSet || '';
      const alt = C.displayText(img.getAttribute('alt') || '');
      const score = (alt && titleKey && C.normalizeText(alt).includes(titleKey) ? 100 : 0)
        + (src && !/^data:/i.test(src) ? 20 : 0)
        + Math.min(30, Number(img.naturalWidth || img.width || 0) / 10);
      return { src, score };
    }).filter(x => x.src && !/^data:/i.test(x.src));
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] ? C.absoluteUrl(candidates[0].src, location.href) : '';
  }

  function uniquePush(list, value) {
    const clean = C.displayText(value).toLowerCase();
    if (clean && !list.includes(clean)) list.push(clean);
  }

  function colorToRgb(value) {
    const s = String(value || '').trim().toLowerCase();
    if (!s || s === 'none' || s === 'transparent' || s === 'currentcolor') return null;
    if (/yellow|gold|amber|orange/.test(s)) return { r: 255, g: 190, b: 0 };
    const rgb = s.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)/);
    if (rgb) {
      const alpha = rgb[4] == null ? 1 : Number(rgb[4]);
      if (!Number.isFinite(alpha) || alpha <= 0.05) return null;
      return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
    }
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }
    return null;
  }

  function isYellowish(value) {
    const rgb = colorToRgb(value);
    if (!rgb) return false;
    return rgb.r >= 150 && rgb.g >= 110 && rgb.b <= 120 && rgb.r >= rgb.b + 70 && rgb.g >= rgb.b + 45;
  }

  function elementIsVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
  }

  function elementLooksLikeStar(el) {
    if (!el || !elementIsVisible(el)) return false;
    const txt = C.displayText(el.textContent || '').toLowerCase();
    const attrs = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('class') || ''} ${el.getAttribute('data-testid') || ''} ${el.getAttribute('data-icon') || ''}`.toLowerCase();
    const tag = String(el.tagName || '').toLowerCase();

    if (/^[★☆]$/.test(txt)) return true;
    if (/\b(star|rating)\b/.test(attrs)) return true;
    if ((tag === 'svg' || tag === 'path' || tag === 'polygon') && /star|rating/.test(attrs)) return true;

    // Some icon libraries render an SVG star without useful attributes. A small
    // yellow/black SVG near the condition pills is usually one of the rating icons.
    if (tag === 'svg') {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 32 && rect.height <= 32) {
        const style = getComputedStyle(el);
        const colors = [style.color, style.fill, style.stroke, el.getAttribute('fill'), el.getAttribute('stroke')];
        for (const child of Array.from(el.querySelectorAll('path,polygon,use'))) {
          colors.push(child.getAttribute('fill'), child.getAttribute('stroke'), getComputedStyle(child).fill, getComputedStyle(child).stroke);
        }
        if (colors.some(isYellowish) || colors.some(v => /black|#000|rgb\(0,\s*0,\s*0\)/i.test(String(v || '')))) return true;
      }
    }

    return false;
  }

  function starIsFilled(el) {
    const txt = C.displayText(el.textContent || '');
    if (txt === '☆') return false;

    const attrs = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('class') || ''} ${el.parentElement?.getAttribute('class') || ''}`.toLowerCase();
    if (/\b(empty|outline|outlined|inactive|disabled|off|unfilled)\b/.test(attrs)) return false;
    if (/\b(filled|active|selected|on|yellow|gold|amber)\b/.test(attrs)) return true;

    const style = getComputedStyle(el);
    const colors = [style.color, style.fill, style.stroke, el.getAttribute('fill'), el.getAttribute('stroke')];
    for (const child of Array.from(el.querySelectorAll?.('path,polygon,use') || [])) {
      colors.push(child.getAttribute('fill'), child.getAttribute('stroke'), getComputedStyle(child).fill, getComputedStyle(child).stroke);
    }
    if (colors.some(isYellowish)) return true;

    // If it is a literal filled star with no styling clue, count it as filled.
    // CSS-colored black filled stars will already be caught above as not yellow.
    if (txt === '★' && !colors.some(v => /black|#000|rgb\(0,\s*0,\s*0\)/i.test(String(v || '')))) return true;

    return false;
  }

  function ratingFromStarElements(card) {
    const candidates = Array.from(card?.querySelectorAll?.('svg,[aria-label],[title],span,i,button') || [])
      .filter(elementLooksLikeStar)
      .filter((el, idx, arr) => !arr.some(other => other !== el && other.contains(el) && elementLooksLikeStar(other)));

    if (candidates.length < 5) return null;

    // Prefer a tight run of 5 stars with similar vertical position.
    const positioned = candidates.map(el => ({ el, rect: el.getBoundingClientRect() }));
    for (let i = 0; i <= positioned.length - 5; i++) {
      const group = positioned.slice(i, i + 5);
      const avgTop = group.reduce((sum, x) => sum + x.rect.top, 0) / 5;
      const sameRow = group.every(x => Math.abs(x.rect.top - avgTop) <= 8);
      if (!sameRow) continue;
      return group.filter(x => starIsFilled(x.el)).length;
    }

    return candidates.slice(0, 5).filter(starIsFilled).length;
  }

  function ratingFromNellisStarRatingClasses(card) {
    if (!card) return null;

    // Nellis renders the card rating as five SVGs. Filled stars use a class like
    // fill-starRating-4 or fill-starRating-5; empty stars use fill-gray-900.
    // The number in fill-starRating-N is the actual condition rating.
    const ratingRoots = Array.from(card.querySelectorAll?.('[data-ax="item-card-hide-star-rating-button"], button[aria-label*="star rating" i]') || []);
    for (const root of ratingRoots) {
      const svgs = Array.from(root.querySelectorAll('svg'));
      if (!svgs.length) continue;
      const ratings = svgs.map(svg => {
        const cls = String(svg.getAttribute('class') || '');
        const match = cls.match(/fill-starRating-([0-5])\b/i);
        return match ? Number(match[1]) : null;
      }).filter(n => Number.isFinite(n));
      if (ratings.length) return Math.max(...ratings);
      if (svgs.length >= 5) return 0;
    }

    const direct = Array.from(card.querySelectorAll?.('[class*="fill-starRating-"]') || [])
      .map(el => String(el.getAttribute('class') || '').match(/fill-starRating-([0-5])\b/i))
      .filter(Boolean)
      .map(m => Number(m[1]))
      .filter(Number.isFinite);
    return direct.length ? Math.max(...direct) : null;
  }

  function extractStarRating(card) {
    const classRating = ratingFromNellisStarRatingClasses(card);
    if (classRating !== null) return Math.max(0, Math.min(5, Number(classRating) || 0));

    const text = card ? (card.innerText || card.textContent || '') : '';

    const ariaText = Array.from(card?.querySelectorAll?.('[aria-label],[title]') || [])
      .map(el => `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`)
      .join(' ');
    const aria = ariaText.match(/\b([0-5](?:\.\d+)?)\s*(?:out of|\/|of)\s*5\b/i)
      || ariaText.match(/\brating\s*:?[\s-]*([0-5](?:\.\d+)?)\b/i);
    if (aria) return Math.max(0, Math.min(5, Math.round(Number(aria[1]))));

    const elementRating = ratingFromStarElements(card);
    if (elementRating !== null) return Math.max(0, Math.min(5, Number(elementRating) || 0));

    // Handles plain text like "★★★☆☆" or "★ ★ ★ ☆ ☆".
    // This is deliberately after DOM/icon parsing because some sites render all
    // 5 stars as the same character and only use color to show the rating.
    const textStars = String(text).match(/(?:[★☆]\s*){5}/);
    if (textStars) return Array.from(textStars[0]).filter(ch => ch === '★').length;

    return null;
  }

  function extractConditionAndTags(card) {
    const text = C.normalizeText(textOf(card));
    const tags = [];
    const known = [
      'new', 'open box', 'used', 'like new', 'major damage', 'minor damage', 'damaged',
      'untested', 'not tested', 'missing parts', 'parts only', 'incomplete', 'no box',
      'open package', 'sealed', 'heavy', 'oversized', 'powers on', 'not motorized'
    ];

    const tagLines = linesOf(card).map(v => v.toLowerCase());
    for (const line of tagLines) {
      if (known.includes(line)) uniquePush(tags, line);
      const conditionLine = line.match(/^condition\s*:?\s*(.+)$/i);
      if (conditionLine && known.includes(conditionLine[1])) uniquePush(tags, conditionLine[1]);
    }

    const smallTextNodes = Array.from(card?.querySelectorAll?.('span,div,button') || [])
      .map(el => C.displayText(el.textContent || ''))
      .filter(v => v.length >= 2 && v.length <= 30);
    for (const v of smallTextNodes) {
      const low = v.toLowerCase();
      if (known.includes(low)) uniquePush(tags, low);
    }

    const rating = extractStarRating(card);
    const hasRating = rating !== null && rating !== undefined && Number.isFinite(Number(rating));
    const itemCondition = hasRating ? `${Number(rating)}/5` : '';
    const itemTags = tags.length ? tags.join('; ') : 'New';
    return { itemCondition, itemTags, conditionRating: hasRating ? Number(rating) : null };
  }

  function extractUserBidStatus(card) {
    const visibleText = textOf(card);
    const attrText = Array.from(card?.querySelectorAll?.('[aria-label],[title],button,[data-ax]') || [])
      .map(el => [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-ax'),
        el.textContent
      ].filter(Boolean).join(' '))
      .join(' ');
    const text = C.normalizeText(`${visibleText} ${attrText}`);

    const hasBid = /\b(your bid|you bid|you have bid|you ve bid|my bid|max bid|maximum bid|bid placed|bid submitted|you placed|i bid|active bid|already bid|current bid by you)\b/.test(text);
    const losing = /\b(outbid|out bid|been outbid|you ve been outbid|you have been outbid|currently losing|you are losing|you re losing|not winning|lost bid|losing bid)\b/.test(text);
    const winning = /\b(winning|you are winning|you re winning|highest bidder|high bidder|you are high bidder|you re high bidder|leading bid|currently winning)\b/.test(text);

    const amountMatch = text.match(/\b(?:your bid|max bid|maximum bid|my bid|you bid|bid placed|bid submitted)\b\s*[:\-]?\s*\$?\s*([0-9,]+(?:\.[0-9]{2})?)/i);
    const userBidAmount = amountMatch ? C.moneyToNumber(amountMatch[1]) : 0;
    if (losing) return { hasUserBid: true, userBidStatus: 'losing', userBidAmount };
    if (winning) return { hasUserBid: true, userBidStatus: 'winning', userBidAmount };
    if (hasBid) return { hasUserBid: true, userBidStatus: 'bid', userBidAmount };
    return { hasUserBid: false, userBidStatus: '', userBidAmount: 0 };
  }

  function isLikelyProductHref(href) {
    if (!href) return false;
    let url;
    try { url = new URL(href, location.href); } catch { return false; }
    if (!/nellisauction\.com$/i.test(url.hostname)) return false;

    const path = url.pathname || '';
    // Real Nellis item cards use /p/<slug>/<id>. This rejects header/footer
    // links like Go to home page, Spotlight, Accessibility, Location & Hours, etc.
    if (/^\/p\/.+\/\d+\/?$/i.test(path)) return true;

    // Tiny fallback in case they change the path but keep an item-ish route.
    if (/\/(item|product|listing)\//i.test(path) && /\d{4,}/.test(path)) return true;

    return false;
  }

  function looksLikeNavTitle(title) {
    return /^(go to home page|home|spotlight|accessibility|location & hours|estate sales|contact us|watchlist|sign in|login|privacy|terms|help)$/i.test(C.displayText(title));
  }

  function extractListingFromAnchor(a) {
    const href = a.href || '';
    if (!isLikelyProductHref(href)) return null;
    const rawTitle = C.displayText(a.getAttribute('aria-label') || a.textContent || a.querySelector('img')?.alt || '');
    let title = rawTitle.replace(/^view\s+/i, '').replace(/\s+details$/i, '').trim();
    if (title.length < 8) title = C.displayText(a.querySelector('img')?.alt || '');
    if (title.length < 8 || title.length > 260 || looksLikeNavTitle(title)) return null;

    let card = a;
    let priceCard = null;
    let starPriceCard = null;
    for (let i = 0; i < 12 && card.parentElement; i++) {
      card = card.parentElement;
      const t = textOf(card);
      const hasPriceFields = t.includes('$') && /(bid|retail|current|closes|pickup|estimated)/i.test(t);
      const hasStarRating = !!card.querySelector?.('[data-ax="item-card-hide-star-rating-button"], button[aria-label*="star rating" i]');
      const stillReasonableCard = t.length < 4500;
      if (hasPriceFields && !priceCard) priceCard = card;
      if (hasPriceFields && hasStarRating && stillReasonableCard) {
        starPriceCard = card;
        break;
      }
    }
    card = starPriceCard || priceCard || card;
    const text = textOf(card);
    const estRetail = parseMoneyAfterLabel(card, ['Estimated Retail', 'Est\\.? Retail', 'Retail']);
    let currentPrice = parseMoneyAfterLabel(card, ['Current Bid', 'Current Price', 'High Bid', 'Price']);
    const allMoney = Array.from(text.matchAll(/\$\s*[0-9,]+(?:\.\d{2})?/g)).map(m => C.moneyToNumber(m[0])).filter(n => n > 0);
    if (!currentPrice && allMoney.length) currentPrice = Math.min(...allMoney);
    const bids = parseBids(card);
    if (!currentPrice && !estRetail) return null;
    const auctionIdentity = extractAuctionIdentity(card);
    const locationName = auctionIdentity.locationName || '';
    const { itemCondition, itemTags, conditionRating } = extractConditionAndTags(card);
    const { hasUserBid, userBidStatus, userBidAmount } = extractUserBidStatus(card);
    const imageUrl = getImageUrl(card, title);
    return {
      title,
      url: href.split('#')[0],
      imageUrl,
      currentPrice,
      estRetail,
      bids,
      locationName,
      auctionEventName: auctionIdentity.auctionEventName || '',
      auctionLocation: auctionIdentity.auctionLocation || '',
      auctionClosesRaw: auctionIdentity.auctionClosesRaw || '',
      auctionClosesAt: auctionIdentity.auctionClosesAt || '',
      auctionGroupKey: auctionIdentity.auctionGroupKey || '',
      itemCondition,
      itemTags,
      conditionRating,
      hasUserBid,
      userBidStatus,
      userBidAmount,
      rawText: text.slice(0, 800)
    };
  }

  function extractListings() {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const map = new Map();
    for (const a of anchors) {
      const item = extractListingFromAnchor(a);
      if (!item) continue;
      const key = item.url || C.normalizeText(item.title);
      const old = map.get(key);
      if (!old || item.rawText.length > old.rawText.length) map.set(key, item);
    }
    return Array.from(map.values());
  }

  function findNextUrl() {
    const direct = document.querySelector('a[aria-label*="next" i][href]');
    if (direct) return direct.href;
    const rel = document.querySelector('a[rel="next"][href]');
    if (rel) return rel.href;
    const buttons = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => /next|›|»/i.test(C.displayText(a.textContent) || a.getAttribute('aria-label') || ''));
    if (buttons[0]) return buttons[0].href;
    return '';
  }

  function fingerprint(listings) {
    return listings.slice(0, 15).map(x => C.normalizeText(x.title).slice(0, 40)).join('|');
  }

  async function scanCurrentPage() {
    const data = await storageGet([C.STORAGE_KEYS.SCAN_STATE, C.STORAGE_KEYS.HISTORY, C.STORAGE_KEYS.SETTINGS]);
    const state = data[C.STORAGE_KEYS.SCAN_STATE] || {};
    const history = data[C.STORAGE_KEYS.HISTORY] || [];
    const settings = { ...C.DEFAULT_SETTINGS, ...(data[C.STORAGE_KEYS.SETTINGS] || {}) };
    if (!state.running || !location.href.includes('/search')) return;

    await C.delay(900);
    const listings = extractListings();
    const fp = fingerprint(listings);
    const alreadySeen = (state.seenFingerprints || []).includes(fp);
    if (!listings.length) {
      await chrome.runtime.sendMessage({ type: 'STOP_SCAN', reason: 'No listings found on this page.' });
      return;
    }
    if (alreadySeen) {
      await chrome.runtime.sendMessage({ type: 'STOP_SCAN', reason: 'Stopped before repeating the same page.' });
      return;
    }

    const matches = [];
    for (const listing of listings) {
      // Capture everything. History matching is just metadata/filtering now, not a scan gate.
      const best = history.length ? C.findBestHistoryMatch(listing.title, history, 1) : null;
      const hist = best ? best.history : null;
      const ratio = hist && (hist.avgCost || hist.maxCost) > 0 && listing.estRetail > 0
        ? listing.estRetail / (hist.avgCost || hist.maxCost)
        : (listing.currentPrice > 0 && listing.estRetail > 0 ? listing.estRetail / listing.currentPrice : 0);
      const fallbackScore = Math.round((ratio || 0) * 1000 + Number(listing.estRetail || 0) + Math.max(0, 100 - Number(listing.bids || 0)) * 10);
      const score = hist ? C.rankMatch(listing, hist, best.quality) : fallbackScore;
      matches.push({
        ...listing,
        score,
        ratio,
        quality: best ? best.quality : 0,
        matchName: hist ? hist.productName : '',
        purchaseCount: hist ? (hist.purchaseCount || 0) : 0,
        returnCount: hist ? (hist.returnCount || 0) : 0,
        avgCost: hist ? (hist.avgCost || 0) : 0,
        maxCost: hist ? (hist.maxCost || 0) : 0,
        receiptNumbers: hist ? (hist.receiptNumbers || []).slice(0, 8).join('; ') : '',
        foundAt: new Date().toISOString(),
        pageUrl: location.href,
        dedupeKey: listing.url || `${C.compactTitleKey(listing.title)}|${listing.currentPrice}`
      });
    }

    await chrome.runtime.sendMessage({
      type: 'PAGE_SCANNED',
      url: location.href,
      fingerprint: fp,
      listingsSeen: listings.length,
      matches,
      lastMessage: `Captured ${matches.length} of ${listings.length} listings on this page.`
    });

    const fresh = await storageGet([C.STORAGE_KEYS.SCAN_STATE]);
    const freshState = fresh[C.STORAGE_KEYS.SCAN_STATE] || {};
    if (!freshState.running) return;
    if (Number(freshState.pagesScanned || 0) >= Number(settings.maxPages || 100)) {
      await chrome.runtime.sendMessage({ type: 'STOP_SCAN', reason: `Hit max page safety stop (${settings.maxPages}).` });
      return;
    }
    const next = findNextUrl();
    if (!next || next === location.href) {
      await chrome.runtime.sendMessage({ type: 'STOP_SCAN', reason: 'No next page found.' });
      return;
    }
    await C.delay(C.getSpeedDelay(settings.speedMode, 'scan-page'));
    const finalCheck = await storageGet([C.STORAGE_KEYS.SCAN_STATE]);
    if ((finalCheck[C.STORAGE_KEYS.SCAN_STATE] || {}).running) location.href = next;
  }

  scanCurrentPage().catch(err => chrome.runtime.sendMessage({ type: 'STOP_SCAN', reason: `Scanner error: ${err.message || err}` }));
})();
