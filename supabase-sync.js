// CHARANAS ANALYZER - SUPABASE SYNC ADAPTER

var SUPABASE_URL      = 'https://oqeevttwdhvosdjypslg.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_AB18dOT-C73q1XDkeEJMkg_DJrI7_yn';

var SYNC_INTERVAL_MS  = 45000;
var WRITE_DEBOUNCE_MS = 800;
// Keys that must NEVER be read from or written to Supabase.
// Auth/credential keys are local-only so that data from other users or other
// devices cannot overwrite the locally-established platform account or school list.
var LOCAL_ONLY_KEYS = [
  'ei_dark', 'ei_lang', 'ei_session_user', 'ei_session_school_id',
  // ── Auth / credentials ── (must stay local; syncing these causes cross-user login failures)
  'ei_platform_creds',    // platform admin username + password
  'ei_platform_schools',  // list of all registered school accounts
  'ei_saved_login',       // remembered username/password for auto-fill
  'ei_platform_broadcast' // broadcast message (platform-specific)
];

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
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timeoutId = controller ? setTimeout(function() { controller.abort(); }, 10000) : null;
  return fetch(SB_ENDPOINT + '?select=key,value', {
    method: 'GET',
    headers: sbHeaders(),
    mode: 'cors',
    signal: controller ? controller.signal : undefined
  }).then(function(res) {
    if (timeoutId) clearTimeout(timeoutId);
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    return res.json();
  }).catch(function(err) {
    if (timeoutId) clearTimeout(timeoutId);
    throw err;
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
  // Lightweight non-blocking indicator: a small spinner badge in the corner.
  // This keeps the login form fully visible and interactive.
  var el = document.createElement('div');
  el.id = 'sb-loader';
  el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,.85);backdrop-filter:blur(6px);color:#94a3b8;font-size:.75rem;padding:6px 14px 6px 10px;border-radius:999px;z-index:99999;font-family:system-ui,sans-serif;display:flex;align-items:center;gap:7px;pointer-events:none;';
  el.innerHTML = '<style>@keyframes sbspin{to{transform:rotate(360deg)}}</style>'
    + '<div style="width:13px;height:13px;border:2px solid #334155;border-top-color:#7c3aed;border-radius:50%;animation:sbspin .7s linear infinite;flex-shrink:0"></div>'
    + '<span id="sb-status">Syncing data…</span>';
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

  // Also pulse the Sign In button to signal "loading" before user interacts
  var btn = document.getElementById('uniBtn');
  var btnOrigHTML = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:.4rem"></i>Loading…';
  }

  function restoreBtn() {
    if (btn) { btn.disabled = false; btn.innerHTML = btnOrigHTML; }
  }

  // Safety net: unblock after 12 seconds no matter what
  var safetyTimer = setTimeout(function() {
    if (!dbReady) {
      console.warn('[SupaSync] Safety timeout hit — unblocking app');
      document.addEventListener = _origAEL;
      dbReady = true;
      if (loader.parentNode) loader.remove();
      restoreBtn();
      domQueue.forEach(function(fn) { try { fn(); } catch(e) { console.error(e); } });
    }
  }, 12000);

  sbFetchAll().then(function(rows) {
    setStatus('Syncing ' + rows.length + ' records…');
    rows.forEach(function(row) {
      if (!isLocalOnly(row.key)) { _lsSet(row.key, row.value); lastPollKeys[row.key] = true; }
    });
    console.log('[SupaSync] Loaded ' + rows.length + ' keys');
  }).catch(function(err) {
    console.error('[SupaSync] Failed:', err);
    setStatus('Offline — using local data');
    return new Promise(function(r) { setTimeout(r, 500); });
  }).then(function() {
    clearTimeout(safetyTimer);
    document.addEventListener = _origAEL;
    dbReady = true;
    loader.remove();
    restoreBtn();
    domQueue.forEach(function(fn) { try { fn(); } catch(e) { console.error(e); } });
    setInterval(pollRemote, SYNC_INTERVAL_MS);
  });
}

_origAEL('DOMContentLoaded', sbInit, { once: true });
