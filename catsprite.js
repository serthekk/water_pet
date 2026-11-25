// Layered, recolourable pixel cat (Stage 1). Every body part has its own letter and its
// own colour; whiskers are a separate overlay; patterns are overlays that use patch A/B.
// Used by the cat window, the Customize window and preview_catsprite.js (node).
//
// Part letters (grid)                       colour key in settings.json "colors"
//   K outline                                outline
//   F fur base, S fur shade                  furBase, furShade
//   M muzzle / chest                         muzzle
//   G belly                                  belly
//   C cheeks (blush)                         cheeks
//   Y eye, P pupil, W eye shine              eyes, pupils, eyeShine
//   U ear outer, I ear inner                 earOuter, earInner
//   N nose, O mouth (inside)                 nose, mouth
//   D paws                                   paws
//   T tail fur, t tail outline (tail on)     tail, outline
//   V tail when on, else fur (sleep curl)    tail / furBase
//   X ear tip (outline; gone for folded ears, top row gone for small ears)
//   Q ear tuft (Maine Coon), Z cheek ruff (fluffy breeds)  -> outline / muzzle
// Whiskers: overlay points per pose (colour "whiskers"), on/off with whiskersEnabled.
// Patterns (furPattern): solid | tabby | tuxedo | calico | spots | points  -> patchA / patchB
(function (root) {
  'use strict';

  // 30 x 27 cells. The cat stands on the bottom row; the 8 rows above a sitting cat are
  // room for the tallest sleeping spot (the cat tree) and, later, party props.
  const CANVAS = { cols: 30, rows: 27 };

  // ---- grids ---------------------------------------------------------------------
  // Sitting, front view, 21x19. Big round eyes (3x3: shine, iris, vertical slit pupil).
  const SIT = [
    '..Q..........Q.......',
    '..X..........X.......',
    '..KX........XK.......',
    '..KIK......KIK.......',
    '.KUIIKKKKKKIIUK......',
    '.KFFFFFFFFFFFFK......',
    '.KFFFFFFFFFFFFK......',
    '.KFWYYFFFFWYYFK......',
    'ZKFYPYFFFFYPYFKZ.....',
    'ZKFYPYFFFFYPYFKZ..tt.',
    'ZKFCFFMNNMFFCFKZ.tTTt',
    '.ZKFFMMOOMMFFKZ..tTTt',
    '...KFMMMMMMFK....tTTt',
    '...KFFMMMMFFK....tTTt',
    '..KFFSMMMMSFFK...tTTt',
    '..KFSMGGGGMSFK..tTTt.',
    '..KSSMGGGGMSSK.tTTt..',
    '..KSDDKDDKDDSKTTt....',
    '..KKKKKKKKKKKKtt.....',
  ];
  // eye cells in SIT (for blink / squint / pupil shift)
  const SIT_EYES = { rows: [7, 8, 9], left: [3, 4, 5], right: [10, 11, 12] };

  function setCells(rows, edits) {
    const out = rows.map((r) => [...r]);
    for (const [x, y, ch] of edits) if (out[y] && x >= 0 && x < out[y].length) out[y][x] = ch;
    return out.map((r) => r.join(''));
  }
  function eyeEdits(kind) {
    // kind: 'blink' (closed line), 'squint' (happy ^ ^)
    const e = [];
    for (const cols of [SIT_EYES.left, SIT_EYES.right]) {
      for (const y of SIT_EYES.rows) for (const x of cols) e.push([x, y, 'F']);
      if (kind === 'blink') for (const x of cols) e.push([x, 9, 'K']);
      if (kind === 'squint') e.push([cols[1], 8, 'K'], [cols[0], 9, 'K'], [cols[2], 9, 'K']);
    }
    return e;
  }
  // Pupil shift for "eyes follow the cursor" (Stage 7): dx -1 / 0 / +1
  function lookEdits(dx) {
    if (!dx) return [];
    const e = [];
    for (const cols of [SIT_EYES.left, SIT_EYES.right]) {
      for (const y of [8, 9]) {
        e.push([cols[1], y, 'Y']);
        e.push([cols[1] + dx, y, 'P']);
      }
    }
    return e;
  }
  // Tail wag: the upper tail leans one pixel right.
  function wag(rows) {
    return rows.map((r, y) => {
      if (y > 12) return r;
      const a = [...r];
      for (let x = a.length - 1; x >= 15; x--) {
        if (a[x] === 't' || a[x] === 'T') {
          if (x + 1 < a.length) a[x + 1] = a[x];
          a[x] = '.';
        }
      }
      return a.join('');
    });
  }
  const pad = (rows, w) => rows.map((r) => r.padEnd(w, '.'));

  // Mood (Stage 9): a little sad = ears flattened sideways + heavy eyelids (sitting only).
  function sadEdits() {
    const e = [];
    for (const [x, y] of [[2, 0], [2, 1], [2, 2], [3, 2], [13, 0], [13, 1], [12, 2], [13, 2]]) e.push([x, y, '.']);
    e.push([1, 3, 'K'], [2, 3, 'U'], [3, 3, 'I'], [4, 3, 'K']); // left ear, pointing out
    e.push([11, 3, 'K'], [12, 3, 'I'], [13, 3, 'U'], [14, 3, 'K']); // right ear
    for (const cols of [SIT_EYES.left, SIT_EYES.right]) for (const x of cols) e.push([x, 7, 'K']); // eyelids
    return e;
  }
  const SIT_BLINK = setCells(SIT, eyeEdits('blink'));
  const SIT_SQUINT = setCells(SIT, eyeEdits('squint'));
  const YAWN = setCells(SIT, [
    ...eyeEdits('squint'),
    [5, 11, 'K'], [6, 11, 'O'], [7, 11, 'O'], [8, 11, 'O'], [9, 11, 'O'], [10, 11, 'K'],
    [5, 12, 'K'], [6, 12, 'O'], [7, 12, 'C'], [8, 12, 'C'], [9, 12, 'O'], [10, 12, 'K'],
    [6, 13, 'K'], [7, 13, 'K'], [8, 13, 'K'], [9, 13, 'K'],
  ]);
  // Grooming: eyes closed, left front paw raised to the mouth, tongue out (frame a).
  const GROOM_BASE = [
    ...eyeEdits('blink'),
    [3, 10, 'K'], [4, 10, 'D'], [5, 10, 'D'], [6, 10, 'K'],
    [3, 11, 'K'], [4, 11, 'D'], [5, 11, 'D'], [6, 11, 'D'],
    [4, 12, 'K'], [5, 12, 'F'], [6, 12, 'K'],
    [4, 13, 'K'], [5, 13, 'F'],
    [4, 17, 'S'], [5, 17, 'S'],
  ];
  const GROOM_A = setCells(SIT, [...GROOM_BASE, [7, 11, 'C']]); // tongue out, paw at the mouth
  const GROOM_B = setCells(SIT, [ // paw a little lower, tongue in
    ...eyeEdits('blink'),
    [3, 11, 'K'], [4, 11, 'D'], [5, 11, 'D'], [6, 11, 'K'],
    [3, 12, 'K'], [4, 12, 'D'], [5, 12, 'D'], [6, 12, 'D'],
    [4, 13, 'K'], [5, 13, 'F'],
    [4, 17, 'S'], [5, 17, 'S'],
  ]);

  // Belly-up: lying on her back, belly + paws in the air, happy closed eyes. 22x11.
  const BELLY = [ // 24x10: four round paws up, tail curling out at the end
    '.X..X....KK.KK..KK.KK...',
    'KIKKIK..KDDKDDKKDDKDDK..',
    'KFFFFFK.KFFKFFKKFFKFFK..',
    'KFFFFFFKGGGGGGGGGGGGGK..',
    'KFKFFKFFGGGGGGGGGGGGGK..',
    'KKFKKFKFGGGGGGGGGGGGGK..',
    'KMMNNMMFFFFFFFFFFFFFFKt.',
    'KCMOOMCFSSSSSSSSSSSSSKTt',
    '.KMMMMKSSSSSSSSSSSSSKTTt',
    '..KKKKKKKKKKKKKKKKKKKtt.',
  ];

  // Sleeping curl, head on the left resting on the wrapped tail. 20x9 (+ breathing frame).
  const SLEEP = [
    '..X..X..............',
    '.KIKKIK..KKKKKKK....',
    'KFFFFFFKKFFFFFFFKK..',
    'KFKKFKKFFFFFFFFFFFK.',
    'KFCNNCFFFFFFFFFFSSFK',
    'KMMMMMFFFFFFFFFSSSSK',
    '.KMMVVVVVVVVVVVVSSK.',
    '..KVVVVVVVVVVVVVVK..',
    '...KKKKKKKKKKKKKK...',
  ];

  // Walking, side view facing right, 22x13, 4 frames.
  const WALK_TOP = [
    '...............X...X..',
    '..............KIK.KIK.',
    '..............KFFFFFFK',
    '..t...........KFFFFWYK',
    '.tTt..KKKKKKKKFFFFFPYK',
    '.tTt.KFFFFFFFFFFFFMMNK',
    '..tTKFFFFFFFFFFFFFMMK.',
    '...KFFFFFFFFFFFFFFMK..',
    '...KSFFFFFFFFFFFFFK...',
    '...KSSGGGGGGGGGGSSK...',
  ];
  const LEGS = {
    a: ['...KDKKKDKKKKDKKKDK...', '...KDK.KDK..KDK.KDK...', '...KKK.KKK..KKK.KKK...'],
    b: ['...KKDKDKKKKKDKDKK....', '....KDKDK....KDKDK....', '....KKKKK....KKKKK....'],
    c: ['...KDKKKDKKKKDKKKDK...', '...KKK.KDK..KKK.KDK...', '.......KKK.......KKK..'],
    d: ['...KKDKDKKKKKDKDKK....', '....KDKDK....KDKDK....', '....KKKKK....KKKKK....'],
  };

  // Crouch (ready to pounce, butt up, eyes on the toy) and pounce (mid-air). Facing right.
  const CROUCH_A = [
    '...............X...X..',
    '..............KIK.KIK.',
    '..t.KKKK......KFFFFFFK',
    '.tTKFFFFKK....KFFFFWYK',
    '.tTKFFFFFFKKKKFFFFFPYK',
    '..tKSFFFFFFFFFFFFFMMNK',
    '...KSSFFFFFFFFFFFFMMK.',
    '...KSSGGGGGGGGGGGSSK..',
    '...KDDKK.......KDDDK..',
    '...KKKK........KKKKK..',
  ];
  const CROUCH_B = [ // butt wiggle: rear one pixel higher, tail flicks
    '...............X...X..',
    '.t............KIK.KIK.',
    '.tTKKKK.......KFFFFFFK',
    '..tKFFFKKK....KFFFFWYK',
    '...KFFFFFFKKKKFFFFFPYK',
    '...KSFFFFFFFFFFFFFMMNK',
    '...KSSFFFFFFFFFFFFMMK.',
    '...KSSGGGGGGGGGGGSSK..',
    '...KDDKK.......KDDDK..',
    '...KKKK........KKKKK..',
  ];
  const POUNCE = [ // 24x11: mid-leap, front paws reaching forward, back legs pushing off
    '..................X...X.',
    '.................KIK.KIK',
    'tt.....KKKKKKKKKKKFFFFFK',
    'tTTt.KKFFFFFFFFFFFFFFWYK',
    '.ttTKFFFFFFFFFFFFFFFFPYK',
    '...KSFFFFFFFFFFFFFFFMMNK',
    '..KSSSGGGGGGGGGGGGSMMMK.',
    '.KDDKKKKKKKKKKKKKKKKDDDK',
    'KDDK...............KDDDK',
    'KKK.................KKKK',
    '........................',
  ];

  // Kept from the old sprite (existing idle animations): yawn-stretch + scratching post.
  // one row taller (body stretched up); the empty tuft row on top makes room
  const STRETCH_TALL = [...YAWN.slice(1, 14), YAWN[13], ...YAWN.slice(14)];
  const POST = (() => {
    const rows = ['.KKKK.'];
    for (let i = 0; i < 16; i++) rows.push(i % 2 ? '.KrrK.' : '.KqqK.');
    rows.push('KbbbbK', 'KKKKKK');
    return rows;
  })();
  const POST_COLORS = { K: '#3b2f2f', q: '#c9a46a', r: '#a88449', b: '#8a6a4a' };
  function scratchRows(armAt) {
    const plain = '.......KFFMMMMFFK...tTTt.';
    const armTop = '.KKKKKKKFFMMMMFFK...tTTt.';
    const arm = 'KDDFFFFFFFMMMMFFK...tTTt.';
    const rows = SIT.slice(0, 12).map((r) => '....' + r);
    for (let y = 12; y <= 16; y++) rows.push(y === armAt || y === armAt + 2 ? armTop : y === armAt + 1 ? arm : plain);
    rows.push('.......KDDKKKKDDK...tTt..', '.......KKKKKKKKKK...tt...');
    return pad(rows, 25);
  }

  // Party hat (7x8) and disco ball (9x11 incl. string): fixed colours.
  const PARTY_HAT = {
    rows: [
      '...w...',
      '..wpw..',
      '...k...',
      '..kyk..',
      '..kpk..',
      '.kyypk.',
      '.kppyk.',
      'kkkkkkk',
    ],
    colors: { k: '#2b2e35', w: '#ffffff', p: '#ff5fa2', y: '#ffd23f' },
  };
  const DISCO_BALL = {
    rows: [
      '....s....',
      '....s....',
      '...kkk...',
      '.kkabakk.',
      '.kbacabk.',
      'kabcabcak',
      'kbcabcabk',
      'kacbacbak',
      '.kbacabk.',
      '.kkabakk.',
      '...kkk...',
    ],
    colors: { s: '#9aa0a8', k: '#3a3f47', a: '#e9eef5', b: '#9fb3c8', c: '#ffffff' },
  };

  // pose -> frame -> rows ; placement + anchors per pose (canvas columns, face, head top)
  const FRAMES = {
    sit: { sit: SIT, blink: SIT_BLINK, wag: wag(SIT), squint: SIT_SQUINT },
    yawn: { yawn: YAWN },
    groom: { a: GROOM_A, b: GROOM_B },
    belly: { a: BELLY },
    sleep: { a: SLEEP, b: [...SLEEP.slice(0, 5), SLEEP[4], ...SLEEP.slice(5)] },
    walk: Object.fromEntries(Object.entries(LEGS).map(([k, legs]) => [k, [...WALK_TOP, ...legs]])),
    crouch: { a: CROUCH_A, b: CROUCH_B },
    pounce: { a: POUNCE },
    stretch: { yawn: YAWN, tall: STRETCH_TALL },
    scratch: { a: scratchRows(12), b: scratchRows(14) },
  };
  const LAYOUT = {
    sit: { col: 7, face: [7.5, 9], whiskers: 'sit' },
    yawn: { col: 7, face: [7.5, 9], whiskers: 'sit' },
    groom: { col: 7, face: [7.5, 9], whiskers: 'groom' },
    stretch: { col: 7, face: [7.5, 9], whiskers: 'sit' },
    belly: { col: 4, face: [3.5, 5], whiskers: 'belly' },
    sleep: { col: 5, face: [3.5, 4], whiskers: 'sleep' },
    walk: { col: 4, face: [18.5, 4.5], whiskers: 'side' },
    crouch: { col: 4, face: [18.5, 4.5], whiskers: 'side' },
    pounce: { col: 3, face: [20.5, 4.5], whiskers: 'pounce' },
    scratch: { col: 3, face: [11.5, 9], whiskers: 'scratch', post: 0 },
  };
  // Whiskers: fine LINES (not sprite pixels), [x1, y1, x2, y2] in cell units relative to
  // the pose grid (cell i spans i..i+1). Drawn ~1/6 of a cell thick in whole screen
  // pixels by whiskerSquares(), so they stay thin and crisp at every size.
  const fan = (x0, x1, y) => [[x0, y - 0.25, x1, y - 1.0], [x0, y + 0.15, x1, y + 0.15], [x0, y + 0.55, x1, y + 1.3]];
  const WHISKERS = {
    sit: [...fan(1.6, -2.6, 10.6), ...fan(13.4, 16.9, 10.6)],
    groom: fan(13.4, 16.9, 10.6),
    scratch: [...fan(5.6, 1.6, 10.6), ...fan(17.4, 20.9, 10.6)],
    belly: fan(0.6, -2.4, 6.6),
    sleep: fan(0.6, -2.4, 5.0).slice(0, 2),
    side: fan(20.6, 24.0, 5.6),
    pounce: fan(22.6, 26.0, 5.6),
  };

  // ---- colours, presets, patterns ---------------------------------------------------
  const PARTS = ['furBase', 'furShade', 'muzzle', 'patchA', 'patchB', 'outline', 'eyes', 'pupils', 'eyeShine',
    'earOuter', 'earInner', 'nose', 'mouth', 'tail', 'paws', 'belly', 'cheeks', 'whiskers'];

  // Gargorl, checked against assets/reference/gargorl.png (see CLAUDE.md for the notes).
  const GARGORL = {
    furBase: '#6d7584', furShade: '#555b68', muzzle: '#8e939e', patchA: '#555b68', patchB: '#8e939e',
    outline: '#2b2e35', eyes: '#bfd35a', pupils: '#1f2226', eyeShine: '#f5f8d8', earOuter: '#6d7584',
    earInner: '#7d7179', nose: '#6f6870', mouth: '#4a4348', tail: '#6d7584', paws: '#656a76',
    belly: '#7f8592', cheeks: '#7f7a86', whiskers: '#d9dbe0',
  };
  const P = (colors, extra = {}) => ({ colors: { ...GARGORL, ...colors }, pattern: 'solid', ears: 'normal', fluffy: false, tufts: false, ...extra });
  const PRESETS = {
    gargorl: { label: 'Gargorl', ...P({}) },
    fainu: { // Fainu: white with orange + black patches (the calico colour pattern)
      label: 'Fainu',
      ...P({ furBase: '#fff6ea', furShade: '#efe4d6', muzzle: '#fff6ea', patchA: '#e8913a', patchB: '#4a4040', outline: '#3b2f2f', eyes: '#8fbf4a',
        earOuter: '#fff6ea', earInner: '#f4a6b8', nose: '#f4a6b8', mouth: '#7a4a52', tail: '#4a4040', paws: '#fff6ea', belly: '#fffaf2', cheeks: '#f7c6cf', whiskers: '#d8cfc4' }, { pattern: 'calico' }),
    },
    orangetabby: {
      label: 'Orange tabby',
      ...P({ furBase: '#e8913a', furShade: '#c97528', muzzle: '#fbe3c4', patchA: '#b5621f', patchB: '#fbe3c4', outline: '#4a2a16', eyes: '#9ccc4a',
        earOuter: '#e8913a', earInner: '#f4a6b8', nose: '#e7838f', mouth: '#7a3a3a', tail: '#e8913a', paws: '#fbe3c4', belly: '#fbe3c4', cheeks: '#f7b0a0', whiskers: '#fff4e4' }, { pattern: 'tabby' }),
    },
    black: {
      label: 'Black cat',
      ...P({ furBase: '#2a2a31', furShade: '#1d1d23', muzzle: '#3a3a43', patchA: '#1d1d23', patchB: '#3a3a43', outline: '#0e0e12', eyes: '#f2c230',
        earOuter: '#2a2a31', earInner: '#6b4f5a', nose: '#4a3a42', mouth: '#5a3a42', tail: '#2a2a31', paws: '#33333b', belly: '#33333b', cheeks: '#4a3a46', whiskers: '#c9c9d1' }),
    },
    white: {
      label: 'White cat',
      ...P({ furBase: '#f7f5f0', furShade: '#e2ded6', muzzle: '#ffffff', patchA: '#e2ded6', patchB: '#ffffff', outline: '#5a5552', eyes: '#62a8e8',
        earOuter: '#f7f5f0', earInner: '#f4b6c2', nose: '#f19aa8', mouth: '#8a5560', tail: '#f7f5f0', paws: '#ffffff', belly: '#ffffff', cheeks: '#f9c9d2', whiskers: '#bdb8b2' }),
    },
    graytabby: {
      label: 'Gray tabby',
      ...P({ furBase: '#9a9ea6', furShade: '#7d8189', muzzle: '#d9dbe0', patchA: '#5f636b', patchB: '#d9dbe0', outline: '#33363c', eyes: '#c9b03a',
        earOuter: '#9a9ea6', earInner: '#d9a3ae', nose: '#c98a95', mouth: '#5a464c', tail: '#9a9ea6', paws: '#d9dbe0', belly: '#d9dbe0', cheeks: '#d9b0b8', whiskers: '#f1f2f4' }, { pattern: 'tabby' }),
    },
    siamese: {
      label: 'Siamese',
      ...P({ furBase: '#f1e6d2', furShade: '#e0d1b8', muzzle: '#f6eee0', patchA: '#5b4537', patchB: '#f6eee0', outline: '#3a2c24', eyes: '#4f8fe8',
        earOuter: '#5b4537', earInner: '#7a5d4c', nose: '#4a3a32', mouth: '#5a3a32', tail: '#5b4537', paws: '#5b4537', belly: '#f6eee0', cheeks: '#e9c4b8', whiskers: '#f1e6d2' }, { pattern: 'points' }),
    },
    tuxedo: {
      label: 'Tuxedo',
      ...P({ furBase: '#25252b', furShade: '#1a1a1f', muzzle: '#f5f5f2', patchA: '#1a1a1f', patchB: '#f5f5f2', outline: '#0e0e12', eyes: '#9ccc4a',
        earOuter: '#25252b', earInner: '#c98a95', nose: '#e7838f', mouth: '#5a3a42', tail: '#25252b', paws: '#f5f5f2', belly: '#f5f5f2', cheeks: '#3a2f36', whiskers: '#f5f5f2' }, { pattern: 'tuxedo' }),
    },
    // the earlier breeds stay available
    british: { label: 'British Shorthair', ...P({ furBase: '#7f8c9b', furShade: '#6c7886', muzzle: '#9ba7b4', outline: '#2c313a', eyes: '#e08a2c', earOuter: '#7f8c9b', earInner: '#c79aa5', nose: '#8d7380', tail: '#7f8c9b', paws: '#8a96a4', belly: '#9ba7b4', cheeks: '#9ba7b4' }, { ears: 'small', fluffy: true }) },
    ragdoll: { label: 'Ragdoll', ...P({ furBase: '#efe3cf', furShade: '#e0d2bb', muzzle: '#fbf6ee', patchA: '#6b5444', outline: '#3e3129', eyes: '#5b9bf0', earOuter: '#6b5444', earInner: '#7a5d4c', nose: '#c98e96', tail: '#6b5444', paws: '#fbf6ee', belly: '#fbf6ee', cheeks: '#fbf6ee' }, { pattern: 'points', fluffy: true }) },
    mainecoon: { label: 'Maine Coon', ...P({ furBase: '#8b5a33', furShade: '#734a2a', muzzle: '#efe0c8', patchA: '#553520', outline: '#2e2018', eyes: '#c2bb3a', earOuter: '#8b5a33', earInner: '#e0a0a8', nose: '#b86b6b', tail: '#8b5a33', paws: '#efe0c8', belly: '#efe0c8', cheeks: '#d9c2a0' }, { pattern: 'tabby', fluffy: true, tufts: true }) },
    scottishfold: { label: 'Scottish Fold', ...P({ furBase: '#bfc3cb', furShade: '#a9adb6', muzzle: '#eef0f3', patchA: '#8e939d', outline: '#3a3d45', eyes: '#e6a23c', earOuter: '#bfc3cb', earInner: '#e8b0bb', nose: '#d4919c', tail: '#bfc3cb', paws: '#eef0f3', belly: '#eef0f3', cheeks: '#e6c9cf' }, { pattern: 'tabby', ears: 'fold' }) },
    persian: { label: 'Persian', ...P({ furBase: '#f5ede2', furShade: '#e6dccd', muzzle: '#fffdf9', outline: '#5a4a46', eyes: '#d97f2e', earOuter: '#f5ede2', earInner: '#f1b8c1', nose: '#e89aa6', tail: '#f5ede2', paws: '#fffdf9', belly: '#fffdf9', cheeks: '#f6cdd3' }, { ears: 'small', fluffy: true }) },
  };
  // Each look comes with its own description (used for cats without a hand-written one).
  // {They}/{they}/{them}/{their}/{s} are filled with the cat's pronouns.
  const PRESET_DESCRIPTIONS = {
    gargorl: 'A soft blue-gray shorthair with bright yellow-green eyes. Quiet, gentle and always watching.',
    fainu: 'A tiny calico tornado: orange, black and white, and sure that every box in the house belongs to {them}.',
    orangetabby: 'An orange tabby with a big appetite and an even bigger purr. {They} believe{s} dinner is always late.',
    black: 'A sleek black cat with golden eyes. Lucky, mysterious and mostly made of naps.',
    white: 'A snow-white cat with sky-blue eyes. {They} keep{s} {their} fur spotless and {their} opinions loud.',
    graytabby: 'A gray tabby with stripes for days, curious about every cupboard and every crinkly bag.',
    siamese: 'A chatty Siamese with blue eyes. {They} will tell you all about {their} day, at length.',
    tuxedo: 'Dressed for a gala at all times: a dapper tuxedo cat with white mittens.',
    british: 'A round-faced British Shorthair. Calm, chunky and very serious about cushions.',
    ragdoll: 'A fluffy Ragdoll who goes limp in your arms. Blue eyes, big heart, zero bones.',
    mainecoon: 'A gentle giant with tufted ears and a lion\'s ruff. {They} purr{s} like a tractor.',
    scottishfold: 'Folded ears and an owl face. {They} sit{s} like a little person and judge{s} quietly.',
    persian: 'A cloud of white fur with a sweet, sleepy face. {They} only move{s} for treats.',
  };
  for (const [id, d] of Object.entries(PRESET_DESCRIPTIONS)) if (PRESETS[id]) PRESETS[id].description = d;

  const PATTERNS = ['solid', 'tabby', 'tuxedo', 'calico', 'spots', 'points'];

  // Pattern overlay: which fur pixels (F/S/T/V) become patch A / patch B.
  function patternAt(pattern, x, y, w, h, face, ch) {
    switch (pattern) {
      case 'tabby': // stripes across the body, an "M" on the forehead
        return (y + Math.floor(x / 3)) % 3 === 0 ? 'A' : null;
      case 'tuxedo': // dark body, white bib + lower face
        return Math.hypot(x - face[0], (y - face[1] - 2) * 1.2) <= 2.6 ? 'B' : null;
      case 'calico': // orange left, dark right, white middle (the old calico)
        return x / w < 0.36 ? 'A' : x / w > 0.64 ? 'B' : null;
      case 'spots':
        return ((x * 7 + y * 13) % 11 === 0) ? 'A' : null;
      case 'points': // colourpoint mask around the face (Siamese / Ragdoll)
        return Math.hypot(x - face[0], (y - face[1]) * 1.3) <= 2.9 ? 'A' : null;
      default:
        return null;
    }
  }

  // look: { colors, pattern, ears, fluffy, tufts, tail: bool, whiskers: bool, lookDx }
  // place: { dx, dy } in cells (dx right, dy UP; negative dy sinks her, e.g. into a box)
  // returns a CANVAS.rows x CANVAS.cols array of colours (or null)
  function render(pose, frame, look, facing = 1, place) {
    const pdx = (place && place.dx) || 0;
    const pdy = (place && place.dy) || 0;
    const L = { ...PRESETS.gargorl, tail: true, whiskers: true, lookDx: 0, ...look };
    const c = { ...GARGORL, ...(L.colors || {}) };
    const lay = LAYOUT[pose] || LAYOUT.sit;
    let rows = (FRAMES[pose] || FRAMES.sit)[frame] || Object.values(FRAMES[pose] || FRAMES.sit)[0];
    if ((pose === 'sit') && L.lookDx) rows = setCells(rows, lookEdits(L.lookDx));
    if (pose === 'sit' && L.mood === 'sad' && frame !== 'squint') rows = setCells(rows, sadEdits());
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const out = Array.from({ length: CANVAS.rows }, () => Array(CANVAS.cols).fill(null));
    const top = CANVAS.rows - h - pdy;
    const firstRow = (ch) => rows.findIndex((r) => r.includes(ch));
    const tipRow = firstRow('X');
    const earRow = firstRow('I');
    const put = (gx, gy, col) => {
      if (gx >= 0 && gx < CANVAS.cols && gy >= 0 && gy < CANVAS.rows) out[gy][gx] = col;
    };
    const X = (x) => pdx + (facing === -1 ? lay.col + (w - 1 - x) : lay.col + x);

    if (lay.post !== undefined) {
      POST.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') put(lay.post + x, CANVAS.rows - POST.length + y, POST_COLORS[ch]); }));
    }
    const fur = (x, y, ch) => {
      const p = patternAt(L.pattern, x, y, w, h, lay.face, ch);
      if (p === 'A') return c.patchA;
      if (p === 'B') return c.patchB;
      return ch === 'S' ? c.furShade : c.furBase;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        let col = null;
        switch (ch) {
          case '.': break;
          case 'K': col = c.outline; break;
          case 'F': case 'S': col = fur(x, y, ch); break;
          case 'M': col = c.muzzle; break;
          case 'G': col = c.belly; break;
          case 'C': col = c.cheeks; break;
          case 'Y': col = c.eyes; break;
          case 'P': col = c.pupils; break;
          case 'W': col = c.eyeShine; break;
          case 'U': col = L.ears === 'fold' ? fur(x, y, 'F') : c.earOuter; break;
          case 'I': col = L.ears === 'fold' ? (y === earRow ? c.outline : c.earOuter) : c.earInner; break;
          case 'N': col = c.nose; break;
          case 'O': col = c.mouth; break;
          case 'D': col = c.paws; break;
          case 'X':
            if (L.ears === 'fold' || (L.ears === 'small' && y === tipRow)) break;
            col = c.outline; break;
          case 'Q': if (L.tufts && L.ears !== 'fold') col = c.outline; break;
          case 'Z': if (L.fluffy) col = c.muzzle; break;
          case 'T': if (L.tail) col = L.pattern === 'calico' ? c.patchB : L.pattern === 'points' ? c.patchA : (L.pattern === 'tabby' && x % 2 ? c.patchA : c.tail); break;
          case 't': if (L.tail) col = c.outline; break;
          case 'V': col = L.tail ? (L.pattern === 'calico' ? c.patchB : L.pattern === 'points' ? c.patchA : c.tail) : fur(x, y, 'F'); break;
          default: throw new Error(`catsprite: unknown letter "${ch}" in ${pose}/${frame} at ${x},${y}`);
        }
        if (col !== null) put(X(x), top + y, col);
      }
    }
    return out;
  }

  // Whisker lines for a pose, in canvas cell units (placed + flipped like the sprite).
  // [] when whiskers are off. Draw with whiskerSquares().
  function whiskerLines(pose, frame, look, facing = 1, place) {
    const L = { whiskers: true, ...look };
    if (!L.whiskers) return [];
    const lay = LAYOUT[pose] || LAYOUT.sit;
    const rows = (FRAMES[pose] || FRAMES.sit)[frame] || Object.values(FRAMES[pose] || FRAMES.sit)[0];
    const w = Math.max(...rows.map((r) => r.length));
    const top = CANVAS.rows - rows.length - ((place && place.dy) || 0);
    const pdx = (place && place.dx) || 0;
    const fx = (x) => pdx + (facing === -1 ? lay.col + (w - x) : lay.col + x);
    // clip the outer tip to the canvas (some mirrored poses sit close to the edge)
    const cx = (x) => Math.min(CANVAS.cols - 0.25, Math.max(0.25, x));
    const cy = (y) => Math.min(CANVAS.rows - 0.25, Math.max(0.25, y));
    return (WHISKERS[lay.whiskers] || []).map(([x1, y1, x2, y2]) => [cx(fx(x1)), cy(top + y1), cx(fx(x2)), cy(top + y2)]);
  }

  // Thin pixel-art line: squares of t whole screen pixels stepped along each segment.
  // cell = screen px per sprite cell. Returns [px, py, t] squares (no anti-aliasing).
  function whiskerSquares(lines, cell) {
    const t = Math.max(1, Math.round(cell / 6));
    const out = [];
    const seen = new Set();
    for (const [x1, y1, x2, y2] of lines) {
      const ax = x1 * cell, ay = y1 * cell, bx = x2 * cell, by = y2 * cell;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / t));
      for (let i = 0; i <= n; i++) {
        const px = Math.round(ax + ((bx - ax) * i) / n - t / 2);
        const py = Math.round(ay + ((by - ay) * i) / n - t / 2);
        const k = `${Math.round(px / t)},${Math.round(py / t)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([px, py, t]);
      }
    }
    return out;
  }

  // Nose area in canvas cells (sitting, facing us), padded one cell for an easy boop.
  function noseRect(pose) {
    if (pose !== 'sit') return null;
    const top = CANVAS.rows - SIT.length;
    return { x: LAYOUT.sit.col + 7 - 1, y: top + 10 - 1, w: 4, h: 3 };
  }

  // ---- sleeping spots (Stage E) ---------------------------------------------------
  // Each spot has a BACK layer (drawn before the cat), a FRONT layer (drawn after her, so
  // she lies IN the bed / box) and optional overlay cells (her paw over the box edge, her
  // tail hanging off the cat tree) in her own colours. Recolourable parts are per cat in
  // settings "sleepSpotColors".
  const SPOT_PARTS = {
    bed: ['bedCushion', 'bedRim'],
    tree: ['treeCarpet', 'treePostWrap', 'treeTrim'],
    box: ['boxCardboard', 'boxInside', 'boxTape', 'boxLabel'],
  };
  const SPOT_DEFAULT_COLORS = {
    bedCushion: '#f3d7a6', bedRim: '#6b8fd6',
    treeCarpet: '#c9b79c', treePostWrap: '#d8b26e', treeTrim: '#8a6a4a',
    boxCardboard: '#c8955a', boxInside: '#7a5a35', boxTape: '#e6d3a3', boxLabel: '#f5f1e6',
  };
  const SPOT_LABELS = {
    bedCushion: 'Cushion', bedRim: 'Rim', treeCarpet: 'Carpet', treePostWrap: 'Post wrap', treeTrim: 'Platform trim',
    boxCardboard: 'Cardboard', boxInside: 'Inside', boxTape: 'Tape', boxLabel: 'Label',
  };
  function shade(hex, k = 0.78) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  const SPOT_OUTLINE = '#3b2f2f';
  const SPOTS = {
    bed: { // round cushion bed with a rim, 24 x 7, she curls up in it
      col: 3,
      rows: [
        '....KKKKKKKKKKKKKKKK....',
        '..KKRRRRRRRRRRRRRRRRKK..',
        '.KRRRCCCCCCCCCCCCCCRRRK.',
        'KRRCCCCCCCCCCCCCCCCCCRRK',
        'KRRRRRRRRRRRRRRRRRRRRRRK',
        'KrrRRRRRRRRRRRRRRRRRRrrK',
        '.KKKKKKKKKKKKKKKKKKKKKK.',
      ],
      frontFrom: 4,
      colors: (c) => ({ K: SPOT_OUTLINE, R: c.bedRim, r: shade(c.bedRim), C: c.bedCushion }),
    },
    tree: { // small carpeted cat tree: top platform, wrapped post, hanging toy, base. 22 x 17
      col: 4,
      rows: [
        '..KKKKKKKKKKKKKKKKKK..',
        '.KCCCCCCCCCCCCCCCCCCK.',
        '.KTTTTTTTTTTTTTTTTTTK.',
        '..KKKKKKKKKKKKKKKKKK..',
        '........KWWK.....s....',
        '........KwwK.....s....',
        '........KWWK.....s....',
        '........KwwK....KyK...',
        '........KWWK....KyK...',
        '........KwwK.....K....',
        '........KWWK..........',
        '........KwwK..........',
        '........KWWK..........',
        '........KwwK..........',
        '....KKKKKKKKKKKKKK....',
        '...KCCCCCCCCCCCCCCK...',
        '...KKKKKKKKKKKKKKKK...',
      ],
      frontFrom: 99, // all of it is behind her
      colors: (c) => ({ K: SPOT_OUTLINE, C: c.treeCarpet, T: c.treeTrim, W: c.treePostWrap, w: shade(c.treePostWrap), y: '#ff6b8b', s: '#d9d2c5' }),
      // her tail hanging over the platform edge (tree coords)
      overlay: (L) => [[18, 1, 'K'], [19, 1, 'T'], [20, 1, 'K'], [18, 2, 'K'], [19, 2, 'T'], [20, 2, 'K'], [18, 3, 'K'], [19, 3, 'T'], [20, 3, 'K'],
        [18, 4, 'K'], [19, 4, 'T'], [20, 4, 'K'], [19, 5, 'K']].map(([x, y, ch]) => [x, y, ch === 'T' ? tailColor(L) : L.colors.outline]),
    },
    box: { // classic open-top cardboard box: flaps, dark inside, tape, shipping label, shadow. 20 x 11
      col: 5,
      rows: [
        'FF................FF',
        'FFFKKKKKKKKKKKKKKFFF',
        '.KIIIIIIIIIIIIIIIIK.',
        '.KIIIIIIIIIIIIIIIIK.',
        'KBBBBBBBBBBBBBBBBBBK',
        'KBBBBBBPPPPBBBBBBBBK',
        'KBBBBBBPPPPBBBLLLLBK',
        'KBBBBBBPPPPBBBLllLBK',
        'KbbbbbbPPPPbbbbbbbbK',
        'KKKKKKKKKKKKKKKKKKKK',
        '.SSSSSSSSSSSSSSSSSS.',
      ],
      frontFrom: 4,
      colors: (c) => ({ K: SPOT_OUTLINE, B: c.boxCardboard, b: shade(c.boxCardboard), F: shade(c.boxCardboard, 0.88), I: c.boxInside, P: c.boxTape, L: c.boxLabel, l: '#8a7a6a', S: 'rgba(40,30,25,0.28)' }),
      // a paw resting over the front edge (box coords)
      overlay: (L) => [[6, 3, 'K'], [7, 3, 'D'], [8, 3, 'D'], [9, 3, 'K'], [6, 4, 'K'], [7, 4, 'D'], [8, 4, 'D'], [9, 4, 'K'], [7, 5, 'K'], [8, 5, 'K']]
        .map(([x, y, ch]) => [x, y, ch === 'D' ? L.colors.paws : L.colors.outline]),
    },
  };
  function tailColor(L) {
    const c = L.colors;
    return L.pattern === 'calico' ? c.patchB : L.pattern === 'points' ? c.patchA : c.tail;
  }
  // Where she lies on / in each spot (place.dy = cells up from the floor; negative = down)
  const SPOT_CAT = {
    none: { pose: 'sleep', frames: ['a', 'b'], place: { dy: 0 } },
    bed: { pose: 'sleep', frames: ['a', 'b'], place: { dy: 2 } },
    tree: { pose: 'sleep', frames: ['a', 'b'], place: { dy: 16 }, overlay: true },
    box: { pose: 'sit', frames: ['blink', 'blink'], place: { dy: -5 }, overlay: true }, // only ears + top of head show
  };
  const SPOT_IDS = Object.keys(SPOTS);

  function withAlpha(col, a) {
    if (a >= 1 || !col) return col;
    if (col.startsWith('rgba')) return col.replace(/[\d.]+\)$/, (m) => `${(parseFloat(m) * a).toFixed(3)})`);
    const n = parseInt(col.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  // Cells [x, y, colour] of one layer ('back' | 'front') of a spot, on the canvas.
  function spotCells(spot, layer, spotColors, alpha = 1) {
    const S = SPOTS[spot];
    if (!S) return [];
    const cmap = S.colors({ ...SPOT_DEFAULT_COLORS, ...(spotColors || {}) });
    const top = CANVAS.rows - S.rows.length;
    const out = [];
    S.rows.forEach((r, y) => {
      if ((layer === 'front') !== (y >= S.frontFrom)) return;
      [...r].forEach((ch, x) => { if (ch !== '.') out.push([S.col + x, top + y, withAlpha(cmap[ch], alpha)]); });
    });
    return out;
  }

  // A whole scene: spot back -> cat -> (whiskers) -> spot front + overlay.
  // o: { pose, frame, look, facing, place, spot, spotColors, spotAlpha, overlay }
  // returns { under, over } colour grids, the whisker lines and catBox (VISIBLE cat cells).
  function renderScene(o) {
    const blank = () => Array.from({ length: CANVAS.rows }, () => Array(CANVAS.cols).fill(null));
    const under = blank();
    const over = blank();
    let clipped = 0;
    const paint = (g, cells) => cells.forEach(([x, y, c]) => {
      if (x >= 0 && x < CANVAS.cols && y >= 0 && y < CANVAS.rows) g[y][x] = c;
      else clipped += 1;
    });
    const spot = o.spot && SPOTS[o.spot] ? o.spot : null;
    const alpha = o.spotAlpha === undefined ? 1 : o.spotAlpha;
    if (spot) paint(under, spotCells(spot, 'back', o.spotColors, alpha));
    const L = { ...PRESETS.gargorl, tail: true, whiskers: true, lookDx: 0, ...o.look };
    const cat = render(o.pose, o.frame, L, o.facing || 1, o.place);
    cat.forEach((row, y) => row.forEach((c, x) => { if (c) under[y][x] = c; }));
    if (spot) {
      paint(over, spotCells(spot, 'front', o.spotColors, alpha));
      if (o.overlay && SPOTS[spot].overlay && alpha >= 1) {
        const top = CANVAS.rows - SPOTS[spot].rows.length;
        paint(over, SPOTS[spot].overlay(L).map(([x, y, c]) => [SPOTS[spot].col + x, top + y, c]));
      }
    }
    const visible = cat.map((row, y) => row.map((c, x) => (c && !over[y][x] ? c : null)));
    // Accessories + seasonal outfit (Stage 8): over the cat, under a spot's front edge and
    // under the party hat (which also hides head items). Not part of the hit area.
    let tag = null;
    let accClipped = 0;
    if (o.accessories || o.seasonal) {
      const acc = accessoryCells(o.pose, o.frame, o.facing || 1, o.place, o);
      const before = clipped;
      paint(under, acc.cells);
      accClipped = clipped - before;
      tag = acc.tag;
    }
    // Party hat (Stage 5): on her forehead in every pose, painted over the cat but under
    // a spot's front (in the box only its tip shows). Not part of the hit area.
    let hatBox = null;
    if (o.hat) {
      const at = hatPlace(o.pose, o.frame, o.facing || 1, o.place, cat);
      if (at) {
        const hat = renderProp('hat');
        hat.forEach((row, y) => row.forEach((c, x) => {
          const gx = at.x + x;
          const gy = at.y + y;
          if (c && gx >= 0 && gx < CANVAS.cols && gy >= 0 && gy < CANVAS.rows) under[gy][gx] = c;
        }));
        hatBox = { x: at.x, y: at.y, w: hat[0].length, h: hat.length };
      }
    }
    return { under, over, whiskers: whiskerLines(o.pose, o.frame, L, o.facing || 1, o.place), catBox: bbox(visible), hatBox, tag, accClipped, clipped };
  }

  // --- Accessories + seasonal outfits (Stage 8) ---------------------------------------
  // Anchors per pose (canvas cells, facing right, no `place`): head = centre x + forehead
  // row, earR = right ear base, eyes = centre (+ side view), neck = band centre
  // (h = horizontal band, v = vertical band, len cells).
  const SIT_ANCH = { head: [14.5, 12], earR: [19, 10], eyes: [14.5, 16, false], neck: [14.5, 20, 'h', 10] };
  const ANCHORS = {
    sit: SIT_ANCH, yawn: SIT_ANCH, groom: SIT_ANCH, scratch: SIT_ANCH,
    'stretch/yawn': SIT_ANCH,
    'stretch/tall': { head: [14.5, 11], earR: [19, 9], eyes: [14.5, 15, false], neck: [14.5, 19, 'h', 10] },
    belly: { head: [7.5, 18], earR: [8, 17], eyes: [7.5, 21, 'small'], neck: [11, 21.5, 'v', 4] },
    sleep: { head: [8.5, 19], earR: [10, 18], eyes: [9, 21, 'small'], neck: [13, 21.5, 'v', 4] },
    walk: { head: [21.5, 16], earR: [23, 14], eyes: [24, 17.5, true], neck: [17, 19.5, 'v', 4] },
    crouch: { head: [21.5, 19], earR: [23, 17], eyes: [24, 20.5, true], neck: [17, 21.5, 'v', 4] },
    pounce: { head: [23, 18], earR: [25, 16], eyes: [25, 19.5, true], neck: [19, 19.5, 'v', 4] },
  };
  // Items: slot + default colours (a = main, b = second); grids use a / b / K / w.
  const ACCESSORIES = {
    bow: { label: 'Bow', slot: 'ear', colors: { a: '#ff5fa2', b: '#c2185b' } },
    glasses: { label: 'Glasses', slot: 'eyes', colors: { a: '#3b2f2f' } },
    sunglasses: { label: 'Sunglasses', slot: 'eyes', colors: { a: '#1d1d22', b: '#3a3550' } },
    crown: { label: 'Crown', slot: 'head', colors: { a: '#ffd23f', b: '#ff5f7e' } },
    scarf: { label: 'Scarf', slot: 'neck', colors: { a: '#e8913a', b: '#fff6ea' } },
    bandana: { label: 'Bandana', slot: 'neck', colors: { a: '#d6457a', b: '#ffffff' } },
    bell: { label: 'Bell collar', slot: 'neck', colors: { a: '#c0392b', b: '#ffd23f' } },
    nametag: { label: 'Collar with name tag', slot: 'neck', colors: { a: '#5fb4e8', b: '#ffd23f' } },
  };
  const SEASONAL = {
    santa: { label: 'Santa hat', slot: 'head', colors: { a: '#d32f2f', b: '#ffffff' } },
    bunny: { label: 'Bunny ears', slot: 'head', colors: { a: '#ffffff', b: '#f4a6b8', c: '#b07bff' } },
    witch: { label: 'Witch hat', slot: 'head', colors: { a: '#2b2533', b: '#8e5ea8' } },
    heartpin: { label: 'Heart pin', slot: 'chest', colors: { a: '#ff5f7e', b: '#ffd1dc' } },
  };
  const ACC_IDS = Object.keys(ACCESSORIES);
  const SEASONAL_IDS = Object.keys(SEASONAL);
  const HEX6 = /^#[0-9a-f]{6}$/;
  // { id: { on, colors: { a, b } } } -> only known items + valid colours (per cat, Customize)
  function cleanAccessories(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const id of ACC_IDS) {
      const v = raw[id];
      if (!v || typeof v !== 'object') continue;
      const colors = {};
      for (const k of Object.keys(ACCESSORIES[id].colors)) {
        const c = v.colors && typeof v.colors[k] === 'string' ? v.colors[k].toLowerCase() : '';
        if (HEX6.test(c)) colors[k] = c;
      }
      out[id] = { on: v.on === true, colors };
    }
    return out;
  }
  // Which seasonal outfit fits a date (or null): Santa all December, a heart pin 7-14 Feb,
  // bunny ears a week either side of Easter Sunday, a witch hat 24 Oct - 1 Nov.
  function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), gg = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - gg + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
  function seasonalFor(date) {
    const m = date.getMonth();
    const d = date.getDate();
    if (m === 11) return 'santa';
    if (m === 1 && d >= 7 && d <= 14) return 'heartpin';
    if ((m === 9 && d >= 24) || (m === 10 && d === 1)) return 'witch';
    const e = easterSunday(date.getFullYear());
    const days = Math.round((new Date(date.getFullYear(), m, d) - e) / 86400000);
    if (days >= -7 && days <= 7) return 'bunny';
    return null;
  }

  // Grids (facing right). Letters: a / b / c = item colours, K = outline, w = white.
  const ITEM_GRIDS = {
    bow: ['aa.aa', 'abKba', 'aa.aa'],
    crown: ['a..a..a', 'aa.a.aa', 'abababa', 'aaaaaaa'],
    // front glasses frame each 3x3 eye (eyes at x 10-12 / 17-19, rows 15-17 when sitting)
    glassesFront: ['aaaaa..aaaaa', 'a...aaaa...a', 'a...a..a...a', 'a...a..a...a', 'aaaaa..aaaaa'],
    sunglassesFront: ['aaaaa..aaaaa', 'abbbaaaabbba', 'abbba..abbba', 'abbba..abbba', 'aaaaa..aaaaa'],
    glassesSide: ['..aaa', 'aaa.a', '..aaa'],
    sunglassesSide: ['..aaa', 'aaaba', '..aaa'],
    glassesSmall: ['aaaaaa', 'a.aa.a', 'aaaaaa'], // the smaller face when lying down
    sunglassesSmall: ['aaaaaa', 'abaaba', 'aaaaaa'],
    santa: ['.....bb', '....aab', '...aaa.', '..aaaa.', '.aaaaa.', 'bbbbbbb'],
    witch: ['....K....', '....a....', '...aaa...', '...bbb...', '..aaaaa..', 'aaaaaaaaa'],
    bunny: ['.a.....a.', 'aba...aba', 'aba...aba', 'aba...aba', '.a.....a.', 'ccccccccc'],
    heartpin: ['a.a', 'aba', '.a.'],
  };
  const SEASONAL_GRID = { santa: 'santa', witch: 'witch', bunny: 'bunny', heartpin: 'heartpin' };

  // Cells of all worn items for a pose: [[x, y, colour], ...] (+ the name tag box for text).
  function accessoryCells(pose, frame, facing, place, o) {
    const A = ANCHORS[`${pose}/${frame}`] || ANCHORS[pose];
    if (!A) return { cells: [], tag: null };
    const lay = LAYOUT[pose] || LAYOUT.sit;
    const rows = (FRAMES[pose] || FRAMES.sit)[frame] || Object.values(FRAMES[pose] || FRAMES.sit)[0];
    const w = Math.max(...rows.map((r) => r.length));
    const pdx = (place && place.dx) || 0;
    const pdy = (place && place.dy) || 0;
    // canvas x for facing right -> this facing (mirrored around the frame)
    const fx = (x) => pdx + (facing === -1 ? 2 * lay.col + w - 1 - x : x);
    const fy = (y) => y - pdy;
    const cells = [];
    let tag = null;
    const stamp = (grid, colors, x0, y0) => { // x0, y0: top-left for facing right
      grid.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === '.') return;
        const col = ch === 'K' ? '#2b2e35' : ch === 'w' ? '#ffffff' : colors[ch];
        if (!col) return;
        cells.push([Math.round(fx(x0 + x)), Math.round(fy(y0 + y)), col]); // fx mirrors for facing left
      }));
    };
    const acc = o.accessories || {};
    const colorsOf = (id) => ({ ...ACCESSORIES[id].colors, ...((acc[id] && acc[id].colors) || {}) });
    const on = (id) => acc[id] && acc[id].on;
    const headBlocked = !!o.hat || o.spot === 'box'; // party hat wins; in the box only the ears show
    // neck (band first, so the extras sit on top)
    const [nx, ny, dir, len] = A.neck;
    const band = (col, thick = 1) => {
      for (let i = 0; i < len; i++) {
        for (let t = 0; t < thick; t++) {
          if (dir === 'h') cells.push([fx(Math.round(nx - len / 2 + 0.5) + i), fy(ny + t), col]);
          else cells.push([fx(nx + t), fy(Math.round(ny - len / 2 + 0.5) + i), col]);
        }
      }
    };
    // "under the chin": below a horizontal band, under the bottom end of a vertical one
    const below = dir === 'h' ? (dx, dy) => [nx - 0.5 + dx, ny + 1 + dy] : (dx, dy) => [nx + Math.sign(dx), ny + len / 2 + dy];
    for (const id of ['scarf', 'bandana', 'bell', 'nametag']) {
      if (!on(id)) continue;
      const c = colorsOf(id);
      if (id === 'scarf') {
        band(c.a, 2);
        for (let i = 0; i < len; i += 2) cells.push(dir === 'h' ? [fx(Math.round(nx - len / 2 + 0.5) + i), fy(ny), c.b] : [fx(nx), fy(Math.round(ny - len / 2 + 0.5) + i), c.b]);
        // the loose end
        for (let t = 0; t < 3; t++) {
          const [ex, ey] = dir === 'h' ? [nx + 2.5, ny + 2 + t] : [nx - 1, ny + 1.5 + t];
          cells.push([fx(Math.round(ex)), fy(Math.round(ey)), t % 2 ? c.b : c.a], [fx(Math.round(ex) + 1), fy(Math.round(ey)), c.a]);
        }
      } else {
        band(c.a);
        if (id === 'bandana') {
          const rowsN = dir === 'h' ? 3 : 2;
          for (let r = 1; r <= rowsN; r++) {
            const half = dir === 'h' ? Math.max(0, Math.floor((len - 2 * r) / 2)) : rowsN - r;
            for (let k = -half; k <= half; k++) {
              const [bx, by] = dir === 'h' ? [nx - 0.5 + k, ny + r] : [nx + k, ny + len / 2 - 0.5 + r];
              cells.push([fx(Math.round(bx)), fy(Math.round(by)), (r + k) % 3 === 0 ? c.b : c.a]);
            }
          }
        }
        if (id === 'bell' || id === 'nametag') {
          const [bx, by] = below(0, 0);
          const grid = id === 'bell' ? ['bbb', '.b.'] : ['bbbb', 'bbbb', 'bbbb'];
          const gx = Math.round(bx - (grid[0].length - 1) / 2);
          stamp(grid, c, gx, Math.round(by));
          if (id === 'nametag') tag = { x: Math.min(fx(gx), fx(gx + grid[0].length - 1)), y: fy(Math.round(by)), w: grid[0].length, h: grid.length, text: (o.catName || '').trim() };
        }
      }
    }
    // chest pin (seasonal heart)
    if (o.seasonal === 'heartpin') {
      // under the chin when sitting; beside the neck when lying / walking (stays on the canvas)
      const [px, py] = dir === 'h' ? below(-3, 1) : [nx - 2, ny - 1];
      stamp(ITEM_GRIDS.heartpin, SEASONAL.heartpin.colors, Math.round(px - 1), Math.round(py));
    }
    // eyes
    for (const id of ['glasses', 'sunglasses']) {
      if (!on(id)) continue;
      const [ex, ey, side] = A.eyes;
      const grid = ITEM_GRIDS[`${id}${side === 'small' ? 'Small' : side ? 'Side' : 'Front'}`];
      const gx = side === true ? Math.round(ex) - grid[0].length + 2 : Math.round(ex - (grid[0].length - 1) / 2);
      stamp(grid, colorsOf(id), gx, Math.round(ey - (grid.length - 1) / 2));
    }
    // head + ear
    if (!headBlocked) {
      const [hx, hy] = A.head;
      if (on('crown')) stamp(ITEM_GRIDS.crown, colorsOf('crown'), Math.round(hx - 3), hy - 3);
      const s = o.seasonal && SEASONAL[o.seasonal] && SEASONAL[o.seasonal].slot === 'head' ? o.seasonal : null;
      if (s) {
        const grid = ITEM_GRIDS[SEASONAL_GRID[s]];
        stamp(grid, SEASONAL[s].colors, Math.round(hx - (grid[0].length - 1) / 2), hy - grid.length + 1);
      }
      if (on('bow')) {
        const [bx, by] = A.earR;
        stamp(ITEM_GRIDS.bow, colorsOf('bow'), bx - 2, by);
      }
    }
    return { cells, tag };
  }

  // Where the party hat goes: centred on the head column (the face anchor of the pose),
  // its brim on the first cat cell from the top in that column (the forehead).
  function hatPlace(pose, frame, facing, place, catGrid) {
    const lay = LAYOUT[pose] || LAYOUT.sit;
    const rows = (FRAMES[pose] || FRAMES.sit)[frame] || Object.values(FRAMES[pose] || FRAMES.sit)[0];
    const w = Math.max(...rows.map((r) => r.length));
    const fx = Math.round(lay.face[0]);
    const hc = ((place && place.dx) || 0) + (facing === -1 ? lay.col + (w - 1 - fx) : lay.col + fx);
    let top = -1;
    for (let y = 0; y < CANVAS.rows && top < 0; y++) {
      for (let x = hc - 1; x <= hc + 1; x++) if (catGrid[y] && catGrid[y][x]) { top = y; break; }
    }
    if (top < 0) return null;
    const hat = PARTY_HAT.rows;
    return { x: hc - Math.floor(hat[0].length / 2), y: top - hat.length + 1 };
  }

  // Pixel heart for petting (fixed colours).
  const HEART = {
    rows: [
      '.kk.kk.',
      'kwpkppk',
      'kpppppk',
      '.kpppk.',
      '..kpk..',
      '...k...',
    ],
    colors: { k: '#7a2338', p: '#ff6b8b', w: '#ffd1dc' },
  };

  function renderProp(prop) {
    if (prop === 'heart') return HEART.rows.map((r) => [...r].map((ch) => (ch === '.' ? null : HEART.colors[ch])));
    const p = prop === 'hat' ? PARTY_HAT : DISCO_BALL;
    return p.rows.map((r) => [...r].map((ch) => (ch === '.' ? null : p.colors[ch])));
  }

  function bbox(grid) {
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    grid.forEach((row, y) => row.forEach((v, x) => {
      if (!v) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }));
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function validate() {
    const problems = [];
    for (const [pose, frames] of Object.entries(FRAMES)) {
      for (const [frame, rows] of Object.entries(frames)) {
        const w = rows[0].length;
        rows.forEach((r, y) => { if (r.length !== w) problems.push(`${pose}/${frame} row ${y}: ${r.length} != ${w}`); });
        if (rows.length > CANVAS.rows) problems.push(`${pose}/${frame}: ${rows.length} rows > ${CANVAS.rows}`);
        if (LAYOUT[pose].col + w > CANVAS.cols) problems.push(`${pose}/${frame}: too wide (${LAYOUT[pose].col}+${w})`);
        for (const [id, preset] of Object.entries(PRESETS)) for (const tail of [true, false]) for (const f of [1, -1]) {
          try { render(pose, frame, { ...preset, tail }, f); } catch (err) { problems.push(`${id}: ${err.message}`); }
        }
      }
    }
    for (const prop of [PARTY_HAT, DISCO_BALL]) {
      const w = prop.rows[0].length;
      prop.rows.forEach((r, y) => { if (r.length !== w) problems.push(`prop row ${y} width`); });
    }
    return problems;
  }

  const api = {
    CANVAS, PARTS, PRESETS, PATTERNS, GARGORL,
    POSES: Object.fromEntries(Object.entries(FRAMES).map(([p, f]) => [p, Object.keys(f)])),
    presetList: () => Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, description: p.description || '' })),
    render, renderProp, hatPlace, bbox, validate,
    ACCESSORIES, SEASONAL, ACC_IDS, SEASONAL_IDS, cleanAccessories, seasonalFor, accessoryCells, easterSunday, whiskerLines, whiskerSquares, noseRect,
    renderScene, spotCells, SPOT_IDS, SPOT_PARTS, SPOT_DEFAULT_COLORS, SPOT_LABELS, SPOT_CAT, tailColor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CatSprite = api;
})(typeof window !== 'undefined' ? window : globalThis);
