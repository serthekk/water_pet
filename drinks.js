'use strict';
// What she drinks: the little icon next to the counter under the cat + the counter word
// ("3 / 8 cups"). Pixel-art grids (one letter per pixel, '.' = empty), drawn cell by cell
// at a whole-number scale, never smoothed. Used by main (ids + words), the cat page and
// Settings (previews). 'bowl' is the original cat food bowl (assets/bowl.png).
(function (root) {
  const K = '#3b2f2f'; // outline (same as the app)

  const DRINKS = {
    bowl: { label: 'Cat bowl', word: 'cups', image: 'assets/bowl.png' },
    water: {
      label: 'Water',
      word: 'cups',
      colors: { K, W: '#eaf6fc', B: '#5fb4e8', L: '#c4e8fb', D: '#3f8fc4' },
      grid: [
        'K........K',
        'KW......WK',
        'KWWWWWWWWK',
        'KBBBBBBBBK',
        'KBLBBBBBBK',
        '.KBLBBBBK.',
        '.KBLBBBBK.',
        '.KBBBBBDK.',
        '.KBBBBBDK.',
        '..KDDDDK..',
        '..KKKKKK..',
      ],
    },
    kombucha: {
      label: 'Kombucha',
      word: 'kombucha cans',
      colors: { K, S: '#c9ccd1', s: '#9da1a8', Y: '#f2c230', W: '#fbfbf7', D: '#2f2f33', O: '#e8a13a' },
      grid: [
        '.KKKKKK.',
        'KSSSSSsK',
        'KKKKKKKK',
        'KYYOYYYK',
        'KWWWWWWK',
        'KWDDDDWK',
        'KWDDDDWK',
        'KWWWWWWK',
        'KYYYYYYK',
        'KWDWWDWK',
        'KKKKKKKK',
        'KSSSSSsK',
        '.KKKKKK.',
      ],
    },
    tea: {
      label: 'Tea',
      word: 'cups',
      colors: { K, V: '#e4e7ea', T: '#d8b445', t: '#c29a2e', G: '#6b7a3a', W: '#eaf6fc', P: '#f5e6c8' },
      grid: [
        '..V..V......',
        '...V..V.....',
        'KKKKKKKKK...',
        'KWWWWWWWKKK.',
        'KTTTTGTTK.K.',
        'KTTTGGGTK.K.',
        'KTTGGGGGKKK.',
        'KTTTTTTtK.P.',
        '.KTTTTtK..P.',
        '..KKKKK.....',
      ],
    },
    coffee: {
      label: 'Coffee',
      word: 'cups',
      colors: { K, V: '#e4e7ea', C: '#9a6440', L: '#f3dfc4', M: '#fbf7f2', m: '#ddd5cc' },
      grid: [
        '..V..V......',
        '...V..V.....',
        'KKKKKKKKK...',
        'KCCLLCCCKKK.',
        'KCLLLLCCK.K.',
        'KCCLLCCCK.K.',
        'KMMMMMMmKKK.',
        'KMMMMMMmK...',
        '.KMMMMmK....',
        '..KKKKK.....',
      ],
    },
    boba: {
      label: 'Boba',
      word: 'bobas',
      colors: { K, P: '#f29cc0', L: '#fbf7f2', T: '#d7ad80', t: '#bf9163', D: '#2b1d14', W: '#f6e7d4' },
      grid: [
        '......P.',
        '.....P..',
        '.KKKKPK.',
        'KLLLLPLK',
        'KKKKKKKK',
        '.KWWWWK.',
        '.KTTTtK.',
        '.KTTTtK.',
        '.KTDTDK.',
        '.KDTDDK.',
        '.KDDDDK.',
        '..KKKK..',
      ],
    },
  };
  const IDS = Object.keys(DRINKS);
  const DEFAULT = 'bowl';
  const get = (id) => DRINKS[id] || DRINKS[DEFAULT];
  // The counter word: hers if she typed one, else the drink's own.
  const wordFor = (id, custom) => (typeof custom === 'string' && custom.trim() ? custom.trim() : get(id).word);

  // Draw a drink's grid into a canvas at `scale` px per cell (canvas sized to fit).
  // Returns false for the bowl (an image, not a grid).
  function draw(canvas, id, scale) {
    const d = get(id);
    if (!d.grid) return false;
    const h = d.grid.length;
    const w = Math.max(...d.grid.map((r) => r.length));
    canvas.width = w * scale;
    canvas.height = h * scale;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    d.grid.forEach((row, y) => [...row].forEach((ch, x) => {
      const col = d.colors[ch];
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x * scale, y * scale, scale, scale);
    }));
    return true;
  }

  const api = { DRINKS, IDS, DEFAULT, get, wordFor, draw, list: () => IDS.map((id) => ({ id, label: DRINKS[id].label, word: DRINKS[id].word })) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Drinks = api;
})(typeof window !== 'undefined' ? window : globalThis);
