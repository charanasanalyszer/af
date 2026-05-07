/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          CHARANAS ANALYZER — SUPABASE SYNC ADAPTER          ║
 * ║  Drop-in backend for localStorage — zero changes to app     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * HOW TO USE:
 *   1. Replace YOUR_SUPABASE_URL and YOUR_SUPABASE_ANON_KEY below
 *   2. Add this script to index.html BEFORE script.js (no defer):
 *        <script src="supabase-sync.js"></script>
 *        <script src="script.js" defer></script>
 *
 * WHAT THIS DOES:
 *   • On startup  → loads all data from Supabase into localStorage
 *   • On any write → syncs to Supabase automatically (batched)
 *   • Every 45 sec → polls for changes made on other devices
 *   • All existing app code works unchanged
 */

(function () {
  'use strict';

  /* ─────────────────── CONFIGURATION ─────────────────── */
  const SUPABASE_URL     = 'YOUR_SUPABASE_URL';       https://oqeevttwdhvosdjypslg.supabase.co/rest/v1/
  const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // your project's anon/public key
  const SYNC_INTERVAL_MS  = 45_000; // poll for remote changes every 45 seconds
  const WRITE_DEBOUNCE_MS = 800;    // batch writes within 800ms into one request

  /* ─────────────────── SKIP LIST ─────────────────── */
  // Keys that should stay local-only (UI state, not data)
  const LOCAL_ONLY_KEYS = new Set([
    'ei_dark', 'ei_lang', 'ei_saved_login', 'ei_session_user',
    'ei_session_school_id',
  ]);

  /* ─────────────────── INTERNALS ─────────────────── */
  const _lsSet    = localStorage.setItem.bind(localStorage);
  const _lsGet    = localStorage.getItem.bind(localStorage);
  const _lsRemove = localStorage.removeItem.bind(localStorage);
  const _origAEL  = document.addEventListener.bind(document);

  const headers = {
    'Content-Type' : 'application/json',
    'apikey'       : SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  };
  const endpoint = `${SUPABASE_URL}/rest/v1/kv_store`;

  /* ── Queue DOMContentLoaded handlers until DB data is ready ── */
  const domQueue   = [];
  let   dbReady    = false;

  document.addEventListener = function (type, fn, opts) {
    if (type === 'DOMContentLoaded' && !dbReady) {
      domQueue.push(fn);
    } else {
      _origAEL(type, fn, opts);
    }
  };

  /* ── localStorage patching ── */
  let   pendingWrites = {};
  let   writeTimer    = null;

  localStorage.setItem = function (key, value) {
    _lsSet(key, value);
    if (!LOCAL_ONLY_KEYS.has(key)) {
      pendingWrites[key] = { action: 'set', value };
      clearTimeout(writeTimer);
      writeTimer = setTimeout(flushWrites, WRITE_DEBOUNCE_MS);
    }
  };

  localStorage.removeItem = function (key) {
    _lsRemove(key);
    if (!LOCAL_ONLY_KEYS.has(key)) {
      pendingWrites[key] = { action: 'delete' };
      clearTimeout(writeTimer);
      writeTimer = setTimeout(flushWrites, WRITE_DEBOUNCE_MS);
    }
  };

  localStorage.clear = function () {
    // Prevent accidental wipe of remote DB — use removeItem per key instead
    console.warn('[SupaSync] localStorage.clear() blocked to protect remote data.');
  };

  /* ─────────────────── SUPABASE API ─────────────────── */

  async function fetchAll() {
    const res = await fetch(`${endpoint}?select=key,value`, { headers });
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
    return res.json(); // [{key, value}, ...]
  }

  async function upsertRows(rows) {
    if (!rows.length) return;
    const res = await fetch(endpoint, {
      method : 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
      body   : JSON.stringify(rows),
    });
    if (!res.ok) console.error('[SupaSync] Upsert failed:', res.status, await res.text());
  }

  async function deleteKey(key) {
    const res = await fetch(
      `${endpoint}?key=eq.${encodeURIComponent(key)}`,
      { method: 'DELETE', headers }
    );
    if (!res.ok) console.error('[SupaSync] Delete failed:', res.status);
  }

  /* ─────────────────── WRITE FLUSH ─────────────────── */

  async function flushWrites() {
    const batch = pendingWrites;
    pendingWrites = {};

    const upserts = [];
    const deletes = [];

    for (const [key, op] of Object.entries(batch)) {
      if (op.action === 'set')    upserts.push({ key, value: op.value });
      else                         deletes.push(key);
    }

    try {
      await upsertRows(upserts);
      for (const k of deletes) await deleteKey(k);
    } catch (err) {
      console.error('[SupaSync] Flush error:', err);
      // Re-queue failed writes
      for (const [k, op] of Object.entries(batch)) {
        if (!pendingWrites[k]) pendingWrites[k] = op;
      }
    }
  }

  /* ─────────────────── REMOTE POLL (cross-device sync) ─────────────────── */

  let lastPollKeys = {};

  async function pollRemote() {
    try {
      const rows = await fetchAll();
      let changed = 0;

      for (const row of rows) {
        if (LOCAL_ONLY_KEYS.has(row.key)) continue;
        const current = _lsGet(row.key);
        if (current !== row.value) {
          _lsSet(row.key, row.value);
          changed++;
        }
        lastPollKeys[row.key] = true;
      }

      // Detect remote deletes
      for (const key of Object.keys(lastPollKeys)) {
        if (!rows.find(r => r.key === key) && !LOCAL_ONLY_KEYS.has(key)) {
          _lsRemove(key);
          delete lastPollKeys[key];
          changed++;
        }
      }

      if (changed > 0) {
        console.log(`[SupaSync] Synced ${changed} remote change(s)`);
        // Soft-reload UI sections that read from localStorage on demand
        // (Most sections re-read on navigation — full reload only if needed)
        showSyncBadge();
      }
    } catch (err) {
      console.warn('[SupaSync] Poll error:', err.message);
    }
  }

  /* ─────────────────── UI HELPERS ─────────────────── */

  function buildLoader() {
    const el = document.createElement('div');
    el.id = 'sb-loader';
    Object.assign(el.style, {
      position       : 'fixed',
      inset          : '0',
      background     : '#0f172a',
      display        : 'flex',
      flexDirection  : 'column',
      alignItems     : 'center',
      justifyContent : 'center',
      zIndex         : '99999',
      fontFamily     : 'Outfit, system-ui, sans-serif',
      color          : '#fff',
    });
    el.innerHTML = `
      <style>
        @keyframes sb-spin { to { transform: rotate(360deg); } }
        @keyframes sb-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
      </style>
      <div style="
        width:52px; height:52px; border-radius:14px;
        background:linear-gradient(135deg,#7c3aed,#1a6fb5);
        display:flex; align-items:center; justify-content:center;
        font-size:1.3rem; font-weight:800; margin-bottom:20px;
        animation: sb-fade .4s ease both;
      ">CA</div>
      <div style="
        width:36px; height:36px; border:3px solid #334155;
        border-top-color:#7c3aed; border-radius:50%;
        animation: sb-spin .75s linear infinite; margin-bottom:16px;
      "></div>
      <p style="font-size:.9rem; color:#94a3b8; margin:0; animation:sb-fade .5s .1s ease both;">
        Connecting to database…
      </p>
      <p id="sb-status" style="font-size:.75rem; color:#475569; margin:6px 0 0; animation:sb-fade .5s .2s ease both;">
        Loading your data
      </p>
    `;
    return el;
  }

  function setLoaderStatus(msg) {
    const el = document.getElementById('sb-status');
    if (el) el.textContent = msg;
  }

  function showSyncBadge() {
    let badge = document.getElementById('sb-sync-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'sb-sync-badge';
      Object.assign(badge.style, {
        position   : 'fixed',
        bottom     : '18px',
        right      : '18px',
        background : '#1e293b',
        color      : '#7c3aed',
        fontSize   : '.75rem',
        padding    : '6px 14px',
        borderRadius: '999px',
        border     : '1px solid #334155',
        zIndex     : '9999',
        fontFamily : 'system-ui, sans-serif',
        boxShadow  : '0 4px 12px rgba(0,0,0,.4)',
        transition : 'opacity .4s',
      });
      document.body.appendChild(badge);
    }
    badge.textContent = '⟳ Synced from another device — reload to see changes';
    badge.style.opacity = '1';
    setTimeout(() => { badge.style.opacity = '0'; }, 5000);
  }

  /* ─────────────────── BOOT ─────────────────── */

  async function init() {
    // Append loader to body (body exists since we wait for DOMContentLoaded)
    const loader = buildLoader();
    document.body.appendChild(loader);

    try {
      setLoaderStatus('Fetching data from Supabase…');
      const rows = await fetchAll();

      setLoaderStatus(`Loading ${rows.length} records…`);
      for (const row of rows) {
        if (!LOCAL_ONLY_KEYS.has(row.key)) {
          _lsSet(row.key, row.value);
          lastPollKeys[row.key] = true;
        }
      }

      console.log(`[SupaSync] ✓ Loaded ${rows.length} keys from Supabase`);
    } catch (err) {
      console.error('[SupaSync] Failed to load from Supabase:', err);
      setLoaderStatus('⚠ Could not reach database — running from local cache');
      await new Promise(r => setTimeout(r, 1800)); // show error briefly
    }

    // Restore normal addEventListener and fire queued handlers
    document.addEventListener = _origAEL;
    dbReady = true;

    loader.remove();

    // Fire all queued DOMContentLoaded handlers
    for (const fn of domQueue) {
      try { fn(); } catch (e) { console.error('[SupaSync] Handler error:', e); }
    }

    // Start background polling for cross-device sync
    setInterval(pollRemote, SYNC_INTERVAL_MS);
  }

  // Kick off after DOM is available
  _origAEL('DOMContentLoaded', init, { once: true });

})();
