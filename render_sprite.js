// Renders the pixel-art cat from the text grid below.
// Run: node render_sprite.js
// Outputs (all nearest-neighbor, never smoothed):
//   assets/cat_pixel.png      native 18x16
//   assets/cat_pixel_10x.png  180x160
//   assets/tray.png           36x36  (2x, padded square, for the tray icon)
//   build/icon.png            256x256 (14x, padded, for the .exe / installer icon)
//   assets/bowl.png           native 12x7 cat food bowl (shown at 3x next to the counter)
//   assets/bowl_10x.png       120x70 preview
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const GRID = `
..KK..........KK..
..KOK........KBK..
..KOOK......KBBK..
..KOOOKKKKKKBBBK..
.KOOOOWWWWWWWBBBK.
.KOOOKWWWWWWKWBBK.
.KOOOKWWPPWWKWWBK.
.KOOOOWWKKWWWWWWK.
.KOOWWWWWWWWWWWWK.
..KKKKKKKKKKKKKK..
...KOOWWWWWWBBK...
...KOOWWWWWWWBK...
..KOOOWWWWWWWWBK..
..KOOOOWWWWWWBBK..
..KOOOWWWWWWWWWK..
..KKKKKKKKKKKKKK..
`;

// Cat food bowl shown next to the cup counter (12x7). c/C = kibble.
const BOWL = `
...cCc.Cc...
..cCcCcCcCc.
.KKKKKKKKKK.
.KPPPPPPPPK.
.KPPWWWWPPK.
KPPPPPPPPPPK
KKKKKKKKKKKK
`;

const PALETTE = {
  K: '#3b2f2f',
  W: '#fff6ea',
  O: '#e8913a',
  B: '#4a4040',
  P: '#f4a6b8',
  c: '#9a5a2a',
  C: '#e8913a',
};

function parse(grid, w, h, name) {
  const rows = grid.trim().split(/\r?\n/);
  if (rows.length !== h || rows.some((r) => r.length !== w)) throw new Error(`${name} grid must be ${w}x${h}`);
  return rows;
}

const CAT = parse(GRID, 18, 16, 'Cat');
const BOWL_ROWS = parse(BOWL, 12, 7, 'Bowl');
const W = 18;
const H = 16;

function hex(c) {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

// Draw `rows` at integer `scale` into a canvas of size cw x ch at offset (ox, oy).
function render(scale, cw, ch, ox, oy, rows = CAT) {
  const png = new PNG({ width: cw, height: ch }); // zero-filled = transparent
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      if (c === '.') continue;
      if (!PALETTE[c]) throw new Error(`Unknown sprite char "${c}" at ${x},${y}`);
      const [r, g, b] = hex(PALETTE[c]);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ox + x * scale + dx;
          const py = oy + y * scale + dy;
          const i = (py * cw + px) * 4;
          png.data[i] = r;
          png.data[i + 1] = g;
          png.data[i + 2] = b;
          png.data[i + 3] = 255;
        }
      }
    }
  }
  return PNG.sync.write(png);
}

function out(rel, buf) {
  const p = path.join(__dirname, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  console.log(`wrote ${rel} (${buf.length} bytes)`);
}

out('assets/cat_pixel.png', render(1, W, H, 0, 0));
out('assets/cat_pixel_10x.png', render(10, W * 10, H * 10, 0, 0));
out('assets/tray.png', render(2, 36, 36, 0, 2));
out('build/icon.png', render(14, 256, 256, 2, 16));
out('assets/bowl.png', render(1, 12, 7, 0, 0, BOWL_ROWS));
out('assets/bowl_10x.png', render(10, 120, 70, 0, 0, BOWL_ROWS));
