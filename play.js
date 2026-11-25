'use strict';
// Play mode page (Stage 6). Loaded ONLY by play.html, in a transparent overlay that covers
// the work area. Draws the cat (catsprite.js) and one toy; ~30 fps, but only the small
// areas that changed are cleared + redrawn (a full-screen transparent window is costly).
// Mouse: main forwards moves while the overlay ignores clicks; over the toy / the cat this
// page asks main to take clicks ('hover'), so everything else clicks through.
(() => {
  const api = window.playApi;
  const S = window.CatSprite;
  const cv = document.getElementById('play');
  const stopBtn = document.getElementById('stop');
  const g = cv.getContext('2d');
  window.addEventListener('error', (e) => api.report('error', { message: e.message, line: e.lineno }));

  // --- toys: pixel grids, one letter per pixel ('.' = empty) ---------------------------
  const K = '#3b2f2f';
  const TOYS = {
    ball: {
      colors: { K, R: '#ff5f7e', W: '#ffd6de', Y: '#ffd23f' },
      grid: ['..KKK..', '.KRRWK.', 'KRRRRWK', 'KYYYYYK', 'KRRRRRK', '.KRRRK.', '..KKK..'],
    },
    yarn: {
      colors: { K, P: '#b07bff', p: '#8a55d8' },
      grid: ['..KKK..', '.KPpPK.', 'KPpPPpK', 'KpPPpPK', 'KPPpPPK', '.KpPPK.', '..KKK..'],
    },
    fish: {
      colors: { K, O: '#ff9a3c', o: '#e07a1f', E: '#2b1d14' },
      grid: ['..KKKK....', '.KOOOOK.KK', 'KEOOOoOKoK', '.KOOOoK.KK', '..KKKK....'],
    },
    mouse: {
      colors: { K, G: '#a8adb5', g: '#8a9098', I: '#f4a6b8', N: '#ff6b8b', T: '#8a9098' },
      grid: ['......KK..', '.....KIK..', 'TT..KGGGK.', '..TKGGGgGN', '...KKKKKK.'],
    },
  };
  const toyCells = (t) => TOYS[t].grid;
  const HEART = S.renderProp('heart');

  // --- state ------------------------------------------------------------------------------
  let W = 0;
  let H = 0;
  let cell = 8; // the cat's px per sprite cell (whole numbers only)
  let ts = 4; // toy px per pixel
  let look = {};
  let hat = false;
  let sound = { on: true, volume: 0.5, quiet: false };
  let toyKind = 'ball';
  const cat = { x: 0, y: 0, yOff: 0, facing: 1, state: 'drop', t: 0, frameT: 0, frame: 'a', box: null, catches: 0 };
  const toy = { x: 0, y: 0, vx: 0, vy: 0, w: 0, h: 0, grabbed: false, trail: [], wob: 0, wander: 0 };
  const pointer = { x: -1, y: -1, inside: false, hist: [] };
  const kit = { x: 0, frame: 'a', t: 0, facing: 1 }; // Stage 10: the kitten trails her
  let hearts = []; // { x, y, t }
  let timer = null;
  let dirty = []; // rects drawn last frame (cleared next frame)
  let hovering = false;
  let strokes = [];
  let lastMove = null;
  let petAskAt = 0;
  const floorY = () => H - 2;
  const catTop = () => H - S.CANVAS.rows * cell; // the cat's grid sits on the bottom edge

  // --- audio: a tiny purr after a catch / pet (honours sound + volume + quiet hours) -------
  let actx = null;
  function purr(sec = 0.9) {
    if (!sound.on) return api.report('purr', { muted: true });
    try {
      actx = actx || new AudioContext();
      const now = actx.currentTime;
      const len = Math.floor(actx.sampleRate * sec);
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      const src = actx.createBufferSource();
      src.buffer = buf;
      const lp = actx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 300;
      const am = actx.createGain();
      const lfo = actx.createOscillator();
      lfo.frequency.value = 25;
      const depth = actx.createGain();
      depth.gain.value = 0.45;
      am.gain.value = 0.55;
      lfo.connect(depth).connect(am.gain);
      const out = actx.createGain();
      const lvl = Math.min(1, Math.max(0, sound.volume)) * (sound.quiet ? 0.25 : 0.7);
      out.gain.setValueAtTime(0, now);
      out.gain.linearRampToValueAtTime(lvl, now + 0.2);
      out.gain.linearRampToValueAtTime(0, now + sec);
      src.connect(lp).connect(am).connect(out).connect(actx.destination);
      src.start(now);
      lfo.start(now);
      src.stop(now + sec + 0.05);
      lfo.stop(now + sec + 0.05);
      src.onended = () => [src, lp, am, lfo, depth, out].forEach((n) => { try { n.disconnect(); } catch (_) { /* gone */ } });
      api.report('purr', { started: true });
    } catch (err) {
      api.report('error', { message: `purr: ${err.message}` });
    }
  }

  // --- start ---------------------------------------------------------------------------------
  function start(o) {
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = W;
    cv.height = H;
    g.imageSmoothingEnabled = false;
    cell = Math.max(4, Math.round(o.cell || 8));
    ts = Math.max(2, Math.round(cell / 2));
    look = o.look || {};
    hat = !!o.hat;
    sound = o.sound || sound;
    toyKind = TOYS[o.toy] ? o.toy : 'ball';
    // the cat starts where she sat, then drops / slides down to the bottom edge
    cat.x = Math.round(o.catX || W / 2 - 15 * cell);
    cat.y = Math.round(o.catY == null ? catTop() : o.catY);
    cat.yOff = 0;
    cat.state = cat.y < catTop() ? 'drop' : 'sit';
    cat.facing = 1;
    cat.catches = 0;
    const grid = toyCells(toyKind);
    toy.w = grid[0].length * ts;
    toy.h = grid.length * ts;
    // the toy appears a bit to the side of her, falling to the floor
    const side = cat.x + 15 * cell < W / 2 ? 1 : -1;
    toy.x = Math.max(toy.w, Math.min(W - toy.w, cat.x + 15 * cell + side * 260));
    toy.y = toyKind === 'fish' ? H - 260 : H - 300;
    toy.vx = toyKind === 'mouse' ? 0 : -side * 2;
    toy.vy = 0;
    toy.trail = [];
    toy.grabbed = false;
    kit.x = cat.x - 8 * cell;
    hearts = [];
    dirty = [];
    // Stop button: just right of where she sat (her grid is 30 cells wide; she sits in cells 8-21)
    stopSaved = o.stopPos && Number.isFinite(o.stopPos.x) && Number.isFinite(o.stopPos.y) ? o.stopPos : null;
    stopHome = { x: cat.x + 23 * cell, y: Math.max(10, cat.y + 6 * cell) };
    stopDrag = null;
    g.clearRect(0, 0, W, H);
    clearInterval(timer);
    timer = setInterval(frame, 33);
    api.report('ready', { toy: toyKind, w: W, h: H, cell });
  }

  // --- toys --------------------------------------------------------------------------------
  function toyPhysics() {
    if (toyKind === 'fish') {
      // dangles on a string below the cursor, wobbling
      const tx = pointer.x >= 0 ? pointer.x : toy.x;
      const ty = pointer.y >= 0 ? Math.min(floorY() - toy.h / 2, pointer.y + 80) : toy.y;
      toy.vx = (toy.vx + (tx - toy.x) * 0.12) * 0.78;
      toy.vy = (toy.vy + (ty - toy.y) * 0.12) * 0.78;
      toy.x += toy.vx;
      toy.y += toy.vy;
      toy.wob += 0.25;
      return;
    }
    if (toy.grabbed) return;
    if (toyKind === 'mouse') {
      // scurries away from the pointer (and from the cat when she is close); else wanders
      const near = (px, py, r) => px >= 0 && Math.abs(px - toy.x) < r && Math.abs(py - toy.y) < 200;
      const catCx = cat.box ? cat.box.x + cat.box.w / 2 : cat.x;
      if (near(pointer.x, pointer.y, 160)) toy.vx = Math.sign(toy.x - pointer.x || 1) * 7;
      else if (Math.abs(catCx - toy.x) < 70 && cat.state !== 'happy') toy.vx = Math.sign(toy.x - catCx || 1) * 5;
      else if (toy.wander-- <= 0) {
        toy.wander = 20 + Math.floor(Math.random() * 40);
        toy.vx = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? -2 : 2);
      }
      toy.vy += 1;
    } else {
      toy.vy += 1.3; // gravity (a big screen: fast enough to feel like a ball)
    }
    toy.x += toy.vx;
    toy.y += toy.vy;
    const bottom = floorY() - toy.h / 2;
    const bounce = toyKind === 'ball' ? 0.55 : toyKind === 'yarn' ? 0.25 : 0;
    if (toy.y >= bottom) {
      toy.y = bottom;
      toy.vy = Math.abs(toy.vy) > 3 ? -toy.vy * bounce : 0;
      toy.vx *= toyKind === 'mouse' ? 0.9 : toyKind === 'yarn' ? 0.97 : 0.985;
      if (Math.abs(toy.vx) < 0.05) toy.vx = 0;
    }
    if (toy.y < toy.h / 2) { toy.y = toy.h / 2; toy.vy = Math.abs(toy.vy) * 0.5; }
    if (toy.x < toy.w / 2) { toy.x = toy.w / 2; toy.vx = Math.abs(toy.vx) * 0.7; }
    if (toy.x > W - toy.w / 2) { toy.x = W - toy.w / 2; toy.vx = -Math.abs(toy.vx) * 0.7; }
    if (toyKind === 'yarn' && (Math.abs(toy.vx) > 0.3 || Math.abs(toy.vy) > 0.3)) {
      toy.trail.push([Math.round(toy.x), Math.round(toy.y + toy.h / 2 - ts)]);
      if (toy.trail.length > 70) toy.trail.shift();
    }
  }

  // --- the cat: walk to the toy, crouch + wiggle, pounce; happy after a catch ------------------
  const SPEED = 3.4;
  const toyRect = () => ({ x: toy.x - toy.w / 2, y: toy.y - toy.h / 2, w: toy.w, h: toy.h });
  const hit = (a, b, pad = 0) => a && b && a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;

  let catHeld = false; // selftest: keep her still (so she doesn't bat the toy away)
  function catBrain(dt) {
    if (catHeld) return;
    cat.t += dt;
    cat.frameT += dt;
    const centre = cat.box ? cat.box.x + cat.box.w / 2 : cat.x + 15 * cell;
    const dx = toy.x - centre;
    const reachable = toy.y > H - S.CANVAS.rows * cell * 0.75;
    switch (cat.state) {
      case 'drop': {
        cat.y = Math.min(catTop(), cat.y + 18);
        if (cat.y >= catTop()) setState('sit');
        break;
      }
      case 'happy':
        if (cat.t > 1400) setState('sit');
        break;
      case 'crouch':
        if (cat.frameT > 150) { cat.frameT = 0; cat.frame = cat.frame === 'a' ? 'b' : 'a'; }
        if (Math.abs(dx) > 9 * cell || !reachable) setState('sit');
        else if (cat.t > 750) setState('pounce');
        break;
      case 'pounce': {
        const t = Math.min(1, cat.t / 450);
        cat.yOff = -Math.round(Math.sin(Math.PI * t) * cell * 5);
        cat.x += cat.facing * SPEED * 1.8;
        if (t > 0.35 && hit(cat.box, toyRect(), cell)) return caught();
        if (t >= 1) { cat.yOff = 0; setState('sit'); }
        break;
      }
      default: { // sit / walk
        if (Math.abs(dx) > 5 * cell) {
          cat.facing = dx > 0 ? 1 : -1;
          cat.x += cat.facing * SPEED;
          if (cat.state !== 'walk') setState('walk');
          if (cat.frameT > 120) { cat.frameT = 0; cat.frame = { a: 'b', b: 'c', c: 'd', d: 'a' }[cat.frame] || 'a'; }
        } else if (reachable && cat.t > 300) {
          cat.facing = dx >= 0 ? 1 : -1;
          setState('crouch');
        } else if (cat.state !== 'sit') setState('sit');
      }
    }
    cat.x = Math.max(-6 * cell, Math.min(W - 24 * cell, cat.x));
  }
  function setState(s) {
    cat.state = s;
    cat.t = 0;
    cat.frameT = 0;
    cat.frame = 'a';
    if (s !== 'pounce') cat.yOff = 0;
  }
  function caught() {
    cat.catches += 1;
    cat.yOff = 0;
    setState('happy');
    addHearts(4);
    purr();
    // the toy gets batted away / runs off
    if (toyKind === 'ball' || toyKind === 'yarn') { toy.vx = cat.facing * (6 + Math.random() * 5); toy.vy = -9; }
    if (toyKind === 'mouse') { toy.vx = cat.facing * 9; toy.wander = 30; }
    if (toyKind === 'fish') toy.wob += 3;
    api.report('caught', { toy: toyKind, catches: cat.catches });
  }
  function addHearts(n) {
    const c = cat.box || { x: cat.x + 10 * cell, y: H - 12 * cell, w: 10 * cell };
    for (let i = 0; i < n; i++) hearts.push({ x: c.x + c.w * (0.2 + Math.random() * 0.6), y: c.y, t: -i * 180, dx: (Math.random() - 0.5) * 30 });
  }

  // --- drawing (dirty rects only) -----------------------------------------------------------
  function drawGrid(grid, colors, x0, y0, px, flip) {
    const w = grid[0].length;
    grid.forEach((row, y) => [...row].forEach((ch, x) => {
      const col = colors ? colors[ch] : ch;
      if (!col || ch === '.') return;
      g.fillStyle = col;
      g.fillRect(Math.round(x0 + (flip ? w - 1 - x : x) * px), Math.round(y0 + y * px), px, px);
    }));
  }
  function frame() {
    try {
      catBrain(33);
      toyPhysics();
      for (const r of dirty) g.clearRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
      dirty = [];
      // yarn thread
      if (toyKind === 'yarn' && toy.trail.length > 1) {
        g.fillStyle = TOYS.yarn.colors.P;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of toy.trail) {
          g.fillRect(x, y, 2, 2);
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        dirty.push({ x: minX, y: minY, w: maxX - minX + 2, h: maxY - minY + 2 });
      }
      // fishing stick + string
      if (toyKind === 'fish' && pointer.x >= 0) {
        g.fillStyle = '#7a4a2a';
        for (let i = 0; i < 12; i++) g.fillRect(pointer.x - i * 3, pointer.y - i * 3, 3, 3);
        g.fillStyle = '#e6e6ea';
        const steps = Math.max(1, Math.round(Math.hypot(toy.x - pointer.x, toy.y - toy.h / 2 - pointer.y) / 4));
        for (let i = 0; i <= steps; i++) g.fillRect(Math.round(pointer.x + ((toy.x - pointer.x) * i) / steps), Math.round(pointer.y + ((toy.y - toy.h / 2 - pointer.y) * i) / steps), 2, 2);
        dirty.push({ x: Math.min(pointer.x - 36, toy.x), y: Math.min(pointer.y - 36, toy.y - toy.h), w: Math.abs(toy.x - pointer.x) + 40, h: Math.abs(toy.y - pointer.y) + 40 });
      }
      // the cat
      const pose = cat.state === 'walk' ? 'walk' : cat.state === 'crouch' ? 'crouch' : cat.state === 'pounce' ? 'pounce' : 'sit';
      const fr = pose === 'walk' ? cat.frame : pose === 'crouch' ? cat.frame : pose === 'pounce' ? 'a' : cat.state === 'happy' ? 'squint' : 'sit';
      const sc = S.renderScene({ pose, frame: fr, facing: cat.facing, look, hat, accessories: look.accessories, seasonal: look.seasonal, catName: look.catName });
      const ox = Math.round(cat.x);
      const oy = Math.round(cat.y + cat.yOff);
      sc.under.forEach((row, y) => row.forEach((col, x) => { if (col) { g.fillStyle = col; g.fillRect(ox + x * cell, oy + y * cell, cell, cell); } }));
      g.fillStyle = (look.colors && look.colors.whiskers) || '#d9dbe0';
      for (const [px, py, t] of S.whiskerSquares(sc.whiskers, cell)) g.fillRect(ox + px, oy + py, t, t);
      const bb = sc.catBox;
      cat.box = bb && { x: ox + bb.x * cell, y: oy + bb.y * cell, w: bb.w * cell, h: bb.h * cell };
      const hb = sc.hatBox;
      const top = hb ? Math.min(bb ? bb.y : hb.y, hb.y) : bb ? bb.y : 0;
      if (bb) dirty.push({ x: ox + Math.min(bb.x, hb ? hb.x : bb.x) * cell - cell * 2, y: oy + top * cell - cell, w: (bb.w + 6) * cell, h: (S.CANVAS.rows - top + 1) * cell });
      // the kitten (Stage 10): trots after her and sits a little behind her
      if (look.kitten) {
        const kc = Math.max(2, Math.round(cell / 3));
        const centre = cat.box ? cat.box.x + cat.box.w / 2 : cat.x + 15 * cell;
        const target = centre - cat.facing * 13 * cell;
        const gap = target - kit.x;
        const moving = Math.abs(gap) > 3 * kc;
        if (moving) {
          kit.facing = gap > 0 ? 1 : -1;
          kit.x += Math.sign(gap) * Math.min(Math.abs(gap), 3.2);
          kit.t += 33;
          if (kit.t > 120) { kit.t = 0; kit.frame = { a: 'b', b: 'c', c: 'd', d: 'a' }[kit.frame]; }
        }
        const kg = S.render(moving ? 'walk' : 'sit', moving ? kit.frame : 'sit', look.kitten, moving ? kit.facing : 1);
        const kb = S.bbox(kg);
        if (kb) {
          const kx = Math.round(kit.x - (kb.w * kc) / 2);
          const ky = H - kb.h * kc;
          kg.forEach((row, y) => row.forEach((col, x) => { if (col) { g.fillStyle = col; g.fillRect(kx + (x - kb.x) * kc, ky + (y - kb.y) * kc, kc, kc); } }));
          dirty.push({ x: kx, y: ky, w: kb.w * kc, h: kb.h * kc });
        }
      }
      // the toy
      const grid = toyCells(toyKind);
      const wob = toyKind === 'fish' ? Math.round(Math.sin(toy.wob) * 2) : 0;
      const tx = Math.round(toy.x - toy.w / 2) + wob;
      const ty = Math.round(toy.y - toy.h / 2);
      drawGrid(grid, TOYS[toyKind].colors, tx, ty, ts, toyKind === 'mouse' ? toy.vx < 0 : toyKind === 'fish' ? toy.vx < -0.5 : false);
      dirty.push({ x: tx, y: ty, w: toy.w, h: toy.h });
      // hearts float up
      const hs = Math.max(2, Math.round(cell / 2));
      hearts = hearts.filter((h) => h.t < 1300);
      for (const h of hearts) {
        h.t += 33;
        if (h.t < 0) continue;
        const p = h.t / 1300;
        const x = Math.round(h.x + h.dx * p);
        const y = Math.round(h.y - 70 * p);
        g.globalAlpha = p < 0.15 ? p / 0.15 : p > 0.75 ? (1 - p) / 0.25 : 1;
        drawGrid(HEART, null, x, y, hs, false);
        g.globalAlpha = 1;
        dirty.push({ x, y, w: HEART[0].length * hs, h: HEART.length * hs });
      }
      updateHover();
    } catch (err) {
      api.report('error', { message: `play frame: ${err.message}` });
    }
  }

  // --- mouse -----------------------------------------------------------------------------------
  // the Stop button
  const stopRect = () => {
    const r = stopBtn.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  // It stays in one place (it doesn't run off with her): by default just right of where she
  // sat before playing; she can drag it anywhere (saved), a right-click puts it back.
  let stopHome = null; // { x, y } default spot (px)
  let stopSaved = null; // { x, y } 0..1 of the screen, her own spot
  let stopDrag = null; // { sx, sy, bx, by, moved }
  function placeStop() {
    if (stopDrag) return;
    const bw = stopBtn.offsetWidth;
    const bh = stopBtn.offsetHeight;
    const want = stopSaved ? { x: stopSaved.x * W, y: stopSaved.y * H } : stopHome || { x: W / 2 - bw / 2, y: 10 };
    const x = Math.round(Math.max(4, Math.min(W - bw - 4, want.x)));
    const y = Math.round(Math.max(4, Math.min(H - bh - 4, want.y)));
    if (stopBtn.style.left !== `${x}px`) stopBtn.style.left = `${x}px`;
    if (stopBtn.style.top !== `${y}px`) stopBtn.style.top = `${y}px`;
  }
  // press + release without moving = stop; press + move = drag it somewhere else
  stopBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    stopDrag = { sx: e.clientX, sy: e.clientY, bx: stopBtn.offsetLeft, by: stopBtn.offsetTop, moved: false };
    try { stopBtn.setPointerCapture(e.pointerId); } catch (_) { /* optional */ }
    // take the whole screen's clicks right away, so the drag can't slip off the button
    lastRects = 'drag';
    api.rects([{ x: 0, y: 0, w: W, h: H }]);
  });
  stopBtn.addEventListener('pointermove', (e) => dragStop(e.clientX, e.clientY));
  function dragStop(cx, cy) {
    if (!stopDrag) return;
    const dx = cx - stopDrag.sx;
    const dy = cy - stopDrag.sy;
    if (!stopDrag.moved && Math.hypot(dx, dy) < 6) return;
    stopDrag.moved = true;
    stopBtn.style.left = `${Math.round(Math.max(4, Math.min(W - stopBtn.offsetWidth - 4, stopDrag.bx + dx)))}px`;
    stopBtn.style.top = `${Math.round(Math.max(4, Math.min(H - stopBtn.offsetHeight - 4, stopDrag.by + dy)))}px`;
  }
  stopBtn.addEventListener('pointerup', (e) => {
    if (!stopDrag) return;
    const d = stopDrag;
    stopDrag = null;
    if (!d.moved) return api.stop('stop button');
    stopSaved = { x: +(stopBtn.offsetLeft / W).toFixed(4), y: +(stopBtn.offsetTop / H).toFixed(4) };
    api.stopPos(stopSaved);
    api.report('stop-moved', stopSaved);
  });
  let lastRects = '';
  function updateHover() {
    placeStop();
    const p = { x: pointer.x, y: pointer.y, w: 1, h: 1 };
    // main watches the real mouse and lets clicks reach these (the whole screen while she drags the toy)
    const big = { x: 0, y: 0, w: W, h: H };
    const rects = toy.grabbed || stopDrag ? [big] : [toyRect(), cat.box, stopRect()].filter(Boolean).map((r) => ({ x: Math.round(r.x - 6), y: Math.round(r.y - 6), w: Math.round(r.w + 12), h: Math.round(r.h + 12) }));
    const key = JSON.stringify(rects);
    if (key !== lastRects) {
      lastRects = key;
      api.rects(rects);
    }
    hovering = pointer.inside && (toy.grabbed || hit(p, toyRect(), 8) || hit(p, cat.box, 0) || hit(p, stopRect(), 2));
    document.body.classList.toggle('grab', (toyKind === 'ball' || toyKind === 'yarn') && !toy.grabbed && hit(p, toyRect(), 8));
  }
  let buttonDown = false;
  window.addEventListener('mousedown', () => { buttonDown = true; }, true);
  window.addEventListener('mouseup', () => { buttonDown = false; }, true);
  // the pointer: from main (it watches the real mouse) and from real moves while we take clicks
  api.onPointer((pt) => moved({ clientX: pt.x, clientY: pt.y, screenX: pt.x, screenY: pt.y, buttons: buttonDown ? 1 : 0 }));
  window.addEventListener('mousemove', (e) => moved(e));
  function moved(e) {
    if (stopDrag) dragStop(e.clientX, e.clientY); // the pointer from main moves the Stop button too
    if (pointer.frozen) return; // selftest: a fake pointer, the real mouse is ignored
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    const now = performance.now();
    pointer.hist.push([now, e.clientX, e.clientY]);
    pointer.hist = pointer.hist.filter(([t]) => now - t < 120);
    if (toy.grabbed) {
      toy.x = e.clientX;
      toy.y = Math.min(floorY() - toy.h / 2, e.clientY);
    }
    // stroking the cat (no button) = a pet, like on the desktop
    if (!toy.grabbed && e.buttons === 0 && hit({ x: e.clientX, y: e.clientY, w: 1, h: 1 }, cat.box, 0)) {
      if (lastMove && now - lastMove.t < 200) strokes.push([now, Math.hypot(e.screenX - lastMove.x, e.screenY - lastMove.y)]);
      lastMove = { x: e.screenX, y: e.screenY, t: now };
      strokes = strokes.filter(([t]) => now - t <= 1200);
      if (strokes.reduce((a, [, d]) => a + d, 0) >= 250 && now - petAskAt > 1000) {
        petAskAt = now;
        strokes = [];
        api.pet().then((r) => {
          if (r && r.ok) { addHearts(3); purr(1.4); }
          api.report('pet', r);
        });
      }
    } else lastMove = null;
  }
  // (no 'mouseleave' handling: switching click-through on / off makes Windows send fake leaves,
  // which made the overlay give the click away again - the Stop button never got it)
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if ((toyKind === 'ball' || toyKind === 'yarn') && hit({ x: e.clientX, y: e.clientY, w: 1, h: 1 }, toyRect(), 8)) {
      toy.grabbed = true;
      toy.vx = 0;
      toy.vy = 0;
      document.body.classList.add('grabbing');
    }
  });
  window.addEventListener('mouseup', () => {
    if (!toy.grabbed) return;
    toy.grabbed = false;
    document.body.classList.remove('grabbing');
    // flick: the pointer's speed over the last ~100 ms
    const h = pointer.hist;
    if (h.length >= 2) {
      const [t0, x0, y0] = h[0];
      const [t1, x1, y1] = h[h.length - 1];
      const dt = Math.max(16, t1 - t0) / 33;
      toy.vx = Math.max(-25, Math.min(25, (x1 - x0) / dt));
      toy.vy = Math.max(-25, Math.min(25, (y1 - y0) / dt));
    }
    api.report('flick', { vx: +toy.vx.toFixed(1), vy: +toy.vy.toFixed(1) });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.stop('esc'); });
  // right-click on her / the toy: the usual menu (it has "Stop playing")
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = { x: e.clientX, y: e.clientY, w: 1, h: 1 };
    // right-click on the Stop button: put it back by the cat
    if (hit(p, stopRect(), 2)) { stopSaved = null; api.stopPos(null); placeStop(); api.report('stop-moved', null); return; }
    if (hit(p, cat.box, 0) || hit(p, toyRect(), 8)) api.menu();
  });

  api.onStart(start);
  api.onStop(() => { clearInterval(timer); timer = null; g.clearRect(0, 0, W, H); });
  // main reads where she ended up (to put the normal cat window there)
  window.__catPos = () => ({ x: Math.round(cat.x), y: Math.round(catTop()), state: cat.state, catches: cat.catches });
  // selftest helpers
  window.__playDebug = {
    putToy: (x, y) => { toy.x = x; toy.y = y; toy.vx = 0; toy.vy = 0; },
    catBox: () => cat.box,
    toy: () => ({ x: toy.x, y: toy.y, vx: toy.vx, vy: toy.vy, trail: toy.trail.length }),
    pointerAt: (x, y) => { pointer.x = x; pointer.y = y; pointer.inside = true; pointer.frozen = true; },
    stopRect: () => stopRect(),
    stopHome: () => stopHome,
    holdCat: (on) => { catHeld = !!on; },
    state: () => ({ pointer: { x: pointer.x, y: pointer.y, inside: pointer.inside, frozen: !!pointer.frozen }, hovering }),
  };
})();
