'use strict';
// Exports the desktop cat's pixel art (catsprite.js) and drink icons (drinks.js) as data
// for the Android sprite renderer (CatSprite.kt), and golden test scenes rendered by the
// desktop code itself (the Kotlin renderer must match them cell for cell).
//   node scripts/export_sprites.js <data.json> [<fixtures.json>] [<themes.json>]
// (themes.js colour themes are exported too, for the Material 3 colour schemes)
// The desktop files are only READ: catsprite.js is evaluated in a sandbox with one extra
// line that hands its internal tables (grids, anchors, layouts) to this script.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DESKTOP = path.resolve(__dirname, '..', '..');

function loadCatSprite() {
  const src = fs.readFileSync(path.join(DESKTOP, 'catsprite.js'), 'utf8');
  const hook = 'globalThis.__CS = { FRAMES, LAYOUT, WHISKERS, SIT_EYES, ANCHORS, ITEM_GRIDS, POST, POST_COLORS, HEART, PARTY_HAT, DISCO_BALL, SPOTS, SPOT_CAT, SEASONAL_GRID, lookEdits, sadEdits };\n  const api = {';
  if (!src.includes('  const api = {')) throw new Error('catsprite.js changed: "const api = {" not found');
  const ctx = { module: { exports: {} }, globalThis: null, Math, Date, Object, Array, JSON, Number, String, Set, Map, Error };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src.replace('  const api = {', hook), ctx, { filename: 'catsprite.js' });
  return { api: ctx.module.exports, cs: ctx.__CS };
}

function loadDrinks() {
  const ctx = { module: { exports: {} }, Math, Object };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DESKTOP, 'drinks.js'), 'utf8'), ctx, { filename: 'drinks.js' });
  return ctx.module.exports;
}

const { api: S, cs } = loadCatSprite();
const D = loadDrinks();

// --- data for the app -------------------------------------------------------------
const plain = (v) => JSON.parse(JSON.stringify(v));
const data = {
  canvas: S.CANVAS,
  parts: S.PARTS,
  presets: Object.fromEntries(Object.entries(S.PRESETS).map(([id, p]) => [id, {
    label: p.label, description: p.description || '', unlock: !!p.unlock, colors: p.colors, pattern: p.pattern, ears: p.ears, fluffy: !!p.fluffy, tufts: !!p.tufts,
  }])),
  patterns: S.PATTERNS,
  frames: plain(cs.FRAMES),
  poses: S.POSES,
  layout: plain(cs.LAYOUT),
  whiskers: plain(cs.WHISKERS),
  lookEdits: { '-1': cs.lookEdits(-1), 1: cs.lookEdits(1) },
  sadEdits: cs.sadEdits(),
  post: { rows: cs.POST, colors: cs.POST_COLORS },
  heart: plain(cs.HEART),
  partyHat: plain(cs.PARTY_HAT),
  discoBall: plain(cs.DISCO_BALL),
  accessories: plain(S.ACCESSORIES),
  seasonal: plain(S.SEASONAL),
  seasonalGrid: plain(cs.SEASONAL_GRID),
  unlocks: plain(S.UNLOCKS),
  itemGrids: plain(cs.ITEM_GRIDS),
  anchors: plain(cs.ANCHORS),
  spots: Object.fromEntries(Object.entries(cs.SPOTS).map(([id, s]) => [id, { col: s.col, rows: s.rows, frontFrom: s.frontFrom }])),
  spotParts: plain(S.SPOT_PARTS),
  spotDefaultColors: plain(S.SPOT_DEFAULT_COLORS),
  spotLabels: plain(S.SPOT_LABELS),
  spotCat: plain(S.SPOT_CAT),
  kneadProps: plain(S.KNEAD_PROPS),
  drinks: Object.fromEntries(D.IDS.map((id) => [id, { label: D.DRINKS[id].label, word: D.DRINKS[id].word, grid: D.DRINKS[id].grid || null, colors: D.DRINKS[id].colors || null }])),
};

// --- golden scenes ----------------------------------------------------------------
// colours normalised to ARGB hex (the Kotlin renderer works in ARGB ints)
function argb(col) {
  if (!col) return null;
  if (col.startsWith('#')) return 'ff' + col.slice(1).toLowerCase();
  const m = col.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (!m) throw new Error(`colour ${col}`);
  const h = (n) => Number(n).toString(16).padStart(2, '0');
  return h(Math.round(parseFloat(m[4]) * 255)) + h(m[1]) + h(m[2]) + h(m[3]);
}
const CODES = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function encode(grid, palette) {
  return grid.map((row) => row.map((c) => {
    if (!c) return '.';
    const a = argb(c);
    let i = palette.indexOf(a);
    if (i < 0) { i = palette.length; palette.push(a); }
    if (i >= CODES.length) throw new Error('palette too big');
    return CODES[i];
  }).join(''));
}

function scenes() {
  const out = [];
  const look = (id, extra = {}) => ({ ...S.PRESETS[id], ...extra });
  const allFrames = Object.entries(S.POSES).flatMap(([pose, frames]) => frames.map((f) => [pose, f]));
  // every frame: Gargorl both ways + three other coats
  for (const [pose, frame] of allFrames) {
    out.push({ pose, frame, look: look('gargorl'), facing: 1 });
    out.push({ pose, frame, look: look('gargorl'), facing: -1 });
    for (const id of ['fainu', 'mainecoon', 'galaxy']) out.push({ pose, frame, look: look(id), facing: 1 });
  }
  // every coat sitting + walking, tail off too
  for (const id of Object.keys(S.PRESETS)) {
    out.push({ pose: 'sit', frame: 'sit', look: look(id), facing: 1 });
    out.push({ pose: 'walk', frame: 'b', look: look(id, { tail: false }), facing: -1 });
  }
  // patterns x ears x fluff on a few poses
  for (const pattern of S.PATTERNS) for (const ears of ['normal', 'fold', 'small']) {
    out.push({ pose: 'sit', frame: 'wag', look: look('orangetabby', { pattern, ears, fluffy: true, tufts: true }), facing: 1 });
    out.push({ pose: 'sleep', frame: 'a', look: look('orangetabby', { pattern, ears, tail: pattern !== 'spots' }), facing: 1 });
  }
  // eyes following, sad mood, no whiskers
  for (const lookDx of [-1, 1]) out.push({ pose: 'sit', frame: 'sit', look: look('gargorl', { lookDx }), facing: 1 });
  out.push({ pose: 'sit', frame: 'blink', look: look('white', { mood: 'sad' }), facing: 1 });
  out.push({ pose: 'sit', frame: 'squint', look: look('white', { mood: 'sad', whiskers: false }), facing: 1 });
  // accessories (every item, alone and together) + seasonal + party hat, on every pose
  const items = Object.keys(S.ACCESSORIES);
  const allOn = Object.fromEntries(items.filter((i) => !['glasses', 'sunglasses', 'bandana', 'bell', 'crown', 'goldcrown'].includes(i)).map((i) => [i, { on: true, colors: {} }]));
  for (const [pose, frame] of allFrames) {
    out.push({ pose, frame, look: look('gargorl'), facing: 1, accessories: allOn, catName: 'Gargorl' });
    out.push({ pose, frame, look: look('fainu'), facing: -1, accessories: { sunglasses: { on: true, colors: { a: '#123456' } }, bell: { on: true, colors: {} }, crown: { on: true, colors: {} } }, seasonal: 'heartpin' });
    out.push({ pose, frame, look: look('black'), facing: 1, hat: true, accessories: { bow: { on: true, colors: {} }, crown: { on: true, colors: {} } } });
  }
  for (const id of items) out.push({ pose: 'sit', frame: 'sit', look: look('gargorl'), facing: 1, accessories: { [id]: { on: true, colors: {} } } });
  for (const s of Object.keys(S.SEASONAL)) for (const pose of ['sit', 'walk', 'belly']) out.push({ pose, frame: S.POSES[pose][0], look: look('siamese'), facing: 1, seasonal: s });
  // sleeping spots (+ overlays) and kneading props
  for (const spot of S.SPOT_IDS) {
    const sc = S.SPOT_CAT[spot];
    for (const frame of sc.frames) out.push({ pose: sc.pose, frame, look: look('tuxedo'), facing: 1, place: sc.place, spot, overlay: !!sc.overlay, accessories: { bow: { on: true, colors: {} }, crown: { on: true, colors: {} } } });
    out.push({ pose: sc.pose, frame: sc.frames[0], look: look('fainu'), facing: -1, place: sc.place, spot, overlay: !!sc.overlay, spotColors: { bedRim: '#aa3355', boxCardboard: '#998877', treeCarpet: '#556677' } });
  }
  for (const kneadProp of ['blanket', 'dough']) out.push({ pose: 'knead', frame: 'a', look: look('gargorl'), facing: 1, kneadProp });
  return out;
}

const fixtures = scenes().map((o) => {
  const r = S.renderScene(o);
  const palette = [];
  return {
    options: o,
    under: encode(r.under, palette),
    over: encode(r.over, palette),
    palette,
    whiskers: r.whiskers,
    catBox: r.catBox,
    hatBox: r.hatBox,
    tag: r.tag,
  };
});

const [, , dataOut, fixturesOut, themesOut] = process.argv;
if (!dataOut) throw new Error('usage: node export_sprites.js <data.json> [<fixtures.json>]');
fs.mkdirSync(path.dirname(dataOut), { recursive: true });
fs.writeFileSync(dataOut, JSON.stringify(data));
console.log(`${dataOut}: ${Object.keys(data.frames).length} poses, ${Object.keys(data.presets).length} coats, ${Object.keys(data.accessories).length} accessories, ${(fs.statSync(dataOut).size / 1024).toFixed(1)} KB`);
if (fixturesOut) {
  fs.mkdirSync(path.dirname(fixturesOut), { recursive: true });
  const json = JSON.stringify(fixtures);
  fs.writeFileSync(fixturesOut, fixturesOut.endsWith('.gz') ? require('zlib').gzipSync(json, { level: 9 }) : json);
  console.log(`${fixturesOut}: ${fixtures.length} golden scenes, ${(fs.statSync(fixturesOut).size / 1024).toFixed(1)} KB`);
}

if (themesOut) {
  const ctx = { module: { exports: {} }, Object, Math, JSON };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DESKTOP, 'themes.js'), 'utf8'), ctx, { filename: 'themes.js' });
  const T = ctx.module.exports;
  const themes = T.IDS.filter((id) => id !== 'custom').map((id) => {
    const t = T.THEMES[id];
    const vars = Object.fromEntries(Object.entries(t.vars).filter(([k]) => k !== 'grad'));
    return { id, label: t.label, dark: !!t.dark, vars };
  });
  fs.writeFileSync(themesOut, JSON.stringify({ default: T.DEFAULT, themes, customKeys: T.CUSTOM_KEYS, customLabels: T.CUSTOM_LABELS }, null, 1));
  console.log(`${themesOut}: ${themes.length} themes`);
}
