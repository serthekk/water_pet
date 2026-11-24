// Dev tool: preview sheets for the layered sprite (Stage 1), 8x scale, labelled.
// Run: node preview_catsprite.js   ->  build/preview-<name>.png
//   gargorl-whiskers.png, gargorl-nowhiskers.png, fainu.png, gargorl-vs-photo.png
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');
const S = require('./catsprite.js');

const problems = S.validate();
if (problems.length) {
  console.error('sprite problems:\n' + problems.join('\n'));
  process.exit(1);
}

// tiny 3x5 pixel font for labels
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '/': '001001010100100', '-': '000000111000000', ' ': '000000000000000', '(': '010100100100010', ')': '010001001001010',
};

const SCALE = 8;
const CW = S.CANVAS.cols * SCALE;
const CH = S.CANVAS.rows * SCALE;
const LABEL = 20;
const PAD = 8;
const COLS = 6;
// '#rrggbb' or 'rgba(r,g,b,a)' (blended onto the preview background)
const hex = (c) => {
  if (c.startsWith('rgba')) {
    const [r, g, b, a] = c.match(/[\d.]+/g).map(Number);
    return [r, g, b].map((v, i) => Math.round(v * a + [196, 210, 226][i] * (1 - a)));
  }
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
};

function sheet(name, cells, bg) {
  const rows = Math.ceil(cells.length / COLS);
  const W = COLS * (CW + PAD) + PAD;
  const H = rows * (CH + LABEL + PAD) + PAD;
  const png = new PNG({ width: W, height: H });
  const px = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(x, y, [40, 44, 52]);
  cells.forEach((cell, i) => {
    const ox = PAD + (i % COLS) * (CW + PAD);
    const oy = PAD + Math.floor(i / COLS) * (CH + LABEL + PAD);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) px(ox + x, oy + LABEL + y, bg);
    const text = cell.label.toUpperCase();
    [...text].forEach((chr, k) => {
      const g = FONT[chr] || FONT[' '];
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (g[gy * 3 + gx] === '1') {
        for (let s = 0; s < 4; s++) px(ox + k * 16 + gx * 3 + (s % 2), oy + 2 + gy * 3 + Math.floor(s / 2), [240, 240, 240]);
      }
    });
    const grid = cell.grid;
    const offX = cell.offX || 0;
    const offY = cell.offY || 0;
    grid.forEach((row, y) => row.forEach((col, x) => {
      if (!col) return;
      const rgb = hex(col);
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) px(ox + (offX + x) * SCALE + dx, oy + LABEL + (offY + y) * SCALE + dy, rgb);
    }));
    if (cell.whiskers) {
      const rgb = hex(cell.whiskerColor);
      for (const [wx, wy, t] of S.whiskerSquares(cell.whiskers, SCALE)) {
        for (let dy = 0; dy < t; dy++) for (let dx = 0; dx < t; dx++) px(ox + wx + dx, oy + LABEL + wy + dy, rgb);
      }
    }
  });
  const out = path.join(__dirname, 'build', `preview-${name}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log(`wrote ${path.relative(__dirname, out)} ${W}x${H} (${cells.length} cells)`);
  return out;
}

function catCells(look) {
  const cells = [];
  const wc = look.colors.whiskers;
  const cellOf = (label, pose, frame, l, f) => ({ label, grid: S.render(pose, frame, l, f), whiskers: S.whiskerLines(pose, frame, l, f), whiskerColor: wc });
  for (const [pose, frames] of Object.entries(S.POSES)) {
    for (const frame of frames) cells.push(cellOf(frame === pose || frames.length === 1 ? pose : `${pose} ${frame}`, pose, frame, look, 1));
  }
  cells.push(cellOf('walk (left)', 'walk', 'a', look, -1));
  cells.push(cellOf('look left', 'sit', 'sit', { ...look, lookDx: -1 }, 1));
  cells.push(cellOf('look right', 'sit', 'sit', { ...look, lookDx: 1 }, 1));
  cells.push({ label: 'party hat', grid: S.renderProp('hat'), offX: 11, offY: 5 });
  cells.push({ label: 'disco ball', grid: S.renderProp('ball'), offX: 10, offY: 4 });
  return cells;
}

const BG = [196, 210, 226]; // light blue-gray so dark outlines and pale whiskers both show
const g = S.PRESETS.gargorl;
sheet('gargorl-whiskers', catCells({ ...g, whiskers: true }), BG);
sheet('gargorl-nowhiskers', catCells({ ...g, whiskers: false }), BG);
sheet('fainu', catCells({ ...S.PRESETS.fainu, whiskers: true }), BG);

// Sleeping spots (Stage E): each spot with Gargorl and Fainu, plus the box peek / hop frames
function sceneCell(label, o) {
  const r = S.renderScene(o);
  const grid = r.under.map((row, y) => row.map((c, x) => r.over[y][x] || c));
  return { label, grid, whiskers: null };
}
const spotCells = [];
for (const [name, preset] of [['gargorl', S.PRESETS.gargorl], ['fainu', S.PRESETS.fainu]]) {
  for (const spot of ['bed', 'tree', 'box']) {
    const sc = S.SPOT_CAT[spot];
    spotCells.push(sceneCell(`${name} ${spot}`, { pose: sc.pose, frame: sc.frames[0], look: preset, place: sc.place, spot, overlay: sc.overlay }));
  }
}
spotCells.push(sceneCell('box peek', { pose: 'sit', frame: 'sit', look: { ...g, lookDx: 1 }, place: { dy: -2 }, spot: 'box', overlay: true }));
spotCells.push(sceneCell('box hop', { pose: 'pounce', frame: 'a', look: g, place: { dy: 9 }, spot: 'box' }));
spotCells.push(sceneCell('box crouch', { pose: 'crouch', frame: 'b', look: g, place: { dy: 0, dx: -3 } }));
spotCells.push(sceneCell('bed fading', { pose: 'sit', frame: 'sit', look: g, spot: 'bed', spotAlpha: 0.5 }));
sheet('spots', spotCells, BG);

// Gargorl sitting alone at 8x (compare_photo.ps1 puts it next to the reference photo,
// which is a JPEG despite its .png name, so pngjs can't read it)
sheet('gargorl-sit', [{ label: 'gargorl', grid: S.render('sit', 'sit', { ...g, whiskers: true }, 1), whiskers: S.whiskerLines('sit', 'sit', { ...g, whiskers: true }, 1), whiskerColor: g.colors.whiskers }], BG);
const ref = path.join(__dirname, 'assets', 'reference', 'gargorl.png');
const isPng = fs.existsSync(ref) && fs.readFileSync(ref).subarray(0, 4).toString('hex') === '89504e47';
if (isPng) {
  const photo = PNG.sync.read(fs.readFileSync(ref));
  const sit = S.render('sit', 'sit', { ...g, whiskers: true }, 1);
  const W = photo.width + CW + 24;
  const H = Math.max(photo.height, CH) + 16;
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 40; png.data[i + 1] = 44; png.data[i + 2] = 52; png.data[i + 3] = 255; }
  for (let y = 0; y < photo.height; y++) for (let x = 0; x < photo.width; x++) {
    const s = (y * photo.width + x) * 4;
    const d = ((y + 8) * W + x + 8) * 4;
    png.data[d] = photo.data[s]; png.data[d + 1] = photo.data[s + 1]; png.data[d + 2] = photo.data[s + 2];
  }
  const ox = photo.width + 16;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const d = ((y + 8) * W + ox + x) * 4;
    png.data[d] = 196; png.data[d + 1] = 210; png.data[d + 2] = 226;
  }
  sit.forEach((row, y) => row.forEach((col, x) => {
    if (!col) return;
    const [r, gg, b] = hex(col);
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
      const d = ((y * SCALE + dy + 8) * W + ox + x * SCALE + dx) * 4;
      png.data[d] = r; png.data[d + 1] = gg; png.data[d + 2] = b;
    }
  }));
  const out = path.join(__dirname, 'build', 'preview-gargorl-vs-photo.png');
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log(`wrote ${path.relative(__dirname, out)}`);
}
