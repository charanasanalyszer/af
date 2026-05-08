// CHARANAS ANALYZER - SUPABASE SYNC ADAPTER

var SUPABASE_URL      = 'https://oqeevttwdhvosdjypslg.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_AB18dOT-C73q1XDkeEJMkg_DJrI7_yn';

var SYNC_INTERVAL_MS  = 45000;
var WRITE_DEBOUNCE_MS = 800;
var LOCAL_ONLY_KEYS   = ['ei_dark','ei_lang','ei_session_user','ei_session_school_id'];

function isLocalOnly(key) { return LOCAL_ONLY_KEYS.indexOf(key) !== -1; }

var _lsSet    = localStorage.setItem.bind(localStorage);
var _lsGet    = localStorage.getItem.bind(localStorage);
var _lsRemove = localStorage.removeItem.bind(localStorage);
var _origAEL  = document.addEventListener.bind(document);

var domQueue = [];
var dbReady  = false;

document.addEventListener = function(type, fn, opts) {
  if (type === 'DOMContentLoaded' && !dbReady) { domQueue.push(fn); }
  else { _origAEL(type, fn, opts); }
};

var pendingWrites = {};
var writeTimer    = null;

localStorage.setItem = function(key, value) {
  _lsSet(key, value);
  if (!isLocalOnly(key)) {
    pendingWrites[key] = { action: 'set', value: value };
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushWrites, WRITE_DEBOUNCE_MS);
  }
};

localStorage.removeItem = function(key) {
  _lsRemove(key);
  if (!isLocalOnly(key)) {
    pendingWrites[key] = { action: 'delete' };
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushWrites, WRITE_DEBOUNCE_MS);
  }
};

localStorage.clear = function() {
  console.warn('[SupaSync] clear() blocked.');
};

var SB_ENDPOINT = SUPABASE_URL + '/rest/v1/kv_store';

function sbHeaders(extra) {
  var h = {
    'Content-Type' : 'application/json',
    'apikey'       : SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
  };
  if (extra) { Object.keys(extra).forEach(function(k){ h[k]=extra[k]; }); }
  return h;
}

function sbFetchAll() {
  return fetch(SB_ENDPOINT + '?select=key,value', {
    method: 'GET',
    headers: sbHeaders(),
    mode: 'cors'
  }).then(function(res) {
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    return res.json();
  });
}

function sbUpsert(rows) {
  if (!rows.length) return Promise.resolve();
  return fetch(SB_ENDPOINT, {
    method: 'POST',
    headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
    mode: 'cors',
    body: JSON.stringify(rows)
  }).then(function(res) {
    if (!res.ok) console.error('[SupaSync] Upsert failed:', res.status);
  });
}

function sbDelete(key) {
  return fetch(SB_ENDPOINT + '?key=eq.' + encodeURIComponent(key), {
    method: 'DELETE',
    headers: sbHeaders(),
    mode: 'cors'
  });
}

function flushWrites() {
  var batch = pendingWrites;
  pendingWrites = {};
  var upserts = [];
  var deletes = [];
  Object.keys(batch).forEach(function(key) {
    if (batch[key].action === 'set') upserts.push({ key: key, value: batch[key].value });
    else deletes.push(key);
  });
  sbUpsert(upserts).catch(function(e) { console.error('[SupaSync] write error', e); });
  deletes.forEach(function(k) { sbDelete(k); });
}

var lastPollKeys = {};
function pollRemote() {
  sbFetchAll().then(function(rows) {
    var changed = 0;
    var rowMap = {};
    rows.forEach(function(row) {
      if (isLocalOnly(row.key)) return;
      rowMap[row.key] = true;
      if (_lsGet(row.key) !== row.value) { _lsSet(row.key, row.value); changed++; }
    });
    Object.keys(lastPollKeys).forEach(function(key) {
      if (!rowMap[key] && !isLocalOnly(key)) { _lsRemove(key); delete lastPollKeys[key]; changed++; }
    });
    lastPollKeys = rowMap;
    if (changed > 0) { console.log('[SupaSync] ' + changed + ' change(s) synced'); showSyncBadge(); }
  }).catch(function(e) { console.warn('[SupaSync] poll error', e.message); });
}

function buildLoader() {
  var el = document.createElement('div');
  el.id = 'sb-loader';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;font-family:system-ui,sans-serif;color:#fff;';
  el.innerHTML = '<style>@keyframes sbspin{to{transform:rotate(360deg)}}</style>'
    + '<div style="width:36px;height:36px;border:3px solid #334155;border-top-color:#7c3aed;border-radius:50%;animation:sbspin .75s linear infinite;margin-bottom:16px;"></div>'
    + '<p style="font-size:.9rem;color:#94a3b8;margin:0;">Connecting to database...</p>'
    + '<p id="sb-status" style="font-size:.75rem;color:#475569;margin:6px 0 0;">Loading your data</p>';
  return el;
}

function setStatus(msg) { var e = document.getElementById('sb-status'); if (e) e.textContent = msg; }

function showSyncBadge() {
  var b = document.getElementById('sb-badge');
  if (!b) {
    b = document.createElement('div');
    b.id = 'sb-badge';
    b.style.cssText = 'position:fixed;bottom:18px;right:18px;background:#1e293b;color:#7c3aed;font-size:.75rem;padding:6px 14px;border-radius:999px;z-index:9999;font-family:system-ui,sans-serif;';
    document.body.appendChild(b);
  }
  b.textContent = 'Synced from another device - reload to see changes';
}

function sbInit() {
  var loader = buildLoader();
  document.body.appendChild(loader);
  setStatus('Fetching from Supabase...');

  sbFetchAll().then(function(rows) {
    setStatus('Loading ' + rows.length + ' records...');
    rows.forEach(function(row) {
      if (!isLocalOnly(row.key)) { _lsSet(row.key, row.value); lastPollKeys[row.key] = true; }
    });
    console.log('[SupaSync] Loaded ' + rows.length + ' keys');
  }).catch(function(err) {
    console.error('[SupaSync] Failed:', err);
    setStatus('Cannot reach database - using local data');
    return new Promise(function(r) { setTimeout(r, 1500); });
  }).then(function() {
    document.addEventListener = _origAEL;
    dbReady = true;
    loader.remove();
    domQueue.forEach(function(fn) { try { fn(); } catch(e) { console.error(e); } });
    setInterval(pollRemote, SYNC_INTERVAL_MS);
  });
}

_origAEL('DOMContentLoaded', sbInit, { once: true });
