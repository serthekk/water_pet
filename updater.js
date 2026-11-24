'use strict';
// WaterCat updater (main process). main.js creates it inside app.whenReady() ONLY.
//
// Gaming-safe rules:
//  - checks quietly 30 s after start, then every 6 h (not while a reminder / alarm is
//    up; it retries a few minutes later); downloads in the background;
//  - NEVER restarts the app by itself: an update installs when she quits the app, or
//    when she clicks "Restart to update";
//  - never shows an error popup, never throws: every failure is logged and retried at the
//    next interval;
//  - one quiet speech bubble when an update is ready (not in quiet hours, not while the
//    cat sleeps, not over a fullscreen game). The menus always show it.
// Security: update info only comes from github.com/serthekk/water_pet (installer:
// electron-updater with a fixed GitHub feed; portable: the GitHub API, and only release
// pages of this repo are opened). No token is used or stored.

const OWNER = 'serthekk';
const REPO = 'water_pet';
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases`;
const API = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;

const FIRST_CHECK_MS = 30 * 1000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const BUSY_RETRY_MS = 5 * 60 * 1000;
const ANNOUNCE_RETRY_MS = 10 * 60 * 1000;
const API_TIMEOUT_MS = 10 * 1000;
const READY_TEXT = 'A new version is ready! 🐾 Right-click to update.';

// ---- pure helpers (also used by the selftest) ---------------------------------------
// semver compare: 1 if a > b, -1 if a < b, 0 if equal. Accepts a leading "v".
// A release is newer than its pre-releases (1.2.0 > 1.2.0-beta.3).
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v || '').trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}
function compareVersions(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return 0; // unparseable: never "newer"
  for (let i = 0; i < 3; i++) if (A.nums[i] !== B.nums[i]) return A.nums[i] > B.nums[i] ? 1 : -1;
  if (!A.pre.length || !B.pre.length) return A.pre.length === B.pre.length ? 0 : A.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i];
    const y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny && Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
const isPrerelease = (v) => { const p = parseVersion(v); return !!(p && p.pre.length); };

// installer | portable | dev | dev-forced
function modeFor({ isPackaged, env = {} }) {
  if (env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  if (isPackaged) return 'installer';
  return env.FORCE_UPDATER === '1' ? 'dev-forced' : 'dev';
}

// Only release pages of OUR repo may be opened.
function isAllowedReleaseUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && u.hostname === 'github.com' && u.pathname.startsWith(`/${OWNER}/${REPO}/`) && !u.username && !u.password;
  } catch (_) {
    return false;
  }
}

// ---- the updater ------------------------------------------------------------------
// deps: { app, shell, log, getSettings(), setSettings(partial), busyReason() -> string|null,
//   announceBlock() -> Promise<string|null> (null = may show the bubble), announce(text),
//   changed() (menus refresh), env, autoUpdater (selftest: a fake), fetch (selftest: a fake) }
function create(deps) {
  const { app, log } = deps;
  const env = deps.env || process.env;
  const mode = modeFor({ isPackaged: app.isPackaged, env });
  const current = app.getVersion();
  const st = {
    state: 'idle', // idle | off | checking | up-to-date | available | downloading | downloaded | error
    version: null, // the newer version found
    progress: 0,
    error: null,
    releaseUrl: RELEASES_PAGE,
    lastResult: '', // short text for menus / Customize
  };
  let au = null; // electron-updater's autoUpdater (installer / dev-forced only)
  let timer = null;
  let announceTimer = null;
  let announced = null; // version we already showed the bubble for (once per run)
  let lastProgressLog = -1;
  let started = false;
  let checking = null; // the running check (a second request joins it)
  const listeners = []; // our autoUpdater handlers (removed by stop())

  const S = () => deps.getSettings();
  const safe = (name, fn) => (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      log(`updater: ${name} handler failed`, err);
      return undefined;
    }
  };
  function set(patch, why) {
    Object.assign(st, patch);
    if (why) log(`updater: ${why}`);
    try { deps.changed && deps.changed(); } catch (err) { log('updater: changed() failed', err); }
  }
  const usesAutoUpdater = () => mode === 'installer' || mode === 'dev-forced';
  const skipped = (v) => !!v && S().skippedVersion === v;

  function setupAutoUpdater() {
    if (au) return au;
    au = deps.autoUpdater || require('electron-updater').autoUpdater; // lazy: only when needed
    au.logger = {
      info: (m) => log(`updater(lib): ${m}`),
      warn: (m) => log(`updater(lib) WARN: ${m}`),
      error: (m) => log(`updater(lib) ERROR: ${m}`),
      debug: () => {},
    };
    au.autoDownload = false; // we start the download ourselves, so a skipped version is never fetched
    // installs when she quits; we never call quitAndInstall on our own. Never with the local test feed:
    // its download is dummy bytes, not an installer.
    au.autoInstallOnAppQuit = mode !== 'dev-forced';
    au.allowDowngrade = false;
    if (mode === 'dev-forced') {
      au.forceDevUpdateConfig = true; // reads dev-app-update.yml (local test feed)
      if (deps.updateConfigPath) au.updateConfigPath = deps.updateConfigPath; // selftest: its own test feed
    } else if (typeof au.setFeedURL === 'function') {
      au.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO, releaseType: 'release' });
    }
    configure();
    const on = (ev, fn) => { au.on(ev, fn); listeners.push([ev, fn]); };
    on('checking-for-update', safe('checking', () => set({ state: 'checking', error: null })));
    on('update-not-available', safe('not-available', (info) => {
      set({ state: 'up-to-date', version: null, lastResult: "You're up to date" }, `up to date (latest ${info && info.version}, running ${current})`);
    }));
    on('update-available', safe('available', (info) => {
      const v = info && info.version;
      if (compareVersions(v, current) <= 0) {
        return set({ state: 'up-to-date', version: null, lastResult: "You're up to date" }, `feed offered ${v}, not newer than ${current}: ignored`);
      }
      if (skipped(v)) {
        return set({ state: 'up-to-date', version: null, lastResult: `v${v} skipped` }, `v${v} is available but she skipped it`);
      }
      set({ state: 'downloading', version: v, progress: 0, releaseUrl: `${RELEASES_PAGE}/tag/v${v}`, lastResult: `Downloading v${v}…` }, `v${v} available - downloading in the background`);
      lastProgressLog = -1;
      Promise.resolve()
        .then(() => au.downloadUpdate())
        .catch((err) => fail('download', err));
      return undefined;
    }));
    on('download-progress', safe('progress', (p) => {
      const pct = Math.floor((p && p.percent) || 0);
      st.progress = pct;
      if (pct >= lastProgressLog + 25) {
        lastProgressLog = pct - (pct % 25);
        log(`updater: downloading v${st.version}: ${pct}%`);
      }
    }));
    on('update-downloaded', safe('downloaded', (info) => {
      const v = (info && info.version) || st.version;
      au.autoInstallOnAppQuit = mode !== 'dev-forced' && !skipped(v);
      set({ state: 'downloaded', version: v, progress: 100, lastResult: `Update ready (v${v})` }, `v${v} downloaded - installs on quit or "Restart to update"`);
      announceSoon();
    }));
    on('error', safe('error', (err) => fail('autoUpdater', err)));
    return au;
  }

  function fail(where, err) {
    const msg = String((err && (err.message || err.code)) || err || 'unknown error').split('\n')[0].slice(0, 200);
    // keep a finished download usable even if a later check fails
    if (st.state === 'downloaded') return log(`updater: ${where} error (update already downloaded, keeping it): ${msg}`);
    if (st.state === 'error' && st.error === msg) return undefined; // the same failure, already logged

    set({ state: 'error', error: msg, lastResult: "Couldn't check right now" }, `${where} failed (will retry at the next check): ${msg}`);
    return undefined;
  }

  // Stable: releases only. Beta: pre-releases too.
  function configure() {
    const beta = S().updateChannel === 'beta';
    if (au) au.allowPrerelease = beta;
  }

  // ---- portable: the GitHub API, then "open download page" ---------------------------
  async function checkPortable() {
    set({ state: 'checking', error: null });
    const beta = S().updateChannel === 'beta';
    const doFetch = deps.fetch || globalThis.fetch;
    const res = await doFetch(beta ? `${API}?per_page=15` : `${API}/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'WaterCat-updater' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GitHub API answered ${res.status}${res.status === 403 || res.status === 429 ? ' (rate limit)' : ''}`);
    const body = await res.json();
    const list = (Array.isArray(body) ? body : [body]).filter((r) => r && !r.draft && (beta || !r.prerelease));
    let best = null;
    for (const r of list) {
      const v = String(r.tag_name || '').replace(/^v/, '');
      if (!parseVersion(v)) continue;
      if (!best || compareVersions(v, best.v) > 0) best = { v, url: r.html_url };
    }
    if (!best || compareVersions(best.v, current) <= 0) {
      return set({ state: 'up-to-date', version: null, lastResult: "You're up to date" }, `portable: up to date (latest ${best ? best.v : 'none'}, running ${current})`);
    }
    if (skipped(best.v)) return set({ state: 'up-to-date', version: null, lastResult: `v${best.v} skipped` }, `portable: v${best.v} available but skipped`);
    const url = isAllowedReleaseUrl(best.url) ? best.url : RELEASES_PAGE;
    set({ state: 'available', version: best.v, releaseUrl: url, lastResult: `Update available (v${best.v})` }, `portable: v${best.v} available (${url})`);
    announceSoon();
    return undefined;
  }

  // ---- checking -------------------------------------------------------------------------
  // source: 'auto' (timer) | 'manual' (menu / Customize). Never throws; resolves to the
  // short status text.
  function check(source = 'manual') {
    if (mode === 'dev') {
      log('updater: dev mode, skipped (set FORCE_UPDATER=1 to test with dev-app-update.yml)');
      st.lastResult = 'Updates are off in dev mode';
      return Promise.resolve(st.lastResult);
    }
    if (checking) return checking;
    if (st.state === 'downloading' || st.state === 'downloaded') return Promise.resolve(st.lastResult);
    checking = (async () => {
      try {
        set({ lastResult: 'Checking…' }, `checking for updates (${source}, channel ${S().updateChannel}, running ${current})`);
        deps.setSettings({ lastUpdateCheck: new Date().toISOString() });
        if (mode === 'portable') await checkPortable();
        else {
          const a = setupAutoUpdater();
          configure();
          await a.checkForUpdates();
        }
      } catch (err) {
        fail(`check (${source})`, err);
      } finally {
        checking = null;
      }
      if (st.state === 'checking') set({ state: 'idle', lastResult: st.lastResult === 'Checking…' ? '' : st.lastResult });
      return st.lastResult;
    })();
    return checking;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(safe('timer', tick), ms);
  }
  function tick() {
    if (!S().autoUpdate) return schedule(INTERVAL_MS);
    const busy = deps.busyReason ? deps.busyReason() : null;
    if (busy) {
      log(`updater: check postponed (${busy}), retry in ${BUSY_RETRY_MS / 60000} min`);
      return schedule(BUSY_RETRY_MS);
    }
    schedule(INTERVAL_MS); // next one even if this one fails
    check('auto');
    return undefined;
  }

  // ---- the one quiet bubble -----------------------------------------------------------
  function announceSoon() {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(safe('announce', tryAnnounce), 1500);
  }
  async function tryAnnounce() {
    if (!st.version || announced === st.version || !['downloaded', 'available'].includes(st.state)) return;
    let block = 'unknown';
    try {
      block = deps.announceBlock ? await deps.announceBlock() : null;
    } catch (err) {
      log('updater: announceBlock failed', err);
    }
    if (block) {
      log(`updater: "update ready" bubble held back (${block}), trying again in ${ANNOUNCE_RETRY_MS / 60000} min`);
      clearTimeout(announceTimer);
      announceTimer = setTimeout(safe('announce', tryAnnounce), ANNOUNCE_RETRY_MS);
      return;
    }
    announced = st.version;
    deps.announce(mode === 'portable' ? `A new version is out! 🐾 Right-click for the download page.` : READY_TEXT);
    log(`updater: showed the "update ready" bubble for v${st.version}`);
  }

  // ---- actions ------------------------------------------------------------------------
  function restartToUpdate(source = 'menu') {
    if (st.state !== 'downloaded' || !au) return false;
    log(`updater: RESTART TO UPDATE v${st.version} (${source})`);
    if (mode === 'dev-forced') {
      log('updater: dev test feed - not installing (the test download is not a real installer)');
      return true;
    }
    try {
      au.quitAndInstall(true, true); // silent install, then start WaterCat again
      return true;
    } catch (err) {
      fail('quitAndInstall', err);
      return false;
    }
  }
  function skipVersion(v = st.version) {
    if (!v) return false;
    deps.setSettings({ skippedVersion: v });
    if (au) au.autoInstallOnAppQuit = false; // a downloaded copy of it must not install on quit
    clearTimeout(announceTimer);
    set({ state: 'idle', version: null, lastResult: `v${v} skipped` }, `v${v} skipped (she can still update to anything newer)`);
    return true;
  }
  function openReleasePage(url = st.releaseUrl) {
    const target = isAllowedReleaseUrl(url) ? url : RELEASES_PAGE;
    log(`updater: opening ${target}`);
    try { deps.shell.openExternal(target); } catch (err) { log('updater: openExternal failed', err); }
  }

  // Items for the right-click menu + tray (Stage 4 adds version + "Check for updates").
  function menuItems() {
    const items = [];
    if (st.state === 'downloaded') {
      items.push({ label: `Restart to update (v${st.version})`, click: () => restartToUpdate('menu') });
      items.push({ label: `Skip v${st.version}`, click: () => skipVersion() });
    } else if (mode === 'portable' && st.state === 'available') {
      items.push({ label: `Update available (v${st.version}) - open download page`, click: () => openReleasePage() });
      items.push({ label: `Skip v${st.version}`, click: () => skipVersion() });
    }
    return items;
  }

  function start() {
    if (started) return;
    started = true;
    const s = S();
    log(`updater: WaterCat v${current}, mode ${mode}, channel ${s.updateChannel}, auto ${s.autoUpdate ? 'on' : 'off'}${s.skippedVersion ? `, skipped v${s.skippedVersion}` : ''}`);
    if (mode === 'dev') {
      log('updater: dev mode, skipped');
      return;
    }
    if (usesAutoUpdater()) {
      try { setupAutoUpdater(); } catch (err) { fail('setup', err); }
    }
    schedule(FIRST_CHECK_MS);
  }
  function stop() {
    clearTimeout(timer);
    clearTimeout(announceTimer);
    if (au) for (const [ev, fn] of listeners.splice(0)) au.removeListener(ev, fn);
  }
  function settingsChanged(keys) {
    if (keys.includes('updateChannel')) {
      configure();
      log(`updater: channel is now ${S().updateChannel}`);
    }
    if (keys.includes('autoUpdate')) log(`updater: automatic updates ${S().autoUpdate ? 'on' : 'off'}`);
  }

  return {
    mode,
    version: current,
    start,
    stop,
    check,
    restartToUpdate,
    skipVersion,
    openReleasePage,
    menuItems,
    settingsChanged,
    status: () => ({ ...st, mode, current, installsOnQuit: !!(au && au.autoInstallOnAppQuit) }),
    _tryAnnounce: tryAnnounce, // selftest
  };
}

module.exports = { create, compareVersions, isPrerelease, modeFor, isAllowedReleaseUrl, OWNER, REPO, RELEASES_PAGE };
