const C = window.NellisCommon;
const versionBadge = document.getElementById('popupVersionBadge');
if (versionBadge) versionBadge.textContent = `v${C.APP_VERSION || 'unknown'}`;
let selectedCsvFile = null;
let importingCsv = false;
let selectedBackupFile = null;

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function loadUi() {
  if (importingCsv) return;
  const data = await chrome.storage.local.get([C.STORAGE_KEYS.SETTINGS, C.STORAGE_KEYS.HISTORY_META, C.STORAGE_KEYS.SCAN_STATE]);
  const settings = { ...C.DEFAULT_SETTINGS, ...(data[C.STORAGE_KEYS.SETTINGS] || {}) };
  document.getElementById('speedMode').value = settings.speedMode;
  const maxPagesEl = document.getElementById('maxPages');
  if (document.activeElement !== maxPagesEl) maxPagesEl.value = settings.maxPages;
  const meta = data[C.STORAGE_KEYS.HISTORY_META];
  document.getElementById('importStatus').textContent = meta
    ? `${meta.uniqueNames} unique names, ${meta.positiveRows} purchases, ${meta.refundedRows} returns/refunds.`
    : 'Purchase history is optional. Without it, quality shows as none.';
  renderState(data[C.STORAGE_KEYS.SCAN_STATE]);
  refreshTeamStatus();
}

function renderState(state = {}) {
  document.getElementById('runStatus').textContent = state.running ? `Running: ${state.lastMessage || ''}` : (state.lastMessage || 'Idle');
  document.getElementById('runCounts').textContent = `Pages ${state.pagesScanned || 0} | Seen ${state.listingsSeen || 0} | Captured ${state.matchesFound || 0}`;
}

async function saveSettings() {
  const settings = {
    ...(await chrome.storage.local.get([C.STORAGE_KEYS.SETTINGS]))[C.STORAGE_KEYS.SETTINGS],
    speedMode: document.getElementById('speedMode').value,
    maxPages: Math.max(1, Math.min(99999, parseInt(String(document.getElementById('maxPages').value || '100').replace(/\D+/g, ''), 10) || 100)),
    teamDeviceName: document.getElementById('teamDeviceName')?.value || ''
  };
  await chrome.storage.local.set({ [C.STORAGE_KEYS.SETTINGS]: settings });
}


function setTeamStatus(message, isError = false) {
  const el = document.getElementById('teamStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('warn', !!isError);
}

async function refreshTeamStatus() {
  try {
    const data = await chrome.storage.local.get([C.STORAGE_KEYS.SETTINGS, C.STORAGE_KEYS.TEAM_SYNC_STATE]);
    const settings = { ...C.DEFAULT_SETTINGS, ...(data[C.STORAGE_KEYS.SETTINGS] || {}) };
    const deviceEl = document.getElementById('teamDeviceName');
    if (deviceEl && document.activeElement !== deviceEl) deviceEl.value = settings.teamDeviceName || '';
    const status = await C.teamStatus();
    if (!status.signedIn) {
      setTeamStatus('Not signed in. Sign in as Trey/admin before shared sync.');
      return;
    }
    const p = status.profile || {};
    const sync = data[C.STORAGE_KEYS.TEAM_SYNC_STATE] || {};
    const last = sync.syncedAt ? ` Last sync: ${new Date(sync.syncedAt).toLocaleString()}.` : '';
    const restored = sync.restoredMissing || (sync.lastAutoReconcile && sync.lastAutoReconcile.restored) || 0;
    const auto = sync.autoSyncedAt ? ` Auto: ${new Date(sync.autoSyncedAt).toLocaleString()} pulled ${(sync.lastAutoPull && sync.lastAutoPull.pulled) || sync.autoPulled || 0}, restored ${restored}, pruned ${sync.prunedHidden || 0}, pushed ${sync.autoPushed || 0}, skipped ${sync.autoSkipped || 0}.` : ' Auto sync: on.';
    setTeamStatus(`Signed in as ${p.display_name || p.email || 'user'} (${p.role || 'user'}).${last}${auto}`);
  } catch (err) {
    setTeamStatus(`Team status failed: ${err.message || err}`, true);
  }
}

async function saveTeamDeviceName() {
  const data = await chrome.storage.local.get([C.STORAGE_KEYS.SETTINGS]);
  const settings = { ...C.DEFAULT_SETTINGS, ...(data[C.STORAGE_KEYS.SETTINGS] || {}) };
  settings.teamDeviceName = document.getElementById('teamDeviceName')?.value || '';
  await chrome.storage.local.set({ [C.STORAGE_KEYS.SETTINGS]: settings });
}

async function teamSignInFromPopup() {
  try {
    setTeamStatus('Signing in...');
    await saveTeamDeviceName();
    const email = document.getElementById('teamEmail').value.trim();
    const password = document.getElementById('teamPassword').value;
    const { profile } = await C.teamSignIn(email, password);
    document.getElementById('teamPassword').value = '';
    setTeamStatus(`Signed in as ${profile.display_name || profile.email} (${profile.role}).`);
  } catch (err) {
    setTeamStatus(`Sign in failed: ${err.message || err}`, true);
  }
}

async function teamSignOutFromPopup() {
  try {
    await C.teamSignOut();
    setTeamStatus('Signed out.');
  } catch (err) {
    setTeamStatus(`Sign out failed: ${err.message || err}`, true);
  }
}

async function teamAutoSyncNowFromPopup() {
  try {
    setTeamStatus('Running quiet auto sync now...');
    await saveTeamDeviceName();
    const response = await chrome.runtime.sendMessage({
      type: 'TEAM_SILENT_SYNC_NOW',
      reason: 'popup-button',
      forceReconcile: true,
      restoreMissing: true,
      forceFullPull: true
    });
    if (!response || response.ok === false) throw new Error(response?.error || 'Auto sync failed.');
    const result = response.result || {};
    const pull = result.pull || {};
    const reconcile = result.reconcile || {};
    setTeamStatus(`Auto sync complete. Pulled ${pull.pulled || 0}, restored ${reconcile.restored || 0}, pruned ${reconcile.pruned || 0}, local total ${reconcile.localTotal || pull.localTotal || 0}.`);
  } catch (err) {
    setTeamStatus(`Auto sync failed: ${err.message || err}`, true);
  }
}

async function getLocalRowsForTeamSync() {
  const data = await chrome.storage.local.get([C.STORAGE_KEYS.MATCHES, C.STORAGE_KEYS.SETTINGS]);
  const settings = { ...C.DEFAULT_SETTINGS, ...(data[C.STORAGE_KEYS.SETTINGS] || {}) };
  return { rows: data[C.STORAGE_KEYS.MATCHES] || [], settings };
}

async function teamSyncNowFromPopup() {
  try {
    setTeamStatus('Syncing local captured listings to shared database...');
    await saveTeamDeviceName();
    const { rows, settings } = await getLocalRowsForTeamSync();
    const result = await C.teamSyncListings(rows, settings.teamDeviceName || 'popup');
    setTeamStatus(`Sync complete. New ${result.full || 0}, price/bid updates ${result.live || 0}, skipped ${result.skipped || 0}, pulled ${result.pulled || 0}, local total ${result.localTotal}.`);
    renderState((await chrome.storage.local.get([C.STORAGE_KEYS.SCAN_STATE]))[C.STORAGE_KEYS.SCAN_STATE]);
  } catch (err) {
    setTeamStatus(`Sync failed: ${err.message || err}`, true);
  }
}

async function teamPullNowFromPopup() {
  try {
    setTeamStatus('Pulling shared listings...');
    const pulled = await C.teamPullListings();
    const merged = await C.teamMergeRowsIntoLocal(pulled, { pruneMissingShared: true });
    const now = new Date().toISOString();
    const sync = { pulled: pulled.length, localTotal: merged.length, syncedAt: now, lastPullAt: now };
    await chrome.storage.local.set({ [C.STORAGE_KEYS.TEAM_SYNC_STATE]: sync });
    setTeamStatus(`Pulled ${pulled.length} shared listings. Pruned ${merged.teamPruned || 0} hidden/missing shared rows. Local total ${merged.length}.`);
  } catch (err) {
    setTeamStatus(`Pull failed: ${err.message || err}`, true);
  }
}

function setBackupStatus(message, isError = false) {
  const el = document.getElementById('backupStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('warn', !!isError);
}

async function exportFullBackupFromPopup() {
  try {
    const backup = await C.exportFullBackup('manual-popup');
    setBackupStatus(`Exported full backup at ${backup.createdAt}.`);
  } catch (err) {
    setBackupStatus(`Backup failed: ${err.message || err}`, true);
  }
}

async function restoreSelectedBackupFromPopup() {
  try {
    if (!selectedBackupFile) {
      setBackupStatus('Choose a backup JSON file first.', true);
      return;
    }
    const backup = await C.readBackupFile(selectedBackupFile);
    const created = backup.createdAt || 'unknown date';
    if (!confirm(`Restore backup from ${created}? This REPLACES current extension data.`)) return;
    const result = await C.restoreFullBackup(backup, 'replace');
    selectedBackupFile = null;
    const fileInput = document.getElementById('backupFile');
    if (fileInput) fileInput.value = '';
    setBackupStatus(`Restored backup. ${result.restoredKeys} storage bucket(s) replaced.`);
    await loadUi();
  } catch (err) {
    setBackupStatus(`Restore failed: ${err.message || err}`, true);
  }
}

async function importCsvFile(file) {
  if (!file) throw new Error('No CSV file selected.');
  importingCsv = true;
  const status = document.getElementById('importStatus');
  try {
    status.textContent = `Importing ${file.name}...`;
    const text = await file.text();
    const rawRows = C.parseCsv(text);
    if (!rawRows.length) throw new Error('CSV had no data rows.');
    const { history, meta } = C.buildPurchaseHistory(rawRows);
    if (!history.length) {
      throw new Error('CSV parsed, but no usable Product Name rows were found. Export receipts again or check the header row.');
    }
    await chrome.storage.local.set({
      [C.STORAGE_KEYS.HISTORY]: history,
      [C.STORAGE_KEYS.HISTORY_META]: meta
    });
    status.textContent = `Imported ${file.name}: ${meta.uniqueNames} unique names, ${meta.positiveRows} purchases, ${meta.refundedRows} returns/refunds.`;
    renderState((await chrome.storage.local.get([C.STORAGE_KEYS.SCAN_STATE]))[C.STORAGE_KEYS.SCAN_STATE]);
  } finally {
    importingCsv = false;
  }
}

async function importSelectedCsv() {
  try { await importCsvFile(selectedCsvFile); }
  catch (err) { document.getElementById('importStatus').textContent = `Import failed: ${err.message || err}`; }
}

document.getElementById('csvFile').addEventListener('change', async e => {
  selectedCsvFile = e.target.files && e.target.files[0];
  if (!selectedCsvFile) return;
  await importSelectedCsv();
});

document.getElementById('importBtn').addEventListener('click', importSelectedCsv);
document.getElementById('exportBackupBtn')?.addEventListener('click', exportFullBackupFromPopup);
document.getElementById('backupFile')?.addEventListener('change', e => {
  selectedBackupFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
  setBackupStatus(selectedBackupFile ? `Selected backup file: ${selectedBackupFile.name}` : 'No backup file selected.');
});
document.getElementById('restoreBackupBtn')?.addEventListener('click', restoreSelectedBackupFromPopup);
document.getElementById('teamSignInBtn').addEventListener('click', teamSignInFromPopup);
document.getElementById('teamSignOutBtn').addEventListener('click', teamSignOutFromPopup);
document.getElementById('teamAutoSyncNowBtn')?.addEventListener('click', teamAutoSyncNowFromPopup);
document.getElementById('teamSyncBtn')?.addEventListener('click', teamSyncNowFromPopup);
document.getElementById('teamPullBtn')?.addEventListener('click', teamPullNowFromPopup);
document.getElementById('teamDeviceName').addEventListener('change', saveTeamDeviceName);
document.getElementById('teamPassword').addEventListener('keydown', e => { if (e.key === 'Enter') teamSignInFromPopup(); });

document.getElementById('speedMode').addEventListener('change', saveSettings);
let maxPagesSaveTimer = null;
document.getElementById('maxPages').addEventListener('input', () => {
  clearTimeout(maxPagesSaveTimer);
  maxPagesSaveTimer = setTimeout(saveSettings, 350);
});
document.getElementById('maxPages').addEventListener('blur', saveSettings);

document.getElementById('receiptBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('receipts.html') });
});

document.getElementById('dashboardBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

document.getElementById('clearBtn').addEventListener('click', async () => {
  await C.createInternalBackup('pre-forget-captured-popup');
  await chrome.storage.local.set({ [C.STORAGE_KEYS.MATCHES]: [] });
  const state = { running: false, pagesScanned: 0, listingsSeen: 0, matchesFound: 0, lastMessage: 'Forgot captured listings. Saved not-wanted rules and saved filters were kept.' };
  await chrome.storage.local.set({ [C.STORAGE_KEYS.SCAN_STATE]: state });
  renderState(state);
});

document.getElementById('stopBtn').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'STOP_SCAN', reason: 'Stopped by user.' });
  renderState(res.state);
});

document.getElementById('startBtn').addEventListener('click', async () => {
  await saveSettings();
  const tab = await getActiveTab();
  if (!tab || !tab.url || !tab.url.includes('nellisauction.com/search')) {
    document.getElementById('runStatus').textContent = 'Open a Nellis search page first.';
    return;
  }
  const res = await chrome.runtime.sendMessage({ type: 'START_SCAN', url: tab.url });
  renderState(res.state);
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  await chrome.tabs.reload(tab.id);
});

loadUi();
setInterval(loadUi, 1500);
