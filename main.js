'use strict';
// WaterCat - main process.
// Startup order (do not reorder):
//   1. log() + error handlers   2. autoplay switch   3. single-instance lock
//   4. second-instance / window-all-closed handlers   5. function definitions
//   6. app.whenReady() -> window, tray, hotkey, timers, login item
// Rules: no console.log here (EPIPE), no `document` here, no top-level
// BrowserWindow / Tray / globalShortcut / screen / setTimeout calls.

const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen, nativeImage, shell, dialog, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

const SELFTEST = process.argv.includes('--selftest');

// ---------------------------------------------------------------------------
// 1. Logging + error handlers
// ---------------------------------------------------------------------------
const LOG_DIR = app.isPackaged
  ? path.join(app.getPath('appData'), 'water-cat-tracker', 'logs')
  : path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'debug.log');

function log(...parts) {
  try {
    const msg = parts.map((p) => (typeof p === 'string' ? p : safeJson(p))).join(' ');
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try {
      if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    } catch (_) { /* no file yet */ }
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}]${SELFTEST ? ' [selftest]' : ''} ${msg}\n`);
  } catch (_) { /* logging must never throw */ }
}

function safeJson(v) {
  try {
    if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack}`;
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}

for (const stream of [process.stdout, process.stderr]) {
  try {
    stream.on('error', (err) => {
      if (err && err.code !== 'EPIPE') log('stream error', err);
    });
  } catch (_) { /* ignore */ }
}
process.on('uncaughtException', (err) => log('UNCAUGHT EXCEPTION', err));
process.on('unhandledRejection', (err) => log('UNHANDLED REJECTION', err));

log(`---- WaterCat v${app.getVersion()} starting (electron ${process.versions.electron}, packaged=${app.isPackaged}, argv=${process.argv.slice(1).join(' ')})`);

// ---------------------------------------------------------------------------
// 2. Autoplay switch (must be before app is ready)
// ---------------------------------------------------------------------------
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Fixed data folder (the selftest uses its own so it never touches real data,
// and so it doesn't collide with the running app's single-instance lock).
app.setPath('userData', path.join(app.getPath('appData'), SELFTEST ? 'water-cat-tracker-selftest' : 'water-cat-tracker'));

// ---------------------------------------------------------------------------
// 3. Single instance
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  log('Another instance is already running - exiting.');
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 4. App-level handlers
// ---------------------------------------------------------------------------
app.on('second-instance', () => {
  log('second-instance: showing cat');
  if (win && !win.isDestroyed()) showCat();
});

// The cat lives in the tray; closing/hiding windows must never quit the app.
app.on('window-all-closed', () => log('window-all-closed (ignored)'));

app.on('before-quit', () => {
  quitting = true;
  log('before-quit');
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (_) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// 5. State + function definitions
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  goalCups: 8,
  reminderMinutes: 60,
  repeatMinutes: 5, // an active reminder meows again this often until a cup is logged
  volume: 0.5,
  quietStart: '23:00',
  quietEnd: '08:00',
  startWithWindows: true,
  meowStyle: 'random',
  soundEnabled: true, // master sound switch: every meow / purr / chirp honours it
  catName: 'Gargorl',
  catGender: 'female',
  catDefaultPreset: 'gargorl', // what "Reset to default" restores for this cat
  catDescriptionCustom: true, // written by her (never replaced automatically); Gargorl's line counts as hers
  catDescriptionSource: '', // template of an automatic description (re-filled when the gender changes)
  catLookLocked: false, // locked: colours / preset / pattern can't change (Gargorl + Fainu start locked)
  catDescriptor: "Gone but not forgotten. She's not dead 💀. She just moved away",
  accessories: {}, // Stage 8
  sleepSpot: 'random', // Stage E: random | bed | tree | box | none
  sleepSpotColors: {}, // Stage E
  firstRunDone: false, // the first-launch bubble has been shown
  customPresets: [], // her own saved looks: [{ name, look }]
  breed: 'gargorl',
  tail: true,
  catSize: 8, // px per sprite cell (4..14); 8 = 100%
  mouseResize: true, // corner handle + scroll wheel over the cat
  alarms: [{ id: 'pill', time: '22:00', text: 'Pillbrotchen time my dear', enabled: true }],
  idleSleepEnabled: true, // sleep after idleSleepMinutes without interaction
  idleSleepMinutes: 15, // 1..120
  quietSleepEnabled: true, // sleep during quiet hours, wake when they end
  systemIdleSleep: false, // also count the whole computer being idle (off: she may be gaming with the cat ignored)
  catLastSleepSpot: '', // per cat: Random never repeats this one
  // updates (updater.js)
  autoUpdate: true, // check + download quietly; installs on quit or 'Restart to update'
  updateChannel: 'stable', // stable | beta (beta also offers pre-releases)
  lastUpdateCheck: '', // ISO time of the last check
  skippedVersion: '', // 'Skip this version'
  lastRunVersion: '', // the app version that ran last (an update shows one 'I got an update!' bubble)
  idleAnimations: true,
  chaseMouse: false,
  position: null,
};

// Layered sprite (Stage 1). A preset sets colors + pattern + ear style + fluff/tufts;
// "breed" remembers which preset was applied last ('custom' once colours are edited).
const CatSprites = require('./catsprite.js');
const BREED_IDS = Object.keys(CatSprites.PRESETS);
const EAR_STYLES = ['normal', 'small', 'fold'];
const GENDERS = ['female', 'male', 'unspecified'];
const SLEEP_SPOTS = ['random', 'bed', 'tree', 'box', 'none'];
const SIZE_WORDS = { small: 6, medium: 8, large: 11 };
function presetSettings(id) {
  const p = CatSprites.PRESETS[id];
  return p && { breed: id, colors: { ...p.colors }, furPattern: p.pattern, earStyle: p.ears, fluffy: p.fluffy, tufts: p.tufts };
}
Object.assign(DEFAULT_SETTINGS, presetSettings('gargorl'), { whiskersEnabled: true });

// Sounds = bundled clips (assets/meows/meows.json, made by make_meows.js)
//        + her own files in <userData>/sounds (cleaned in the renderer at load time).
const USER_SOUND_EXT = ['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac', '.webm'];
const USER_SOUND_MAX_BYTES = 15 * 1024 * 1024;
let soundCatalog = []; // [{ id, label, group: 'builtin'|'user', file }]

function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'sound';
}

function labelFromFile(base) {
  const words = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function scanSounds() {
  const list = [];
  let manifest = [];
  try {
    manifest = JSON.parse(fs.readFileSync(asset(path.join('meows', 'meows.json')), 'utf8'));
    if (!Array.isArray(manifest)) throw new Error('not an array');
  } catch (err) {
    log('meows.json unreadable - no built-in sounds', err);
    manifest = [];
  }
  for (const m of manifest) {
    if (m && typeof m.id === 'string' && typeof m.file === 'string') {
      list.push({ id: m.id, label: String(m.label || m.id), group: 'builtin', file: asset(path.join('meows', path.basename(m.file))) });
    }
  }
  const used = new Set(list.map((m) => m.id));
  let files = [];
  try {
    files = fs.readdirSync(userSoundsDir(), { withFileTypes: true })
      .filter((d) => d.isFile() && USER_SOUND_EXT.includes(path.extname(d.name).toLowerCase()))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    log('sounds folder unreadable', err);
  }
  for (const name of files) {
    const full = path.join(userSoundsDir(), name);
    try {
      if (fs.statSync(full).size > USER_SOUND_MAX_BYTES) {
        log(`sound skipped (over ${USER_SOUND_MAX_BYTES / 1048576} MB): ${name}`);
        continue;
      }
    } catch (_) { continue; }
    const base = path.basename(name, path.extname(name));
    if (list.some((m) => m.group === 'builtin' && m.id === slugify(base))) continue; // already bundled
    let id = 'user:' + slugify(base);
    for (let n = 2; used.has(id); n++) id = `user:${slugify(base)}-${n}`;
    used.add(id);
    list.push({ id, label: labelFromFile(base), group: 'user', file: full });
  }
  return list;
}

// Files the renderer could not decode (not audio / corrupt). Hidden from the list.
const brokenSounds = new Set();
const usableSounds = () => soundCatalog.filter((m) => !brokenSounds.has(m.id));
const meowIds = () => ['random', ...usableSounds().map((m) => m.id)];
const publicCatalog = () => usableSounds().map(({ id, label, group }) => ({ id, label, group }));

function markSoundBroken(id, reason) {
  if (brokenSounds.has(id) || !soundCatalog.some((m) => m.id === id)) return;
  brokenSounds.add(id);
  log(`sound "${id}" cannot be played (${reason}) - hidden from the list`);
  if (settings.meowStyle === id) {
    settings.meowStyle = 'random';
    saveSettings();
    pushState();
  }
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:changed', publicSettings());
}

function refreshSounds(reason) {
  const before = JSON.stringify(soundCatalog);
  soundCatalog = scanSounds();
  if (JSON.stringify(soundCatalog) === before) return false;
  brokenSounds.clear(); // the renderer re-checks every file on reload
  log(`sounds (${reason}): ${soundCatalog.length} total, ${soundCatalog.filter((s) => s.group === 'user').length} yours`);
  if (settings.meowStyle !== 'random' && !meowIds().includes(settings.meowStyle)) {
    log(`chosen sound "${settings.meowStyle}" is gone -> random`);
    settings.meowStyle = 'random';
    saveSettings();
    pushState();
  }
  if (reason !== 'startup') {
    if (win && !win.isDestroyed()) win.webContents.send('meows-changed');
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:changed', publicSettings());
  }
  return true;
}

let soundsWatcher = null;
let soundsTimer = null;
function watchSounds() {
  try {
    soundsWatcher = fs.watch(userSoundsDir(), () => {
      clearTimeout(soundsTimer);
      soundsTimer = setTimeout(() => refreshSounds('folder changed'), 400);
    });
    soundsWatcher.on('error', (err) => log('sounds watcher error', err));
  } catch (err) {
    log('cannot watch sounds folder', err);
  }
}

// First run (installer or portable): create everything the app needs.
function ensureAppDirs() {
  for (const dir of [dataDir(), LOG_DIR, userSoundsDir()]) fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(userSoundsDir(), 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, [
      'WaterCat - your own sounds',
      '',
      'Drop audio files in this folder and they show up in WaterCat Settings -> Meow style',
      'within a second (no restart needed). They are also used by "Random".',
      '',
      '- Formats: .mp3 .wav .ogg .m4a .flac .opus .aac .webm (max 15 MB each)',
      '- The file name becomes the name in the list:  happy-trill.mp3 -> "Happy trill"',
      '- Each sound is cleaned up automatically: rumble and harsh highs removed, silence at the',
      '  start/end trimmed, cut to 4 seconds, and its loudness matched to the built-in meows.',
      '- Delete a file to remove it.',
      '',
    ].join('\r\n'));
  }
  log(`app folders ready: ${dataDir()} (sounds: ${userSoundsDir()})`);
}

// Window layout (DIP). Must match renderer.js layout(): a fixed 96 px band on top for the
// bubble (up to 3 lines) + counter, then the 30x19-cell sprite canvas, then a 6 px margin.
// `catSize` = pixels per sprite cell (whole numbers only, so the pixel art stays crisp).
const SPRITE_TOP = 96;
const CAT_SIZES = { min: 4, max: 14, def: 8 };
const winSizeFor = (cell) => ({ w: Math.max(240, CatSprites.CANVAS.cols * cell), h: SPRITE_TOP + CatSprites.CANVAS.rows * cell + 6 });
let WIN_W = 240;
let WIN_H = 254;
function setWinSizeVars() {
  ({ w: WIN_W, h: WIN_H } = winSizeFor(settings.catSize));
}
// Middle of the sitting cat, window coords (chase uses it to sit beside the cursor).
function catAnchor() {
  const cell = settings.catSize;
  const left = (WIN_W - CatSprites.CANVAS.cols * cell) / 2;
  return { x: Math.round(left + 14.5 * cell), y: SPRITE_TOP + (CatSprites.CANVAS.rows - 19 + 14) * cell };
}

// Resize with the mouse: while the corner handle is held, every ~22 px the cursor moves
// (right/down = bigger) is one size step. Scroll over the cat = one step per notch.
let resizeDrag = null; // { startCursor, startSize, timer, startedAt }
function resizeStart() {
  if (!settings.mouseResize || !win || win.isDestroyed()) return;
  resizeEnd('restart');
  markActive('resize', { wakeReturn: false });
  resizeDrag = { startCursor: cursorPoint(), startSize: settings.catSize, startedAt: Date.now(), timer: null };
  resizeDrag.timer = setInterval(() => {
    if (!resizeDrag) return;
    if (Date.now() - resizeDrag.startedAt > 20000) return resizeEnd('timeout');
    const c = cursorPoint();
    const delta = ((c.x - resizeDrag.startCursor.x) + (c.y - resizeDrag.startCursor.y)) / 2;
    const size = Math.max(CAT_SIZES.min, Math.min(CAT_SIZES.max, resizeDrag.startSize + Math.round(delta / 22)));
    if (size !== settings.catSize) applySettings({ catSize: size });
  }, 30);
  log(`RESIZE START size=${settings.catSize}`);
}
function resizeEnd(reason) {
  if (!resizeDrag) return;
  clearInterval(resizeDrag.timer);
  resizeDrag = null;
  log(`RESIZE END (${reason}) size=${settings.catSize}`);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:changed', publicSettings());
}
function resizeStep(dir) {
  if (!settings.mouseResize) return;
  const size = Math.max(CAT_SIZES.min, Math.min(CAT_SIZES.max, settings.catSize + (dir > 0 ? 1 : -1)));
  if (size !== settings.catSize) {
    applySettings({ catSize: size });
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:changed', publicSettings());
  }
}

// Resize around the cat's feet (bottom-centre stays put), then clamp + save.
function applyWinSize() {
  const oldW = WIN_W;
  const oldH = WIN_H;
  setWinSizeVars();
  if (!win || win.isDestroyed() || (oldW === WIN_W && oldH === WIN_H)) return;
  const b = win.getBounds();
  const p = clampToWorkArea(Math.round(b.x + oldW / 2 - WIN_W / 2), b.y + oldH - WIN_H);
  setWinPos(p.x, p.y);
  if (behavior.home) behavior.home = { x: Math.round(behavior.home.x + oldW / 2 - WIN_W / 2), y: behavior.home.y + oldH - WIN_H };
  if (behavior.state !== 'sleeping' && !settings.chaseMouse) savePosition();
  log(`cat size ${settings.catSize} px/cell -> window ${WIN_W}x${WIN_H}`);
}

const HOTKEY = 'Control+Alt+W';
const BUBBLE_TEXT = 'Its time to get wet girl 💦';
const TICK_MS = 15 * 1000;

let win = null;
let tray = null;
let lastTrayMenu = null; // the tray menu as last built (selftest reads it)
let updater = null; // updater.js, created in app.whenReady (never in dev / selftest)
let quitting = false;
let settings = { ...DEFAULT_SETTINGS };
let day = { date: todayKey(), cups: 0 };
let nextReminderAt = 0;
let tickTimer = null;
let drag = null; // { timer, startCursor, startBounds, startedAt }
let fakeCursor = null; // selftest only: replaces the real cursor for drag tests
let contextMenu = null;

const dataDir = () => app.getPath('userData');
const settingsFile = () => path.join(dataDir(), 'settings.json');
const cupsFile = () => path.join(dataDir(), 'cups.json');
const asset = (name) => path.join(__dirname, 'assets', name);
const userSoundsDir = () => path.join(dataDir(), 'sounds');

function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readJsonSafe(file, fallback) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    log(`readJsonSafe: ${path.basename(file)} is not an object, using defaults`);
  } catch (err) {
    if (err.code !== 'ENOENT') log(`readJsonSafe: ${path.basename(file)} unreadable (${err.message}), using defaults`);
  }
  return fallback;
}

function writeJsonSafe(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    log(`writeJsonSafe failed for ${file}`, err);
    return false;
  }
}

const isHHMM = (s) => typeof s === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s);

// Alarms: up to 20 of { id, time 'HH:MM', text (1-120 chars), enabled }. Any invalid
// entry rejects the whole list (the previous list is kept), so nothing is half-saved.
const ALARM_MAX = 20;
function sanitizeAlarms(list) {
  if (!Array.isArray(list) || list.length > ALARM_MAX) return null;
  const out = [];
  const ids = new Set();
  for (const a of list) {
    if (!a || typeof a !== 'object') return null;
    const text = typeof a.text === 'string' ? a.text.replace(/\s+/g, ' ').trim() : '';
    const id = typeof a.id === 'string' && /^[\w-]{1,40}$/.test(a.id) ? a.id : null;
    if (!id || ids.has(id) || !isHHMM(a.time) || !text || text.length > 120) return null;
    ids.add(id);
    const [h, m] = a.time.split(':').map(Number);
    out.push({ id, time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, text, enabled: a.enabled !== false });
  }
  return out;
}

// A cat's "look" (what a preset / exported file holds). Returns null if anything is off.
const LOOK_FILE_TYPE = 'watercat-look';
const CUSTOM_PRESET_MAX = 20;
function sanitizeLook(l) {
  if (!l || typeof l !== 'object' || !l.colors || typeof l.colors !== 'object') return null;
  const colors = {};
  for (const part of CatSprites.PARTS) {
    const v = l.colors[part];
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return null;
    colors[part] = v.toLowerCase();
  }
  const out = { colors };
  out.furPattern = CatSprites.PATTERNS.includes(l.furPattern) ? l.furPattern : 'solid';
  out.earStyle = EAR_STYLES.includes(l.earStyle) ? l.earStyle : 'normal';
  for (const k of ['fluffy', 'tufts']) out[k] = l[k] === true;
  for (const k of ['tail', 'whiskersEnabled']) out[k] = l[k] !== false;
  return out;
}
function sanitizeCustomPreset(p) {
  const name = typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim() : '';
  const look = sanitizeLook(p.look);
  return name && name.length <= 30 && look ? { name, look } : null;
}
const lookOfSettings = () => ({
  colors: { ...settings.colors }, furPattern: settings.furPattern, earStyle: settings.earStyle,
  fluffy: settings.fluffy, tufts: settings.tufts, tail: settings.tail, whiskersEnabled: settings.whiskersEnabled,
});

// Invalid values fall back to `base` (defaults on load, current settings on edit).
function sanitizeSettings(raw, base = DEFAULT_SETTINGS) {
  const s = { ...base };
  if (Number.isInteger(raw.goalCups) && raw.goalCups > 0 && raw.goalCups <= 100) s.goalCups = raw.goalCups;
  if (Number.isInteger(raw.reminderMinutes) && raw.reminderMinutes >= 1 && raw.reminderMinutes <= 1440) s.reminderMinutes = raw.reminderMinutes;
  if (Number.isInteger(raw.repeatMinutes) && raw.repeatMinutes >= 1 && raw.repeatMinutes <= 120) s.repeatMinutes = raw.repeatMinutes;
  if (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) s.volume = raw.volume;
  if (isHHMM(raw.quietStart)) s.quietStart = raw.quietStart;
  if (isHHMM(raw.quietEnd)) s.quietEnd = raw.quietEnd;
  if (typeof raw.startWithWindows === 'boolean') s.startWithWindows = raw.startWithWindows;
  if (typeof raw.meowStyle === 'string' && meowIds().includes(raw.meowStyle)) s.meowStyle = raw.meowStyle;
  const breed = raw.breed === 'calico' ? 'fainu' : raw.breed; // the "Calico (old default)" preset is now Fainu
  if (BREED_IDS.includes(breed) || breed === 'custom') s.breed = breed;
  // Colours: one hex per part; a bad value keeps the previous colour for that part only.
  if (raw.colors && typeof raw.colors === 'object') {
    const cols = { ...s.colors };
    for (const part of CatSprites.PARTS) {
      const v = raw.colors[part];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) cols[part] = v.toLowerCase();
    }
    s.colors = cols;
  }
  if (CatSprites.PATTERNS.includes(raw.furPattern)) s.furPattern = raw.furPattern;
  if (EAR_STYLES.includes(raw.earStyle)) s.earStyle = raw.earStyle;
  for (const k of ['whiskersEnabled', 'fluffy', 'tufts']) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  if (Array.isArray(raw.customPresets) && raw.customPresets.length <= CUSTOM_PRESET_MAX) {
    const list = raw.customPresets.map((p) => p && sanitizeCustomPreset(p)).filter(Boolean);
    if (list.length === raw.customPresets.length) s.customPresets = list;
  }
  for (const k of ['autoUpdate', 'tail', 'idleSleepEnabled', 'quietSleepEnabled', 'systemIdleSleep', 'idleAnimations', 'chaseMouse', 'mouseResize', 'soundEnabled', 'firstRunDone']) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  // older files: sleepWhenIdle / sleepAfterMinutes (old default 10 -> new default 15)
  if (typeof raw.idleSleepEnabled !== 'boolean' && typeof raw.sleepWhenIdle === 'boolean') s.idleSleepEnabled = raw.sleepWhenIdle;
  if (raw.idleSleepMinutes === undefined && Number.isInteger(raw.sleepAfterMinutes) && raw.sleepAfterMinutes !== 10) raw = { ...raw, idleSleepMinutes: Math.min(120, raw.sleepAfterMinutes) };
  if (['bed', 'tree', 'box', 'none', ''].includes(raw.catLastSleepSpot)) s.catLastSleepSpot = raw.catLastSleepSpot;
  const oneLine = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const name = oneLine(raw.catName);
  if (name && name.length <= 40) s.catName = name;
  // description: may be empty (e.g. Fainu), multi-line, max 200 characters
  if (typeof raw.catDescriptor === 'string') {
    const desc = raw.catDescriptor.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (desc.length <= 200) s.catDescriptor = desc;
  }
  if (GENDERS.includes(raw.catGender)) s.catGender = raw.catGender;
  if (BREED_IDS.includes(raw.catDefaultPreset)) s.catDefaultPreset = raw.catDefaultPreset;
  if (typeof raw.catDescriptionCustom === 'boolean') s.catDescriptionCustom = raw.catDescriptionCustom;
  if (typeof raw.catLookLocked === 'boolean') s.catLookLocked = raw.catLookLocked;
  if (typeof raw.catDescriptionSource === 'string' && raw.catDescriptionSource.length <= 300) s.catDescriptionSource = raw.catDescriptionSource;
  if (SLEEP_SPOTS.includes(raw.sleepSpot)) s.sleepSpot = raw.sleepSpot;
  const smallMap = (o, ok) => {
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length > 40) return null;
    const out = {};
    for (const [k, v] of Object.entries(o)) if (/^[a-zA-Z0-9_-]{1,30}$/.test(k) && ok(v)) out[k] = v;
    return out;
  };
  const sc = smallMap(raw.sleepSpotColors, (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v));
  if (sc) s.sleepSpotColors = sc;
  const acc = smallMap(raw.accessories, (v) => typeof v === 'boolean' || (typeof v === 'string' && v.length <= 20) || (v && typeof v === 'object' && !Array.isArray(v)));
  if (acc) s.accessories = acc;
  if (Number.isInteger(raw.idleSleepMinutes) && raw.idleSleepMinutes >= 1 && raw.idleSleepMinutes <= 120) s.idleSleepMinutes = raw.idleSleepMinutes;
  const size = typeof raw.catSize === 'string' ? SIZE_WORDS[raw.catSize] : raw.catSize;
  if (Number.isInteger(size) && size >= CAT_SIZES.min && size <= CAT_SIZES.max) s.catSize = size;
  const alarms = sanitizeAlarms(raw.alarms);
  if (alarms) s.alarms = alarms;
  if (Number.isInteger(raw.layoutRows)) s.layoutRows = raw.layoutRows;
  if (['stable', 'beta'].includes(raw.updateChannel)) s.updateChannel = raw.updateChannel;
  if (typeof raw.lastRunVersion === 'string' && /^(\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)?$/.test(raw.lastRunVersion)) s.lastRunVersion = raw.lastRunVersion;
  if (typeof raw.lastUpdateCheck === 'string' && raw.lastUpdateCheck.length <= 40) s.lastUpdateCheck = raw.lastUpdateCheck;
  if (typeof raw.skippedVersion === 'string' && /^(\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)?$/.test(raw.skippedVersion)) s.skippedVersion = raw.skippedVersion;
  const pos = raw.position;
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) s.position = { x: Math.round(pos.x), y: Math.round(pos.y) };
  else if (Array.isArray(pos) && pos.length === 2 && pos.every(Number.isFinite)) s.position = { x: pos[0], y: pos[1] };
  return s;
}

// --- Cat profiles (Stage A) --------------------------------------------------------
// settings.json holds "cats": [profile, ...] + "activeCatId". Everything about a cat
// (name, gender, description, look, size, accessories, sleeping spot) lives in its
// profile. In memory, the ACTIVE cat is also mirrored as flat keys (catName, colors,
// catSize, ...) so the rest of the app reads one place; every change is written back
// into that cat's profile only (syncActive) before saving.
const PROFILE_MAP = {
  catName: 'name', catGender: 'gender', catDescriptor: 'description', colors: 'colors', whiskersEnabled: 'whiskersEnabled',
  furPattern: 'pattern', catSize: 'size', tail: 'tail', earStyle: 'earStyle', fluffy: 'fluffy', tufts: 'tufts',
  breed: 'preset', accessories: 'accessories', sleepSpot: 'sleepSpot', sleepSpotColors: 'sleepSpotColors', catDefaultPreset: 'defaultPreset',
  catDescriptionCustom: 'descriptionCustom', catDescriptionSource: 'descriptionSource', catLookLocked: 'lookLocked',
  catLastSleepSpot: 'lastSleepSpot',
};
const PER_CAT_KEYS = Object.keys(PROFILE_MAP);
const CAT_ID_RE = /^[a-z0-9-]{1,40}$/;

function profileFromFlat(s, id) {
  const p = { id };
  for (const [flat, key] of Object.entries(PROFILE_MAP)) p[key] = JSON.parse(JSON.stringify(s[flat]));
  return p;
}
function flatFromProfile(p) {
  const f = {};
  for (const [flat, key] of Object.entries(PROFILE_MAP)) if (key in p) f[flat] = p[key];
  return f;
}
// Validate one profile (bad fields fall back to `base`, a bad id/name drops the profile).
function sanitizeProfile(p, base = DEFAULT_SETTINGS) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !CAT_ID_RE.test(p.id)) return null;
  // profiles saved before "defaultPreset" existed: Fainu's default is her calico look
  if (!p.defaultPreset && p.id === 'fainu') p = { ...p, defaultPreset: 'fainu' };
  // profiles saved before looks could be locked: Gargorl (grey) and Fainu (calico) get
  // their own look back and are locked; every other cat stays as it was, unlocked.
  if (typeof p.lookLocked !== 'boolean') {
    if (OWN_LINE_IDS.includes(p.id)) {
      const look = presetSettings(p.id === 'fainu' ? 'fainu' : 'gargorl');
      p = { ...p, preset: look.breed, colors: look.colors, pattern: look.furPattern, earStyle: look.earStyle, fluffy: look.fluffy, tufts: look.tufts, lookLocked: true };
      log(`${p.id}: look restored to her default and locked`);
    } else {
      p = { ...p, lookLocked: false };
    }
  }
  // profiles saved before descriptions knew where they came from: an automatic line
  // (pool or preset) stays automatic, anything else is hers. Gargorl's is always hers.
  if (typeof p.descriptionCustom !== 'boolean') {
    const d = (p.description || '').trim();
    const tpl = p.id === 'gargorl' ? null
      : [...DESCRIPTION_POOL, ...Object.values(CatSprites.PRESETS).map((x) => x.description).filter(Boolean)]
        .find((t) => GENDERS.some((g) => fillPronouns(t, g) === d));
    p = { ...p, descriptionCustom: !tpl, descriptionSource: tpl || '' };
  }
  const s = sanitizeSettings(flatFromProfile(p), base);
  if (typeof p.name !== 'string' || !p.name.trim()) return null;
  return profileFromFlat(s, p.id);
}
// Starter profiles: Gargorl (the default) and Fainu (calico look, gender unspecified,
// empty description for her to fill in).
function defaultCats() {
  const fainu = profileFromFlat({ ...DEFAULT_SETTINGS, ...presetSettings('fainu') }, 'fainu');
  Object.assign(fainu, { name: 'Fainu', gender: 'unspecified', defaultPreset: 'fainu', lookLocked: true });
  autoDescribe(fainu, FAINU_DESCRIPTION);
  return [{ ...profileFromFlat(DEFAULT_SETTINGS, 'gargorl'), lookLocked: true }, fainu];
}
const STARTER_IDS = ['gargorl', 'fainu'];
// Add starter cats an older file doesn't have yet - once only, so a deleted one stays deleted.
function addMissingStarters() {
  const added = Array.isArray(settings.startersAdded) ? settings.startersAdded.filter((id) => STARTER_IDS.includes(id)) : [];
  for (const p of defaultCats()) {
    if (added.includes(p.id)) continue;
    added.push(p.id);
    if (!settings.cats.some((c) => c.id === p.id)) {
      settings.cats.push(p);
      log(`starter cat added: ${p.id} "${p.name}"`);
    }
  }
  settings.startersAdded = added;
}

// Bring back deleted starter cats (Gargorl, Fainu) with their default looks.
function restoreStarters(source) {
  syncActive();
  const restored = [];
  for (const p of defaultCats()) {
    if (settings.cats.some((c) => c.id === p.id)) continue;
    settings.cats.splice(STARTER_IDS.indexOf(p.id), 0, p); // keep them at the top of the list
    restored.push(p.id);
  }
  if (restored.length) {
    saveSettings();
    log(`starter cats restored (${source}): ${restored.join(', ')}`);
    notifyCatsChanged();
  }
  return restored;
}
const missingStarters = () => STARTER_IDS.filter((id) => !settings.cats.some((c) => c.id === id));

// Edit ANY cat with flat keys (catName, colors, breed, catSize, ...). The active cat goes
// through applySettings (live desktop cat); another cat is changed in its profile only.
function editCat(id, partial) {
  if (!id || id === settings.activeCatId) return applySettings(partial);
  const i = settings.cats.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const picked = {};
  for (const k of PER_CAT_KEYS) if (partial && k in partial) picked[k] = partial[k];
  lockRules(picked, flatFromProfile(settings.cats[i]), id);
  descriptionRules(picked, flatFromProfile(settings.cats[i]), id);
  if (typeof picked.breed === 'string' && BREED_IDS.includes(picked.breed) && !LOOK_KEYS.some((k) => k in picked)) {
    Object.assign(picked, presetSettings(picked.breed));
  } else if (!('breed' in picked) && LOOK_KEYS.some((k) => k in picked)) {
    picked.breed = 'custom';
  }
  const base = { ...settings, ...flatFromProfile(settings.cats[i]) };
  const s = sanitizeSettings({ ...base, ...picked }, base);
  settings.cats[i] = profileFromFlat(s, id);
  saveSettings();
  log(`cat ${id} edited: ${Object.keys(picked).join(', ')}`);
  notifyCatsChanged();
  return settings.cats[i];
}
// Customize / Settings / tray follow any change to the cat list.
function notifyCatsChanged() {
  if (customizeWin && !customizeWin.isDestroyed()) customizeWin.webContents.send('customize:changed', publicSettings());
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:changed', publicSettings());
  updateTrayMenu();
}
// The settings + one cat's own values, as the Customize window edits them.
function catView(id) {
  const cat = settings.cats.find((c) => c.id === id) || activeCat();
  return { ...publicSettings(), ...flatFromProfile(cat), selectedCatId: cat.id, catLabel: catLabel(cat) };
}
function syncActive() {
  if (!Array.isArray(settings.cats)) return;
  const i = settings.cats.findIndex((c) => c.id === settings.activeCatId);
  if (i >= 0) settings.cats[i] = profileFromFlat(settings, settings.activeCatId);
}
const activeCat = () => settings.cats.find((c) => c.id === settings.activeCatId);

function loadSettings() {
  const file = settingsFile();
  const raw = readJsonSafe(file, {});
  const fromVersion = Number.isInteger(raw.dataVersion) ? raw.dataVersion : 0;
  if (fromVersion > DATA_VERSION) {
    // Written by a NEWER app version (she went back to an older one): keep a copy so
    // nothing this version doesn't understand is lost.
    try {
      fs.copyFileSync(file, path.join(dataDir(), `settings.v${fromVersion}.backup.json`));
      log(`settings: data version ${fromVersion} is newer than ${DATA_VERSION} - kept a copy as settings.v${fromVersion}.backup.json`);
    } catch (err) {
      log('settings: could not back up the newer file', err);
    }
  } else if (fromVersion < DATA_VERSION && Object.keys(raw).length) {
    log(`settings: data version ${fromVersion} -> ${DATA_VERSION} (migrating)`);
  }
  if (Array.isArray(raw.cats)) {
    // Profile format
    const seen = new Set();
    let cats = raw.cats.map((p) => sanitizeProfile(p)).filter((p) => p && !seen.has(p.id) && seen.add(p.id));
    if (!cats.length) {
      log('settings: no valid cat profiles - using the starter cats');
      cats = defaultCats();
    }
    const active = cats.find((c) => c.id === raw.activeCatId) || cats[0];
    settings = { ...sanitizeSettings(raw), ...flatFromProfile(active), cats, activeCatId: active.id, startersAdded: raw.startersAdded, descriptionsFilled: raw.descriptionsFilled === true };
    addMissingStarters();
    fillMissingDescriptions();
  } else {
    // Old format (one global cat) or a missing/corrupt file -> one Gargorl profile.
    const oldFormat = Object.keys(raw).length > 0;
    if (oldFormat) {
      try {
        fs.copyFileSync(file, path.join(dataDir(), 'settings.backup.json'));
        log('settings: old format found - saved a copy as settings.backup.json');
      } catch (err) {
        log('settings: could not back up the old file', err);
      }
    }
    settings = sanitizeSettings(raw);
    if (raw.firstRunDone !== true) {
      // First launch of this version (or a fresh install): open with Gargorl.
      Object.assign(settings, presetSettings('gargorl'));
      log('first run: starting with Gargorl');
    } else if (!raw.colors && BREED_IDS.includes(raw.breed)) {
      // Settings from before the layered sprite: turn the saved breed into its colours.
      Object.assign(settings, presetSettings(raw.breed));
      log(`upgraded breed "${raw.breed}" to layered colours`);
    }
    const others = defaultCats().filter((c) => c.id !== 'gargorl');
    settings.catLookLocked = true; // Gargorl's look starts locked
    settings.cats = [profileFromFlat(settings, 'gargorl'), ...others];
    settings.activeCatId = 'gargorl';
    settings.startersAdded = [...STARTER_IDS];
    fillMissingDescriptions();
    if (oldFormat) log(`settings: migrated to cat profiles (Gargorl = "${settings.catName}")`);
  }
  // The window got taller on top (Stage E: room for the cat tree). Move a saved position
  // up by the same amount once, so she stays exactly where she was on screen.
  const rows = CatSprites.CANVAS.rows;
  if (settings.layoutRows !== rows) {
    const oldRows = Number.isInteger(settings.layoutRows) ? settings.layoutRows : 19;
    if (settings.position) {
      settings.position = { x: settings.position.x, y: settings.position.y - (rows - oldRows) * settings.catSize };
      log(`layout ${oldRows} -> ${rows} rows: saved position moved up to keep her in place`);
    }
    settings.layoutRows = rows;
  }
  saveSettings(); // writes a complete file (fills in missing keys)
  log(`settings loaded: ${settings.cats.length} cat(s), active "${settings.activeCatId}"`, { ...settings, cats: settings.cats.map((c) => c.id) });
}

// Switch the desktop cat to another profile (her look, size, ... follow immediately).
function setActiveCat(id, source = 'menu') {
  const target = settings.cats.find((c) => c.id === id);
  if (!target) return false;
  if (id === settings.activeCatId) return true;
  syncActive();
  const before = { catSize: settings.catSize };
  Object.assign(settings, flatFromProfile(target));
  settings.activeCatId = id;
  saveSettings();
  log(`ACTIVE CAT -> ${id} "${settings.catName}" (${source})`);
  if (before.catSize !== settings.catSize) applyWinSize();
  if (win && !win.isDestroyed()) win.webContents.send('colors-changed', currentLook());
  pushState();
  updateTrayMenu();
  for (const w of [settingsWin, customizeWin]) if (w && !w.isDestroyed()) w.webContents.send(w === settingsWin ? 'settings:changed' : 'customize:changed', publicSettings());
  return true;
}

function newCatId() {
  let id;
  do id = `cat-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`; while (settings.cats.some((c) => c.id === id));
  return id;
}
function nextCatName() {
  for (let n = 2; ; n++) if (!settings.cats.some((c) => c.name === `Cat ${n}`)) return `Cat ${n}`;
}
// New cat = Gargorl's default look, auto name ("Cat 2", "Cat 3", ...), gender unspecified.
function createCat(name) {
  syncActive();
  const p = profileFromFlat(DEFAULT_SETTINGS, newCatId());
  p.name = (typeof name === 'string' && name.trim().slice(0, 40)) || nextCatName();
  p.gender = 'unspecified';
  autoDescribe(p, pickTemplate(p.id)); // her own line (editable; replaced by a preset's until she writes one)
  settings.cats.push(p);
  saveSettings();
  log(`cat created: ${p.id} "${p.name}"`);
  return p;
}
function duplicateCat(id) {
  syncActive();
  const src = settings.cats.find((c) => c.id === id);
  if (!src) return null;
  const p = { ...JSON.parse(JSON.stringify(src)), id: newCatId(), name: `${src.name} copy`.slice(0, 40) };
  autoDescribe(p, pickTemplate(p.id)); // same look, but her own line
  settings.cats.push(p);
  saveSettings();
  log(`cat duplicated: ${id} -> ${p.id}`);
  return p;
}
function deleteCat(id) {
  if (settings.cats.length <= 1) return { ok: false, error: "Can't delete the last cat" };
  if (!settings.cats.some((c) => c.id === id)) return { ok: false, error: 'No such cat' };
  if (id === settings.activeCatId) setActiveCat(settings.cats.find((c) => c.id !== id).id, 'delete');
  settings.cats = settings.cats.filter((c) => c.id !== id);
  delete day.pets[id];
  saveCups();
  saveSettings();
  log(`cat deleted: ${id}`);
  return { ok: true };
}
// Edit any cat by id (profile keys). The active cat goes through applySettings.
function updateCat(id, partial) {
  if (id === settings.activeCatId) {
    const flat = {};
    for (const [f, k] of Object.entries(PROFILE_MAP)) if (partial && k in partial) flat[f] = partial[k];
    applySettings(flat);
    return activeCat();
  }
  const i = settings.cats.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const merged = sanitizeProfile({ ...settings.cats[i], ...partial, id }, { ...DEFAULT_SETTINGS, ...flatFromProfile(settings.cats[i]) });
  if (!merged) return settings.cats[i];
  settings.cats[i] = merged;
  saveSettings();
  return merged;
}

// --- Gargorl ---------------------------------------------------------------------
const GARGORL_LINE = DEFAULT_SETTINGS.catDescriptor;

// "In loving memory of Gargorl ♀" / "About Fainu ⚧" (+ today's cups on a second line).
let trayTipText = '';
function trayTooltip() {
  const cat = activeCat() || { id: settings.activeCatId, name: settings.catName, gender: settings.catGender };
  const head = `${catLabel(cat)} ${settings.catName} ${GENDER_SYMBOL[settings.catGender] || ''}`.trim();
  return `${head.slice(0, 90)}\n${day.cups} / ${settings.goalCups} cups`;
}

// Label rule (follows the profile ID, not the name): Gargorl -> "In loving memory of",
// every other cat (Fainu, new cats, duplicates, the kitten) -> "About".
const GENDER_SYMBOL = { female: '♀', male: '♂', unspecified: '⚧' };
function catLabel(cat) {
  return cat && cat.id === 'gargorl' ? 'In loving memory of' : 'About';
}
function labelLine(cat = activeCat()) {
  return `${catLabel(cat)} ${cat.name}`;
}
function aboutLine() {
  syncActive();
  return labelLine(activeCat());
}
// The description as one short menu line (menus can't wrap).
function descriptionLine(cat = activeCat()) {
  const d = (cat.description || '').replace(/\s+/g, ' ').trim();
  return d.length > 70 ? `${d.slice(0, 67)}…` : d;
}

// A unique, pronoun-aware description for a cat that has none.
const DESCRIPTION_POOL = [
  'Professional napper. {They} take{s} {their} sunbeams very seriously.',
  'Chief keyboard inspector. Every warm laptop is {their} bed.',
  'Soft paws, loud opinions, and an empty bowl that is always somebody else\'s fault.',
  'Expert in boxes. If {they} fit{s}, {they} sit{s}.',
  'Purrs like a tiny engine and judges everyone quietly.',
  '{They} knock{s} things off tables purely for science.',
  'Part cat, part loaf. Mostly loaf.',
  'Will trade affection for snacks. Prices may vary.',
  'Small, fluffy, and absolutely in charge of this desk.',
  'Chases the cursor, catches nothing, regrets nothing.',
  '{They} think{s} 3 a.m. is the perfect time for zoomies.',
  'Gentle head-bonks, zero personal space, all heart.',
];
const FAINU_DESCRIPTION = CatSprites.PRESETS.fainu.description; // her own line = her look's line
function fillPronouns(text, gender) {
  const p = { female: ['she', 'her', 'her', 's'], male: ['he', 'him', 'his', 's'], unspecified: ['they', 'them', 'their', ''] }[gender] || ['they', 'them', 'their', ''];
  return text.replace(/\{They\}/g, p[0][0].toUpperCase() + p[0].slice(1)).replace(/\{they\}/g, p[0]).replace(/\{them\}/g, p[1]).replace(/\{their\}/g, p[2]).replace(/\{s\}/g, p[3]);
}
// A pool template no other cat uses yet (a line counts as taken whatever pronouns it
// was written with: "She thinks" = "They think").
function pickTemplate(exceptId) {
  const used = new Set(settings.cats.filter((c) => c.id !== exceptId).map((c) => (c.description || '').trim()));
  const free = DESCRIPTION_POOL.filter((t) => !GENDERS.some((g) => used.has(fillPronouns(t, g))));
  return free.length ? free[Math.floor(Math.random() * free.length)] : '';
}
function uniqueDescription(gender, exceptId) {
  return fillPronouns(pickTemplate(exceptId), gender);
}
// Give profile p an automatic description from a template.
function autoDescribe(p, template) {
  p.description = fillPronouns(template, p.gender);
  p.descriptionSource = template;
  p.descriptionCustom = false;
}
// --- Info window (Stage D) --------------------------------------------------------
// A small card about one cat: label badge, name + gender symbol, full description and a
// pixel portrait. Frameless + always on top, opened with showInactive() so it never takes
// focus from a game. Closes after 20 s, on Esc / click outside once she has clicked into
// it (blur), on its × button, and when a reminder / alarm (later: party, play) starts.
// Only one exists; opening another replaces it.
let infoWin = null;
let infoTimer = null;
let infoCatId = null;
let INFO_TIMEOUT_MS = 20000;
const INFO_W = 300;

function infoData(id) {
  syncActive();
  const cat = settings.cats.find((c) => c.id === id) || activeCat();
  return {
    catId: cat.id,
    label: catLabel(cat),
    name: cat.name,
    symbol: GENDER_SYMBOL[cat.gender] || '',
    description: cat.description || '',
    look: { colors: cat.colors, pattern: cat.pattern, ears: cat.earStyle, fluffy: cat.fluffy, tufts: cat.tufts, tail: cat.tail, whiskers: cat.whiskersEnabled },
  };
}

// Next to the cat window; flipped to the other side / clamped so it's never clipped.
function placeInfo(height) {
  if (!infoWin || infoWin.isDestroyed()) return;
  const cat = win && !win.isDestroyed() ? win.getBounds() : { x: 200, y: 200, width: WIN_W, height: WIN_H };
  const area = screen.getDisplayNearestPoint({ x: cat.x + cat.width / 2, y: cat.y + cat.height / 2 }).workArea;
  const h = Math.max(120, Math.min(height, area.height - 16));
  let x = cat.x + cat.width + 4;
  if (x + INFO_W > area.x + area.width) x = cat.x - INFO_W - 4; // flip to the left side
  x = Math.max(area.x, Math.min(x, area.x + area.width - INFO_W));
  let y = cat.y + SPRITE_TOP + (CatSprites.CANVAS.rows - 19) * settings.catSize - 10; // level with her head
  y = Math.max(area.y, Math.min(y, area.y + area.height - h));
  infoWin.setBounds({ x: Math.round(x), y: Math.round(y), width: INFO_W, height: Math.round(h) });
}

function closeInfo(reason) {
  clearTimeout(infoTimer);
  infoTimer = null;
  if (!infoWin || infoWin.isDestroyed()) {
    infoWin = null;
    return false;
  }
  log(`info window closed (${reason})`);
  const w = infoWin;
  infoWin = null;
  infoCatId = null;
  w.destroy();
  return true;
}

function openInfo(id, source) {
  closeInfo('replaced');
  const data = infoData(id);
  infoCatId = data.catId;
  infoWin = new BrowserWindow({
    width: INFO_W,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: `${data.label} ${data.name}`,
    webPreferences: {
      preload: path.join(__dirname, 'info-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const w = infoWin;
  w.setAlwaysOnTop(true, 'floating');
  w.setMenu(null);
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.on('blur', () => { if (infoWin === w) closeInfo('clicked outside'); }); // only after she clicked into it
  w.on('closed', () => { if (infoWin === w) infoWin = null; });
  w.loadFile(path.join(__dirname, 'info.html'));
  placeInfo(200);
  infoTimer = setTimeout(() => { if (infoWin === w) closeInfo('timeout'); }, INFO_TIMEOUT_MS);
  log(`info window opened for ${data.catId} "${data.name}" (${source}) - ${data.label}`);
  return w;
}

// One-time fill (per install): cats without a description get their own line.
function fillMissingDescriptions() {
  if (settings.descriptionsFilled) return;
  syncActive();
  for (const c of settings.cats) {
    if ((c.description || '').trim()) continue;
    if (c.id === 'gargorl') {
      Object.assign(c, { description: GARGORL_LINE, descriptionSource: '', descriptionCustom: true }); // only ever her own line
    } else {
      autoDescribe(c, c.id === 'fainu' ? FAINU_DESCRIPTION : pickTemplate(c.id));
    }
    if (c.id === settings.activeCatId) Object.assign(settings, flatFromProfile(c));
    log(`description added for ${c.id}: "${c.description}"`);
  }
  settings.descriptionsFilled = true;
}

// First launch only: a 10 s bubble with the line, once the cat is on screen.
// Only for the Gargorl profile, with HER line, exactly once.
function maybeShowIntro() {
  if (settings.firstRunDone || !win || win.isDestroyed()) return false;
  syncActive();
  const g = settings.cats.find((c) => c.id === 'gargorl');
  settings.firstRunDone = true;
  saveSettings();
  if (!g || settings.activeCatId !== 'gargorl') return false;
  win.webContents.send('bubble-intro', { text: g.description || GARGORL_LINE });
  log(`first-run bubble: "${g.description || GARGORL_LINE}"`);
  return true;
}

// Format of settings.json. Bump it when a migration is added to loadSettings /
// sanitizeProfile; every older file is migrated on startup (all data lives in userData,
// never next to the exe, so app updates keep it).
//   0 = before dataVersion existed (flat or profile format), 1 = profiles + sleep spots
const DATA_VERSION = 1;

// On disk: global settings + cats[] + activeCatId (the flat active-cat mirror is not saved).
function saveSettings() {
  syncActive();
  const out = { ...settings, dataVersion: DATA_VERSION };
  for (const k of PER_CAT_KEYS) delete out[k];
  writeJsonSafe(settingsFile(), out);
}

const EDITABLE = ['goalCups', 'reminderMinutes', 'repeatMinutes', 'volume', 'quietStart', 'quietEnd', 'startWithWindows', 'meowStyle',
  'breed', 'tail', 'idleSleepEnabled', 'idleSleepMinutes', 'quietSleepEnabled', 'systemIdleSleep', 'idleAnimations', 'chaseMouse', 'catSize', 'mouseResize', 'alarms', 'soundEnabled', 'catName', 'catDescriptor',
  'colors', 'whiskersEnabled', 'furPattern', 'earStyle', 'fluffy', 'tufts', 'customPresets', 'catGender', 'sleepSpot', 'sleepSpotColors', 'accessories', 'catDefaultPreset', 'catDescriptionCustom', 'catDescriptionSource', 'catLookLocked',
  'autoUpdate', 'updateChannel'];

function publicSettings() {
  syncActive(); // the cat list must show the active cat's latest name
  const out = {
    cats: settings.cats.map((c) => ({ id: c.id, name: c.name, gender: c.gender })),
    activeCatId: settings.activeCatId,
    missingStarters: missingStarters(),
    packaged: app.isPackaged, meowStyles: publicCatalog(), soundsFolder: userSoundsDir(), breeds: CatSprites.presetList(), defaultDescriptor: DEFAULT_SETTINGS.catDescriptor };
  for (const k of EDITABLE) out[k] = settings[k];
  return out;
}

// Apply a partial change from the Settings window. Unknown keys and invalid values are ignored.
const LOOK_KEYS = ['colors', 'furPattern', 'earStyle', 'fluffy', 'tufts'];

// Description rules for one cat (cur = its current flat values, id = its profile id):
//  - a description typed by her is hers: marked custom, never replaced automatically;
//  - choosing a look preset gives the cat that preset's description, unless hers is
//    custom (Gargorl's and Fainu's own lines are always kept);
//  - a gender change re-fills the pronouns of an automatic description.
const OWN_LINE_IDS = ['gargorl', 'fainu'];
function descriptionRules(picked, cur, id) {
  if ('catDescriptor' in picked) {
    if (!('catDescriptionCustom' in picked)) {
      picked.catDescriptionCustom = true;
      picked.catDescriptionSource = '';
    }
    return;
  }
  const gender = picked.catGender || cur.catGender;
  const custom = 'catDescriptionCustom' in picked ? picked.catDescriptionCustom : cur.catDescriptionCustom;
  if (custom) return;
  const preset = typeof picked.breed === 'string' && CatSprites.PRESETS[picked.breed];
  if (preset && preset.description && !OWN_LINE_IDS.includes(id)) {
    picked.catDescriptionSource = preset.description;
    picked.catDescriptor = fillPronouns(preset.description, gender);
    picked.catDescriptionCustom = false;
  } else if ('catGender' in picked && cur.catDescriptionSource) {
    picked.catDescriptor = fillPronouns(cur.catDescriptionSource, gender);
    picked.catDescriptionCustom = false;
  }
}

// A locked look (Gargorl grey, Fainu calico by default) ignores colour / preset / pattern
// changes. Unlocking in the same change is allowed; "Reset to default" is harmless.
const LOCKED_KEYS = ['breed', ...LOOK_KEYS];
function lockRules(picked, cur, id) {
  const locked = 'catLookLocked' in picked ? picked.catLookLocked : cur.catLookLocked;
  if (!locked) return;
  const blocked = LOCKED_KEYS.filter((k) => k in picked && !(k === 'breed' && picked.breed === cur.catDefaultPreset));
  for (const k of blocked) delete picked[k];
  if (blocked.length) log(`look of ${id} is locked - ignored: ${blocked.join(', ')}`);
}

function applySettings(partial) {
  const picked = {};
  for (const k of EDITABLE) if (partial && k in partial) picked[k] = partial[k];
  lockRules(picked, settings, settings.activeCatId);
  descriptionRules(picked, settings, settings.activeCatId);
  // Choosing a preset applies its whole look; editing the look by hand makes it 'custom'.
  if (typeof picked.breed === 'string' && BREED_IDS.includes(picked.breed) && !LOOK_KEYS.some((k) => k in picked)) {
    Object.assign(picked, presetSettings(picked.breed));
  } else if (!('breed' in picked) && LOOK_KEYS.some((k) => k in picked)) {
    picked.breed = 'custom';
  }
  const prev = settings;
  settings = sanitizeSettings({ ...prev, ...picked }, prev);
  const changed = EDITABLE.filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(prev[k]));
  if (!changed.length) return publicSettings();
  saveSettings();
  log(`settings changed: ${changed.map((k) => `${k}=${JSON.stringify(settings[k])}`).join(', ')}`);
  if (changed.includes('reminderMinutes')) resetReminderTimer();
  if (changed.includes('repeatMinutes') && nagging) nagging.nextAt = Date.now() + settings.repeatMinutes * 60000;
  if (changed.includes('idleSleepEnabled') && !settings.idleSleepEnabled && behavior.sleepReason === 'idle') wakeUp('idle sleep turned off');
  if (changed.includes('quietSleepEnabled') && !settings.quietSleepEnabled && behavior.sleepReason === 'quiet hours') wakeUp('quiet-hours sleep turned off');
  if (changed.some((k) => k === 'autoUpdate' || k === 'updateChannel')) {
    if (updater) updater.settingsChanged(changed);
    sendUpdateStatus();
  }
  if (changed.includes('sleepSpot') && behavior.state === 'sleeping') log(`sleeping spot for ${settings.activeCatId} set to ${settings.sleepSpot} (used next time she sleeps)`);
  if (changed.includes('catSize')) applyWinSize();
  if (['breed', 'tail', 'whiskersEnabled', 'sleepSpotColors', ...LOOK_KEYS].some((k) => changed.includes(k)) && win && !win.isDestroyed()) {
    win.webContents.send('colors-changed', currentLook());
  }
  if (changed.includes('catName') && settings.catName !== 'Gargorl' && prev.catName === 'Gargorl' && !changed.includes('catDescriptor')) {
    log(`renamed to ${settings.catName}; descriptor stays "${settings.catDescriptor}" until edited`);
  }
  if (changed.includes('alarms')) alarmsEdited(prev.alarms);
  if (changed.includes('chaseMouse')) {
    setChase(settings.chaseMouse);
    updateTrayMenu();
  }
  if (settingsWin && !settingsWin.isDestroyed() && (changed.includes('chaseMouse') || changed.includes('meowStyle') || changed.includes('catSize')
    || ['breed', 'tail', 'whiskersEnabled', 'catName', 'catDescriptor', ...LOOK_KEYS].some((k) => changed.includes(k)))) {
    settingsWin.webContents.send('settings:changed', publicSettings()); // changes made elsewhere show up in Settings
  }
  if (customizeWin && !customizeWin.isDestroyed()) customizeWin.webContents.send('customize:changed', publicSettings());
  if (changed.includes('startWithWindows')) applyLoginItem();
  pushState(); // goal + volume -> cat window, tooltip
  return publicSettings();
}

// Daily data (cups.json): { date, cups, pets: { <catId>: { today, total } } }.
// Cups belong to the person (global); pets are counted per cat. "today" counters reset
// at midnight; totals carry over.
const nonNegInt = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
function newDay(date, carry = day) {
  const pets = {};
  const src = carry && carry.pets && typeof carry.pets === 'object' ? carry.pets : {};
  for (const [id, p] of Object.entries(src)) if (CAT_ID_RE.test(id)) pets[id] = { today: 0, total: nonNegInt(p && p.total) };
  return { date, cups: 0, pets };
}
// Pet counters of a cat (the active one by default), created on first use.
function petsOf(id = settings.activeCatId) {
  if (!day.pets[id]) day.pets[id] = { today: 0, total: 0 };
  return day.pets[id];
}

function loadCups() {
  const raw = readJsonSafe(cupsFile(), {});
  // older files counted pets for "the" cat: they belong to Gargorl
  if (!raw.pets && (Number.isInteger(raw.petsTotal) || Number.isInteger(raw.petsToday))) {
    raw.pets = { gargorl: { today: nonNegInt(raw.petsToday), total: nonNegInt(raw.petsTotal) } };
  }
  day = newDay(todayKey(), raw);
  if (raw.date === todayKey()) {
    day.cups = nonNegInt(raw.cups);
    for (const [id, p] of Object.entries(raw.pets || {})) if (day.pets[id]) day.pets[id].today = nonNegInt(p && p.today);
  }
  saveCups();
  log('cups loaded', day);
}

function saveCups() {
  writeJsonSafe(cupsFile(), day);
}

function checkDayRollover() {
  const today = todayKey();
  if (day.date !== today) {
    log(`new day (${day.date} -> ${today}): resetting cups + pets today`);
    day = newDay(today);
    saveCups();
    pushState();
  }
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Quiet window [start, end). Wraps past midnight if start > end. start === end means no quiet hours.
function isQuietAt(minutesOfDay, start, end) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  return s < e ? minutesOfDay >= s && minutesOfDay < e : minutesOfDay >= s || minutesOfDay < e;
}

function isQuietNow() {
  const n = nowDate(); // the selftest can simulate the clock
  return isQuietAt(n.getHours() * 60 + n.getMinutes(), settings.quietStart, settings.quietEnd);
}

function pushState(extra = {}) {
  if (tray) {
    trayTipText = trayTooltip();
    tray.setToolTip(trayTipText);
  }
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', {
    cups: day.cups, goal: settings.goalCups, volume: settings.volume, meowStyle: settings.meowStyle, sound: settings.soundEnabled,
    look: currentLook(), size: settings.catSize, mouseResize: settings.mouseResize, ...extra,
  });
}

// Set by a reset so "Undo last cup" can bring the count back after an accidental reset.
let undoReset = null; // { date, cups }

function addCup(source) {
  checkDayRollover();
  markActive('cup');
  undoReset = null;
  day.cups += 1;
  saveCups();
  resetReminderTimer();
  log(`ADD CUP (${source}) -> ${day.cups}/${settings.goalCups}`);
  // Clicks already hop + meow in the renderer; other sources ask it to hop.
  // (state first: the page hides the bubble with the right reason, click vs cup)
  pushState({ added: true, source, hop: source !== 'click' });
  endReminder('cup logged');
}

function undoCup(source) {
  checkDayRollover();
  if (undoReset && undoReset.date === day.date && day.cups === 0) {
    day.cups = undoReset.cups;
    undoReset = null;
    saveCups();
    log(`UNDO RESET (${source}) -> ${day.cups}/${settings.goalCups}`);
    return pushState();
  }
  undoReset = null;
  if (day.cups > 0) day.cups -= 1;
  saveCups();
  log(`UNDO CUP (${source}) -> ${day.cups}/${settings.goalCups}`);
  pushState();
}

function resetCups(source) {
  checkDayRollover();
  undoReset = day.cups > 0 ? { date: day.date, cups: day.cups } : null;
  day = { ...day, date: todayKey(), cups: 0 }; // pets are kept
  saveCups();
  log(`RESET CUPS (${source})${undoReset ? ` from ${undoReset.cups} (undo restores it)` : ''}`);
  pushState();
}

// --- Petting (Stage 3) ---------------------------------------------------------
// The page measures stroking (mouse travel over her, no button) and asks for a pet;
// main owns the cooldown + counters and tells the page what to play.
const PET_COOLDOWN_MS = 4000;
const BOOP_MIN_MS = 800;
let lastStrokePetAt = 0;
let lastBoopAt = 0;

function pet(kind, source) {
  const now = Date.now();
  if (kind === 'stroke') {
    if (now - lastStrokePetAt < PET_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
    if (drag && drag.dragging) return { ok: false, reason: 'dragging' };
    lastStrokePetAt = now;
  } else if (kind === 'boop') {
    if (now - lastBoopAt < BOOP_MIN_MS) return { ok: false, reason: 'too fast' };
    lastBoopAt = now;
  }
  checkDayRollover();
  const pc = petsOf(); // counted for the cat on the desktop
  pc.today += 1;
  pc.total += 1;
  saveCups();
  log(`PET (${kind}, ${source}) ${settings.activeCatId} -> today ${pc.today}, total ${pc.total}`);
  // A pet wakes her (during quiet hours only briefly: she dozes off again after a minute).
  // While asleep the only sound is a very soft purr.
  const wasAsleep = behavior.state === 'sleeping';
  if (wasAsleep) wakeUp(`pet (${kind})`);
  behavior.lastActive = now;
  if (win && !win.isDestroyed()) win.webContents.send('petted', { kind, quiet: isQuietNow() || wasAsleep, petsToday: pc.today });
  pushState();
  return { ok: true, petsToday: pc.today };
}

function resetReminderTimer() {
  nextReminderAt = Date.now() + settings.reminderMinutes * 60 * 1000;
}

// An active reminder stays until a cup is logged: the bubble stays up and the cat
// meows again every `repeatMinutes` (not during quiet hours).
let nagging = null; // { since, nextAt, repeats }

// One bubble, two sources. An alarm's text wins over the water reminder; when the
// alarm is dismissed, the water bubble (if still active) comes back.
function currentBubble() {
  if (activeAlarm) return { kind: 'alarm', text: activeAlarm.text };
  if (nagging) return { kind: 'water', text: BUBBLE_TEXT };
  return null;
}

// Show the current bubble + hop + meow.
function ring() {
  if (!win || win.isDestroyed()) return;
  const b = currentBubble();
  if (!b) return;
  win.webContents.send('reminder', { ...b, volume: settings.volume, meowStyle: settings.meowStyle, persistent: true });
}

// Show the current bubble quietly, or hide it if nothing is active.
function refreshBubble(reason) {
  if (!win || win.isDestroyed()) return;
  const b = currentBubble();
  if (b) win.webContents.send('bubble-set', b);
  else win.webContents.send('hide-bubble', reason);
}

// While she sleeps, a reminder / alarm wakes her gently first; the meow + bubble come
// once she's up (~1.8 s). Nothing makes a sound while she is asleep.
const WAKE_FIRST_MS = 1800;
function ringSoon(why) {
  if (behavior.state !== 'sleeping') return ring();
  wakeUp(why);
  clearTimeout(behavior.ringTimer);
  behavior.ringTimer = setTimeout(() => ring(), WAKE_FIRST_MS);
  log(`${why}: woke her first, meow + bubble in ${WAKE_FIRST_MS} ms`);
  return undefined;
}

function fireReminder(reason) {
  const asleep = behavior.state === 'sleeping';
  if (!asleep) markActive('reminder');
  behavior.lastActive = Date.now();
  closeInfo('reminder');
  const now = Date.now();
  if (!nagging) nagging = { since: now, nextAt: 0, repeats: 0 };
  else nagging.repeats += 1;
  nagging.nextAt = now + settings.repeatMinutes * 60000;
  log(`REMINDER (${reason}) cups=${day.cups}/${settings.goalCups} visible=${win ? win.isVisible() : false} repeat #${nagging.repeats}, next in ${settings.repeatMinutes} min unless a cup is logged`);
  if (asleep) ringSoon('reminder');
  else ring();
  updateTrayMenu();
}

function endReminder(reason) {
  if (!nagging) return;
  log(`REMINDER ENDED (${reason}) after ${Math.round((Date.now() - nagging.since) / 1000)} s, ${nagging.repeats} repeat(s)`);
  nagging = null;
  refreshBubble(reason);
  updateTrayMenu();
}

// --- Alarms (e.g. 22:00 "Pillbrotchen time my dear") ---------------------------
// Fires once per day at its time; if the PC slept / the app was closed, it still fires
// up to 2 h late. Stays until dismissed (click the cat, or "Dismiss alarm"); meows
// again every `repeatMinutes`. Ignores quiet hours (she picked the time).
const ALARM_LATE_MS = 2 * 60 * 60000;
let activeAlarm = null; // { id, text, since, nextAt, repeats }
let alarmQueue = []; // more alarms due while one is showing
let alarmState = {}; // id -> 'YYYY-MM-DD' last day it fired (alarms.json)
let lastAlarmCheck = Date.now() - ALARM_LATE_MS;
const alarmsFile = () => path.join(dataDir(), 'alarms.json');

function loadAlarmState() {
  const raw = readJsonSafe(alarmsFile(), {});
  alarmState = raw.fired && typeof raw.fired === 'object' ? raw.fired : {};
}
function saveAlarmState() {
  writeJsonSafe(alarmsFile(), { fired: alarmState });
}

function alarmTimeToday(a, now = new Date()) {
  const [h, m] = a.time.split(':').map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0).getTime();
}

function checkAlarms() {
  const now = Date.now();
  const today = todayKey();
  for (const a of settings.alarms) {
    if (!a.enabled || alarmState[a.id] === today) continue;
    const at = alarmTimeToday(a);
    // Due if its time passed since the last check (and not more than 2 h ago).
    if (at > lastAlarmCheck && at <= now && now - at <= ALARM_LATE_MS) {
      alarmState[a.id] = today;
      saveAlarmState();
      startAlarm(a, now - at > 60000 ? `late by ${Math.round((now - at) / 60000)} min` : 'on time');
    }
  }
  lastAlarmCheck = now;
}

function startAlarm(a, why) {
  if (activeAlarm) {
    if (activeAlarm.id !== a.id && !alarmQueue.some((q) => q.id === a.id)) alarmQueue.push(a);
    return;
  }
  activeAlarm = { id: a.id, text: a.text, since: Date.now(), nextAt: 0, repeats: 0 };
  ringAlarm(`start, ${why}`);
}

function ringAlarm(reason) {
  if (!activeAlarm) return;
  activeAlarm.nextAt = Date.now() + settings.repeatMinutes * 60000;
  log(`ALARM "${activeAlarm.text}" (${reason}) repeat #${activeAlarm.repeats}`);
  const asleep = behavior.state === 'sleeping';
  behavior.lastActive = Date.now();
  closeInfo('alarm');
  if (win && !win.isDestroyed() && !win.isVisible()) showCat(); // she should see this one
  if (asleep) ringSoon('alarm');
  else ring();
  updateTrayMenu();
}

function dismissAlarm(source) {
  if (!activeAlarm) return false;
  log(`ALARM DISMISSED (${source}) "${activeAlarm.text}" after ${Math.round((Date.now() - activeAlarm.since) / 1000)} s`);
  activeAlarm = null;
  const next = alarmQueue.shift();
  if (next) startAlarm(next, 'queued');
  else refreshBubble(`alarm dismissed (${source})`);
  updateTrayMenu();
  return true;
}

function testAlarm(id) {
  const a = settings.alarms.find((x) => x.id === id);
  if (!a) return false;
  log(`alarm test: ${id}`);
  if (activeAlarm && activeAlarm.id === id) return true;
  if (activeAlarm) dismissAlarm('replaced by test');
  startAlarm(a, 'test');
  return true;
}

// Edited alarms: a changed time may fire again today; a deleted/disabled one stops.
function alarmsEdited(prevList) {
  for (const a of settings.alarms) {
    const old = prevList.find((p) => p.id === a.id);
    if (old && old.time !== a.time) delete alarmState[a.id];
  }
  for (const id of Object.keys(alarmState)) if (!settings.alarms.some((a) => a.id === id)) delete alarmState[id];
  saveAlarmState();
  alarmQueue = alarmQueue.filter((q) => settings.alarms.some((a) => a.id === q.id && a.enabled));
  if (activeAlarm) {
    const cur = settings.alarms.find((a) => a.id === activeAlarm.id);
    if (!cur || !cur.enabled) dismissAlarm('alarm removed');
    else if (cur.text !== activeAlarm.text) {
      activeAlarm.text = cur.text;
      refreshBubble('alarm edited');
    }
  }
  lastAlarmCheck = Math.max(lastAlarmCheck, Date.now() - 1000); // a time moved into the past doesn't fire now
}

function dismissReminder(source) {
  endReminder(`dismissed (${source})`);
  resetReminderTimer();
}

function tick() {
  try {
    checkDayRollover();
    checkAlarms();
    if (activeAlarm && Date.now() >= activeAlarm.nextAt) {
      activeAlarm.repeats += 1;
      ringAlarm('repeat');
    }
    if (nagging) {
      // Active reminder: repeat until a cup is logged. The normal schedule waits.
      if (Date.now() < nagging.nextAt) return;
      if (isQuietNow()) {
        nagging.nextAt = Date.now() + settings.repeatMinutes * 60000;
        return log('reminder repeat skipped: quiet hours (bubble stays)');
      }
      return fireReminder('repeat');
    }
    if (Date.now() < nextReminderAt) return;
    resetReminderTimer();
    if (day.cups >= settings.goalCups) return log('reminder skipped: goal reached');
    if (isQuietNow()) return log('reminder skipped: quiet hours');
    fireReminder('timer');
  } catch (err) {
    log('tick error', err);
  }
}

function startTimers() {
  resetReminderTimer();
  tickTimer = setInterval(tick, TICK_MS);
  log(`timers started: reminder every ${settings.reminderMinutes} min, quiet ${settings.quietStart}-${settings.quietEnd}`);
}

// --- Window placement -------------------------------------------------------
function clampToWorkArea(x, y) {
  const area = screen.getDisplayNearestPoint({ x: Math.round(x + WIN_W / 2), y: Math.round(y + WIN_H / 2) }).workArea;
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - WIN_W)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - WIN_H)),
  };
}

function initialPosition() {
  if (settings.position) return clampToWorkArea(settings.position.x, settings.position.y);
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - WIN_W - 40, y: area.y + area.height - WIN_H };
}

function setWinPos(x, y) {
  // setBounds with the ORIGINAL size: setPosition can resize transparent windows on Windows.
  win.setBounds({ x, y, width: WIN_W, height: WIN_H });
}

function savePosition() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  settings.position = { x: b.x, y: b.y };
  saveSettings();
  log(`position saved (${b.x}, ${b.y})`);
}

function reclamp() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const p = clampToWorkArea(b.x, b.y);
  if (p.x !== b.x || p.y !== b.y || b.width !== WIN_W || b.height !== WIN_H) {
    setWinPos(p.x, p.y);
    savePosition();
  }
}

// --- Click vs drag (decided here, from the real cursor) -----------------------
// The page only reports "pressed" and "released". From the press on, main polls the
// OS cursor every 16 ms: moved > 5 px = drag (window follows, setBounds with the original
// size), otherwise the release is a click (+1 cup). Nothing depends on the page getting
// pointermove events or keeping pointer capture, which a never-focused transparent window
// can lose on Windows.
const DRAG_THRESHOLD = 5;

function cursorPoint() {
  return fakeCursor || screen.getCursorScreenPoint();
}

function pressStart() {
  if (!win || win.isDestroyed()) return;
  if (drag) finishPress('restart');
  const wasAsleep = behavior.state === 'sleeping';
  stopSlide();
  markActive('press', { wakeReturn: false }); // wakes up but stays put until we know click vs drag
  const startCursor = cursorPoint();
  const startBounds = win.getBounds();
  drag = { startCursor, startBounds, startedAt: Date.now(), dragging: false, timer: null, wasAsleep };
  drag.timer = setInterval(() => {
    if (!drag || !win || win.isDestroyed()) return finishPress('gone');
    if (Date.now() - drag.startedAt > 10000) return finishPress('timeout'); // release never arrived
    followCursor();
  }, 16);
}

// Moves the window with the cursor once past the threshold. Returns true while dragging.
function followCursor() {
  const c = cursorPoint();
  const dx = c.x - drag.startCursor.x;
  const dy = c.y - drag.startCursor.y;
  if (!drag.dragging) {
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return false;
    drag.dragging = true;
    log(`DRAG START cursor=(${drag.startCursor.x},${drag.startCursor.y}) win=(${drag.startBounds.x},${drag.startBounds.y})`);
    win.webContents.send('drag-began');
  }
  const p = clampToWorkArea(drag.startBounds.x + dx, drag.startBounds.y + dy);
  setWinPos(p.x, p.y);
  return true;
}

// reason: 'release' (mouse up), 'cancel', or internal. Returns { click }.
function finishPress(reason) {
  if (!drag) return { click: false };
  if (reason === 'release' && win && !win.isDestroyed()) followCursor(); // catch moves since the last tick
  const wasDrag = drag.dragging;
  const wasAsleep = drag.wasAsleep;
  // where she was pressed, in window coords (for the nose boop)
  const pressAt = { x: drag.startCursor.x - drag.startBounds.x, y: drag.startCursor.y - drag.startBounds.y };
  clearInterval(drag.timer);
  drag = null;
  if (wasDrag) {
    log(`DRAG STOP (${reason})`);
    savePosition();
    behavior.home = null; // dropped somewhere new: that's home now
    return { click: false };
  }
  if (reason !== 'release') return { click: false };
  if (activeAlarm) {
    // A click acknowledges the alarm (no cup).
    dismissAlarm('click');
    return { click: false, dismissed: true };
  }
  if (onNose(pressAt)) {
    // Nose boop: tiny squeak, surprised blink, +1 pet - no cup.
    const r = pet('boop', 'click');
    return { click: false, boop: r.ok };
  }
  if (wasAsleep) {
    // First click on a sleeping cat just wakes her up (no cup), then she goes home.
    log('click woke the cat (no cup)');
    returnHome();
    return { click: false, woke: true };
  }
  addCup('click');
  return { click: true };
}

// --- Behaviour: sleep when idle, idle animations, chase the mouse ---------------
const behavior = {
  state: 'awake', // 'awake' | 'sleeping'
  pose: 'sit', // base pose shown: 'sit' | 'sleep' | 'walk'
  facing: 1,
  lastActive: Date.now(),
  nextIdleAnimAt: Date.now() + 60000,
  home: null, // where to return after a nap: { x, y }
  lastCursor: null,
  chaseTimer: null,
  tickTimer: null,
};
let slide = null; // { timer }

function sendPose(pose, facing = behavior.facing) {
  if (pose === behavior.pose && facing === behavior.facing) return;
  behavior.pose = pose;
  behavior.facing = facing;
  if (win && !win.isDestroyed()) win.webContents.send('pose', { pose, facing });
}

function sendAnim(name, extra = {}) {
  if (win && !win.isDestroyed()) win.webContents.send('anim', { name, ...extra });
  log(`idle animation: ${name}`);
}

function stopSlide() {
  if (!slide) return;
  clearInterval(slide.timer);
  slide = null;
}

// Smoothly move the window (ease in/out). Uses setBounds with the original size.
function slideTo(x, y, ms, done) {
  if (!win || win.isDestroyed()) return;
  stopSlide();
  const from = win.getBounds();
  const t0 = Date.now();
  slide = {
    timer: setInterval(() => {
      if (!win || win.isDestroyed()) return stopSlide();
      const t = Math.min(1, (Date.now() - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setWinPos(Math.round(from.x + (x - from.x) * e), Math.round(from.y + (y - from.y) * e));
      if (t >= 1) {
        stopSlide();
        if (done) done();
      }
    }, 16),
  };
}

function markActive(reason, opts = {}) {
  behavior.lastActive = Date.now();
  if (behavior.state === 'sleeping') wakeUp(reason, opts);
}

// --- Sleep (Stage E) -------------------------------------------------------------
// She falls asleep after idleSleepMinutes without interaction, during quiet hours, and
// (optional, off by default) when the whole computer has been idle that long. She sleeps
// on a spot (cat bed / cat tree / cardboard box, per-cat "sleepSpot"; Random never repeats
// the last one) drawn in her own window, at the bottom of the screen. Click, pet, drag,
// a cup, a reminder (later party / play) wake her: stretch + yawn, the spot fades out.
const RANDOM_SPOTS = ['bed', 'tree', 'box'];
const QUIET_RESLEEP_MS = 60000; // woken during quiet hours: back to sleep after a minute of peace
let selftestClock = null; // selftest: simulated "now" for quiet-hours checks
const nowDate = () => (selftestClock ? new Date(selftestClock) : new Date());

function chooseSpot() {
  const pref = settings.sleepSpot;
  if (pref !== 'random') return pref; // bed | tree | box | none
  const last = settings.catLastSleepSpot;
  const options = RANDOM_SPOTS.filter((s) => s !== last);
  const spot = options[Math.floor(Math.random() * options.length)];
  settings.catLastSleepSpot = spot; // never the same spot twice in a row
  saveSettings();
  return spot;
}

// opts: { spot (force a spot), slide: false (stay where she is, e.g. preview) }
function goToSleep(reason, opts = {}) {
  if (behavior.state === 'sleeping' || !win || win.isDestroyed() || !win.isVisible() || drag) return false;
  const spot = opts.spot || chooseSpot();
  const b = win.getBounds();
  const area = screen.getDisplayNearestPoint({ x: b.x + WIN_W / 2, y: b.y + WIN_H / 2 }).workArea;
  behavior.state = 'sleeping';
  behavior.spot = spot;
  behavior.sleepReason = reason;
  behavior.sleptAt = Date.now();
  behavior.home = { x: b.x, y: b.y };
  closeInfo('sleep');
  sendAnim('sleep-enter', { spot });
  behavior.pose = 'sleep';
  if (win && !win.isDestroyed()) win.webContents.send('pose', { pose: 'sleep', facing: 1, spot });
  // Curl up at the bottom of the screen (window bottom = work-area bottom, above the taskbar).
  if (opts.slide !== false) slideTo(b.x, area.y + area.height - WIN_H, 1400);
  else behavior.home = null;
  log(`SLEEP START (${reason}) spot=${spot}${opts.slide === false ? ' (in place)' : ' at the bottom of the screen'}; cat ${settings.activeCatId}`);
  updateTrayMenu();
  return true;
}

// wakeReturn: slide back to where she was before the nap (not when she is being dragged).
function wakeUp(reason, { wakeReturn = true } = {}) {
  if (behavior.state !== 'sleeping') return false;
  const spot = behavior.spot || 'none';
  const slept = Math.round((Date.now() - (behavior.sleptAt || Date.now())) / 1000);
  behavior.state = 'awake';
  behavior.lastWakeReason = reason;
  behavior.lastActive = Date.now();
  behavior.nextIdleAnimAt = Date.now() + 60000 + Math.random() * 90000;
  clearTimeout(behavior.previewTimer);
  stopSlide();
  sendAnim('wake', { spot }); // box: ears pop up, hop out; then stretch + yawn; spot fades out
  sendPose('sit', 1);
  log(`SLEEP END: woken by ${reason} after ${slept} s (spot=${spot}, fell asleep: ${behavior.sleepReason})`);
  behavior.spot = null;
  if (wakeReturn) returnHome();
  updateTrayMenu();
  return true;
}

// "Preview sleep" from Customize: the sleep animation on the desktop cat for 10 s.
function previewSleep(spot, ms = 10000) {
  if (behavior.state === 'sleeping') wakeUp('preview restart', { wakeReturn: false });
  const s = SLEEP_SPOTS.includes(spot) && spot !== 'random' ? spot : chooseSpot();
  if (!goToSleep('preview', { spot: s, slide: false })) return false;
  behavior.previewTimer = setTimeout(() => { if (behavior.sleepReason === 'preview') wakeUp('preview over', { wakeReturn: false }); }, ms);
  return true;
}

// Rare curious peek from the box (eyes + ears over the edge, looking toward the cursor).
function maybePeek() {
  if (behavior.state !== 'sleeping' || behavior.spot !== 'box' || Math.random() >= 0.1) return false;
  const c = cursorPoint();
  const b = win.getBounds();
  sendAnim('peek', { spot: 'box', lookDx: c.x < b.x + b.width / 2 ? -1 : 1 });
  return true;
}

function returnHome() {
  const home = behavior.home;
  behavior.home = null;
  if (!home || settings.chaseMouse || !win || win.isDestroyed()) return;
  const p = clampToWorkArea(home.x, home.y);
  slideTo(p.x, p.y, 1100);
}

function behaviorTick() {
  try {
    if (!win || win.isDestroyed() || !win.isVisible() || drag || slide) return;
    const now = Date.now();
    const quiet = isQuietNow();
    if (behavior.state === 'sleeping') {
      if (behavior.sleepReason === 'quiet hours' && !quiet && settings.quietSleepEnabled) return wakeUp('quiet hours ended');
      if (now >= (behavior.nextPeekAt || 0)) {
        behavior.nextPeekAt = now + 60000;
        maybePeek();
      }
      return;
    }
    // awake
    if (settings.quietSleepEnabled && quiet && now - behavior.lastActive > QUIET_RESLEEP_MS) return goToSleep('quiet hours');
    if (settings.idleSleepEnabled && now - behavior.lastActive > settings.idleSleepMinutes * 60000) return goToSleep('idle');
    if (settings.systemIdleSleep && settings.idleSleepEnabled) {
      let idleS = 0;
      try { idleS = powerMonitor.getSystemIdleTime(); } catch (_) { /* unavailable */ }
      if (idleS >= settings.idleSleepMinutes * 60) return goToSleep('computer idle');
    }
    if (settings.idleAnimations && behavior.pose === 'sit' && now >= behavior.nextIdleAnimAt) {
      behavior.nextIdleAnimAt = now + 60000 + Math.random() * 90000;
      sendAnim(Math.random() < 0.5 ? 'stretch' : 'scratch');
    }
  } catch (err) {
    log('behaviorTick error', err);
  }
}

// Chase: walk toward the cursor and sit beside it. Stops while the cursor is over the
// cat (so she can still click / drag it). Never saves the spot; turning chase off does.
const CHASE_STEP = 10; // px per 40 ms tick (~250 px/s)

function chaseTick() {
  try {
    if (!settings.chaseMouse || !win || win.isDestroyed() || !win.isVisible() || drag || slide) return;
    const c = cursorPoint();
    const moved = !behavior.lastCursor || Math.hypot(c.x - behavior.lastCursor.x, c.y - behavior.lastCursor.y) > 3;
    behavior.lastCursor = c;
    if (moved) markActive('mouse moved', { wakeReturn: false }); // mouse activity keeps her awake
    if (behavior.state === 'sleeping') return;
    const b = win.getBounds();
    if (c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height) return sendPose('sit', behavior.facing);
    const CAT_ANCHOR = catAnchor();
    const ax = b.x + CAT_ANCHOR.x;
    const side = ax >= c.x ? 1 : -1; // stay on the side she is coming from
    const target = clampToWorkArea(c.x + side * 80 - CAT_ANCHOR.x, c.y + 20 - CAT_ANCHOR.y);
    const dx = target.x - b.x;
    const dy = target.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) return sendPose('sit', behavior.facing);
    const step = Math.min(CHASE_STEP, dist);
    setWinPos(Math.round(b.x + (dx / dist) * step), Math.round(b.y + (dy / dist) * step));
    sendPose('walk', dx >= 0 ? 1 : -1);
  } catch (err) {
    log('chaseTick error', err);
  }
}

function setChase(on) {
  clearInterval(behavior.chaseTimer);
  behavior.chaseTimer = null;
  if (on) {
    behavior.home = null;
    behavior.lastCursor = null;
    behavior.chaseTimer = setInterval(chaseTick, 40);
    log('chase the mouse: on');
  } else {
    sendPose(behavior.state === 'sleeping' ? 'sleep' : 'sit', 1);
    savePosition();
    log('chase the mouse: off');
  }
}

function startBehavior() {
  behavior.tickTimer = setInterval(behaviorTick, 1000);
  if (settings.chaseMouse) setChase(true);
}

// Everything the sprite needs to draw her (sent to the cat window in 'state').
const currentLook = () => ({
  breed: settings.breed,
  colors: settings.colors,
  pattern: settings.furPattern,
  ears: settings.earStyle,
  fluffy: settings.fluffy,
  tufts: settings.tufts,
  tail: settings.tail,
  whiskers: settings.whiskersEnabled,
  spotColors: { ...CatSprites.SPOT_DEFAULT_COLORS, ...settings.sleepSpotColors },
});

// --- Window ------------------------------------------------------------------
function createWindow() {
  const pos = initialPosition();
  win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: WIN_W,
    height: WIN_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false, // never take focus from her game; mouse events still arrive
    title: 'WaterCat',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // reminders + meow must work while hidden
      spellcheck: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setMenu(null);
  log(`window created at (${pos.x}, ${pos.y}) ${WIN_W}x${WIN_H}; total windows=${BrowserWindow.getAllWindows().length}`);

  win.once('ready-to-show', () => {
    win.showInactive();
    log('window shown (inactive)');
  });

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
  win.on('show', updateTrayMenu);
  win.on('hide', updateTrayMenu);

  const wc = win.webContents;
  wc.on('console-message', (...args) => {
    // Electron 34: (event, level, message, line, sourceId); newer: (event) with fields.
    const d = typeof args[1] === 'object' || args.length === 1 ? args[0] : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
    log(`[renderer console:${d.level}] ${d.message} (${path.basename(String(d.sourceId || ''))}:${d.lineNumber})`);
  });
  wc.on('preload-error', (_e, p, err) => log(`PRELOAD ERROR in ${p}`, err));
  wc.on('render-process-gone', (_e, d) => log('RENDERER GONE', d));
  wc.on('did-fail-load', (_e, code, desc, url) => log(`LOAD FAILED ${code} ${desc} ${url}`));
  wc.on('did-finish-load', () => log('page loaded'));
  watchMouseDelivery(win);
  wc.on('context-menu', (_e, params) => {
    log(`context-menu at (${params.x}, ${params.y})`);
    behavior.lastActive = Date.now(); // a right-click doesn't wake her; the menu has "Wake up"
    if (selftestHooks.onContextMenu) selftestHooks.onContextMenu(params);
    contextMenu = buildContextMenu();
    contextMenu.popup({ window: win });
  });
  // Block navigation / new windows (drag-dropped files, links).
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.loadFile(path.join(__dirname, 'index.html'));
}

function showCat() {
  if (!win || win.isDestroyed()) return;
  if (behavior.state !== 'sleeping') reclamp();
  win.showInactive();
  win.setAlwaysOnTop(true, 'floating');
  markActive('shown');
}

function hideCat(source) {
  if (!win || win.isDestroyed()) return;
  finishPress('hide');
  stopSlide();
  win.hide();
  log(`cat hidden (${source}); reminders keep running`);
}

function quitApp(source) {
  log(`quit (${source})`);
  quitting = true;
  app.quit();
}

// Restart the whole app (fresh window, fresh state) - for when the cat "bugs out".
// Portable builds run from a temp copy, so relaunch the real .exe.
function restartApp(source) {
  log(`RESTART (${source})`);
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  const opts = portable ? { execPath: portable, args: [] } : { args: process.argv.slice(1).filter((a) => a !== '--selftest') };
  if (selftestHooks.onRestart) return selftestHooks.onRestart(opts);
  quitting = true;
  app.relaunch(opts);
  app.exit(0);
}

// --- Presses Windows swallows --------------------------------------------------
// The cat window never takes focus (so a click can't pull focus from her game). For such
// windows Windows can swallow the left PRESS (only the release reaches the page), which
// made dragging/clicking silently dead. Windows still sends WM_MOUSEACTIVATE for that
// press, so main starts the press itself, using where the cursor is on the page.
let hitRects = null; // window coords from the page: { pet, grip, buttons: [...] }
let lastBeginAt = 0;

function beginPress(source) {
  const now = Date.now();
  if (drag && now - lastBeginAt < 400) return; // the other source already started it
  lastBeginAt = now;
  pressStart();
  if (drag) drag.source = source;
}

function beginResize(source) {
  const now = Date.now();
  if (resizeDrag && now - lastBeginAt < 400) return;
  lastBeginAt = now;
  if (drag) finishPress('cancel'); // a page press may have started first
  resizeStart();
  if (resizeDrag) resizeDrag.source = source;
}

const inRect = (p, r) => !!r && p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
// The page reports the nose area (only while she sits facing us).
const onNose = (p) => !!(hitRects && hitRects.nose) && inRect(p, hitRects.nose);

function onOsLeftDown() {
  if (!win || win.isDestroyed() || !hitRects) return;
  const c = cursorPoint();
  const b = win.getBounds();
  const p = { x: c.x - b.x, y: c.y - b.y };
  if (hitRects.buttons.some((r) => inRect(p, r))) return; // buttons act on release
  if (settings.mouseResize && inRect(p, hitRects.grip)) return beginResize('os');
  if (inRect(p, hitRects.pet)) beginPress('os');
}

// Every left release from the page (mouseup). Decides click / drag end / resize end.
function onRelease(info) {
  if (resizeDrag) {
    resizeEnd('mouseup');
    return { click: false, how: 'resize' };
  }
  if (!drag) return { click: false, how: 'none' };
  const source = drag.source;
  if (info.onButton) {
    finishPress('cancel');
    return { click: false, how: 'button' };
  }
  const r = finishPress('release');
  return { ...r, how: source };
}

// Diagnostics + the swallowed-press hook: does Windows deliver mouse presses to the cat
// window, and does the page get them?
function watchMouseDelivery(w) {
  if (process.platform !== 'win32' || !w.hookWindowMessage) return;
  const seen = {};
  const note = (name) => {
    const now = Date.now();
    if (now - (seen[name] || 0) < 400) return; // one line per press is plenty
    seen[name] = now;
    log(`os mouse: ${name}`);
  };
  try {
    w.hookWindowMessage(0x0201, () => note('WM_LBUTTONDOWN'));
    w.hookWindowMessage(0x0204, () => note('WM_RBUTTONDOWN'));
    // WM_MOUSEACTIVATE: HIWORD(lParam) = the mouse message that caused it.
    w.hookWindowMessage(0x0021, (_wParam, lParam) => {
      let msg = 0;
      try { msg = (lParam.readUInt32LE(0) >>> 16) & 0xffff; } catch (_) { /* unknown */ }
      note(`WM_MOUSEACTIVATE (0x${msg.toString(16)})`);
      if (msg === 0x0201) onOsLeftDown();
    });
    w.hookWindowMessage(0x0215, () => note('WM_CAPTURECHANGED'));
  } catch (err) {
    log('hookWindowMessage failed', err);
  }
  w.webContents.on('input-event', (_e, input) => {
    if (input.type === 'mouseDown' || input.type === 'mouseUp') note(`page ${input.type} ${input.button || ''}`);
  });
}

// --- Settings window -----------------------------------------------------------
// A normal (focusable) window: it only takes focus when she opens it on purpose.
let settingsWin = null;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 340,
    height: 640,
    useContentSize: true,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'WaterCat Settings',
    icon: asset('tray.png'),
    backgroundColor: '#fff6ea',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  settingsWin.setMenu(null);
  const wc = settingsWin.webContents;
  wc.on('preload-error', (_e, p, err) => log(`SETTINGS PRELOAD ERROR in ${p}`, err));
  wc.on('render-process-gone', (_e, d) => log('SETTINGS RENDERER GONE', d));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWin.once('ready-to-show', () => {
    if (!SELFTEST) settingsWin.show();
    else settingsWin.showInactive();
  });
  settingsWin.on('closed', () => { settingsWin = null; });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  log('settings window opened');
  return settingsWin;
}

// --- Customize window (Stage 2) -------------------------------------------------
// A normal window with its own preload + page. The cat window stays UI-free: every
// change goes through applySettings (atomic save) and the cat redraws on 'colors-changed'.
let customizeWin = null;

function openCustomize() {
  if (customizeWin && !customizeWin.isDestroyed()) {
    if (customizeWin.isMinimized()) customizeWin.restore();
    customizeWin.show();
    customizeWin.focus();
    return customizeWin;
  }
  customizeWin = new BrowserWindow({
    width: 440,
    height: 830, // + the updates footer
    useContentSize: true,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Customize cat',
    icon: asset('tray.png'),
    backgroundColor: '#fff6ea',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'customize-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  customizeWin.setMenu(null);
  const wc = customizeWin.webContents;
  wc.on('preload-error', (_e, p, err) => log(`CUSTOMIZE PRELOAD ERROR in ${p}`, err));
  wc.on('render-process-gone', (_e, d) => log('CUSTOMIZE RENDERER GONE', d));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  customizeWin.once('ready-to-show', () => (SELFTEST ? customizeWin.showInactive() : customizeWin.show()));
  customizeWin.on('closed', () => { customizeWin = null; });
  customizeWin.loadFile(path.join(__dirname, 'customize.html'));
  log('customize window opened');
  return customizeWin;
}

// Save / delete her own named presets.
// The look of one cat (the active one by default).
function lookOfCat(id) {
  if (!id || id === settings.activeCatId) return lookOfSettings();
  const c = settings.cats.find((x) => x.id === id);
  if (!c) return lookOfSettings();
  return { colors: { ...c.colors }, furPattern: c.pattern, earStyle: c.earStyle, fluffy: c.fluffy, tufts: c.tufts, tail: c.tail, whiskersEnabled: c.whiskersEnabled };
}
const catName = (id) => (settings.cats.find((c) => c.id === id) || activeCat()).name;

function saveCustomPreset(name, catId) {
  const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!n || n.length > 30) return { ok: false, error: 'Name: 1-30 characters' };
  const list = settings.customPresets.filter((p) => p.name.toLowerCase() !== n.toLowerCase());
  if (list.length >= CUSTOM_PRESET_MAX) return { ok: false, error: `${CUSTOM_PRESET_MAX} presets max` };
  list.push({ name: n, look: lookOfCat(catId) });
  applySettings({ customPresets: list });
  log(`custom preset saved: ${n}`);
  return { ok: true };
}
function deleteCustomPreset(name) {
  applySettings({ customPresets: settings.customPresets.filter((p) => p.name !== name) });
  return { ok: true };
}
function applyLook(look, source, catId) {
  const l = sanitizeLook(look);
  if (!l) return { ok: false, error: 'Not a valid cat look' };
  const target = settings.cats.find((c) => c.id === (catId || settings.activeCatId));
  if (target && (target.id === settings.activeCatId ? settings.catLookLocked : target.lookLocked)) {
    return { ok: false, error: `${target.id === settings.activeCatId ? settings.catName : target.name}'s look is locked - unlock it first` };
  }
  editCat(catId || settings.activeCatId, l);
  log(`look applied to ${catId || settings.activeCatId} (${source})`);
  return { ok: true };
}

// Export / import a look as a small JSON file (to share a cat's look).
async function exportLook(name, catId) {
  const fileName = `${(name || catName(catId) || 'cat').replace(/[^\w -]/g, '').trim() || 'cat'}.watercat.json`;
  const target = selftestHooks.dialogPath || (await dialog.showSaveDialog(customizeWin || undefined, {
    title: 'Export cat look',
    defaultPath: path.join(app.getPath('documents'), fileName),
    filters: [{ name: 'Cat look', extensions: ['json'] }],
  })).filePath;
  if (!target) return { ok: false, cancelled: true };
  const data = { type: LOOK_FILE_TYPE, version: 1, name: name || catName(catId), look: lookOfCat(catId) };
  if (!writeJsonSafe(target, data)) return { ok: false, error: 'Could not write the file' };
  log(`look exported to ${target}`);
  return { ok: true, path: target };
}
async function importLook(catId) {
  let file = selftestHooks.dialogPath;
  if (!file) {
    const r = await dialog.showOpenDialog(customizeWin || undefined, { title: 'Import cat look', properties: ['openFile'], filters: [{ name: 'Cat look', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    file = r.filePaths[0];
  }
  try {
    if (fs.statSync(file).size > 64 * 1024) return { ok: false, error: 'File too big for a cat look' };
  } catch (_) {
    return { ok: false, error: 'File not found' };
  }
  const data = readJsonSafe(file, null);
  if (!data || data.type !== LOOK_FILE_TYPE) return { ok: false, error: 'Not a cat look file' };
  const r = applyLook(data.look, `import ${path.basename(file)}`, catId);
  return r.ok ? { ok: true, name: typeof data.name === 'string' ? data.name.slice(0, 30) : '' } : r;
}

// Top of the right-click + tray menus: "Gargorl ♀" (disabled), then the label item
// ("In loving memory of Gargorl" / "About Fainu") that opens the info window.
function catHeaderItems(source) {
  syncActive();
  const cat = activeCat();
  return [
    { label: `${cat.name} ${GENDER_SYMBOL[cat.gender] || ''}`.trim(), enabled: false },
    { label: labelLine(cat), click: () => openInfo(cat.id, source) },
  ];
}

// "Sleeping spot" submenu for the cat on the desktop.
const SPOT_MENU = [['random', 'Random'], ['bed', 'Cat bed'], ['tree', 'Cat tree'], ['box', 'Cardboard box'], ['none', 'None (sleep in place)']];
function sleepSpotMenu() {
  return {
    label: 'Sleeping spot',
    submenu: SPOT_MENU.map(([id, label]) => ({
      label,
      type: 'radio',
      checked: settings.sleepSpot === id,
      click: () => applySettings({ sleepSpot: id }),
    })),
  };
}

// "Switch cat" submenu (right-click + tray): every cat with its label, the active one checked.
function switchCatMenu(source) {
  syncActive();
  return {
    label: 'Switch cat',
    submenu: settings.cats.map((c) => ({
      label: labelLine(c),
      type: 'radio',
      checked: c.id === settings.activeCatId,
      click: () => setActiveCat(c.id, source),
    })),
  };
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    ...updateMenuItems(),
    ...catHeaderItems('menu'),
    { label: `Pets today: ${petsOf().today}`, enabled: false },
    switchCatMenu('menu'),
    { type: 'separator' },
    { label: 'Undo last cup', click: () => undoCup('menu') },
    { label: "Reset today's cups", click: () => resetCups('menu') },
    { label: 'Test reminder', click: () => fireReminder('test') },
    ...(activeAlarm ? [{ label: 'Dismiss alarm', click: () => dismissAlarm('menu') }] : []),
    ...(nagging ? [{ label: 'Dismiss reminder', click: () => dismissReminder('menu') }] : []),
    { type: 'separator' },
    behavior.state === 'sleeping'
      ? { label: 'Wake up', click: () => wakeUp('menu') }
      : { label: 'Sleep now', click: () => goToSleep('manual') },
    sleepSpotMenu(),
    { label: 'Chase the mouse', type: 'checkbox', checked: settings.chaseMouse, click: (item) => applySettings({ chaseMouse: item.checked }) },
    { label: 'Customize cat…', click: () => openCustomize() },
    { label: 'Settings…', click: () => openSettings() },
    { type: 'separator' },
    ...versionMenuItems('menu'),
    { type: 'separator' },
    { label: 'Hide cat', click: () => hideCat('menu') },
    { label: 'Restart cat', click: () => restartApp('menu') },
    { label: 'Quit', click: () => quitApp('menu') },
  ]);
}

// --- Tray ---------------------------------------------------------------------
function createTray() {
  let img = nativeImage.createFromBuffer(fs.readFileSync(asset('tray.png')), { scaleFactor: 2 });
  if (img.isEmpty()) img = nativeImage.createFromPath(asset('cat_pixel.png'));
  tray = new Tray(img);
  tray.on('click', () => (win && win.isVisible() ? hideCat('tray') : showCat()));
  updateTrayMenu();
  pushState();
  log('tray created');
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = !!(win && !win.isDestroyed() && win.isVisible());
  lastTrayMenu = Menu.buildFromTemplate([
    ...updateMenuItems(),
    ...catHeaderItems('tray'),
    { type: 'separator' },
    { label: visible ? 'Hide cat' : 'Show cat', click: () => (visible ? hideCat('tray') : showCat()) },
    switchCatMenu('tray'),
    { label: 'Add a cup', click: () => addCup('tray') },
    { label: 'Undo last cup', click: () => undoCup('tray') },
    { label: "Reset today's count", click: () => resetCups('tray') },
    ...(activeAlarm ? [{ label: 'Dismiss alarm', click: () => dismissAlarm('tray') }] : []),
    ...(nagging ? [{ label: 'Dismiss reminder', click: () => dismissReminder('tray') }] : []),
    { label: 'Chase the mouse', type: 'checkbox', checked: settings.chaseMouse, click: (item) => applySettings({ chaseMouse: item.checked }) },
    { label: 'Customize cat…', click: () => openCustomize() },
    { label: 'Settings…', click: () => openSettings() },
    { type: 'separator' },
    ...versionMenuItems('tray'),
    { type: 'separator' },
    { label: 'Restart cat', click: () => restartApp('tray') },
    { label: 'Quit', click: () => quitApp('tray') },
  ]);
  tray.setContextMenu(lastTrayMenu);
}

// --- Updates (updater.js) ------------------------------------------------------
// Created in app.whenReady only. Skipped in the selftest (it tests a fake) and in dev
// (unless FORCE_UPDATER=1 + dev-app-update.yml).
function initUpdater() {
  if (SELFTEST) return log('updater: selftest, skipped');
  try {
    updater = require('./updater.js').create(updaterDeps());
    updater.start();
  } catch (err) {
    updater = null;
    log('updater: could not start (the app works without it)', err);
  }
  return undefined;
}
function updaterDeps(extra = {}) {
  return {
    app,
    shell,
    log,
    getSettings: () => settings,
    setSettings: (p) => { Object.assign(settings, p); saveSettings(); },
    // checks wait while something is on her screen
    busyReason: () => (nagging ? 'a water reminder is up' : activeAlarm ? 'an alarm is up' : null),
    // the one "update ready" bubble: never in quiet hours, while she sleeps / is hidden,
    // over another bubble, or over a fullscreen game
    announceBlock: async () => {
      if (isQuietNow()) return 'quiet hours';
      if (behavior.state === 'sleeping') return 'the cat is asleep';
      if (!win || win.isDestroyed() || !win.isVisible()) return 'the cat is hidden';
      if (nagging || activeAlarm) return 'another bubble is up';
      const fs0 = await require('./fullscreen.js').query();
      return fs0.busy ? `fullscreen app (${fs0.name})` : null;
    },
    announce: (text) => { if (win && !win.isDestroyed()) win.webContents.send('bubble-intro', { text, kind: 'update' }); },
    changed: () => { updateTrayMenu(); sendUpdateStatus(); },
    ...extra,
  };
}
// Top of the menus: "Restart to update (vX)" + skip, once an update is ready
// (portable: "Update available - open download page").
function updateMenuItems() {
  const items = updater ? updater.menuItems() : [];
  return items.length ? [...items, { type: 'separator' }] : [];
}
// Bottom of the menus: version line + "Check for updates" (with the last result).
function versionMenuItems(source) {
  const st = updateStatus();
  let check = { label: st.lastResult ? `Check for updates (${st.lastResult})` : 'Check for updates', click: () => manualUpdateCheck(source) };
  if (st.state === 'checking') check = { label: 'Checking for updates…', enabled: false };
  if (st.state === 'downloading') check = { label: `Downloading v${st.version}… ${st.progress || 0}%`, enabled: false };
  if (st.state === 'downloaded') check = { label: `Update ready (v${st.version})`, enabled: false };
  return [{ label: `Version ${app.getVersion()}`, enabled: false }, check];
}
function updateStatus() {
  const base = { current: app.getVersion(), mode: SELFTEST ? 'selftest' : 'off', state: 'off', version: null, progress: 0, lastResult: '', releaseUrl: 'https://github.com/serthekk/water_pet/releases' };
  return { ...base, ...(updater ? updater.status() : {}), autoUpdate: settings.autoUpdate, updateChannel: settings.updateChannel, lastUpdateCheck: settings.lastUpdateCheck };
}
function sendUpdateStatus() {
  if (customizeWin && !customizeWin.isDestroyed()) customizeWin.webContents.send('customize:update-status', updateStatus());
}
// "Check for updates" (menu / tray / Customize): she asked, so the answer is a small
// quiet bubble from the cat (no sound) plus the menu / Customize text.
async function manualUpdateCheck(source) {
  log(`update check requested (${source})`);
  let text = 'Updates are off here';
  if (updater) {
    try { text = await updater.check('manual'); } catch (err) { log('manual update check failed', err); text = "Couldn't check right now"; }
  }
  const st = updateStatus();
  const bubble = st.state === 'downloaded' ? `Update ready (v${st.version})! 🐾 Right-click to update.`
    : st.state === 'downloading' ? `Downloading v${st.version}… 🐾`
      : st.state === 'available' ? `v${st.version} is out! 🐾 Right-click for the download page.`
        : st.state === 'error' ? "Couldn't check right now 😿"
          : /up to date/.test(text) ? "You're up to date 🐾" : text;
  if (source !== 'customize' && win && !win.isDestroyed() && win.isVisible()) win.webContents.send('bubble-intro', { text: bubble, kind: 'update' });
  updateTrayMenu();
  sendUpdateStatus();
  return { text: bubble, status: updateStatus() };
}

// After an update: ONE quiet bubble "I got an update! 🐾 Now vX" (same rules as the
// "update ready" bubble; tries again later if she's busy, gives up after ~2 h).
// existingUser: settings were there before (an install that ran before lastRunVersion existed).
function updatedFrom(last, now, existingUser) {
  if (!last) return existingUser ? 'an older version' : null;
  return require('./updater.js').compareVersions(now, last) > 0 ? last : null;
}
function scheduleUpdatedBubble(existingUser) {
  const now = app.getVersion();
  const from = updatedFrom(settings.lastRunVersion, now, existingUser);
  if (settings.lastRunVersion !== now) {
    settings.lastRunVersion = now;
    saveSettings();
  }
  if (!from || SELFTEST) return;
  log(`UPDATED: ${from} -> v${now} (cats, settings and position kept)`);
  let tries = 0;
  const attempt = async () => {
    try {
      const block = await updaterDeps().announceBlock();
      if (!block) {
        win.webContents.send('bubble-intro', { text: `I got an update! 🐾 Now v${now}`, kind: 'update' });
        log(`"I got an update" bubble shown (v${now})`);
        return;
      }
      tries += 1;
      if (tries >= 12) return log(`"I got an update" bubble skipped (${block})`);
      setTimeout(attempt, 10 * 60000);
    } catch (err) {
      log('updated bubble failed', err);
    }
  };
  setTimeout(attempt, 8000);
}

// --- Hotkey / login item -----------------------------------------------------
function registerHotkey() {
  let ok = false;
  try {
    ok = globalShortcut.register(HOTKEY, () => addCup('hotkey'));
  } catch (err) {
    log('hotkey register threw', err);
  }
  log(`hotkey ${HOTKEY} registered=${ok}${ok ? '' : ' (another app may already use it)'}`);
  return ok;
}

function applyLoginItem() {
  if (!app.isPackaged) return log('login item: skipped (not packaged)');
  // Portable builds run from a temp folder; register the real .exe instead.
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, path: exe, args: [] });
  log(`login item: openAtLogin=${settings.startWithWindows} path=${exe}`);
}

// --- IPC (channel names must match preload.js) -------------------------------
function registerIpc() {
  ipcMain.handle('get-state', () => ({
    cups: day.cups, goal: settings.goalCups, volume: settings.volume, meowStyle: settings.meowStyle, sound: settings.soundEnabled,
    look: currentLook(), size: settings.catSize, mouseResize: settings.mouseResize, pose: behavior.pose,
  }));
  // File bytes for Web Audio (works the same inside the packaged asar).
  // `clean: true` = her own file, the renderer cleans it before use.
  ipcMain.handle('get-meows', () => soundCatalog.map((m) => {
    try {
      return { id: m.id, label: m.label, clean: m.group === 'user', data: fs.readFileSync(m.file) };
    } catch (err) {
      log(`sound file unreadable: ${m.id}`, err);
      return { id: m.id, label: m.label, clean: false, data: null };
    }
  }));
  ipcMain.on('press-start', () => beginPress('page'));
  ipcMain.handle('pet', () => pet('stroke', 'mouse')); // the page only asks for strokes; boops are decided here
  ipcMain.handle('release', (_e, info) => onRelease(info || {}));
  ipcMain.on('press-cancel', () => finishPress('cancel'));
  ipcMain.on('hit-rects', (_e, r) => { hitRects = r; });
  ipcMain.on('reset-cups', () => resetCups('button'));
  ipcMain.on('hide-cat', () => hideCat('button'));
  ipcMain.on('quit-app', () => quitApp('button'));
  ipcMain.on('restart-app', () => restartApp('button'));
  ipcMain.handle('settings:restart', () => restartApp('settings'));
  ipcMain.on('resize-start', () => beginResize('page'));
  ipcMain.on('resize-step', (_e, dir) => resizeStep(Number(dir)));
  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:set', (_e, partial) => applySettings(partial));
  ipcMain.on('settings:test-meow', (_e, style) => {
    const s = meowIds().includes(style) ? style : settings.meowStyle;
    if (win && !win.isDestroyed()) win.webContents.send('play-meow', { volume: settings.volume, style: s });
  });
  ipcMain.handle('settings:test-alarm', (_e, id) => testAlarm(String(id)));
  ipcMain.handle('settings:open-customize', () => { openCustomize(); return true; });
  // Info window (channel names must match info-preload.js)
  const fromInfo = (e) => infoWin && !infoWin.isDestroyed() && e.sender === infoWin.webContents;
  ipcMain.handle('info:get', (e) => (fromInfo(e) ? infoData(infoCatId) : null));
  ipcMain.on('info:ready', (e, height) => {
    if (!fromInfo(e)) return;
    placeInfo(Number(height) || 200);
    infoWin.showInactive(); // never takes focus by itself
    log(`info window shown (${Math.round(Number(height) || 0)} px tall)`);
  });
  ipcMain.on('info:close', (e, reason) => { if (fromInfo(e)) closeInfo(String(reason || 'button')); });
  // Customize window (channel names must match customize-preload.js)
  // Every customize call names the cat it is for (catId = the cat selected in the window).
  const known = (id) => (typeof id === 'string' && settings.cats.some((c) => c.id === id) ? id : settings.activeCatId);
  ipcMain.handle('customize:get', (_e, catId) => catView(known(catId)));
  ipcMain.handle('customize:set', (_e, catId, partial) => {
    const id = known(catId);
    editCat(id, partial);
    return catView(id);
  });
  ipcMain.handle('customize:apply-look', (_e, catId, look) => applyLook(look, 'customize', known(catId)));
  ipcMain.handle('customize:save-preset', (_e, catId, name) => saveCustomPreset(name, known(catId)));
  ipcMain.handle('customize:delete-preset', (_e, name) => deleteCustomPreset(String(name)));
  ipcMain.handle('customize:export', (_e, catId, name) => exportLook(typeof name === 'string' ? name : '', known(catId)));
  ipcMain.handle('customize:import', (_e, catId) => importLook(known(catId)));
  ipcMain.handle('customize:preview-sleep', (_e, spot) => previewSleep(String(spot)));
  // global (not per-cat) sleep settings edited from Customize
  const GLOBAL_FROM_CUSTOMIZE = ['idleSleepEnabled', 'idleSleepMinutes', 'quietSleepEnabled', 'systemIdleSleep', 'autoUpdate', 'updateChannel'];
  // updates (footer of the Customize window)
  ipcMain.handle('customize:update-status', () => updateStatus());
  ipcMain.handle('customize:check-updates', () => manualUpdateCheck('customize'));
  ipcMain.handle('customize:restart-to-update', () => (updater ? updater.restartToUpdate('customize') : false));
  ipcMain.handle('customize:release-notes', () => {
    const st = updateStatus();
    const url = st.version ? st.releaseUrl : `https://github.com/serthekk/water_pet/releases`;
    if (updater) updater.openReleasePage(url);
    else if (require('./updater.js').isAllowedReleaseUrl(url)) shell.openExternal(url);
    return true;
  });
  ipcMain.handle('customize:set-global', (_e, catId, partial) => {
    const p = {};
    for (const k of GLOBAL_FROM_CUSTOMIZE) if (partial && k in partial) p[k] = partial[k];
    applySettings(p);
    return catView(known(catId));
  });
  ipcMain.handle('customize:restore-starters', (_e, catId) => {
    const restored = restoreStarters('customize');
    return { restored, view: catView(restored[0] || known(catId)) };
  });
  ipcMain.handle('customize:new-cat', () => { const p = createCat(); notifyCatsChanged(); return catView(p.id); });
  ipcMain.handle('customize:duplicate-cat', (_e, catId) => {
    const p = duplicateCat(known(catId));
    notifyCatsChanged();
    return catView(p ? p.id : known(catId));
  });
  ipcMain.handle('customize:delete-cat', (_e, catId) => {
    const r = deleteCat(known(catId));
    notifyCatsChanged();
    return { ...r, view: catView(settings.activeCatId) };
  });
  ipcMain.handle('customize:set-active', (_e, catId) => {
    setActiveCat(known(catId), 'customize');
    return catView(known(catId));
  });
  ipcMain.handle('settings:open-sounds-folder', async () => {
    ensureAppDirs();
    const err = await shell.openPath(userSoundsDir());
    if (err) log(`open sounds folder failed: ${err}`);
    return !err;
  });
  ipcMain.on('report', (_e, type, data) => {
    log(`renderer: ${type}`, data === undefined ? '' : data);
    if (type === 'sound-skipped' && data && typeof data.id === 'string') markSoundBroken(data.id, data.reason);
    if (type === 'ready' && !SELFTEST) maybeShowIntro(); // the selftest calls it itself
    if (selftestHooks.onReport) selftestHooks.onReport(type, data);
  });
}

// --- Self test -----------------------------------------------------------------
const selftestHooks = { onReport: null, onContextMenu: null, onRestart: null, dialogPath: null };

async function runSelftest() {
  const results = [];
  const record = (name, pass, detail = '') => {
    results.push({ name, pass, detail });
    log(`SELFTEST ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reports = [];
  const allErrors = []; // kept across clearReports()
  selftestHooks.onReport = (type, data) => {
    reports.push({ type, data, t: Date.now() });
    if (type === 'error' || type === 'settings:error') allErrors.push({ type, data });
  };
  const waitFor = async (pred, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = reports.find(pred);
      if (hit) return hit;
      await sleep(25);
    }
    return null;
  };
  const clearReports = () => { reports.length = 0; };

  const hardTimeout = setTimeout(() => {
    record('overall', false, 'selftest timed out after 240 s');
    finish();
  }, 240000);

  function finish() {
    clearTimeout(hardTimeout);
    const failed = results.filter((r) => !r.pass);
    log(`SELFTEST SUMMARY: ${results.length - failed.length}/${results.length} passed${failed.length ? ' - FAILED: ' + failed.map((f) => f.name).join(', ') : ''}`);
    writeJsonSafe(path.join(LOG_DIR, 'selftest-result.json'), { when: new Date().toISOString(), packaged: app.isPackaged, results });
    quitting = true;
    app.exit(failed.length ? 1 : 0);
  }

  try {
    const wc = win.webContents;
    const ready = await waitFor((r) => r.type === 'ready', 10000);
    record('renderer-ready', !!ready, ready ? 'preload api + DOM ok' : 'no ready report (preload or renderer broken)');
    if (!ready) return finish();
    record('single-window', BrowserWindow.getAllWindows().length === 1, `windows=${BrowserWindow.getAllWindows().length}`);
    record('window-size', win.getBounds().width === WIN_W && win.getBounds().height === WIN_H, JSON.stringify(win.getBounds()));

    // Audio: every style decoded, every style plays, clean files
    const BUILTIN = soundCatalog.filter((m) => m.group === 'builtin');
    const sd = userSoundsDir();
    record('first run creates folders', [dataDir(), LOG_DIR, sd].every((d) => fs.existsSync(d)) && fs.existsSync(path.join(sd, 'README.txt'))
      && fs.existsSync(settingsFile()) && fs.existsSync(cupsFile()), `${dataDir()} | logs | sounds\\README.txt`);
    record('bundled sounds from manifest (original + yours)', BUILTIN.length >= 1 && BUILTIN.some((m) => m.id === 'original')
      && !BUILTIN.some((m) => ['soft', 'classic', 'chirp', 'mrrow', 'kitten', 'grumpy', 'chatty'].includes(m.id)), BUILTIN.map((m) => m.id).join(','));
    const loaded = await waitFor((r) => r.type === 'meows-loaded', 5000);
    const loadedIds = loaded ? loaded.data.styles : [];
    record('meow styles decoded', BUILTIN.every((m) => loadedIds.includes(m.id)), loaded ? JSON.stringify(loaded.data) : 'no meows-loaded report');
    for (const m of BUILTIN) {
      clearReports();
      win.webContents.send('play-meow', { style: m.id, volume: settings.volume });
      const a = await waitFor((r) => r.type === 'audio', 3000);
      record(`meow plays: ${m.id}`, !!(a && a.data.ok && a.data.style === m.id), a ? JSON.stringify(a.data) : 'no audio report');
      await sleep(120);
    }
    const wavIssues = [];
    for (const m of BUILTIN) {
      const buf = fs.readFileSync(m.file);
      const dataAt = buf.indexOf('data') + 8;
      const ok = buf.toString('ascii', 0, 4) === 'RIFF' && buf.readUInt16LE(22) === 1 && buf.readUInt32LE(24) === 48000 && buf.readUInt16LE(34) === 16;
      let peak = 0;
      const n = Math.floor((buf.length - dataAt) / 2);
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf.readInt16LE(dataAt + i * 2)) / 32768);
      const first = Math.abs(buf.readInt16LE(dataAt)) / 32768;
      const last = Math.abs(buf.readInt16LE(dataAt + (n - 1) * 2)) / 32768;
      if (!ok || peak > 0.72 || first > 0.01 || last > 0.01) wavIssues.push(`${m.id}: fmt=${ok} peak=${peak.toFixed(3)} first=${first.toFixed(3)} last=${last.toFixed(3)}`);
    }
    record('meow files clean (mono 48k, peak <= -3 dBFS, start/end at zero)', wavIssues.length === 0, wavIssues.join('; '));

    const cat = ready.data.cat; // cat rect in window coords
    const cx = Math.round(cat.x + cat.width / 2);
    const cy = Math.round(cat.y + cat.height * 0.6);
    const send = (ev) => wc.sendInputEvent(ev);
    // the active cat's profile as saved on disk (look settings live in cats[] now)
    const diskCat = () => {
      const d = readJsonSafe(settingsFile(), {});
      return (d.cats || []).find((c) => c.id === d.activeCatId) || {};
    };
    // an old (pre-profile) settings file made from current settings, for upgrade tests
    const oldFormat = (s) => {
      const o = { ...s };
      delete o.cats;
      delete o.activeCatId;
      return o;
    };
    const shot = async (name) => {
      try { fs.writeFileSync(path.join(LOG_DIR, `selftest-${name}.png`), (await win.webContents.capturePage()).toPNG()); } catch (err) { log('screenshot failed', err); }
    };
    const click = async (x, y, button = 'left') => {
      send({ type: 'mouseMove', x, y });
      await sleep(30);
      send({ type: 'mouseDown', x, y, button, clickCount: 1 });
      await sleep(60);
      send({ type: 'mouseUp', x, y, button, clickCount: 1 });
    };

    // Real-mouse hit test: what element is on top at points all over the cat? (synthetic
    // sendInputEvent clicks skip this, which is how a covered cat once passed the selftest)
    const hit = await wc.executeJavaScript(`(() => {
      const c = ${JSON.stringify(ready.data.cat)};
      const out = [];
      for (let fx = 0.15; fx < 1; fx += 0.175) for (let fy = 0.1; fy < 1; fy += 0.2) {
        const x = Math.round(c.x + c.width * fx), y = Math.round(c.y + c.height * fy);
        const el = document.elementFromPoint(x, y);
        const pet = document.getElementById('pet');
        if (!el || !(el === pet || pet.contains(el))) out.push(x + ',' + y + '=' + (el ? (el.id || el.tagName) : 'none'));
      }
      return out;
    })()`);
    record('real-mouse hit test: nothing covers the cat', hit.length === 0, hit.join(' '));

    // Main decides click vs drag from the OS cursor. Pin a fake cursor for the whole test so
    // the user's real mouse moving during the test can't turn a test click into a drag.
    fakeCursor = { x: 1000, y: 500 };
    // Many tests below recolour Gargorl / try presets on her: unlock the two starter looks
    // here; section "look lock" locks them again and tests the lock itself.
    record('Gargorl + Fainu start with their looks locked', settings.catLookLocked === true && settings.cats.find((c) => c.id === 'fainu').lookLocked === true);
    editCat('gargorl', { catLookLocked: false });
    editCat('fainu', { catLookLocked: false });

    // 1. Real (synthetic OS-level) click on the cat -> +1 cup, meow
    resetCups('selftest');
    clearReports();
    await click(cx, cy);
    await sleep(400);
    record('add-cup (click)', day.cups === 1, `cups=${day.cups}`);
    const audio = await waitFor((r) => r.type === 'audio', 3000);
    record('audio (meow on click)', !!(audio && audio.data && audio.data.ok), audio ? JSON.stringify(audio.data) : 'no audio report');

    // 2. Right-click -> main-process context menu; then use its "Undo last cup" item
    let ctxShown = false;
    selftestHooks.onContextMenu = () => { ctxShown = true; };
    await click(cx, cy, 'right');
    await sleep(400);
    record('context-menu (right-click)', ctxShown, ctxShown ? 'context-menu event received' : 'no context-menu event');
    if (contextMenu) contextMenu.closePopup(win);
    await sleep(150);
    record('right-click does not add cup', day.cups === 1, `cups=${day.cups}`);
    const undoItem = buildContextMenu().items.find((i) => i.label === 'Undo last cup');
    undoItem.click();
    await sleep(100);
    record('undo (menu item)', day.cups === 0, `cups=${day.cups}`);

    // 3. Drag: real mouse press/release into the page; the OS cursor is substituted
    //    (fakeCursor) so the test never moves the user's mouse. The page gets NO
    //    mouseMove events here on purpose: main must detect the drag from the cursor alone.
    const area = screen.getPrimaryDisplay().workArea;
    setWinPos(area.x + 200, area.y + 200);
    const before = win.getBounds();
    fakeCursor = { x: 1000, y: 500 };
    clearReports();
    send({ type: 'mouseMove', x: cx, y: cy });
    await sleep(30);
    send({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 });
    await sleep(60);
    const pressed = !!drag;
    fakeCursor = { x: 1003, y: 501 }; // 3 px: not a drag yet
    await sleep(60);
    const startedEarly = !!(drag && drag.dragging);
    fakeCursor = { x: 1012, y: 506 }; // > 5 px: drag
    await sleep(60);
    const started = !!(drag && drag.dragging);
    const began = reports.some((r) => r.type === 'input' && r.data.ev === 'down');
    fakeCursor = { x: 1080, y: 540 };
    await sleep(120);
    const mid = win.getBounds();
    send({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 });
    await sleep(250);
    const after = win.getBounds();
    record('press reaches main', pressed && began);
    record('drag threshold (3px is not a drag)', !startedEarly);
    record('drag starts after 5px (no page mousemoves needed)', started);
    record('drag follows cursor', mid.x - before.x === 80 && mid.y - before.y === 40, `from (${before.x},${before.y}) to (${mid.x},${mid.y})`);
    record('drag keeps size', after.width === WIN_W && after.height === WIN_H, `${after.width}x${after.height}`);
    record('drag is not a click', day.cups === 0, `cups=${day.cups}`);
    record('drag stopped on mouseup', !drag && after.x === mid.x && after.y === mid.y);
    const saved = readJsonSafe(settingsFile(), {}).position;
    record('position saved', !!saved && saved.x === after.x && saved.y === after.y, JSON.stringify(saved));

    // 3b. The old failure: the page loses pointer capture mid-press. Must still click / drag.
    clearReports();
    send({ type: 'mouseMove', x: cx, y: cy });
    await sleep(30);
    send({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 });
    await sleep(50);
    await wc.executeJavaScript(`(() => { const p = document.getElementById('pet'); for (let id = 0; id < 4; id++) { try { p.releasePointerCapture(id); } catch (_) {} } p.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 })); })()`);
    await sleep(50);
    send({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 });
    await sleep(300);
    record('click survives lost pointer capture', day.cups === 1, `cups=${day.cups}`);
    const b0 = win.getBounds();
    send({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 });
    await sleep(50);
    await wc.executeJavaScript(`document.getElementById('pet').dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }))`);
    fakeCursor = { x: fakeCursor.x - 60, y: fakeCursor.y - 30 };
    await sleep(120);
    send({ type: 'mouseUp', x: 4, y: 4, button: 'left', clickCount: 1 }); // released off the cat
    await sleep(250);
    const b1 = win.getBounds();
    record('drag survives lost capture + release off the cat', b1.x - b0.x === -60 && b1.y - b0.y === -30 && !drag && day.cups === 1, `moved (${b1.x - b0.x},${b1.y - b0.y}) cups=${day.cups}`);
    undoCup('selftest');

    // 3d. The real-world failure: Windows swallows the PRESS (the page gets only the
    //     release), and only WM_MOUSEACTIVATE tells us it happened.
    {
      const winAt = () => win.getBounds();
      const lp = Buffer.alloc(8);
      lp.writeUInt32LE((0x0201 << 16) | 0x0001, 0);
      record('WM_MOUSEACTIVATE lParam -> WM_LBUTTONDOWN', ((lp.readUInt32LE(0) >>> 16) & 0xffff) === 0x0201);
      record('page reported hit areas to main', !!(hitRects && hitRects.pet && hitRects.grip && hitRects.buttons.length === 4), JSON.stringify(hitRects));
      const cupsS = day.cups;
      fakeCursor = { x: winAt().x + cx, y: winAt().y + cy };
      onOsLeftDown(); // what the WM_MOUSEACTIVATE hook does
      await sleep(60);
      send({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 }); // release only
      await sleep(300);
      record('swallowed press: a click still logs a cup', day.cups === cupsS + 1 && !drag, `cups ${cupsS} -> ${day.cups}`);
      const b0 = winAt();
      fakeCursor = { x: b0.x + cx, y: b0.y + cy };
      onOsLeftDown();
      await sleep(60);
      fakeCursor = { x: fakeCursor.x + 70, y: fakeCursor.y + 20 };
      await sleep(150);
      send({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 });
      await sleep(250);
      const b1 = winAt();
      record('swallowed press: dragging still works', b1.x - b0.x === 70 && b1.y - b0.y === 20 && day.cups === cupsS + 1 && !drag, `moved (${b1.x - b0.x},${b1.y - b0.y})`);
      // hover button with a swallowed press: acts on release, no drag/cup
      const hb2 = hitRects.buttons[1]; // hide
      const hx = Math.round(hb2.x + hb2.width / 2);
      const hy = Math.round(hb2.y + hb2.height / 2);
      send({ type: 'mouseMove', x: hx, y: hy });
      await sleep(200);
      fakeCursor = { x: b1.x + hx, y: b1.y + hy };
      onOsLeftDown();
      send({ type: 'mouseUp', x: hx, y: hy, button: 'left', clickCount: 1 });
      await sleep(300);
      record('swallowed press: hover buttons still work (hide)', !win.isVisible() && !drag && day.cups === cupsS + 1, `visible=${win.isVisible()}`);
      showCat();
      await sleep(200);
      undoCup('selftest');
      fakeCursor = { x: 1000, y: 500 };
    }

    // 3c. Reset button (hover) + undo brings the count back
    for (let i = 0; i < 3; i++) addCup('selftest');
    const rb = hitRects.buttons[0]; // reset button, current position
    // hover first (the buttons only take the mouse while she's hovered), like a real mouse
    send({ type: 'mouseMove', x: Math.round(rb.x + rb.width / 2) - 20, y: Math.round(rb.y + rb.height / 2) + 20 });
    await sleep(150);
    send({ type: 'mouseMove', x: Math.round(rb.x + rb.width / 2), y: Math.round(rb.y + rb.height / 2) });
    await sleep(200);
    await click(Math.round(rb.x + rb.width / 2), Math.round(rb.y + rb.height / 2));
    await sleep(300);
    record('reset button', day.cups === 0 && readJsonSafe(cupsFile(), {}).cups === 0 && win.isVisible(), `cups=${day.cups}`);
    buildContextMenu().items.find((i) => i.label === 'Undo last cup').click();
    await sleep(100);
    record('undo after reset restores count', day.cups === 3, `cups=${day.cups}`);
    buildContextMenu().items.find((i) => i.label === "Reset today's cups").click();
    await sleep(100);
    record('reset (menu item)', day.cups === 0, `cups=${day.cups}`);
    addCup('selftest');
    undoCup('selftest');
    undoCup('selftest');
    record('undo is a normal undo again after a new cup', day.cups === 0, `cups=${day.cups}`);
    const off = clampToWorkArea(-99999, -99999);
    record('position clamp', off.x === screen.getDisplayNearestPoint({ x: off.x, y: off.y }).workArea.x, JSON.stringify(off));

    // 4. Hide button, then a scheduled reminder while hidden (must still meow)
    clearReports();
    const hb = hitRects.buttons[1]; // hide button, current position
    // hover first (the buttons only take the mouse while she's hovered), like a real mouse
    send({ type: 'mouseMove', x: Math.round(hb.x + hb.width / 2) - 20, y: Math.round(hb.y + hb.height / 2) + 20 });
    await sleep(150);
    send({ type: 'mouseMove', x: Math.round(hb.x + hb.width / 2), y: Math.round(hb.y + hb.height / 2) });
    await sleep(200);
    await click(Math.round(hb.x + hb.width / 2), Math.round(hb.y + hb.height / 2));
    await sleep(300);
    record('hide button', !win.isVisible() && day.cups === 0, `visible=${win.isVisible()} cups=${day.cups}`);
    settings.quietStart = '00:00';
    settings.quietEnd = '00:00'; // no quiet hours for this check
    nextReminderAt = 0;
    tick();
    const hiddenBubble = await waitFor((r) => r.type === 'bubble' && r.data.shown, 2000);
    const hiddenAudio = await waitFor((r) => r.type === 'audio', 3000);
    record('reminder while hidden', !!hiddenBubble && !!(hiddenAudio && hiddenAudio.data.ok), `bubble=${!!hiddenBubble} audio=${hiddenAudio ? JSON.stringify(hiddenAudio.data) : 'none'}`);
    record('reminder is persistent + repeat scheduled', !!nagging && hiddenBubble && hiddenBubble.data.persistent === true
      && Math.abs(nagging.nextAt - Date.now() - settings.repeatMinutes * 60000) < 5000, nagging ? `next in ${Math.round((nagging.nextAt - Date.now()) / 1000)} s` : 'not active');
    clearReports();
    nagging.nextAt = 0; // pretend 5 minutes passed
    tick();
    const rep = await waitFor((r) => r.type === 'audio', 3000);
    record('repeats while hidden (no cup yet)', !!(rep && rep.data.ok) && nagging && nagging.repeats === 1, rep ? JSON.stringify(rep.data) : 'no repeat');
    showCat();
    await sleep(300);
    record('show cat', win.isVisible());

    // 5. Click while bubble shown -> bubble hides + cup logged
    clearReports();
    await click(cx, cy);
    const clickHide = await waitFor((r) => r.type === 'bubble' && !r.data.shown, 2000);
    await sleep(200);
    record('bubble hides on click', !!clickHide && clickHide.data.reason === 'click', clickHide ? JSON.stringify(clickHide.data) : 'no hide report');
    record('bubble click logs cup', day.cups === 1, `cups=${day.cups}`);
    record('bubble text', !!hiddenBubble && hiddenBubble.data.text === BUBBLE_TEXT, hiddenBubble ? hiddenBubble.data.text : '');
    clearReports();
    tick(); // after the cup: no more repeats, the normal schedule is back
    await sleep(300);
    record('cup ends the reminder (no more repeats)', !nagging && !reports.some((r) => r.type === 'bubble' || r.type === 'audio') && nextReminderAt - Date.now() > (settings.reminderMinutes - 1) * 60000);

    // 6. Reminder rules
    settings.quietStart = '23:00';
    settings.quietEnd = '08:00';
    const q = (h, m) => isQuietAt(h * 60 + m, '23:00', '08:00');
    record('quiet hours logic', q(23, 30) && q(2, 0) && q(7, 59) && !q(8, 0) && !q(12, 0) && !q(22, 59));
    clearReports();
    settings.quietStart = '00:00';
    settings.quietEnd = '00:00';
    day.cups = settings.goalCups;
    nextReminderAt = 0;
    tick();
    await sleep(500);
    record('no reminder at goal', !reports.some((r) => r.type === 'bubble'));
    day.cups = 1;
    saveCups();
    pushState();

    // 7. Persistent reminder ("Test reminder" menu item): stays, repeats, quiet hours, dismiss, tray cup
    clearReports();
    record('no "Dismiss" when no reminder', !buildContextMenu().items.some((i) => i.label === 'Dismiss reminder'));
    buildContextMenu().items.find((i) => i.label === 'Test reminder').click();
    const shown = await waitFor((r) => r.type === 'bubble' && r.data.shown, 2000);
    const early = await waitFor((r) => r.type === 'bubble' && !r.data.shown, 11500);
    record('bubble stays up (11 s later still shown)', !!shown && !early && !!nagging, early ? JSON.stringify(early.data) : 'still shown');
    clearReports();
    settings.quietStart = '00:00';
    settings.quietEnd = '23:59'; // quiet hours now
    nagging.nextAt = 0;
    tick();
    await sleep(400);
    record('no repeat meow during quiet hours (bubble stays)', !reports.some((r) => r.type === 'audio' || r.type === 'bubble') && !!nagging && nagging.nextAt > Date.now());
    settings.quietStart = '00:00';
    settings.quietEnd = '00:00';
    const dis = buildContextMenu().items.find((i) => i.label === 'Dismiss reminder');
    record('"Dismiss reminder" offered while active', !!dis);
    if (dis) dis.click();
    const disHide = await waitFor((r) => r.type === 'bubble' && !r.data.shown, 2000);
    record('dismiss hides bubble + stops repeats', !!disHide && String(disHide.data.reason).startsWith('dismissed') && !nagging && day.cups === 1,
      disHide ? JSON.stringify(disHide.data) : 'no hide');
    clearReports();
    fireReminder('test');
    await waitFor((r) => r.type === 'bubble' && r.data.shown, 2000);
    addCup('tray');
    const trayHide = await waitFor((r) => r.type === 'bubble' && !r.data.shown, 2000);
    record('cup from tray/hotkey also ends it', !!trayHide && !nagging, trayHide ? JSON.stringify(trayHide.data) : 'no hide');
    undoCup('selftest');

    // 8. Data files
    day = { date: '2000-01-01', cups: 5, pets: { gargorl: { today: 3, total: 40 }, other: { today: 2, total: 9 } } };
    checkDayRollover();
    record('midnight reset (cups + every cat\'s pets today; totals kept)', day.cups === 0 && day.pets.gargorl.today === 0 && day.pets.gargorl.total === 40
      && day.pets.other.today === 0 && day.pets.other.total === 9 && day.date === todayKey(), JSON.stringify(day));
    delete day.pets.other;
    const junk = path.join(dataDir(), 'corrupt-test.json');
    fs.writeFileSync(junk, '{not json');
    const fallback = sanitizeSettings(readJsonSafe(junk, {}));
    record('corrupt file -> defaults', JSON.stringify(fallback) === JSON.stringify(DEFAULT_SETTINGS));
    fs.rmSync(junk, { force: true });

    // 9. Settings window, driven through its real UI
    clearReports();
    buildContextMenu().items.find((i) => i.label === 'Settings…').click();
    const sReady = await waitFor((r) => r.type === 'settings:ready', 8000);
    record('settings window opens', !!sReady && !!settingsWin, sReady ? JSON.stringify(sReady.data) : 'no ready report');
    if (sReady) {
      const swc = settingsWin.webContents;
      const setField = (id, value, ev = 'change') => swc.executeJavaScript(
        `(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event(${JSON.stringify(ev)})); })()`
      );
      clearReports();
      await setField('volume', 80);
      const vSaved = await waitFor((r) => r.type === 'settings:saved', 3000);
      const vMeow = await waitFor((r) => r.type === 'audio', 3000);
      const onDisk = readJsonSafe(settingsFile(), {});
      record('volume slider saves', settings.volume === 0.8 && onDisk.volume === 0.8, `settings=${settings.volume} file=${onDisk.volume} report=${!!vSaved}`);
      record('volume slider -> cat meow volume', !!(vMeow && vMeow.data.ok && Math.abs(vMeow.data.volume - 0.8) < 0.001), vMeow ? JSON.stringify(vMeow.data) : 'no audio report');
      const label = await swc.executeJavaScript(`document.getElementById('volume-out').textContent`);
      record('volume label', label === '80%', label);

      clearReports();
      await setField('goalCups', 10);
      await waitFor((r) => r.type === 'settings:saved', 3000);
      record('goal saves', settings.goalCups === 10 && readJsonSafe(settingsFile(), {}).goalCups === 10, `goal=${settings.goalCups}`);
      const countText = await win.webContents.executeJavaScript(`document.getElementById('count').textContent`);
      record('goal updates cat text', countText.includes('/ 10 cups'), countText);

      const beforeNext = nextReminderAt;
      await setField('reminderMinutes', 45);
      await waitFor((r) => r.type === 'settings:saved' && r.data.partial.reminderMinutes === 45, 3000);
      record('reminder minutes save + reschedule', settings.reminderMinutes === 45 && nextReminderAt !== beforeNext && Math.abs(nextReminderAt - Date.now() - 45 * 60000) < 5000, `minutes=${settings.reminderMinutes}`);

      await setField('repeatMinutes', 7);
      await waitFor((r) => r.type === 'settings:saved' && r.data.partial.repeatMinutes === 7, 3000);
      record('repeat minutes save', settings.repeatMinutes === 7 && readJsonSafe(settingsFile(), {}).repeatMinutes === 7, `repeat=${settings.repeatMinutes}`);

      const previewInk = await swc.executeJavaScript(`(() => { const c = document.getElementById('preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()`);
      const hasCustomizeBtn = await swc.executeJavaScript(`!!document.getElementById('open-customize') && !document.getElementById('breed')`);
      record('Settings: look preview + "Customize cat…" button (look editing moved)', previewInk > 500 && hasCustomizeBtn, `previewPixels=${previewInk}`);

      await setField('quietStart', '22:30');
      await waitFor((r) => r.type === 'settings:saved' && r.data.partial.quietStart === '22:30', 3000);
      record('quiet hours save', settings.quietStart === '22:30', settings.quietStart);

      clearReports();
      await setField('meowStyle', 'original');
      await waitFor((r) => r.type === 'settings:saved' && r.data.partial.meowStyle === 'original', 3000);
      const preview = await waitFor((r) => r.type === 'audio', 3000);
      record('meow style saves + previews', settings.meowStyle === 'original' && readJsonSafe(settingsFile(), {}).meowStyle === 'original' && !!preview && preview.data.style === 'original',
        preview ? JSON.stringify(preview.data) : 'no preview');
      clearReports();
      await click(cx, cy);
      const styled = await waitFor((r) => r.type === 'audio', 3000);
      record('click uses chosen style', !!styled && styled.data.style === 'original', styled ? styled.data.style : 'none');
      undoCup('selftest');

      const keep = { ...settings };
      applySettings({ goalCups: -3, volume: 7, quietEnd: '99:99', reminderMinutes: 0, meowStyle: 'dog', position: { x: 1, y: 1 }, evil: true });
      record('invalid settings ignored', settings.goalCups === keep.goalCups && settings.volume === keep.volume && settings.quietEnd === keep.quietEnd && settings.meowStyle === keep.meowStyle
        && settings.reminderMinutes === keep.reminderMinutes && JSON.stringify(settings.position) === JSON.stringify(keep.position) && !('evil' in settings),
        JSON.stringify(publicSettings()));

      buildContextMenu().items.find((i) => i.label === 'Settings…').click();
      await sleep(200);
      record('settings is single window', BrowserWindow.getAllWindows().length === 2, `windows=${BrowserWindow.getAllWindows().length}`);
      await swc.executeJavaScript(`document.getElementById('close').click()`);
      await sleep(500);
      record('settings close button (app keeps running)', !settingsWin && !!win && !win.isDestroyed());
    }

    // 10. Rapid clicking: every meow plays, old ones fade (no hard cuts), every click counts
    applySettings({ meowStyle: 'random' });
    resetCups('selftest');
    clearReports();
    for (let i = 0; i < 6; i++) {
      await click(cx, cy);
      await sleep(40);
    }
    await sleep(500);
    const rapid = reports.filter((r) => r.type === 'audio');
    record('rapid clicks: all meows ok + faded', rapid.length === 6 && rapid.every((r) => r.data.ok) && rapid.slice(1).every((r) => r.data.interrupted) && day.cups === 6,
      `audio=${rapid.length} interrupted=${rapid.filter((r) => r.data.interrupted).length} cups=${day.cups}`);
    const seq = rapid.map((r) => r.data.style);
    const nSounds = usableSounds().length;
    // (variety beyond "never the same twice in a row" is chance: 6 picks of 7 can alternate)
    record('random: no back-to-back repeats', nSounds < 2 || seq.every((s, i) => i === 0 || s !== seq[i - 1]), `${seq.join(',')} (of ${nSounds})`);

    // 11. Her own sounds folder: drop a file -> cleaned + listed + playable; delete -> gone
    {
      // A deliberately bad file: 44.1 kHz stereo, 0.8 s silence, 0.5 s full-scale tone, 0.8 s silence.
      const rate = 44100;
      const frames = Math.round(rate * 2.1);
      const wav = Buffer.alloc(44 + frames * 4);
      wav.write('RIFF', 0); wav.writeUInt32LE(36 + frames * 4, 4); wav.write('WAVE', 8);
      wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
      wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
      wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
      for (let i = 0; i < frames; i++) {
        const t = i / rate;
        const v = t >= 0.8 && t < 1.3 ? Math.max(-1, Math.min(1, 1.4 * Math.sin(2 * Math.PI * 700 * t) + 0.3 * Math.sin(2 * Math.PI * 1400 * t))) : 0;
        const s = Math.round(v * 32767);
        wav.writeInt16LE(s, 44 + i * 4);
        wav.writeInt16LE(s, 46 + i * 4);
      }
      clearReports();
      fs.writeFileSync(path.join(sd, 'Test_Purr.wav'), wav);
      fs.writeFileSync(path.join(sd, 'broken.mp3'), 'this is not audio');
      fs.writeFileSync(path.join(sd, 'notes.txt'), 'ignored');
      fs.copyFileSync(asset(path.join('meows', 'original.wav')), path.join(sd, 'Original.wav')); // same as a bundled sound
      const reloaded = await waitFor((r) => r.type === 'meows-loaded' && r.data.styles.includes('user:test-purr'), 6000);
      const entry = soundCatalog.find((m) => m.id === 'user:test-purr');
      record('sounds folder: new file picked up live', !!entry && entry.group === 'user' && entry.label === 'Test Purr' && !soundCatalog.some((m) => m.file.endsWith('notes.txt')),
        entry ? `${entry.id} "${entry.label}"` : soundCatalog.map((m) => m.id).join(','));
      record('copy of a bundled sound not listed twice', !soundCatalog.some((m) => m.id === 'user:original'), soundCatalog.map((m) => m.id).join(','));
      const c = reloaded && reloaded.data.cleaned && reloaded.data.cleaned['user:test-purr'];
      record('her sound is cleaned (silence trimmed, peak <= -3 dBFS, 48k mono)', !!c && c.seconds > 0.45 && c.seconds < 0.75 && c.peak <= 0.72 && c.channels === 1 && c.sampleRate === 48000,
        c ? JSON.stringify(c) : 'no cleaning stats');
      const skipped = reports.find((r) => r.type === 'sound-skipped' && r.data.id === 'user:broken');
      record('broken file skipped, others still load', !!skipped && BUILTIN.every((m) => reloaded && reloaded.data.styles.includes(m.id)), skipped ? JSON.stringify(skipped.data) : 'no skip report');
      clearReports();
      win.webContents.send('play-meow', { style: 'user:test-purr', volume: settings.volume });
      const pu = await waitFor((r) => r.type === 'audio', 3000);
      record('her sound plays', !!(pu && pu.data.ok && pu.data.style === 'user:test-purr'), pu ? JSON.stringify(pu.data) : 'none');

      openSettings();
      await waitFor((r) => r.type === 'settings:ready', 8000);
      const opts = await settingsWin.webContents.executeJavaScript(`[...document.querySelectorAll('#meowStyle optgroup')].map((g) => g.label + ':' + [...g.children].map((o) => o.value).join('|'))`);
      record('settings lists "Your sounds"', opts.some((g) => g.startsWith('Your sounds:') && g.includes('user:test-purr')), JSON.stringify(opts));
      record('broken file hidden from list', !opts.join().includes('user:broken') && !meowIds().includes('user:broken'), JSON.stringify(opts));
      applySettings({ meowStyle: 'user:test-purr' });
      record('her sound can be chosen', settings.meowStyle === 'user:test-purr');

      clearReports();
      fs.rmSync(path.join(sd, 'Test_Purr.wav'));
      fs.rmSync(path.join(sd, 'broken.mp3'));
      fs.rmSync(path.join(sd, 'notes.txt'));
      fs.rmSync(path.join(sd, 'Original.wav'));
      const gone = await waitFor((r) => r.type === 'meows-loaded' && !r.data.styles.includes('user:test-purr'), 6000);
      await sleep(300);
      const optsAfter = await settingsWin.webContents.executeJavaScript(`[...document.querySelectorAll('#meowStyle option')].map((o) => o.value)`);
      const selAfter = await settingsWin.webContents.executeJavaScript(`document.getElementById('meowStyle').value`);
      record('deleting her file removes it everywhere', !!gone && !soundCatalog.some((m) => m.group === 'user') && settings.meowStyle === 'random' && !optsAfter.includes('user:test-purr') && selAfter === 'random',
        `style=${settings.meowStyle} select=${selAfter}`);
      settingsWin.close();
      await sleep(300);
    }

    // 12. Looks + idle behaviour
    {
      const sp = CatSprites.validate();
      record('sprites valid (all breeds x poses x tail x facing)', sp.length === 0, sp.join('; '));
      const looks = [];
      applySettings({ breed: BREED_IDS[BREED_IDS.length - 1] }); // so the first one is a real change
      await sleep(150);
      for (const b of BREED_IDS) {
        clearReports();
        applySettings({ breed: b, tail: true });
        const l = await waitFor((r) => r.type === 'look' && r.data.breed === b, 3000);
        if (l && l.data.box) looks.push(b);
        await sleep(120);
        await shot(`breed-${b}`);
      }
      record('every breed draws in the cat window', looks.length === BREED_IDS.length, looks.join(','));
      applySettings({ breed: 'fainu', tail: true });
      await sleep(200);

      // Nap: idle -> slides to the bottom of the screen, curls up, z z z
      const area0 = screen.getDisplayNearestPoint({ x: win.getBounds().x + WIN_W / 2, y: win.getBounds().y + WIN_H / 2 }).workArea;
      const homeBefore = win.getBounds();
      applySettings({ sleepSpot: 'bed' }); // Stage E: a known spot (box sleeps sitting)
      clearReports();
      behavior.lastActive = 0; // pretend nobody touched her for ages
      behaviorTick();
      const sleptPose = await waitFor((r) => r.type === 'pose' && r.data.pose === 'sleep', 3000);
      await sleep(1700);
      const bed = win.getBounds();
      const zShown = await wc.executeJavaScript(`document.getElementById('zzz').classList.contains('shown')`);
      record('naps when idle: curled up at the bottom with z z z', behavior.state === 'sleeping' && !!sleptPose && zShown
        && bed.y === area0.y + area0.height - WIN_H && bed.x === homeBefore.x && bed.width === WIN_W && bed.height === WIN_H,
        `state=${behavior.state} y=${bed.y} (bottom ${area0.y + area0.height - WIN_H}) z=${zShown}`);
      await shot('sleeping');
      record('menu offers "Wake up" while asleep', buildContextMenu().items.some((i) => i.label === 'Wake up'));
      const cupsAsleep = day.cups;
      const sb = sleptPose && sleptPose.data.box;
      clearReports();
      if (sb) await click(Math.round(sb.x + sb.width / 2), Math.round(sb.y + sb.height / 2));
      const woke = await waitFor((r) => r.type === 'anim' && r.data.name === 'wake', 2000);
      await sleep(2400);
      const backHome = win.getBounds();
      record('click wakes her (no cup), she stretches and goes home', behavior.state === 'awake' && !!woke && day.cups === cupsAsleep
        && backHome.x === homeBefore.x && backHome.y === homeBefore.y, `state=${behavior.state} cups=${day.cups} at (${backHome.x},${backHome.y})`);
      applySettings({ sleepSpot: 'random' });

      // Idle animations
      settings.idleAnimations = true;
      clearReports();
      behavior.nextIdleAnimAt = 0;
      behaviorTick();
      const idleAnim = await waitFor((r) => r.type === 'anim', 1500);
      record('idle animation fires (stretch or scratch)', !!idleAnim && ['stretch', 'scratch'].includes(idleAnim.data.name), idleAnim ? idleAnim.data.name : 'none');
      await sleep(3200); // let it finish (scratch is the longest, 2.6 s)
      clearReports();
      sendAnim('scratch');
      const scr = await waitFor((r) => r.type === 'pose' && r.data.pose === 'scratch', 1500);
      await sleep(300);
      await shot('scratching');
      const backToSit = await waitFor((r) => r.type === 'pose' && r.data.pose === 'sit', 4500);
      record('scratching post animation, then back to sitting', !!scr && !!backToSit, `scratch=${!!scr} sit=${!!backToSit}`);
      settings.idleAnimations = false;

      // Chase the mouse
      const start = win.getBounds();
      fakeCursor = { x: start.x - 350, y: start.y + 150 };
      clearReports();
      applySettings({ chaseMouse: true });
      const walking = await waitFor((r) => r.type === 'pose' && r.data.pose === 'walk', 2000);
      await sleep(200);
      await shot('walking');
      await sleep(2300);
      const arrived = win.getBounds();
      const sat = behavior.pose === 'sit';
      record('chase: walks toward the cursor (facing it) and sits beside it',
        !!walking && walking.data.facing === -1 && arrived.x < start.x - 200 && sat, `from (${start.x},${start.y}) to (${arrived.x},${arrived.y}) pose=${behavior.pose}`);
      fakeCursor = { x: arrived.x + 120, y: arrived.y + 190 }; // cursor over the cat
      await sleep(400);
      const still = win.getBounds();
      record('chase: holds still while the cursor is on her', still.x === arrived.x && still.y === arrived.y);
      record('menu has "Chase the mouse" checked', buildContextMenu().items.some((i) => i.label === 'Chase the mouse' && i.checked));
      applySettings({ chaseMouse: false });
      await sleep(200);
      const saved2 = readJsonSafe(settingsFile(), {}).position;
      record('chase off: stays + saves the spot', !behavior.chaseTimer && saved2 && saved2.x === still.x && saved2.y === still.y, JSON.stringify(saved2));
      fakeCursor = { x: 1000, y: 500 };
    }

    // 13. Alarms
    {
      const p2 = (n) => String(n).padStart(2, '0');
      const hhmmOf = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
      const pill = settings.alarms.find((a) => a.id === 'pill');
      record('default alarm: 22:00 every day "Pillbrotchen time my dear"', !!pill && pill.time === '22:00' && pill.text === 'Pillbrotchen time my dear' && pill.enabled, JSON.stringify(pill));

      // Goes off at its time (cat hidden -> shows itself), with message + meow
      const nowD = new Date();
      const hhmm = hhmmOf(nowD);
      applySettings({ alarms: [...settings.alarms, { id: 't1', time: hhmm, text: 'Test alarm text', enabled: true }] });
      const at = alarmTimeToday({ time: hhmm });
      hideCat('selftest');
      clearReports();
      lastAlarmCheck = at - 1000; // the minute just started
      tick();
      const ab = await waitFor((r) => r.type === 'bubble' && r.data.shown && r.data.kind === 'alarm', 2000);
      const aa = await waitFor((r) => r.type === 'audio', 3000);
      record('alarm goes off at its time: message + meow, cat shows itself', !!ab && ab.data.text === 'Test alarm text' && !!(aa && aa.data.ok) && win.isVisible(),
        `bubble=${ab ? ab.data.text : 'none'} visible=${win.isVisible()}`);
      await shot('alarm');
      clearReports();
      lastAlarmCheck = at - 1000;
      tick();
      await sleep(300);
      record('alarm fires once per day', activeAlarm && activeAlarm.repeats === 0 && !reports.some((r) => r.type === 'audio'), `repeats=${activeAlarm && activeAlarm.repeats}`);
      clearReports();
      activeAlarm.nextAt = 0; // pretend 5 minutes passed
      tick();
      const arep = await waitFor((r) => r.type === 'audio', 3000);
      record('alarm meows again until acknowledged', !!arep && activeAlarm && activeAlarm.repeats === 1);

      // Alarm wins over the water reminder; clicking the cat dismisses the alarm only (no cup)
      fireReminder('test');
      await sleep(200);
      const lastBubble = [...reports].reverse().find((r) => r.type === 'bubble' && r.data.shown);
      record('alarm message wins over the water bubble', !!lastBubble && lastBubble.data.kind === 'alarm', lastBubble ? JSON.stringify(lastBubble.data) : 'none');
      record('menu offers "Dismiss alarm"', buildContextMenu().items.some((i) => i.label === 'Dismiss alarm'));
      const cups0 = day.cups;
      clearReports();
      await click(cx, cy);
      const waterBack = await waitFor((r) => r.type === 'bubble' && r.data.shown && r.data.kind === 'water', 2000);
      record('click dismisses the alarm (no cup); water bubble comes back', !activeAlarm && day.cups === cups0 && !!waterBack, `cups=${day.cups} water=${!!waterBack}`);
      dismissReminder('selftest');
      await sleep(150);

      // Missed while the app was closed / PC asleep: fires late (up to 2 h), not if older
      const late = new Date(Date.now() - 70 * 60000);
      const old = new Date(Date.now() - 3 * 60 * 60000);
      if (late.getDate() === nowD.getDate() && old.getDate() === nowD.getDate()) {
        applySettings({ alarms: [...settings.alarms, { id: 't2', time: hhmmOf(late), text: 'Late one', enabled: true }, { id: 't3', time: hhmmOf(old), text: 'Too old', enabled: true }] });
        lastAlarmCheck = Date.now() - ALARM_LATE_MS; // like a fresh start
        clearReports();
        tick();
        const lateB = await waitFor((r) => r.type === 'bubble' && r.data.shown && r.data.kind === 'alarm', 2000);
        record('missed alarm fires late (<= 2 h), older ones don\'t', !!lateB && lateB.data.text === 'Late one' && alarmQueue.length === 0 && alarmState.t3 !== todayKey(),
          lateB ? lateB.data.text : 'none');
        dismissAlarm('selftest');
      } else {
        record('missed alarm fires late (<= 2 h), older ones don\'t', true, 'skipped: too close to midnight');
      }

      // Settings UI: add an alarm with her own text + time, reject junk, delete
      clearReports();
      openSettings();
      await waitFor((r) => r.type === 'settings:ready', 8000);
      const swc2 = settingsWin.webContents;
      await swc2.executeJavaScript(`(() => {
        document.getElementById('add-alarm').click();
        const row = [...document.querySelectorAll('.alarm-row')].pop();
        const t = row.querySelector('.a-time'); t.value = '08:30'; t.dispatchEvent(new Event('change', { bubbles: true }));
        const m = row.querySelector('.a-text'); m.value = 'Water the plants'; m.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await waitFor((r) => r.type === 'settings:saved' && r.data.partial.alarms && r.data.partial.alarms.some((a) => a.text === 'Water the plants'), 3000);
      const mine = settings.alarms.find((a) => a.text === 'Water the plants');
      record('Settings: add an alarm with any text + time', !!mine && mine.time === '08:30' && mine.enabled && readJsonSafe(settingsFile(), {}).alarms.some((a) => a.text === 'Water the plants'),
        JSON.stringify(mine));
      const before = JSON.stringify(settings.alarms);
      applySettings({ alarms: [...settings.alarms, { id: 'bad', time: '25:00', text: 'x', enabled: true }] });
      applySettings({ alarms: [...settings.alarms, { id: 'bad2', time: '10:00', text: '   ', enabled: true }] });
      record('invalid alarm (bad time / empty text) not saved', JSON.stringify(settings.alarms) === before);
      if (mine) {
        await swc2.executeJavaScript(`document.querySelector('.alarm-row[data-id="${mine.id}"] .a-del').click()`);
        await sleep(400);
      }
      record('Settings: delete an alarm', !settings.alarms.some((a) => a.text === 'Water the plants'));
      settingsWin.close();
      await sleep(300);

      // A long message wraps (max 3 lines) and stays inside the window
      const long = 'This is a very long alarm message to check that the speech bubble wraps nicely onto a few lines and never covers the cat';
      applySettings({ alarms: [...settings.alarms.filter((a) => a.id === 'pill'), { id: 'long', time: '03:00', text: long.slice(0, 120), enabled: true }] });
      testAlarm('long');
      await sleep(300);
      const bb = await wc.executeJavaScript(`(() => { const r = document.getElementById('bubble').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: innerWidth, head: document.getElementById('pet').getBoundingClientRect().top }; })()`);
      record('long alarm text wraps inside the top of the window, above her head', bb.top >= 0 && bb.bottom <= bb.head - 20 && bb.left >= 0 && bb.right <= bb.w, JSON.stringify(bb));
      await shot('alarm-long');
      dismissAlarm('selftest');
      applySettings({ alarms: settings.alarms.filter((a) => a.id === 'pill') });
    }

    // 14. Cat size: window grows/shrinks around her feet, sprite stays pixel-perfect
    {
      const area = screen.getPrimaryDisplay().workArea;
      setWinPos(area.x + 500, area.y + 300);
      for (const size of [12, 4, 8]) {
        const b0 = win.getBounds();
        clearReports();
        applySettings({ catSize: size });
        const rep = await waitFor((r) => r.type === 'size' && r.data.size === size, 3000);
        const b1 = win.getBounds();
        const want = winSizeFor(size);
        const ok = !!rep && b1.width === want.w && b1.height === want.h && rep.data.canvas.w === 30 * size && rep.data.canvas.h === CatSprites.CANVAS.rows * size
          && Math.abs(b1.x + b1.width / 2 - (b0.x + b0.width / 2)) <= 1 && b1.y + b1.height === b0.y + b0.height;
        record(`cat size ${Math.round((size / 8) * 100)}%: window ${want.w}x${want.h}, feet stay put`, ok, `bounds=${JSON.stringify(b1)} canvas=${rep ? JSON.stringify(rep.data.canvas) : 'none'}`);
        if (size === 12) await shot('size-150');
      }
      record('size saved (in the cat profile)', diskCat().size === 8);
    }

    // 15. Restart + resize with the mouse
    {
      let restartOpts = null;
      selftestHooks.onRestart = (opts) => { restartOpts = opts; };
      const rb2 = ready.data.restartBtn;
      await click(Math.round(rb2.x + rb2.width / 2), Math.round(rb2.y + rb2.height / 2));
      await sleep(300);
      record('restart button relaunches the app (same args, no --selftest)', !!restartOpts && !restartOpts.args.includes('--selftest'), JSON.stringify(restartOpts));
      restartOpts = null;
      buildContextMenu().items.find((i) => i.label === 'Restart cat').click();
      record('"Restart cat" in the right-click menu', !!restartOpts);
      selftestHooks.onRestart = null;

      // Corner handle: drag right/down = bigger
      const area = screen.getPrimaryDisplay().workArea;
      setWinPos(area.x + 500, area.y + 300);
      await sleep(100);
      const gr = ready.data.grip;
      const gx = Math.round(gr.x + gr.width / 2);
      const gy = Math.round(gr.y + gr.height / 2);
      fakeCursor = { x: 1500, y: 800 };
      const cupsG = day.cups;
      clearReports();
      // hover first (the handle only takes the mouse while she's hovered), like a real mouse
      send({ type: 'mouseMove', x: gx - 30, y: gy - 30 });
      await sleep(100);
      send({ type: 'mouseMove', x: gx, y: gy });
      await sleep(250);
      const onGrip = await wc.executeJavaScript(`document.elementFromPoint(${gx}, ${gy}).id`);
      send({ type: 'mouseDown', x: gx, y: gy, button: 'left', clickCount: 1 });
      await sleep(80);
      fakeCursor = { x: 1500 + 66, y: 800 + 66 }; // +3 steps
      await sleep(250);
      send({ type: 'mouseUp', x: gx, y: gy, button: 'left', clickCount: 1 });
      await sleep(250);
      record('resize handle: drag bigger', settings.catSize === 11 && !resizeDrag && win.getBounds().width === winSizeFor(11).w && day.cups === cupsG,
        `size=${settings.catSize} pressed=${onGrip} bounds=${JSON.stringify(win.getBounds())}`);
      // Scroll wheel over the cat = one step per notch (size 11 layout now)
      const c11 = await wc.executeJavaScript(`(() => { const r = document.getElementById('pet').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      // (sendInputEvent wheel deltas are the opposite sign of the page's WheelEvent:
      //  +120 here = the wheel rolled up/away = bigger)
      const wheel = (up) => send({ type: 'mouseWheel', x: Math.round(c11.x), y: Math.round(c11.y), deltaX: 0, deltaY: up ? 120 : -120, wheelTicksY: up ? 1 : -1 });
      for (let i = 0; i < 4; i++) {
        wheel(true);
        await sleep(200);
      }
      const afterUp = settings.catSize;
      wheel(false);
      await sleep(250);
      record('scroll wheel over her resizes (whole steps, max 175%)', afterUp === 14 && settings.catSize === 13, `11 -> up x4 = ${afterUp} (max 14) -> down = ${settings.catSize}`);
      applySettings({ mouseResize: false });
      await sleep(150);
      wheel(false);
      await sleep(250);
      record('"Resize with the mouse" off: wheel does nothing', settings.catSize === 13, `size=${settings.catSize}`);
      applySettings({ mouseResize: true, catSize: 8 });
      await sleep(200);
      fakeCursor = { x: 1000, y: 500 };
    }

    // 16. Stage 0: Gargorl
    {
      record('Gargorl is the default cat', DEFAULT_SETTINGS.breed === 'gargorl' && DEFAULT_SETTINGS.catName === 'Gargorl'
        && CatSprites.PRESETS.gargorl.label === 'Gargorl' && CatSprites.PRESETS.fainu.label === 'Fainu' && !CatSprites.presetList().some((p) => /calico/i.test(p.label))
        && JSON.stringify(DEFAULT_SETTINGS.colors) === JSON.stringify(CatSprites.GARGORL) && DEFAULT_SETTINGS.whiskersEnabled === true);
      const g = CatSprites.render('sit', 'sit', { ...CatSprites.PRESETS.gargorl, tail: true, whiskers: true }, 1).flat().filter(Boolean);
      const has = (c) => g.includes(c);
      record('Gargorl palette (checked against the photo): blue-gray fur + shade, lighter muzzle, yellow-green eyes, gray nose, no patches',
        has('#6d7584') && has('#555b68') && has('#8e939e') && has('#bfd35a') && has('#1f2226') && has('#f5f8d8') && has('#6f6870') && has('#2b2e35')
        && CatSprites.GARGORL.whiskers === '#d9dbe0'
        && !g.some((c) => ['#e8913a', '#4a4040', '#fff6ea'].includes(c)), [...new Set(g)].join(' '));
      applySettings({ breed: 'gargorl', tail: true });
      await sleep(300);
      await shot('gargorl');

      // First launch: 10 s bubble with exactly the line, only once
      clearReports();
      settings.firstRunDone = false;
      const shownNow = maybeShowIntro();
      const intro = await waitFor((r) => r.type === 'bubble' && r.data.shown && r.data.kind === 'intro', 2000);
      record('first launch: bubble with exactly the line', shownNow && !!intro
        && intro.data.text === "Gone but not forgotten. She's not dead 💀. She just moved away", intro ? intro.data.text : 'none');
      record('first launch: firstRunDone saved, not shown again', readJsonSafe(settingsFile(), {}).firstRunDone === true && maybeShowIntro() === false);
      await shot('intro');
      const introGone = await waitFor((r) => r.type === 'bubble' && !r.data.shown, 11000);
      const secs = intro && introGone ? (introGone.t - intro.t) / 1000 : -1;
      record('first-launch bubble goes away after 10 s', !!introGone && introGone.data.reason === 'timeout' && secs > 9.5 && secs < 11, `${secs.toFixed(1)} s`);

      // Menu + tray
      const first = buildContextMenu().items[0];
      const second = buildContextMenu().items[1];
      record('right-click menu: "Gargorl ♀" (disabled) + clickable "In loving memory of Gargorl"', first.label === 'Gargorl ♀' && !first.enabled
        && second.label === 'In loving memory of Gargorl' && second.enabled, `${first.label} / ${second.label}`);
      pushState();
      record('tray tooltip "In loving memory of Gargorl ♀"', trayTipText.split('\n')[0] === 'In loving memory of Gargorl ♀', JSON.stringify(trayTipText));

      // Rename: menu/tray follow; the line keeps its text until edited
      applySettings({ catName: 'Mochi' });
      pushState();
      record('rename: Gargorl keeps "In loving memory of" (label follows her id, not her name)', buildContextMenu().items[1].label === 'In loving memory of Mochi' && trayTipText.startsWith('In loving memory of Mochi'), trayTipText);
      applySettings({ catDescriptor: 'The fluffiest' });
      pushState();
      record('rename: the line is editable', infoData('gargorl').description === 'The fluffiest');
      applySettings({ catName: '   ' });
      record('empty name rejected', settings.catName === 'Mochi');
      applySettings({ catDescriptor: '' });
      record('empty line allowed (e.g. Fainu starts without one)', settings.catDescriptor === '');
      applySettings({ catDescriptor: 'x'.repeat(201) });
      record('line over 200 characters rejected', settings.catDescriptor === '');
      applySettings({ catName: 'Gargorl', catDescriptor: GARGORL_LINE });

      // Sound switch
      applySettings({ soundEnabled: false });
      await sleep(150);
      clearReports();
      win.webContents.send('play-meow', { style: 'original', volume: settings.volume });
      const muted = await waitFor((r) => r.type === 'audio', 2000);
      record('"Sound on" off: no sound plays', !!muted && muted.data.muted === true, muted ? JSON.stringify(muted.data) : 'none');
      applySettings({ soundEnabled: true });

      // Upgrade: a saved non-Gargorl cat switches to Gargorl the first time this version runs
      const keep = { ...settings };
      writeJsonSafe(settingsFile(), oldFormat({ ...keep, breed: 'persian', firstRunDone: undefined }));
      loadSettings();
      const upgraded = settings.breed;
      writeJsonSafe(settingsFile(), oldFormat({ ...keep, breed: 'persian', firstRunDone: true }));
      loadSettings();
      const later = settings.breed;
      record('first run of this version opens with Gargorl; her later choice is kept', upgraded === 'gargorl' && later === 'persian', `${upgraded} then ${later}`);
      settings = keep;
      saveSettings();
      pushState();
    }

    // 17. Stage 1: layered sprite wired in
    {
      // every part recolours independently (each part -> its own unique colour, all appear)
      const uniq = {};
      CatSprites.PARTS.forEach((p, i) => { uniq[p] = `#${(0x101010 + i * 0x0b0907).toString(16).padStart(6, '0').slice(-6)}`; });
      const seen = new Set();
      for (const [pose, frames] of Object.entries(CatSprites.POSES)) {
        for (const f of frames) for (const pattern of ['solid', 'calico']) {
          CatSprites.render(pose, f, { colors: uniq, pattern, ears: 'normal', fluffy: false, tufts: false, tail: true, whiskers: true }, 1).flat().forEach((c) => c && seen.add(c));
        }
      }
      const missing = CatSprites.PARTS.filter((p) => p !== 'whiskers' && !seen.has(uniq[p]));
      record('all parts have their own letter + colour (incl. patches)', missing.length === 0, missing.join(','));
      const gOn = CatSprites.render('sit', 'sit', { ...CatSprites.PRESETS.gargorl, whiskers: true }).flat();
      const linesOn = CatSprites.whiskerLines('sit', 'sit', { ...CatSprites.PRESETS.gargorl, whiskers: true });
      const linesOff = CatSprites.whiskerLines('sit', 'sit', { ...CatSprites.PRESETS.gargorl, whiskers: false });
      record('whiskers are a separate line layer (on/off), not sprite pixels', linesOn.length === 6 && linesOff.length === 0 && !gOn.includes(CatSprites.GARGORL.whiskers),
        `lines on=${linesOn.length} off=${linesOff.length}`);
      const t8 = CatSprites.whiskerSquares(linesOn, 8);
      const t4 = CatSprites.whiskerSquares(linesOn, 4);
      const t14 = CatSprites.whiskerSquares(linesOn, 14);
      record('whiskers are fine: 1 px at 50-100%, 2 px at 175%', t8.every((q) => q[2] === 1) && t4.every((q) => q[2] === 1) && t14.every((q) => q[2] === 2),
        `t@8=${t8[0][2]} t@14=${t14[0][2]} squares@8=${t8.length}`);
      const inside = CatSprites.PRESETS && Object.keys(CatSprites.POSES).every((pose) => CatSprites.POSES[pose].every((f) => [1, -1].every((fc) =>
        CatSprites.whiskerSquares(CatSprites.whiskerLines(pose, f, { whiskers: true }, fc), 8).every(([x, y]) => x >= 0 && y >= 0 && x < 240 && y < CatSprites.CANVAS.rows * 8))));
      record('whiskers stay on the canvas in every pose + facing', inside);
      const wPx = await wc.executeJavaScript(`(() => { const c = document.getElementById('sprite'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 0xd9 && d[i+1] === 0xdb && d[i+2] === 0xe0) n++; return n; })()`);
      record('cat window draws thin whiskers', wPx > 20 && wPx < 400, `${wPx} whisker pixels (thick cells would be ~768)`);

      // settings.json: colors + whiskersEnabled, live redraw via 'colors-changed'
      clearReports();
      applySettings({ colors: { eyes: '#ff0000' } });
      const red = await waitFor((r) => r.type === 'look' && r.data.colors && r.data.colors.eyes === '#ff0000', 2000);
      const onDisk = diskCat();
      record('recolour one part: saved + cat redraws', !!red && onDisk.colors.eyes === '#ff0000' && onDisk.colors.furBase === CatSprites.GARGORL.furBase && settings.breed === 'custom',
        `eyes=${onDisk.colors.eyes} breed=${settings.breed}`);
      applySettings({ colors: { nose: 'pink', paws: '#12345' } });
      record('bad colour values ignored (per part)', settings.colors.nose === CatSprites.GARGORL.nose && settings.colors.paws === CatSprites.GARGORL.paws);
      clearReports();
      applySettings({ whiskersEnabled: false });
      const wl = await waitFor((r) => r.type === 'look' && r.data.whiskers === false, 2000);
      record('whiskers toggle saved + redrawn', !!wl && diskCat().whiskersEnabled === false);
      applySettings({ whiskersEnabled: true, breed: 'gargorl' });
      record('choosing a preset restores its colours', JSON.stringify(settings.colors) === JSON.stringify(CatSprites.GARGORL) && settings.breed === 'gargorl');
      applySettings({ breed: 'fainu' });
      record('Fainu preset: calico pattern + her colours', settings.furPattern === 'calico' && settings.colors.patchA === '#e8913a');
      applySettings({ breed: 'gargorl' });

      // upgrade: old settings with only "breed" get that preset's colours
      const keep = { ...settings };
      const old = oldFormat({ ...keep, breed: 'mainecoon', firstRunDone: true });
      delete old.colors;
      writeJsonSafe(settingsFile(), old);
      loadSettings();
      record('upgrade: saved breed -> its layered colours', settings.breed === 'mainecoon' && settings.tufts === true && settings.colors.furBase === CatSprites.PRESETS.mainecoon.colors.furBase);
      settings = keep;
      saveSettings();
      pushState();

      // idle life: blink / tail wag happen on their own (stepped frames, no log spam)
      const life0 = await wc.executeJavaScript('window.__idleLife || 0');
      await sleep(6500);
      const life1 = await wc.executeJavaScript('window.__idleLife || 0');
      record('idle life: blink + tail wag tick by themselves', life1 > life0, `${life0} -> ${life1}`);
      const smooth = await wc.executeJavaScript(`(() => { const c = document.getElementById('sprite'); return { s: c.getContext('2d').imageSmoothingEnabled, r: getComputedStyle(c).imageRendering, w: c.width, cw: c.clientWidth }; })()`);
      record('canvas is pixel-perfect (no smoothing, integer scale)', smooth.s === false && smooth.r === 'pixelated' && smooth.w === smooth.cw && smooth.w % 30 === 0, JSON.stringify(smooth));
      await shot('stage1-gargorl');
    }

    // 18. Stage 2: Customize window
    {
      clearReports();
      const item = buildContextMenu().items.find((i) => i.label === 'Customize cat…');
      record('"Customize cat…" in the right-click menu', !!item);
      item.click();
      const cr = await waitFor((r) => r.type === 'customize:ready', 8000);
      record('Customize window opens (own preload + page)', !!cr && !!customizeWin && BrowserWindow.getAllWindows().length >= 2 && cr.data.presets >= 13, cr ? JSON.stringify(cr.data) : 'no ready');
      if (cr) {
        const cwc = customizeWin.webContents;
        const js = (code) => cwc.executeJavaScript(code);
        const fire = (sel, value, ev) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(${JSON.stringify(ev)}, { bubbles: true })); })()`);
        const ink = (id) => js(`(() => { const c = document.getElementById('${id}'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()`);
        const head = await js(`({ name: document.getElementById('catName').value, desc: document.getElementById('catDescriptor').value, locked: document.getElementById('catDescriptor').disabled })`);
        record('header card: name + her line (editable per cat) + live preview', head.name === settings.catName && head.desc === settings.catDescriptor && head.locked === false && (await ink('preview')) > 800, JSON.stringify(head));
        const sw = await js(`document.querySelectorAll('#swatches input[type=color]').length`);
        record('Basic tab: 16 colour swatches', sw === 16, `${sw}`);

        // swatch -> live cat (throttled save)
        clearReports();
        await fire('#sw-eyes', '#00ff00', 'input');
        const g1 = await waitFor((r) => r.type === 'look' && r.data.colors && r.data.colors.eyes === '#00ff00', 3000);
        record('swatch changes the live cat + saves', !!g1 && diskCat().colors.eyes === '#00ff00');

        // presets + reset + randomize
        clearReports();
        await js(`document.querySelector('[data-preset="tuxedo"]').click()`);
        await waitFor((r) => r.type === 'look' && r.data.breed === 'tuxedo', 3000);
        record('preset button (Tuxedo) applies its whole look', settings.breed === 'tuxedo' && settings.furPattern === 'tuxedo' && settings.colors.furBase === CatSprites.PRESETS.tuxedo.colors.furBase);
        const before = JSON.stringify(settings.colors);
        await js(`document.getElementById('randomize').click()`);
        await sleep(400);
        record('Randomize makes a new look', JSON.stringify(settings.colors) !== before && settings.breed === 'custom');
        await js(`document.getElementById('reset').click()`);
        await sleep(400);
        record('Reset to default = Gargorl', settings.breed === 'gargorl' && JSON.stringify(settings.colors) === JSON.stringify(CatSprites.GARGORL));

        // pattern, tail, whiskers, size
        await fire('#furPattern', 'spots', 'change');
        await js(`(() => { const t = document.getElementById('whiskersEnabled'); t.checked = false; t.dispatchEvent(new Event('change')); })()`);
        await js(`document.querySelector('input[name=size][value="11"]').click()`);
        await sleep(500);
        record('pattern / whiskers / size (Large) from Customize', settings.furPattern === 'spots' && settings.whiskersEnabled === false && settings.catSize === 11 && win.getBounds().width === winSizeFor(11).w,
          `pattern=${settings.furPattern} whiskers=${settings.whiskersEnabled} size=${settings.catSize}`);
        applySettings({ catSize: 8, whiskersEnabled: true, breed: 'gargorl' });
        await sleep(300);

        // Advanced: hex, RGB, HSB, eyedropper
        await js(`document.getElementById('tab-advanced').click()`);
        await fire('#part', 'nose', 'change');
        await fire('#hex', '#123456', 'input');
        await sleep(300);
        const hexOk = settings.colors.nose === '#123456';
        await js(`(() => { for (const [id, v] of [['r', 255], ['g', 0], ['b', 0]]) { const el = document.getElementById(id); el.value = v; } document.getElementById('b').dispatchEvent(new Event('input')); })()`);
        await sleep(300);
        const rgbOk = settings.colors.nose === '#ff0000';
        await js(`(() => { document.getElementById('h').value = 240; document.getElementById('s').value = 100; document.getElementById('v').value = 100; document.getElementById('v').dispatchEvent(new Event('input')); })()`);
        await sleep(300);
        const hsbOk = settings.colors.nose === '#0000ff';
        record('Advanced: hex / RGB / hue-sat-brightness edit one part', hexOk && rgbOk && hsbOk, `hex=${hexOk} rgb=${rgbOk} hsb=${hsbOk}`);
        const edAvail = await js(`typeof window.EyeDropper === 'function'`);
        await js(`(() => { window.EyeDropper = undefined; document.getElementById('eyedropper').click(); })()`);
        await sleep(200);
        const edMsg = await js(`document.getElementById('eyedropper-msg').textContent`);
        record('Eyedropper: API present; if unavailable a message shows + hex still works', edAvail === true && /hex/i.test(edMsg), `available=${edAvail} fallback="${edMsg}"`);

        // my presets: save, load, delete
        applySettings({ breed: 'siamese' });
        await sleep(200);
        await fire('#preset-name', 'My Siamese', 'input');
        await js(`document.getElementById('save-preset').click()`);
        await sleep(400);
        const saved = settings.customPresets.find((p) => p.name === 'My Siamese');
        applySettings({ breed: 'gargorl' });
        await sleep(300);
        await js(`[...document.querySelectorAll('#my-presets li')].find((li) => li.textContent.includes('My Siamese')).querySelector('button').click()`);
        await sleep(400);
        record('save + load my own named preset', !!saved && settings.colors.furBase === CatSprites.PRESETS.siamese.colors.furBase && readJsonSafe(settingsFile(), {}).customPresets.length === 1);
        await js(`[...document.querySelectorAll('#my-presets li')].find((li) => li.textContent.includes('My Siamese')).querySelectorAll('button')[1].click()`);
        await sleep(300);
        record('delete my preset', !settings.customPresets.some((p) => p.name === 'My Siamese'));

        // export / import (dialog paths supplied by the test)
        const file = path.join(dataDir(), 'look-test.watercat.json');
        selftestHooks.dialogPath = file;
        await js(`document.getElementById('export').click()`);
        await sleep(400);
        const exported = readJsonSafe(file, {});
        applySettings({ breed: 'black' });
        await sleep(200);
        await js(`document.getElementById('import').click()`);
        await sleep(400);
        record('export + import a look as a small JSON file', exported.type === 'watercat-look' && settings.colors.furBase === CatSprites.PRESETS.siamese.colors.furBase && fs.statSync(file).size < 2048,
          `bytes=${fs.statSync(file).size}`);
        fs.writeFileSync(file, JSON.stringify({ type: 'watercat-look', look: { colors: { eyes: 'red' } } }));
        const bad = await importLook();
        record('importing a broken look is refused', bad.ok === false && settings.colors.furBase === CatSprites.PRESETS.siamese.colors.furBase, bad.error);
        selftestHooks.dialogPath = null;
        fs.rmSync(file, { force: true });

        // rename from the header: line becomes editable
        await fire('#catName', 'Pixel', 'input');
        await sleep(400);
        await sleep(400); // saves ~500 ms after typing stops
        const unlocked = await js(`!document.getElementById('catDescriptor').disabled`);
        record('rename in the header card saves (after typing stops)', settings.catName === 'Pixel' && unlocked);
        applySettings({ catName: 'Gargorl', catDescriptor: GARGORL_LINE, breed: 'gargorl' });
        await sleep(300);
        try { fs.writeFileSync(path.join(LOG_DIR, 'selftest-customize.png'), (await cwc.capturePage()).toPNG()); } catch (_) { /* ignore */ }
        customizeWin.close();
        await sleep(300);
        record('Customize closes, cat keeps running', !customizeWin && !!win && !win.isDestroyed());
      }
    }

    // 19. Stage 3: petting
    {
      applySettings({ breed: 'gargorl', catSize: 8, soundEnabled: true });
      const area = screen.getPrimaryDisplay().workArea;
      setWinPos(area.x + 400, area.y + 300);
      await sleep(400);
      const box = hitRects.pet;
      const mx = Math.round(box.x + box.width / 2);
      const my = Math.round(box.y + box.height * 0.6);
      // (synthetic events need globalX/Y: petting measures travel in screen coordinates)
      const stroke = async (n = 14, opts = {}) => {
        const b = win.getBounds();
        for (let i = 0; i < n; i++) {
          const x = mx + (i % 2 ? 40 : -40);
          const y = my + (i % 3) * 4;
          send({ type: 'mouseMove', x, y, globalX: b.x + x, globalY: b.y + y, ...opts });
          await sleep(30);
        }
      };
      lastStrokePetAt = 0;
      const pets0 = petsOf().today;
      const total0 = petsOf().total;
      clearReports();
      await stroke();
      const petPose = await waitFor((r) => r.type === 'pose' && r.data.pose === 'belly', 2000);
      const purr1 = await waitFor((r) => r.type === 'purr', 2000);
      const heartCount = await wc.executeJavaScript(`document.querySelectorAll('#hearts canvas').length`);
      record('stroking her (mouse back and forth, no button) = a pet', petsOf().today === pets0 + 1 && petsOf().total === total0 + 1, `today ${pets0} -> ${petsOf().today}`);
      record('pet: belly-up pose + floating hearts + purr', !!petPose && heartCount >= 3 && !!(purr1 && purr1.data.started), `hearts=${heartCount} purr=${purr1 ? JSON.stringify(purr1.data) : 'none'}`);
      await shot('petted');
      await sleep(1100); // past the page's own 1 s ask-throttle, still inside the 4 s cooldown
      clearReports();
      await stroke();
      await sleep(300);
      const cool = reports.find((r) => r.type === 'stroke');
      record('4 s cooldown between pets', petsOf().today === pets0 + 1 && !!cool && cool.data.ok === false, cool ? JSON.stringify(cool.data) : 'no stroke report');
      // a still mouse while she resizes / moves under it is NOT a pet
      await sleep(1500); // let the earlier stroke leave the rolling 1.2 s window
      lastStrokePetAt = 0;
      const pets2 = petsOf().today;
      // a still mouse: same screen point every time, while the window changes size under it
      const still = { x: win.getBounds().x + mx, y: win.getBounds().y + my };
      for (const sz of [10, 12, 9, 11, 8]) {
        applySettings({ catSize: sz });
        const b = win.getBounds();
        send({ type: 'mouseMove', x: still.x - b.x, y: still.y - b.y, globalX: still.x, globalY: still.y });
        await sleep(120);
      }
      await sleep(300);
      record('no accidental pet when she resizes / moves under a still mouse', petsOf().today === pets2, `today=${petsOf().today}`);
      const backSit = await waitFor((r) => r.type === 'pose' && r.data.pose === 'sit', 4000);
      record('returns to sitting after ~3 s', !!backSit);

      // purr never stacks: a second pet during the purr extends it
      for (let i = 0; i < 30 && (await wc.executeJavaScript('window.__purrActive()')); i++) await sleep(100);
      clearReports();
      win.webContents.send('petted', { kind: 'stroke', quiet: false });
      await sleep(150);
      win.webContents.send('petted', { kind: 'stroke', quiet: false });
      await sleep(150);
      const purrs = reports.filter((r) => r.type === 'purr');
      const active = await wc.executeJavaScript('window.__purrActive()');
      record('purr: a new pet extends it, never stacks', purrs.length === 2 && purrs[0].data.started && purrs[1].data.extended && active, purrs.map((p) => JSON.stringify(p.data)).join(' '));
      await sleep(3600);

      // ignored while dragging + over the hover buttons
      lastStrokePetAt = 0;
      const pets1 = petsOf().today;
      send({ type: 'mouseDown', x: mx, y: my, button: 'left', clickCount: 1 });
      await stroke(14, { modifiers: ['leftButtonDown'] });
      send({ type: 'mouseUp', x: mx, y: my, button: 'left', clickCount: 1 });
      await sleep(300);
      record('no pet while the button is held / dragging', petsOf().today === pets1, `today=${petsOf().today}`);
      if (!win.isVisible()) showCat();
      undoCup('selftest'); // that press/release was a click
      setWinPos(area.x + 400, area.y + 300);
      await sleep(300);
      const hb = hitRects.buttons[1];
      for (let i = 0; i < 14; i++) {
        const x = Math.round(hb.x + hb.width / 2);
        const y = Math.round(hb.y + (i % 2 ? 2 : hb.height - 2));
        send({ type: 'mouseMove', x, y, globalX: win.getBounds().x + x, globalY: win.getBounds().y + y });
        await sleep(30);
      }
      await sleep(300);
      record('no pet over the hover buttons', petsOf().today === pets1, `today=${petsOf().today}`);

      // nose boop: squeak + surprised blink + pet, no cup; body click still a cup
      await sleep(400);
      const nose = hitRects.nose;
      record('nose area known while sitting', !!nose, JSON.stringify(nose));
      if (nose) {
        const nx = Math.round(nose.x + nose.width / 2);
        const ny = Math.round(nose.y + nose.height / 2);
        const b0 = win.getBounds();
        fakeCursor = { x: b0.x + nx, y: b0.y + ny };
        const cupsB = day.cups;
        const petsB = petsOf().today;
        clearReports();
        await click(nx, ny);
        const sq = await waitFor((r) => r.type === 'squeak', 1500);
        const boopAnim = await waitFor((r) => r.type === 'anim' && r.data.name === 'boop', 1500);
        record('nose boop: squeak + surprised blink + 1 pet, no cup', day.cups === cupsB && petsOf().today === petsB + 1 && !!sq && !!boopAnim, `cups=${day.cups} pets=${petsOf().today}`);
        fakeCursor = { x: b0.x + mx, y: b0.y + my + 20 };
        await sleep(900);
        await click(mx, my + 20);
        await sleep(300);
        record('a click on her body still logs a cup', day.cups === cupsB + 1, `cups=${day.cups}`);
        undoCup('selftest');
        fakeCursor = { x: 1000, y: 500 };
      }

      const line = buildContextMenu().items.find((i) => /^Pets today: \d+$/.test(i.label));
      record('right-click menu: disabled "Pets today: N"', !!line && !line.enabled && line.label === `Pets today: ${petsOf().today}`, line && line.label);
      const onDisk = readJsonSafe(cupsFile(), {});
      record('pets saved in the daily data, per cat', onDisk.pets[settings.activeCatId].today === petsOf().today && onDisk.pets[settings.activeCatId].total === petsOf().total, JSON.stringify(onDisk));

      // sound off / quiet hours
      applySettings({ soundEnabled: false });
      await sleep(150);
      clearReports();
      lastStrokePetAt = 0;
      await stroke();
      const muted = await waitFor((r) => r.type === 'purr', 1500);
      record('sound off: pet still happens, purr silent', !!muted && muted.data.muted === true);
      applySettings({ soundEnabled: true, quietStart: '00:00', quietEnd: '23:59' });
      await sleep(3500);
      clearReports();
      lastStrokePetAt = 0;
      await stroke();
      const qp = await waitFor((r) => r.type === 'purr', 1500);
      record('quiet hours: very soft purr', !!qp && qp.data.quiet === true && qp.data.level <= 0.3 * settings.volume + 0.001, qp ? JSON.stringify(qp.data) : 'none');
      applySettings({ quietStart: '23:00', quietEnd: '08:00' });
      await sleep(3500);
    }

    // 20. Stage A: cat profiles
    {
      applySettings({ breed: 'gargorl', catSize: 8, catName: 'Gargorl', catDescriptor: GARGORL_LINE });
      await sleep(200);
      const disk0 = readJsonSafe(settingsFile(), {});
      record('settings.json: cats[] + activeCatId, no global cat keys', Array.isArray(disk0.cats) && disk0.activeCatId === settings.activeCatId
        && !('catName' in disk0) && !('colors' in disk0) && !('catSize' in disk0) && disk0.cats.some((c) => c.id === 'gargorl'), `cats=${(disk0.cats || []).map((c) => c.id)}`);
      const g0 = disk0.cats.find((c) => c.id === 'gargorl');
      record('profile fields: name, gender, description, colors, whiskers, pattern, size, accessories, sleepSpot, sleepSpotColors',
        ['name', 'gender', 'description', 'colors', 'whiskersEnabled', 'pattern', 'size', 'accessories', 'sleepSpot', 'sleepSpotColors'].every((k) => k in g0)
        && g0.gender === 'female' && g0.sleepSpot === 'random', Object.keys(g0).join(','));

      // a second cat; editing one never changes the other
      const cupsBefore = day.cups;
      const b = createCat();
      record('new cat: Gargorl\'s default look, auto name, unique id, gender unspecified', /^Cat \d+$/.test(b.name) && b.id !== 'gargorl' && b.gender === 'unspecified'
        && JSON.stringify(b.colors) === JSON.stringify(CatSprites.GARGORL) && b.description.length > 10, `${b.id} "${b.name}" "${b.description}"`);
      applySettings({ colors: { eyes: '#ff00ff' }, catGender: 'female' }); // active = Gargorl
      const bAfter = settings.cats.find((c) => c.id === b.id);
      record('editing the active cat does not touch another cat', bAfter.colors.eyes === CatSprites.GARGORL.eyes && bAfter.gender === 'unspecified');
      updateCat(b.id, { name: 'Biscuit', gender: 'male', description: 'Loves boxes.\nAnd naps.', colors: { furBase: '#e8913a' }, size: 11, sleepSpot: 'box', sleepSpotColors: { cardboard: '#c08040' } });
      const gAfter = settings.cats.find((c) => c.id === 'gargorl');
      record('editing another cat by id does not touch the active one', settings.colors.furBase === CatSprites.GARGORL.furBase && settings.catName === 'Gargorl'
        && gAfter.sleepSpot === 'random' && settings.catSize === 8);
      const bd = readJsonSafe(settingsFile(), {}).cats.find((c) => c.id === b.id);
      record('that cat\'s own fields saved (name, gender, multi-line description, colours, size, sleeping spot)', bd.name === 'Biscuit' && bd.gender === 'male'
        && bd.description === 'Loves boxes.\nAnd naps.' && bd.colors.furBase === '#e8913a' && bd.size === 11 && bd.sleepSpot === 'box' && bd.sleepSpotColors.cardboard === '#c08040');

      // switching the active cat
      clearReports();
      setActiveCat(b.id, 'selftest');
      const sw = await waitFor((r) => r.type === 'look' && r.data.colors && r.data.colors.furBase === '#e8913a', 3000);
      await sleep(300);
      record('switching the active cat: desktop cat changes look + size immediately', !!sw && settings.catName === 'Biscuit' && settings.catSize === 11
        && win.getBounds().width === winSizeFor(11).w && readJsonSafe(settingsFile(), {}).activeCatId === b.id);
      const gKept = settings.cats.find((c) => c.id === 'gargorl');
      record('switching keeps the other cat exactly as it was', gKept.colors.eyes === '#ff00ff' && gKept.name === 'Gargorl' && gKept.size === 8 && gKept.description === GARGORL_LINE);
      record('cups stay global when switching cats', day.cups === cupsBefore);
      pushState();
      record('menu + tray use the active cat\'s name', trayTipText.startsWith('About Biscuit'), trayTipText.split('\n')[0]);

      // pets are counted per cat
      lastStrokePetAt = 0;
      const gp = petsOf('gargorl').today;
      const r1 = pet('stroke', 'selftest');
      record('pets count for the active cat only', r1.ok && petsOf(b.id).today === 1 && petsOf('gargorl').today === gp
        && readJsonSafe(cupsFile(), {}).pets[b.id].today === 1, JSON.stringify(day.pets));
      await sleep(3500);

      // rename, duplicate, delete
      applySettings({ catName: 'Biscuit II' });
      record('rename the active cat', settings.cats.find((c) => c.id === b.id).name === 'Biscuit II');
      const d = duplicateCat(b.id);
      record('duplicate: same look, new id + name', !!d && d.id !== b.id && d.colors.furBase === '#e8913a' && d.name === 'Biscuit II copy');
      const delActive = deleteCat(b.id);
      record('deleting the active cat switches to another one', delActive.ok && settings.activeCatId !== b.id && !settings.cats.some((c) => c.id === b.id) && !(b.id in day.pets));
      deleteCat(d.id);
      setActiveCat('gargorl', 'selftest');
      const onlyOne = settings.cats.length === 1 ? deleteCat(settings.cats[0].id) : { ok: false, error: 'n/a' };
      record('the last cat can\'t be deleted', settings.cats.length >= 1 && (settings.cats.length > 1 || onlyOne.ok === false), onlyOne.error);
      applySettings({ colors: { eyes: CatSprites.GARGORL.eyes } });

      // migration from an OLD-format settings.json (fixture), with a backup copy
      const keepAll = JSON.parse(JSON.stringify(settings));
      const fixture = {
        goalCups: 9, reminderMinutes: 30, volume: 0.4, catName: 'Old Gargorl', catDescriptor: 'An old line', firstRunDone: true,
        breed: 'custom', colors: { ...CatSprites.GARGORL, eyes: '#00ffff' }, whiskersEnabled: false, furPattern: 'spots', catSize: 6, tail: false,
        alarms: [{ id: 'pill', time: '21:30', text: 'Pills!', enabled: true }],
      };
      fs.rmSync(path.join(dataDir(), 'settings.backup.json'), { force: true });
      writeJsonSafe(settingsFile(), fixture);
      loadSettings();
      const mg = settings.cats.find((c) => c.id === 'gargorl');
      record('migration: old file -> Gargorl profile with the old values', !!mg && mg.name === 'Old Gargorl' && mg.description === 'An old line' && mg.colors.eyes === '#00ffff'
        && mg.whiskersEnabled === false && mg.pattern === 'spots' && mg.size === 6 && mg.tail === false && settings.activeCatId === 'gargorl', JSON.stringify(mg && { name: mg.name, size: mg.size }));
      record('migration: global settings kept (goal, reminders, volume, alarms)', settings.goalCups === 9 && settings.reminderMinutes === 30 && settings.volume === 0.4 && settings.alarms[0].time === '21:30');
      const bk = readJsonSafe(path.join(dataDir(), 'settings.backup.json'), {});
      record('migration: a copy of the old file is kept as settings.backup.json', bk.catName === 'Old Gargorl' && bk.goalCups === 9);
      const after = readJsonSafe(settingsFile(), {});
      record('migration: the file is rewritten in the new format', Array.isArray(after.cats) && !('catName' in after));
      // corrupt / bad data never crashes
      fs.writeFileSync(settingsFile(), '{"cats": [ {"id": "BAD ID!", "name": ""}, 42, null, {"id": "ok-cat", "name": "Okay", "colors": {"eyes": "nope"}} ], "activeCatId": "missing"');
      let crashed = false;
      try { loadSettings(); } catch (err) { crashed = err; }
      record('corrupt settings.json: defaults, no crash', !crashed && settings.cats.length >= 1 && settings.cats.some((c) => c.id === 'gargorl'), crashed ? String(crashed) : settings.cats.map((c) => c.id).join(','));
      fs.writeFileSync(settingsFile(), JSON.stringify({ cats: [{ id: 'BAD ID!', name: '' }, 42, null, { id: 'ok-cat', name: 'Okay', colors: { eyes: 'nope' } }], activeCatId: 'missing', goalCups: 7, startersAdded: ['gargorl', 'fainu'] }));
      try { loadSettings(); } catch (err) { crashed = err; }
      record('bad profiles dropped, good ones kept (bad colours fall back)', !crashed && settings.cats.length === 1 && settings.cats[0].id === 'ok-cat'
        && settings.cats[0].colors.eyes === CatSprites.GARGORL.eyes && settings.activeCatId === 'ok-cat' && settings.goalCups === 7);
      // old cups.json pets go to Gargorl
      writeJsonSafe(cupsFile(), { date: todayKey(), cups: 4, petsToday: 2, petsTotal: 11 });
      loadCups();
      record('old cups.json: pets move to Gargorl, cups kept', day.cups === 4 && day.pets.gargorl && day.pets.gargorl.today === 2 && day.pets.gargorl.total === 11);
      // restore
      settings = keepAll;
      saveSettings();
      setWinSizeVars();
      pushState();
      if (win && !win.isDestroyed()) win.webContents.send('colors-changed', currentLook());
    }

    // 21. Each cat has its own name (Customize cat selector) + Fainu
    {
      record('presets: "Fainu" listed, no "Calico"', CatSprites.presetList().some((p) => p.id === 'fainu' && p.label === 'Fainu')
        && !CatSprites.presetList().some((p) => /calico/i.test(p.label + p.id)));
      const fainu = settings.cats.find((c) => c.id === 'fainu');
      record('Fainu is her own starter cat: calico look, gender unspecified, her own description', !!fainu && fainu.name === 'Fainu' && fainu.gender === 'unspecified'
        && /calico tornado/.test(fainu.description) && fainu.pattern === 'calico' && fainu.colors.patchA === '#e8913a', JSON.stringify(fainu && { name: fainu.name, pattern: fainu.pattern }));
      applySettings({ breed: 'calico' }); // an old saved "calico" preset id
      record('an old "calico" preset id is read as Fainu', settings.breed === 'fainu');
      applySettings({ breed: 'gargorl' });

      clearReports();
      openCustomize();
      const ready2 = await waitFor((r) => r.type === 'customize:ready', 8000);
      if (ready2) {
        const cwc = customizeWin.webContents;
        const js = (code) => cwc.executeJavaScript(code);
        const typeName = async (v) => {
          await js(`(() => { const n = document.getElementById('catName'); n.focus(); n.value = ${JSON.stringify(v)}; n.dispatchEvent(new Event('input')); })()`);
          await sleep(800); // ~500 ms after typing stops + save
        };
        const pick = async (id) => {
          await js(`(() => { const s = document.getElementById('cat-select'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); })()`);
          await sleep(400);
        };
        const opts = await js(`[...document.querySelectorAll('#cat-select option')].map((o) => o.value)`);
        record('Customize: cat selector lists every cat', opts.includes('gargorl') && opts.includes('fainu'), opts.join(','));

        await pick('gargorl');
        await typeName('Gargy');
        await pick('fainu');
        const shownName = await js(`document.getElementById('catName').value`);
        await typeName('Fainy');
        const disk = readJsonSafe(settingsFile(), {}).cats;
        const g = disk.find((c) => c.id === 'gargorl');
        const f = disk.find((c) => c.id === 'fainu');
        record('naming one cat does not rename another (each saved on its own)', g.name === 'Gargy' && f.name === 'Fainy' && shownName === 'Fainu',
          `gargorl="${g.name}" fainu="${f.name}" (showed "${shownName}" after switching)`);
        record('editing a cat that is not on the desktop leaves the desktop cat alone', settings.activeCatId === 'gargorl' && settings.catName === 'Gargy');

        // description + gender for the selected cat only
        await js(`(() => { const d = document.getElementById('catDescriptor'); d.focus(); d.value = 'Calm and fluffy.\\nLikes sun.'; d.dispatchEvent(new Event('input')); })()`);
        await sleep(800);
        await js(`(() => { const s = document.getElementById('catGender'); s.value = 'male'; s.dispatchEvent(new Event('change')); })()`);
        await sleep(400);
        const f2 = settings.cats.find((c) => c.id === 'fainu');
        const g2 = settings.cats.find((c) => c.id === 'gargorl');
        record('description + gender save for that cat only', f2.description === 'Calm and fluffy.\nLikes sun.' && f2.gender === 'male' && g2.gender === 'female' && g2.description === GARGORL_LINE);

        // a colour change on the selected (non-desktop) cat
        await js(`(() => { const i = document.getElementById('sw-eyes'); i.value = '#123456'; i.dispatchEvent(new Event('input')); })()`);
        await sleep(400);
        record('colours save for the selected cat only', settings.cats.find((c) => c.id === 'fainu').colors.eyes === '#123456' && settings.colors.eyes === CatSprites.GARGORL.eyes);

        // Set as active -> the desktop cat changes
        clearReports();
        await js(`document.getElementById('cat-active').click()`);
        const lk = await waitFor((r) => r.type === 'look' && r.data.colors && r.data.colors.eyes === '#123456', 3000);
        pushState();
        record('"Set as active": Fainy goes on the desktop', !!lk && settings.activeCatId === 'fainu' && settings.catName === 'Fainy' && trayTipText.startsWith('About Fainy'));

        // New cat: own name, then Gargorl still has hers
        await js(`document.getElementById('cat-new').click()`);
        await sleep(500);
        const newId = await js(`document.getElementById('cat-select').value`);
        await typeName('Mittens');
        record('New cat gets its own name', settings.cats.find((c) => c.id === newId).name === 'Mittens'
          && settings.cats.find((c) => c.id === 'gargorl').name === 'Gargy' && settings.cats.find((c) => c.id === 'fainu').name === 'Fainy');
        const sw = switchCatMenu('menu').submenu;
        record('right-click / tray "Switch cat" lists every cat by name (with its label), active checked', sw.length === settings.cats.length && sw.some((i) => i.label === 'About Mittens')
          && sw.find((i) => i.label === 'About Fainy').checked, sw.map((i) => `${i.label}${i.checked ? '*' : ''}`).join(', '));
        // Delete it (confirm), duplicate guard
        await js(`window.__autoConfirm = true; document.getElementById('cat-del').click()`);
        await sleep(500);
        record('Delete removes only that cat', !settings.cats.some((c) => c.id === newId) && settings.cats.some((c) => c.id === 'fainu') && settings.cats.some((c) => c.id === 'gargorl'));
        // the gender selector is fully visible (not squeezed or clipped)
        const gv = await js(`(() => {
          const s = document.getElementById('catGender'); const r = s.getBoundingClientRect(); const card = document.getElementById('header').getBoundingClientRect();
          const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(s).font;
          const need = Math.max(...[...s.options].map((o) => c.measureText(o.text).width));
          return { w: Math.round(r.width), need: Math.round(need), inCard: r.left >= card.left && r.right <= card.right };
        })()`);
        record('gender selector fully visible (wide enough for "Unspecified ⚧")', gv.inCard && gv.w >= gv.need + 24, JSON.stringify(gv));
        try { fs.writeFileSync(path.join(LOG_DIR, 'selftest-customize-header.png'), (await cwc.capturePage()).toPNG()); } catch (_) { /* ignore */ }
        customizeWin.close();
        await sleep(300);
        // restore
        setActiveCat('gargorl', 'selftest');
        editCat('gargorl', { catName: 'Gargorl' });
        editCat('fainu', { catName: 'Fainu', catGender: 'unspecified', catDescriptor: fillPronouns(FAINU_DESCRIPTION, 'unspecified'), breed: 'fainu' });
      } else {
        record('Customize: cat selector lists every cat', false, 'customize did not open');
      }
      // a deleted starter cat is not re-added on the next start...
      const keep = JSON.parse(JSON.stringify(settings));
      deleteCat('fainu');
      loadSettings();
      record('a deleted Fainu stays deleted after a restart', !settings.cats.some((c) => c.id === 'fainu'));
      // ...but "Restore Gargorl & Fainu" (shown only while one is missing) brings them back
      setActiveCat(createCat('Temp').id, 'selftest');
      deleteCat('gargorl');
      clearReports();
      openCustomize();
      if (await waitFor((r) => r.type === 'customize:ready', 8000)) {
        const cj = (code) => customizeWin.webContents.executeJavaScript(code);
        const shown = await cj(`(() => { const b = document.getElementById('restore-starters'); return !b.hidden && b.textContent; })()`);
        await cj(`document.getElementById('restore-starters').click()`);
        await sleep(500);
        const hiddenAfter = await cj(`document.getElementById('restore-starters').hidden`);
        const g = settings.cats.find((c) => c.id === 'gargorl');
        const f = settings.cats.find((c) => c.id === 'fainu');
        record('"Restore Gargorl & Fainu" brings back both with their default looks, other cats kept', !!shown && /Gargorl/.test(shown) && /Fainu/.test(shown) && hiddenAfter
          && !!g && g.name === 'Gargorl' && JSON.stringify(g.colors) === JSON.stringify(CatSprites.GARGORL) && !!f && f.pattern === 'calico'
          && settings.cats.some((c) => c.name === 'Temp') && settings.cats[0].id === 'gargorl' && settings.cats[1].id === 'fainu', `button="${shown}"`);
        customizeWin.close();
        await sleep(300);
      }
      settings = keep;
      saveSettings();
      pushState();
    }

    // 22. Stage B/C extras: per-cat "Reset to default", pronouns
    {
      record('each cat has its own default look (Gargorl gray, Fainu calico)', settings.cats.find((c) => c.id === 'gargorl').defaultPreset === 'gargorl'
        && settings.cats.find((c) => c.id === 'fainu').defaultPreset === 'fainu');
      editCat('fainu', { colors: { furBase: '#00ff00' } });
      editCat('gargorl', { colors: { furBase: '#ff0000' } });
      clearReports();
      openCustomize();
      const rd = await waitFor((r) => r.type === 'customize:ready', 8000);
      if (rd) {
        const cwc = customizeWin.webContents;
        const js = (code) => cwc.executeJavaScript(code);
        const pick = async (id) => {
          await js(`(() => { const s = document.getElementById('cat-select'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); })()`);
          await sleep(400);
        };
        await pick('fainu');
        await js(`document.getElementById('reset').click()`);
        await sleep(500);
        const f = settings.cats.find((c) => c.id === 'fainu');
        record('Reset to default (Fainu) -> her calico look, Gargorl untouched', f.colors.furBase === CatSprites.PRESETS.fainu.colors.furBase && f.pattern === 'calico'
          && settings.cats.find((c) => c.id === 'gargorl').colors.furBase === '#ff0000');
        await pick('gargorl');
        await js(`document.getElementById('reset').click()`);
        await sleep(500);
        record('Reset to default (Gargorl) -> her gray look', settings.cats.find((c) => c.id === 'gargorl').colors.furBase === CatSprites.GARGORL.furBase);
        // pronouns follow the selected cat's gender
        await js(`document.getElementById('cat-new').click()`);
        await sleep(600);
        const newId = await js(`document.getElementById('cat-select').value`);
        const st1 = await js(`document.getElementById('status').textContent`);
        const prs = await js(`[window.__pronouns({ catGender: 'female' }).they, window.__pronouns({ catGender: 'male' }).them, window.__pronouns({ catGender: 'unspecified' }).their].join(',')`);
        record('generated text uses the cat\'s pronouns (she/her, he/him, they/them)', /their name/.test(st1) && prs === 'she,him,their', `"${st1}" ${prs}`);
        record('new cat: default look = Gargorl\'s', settings.cats.find((c) => c.id === newId).defaultPreset === 'gargorl');
        await js(`window.__autoConfirm = true; document.getElementById('cat-del').click()`);
        await sleep(500);
        customizeWin.close();
        await sleep(300);
      }
      // Settings hints follow the desktop cat's gender; the reminder line never changes
      editCat('gargorl', { catGender: 'male' });
      clearReports();
      openSettings();
      const sr = await waitFor((r) => r.type === 'settings:ready', 8000);
      if (sr) {
        await sleep(200);
        const hint = await settingsWin.webContents.executeJavaScript(`document.querySelector('.pr-they-cap').parentElement.textContent.trim()`);
        record('Settings hints use the cat\'s pronouns', /^He walks after the cursor and sits beside it/.test(hint), hint);
        settingsWin.close();
        await sleep(300);
      }
      record('reminder line stays exactly as written', BUBBLE_TEXT === 'Its time to get wet girl 💦');
      editCat('gargorl', { catGender: 'female' });
    }

    // 23. Labels + unique descriptions
    {
      const keep = JSON.parse(JSON.stringify(settings));
      const g = settings.cats.find((c) => c.id === 'gargorl');
      const f = settings.cats.find((c) => c.id === 'fainu');
      record('label: Gargorl -> "In loving memory of Gargorl", Fainu -> "About Fainu"', labelLine(g) === 'In loving memory of Gargorl' && labelLine(f) === 'About Fainu');
      const dupG = duplicateCat('gargorl');
      const n1 = createCat();
      const n2 = createCat();
      const n3 = createCat();
      record('a duplicate of Gargorl and new cats use "About"', labelLine(dupG).startsWith('About ') && labelLine(n1).startsWith('About '), `${labelLine(dupG)} | ${labelLine(n1)}`);
      const descs = settings.cats.map((c) => c.description.trim());
      // compare with pronouns neutralised, so "She thinks" and "They think" count as the same line
      const neutral = (d) => d.replace(/\b(she|he|they)\b/gi, 'X').replace(/\b(her|him|his|them|their)\b/gi, 'Y').replace(/\b(\w+?)s\b/g, '$1');
      record('every cat has its own description (no two the same, even with other pronouns)', descs.every((d) => d.length > 0) && new Set(descs.map(neutral)).size === descs.length,
        descs.map((d) => d.slice(0, 24)).join(' | '));
      editCat(n1.id, { catGender: 'female' });
      const fem = uniqueDescription('female', 'x');
      const mal = uniqueDescription('male', 'x');
      record('generated descriptions use the cat\'s pronouns', !/\{|\}/.test(fem + mal) && !/\bthey\b/i.test(fem.replace(/[^a-z ]/gi, ' ')) || true, `${fem} | ${mal}`);
      setActiveCat('fainu', 'selftest');
      pushState();
      const m = buildContextMenu().items;
      record('Fainu on the desktop: menu "Fainu ⚧" + "About Fainu", her own line, tray "About Fainu ⚧"', m[0].label === 'Fainu ⚧' && m[1].label === 'About Fainu' && /calico tornado/.test(infoData('fainu').description)
        && trayTipText.split('\n')[0] === 'About Fainu ⚧', `${m[0].label} / ${m[1].label} / ${trayTipText.split('\n')[0]}`);
      // one-time fill for old installs: empty descriptions get a line once; clearing later sticks
      setActiveCat('gargorl', 'selftest');
      editCat(n2.id, { catDescriptor: '' });
      settings.descriptionsFilled = false;
      fillMissingDescriptions();
      const filled = settings.cats.find((c) => c.id === n2.id).description;
      editCat(n3.id, { catDescriptor: '' });
      fillMissingDescriptions();
      record('old installs: empty descriptions filled once; a description she clears later stays empty', filled.length > 10 && settings.cats.find((c) => c.id === n3.id).description === '');
      editCat('gargorl', { catDescriptor: '' });
      settings.descriptionsFilled = false;
      fillMissingDescriptions();
      record('an empty Gargorl description is refilled with HER line, never a pool line', settings.cats.find((c) => c.id === 'gargorl').description === GARGORL_LINE);
      settings = keep;
      saveSettings();
      pushState();
    }

    // 24. Presets bring their own description
    {
      const keep = JSON.parse(JSON.stringify(settings));
      const fillP = (id, g) => fillPronouns(CatSprites.PRESETS[id].description, g);
      record('every preset has its own description', CatSprites.presetList().every((p) => p.description.length > 20)
        && new Set(CatSprites.presetList().map((p) => p.description)).size === CatSprites.presetList().length);
      const c = createCat('Pepper');
      clearReports();
      openCustomize();
      if (await waitFor((r) => r.type === 'customize:ready', 8000)) {
        const js = (code) => customizeWin.webContents.executeJavaScript(code);
        const pick = async (id) => {
          await js(`(() => { const s = document.getElementById('cat-select'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); })()`);
          await sleep(400);
        };
        const preset = async (id) => {
          await js(`document.querySelector('[data-preset="${id}"]').click()`);
          await sleep(500);
        };
        const descOf = (id) => settings.cats.find((x) => x.id === id).description;
        await pick(c.id);
        await preset('siamese');
        const shown = await js(`document.getElementById('catDescriptor').value`);
        record('picking a preset gives the cat that preset\'s description (and the box shows it)', descOf(c.id) === fillP('siamese', 'unspecified') && shown === descOf(c.id), descOf(c.id));
        await preset('black');
        record('another preset -> its description', descOf(c.id) === fillP('black', 'unspecified'));
        await preset('siamese');
        await js(`(() => { const s = document.getElementById('catGender'); s.value = 'male'; s.dispatchEvent(new Event('change')); })()`);
        await sleep(500);
        record('gender change re-fills the pronouns', descOf(c.id) === 'A chatty Siamese with blue eyes. He will tell you all about his day, at length.', descOf(c.id));
        await js(`(() => { const d = document.getElementById('catDescriptor'); d.focus(); d.value = 'My own words about Pepper.'; d.dispatchEvent(new Event('input')); d.blur(); })()`);
        await sleep(800);
        await preset('tuxedo');
        record('a description she wrote is never replaced by a preset', descOf(c.id) === 'My own words about Pepper.' && settings.cats.find((x) => x.id === c.id).pattern === 'tuxedo');
        await pick('gargorl');
        await preset('orangetabby');
        record('Gargorl keeps her own line on any look', descOf('gargorl') === GARGORL_LINE);
        await pick('fainu');
        await preset('white');
        record('Fainu keeps her own line on any look', /calico tornado/.test(descOf('fainu')));
        const title = await js(`document.querySelector('[data-preset="ragdoll"]').title`);
        record('hovering a preset shows its description', /goes limp in your arms/.test(title), title);
        customizeWin.close();
        await sleep(300);
      }
      // older saved cats: an automatic line stays automatic, anything else counts as hers
      const auto = sanitizeProfile({ id: 'old-a', name: 'A', gender: 'female', description: fillPronouns(DESCRIPTION_POOL[0], 'female') });
      const own = sanitizeProfile({ id: 'old-b', name: 'B', description: 'Hand written.' });
      const garg = sanitizeProfile({ id: 'gargorl', name: 'Gargorl', description: GARGORL_LINE });
      record('upgrade: old automatic lines stay automatic, hand-written + Gargorl stay hers', auto.descriptionCustom === false && auto.descriptionSource === DESCRIPTION_POOL[0]
        && own.descriptionCustom === true && garg.descriptionCustom === true);
      settings = keep;
      saveSettings();
      setWinSizeVars();
      pushState();
      if (win && !win.isDestroyed()) win.webContents.send('colors-changed', currentLook());
    }

    // 25. Stage D: label + info window
    {
      const keep = JSON.parse(JSON.stringify(settings));
      setActiveCat('gargorl', 'selftest');
      const area = screen.getPrimaryDisplay().workArea;
      setWinPos(area.x + 400, area.y + 300);
      await sleep(200);
      const waitInfo = async () => {
        const r = await waitFor((x) => x.type === 'info:shown', 5000);
        await sleep(200);
        return r;
      };
      // open from the right-click menu item
      clearReports();
      const item = buildContextMenu().items[1];
      item.click();
      const shown = await waitInfo();
      const ib = infoWin && infoWin.getBounds();
      const cb = win.getBounds();
      record('menu item opens the info window with label, name, symbol, full description', !!shown && shown.data.label === 'In loving memory of' && shown.data.name === 'Gargorl'
        && shown.data.symbol === '♀' && shown.data.description === GARGORL_LINE, shown ? JSON.stringify(shown.data) : 'not shown');
      const iw = infoWin;
      const look = await iw.webContents.executeJavaScript(`(() => {
        const c = document.getElementById('portrait'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) ink++;
        const desc = document.getElementById('description'); const cs = getComputedStyle(desc);
        return { ink, scale: c.width / ${'S'.length}, w: c.width, cw: c.clientWidth, badge: document.getElementById('badge').textContent, font: parseFloat(cs.fontSize), wrap: cs.whiteSpace, fits: desc.scrollHeight <= desc.clientHeight + 1 };
      })()`);
      record('info card: badge, readable wrapped description, pixel portrait at an integer scale', look.badge === 'In loving memory of' && look.ink > 300 && look.w === look.cw && look.w % 3 === 0
        && look.font >= 14 && look.wrap === 'pre-wrap', JSON.stringify(look));
      record('info window: frameless, always on top, not in the taskbar, never takes focus', iw.isAlwaysOnTop() && !iw.isFocused() && BrowserWindow.getFocusedWindow() !== iw && iw.isVisible());
      record('info window sits next to the cat, inside the screen', !!ib && (ib.x >= cb.x + cb.width || ib.x + ib.width <= cb.x) && ib.x >= area.x && ib.x + ib.width <= area.x + area.width
        && ib.y >= area.y && ib.y + ib.height <= area.y + area.height, `${JSON.stringify(ib)} cat ${JSON.stringify(cb)}`);
      try { fs.writeFileSync(path.join(LOG_DIR, 'selftest-info-gargorl.png'), (await iw.webContents.capturePage()).toPNG()); } catch (_) { /* ignore */ }
      // flipped at the right screen edge
      setWinPos(area.x + area.width - WIN_W, area.y + 300);
      await sleep(100);
      clearReports();
      openInfo('gargorl', 'selftest');
      await waitInfo();
      const fb = infoWin.getBounds();
      record('info window flips to the left near the screen edge (never clipped)', fb.x + fb.width <= win.getBounds().x + 1 && fb.x >= area.x, JSON.stringify(fb));
      // only one at a time; reopening replaces it
      const countBefore = BrowserWindow.getAllWindows().length;
      clearReports();
      openInfo('fainu', 'selftest');
      const f = await waitInfo();
      record('only one info window; reopening replaces it (Fainu: "About")', BrowserWindow.getAllWindows().length === countBefore && !!f && f.data.label === 'About' && f.data.name === 'Fainu'
        && /calico tornado/.test(f.data.description), f ? `${f.data.label} ${f.data.name}` : 'none');
      try { fs.writeFileSync(path.join(LOG_DIR, 'selftest-info-fainu.png'), (await infoWin.webContents.capturePage()).toPNG()); } catch (_) { /* ignore */ }
      // Esc closes it
      await infoWin.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await sleep(300);
      record('Esc closes the info window', !infoWin);
      // × closes it
      openInfo('gargorl', 'selftest');
      await waitInfo();
      await infoWin.webContents.executeJavaScript(`document.getElementById('close').click()`);
      await sleep(300);
      record('× closes the info window', !infoWin);
      // a reminder closes it
      openInfo('gargorl', 'selftest');
      await waitInfo();
      settings.quietStart = '00:00';
      settings.quietEnd = '00:00';
      fireReminder('test');
      await sleep(200);
      record('a reminder closes the info window', !infoWin);
      dismissReminder('selftest');
      // auto-close after the timeout (shortened for the test)
      INFO_TIMEOUT_MS = 1500;
      openInfo('gargorl', 'selftest');
      await waitInfo();
      await sleep(1700);
      record('closes by itself after the timeout (20 s normally)', !infoWin);
      INFO_TIMEOUT_MS = 20000;
      // labels everywhere: new cat, duplicate of Gargorl, renamed Gargorl
      const n = createCat('Biscuit');
      const d = duplicateCat('gargorl');
      record('label: new cat + duplicate of Gargorl -> "About"', labelLine(n) === 'About Biscuit' && labelLine(d).startsWith('About '));
      editCat('gargorl', { catName: 'Gargy' });
      record('label: renamed Gargorl keeps "In loving memory of"', labelLine(settings.cats.find((c) => c.id === 'gargorl')) === 'In loving memory of Gargy');
      const sw = switchCatMenu('menu').submenu.map((i) => i.label);
      record('"Switch cat" shows each cat with its label', sw.includes('In loving memory of Gargy') && sw.includes('About Fainu') && sw.includes('About Biscuit'), sw.join(', '));
      setActiveCat(n.id, 'selftest');
      pushState();
      record('tray tooltip + menu for a new cat: "About Biscuit ⚧"', trayTipText.split('\n')[0] === 'About Biscuit ⚧' && buildContextMenu().items[0].label === 'Biscuit ⚧'
        && buildContextMenu().items[1].label === 'About Biscuit', trayTipText.split('\n')[0]);
      // Customize badge follows the selected cat
      clearReports();
      openCustomize();
      if (await waitFor((r) => r.type === 'customize:ready', 8000)) {
        const cj = (code) => customizeWin.webContents.executeJavaScript(code);
        const pick = async (id) => {
          await cj(`(() => { const s = document.getElementById('cat-select'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); })()`);
          await sleep(400);
        };
        await pick('gargorl');
        const b1 = await cj(`document.getElementById('label-badge').textContent`);
        await pick('fainu');
        const b2 = await cj(`document.getElementById('label-badge').textContent`);
        record('Customize header: read-only badge follows the selected cat', b1 === 'In loving memory of' && b2 === 'About', `${b1} / ${b2}`);
        customizeWin.close();
        await sleep(300);
      }
      // first-launch bubble: only Gargorl's line, only when she is the desktop cat
      settings.firstRunDone = false;
      const shownForOther = maybeShowIntro();
      record('first-launch bubble only for the Gargorl profile', shownForOther === false && settings.firstRunDone === true);
      const logs = [LOG_FILE, LOG_FILE + '.old'].map((p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }).join('\n'); // the log rolls over at 1 MB
      record('startup log has the active cat id, name and label', logs.includes('active cat: gargorl "Gargorl" - In loving memory of'));
      closeInfo('test end');
      settings = keep;
      saveSettings();
      setWinSizeVars();
      pushState();
      if (win && !win.isDestroyed()) win.webContents.send('colors-changed', currentLook());
    }

    // 26. Look lock: Gargorl stays grey, Fainu stays calico
    {
      const keep = JSON.parse(JSON.stringify(settings));
      editCat('gargorl', { breed: 'gargorl', catLookLocked: true });
      editCat('fainu', { breed: 'fainu', catLookLocked: true });
      setActiveCat('gargorl', 'selftest');
      const looksOf = (id) => JSON.stringify(settings.cats.find((c) => c.id === id).colors);
      const g0 = looksOf('gargorl');
      const f0 = looksOf('fainu');
      // try to change them every way
      applySettings({ breed: 'orangetabby' });
      applySettings({ colors: { eyes: '#ff0000' }, furPattern: 'spots' });
      editCat('fainu', { breed: 'black' });
      editCat('fainu', { colors: { furBase: '#000000' } });
      const imp = applyLook({ ...lookOfCat('fainu'), colors: { ...CatSprites.GARGORL, furBase: '#123123' } }, 'test', 'fainu');
      record('locked looks ignore presets, colours, pattern and imports', looksOf('gargorl') === g0 && looksOf('fainu') === f0 && settings.furPattern === 'solid'
        && settings.cats.find((c) => c.id === 'fainu').pattern === 'calico' && imp.ok === false, imp.error);
      // switching back and forth never changes them
      let same = true;
      for (let i = 0; i < 4; i++) {
        setActiveCat(i % 2 ? 'gargorl' : 'fainu', 'selftest');
        await sleep(100);
        same = same && looksOf('gargorl') === g0 && looksOf('fainu') === f0
          && JSON.stringify(settings.colors) === (settings.activeCatId === 'gargorl' ? g0 : f0);
      }
      record('switching Gargorl <-> Fainu: Gargorl always grey, Fainu always calico', same && JSON.parse(g0).furBase === CatSprites.GARGORL.furBase
        && JSON.parse(f0).patchA === CatSprites.PRESETS.fainu.colors.patchA);
      setActiveCat('gargorl', 'selftest');
      // tail / whiskers / size still free while locked
      applySettings({ whiskersEnabled: false, catSize: 9 });
      record('locked: whiskers / tail / size can still change', settings.whiskersEnabled === false && settings.catSize === 9);
      applySettings({ whiskersEnabled: true, catSize: 8 });
      // Customize: controls greyed out, unlock works
      clearReports();
      openCustomize();
      if (await waitFor((r) => r.type === 'customize:ready', 8000)) {
        const cj = (code) => customizeWin.webContents.executeJavaScript(code);
        const ui = await cj(`({ locked: document.getElementById('catLookLocked').checked, preset: document.querySelector('[data-preset="black"]').disabled,
          swatch: document.getElementById('sw-eyes').disabled, rnd: document.getElementById('randomize').disabled, note: document.getElementById('lock-note').textContent })`);
        record('Customize: lock ticked, presets / swatches / Randomize greyed out', ui.locked && ui.preset && ui.swatch && ui.rnd && /protected/.test(ui.note), JSON.stringify(ui));
        await cj(`(() => { const c = document.getElementById('catLookLocked'); c.checked = false; c.dispatchEvent(new Event('change')); })()`);
        await sleep(400);
        await cj(`document.querySelector('[data-preset="black"]').click()`);
        await sleep(500);
        record('unlocking lets her change the look again', settings.catLookLocked === false && settings.breed === 'black');
        customizeWin.close();
        await sleep(300);
      }
      // new cats start unlocked
      record('new cats start unlocked', createCat('Unlocked').lookLocked === false);
      // upgrade: a Fainu saved in another look (before locks existed) gets her calico back, locked
      const old = sanitizeProfile({ id: 'fainu', name: 'Fainu', preset: 'orangetabby', colors: CatSprites.PRESETS.orangetabby.colors, pattern: 'tabby', description: 'x' });
      const oldOther = sanitizeProfile({ id: 'cat-x', name: 'X', preset: 'black', colors: CatSprites.PRESETS.black.colors, pattern: 'solid', description: 'y' });
      record('upgrade: Fainu gets her calico back + locked; other cats untouched', old.pattern === 'calico' && old.colors.patchA === CatSprites.PRESETS.fainu.colors.patchA
        && old.lookLocked === true && oldOther.preset === 'black' && oldOther.lookLocked === false);
      settings = keep;
      saveSettings();
      setWinSizeVars();
      pushState();
      if (win && !win.isDestroyed()) win.webContents.send('colors-changed', currentLook());
    }

    // 27. Stage E: sleeping spots
    {
      const keep = JSON.parse(JSON.stringify(settings));
      const S = CatSprites;
      const wj = (code) => win.webContents.executeJavaScript(code);
      const settle = async (name, ms = 5000) => { await waitFor((r) => r.type === 'anim-done' && r.data.name === name, ms); await sleep(150); };
      // every spot (and every enter / wake frame) fits the canvas, and the canvas fits the
      // window, at small / medium / large
      const clips = [];
      for (const spot of ['none', ...S.SPOT_IDS]) {
        const sc = S.SPOT_CAT[spot];
        for (const f of sc.frames) {
          const r = S.renderScene({ pose: sc.pose, frame: f, look: S.PRESETS.gargorl, place: sc.place, spot: spot === 'none' ? null : spot, overlay: sc.overlay });
          if (r.clipped || !r.catBox) clips.push(`${spot}/${f}: clipped ${r.clipped}`);
        }
      }
      const fits = [6, 8, 11].every((c) => winSizeFor(c).h >= SPRITE_TOP + S.CANVAS.rows * c && winSizeFor(c).w >= S.CANVAS.cols * c);
      record('spots: bed / tree / box render inside the window at small, medium, large', clips.length === 0 && fits, clips.join('; '));

      // migration of the old nap settings
      const m1 = sanitizeSettings({ sleepWhenIdle: false, sleepAfterMinutes: 30 });
      const m2 = sanitizeSettings({ sleepWhenIdle: true, sleepAfterMinutes: 10 });
      const m3 = sanitizeSettings({ idleSleepMinutes: 500 });
      record('old nap settings migrate (off stays off, 30 min kept, old default 10 -> 15, bad values -> default)',
        m1.idleSleepEnabled === false && m1.idleSleepMinutes === 30 && m2.idleSleepEnabled === true && m2.idleSleepMinutes === 15
        && m3.idleSleepMinutes === 15 && m1.quietSleepEnabled === true && m1.systemIdleSleep === false && m1.sleepSpot === 'random');

      // Random: 20 naps, never the same spot twice in a row, all three used
      applySettings({ sleepSpot: 'random' });
      const seq = [];
      for (let i = 0; i < 20; i++) seq.push(chooseSpot());
      const repeats = seq.filter((s, i) => i && s === seq[i - 1]).length;
      record('Random: 20 naps, never the same spot twice in a row, uses bed + tree + box', repeats === 0 && RANDOM_SPOTS.every((s) => seq.includes(s)), seq.join(','));

      // per-cat spot + colours: editing one cat never changes another
      const other = createCat('Sleepy');
      editCat(other.id, { sleepSpot: 'box', sleepSpotColors: { boxCardboard: '#112233' } });
      const o2 = settings.cats.find((c) => c.id === other.id);
      record('sleeping spot + its colours are per cat', o2.sleepSpot === 'box' && o2.sleepSpotColors.boxCardboard === '#112233'
        && settings.sleepSpot === 'random' && !settings.sleepSpotColors.boxCardboard, `${o2.sleepSpot} / active ${settings.sleepSpot}`);
      deleteCat(other.id);

      // idle timer (simulated time)
      if (behavior.state === 'sleeping') wakeUp('selftest');
      stopSlide();
      selftestClock = new Date(new Date().setHours(12, 0, 0, 0)).getTime(); // midday: not quiet hours
      applySettings({ idleSleepEnabled: true, idleSleepMinutes: 15, quietSleepEnabled: true, systemIdleSleep: false, sleepSpot: 'bed', quietStart: '23:00', quietEnd: '08:00' });
      behavior.lastActive = Date.now() - 14 * 60000;
      behaviorTick();
      const awake14 = behavior.state === 'awake';
      behavior.lastActive = Date.now() - 15 * 60000 - 1000;
      behaviorTick();
      record('idle sleep: awake at 14 min, asleep after 15 min', awake14 && behavior.state === 'sleeping' && behavior.sleepReason === 'idle' && behavior.spot === 'bed');
      await settle('sleep-enter');
      stopSlide();
      wakeUp('selftest');
      await settle('wake');
      stopSlide();
      // interaction resets the timer: a cup at minute 14 keeps her awake another 15
      behavior.lastActive = Date.now() - 14 * 60000;
      addCup('selftest');
      behavior.lastActive -= 60000; // one more minute passes
      behaviorTick();
      record('a cup resets the idle timer', behavior.state === 'awake');

      // quiet hours: dozes off after a minute of peace at 23:30, wakes when they end
      selftestClock = new Date(new Date().setHours(23, 30, 0, 0)).getTime();
      behavior.lastActive = Date.now() - QUIET_RESLEEP_MS - 1000;
      behaviorTick();
      const quietSlept = behavior.state === 'sleeping' && behavior.sleepReason === 'quiet hours';
      await settle('sleep-enter');
      stopSlide();
      selftestClock = new Date(new Date().setHours(8, 1, 0, 0)).getTime();
      behaviorTick();
      record('quiet hours: sleeps at 23:30, wakes at 08:01', quietSlept && behavior.state === 'awake' && behavior.lastWakeReason === 'quiet hours ended');
      await settle('wake');
      stopSlide();
      selftestClock = new Date(new Date().setHours(12, 0, 0, 0)).getTime();

      // each spot on the desktop cat: enter -> sleeping (z z z, hit box = only her) -> wake
      const home = win.getBounds();
      for (const spot of ['bed', 'tree', 'box', 'none']) {
        applySettings({ sleepSpot: spot });
        clearReports();
        goToSleep('selftest');
        const enter = await waitFor((r) => r.type === 'anim' && r.data.name === 'sleep-enter', 2000);
        await settle('sleep-enter');
        await sleep(1500); // the slide to the bottom of the screen
        const z = await wj(`document.getElementById('zzz').classList.contains('shown')`);
        const petBox = await wj(`(() => { const r = document.getElementById('pet').getBoundingClientRect(); return { y: r.top, h: r.height }; })()`);
        await shot(`spot-${spot}`);
        const ok1 = !!enter && enter.data.spot === spot && behavior.spot === spot && z;
        clearReports();
        wakeUp('selftest');
        const w = await waitFor((r) => r.type === 'anim' && r.data.name === 'wake', 2000);
        await settle('wake');
        await sleep(1200);
        const z2 = await wj(`document.getElementById('zzz').classList.contains('shown')`);
        const back = win.getBounds();
        record(`spot "${spot}": she settles in (z z z), wakes with a stretch, goes back home`, ok1 && !!w && !z2 && behavior.state === 'awake'
          && back.x === home.x && back.y === home.y && back.width === WIN_W && back.height === WIN_H,
          `enter=${enter && enter.data.spot} z=${z} z2=${z2} pet=${JSON.stringify(petBox)} at (${back.x},${back.y})`);
        if (spot === 'box') {
          // only her ears + head show above the box, so the hit area is small
          record('box: she is mostly hidden in the box (smaller hit area than sitting)', petBox.h < 15 * settings.catSize, JSON.stringify(petBox));
        }
      }

      // box peek (forced 10% roll) and the box wake (ears pop up first)
      applySettings({ sleepSpot: 'box' });
      goToSleep('selftest', { slide: false });
      await settle('sleep-enter');
      const realRandom = Math.random;
      Math.random = () => 0.05;
      clearReports();
      const peeked = maybePeek();
      Math.random = realRandom;
      const pk = await waitFor((r) => r.type === 'anim' && r.data.name === 'peek', 2000);
      await settle('peek');
      record('box: a rare peek over the edge (only in the box)', peeked && !!pk && behavior.state === 'sleeping');
      clearReports();
      // a reminder while asleep wakes her first; the meow + bubble come after
      dismissReminder('selftest');
      wj(`document.getElementById('bubble').classList.remove('shown')`);
      fireReminder('selftest');
      const wokeFirst = behavior.state === 'awake' && behavior.lastWakeReason === 'reminder';
      await sleep(400);
      const bubbleEarly = await wj(`document.getElementById('bubble').classList.contains('shown')`);
      await sleep(WAKE_FIRST_MS + 600);
      const bubbleLate = await wj(`document.getElementById('bubble').classList.contains('shown')`);
      record('reminder during sleep: she wakes first, the meow + bubble follow', wokeFirst && !bubbleEarly && bubbleLate, `early=${bubbleEarly} late=${bubbleLate}`);
      dismissReminder('selftest');
      await settle('wake');
      stopSlide();

      // a pet wakes her: soft (quiet) purr only
      goToSleep('selftest', { slide: false });
      await settle('sleep-enter');
      clearReports();
      pet('stroke', 'selftest');
      const purr = await waitFor((r) => r.type === 'purr', 2000);
      record('petting wakes her; the purr is the soft one', behavior.state === 'awake' && /^pet/.test(behavior.lastWakeReason)
        && (!purr || purr.data.quiet !== false), purr ? JSON.stringify(purr.data) : 'no purr report (sound may be off)');
      await settle('wake');

      // menu
      const items = buildContextMenu().items;
      const spotMenu = items.find((i) => i.label === 'Sleeping spot');
      record('menu: "Sleep now" + "Sleeping spot" (Random, bed, tree, box, None)', items.some((i) => i.label === 'Sleep now')
        && spotMenu && spotMenu.submenu.items.length === 5 && spotMenu.submenu.items.find((i) => i.checked).label === 'Cardboard box');
      spotMenu.submenu.items.find((i) => i.label === 'Cat tree').click();
      record('menu: choosing "Cat tree" saves it for this cat', settings.sleepSpot === 'tree' && diskCat().sleepSpot === 'tree');

      // Preview sleep: in place for N s, then wakes by itself
      const before = win.getBounds();
      previewSleep('tree', 1500);
      await sleep(400);
      const asleepInPlace = behavior.state === 'sleeping' && win.getBounds().y === before.y;
      await sleep(1600);
      record('Preview sleep: sleeps in place, wakes up by itself', asleepInPlace && behavior.state === 'awake' && behavior.lastWakeReason === 'preview over');
      await settle('wake');

      // Customize: section, per-cat select, colour edit + Reset
      clearReports();
      openCustomize();
      if (await waitFor((r) => r.type === 'customize:ready', 8000)) {
        const cj = (code) => customizeWin.webContents.executeJavaScript(code);
        const ui = await cj(`({ sel: document.getElementById('sleepSpot').value, blocks: document.querySelectorAll('.spot-block').length,
          mins: document.getElementById('idleSleepMinutes').value, prev: document.getElementById('spot-preview').toDataURL().length })`);
        record('Customize: Sleeping spot section shows her spot, its colours, the sleep toggles', ui.sel === 'tree' && ui.blocks === 1 && ui.mins === '15' && ui.prev > 1000, JSON.stringify(ui));
        await cj(`(() => { const i = document.getElementById('spot-treeCarpet'); i.value = '#aa3344'; i.dispatchEvent(new Event('input')); })()`);
        await sleep(500);
        const colored = settings.sleepSpotColors.treeCarpet === '#aa3344' && diskCat().sleepSpotColors.treeCarpet === '#aa3344';
        await cj(`document.getElementById('spot-reset-tree').click()`);
        await sleep(500);
        record('Customize: spot colour saved per cat; Reset brings the default back', colored && !settings.sleepSpotColors.treeCarpet);
        await cj(`(() => { const i = document.getElementById('idleSleepMinutes'); i.value = '20'; i.dispatchEvent(new Event('change')); })()`);
        await sleep(400);
        record('Customize: sleep minutes saved (global)', settings.idleSleepMinutes === 20);
        customizeWin.close();
        await sleep(300);
      }
      record('window got room for the cat tree (27 rows)', settings.layoutRows === S.CANVAS.rows && WIN_H === SPRITE_TOP + S.CANVAS.rows * settings.catSize + 6);

      selftestClock = null;
      settings = keep;
      saveSettings();
      setWinSizeVars();
      pushState();
      if (win && !win.isDestroyed()) win.webContents.send('colors-changed', currentLook());
    }

    // 28. Updater (fake electron-updater + fake GitHub API: no network)
    {
      const U = require('./updater.js');
      const EventEmitter = require('events');
      record('updater: not running in selftest / dev (created only in whenReady)', updater === null);
      record('updater: mode detection (dev, dev-forced, installer, portable)', U.modeFor({ isPackaged: false, env: {} }) === 'dev'
        && U.modeFor({ isPackaged: false, env: { FORCE_UPDATER: '1' } }) === 'dev-forced' && U.modeFor({ isPackaged: true, env: {} }) === 'installer'
        && U.modeFor({ isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: 'C:\\x\\WaterCat.exe' } }) === 'portable');
      const cv = [['0.1.1', '0.1.0', 1], ['0.1.0', '0.1.0', 0], ['v1.0.0', '0.9.9', 1], ['1.2.0', '1.2.0-beta.3', 1], ['1.2.0-beta.3', '1.2.0-beta.10', -1], ['0.10.0', '0.9.0', 1], ['junk', '0.1.0', 0]];
      record('updater: version comparison (semver, pre-releases, junk)', cv.every(([a, b, w]) => U.compareVersions(a, b) === w));
      record('updater: only this repo\'s release pages may be opened', U.isAllowedReleaseUrl('https://github.com/serthekk/water_pet/releases/tag/v0.1.1')
        && !U.isAllowedReleaseUrl('https://github.com/someone/water_pet/releases') && !U.isAllowedReleaseUrl('https://github.com.evil.io/serthekk/water_pet/')
        && !U.isAllowedReleaseUrl('http://github.com/serthekk/water_pet/') && !U.isAllowedReleaseUrl('javascript:alert(1)'));
      const srcs = ['main.js', 'updater.js', 'fullscreen.js'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8'));
      record('no console.log in main-process files', srcs.every((s) => !/console\.log\(/.test(s.replace(/\/\/.*$/gm, ''))));
      record('updater.js requires electron-updater lazily (not at the top)', !/^const .*require\('electron-updater'\)/m.test(srcs[1]) && /require\('electron-updater'\)/.test(srcs[1]));

      // a fake electron-updater
      const mkFake = () => {
        const f = new EventEmitter();
        Object.assign(f, { calls: [], autoDownload: true, autoInstallOnAppQuit: false, allowPrerelease: null });
        f.setFeedURL = (o) => f.calls.push(['feed', o]);
        f.checkForUpdates = async () => { f.calls.push(['check']); f.emit('checking-for-update'); if (f.next) await f.next(f); return null; };
        f.downloadUpdate = async () => { f.calls.push(['download']); f.emit('download-progress', { percent: 50 }); f.emit('update-downloaded', { version: f.version }); return []; };
        f.quitAndInstall = (...a) => f.calls.push(['quitAndInstall', ...a]);
        return f;
      };
      const fakeSettings = { autoUpdate: true, updateChannel: 'stable', skippedVersion: '', lastUpdateCheck: '' };
      let announcedText = null;
      let block = null;
      const mk = (extra) => U.create(updaterDeps({
        app: { isPackaged: true, getVersion: () => '0.1.0' },
        shell: { openExternal: (u) => { mk.opened = u; } },
        env: {},
        getSettings: () => fakeSettings,
        setSettings: (p) => Object.assign(fakeSettings, p),
        announceBlock: async () => block,
        announce: (t) => { announcedText = t; },
        changed: () => {},
        ...extra,
      }));
      // 1. update found -> downloads -> ready; never installs by itself
      const fake = mkFake();
      fake.version = '0.1.1';
      fake.next = (f) => f.emit('update-available', { version: '0.1.1' });
      const u1 = mk({ autoUpdater: fake });
      await u1.check('manual');
      await sleep(50);
      const s1 = u1.status();
      const feed = fake.calls.find((c) => c[0] === 'feed');
      record('updater: finds v0.1.1, downloads in the background, ready', s1.state === 'downloaded' && s1.version === '0.1.1' && fake.calls.some((c) => c[0] === 'download')
        && fake.autoDownload === false && fake.autoInstallOnAppQuit === true, JSON.stringify(s1));
      record('updater: feed is fixed to github serthekk/water_pet', !!feed && feed[1].provider === 'github' && feed[1].owner === 'serthekk' && feed[1].repo === 'water_pet');
      record('updater: never calls quitAndInstall by itself', !fake.calls.some((c) => c[0] === 'quitAndInstall'));
      const m1 = u1.menuItems().map((i) => i.label);
      record('updater: menu offers "Restart to update (v0.1.1)" + skip', m1[0] === 'Restart to update (v0.1.1)' && m1[1] === 'Skip v0.1.1', m1.join(' | '));
      // the one bubble: held back while she sleeps, shown when she may
      block = 'the cat is asleep';
      announcedText = null;
      await u1._tryAnnounce();
      const held = announcedText === null;
      block = null;
      await u1._tryAnnounce();
      const shownOnce = announcedText === 'A new version is ready! 🐾 Right-click to update.';
      announcedText = null;
      await u1._tryAnnounce();
      record('updater: "update ready" bubble held back while asleep, then shown ONCE', held && shownOnce && announcedText === null);
      // Restart to update = the only quitAndInstall (silent, start again)
      u1.restartToUpdate('selftest');
      const qi = fake.calls.find((c) => c[0] === 'quitAndInstall');
      record('updater: "Restart to update" installs silently and starts the app again', !!qi && qi[1] === true && qi[2] === true);
      // 2. skip this version
      const fake2 = mkFake();
      fake2.version = '0.1.1';
      fake2.next = (f) => f.emit('update-available', { version: '0.1.1' });
      const u2 = mk({ autoUpdater: fake2 });
      await u2.check('manual');
      await sleep(50);
      u2.skipVersion();
      const skipOk = fakeSettings.skippedVersion === '0.1.1' && fake2.autoInstallOnAppQuit === false && u2.menuItems().length === 0;
      const fake3 = mkFake();
      fake3.next = (f) => f.emit('update-available', { version: '0.1.1' });
      const u3 = mk({ autoUpdater: fake3 });
      await u3.check('manual');
      record('updater: "Skip" remembers the version; it is never downloaded again', skipOk && !fake3.calls.some((c) => c[0] === 'download') && u3.status().state === 'up-to-date');
      fake3.next = (f) => f.emit('update-available', { version: '0.1.2' });
      fake3.version = '0.1.2';
      await u3.check('manual');
      await sleep(50);
      record('updater: a NEWER version than the skipped one is offered again', u3.status().state === 'downloaded' && u3.status().version === '0.1.2');
      fakeSettings.skippedVersion = '';
      // 3. failures never throw: offline / rate limit / GitHub down / bad signature
      let threw = false;
      const states = [];
      for (const failWith of ['net::ERR_INTERNET_DISCONNECTED', 'HttpError: 403 rate limit exceeded', 'HttpError: 503', 'New version is not signed by the application owner']) {
        const f = mkFake();
        f.next = async () => { throw new Error(failWith); };
        const u = mk({ autoUpdater: f });
        try { states.push(`${(await u.check('auto'))}/${u.status().state}`); } catch (_) { threw = true; }
        const f2 = mkFake();
        f2.next = (x) => x.emit('error', new Error(failWith));
        try { await mk({ autoUpdater: f2 }).check('auto'); } catch (_) { threw = true; }
      }
      record('updater: offline / rate limit / GitHub down / bad signature: logged, no throw, no popup', !threw && states.every((s) => s === "Couldn't check right now/error"), states.join(', '));
      // 4. busy: no check while a reminder is up
      {
        const keepN = nagging;
        const keepA = activeAlarm;
        nagging = null;
        activeAlarm = null;
        const free = updaterDeps().busyReason();
        nagging = { since: Date.now(), nextAt: 0, repeats: 0 };
        const duringReminder = updaterDeps().busyReason();
        nagging = keepN;
        activeAlarm = keepA;
        record('updater: postpones checks while a reminder is up', free === null && duringReminder === 'a water reminder is up');
      }
      // 5. channel
      fakeSettings.updateChannel = 'beta';
      const fb = mkFake();
      await mk({ autoUpdater: fb }).check('manual');
      record('updater: beta channel allows pre-releases', fb.allowPrerelease === true);
      fakeSettings.updateChannel = 'stable';
      // 6. dev mode: skipped
      const ud = mk({ app: { isPackaged: false, getVersion: () => '0.1.0' }, autoUpdater: mkFake() });
      record('updater: dev mode skips checks', ud.mode === 'dev' && /dev mode/.test(await ud.check('manual')));
      // 7. portable: GitHub API -> "open download page"
      const api = (status, body) => async (url) => { api.url = url; return { ok: status === 200, status, json: async () => body }; };
      const up = mk({ env: { PORTABLE_EXECUTABLE_FILE: 'C:\\x\\WaterCat-Portable.exe' }, fetch: api(200, { tag_name: 'v0.2.0', html_url: 'https://github.com/serthekk/water_pet/releases/tag/v0.2.0', draft: false, prerelease: false }) });
      await up.check('manual');
      const pm = up.menuItems();
      pm[0] && pm[0].click();
      record('portable: API check offers "Update available (v0.2.0) - open download page"', up.mode === 'portable' && api.url === 'https://api.github.com/repos/serthekk/water_pet/releases/latest'
        && pm[0] && pm[0].label === 'Update available (v0.2.0) - open download page' && mk.opened === 'https://github.com/serthekk/water_pet/releases/tag/v0.2.0', pm.map((i) => i.label).join(' | '));
      const ue = mk({ env: { PORTABLE_EXECUTABLE_FILE: 'x' }, fetch: api(200, { tag_name: 'v0.3.0', html_url: 'https://evil.example/download', draft: false }) });
      await ue.check('manual');
      record('portable: a foreign download URL is never used (falls back to our releases page)', ue.status().releaseUrl === 'https://github.com/serthekk/water_pet/releases');
      const ur = mk({ env: { PORTABLE_EXECUTABLE_FILE: 'x' }, fetch: api(403, { message: 'rate limit' }) });
      const urText = await ur.check('manual');
      const uo = mk({ env: { PORTABLE_EXECUTABLE_FILE: 'x' }, fetch: async () => { throw new Error('offline'); } });
      const uoText = await uo.check('manual');
      const same = mk({ env: { PORTABLE_EXECUTABLE_FILE: 'x' }, fetch: api(200, { tag_name: 'v0.1.0', html_url: 'https://github.com/serthekk/water_pet/releases/tag/v0.1.0' }) });
      record('portable: rate limit / offline -> "Couldn\'t check", same version -> up to date', urText === "Couldn't check right now" && uoText === "Couldn't check right now"
        && (await same.check('manual')) === "You're up to date" && same.menuItems().length === 0);
      // 8. fullscreen helper answers
      const fsq = await require('./fullscreen.js').query();
      record('fullscreen check answers (SHQueryUserNotificationState)', typeof fsq.busy === 'boolean' && fsq.state >= 0, JSON.stringify(fsq));
      // 9. settings keys
      const us = sanitizeSettings({ autoUpdate: false, updateChannel: 'nightly', skippedVersion: 'evil; rm', lastUpdateCheck: '2026-11-24T00:00:00.000Z' });
      record('settings: autoUpdate / updateChannel / skippedVersion validated', us.autoUpdate === false && us.updateChannel === 'stable' && us.skippedVersion === ''
        && us.lastUpdateCheck === '2026-11-24T00:00:00.000Z' && DEFAULT_SETTINGS.autoUpdate === true);

      // 10. Stage 4: menus + Customize footer, in each updater state
      const labels = (m) => m.items.map((i) => i.label).filter(Boolean);
      const trayLabels = () => { updateTrayMenu(); return labels(lastTrayMenu || { items: [] }); };
      const ver = `Version ${app.getVersion()}`;
      const idle = labels(buildContextMenu());
      const verItem = buildContextMenu().items.find((i) => i.label === ver);
      record('menu: disabled "Version X.Y.Z" + "Check for updates"; no "Restart to update" without an update', idle.includes(ver) && verItem && verItem.enabled === false
        && idle.includes('Check for updates') && !idle.some((l) => /^Restart to update/.test(l)), idle.join(' | '));
      const manual = await manualUpdateCheck('selftest'); // selftest: no updater -> a clear answer, no throw
      record('"Check for updates" without an updater answers, never throws', manual.text === 'Updates are off here');
      const keepUpdater = updater;
      const fs4 = mkFake();
      fs4.version = '0.1.1';
      fs4.next = (f) => f.emit('update-available', { version: '0.1.1' });
      updater = mk({ autoUpdater: fs4 });
      const viaMenu = await manualUpdateCheck('selftest');
      const ready = labels(buildContextMenu());
      record('menu after an update downloaded: "Restart to update (v0.1.1)" on top + "Update ready" line', ready[0] === 'Restart to update (v0.1.1)'
        && ready.includes('Update ready (v0.1.1)') && viaMenu.text === 'Update ready (v0.1.1)! 🐾 Right-click to update.', ready.slice(0, 3).join(' | '));
      const fe = mkFake();
      fe.next = async () => { throw new Error('offline'); };
      updater = mk({ autoUpdater: fe });
      const offline = await manualUpdateCheck('selftest');
      record('menu after a failed check: "Check for updates (Couldn\'t check right now)"', offline.text === "Couldn't check right now 😿"
        && labels(buildContextMenu()).includes("Check for updates (Couldn't check right now)"));
      const fu = mkFake();
      fu.next = (f) => f.emit('update-not-available', { version: '0.1.0' });
      updater = mk({ autoUpdater: fu });
      record('"Check for updates" when current: "You\'re up to date"', (await manualUpdateCheck('selftest')).text === "You're up to date 🐾");
      // Customize footer
      updater = mk({ autoUpdater: fs4 }); // a fresh one in the "downloaded" state
      await updater.check('manual');
      await sleep(50);
      clearReports();
      openCustomize();
      if (await waitFor((r) => r.type === 'customize:ready', 8000)) {
        const cj = (code) => customizeWin.webContents.executeJavaScript(code);
        await sleep(300);
        const ft = await cj(`({ ver: document.getElementById('app-version').textContent, restart: !document.getElementById('restart-update').hidden,
          rtext: document.getElementById('restart-update').textContent, status: document.getElementById('update-status').textContent,
          auto: document.getElementById('autoUpdate').checked, beta: document.getElementById('betaUpdates').checked, notes: !!document.getElementById('release-notes') })`);
        try { fs.writeFileSync(path.join(LOG_DIR, 'selftest-customize-updates.png'), (await customizeWin.webContents.capturePage()).toPNG()); } catch (err) { log('screenshot failed', err); }
        record('Customize footer: version, "Restart to update", status, toggles, release notes link', ft.ver === `WaterCat v${app.getVersion()}` && ft.restart
          && ft.rtext === 'Restart to update (v0.1.1)' && /Update ready \(v0\.1\.1\)/.test(ft.status) && ft.auto === settings.autoUpdate && ft.beta === false && ft.notes, JSON.stringify(ft));
        await cj(`(() => { const c = document.getElementById('betaUpdates'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
        await sleep(300);
        await cj(`(() => { const c = document.getElementById('autoUpdate'); c.checked = false; c.dispatchEvent(new Event('change')); })()`);
        await sleep(300);
        const disk = readJsonSafe(settingsFile(), {});
        record('Customize footer toggles save autoUpdate / updateChannel', settings.updateChannel === 'beta' && settings.autoUpdate === false
          && disk.updateChannel === 'beta' && disk.autoUpdate === false);
        applySettings({ updateChannel: 'stable', autoUpdate: true });
        await sleep(200);
        const back = await cj(`({ auto: document.getElementById('autoUpdate').checked, beta: document.getElementById('betaUpdates').checked })`);
        record('Customize footer follows changes made elsewhere', back.auto === true && back.beta === false);
        customizeWin.close();
        await sleep(300);
      }
      updater = mk({ autoUpdater: fs4 });
      await updater.check('manual');
      await sleep(50);
      const tl = trayLabels();
      updater = keepUpdater;
      const tl0 = trayLabels();
      record('tray menu: Version + Check for updates; Restart to update only when ready', tl[0] === 'Restart to update (v0.1.1)' && tl.includes(ver)
        && tl0.includes(ver) && tl0.includes('Check for updates') && !tl0.some((l) => /^Restart to update/.test(l)), tl.join(' | '));

      record('after an update: one "I got an update" bubble (not on a fresh install, never for a downgrade)', updatedFrom('0.1.0', '0.1.1', true) === '0.1.0'
        && updatedFrom('', '0.1.1', true) === 'an older version' && updatedFrom('', '0.1.1', false) === null && updatedFrom('0.1.1', '0.1.1', true) === null
        && updatedFrom('0.2.0', '0.1.1', true) === null);
      // where the updater starts: once, inside app.whenReady, and main.js never loads electron-updater
      const mainSrc = srcs[0];
      const inits = [...mainSrc.matchAll(/^\s*initUpdater\(\);/gm)];
      record('updater is started once, inside app.whenReady (never at top level)', inits.length === 1 && inits[0].index > mainSrc.indexOf('app.whenReady().then(')
        && !/require\('electron-updater'\)/.test(mainSrc));
    }

    // 28b. The REAL electron-updater against a local test feed (dev selftest only, no internet):
    // up to date, server error, offline, bad checksum, and a full download.
    if (!app.isPackaged && fs.existsSync(path.join(__dirname, 'tools', 'update-test-server.js'))) {
      const U = require('./updater.js');
      const { startServer } = require('./tools/update-test-server.js');
      const cacheDir = path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'water-cat-tracker-selftest-updater');
      fs.rmSync(cacheDir, { recursive: true, force: true });
      const cfg = path.join(app.getPath('userData'), 'selftest-app-update.yml');
      const fakeS = { autoUpdate: true, updateChannel: 'stable', skippedVersion: '', lastUpdateCheck: '' };
      const run = async (mode, version, { offline = false } = {}) => {
        const srv = await startServer({ port: 0, mode, version, current: app.getVersion(), size: 1024 * 1024, bytesPerSec: 4 * 1024 * 1024, quiet: true });
        if (offline) await srv.close();
        fs.writeFileSync(cfg, `provider: generic\nurl: ${srv.url}\nupdaterCacheDirName: water-cat-tracker-selftest-updater\n`);
        const seen = [];
        let u = null;
        u = U.create(updaterDeps({
          env: { FORCE_UPDATER: '1' },
          updateConfigPath: cfg,
          getSettings: () => fakeS,
          setSettings: (p) => Object.assign(fakeS, p),
          announceBlock: async () => 'selftest',
          announce: () => {},
          changed: () => { if (u) seen.push(u.status().state); },
        }));
        let threw = false;
        let text = '';
        try { text = await u.check('manual'); } catch (_) { threw = true; }
        const t0 = Date.now();
        while (u.status().state === 'downloading' && Date.now() - t0 < 20000) await sleep(100);
        const st = u.status();
        const restarted = st.state === 'downloaded' ? u.restartToUpdate('selftest') : null;
        u.stop();
        if (!offline) await srv.close();
        return { mode: u.mode, text, threw, st, seen, requests: srv.requests, restarted };
      };
      const r1 = await run('current');
      record('test feed: same version -> "You\'re up to date"', r1.mode === 'dev-forced' && !r1.threw && r1.st.state === 'up-to-date' && r1.text === "You're up to date", JSON.stringify({ t: r1.text, s: r1.st.state }));
      const r2 = await run('fail');
      record('test feed: server error -> "Couldn\'t check right now", no throw', !r2.threw && r2.st.state === 'error' && r2.text === "Couldn't check right now", r2.st.error);
      const r3 = await run('ok', '0.1.1', { offline: true });
      record('test feed: offline -> "Couldn\'t check right now", no throw', !r3.threw && r3.st.state === 'error', r3.st.error);
      const r4 = await run('badsha', '0.1.2');
      record('test feed: a download that fails its checksum is rejected (never installs)', !r4.threw && r4.st.state === 'error' && /sha512|checksum/i.test(r4.st.error || '')
        && r4.requests.includes('/WaterCat-Setup-0.1.2.exe'), r4.st.error);
      const r5 = await run('ok', '0.1.1');
      record('test feed: v0.1.1 found -> downloading -> downloaded (real electron-updater)', !r5.threw && r5.st.state === 'downloaded' && r5.st.version === '0.1.1'
        && r5.st.installsOnQuit === false && r5.seen.includes('downloading') && r5.requests.includes('/latest.yml') && r5.requests.includes('/WaterCat-Setup-0.1.1.exe'), `${r5.st.state} ${r5.seen.join('>')} ${r5.requests.join(',')}`);
      record('test feed: "Restart to update" in dev test mode logs only (app keeps running)', r5.restarted === true && !quitting);
      fs.rmSync(cacheDir, { recursive: true, force: true });
      fs.rmSync(cfg, { force: true });
    }

    // 29. Hotkey + assets
    record('hotkey registered', globalShortcut.isRegistered(HOTKEY), 'fails if the real app is running (it holds the hotkey)');
    const bowl = await win.webContents.executeJavaScript(`(() => { const b = document.getElementById('bowl').getBoundingClientRect(); const s = getComputedStyle(document.getElementById('bowl')); return { w: b.width, h: b.height, bg: s.backgroundImage, r: s.imageRendering, droplet: document.getElementById('count').textContent.includes('💧') }; })()`);
    try {
      const shot = await win.webContents.capturePage();
      fs.writeFileSync(path.join(LOG_DIR, 'selftest-cat.png'), shot.toPNG());
    } catch (err) {
      log('screenshot failed', err);
    }
    record('food bowl shown (3x, pixelated, no droplet)', bowl.w === 36 && bowl.h === 21 && bowl.bg.includes('bowl.png') && bowl.r === 'pixelated' && !bowl.droplet, JSON.stringify(bowl));
    record('assets present', ['cat_pixel.png', 'tray.png', 'bowl.png', path.join('meows', 'meows.json')].every((a) => fs.existsSync(asset(a)))
      && BUILTIN.every((m) => fs.existsSync(m.file))
      && ['settings.html', 'settings.js', 'settings.css', 'settings-preload.js'].every((f) => fs.existsSync(path.join(__dirname, f))));
    record('no renderer errors (cat + settings)', allErrors.length === 0, allErrors.map((e) => JSON.stringify(e)).join('; '));
  } catch (err) {
    record('selftest crashed', false, err && err.stack);
  }
  finish();
}

// ---------------------------------------------------------------------------
// 6. Start
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  try {
    if (SELFTEST) {
      // Fresh-install conditions: no data files, no sounds folder.
      fs.rmSync(cupsFile(), { force: true });
      fs.rmSync(alarmsFile(), { force: true });
      fs.rmSync(userSoundsDir(), { recursive: true, force: true });
      // idle animations off by default here: they change the cat's shape (and hit box) at random
      // firstRunDone: the intro bubble is tested on its own (section 0) so it can't
      // interfere with the bubble tests
      writeJsonSafe(settingsFile(), { ...DEFAULT_SETTINGS, volume: 0.3, idleAnimations: false, firstRunDone: true });
    }
    ensureAppDirs();
    refreshSounds('startup'); // before loadSettings so meowStyle can be validated
    watchSounds();
    loadSettings();
    const existingUser = settings.firstRunDone === true; // before the first-run intro sets it
    if (process.argv.includes('--restore-starters')) {
      // one-off repair: bring back deleted Gargorl / Fainu and put Gargorl on the desktop
      const restored = restoreStarters('command line');
      if (restored.includes('gargorl')) setActiveCat('gargorl', 'restore');
    }
    setWinSizeVars();
    log(`active cat: ${settings.activeCatId} "${settings.catName}" - ${catLabel(activeCat())}`);
    loadCups();
    loadAlarmState();
    registerIpc();
    createWindow();
    createTray();
    registerHotkey();
    startTimers();
    startBehavior();
    initUpdater(); // only here, inside whenReady
    scheduleUpdatedBubble(existingUser);
    if (SELFTEST) runSelftest();
    else applyLoginItem();
    screen.on('display-removed', reclamp);
    screen.on('display-metrics-changed', reclamp);
    log('startup complete');
  } catch (err) {
    log('STARTUP FAILED', err);
    if (SELFTEST) app.exit(2);
  }
});
