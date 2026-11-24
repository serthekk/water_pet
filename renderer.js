'use strict';
// Page script. Loaded ONLY by index.html via <script>. Talks to main via window.api (preload.js).
(() => {
  const api = window.api;
  const pet = document.getElementById('pet');
  const cat = document.getElementById('sprite'); // canvas
  const zzz = document.getElementById('zzz');
  const countEl = document.getElementById('count-text');
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const hideBtn = document.getElementById('hide-btn');
  const resetBtn = document.getElementById('reset-btn');
  const quitBtn = document.getElementById('quit-btn');
  const restartBtn = document.getElementById('restart-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const grip = document.getElementById('resize-grip');

  const BUBBLE_MS = 10000;

  let volume = 0.5;
  let soundOn = true; // settings "soundEnabled": every sound checks it
  let bubbleTimer = null;
  let pressing = false; // left button is down on the cat

  window.addEventListener('error', (e) => api.report('error', { message: e.message, line: e.lineno }));
  window.addEventListener('unhandledrejection', (e) => api.report('error', { message: String(e.reason) }));

  // --- display -----------------------------------------------------------
  function render(s) {
    if (typeof s.volume === 'number') volume = s.volume;
    if (typeof s.meowStyle === 'string') meowStyle = s.meowStyle;
    if (typeof s.sound === 'boolean') soundOn = s.sound;
    countEl.textContent = `${s.cups} / ${s.goal} cups`;
    if (typeof s.mouseResize === 'boolean') document.body.classList.toggle('can-resize', s.mouseResize);
    if (Number.isInteger(s.size) && s.size !== CELL) {
      layout(s.size);
      if (anim) { anim = null; stopFrames(); }
      runBase();
      api.report('size', { size: s.size, canvas: { w: cat.width, h: cat.height, left: canvasLeft }, box: lastBox });
    }
    if (s.look) applyLook(s.look);
  }

  // Colours / pattern / tail / whiskers changed: redraw (main also sends 'colors-changed').
  function applyLook(l) {
    const key = JSON.stringify(l);
    if (key === lookKey) return;
    look = l;
    lookKey = key;
    drawn = null;
    if (anim) { anim = null; stopFrames(); }
    runBase(); // redraw in the new look
    api.report('look', { breed: look.breed, tail: look.tail, whiskers: look.whiskers, pattern: look.pattern, colors: look.colors, box: lastBox });
  }

  // --- sprite + animation ------------------------------------------------
  // Main sets the base pose (sit / sleep / walk) and asks for one-shot animations
  // (stretch / scratch). Frames change a few times a second at most: every repaint
  // of a transparent window costs a little, and she games.
  const S = window.CatSprite; // catsprite.js: layered, recolourable grids
  const SPRITE_TOP = 96; // #sprite top in the window (styles.css / main.js)
  let CELL = 8; // px per sprite cell = the cat size (whole numbers only)
  let canvasLeft = 0;

  // Must match main.js winSizeFor(): width max(240, 30 cells), canvas centred.
  function layout(cell) {
    CELL = cell;
    const w = S.CANVAS.cols * cell;
    const h = S.CANVAS.rows * cell;
    canvasLeft = Math.round((Math.max(240, w) - w) / 2);
    cat.width = w;
    cat.height = h;
    Object.assign(cat.style, { width: `${w}px`, height: `${h}px`, left: `${canvasLeft}px` });
    Object.assign(zzz.style, { left: `${Math.round(canvasLeft + 7.75 * cell)}px`, top: `${Math.round(SPRITE_TOP + 4.25 * cell)}px` });
    drawn = null;
    lastBox = null;
  }
  const g = cat.getContext('2d');
  let look = { ...S.PRESETS.gargorl, breed: 'gargorl', tail: true, whiskers: true }; // until main's state arrives
  let lookKey = '';
  let base = { pose: 'sit', facing: 1 };
  let anim = null; // one-shot name
  let frameTimer = null;
  let drawn = null; // key of the current frame
  let reportedPose = null;
  let lastBox = null;
  layout(CELL); // default 100%; main's state message brings the saved size

  const spriteProblems = S.validate();
  if (spriteProblems.length) api.report('error', { message: 'sprite problems: ' + spriteProblems.join('; ') });

  // opts (sleeping spots, Stage E): { spot, spotAlpha, place: {dx, dy}, overlay, lookDx }
  function drawFrame(pose, frame, facing, opts = {}) {
    const key = `${lookKey}|${pose}|${frame}|${facing}|${JSON.stringify(opts)}`;
    if (key === drawn) return;
    drawn = key;
    const scene = S.renderScene({
      pose, frame, facing, look: opts.lookDx ? { ...look, lookDx: opts.lookDx } : look,
      place: opts.place, spot: opts.spot, spotColors: look.spotColors, spotAlpha: opts.spotAlpha, overlay: opts.overlay,
    });
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cat.width, cat.height);
    const paint = (grid) => grid.forEach((row, y) => row.forEach((col, x) => {
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x * CELL, y * CELL, CELL, CELL);
    }));
    paint(scene.under); // spot back + cat
    // whiskers: fine lines (about 1/6 of a sprite pixel thick, whole screen px), under the
    // front of a bed / box so they hide with her
    g.fillStyle = (look.colors && look.colors.whiskers) || '#d9dbe0';
    for (const [px, py, t] of S.whiskerSquares(scene.whiskers, CELL)) g.fillRect(px, py, t, t);
    paint(scene.over); // spot front + her paw / tail over the edge
    // Hit area = the VISIBLE cat only (furniture never takes the mouse).
    const bb = scene.catBox;
    const box = bb && { x: canvasLeft + bb.x * CELL, y: SPRITE_TOP + bb.y * CELL, width: bb.w * CELL, height: bb.h * CELL };
    if (box && JSON.stringify(box) !== JSON.stringify(lastBox)) {
      lastBox = box;
      Object.assign(pet.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
      placeOverlays(box);
      sendHitRects(); // main needs these for presses Windows swallows
    }
    const sleeping = pose === 'sleep' || (opts.spot === 'box' && frame === 'blink' && opts.place && opts.place.dy === -5);
    zzz.classList.toggle('shown', sleeping);
    if (pose !== reportedPose) {
      reportedPose = pose;
      sendHitRects(); // the nose area only exists while she sits facing us
      api.report('pose', { pose, frame, facing, breed: look.breed, tail: look.tail, whiskers: look.whiskers, box, spot: opts.spot || null });
    }
  }

  // The counter + bubble sit just above her head wherever she is (on the cat tree too),
  // and the z z z float from her head.
  function placeOverlays(box) {
    const countTop = Math.max(36, box.y - 24);
    document.getElementById('count').style.top = `${countTop}px`;
    bubble.style.top = `${countTop - 4}px`;
    // z z z: over her head, above the counter (never on top of the bowl / numbers)
    Object.assign(zzz.style, { left: `${Math.round(box.x + 6)}px`, top: `${Math.max(0, countTop - 40)}px` });
  }

  function stopFrames() {
    clearTimeout(frameTimer);
    frameTimer = null;
  }

  // Loop a list of [pose, frame, ms, opts?] steps; `once` = one-shot then back to base.
  function sequence(steps, once) {
    stopFrames();
    let i = 0;
    const step = () => {
      if (i >= steps.length) {
        if (once) { const done = anim; anim = null; api.report('anim-done', { name: done }); return runBase(); }
        i = 0;
      }
      const [pose, frame, ms, opts] = steps[i++];
      drawFrame(pose, frame, base.facing, opts || {});
      frameTimer = setTimeout(step, ms);
    };
    step();
  }

  // --- sleeping spots (Stage E) ------------------------------------------------
  const sceneOf = (spot) => S.SPOT_CAT[spot && spot !== 'none' ? spot : 'none'];
  const spotOpts = (spot, extra = {}) => {
    const sc = sceneOf(spot);
    return spot && spot !== 'none' ? { spot, place: sc.place, overlay: sc.overlay, ...extra } : { place: sc.place, ...extra };
  };
  const fade = (spot, alphas, pose = 'sit', frame = 'sit', extra = {}) =>
    alphas.map((a) => [pose, frame, 110, { spot, spotAlpha: a, ...extra }]); // stepped: 4 x 110 ms
  const STRETCH = [['stretch', 'yawn', 350], ['stretch', 'tall', 1100], ['stretch', 'yawn', 300]];
  // Going to sleep: the spot fades in, she hops onto / into it and curls up.
  function enterSteps(spot) {
    if (!spot || spot === 'none') return [['sit', 'blink', 300]];
    const IN = [0.25, 0.5, 0.75, 1];
    if (spot === 'box') {
      // "if I fits, I sits": crouch, wiggle the hindquarters, hop in
      return [
        ['crouch', 'a', 200, { place: { dx: -3 } }], ['crouch', 'b', 170, { place: { dx: -3 } }],
        ['crouch', 'a', 170, { place: { dx: -3 } }], ['crouch', 'b', 170, { place: { dx: -3 } }],
        ...IN.map((a) => ['pounce', 'a', 90, { spot, spotAlpha: a, place: { dy: 9 } }]),
        ['sit', 'sit', 220, spotOpts('box', { place: { dy: -2 } })], // lands inside
        ['sit', 'blink', 200, spotOpts('box')],
      ];
    }
    if (spot === 'tree') {
      return [...fade(spot, IN), ['pounce', 'a', 170, { spot, place: { dy: 8 } }], ['pounce', 'a', 170, { spot, place: { dy: 14 } }],
        ['sleep', 'a', 300, spotOpts('tree')]];
    }
    return [...fade(spot, IN), ['sit', 'sit', 150, { spot, place: { dy: 1 } }], ['sleep', 'a', 300, spotOpts('bed')]];
  }
  // Waking up: (box: ears pop up, peek, hop out), stretch + yawn, the spot fades out.
  function wakeSteps(spot) {
    if (!spot || spot === 'none') return [...STRETCH, ['sit', 'blink', 200]];
    const OUT = [0.75, 0.5, 0.25];
    const withSpot = STRETCH.map(([p, f, ms]) => [p, f, ms, { spot }]);
    if (spot === 'box') {
      return [['sit', 'blink', 380, spotOpts('box', { place: { dy: -4 } })], ['sit', 'sit', 380, spotOpts('box', { place: { dy: -2 } })],
        ['pounce', 'a', 200, { spot, place: { dy: 8 } }], ...withSpot, ...fade(spot, OUT, 'sit', 'blink')];
    }
    return [['sit', 'sit', 200, { spot }], ...withSpot, ...fade(spot, OUT, 'sit', 'blink')];
  }
  function peekSteps(lookDx) {
    return [['sit', 'blink', 250, spotOpts('box', { place: { dy: -4 } })], ['sit', 'sit', 1300, spotOpts('box', { place: { dy: -2 }, lookDx })],
      ['sit', 'blink', 250, spotOpts('box', { place: { dy: -4 } })]];
  }

  function runBase() {
    if (anim) return; // a one-shot is playing; it returns here when done
    if (base.pose === 'sleep') {
      const sc = sceneOf(base.spot);
      return sequence(sc.frames.map((f) => [sc.pose, f, 1400, spotOpts(base.spot)]));
    }
    if (base.pose === 'walk') return sequence([['walk', 'a', 150], ['walk', 'b', 150], ['walk', 'c', 150], ['walk', 'd', 150]]);
    // Sitting: idle life in stepped pixel timing. Every few seconds either a blink
    // (2 frames) or a small tail wag (tail tip flicks right twice); nothing in between,
    // so the window only repaints on those few frames.
    stopFrames();
    drawFrame('sit', 'sit', 1);
    const steps = (list, done) => {
      const [frame, ms] = list[0];
      drawFrame('sit', frame, 1);
      frameTimer = setTimeout(() => (list.length > 1 ? steps(list.slice(1), done) : done()), ms);
    };
    const idle = () => {
      const blink = [['blink', 160], ['sit', 0]];
      const wag = [['wag', 220], ['sit', 220], ['wag', 220], ['sit', 0]];
      steps(Math.random() < 0.6 ? blink : wag, () => { frameTimer = setTimeout(idle, 2200 + Math.random() * 3800); });
      window.__idleLife = (window.__idleLife || 0) + 1; // read by the selftest (no log spam)
    };
    frameTimer = setTimeout(idle, 2200 + Math.random() * 3800);
  }

  const ANIMS = {
    stretch: [['stretch', 'yawn', 350], ['stretch', 'tall', 1100], ['stretch', 'yawn', 300], ['sit', 'blink', 200]],
    scratch: Array.from({ length: 12 }, (_, i) => ['scratch', i % 2 ? 'b' : 'a', 220]),
    belly: [['belly', 'a', 3000]], // petted: belly up ~3 s
    boop: [['sit', 'blink', 110], ['sit', 'sit', 120], ['sit', 'blink', 110], ['sit', 'squint', 500]], // surprised blink
  };
  function playAnim(name, a = {}) {
    let steps = ANIMS[name];
    if (name === 'sleep-enter') steps = enterSteps(a.spot);
    if (name === 'wake') steps = wakeSteps(a.spot);
    if (name === 'peek') steps = peekSteps(a.lookDx || 0);
    if (!steps) return;
    anim = name;
    api.report('anim', { name, spot: a.spot });
    sequence(steps, true);
  }

  function hop() {
    cat.classList.remove('hop');
    void cat.offsetWidth; // restart the animation
    cat.classList.add('hop');
  }
  cat.addEventListener('animationend', (e) => {
    if (e.animationName === 'hop') cat.classList.remove('hop');
  });

  // --- sound (Web Audio) -------------------------------------------------
  // Each clip is decoded once. Every meow gets its own source node, and a meow
  // that is still playing is faded out (never cut mid-waveform -> no clicks/tearing).
  const FADE_S = 0.04;
  let meowStyle = 'random';
  let lastStyle = null;
  const ctx = new AudioContext({ latencyHint: 'playback' });
  let current = null; // { src, gain }
  let buffers = new Map(); // id -> AudioBuffer
  let loadGen = 0;

  // Her own files: same cleanup as make_meows.js (minus ffmpeg's denoiser), done here so
  // no tools are needed on her PC. mono -> trim silence -> max 4 s -> highpass 250 Hz ->
  // lowpass 9 kHz x2 -> fades -> loudness match -> peak <= -3 dBFS.
  const CLEAN = { rate: 48000, maxS: 4, trimDb: -45, targetRmsDb: -12, ceiling: 0.7, fadeIn: 0.012, fadeOut: 0.06 };
  async function cleanClip(src) {
    const n = src.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < src.numberOfChannels; c++) {
      const d = src.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i] / src.numberOfChannels;
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
    if (peak < 0.001) throw new Error('silent file');
    const thr = peak * Math.pow(10, CLEAN.trimDb / 20);
    let a = 0;
    let b = n - 1;
    while (a < n && Math.abs(mono[a]) < thr) a++;
    while (b > a && Math.abs(mono[b]) < thr) b--;
    a = Math.max(0, a - Math.round(0.01 * src.sampleRate));
    b = Math.min(n, b + Math.round(0.05 * src.sampleRate));
    b = Math.min(b, a + Math.round(CLEAN.maxS * src.sampleRate));
    const len = b - a;
    if (len < 0.05 * src.sampleRate) throw new Error('too short');

    const outLen = Math.ceil((len * CLEAN.rate) / src.sampleRate);
    const off = new OfflineAudioContext(1, outLen, CLEAN.rate);
    const inBuf = off.createBuffer(1, len, src.sampleRate);
    inBuf.copyToChannel(mono.subarray(a, b), 0);
    const s = off.createBufferSource();
    s.buffer = inBuf;
    const hp = new BiquadFilterNode(off, { type: 'highpass', frequency: 250, Q: -3.01 });
    const lp1 = new BiquadFilterNode(off, { type: 'lowpass', frequency: 9000, Q: -3.01 });
    const lp2 = new BiquadFilterNode(off, { type: 'lowpass', frequency: 9000, Q: -3.01 });
    s.connect(hp).connect(lp1).connect(lp2).connect(off.destination);
    s.start();
    const out = await off.startRendering();
    const d = out.getChannelData(0);

    const fin = Math.round(CLEAN.fadeIn * CLEAN.rate);
    const fout = Math.min(Math.round(CLEAN.fadeOut * CLEAN.rate), Math.floor(d.length / 4));
    for (let i = 0; i < fin && i < d.length; i++) d[i] *= i / fin;
    for (let i = 0; i < fout; i++) d[d.length - 1 - i] *= i / fout;

    // Loudness: loudest 50 ms window to target, then cap the peak at the ceiling.
    const w = Math.round(0.05 * CLEAN.rate);
    let rmsPeak = 0;
    let p2 = 0;
    for (let i = 0; i < d.length; i += w) {
      let sum = 0;
      const end = Math.min(d.length, i + w);
      for (let j = i; j < end; j++) sum += d[j] * d[j];
      rmsPeak = Math.max(rmsPeak, Math.sqrt(sum / (end - i)));
    }
    for (let i = 0; i < d.length; i++) p2 = Math.max(p2, Math.abs(d[i]));
    let gain = Math.pow(10, CLEAN.targetRmsDb / 20) / Math.max(rmsPeak, 1e-6);
    gain = Math.min(gain, CLEAN.ceiling / Math.max(p2, 1e-6));
    let finalPeak = 0;
    for (let i = 0; i < d.length; i++) {
      d[i] *= gain;
      finalPeak = Math.max(finalPeak, Math.abs(d[i]));
    }
    return {
      buffer: out,
      stats: { seconds: +out.duration.toFixed(2), srcSeconds: +src.duration.toFixed(2), peak: +finalPeak.toFixed(3), channels: 1, sampleRate: out.sampleRate, gainDb: +(20 * Math.log10(gain)).toFixed(1) },
    };
  }

  async function loadMeows() {
    const gen = ++loadGen;
    const clips = await api.getMeows();
    const next = new Map();
    const cleaned = {};
    await Promise.all(clips.map(async (c) => {
      if (!c.data) return api.report('sound-skipped', { id: c.id, reason: 'unreadable' });
      try {
        const bytes = c.data; // Uint8Array; decodeAudioData needs its own ArrayBuffer
        const decoded = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        if (c.clean) {
          const r = await cleanClip(decoded);
          next.set(c.id, r.buffer);
          cleaned[c.id] = r.stats;
        } else {
          next.set(c.id, decoded);
        }
      } catch (err) {
        api.report('sound-skipped', { id: c.id, label: c.label, reason: String(err && err.message ? err.message : err) });
      }
    }));
    if (gen !== loadGen) return; // a newer reload started meanwhile
    buffers = next;
    api.report('meows-loaded', {
      styles: [...buffers.keys()],
      seconds: Object.fromEntries([...buffers].map(([id, b]) => [id, +b.duration.toFixed(2)])),
      cleaned,
      sampleRate: ctx.sampleRate,
      state: ctx.state,
    });
  }

  let meowsReady = loadMeows().catch((err) => api.report('error', { message: 'meow load failed: ' + String(err) }));
  api.onMeowsChanged(() => {
    meowsReady = loadMeows().catch((err) => api.report('error', { message: 'meow reload failed: ' + String(err) }));
  });

  function pickStyle(style) {
    if (style !== 'random' && buffers.has(style)) return style;
    const all = [...buffers.keys()];
    const ids = all.filter((id) => id !== lastStyle);
    return ids.length ? ids[Math.floor(Math.random() * ids.length)] : all[0];
  }

  async function playMeow(style = meowStyle) {
    if (!soundOn) return api.report('audio', { ok: true, muted: true, requested: style });
    try {
      await meowsReady;
      if (ctx.state !== 'running') await ctx.resume();
      const id = pickStyle(style);
      const buf = buffers.get(id);
      if (!buf) throw new Error('no meow clips loaded');
      const now = ctx.currentTime;
      let interrupted = false;
      if (current) {
        // Fade the previous meow out instead of cutting it.
        const prev = current;
        prev.gain.gain.cancelScheduledValues(now);
        prev.gain.gain.setValueAtTime(prev.gain.gain.value, now);
        prev.gain.gain.linearRampToValueAtTime(0, now + FADE_S);
        try { prev.src.stop(now + FADE_S + 0.01); } catch (_) { /* already stopped */ }
        interrupted = true;
      }
      const vol = Math.min(1, Math.max(0, volume));
      const gain = ctx.createGain();
      gain.gain.value = vol;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain).connect(ctx.destination);
      const node = { src, gain };
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
        if (current === node) current = null;
      };
      src.start(now + (interrupted ? FADE_S / 2 : 0));
      current = node;
      lastStyle = id;
      api.report('audio', { ok: true, style: id, requested: style, volume: vol, interrupted, state: ctx.state });
    } catch (err) {
      api.report('audio', { ok: false, error: String(err) });
    }
  }

  // --- bubble ------------------------------------------------------------
  // persistent: stays until main says a cup was logged / the reminder was dismissed.
  // kind: 'water' (cup reminder) or 'alarm'. A logged cup only clears the water bubble.
  let bubbleKind = null;
  function showBubble(text, persistent, kind = 'water') {
    bubbleText.textContent = kind === 'alarm' ? `⏰ ${text}` : text;
    bubble.classList.add('shown');
    bubble.classList.toggle('alarm', kind === 'alarm');
    bubbleKind = kind;
    clearTimeout(bubbleTimer);
    if (!persistent) bubbleTimer = setTimeout(() => hideBubble('timeout'), BUBBLE_MS);
    api.report('bubble', { shown: true, text, kind, persistent: !!persistent });
  }
  function hideBubble(reason) {
    if (!bubble.classList.contains('shown')) return;
    clearTimeout(bubbleTimer);
    bubble.classList.remove('shown', 'alarm');
    bubbleKind = null;
    api.report('bubble', { shown: false, reason });
  }

  // --- mouse --------------------------------------------------------------
  // Windows can swallow the PRESS on a window that never takes focus (the cat never
  // does, so it can't steal focus from a game); the RELEASE always arrives. So:
  //  * a press is started by whichever comes first: this page's pointerdown, or main
  //    seeing Windows' WM_MOUSEACTIVATE (works even when the press is swallowed);
  //  * this page reports every left RELEASE (mouseup); main decides click / drag / resize;
  //  * the hover buttons act on release too.
  // Main needs to know where things are for the swallowed-press case:
  function sendHitRects() {
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    };
    const n = S.noseRect(reportedPose);
    const nose = n && { x: canvasLeft + n.x * CELL, y: SPRITE_TOP + n.y * CELL, width: n.w * CELL, height: n.h * CELL };
    api.hitRects({ pet: r(pet), grip: r(grip), buttons: [resetBtn, hideBtn, restartBtn, quitBtn, settingsBtn].map(r), nose });
  }

  // --- petting (Stage 3) ----------------------------------------------------
  // Stroking = mouse travel over her with no button held, summed over a rolling 1.2 s.
  // ~250 px of travel = one pet (main owns the 4 s cooldown and the counters).
  const STROKE_WINDOW_MS = 1200;
  const STROKE_PX = 250;
  let strokes = []; // [time, px]
  let lastMove = null;
  let lastAsk = 0;
  pet.addEventListener('pointermove', (e) => {
    if (e.buttons !== 0 || pressing || e.target.closest('button') || e.target === grip) {
      lastMove = null;
      return;
    }
    // SCREEN coordinates: when the window moves or resizes under a still mouse (drag,
    // chase, nap slide, wheel resize) the page sees fake "movement" in client coords.
    const now = performance.now();
    if (lastMove && now - lastMove.t < 200) strokes.push([now, Math.hypot(e.screenX - lastMove.x, e.screenY - lastMove.y)]);
    lastMove = { x: e.screenX, y: e.screenY, t: now };
    strokes = strokes.filter(([t]) => now - t <= STROKE_WINDOW_MS);
    const travel = strokes.reduce((a, [, d]) => a + d, 0);
    if (travel >= STROKE_PX && now - lastAsk > 1000) {
      lastAsk = now;
      strokes = [];
      api.pet().then((r) => api.report('stroke', { travel: Math.round(travel), ...r }));
    }
  });
  pet.addEventListener('pointerleave', () => { lastMove = null; });

  // Pixel hearts floating up from her head.
  function hearts(n) {
    const box = $hearts;
    const scale = Math.max(2, Math.round(CELL / 2));
    const grid = S.renderProp('heart');
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = grid[0].length * scale;
      c.height = grid.length * scale;
      const hg = c.getContext('2d');
      grid.forEach((row, y) => row.forEach((col, x) => { if (col) { hg.fillStyle = col; hg.fillRect(x * scale, y * scale, scale, scale); } }));
      const b = lastBox || { x: 60, y: 110, width: 140 };
      c.style.left = `${Math.round(b.x + b.width * (0.2 + Math.random() * 0.6) - c.width / 2)}px`;
      c.style.top = `${Math.round(b.y + 8)}px`;
      c.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 30)}px`);
      c.style.animationDelay = `${i * 220}ms`;
      c.addEventListener('animationend', () => c.remove());
      box.appendChild(c);
    }
  }
  const $hearts = document.getElementById('hearts');

  // Purr: brown noise -> low-pass -> amplitude-modulated at ~25 Hz -> fade in/out.
  // Only ever one purr: a new pet during a purr extends it instead of stacking.
  let purr = null; // { src, lfo, out, endAt }
  let brown = null;
  function brownNoise() {
    if (brown) return brown;
    const len = ctx.sampleRate * 2;
    brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return brown;
  }
  function purrFor(sec, quiet) {
    if (!soundOn) return api.report('purr', { muted: true });
    if (ctx.state !== 'running') ctx.resume();
    const now = ctx.currentTime;
    const level = Math.min(1, Math.max(0, volume)) * (quiet ? 0.3 : 0.9);
    const shape = (p) => {
      const g = p.out.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(level, now + 0.35); // gentle fade-in
      g.setValueAtTime(level, Math.max(now + 0.35, p.endAt - 0.7));
      g.linearRampToValueAtTime(0, p.endAt); // gentle fade-out
      p.src.stop(p.endAt + 0.05);
      p.lfo.stop(p.endAt + 0.05);
    };
    if (purr) {
      purr.endAt = Math.max(purr.endAt, now + sec);
      shape(purr);
      return api.report('purr', { extended: true, until: +(purr.endAt - now).toFixed(2), level: +level.toFixed(2), quiet: !!quiet });
    }
    const src = ctx.createBufferSource();
    src.buffer = brownNoise();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const am = ctx.createGain();
    am.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 25; // the purr rumble
    const depth = ctx.createGain();
    depth.gain.value = 0.45;
    lfo.connect(depth).connect(am.gain);
    const out = ctx.createGain();
    out.gain.value = 0;
    src.connect(lp).connect(am).connect(out).connect(ctx.destination);
    const p = { src, lfo, out, endAt: now + sec };
    purr = p;
    src.onended = () => {
      [src, lp, am, lfo, depth, out].forEach((n) => { try { n.disconnect(); } catch (_) { /* gone */ } });
      if (purr === p) purr = null;
    };
    src.start(now);
    lfo.start(now);
    shape(p);
    api.report('purr', { started: true, seconds: sec, level: +level.toFixed(2), quiet: !!quiet });
  }
  window.__purrActive = () => !!purr; // selftest: never more than one

  // Nose boop squeak: a tiny rising chirp.
  function squeak(quiet) {
    if (!soundOn) return api.report('squeak', { muted: true });
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1700, now);
    o.frequency.exponentialRampToValueAtTime(2700, now + 0.08);
    const lvl = Math.min(1, Math.max(0, volume)) * (quiet ? 0.1 : 0.25);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(lvl, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g).connect(ctx.destination);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    o.start(now);
    o.stop(now + 0.14);
    api.report('squeak', { ok: true });
  }

  api.onPetted((p) => {
    const waking = anim === 'wake'; // petted awake: let her stretch out of her spot first
    if (p.kind === 'boop') {
      if (!waking) playAnim('boop');
      squeak(p.quiet);
      hearts(2);
    } else {
      if (!waking) playAnim('belly');
      hearts(5);
      purrFor(3.2, p.quiet);
    }
  });

  // Diagnostics: every press that reaches the page, wherever it lands (capture phase).
  window.addEventListener('pointerdown', (e) => {
    api.report('input', { ev: 'page-down', button: e.button, target: e.target.id || e.target.tagName, x: Math.round(e.clientX), y: Math.round(e.clientY) });
  }, true);

  // Resize with the mouse: drag the corner handle (main follows the cursor), or scroll.
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    document.body.classList.add('resizing');
    api.resizeStart();
  });
  let wheelAt = 0;
  pet.addEventListener('wheel', (e) => {
    if (!document.body.classList.contains('can-resize')) return;
    e.preventDefault();
    const now = Date.now();
    if (now - wheelAt < 120) return; // one step per notch, not a flood
    wheelAt = now;
    api.resizeStep(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  pet.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || e.target === grip) return;
    pressing = true;
    try { pet.setPointerCapture(e.pointerId); } catch (_) { /* optional */ }
    api.report('input', { ev: 'down', pointer: e.pointerType });
    api.pressStart();
  });

  // Every left release, anywhere in the window (mouseup fires even if the press was
  // swallowed; pointerup may not).
  const BUTTON_ACTIONS = {
    'reset-btn': () => api.resetCups(),
    'hide-btn': () => api.hideCat(),
    'restart-btn': () => api.restartApp(),
    'quit-btn': () => api.quitApp(),
    'settings-btn': () => api.openSettings(),
  };
  window.addEventListener('mouseup', async (e) => {
    if (e.button !== 0) return;
    const btn = e.target.closest && e.target.closest('button');
    pressing = false;
    pet.classList.remove('dragging');
    document.body.classList.remove('resizing');
    const r = await api.release({ onButton: !!btn });
    api.report('input', { ev: 'up', target: e.target.id || e.target.tagName, click: !!(r && r.click), how: r && r.how });
    if (btn && BUTTON_ACTIONS[btn.id]) BUTTON_ACTIONS[btn.id]();
    else if (r && r.click) {
      hop();
      playMeow();
      hideBubble('click');
    }
  });

  window.addEventListener('pointercancel', () => {
    if (!pressing) return;
    pressing = false;
    pet.classList.remove('dragging');
    api.report('input', { ev: 'cancel' });
    api.pressCancel();
  });

  api.onDragBegan(() => pet.classList.add('dragging'));

  // Right-click: do NOT preventDefault - main builds the menu from 'context-menu'.
  pet.addEventListener('dragstart', (e) => e.preventDefault());

  // --- from main ---------------------------------------------------------
  api.onState((s) => {
    render(s);
    if (s.added && bubbleKind === 'water') hideBubble(s.source === 'click' ? 'click' : 'cup');
    if (s.hop) hop();
  });
  api.onReminder((r) => {
    if (typeof r.volume === 'number') volume = r.volume;
    if (typeof r.meowStyle === 'string') meowStyle = r.meowStyle;
    showBubble(r.text, r.persistent, r.kind);
    hop(); // a little jump each time, so a repeat gets noticed
    playMeow();
  });
  api.onHideBubble((reason) => hideBubble(reason || 'main'));
  // Quiet, short bubbles (not persistent; a reminder/alarm replaces them, they never cover one):
  // first launch: Gargorl's line; 'update': a new version is ready. No sound.
  api.onIntro((b) => {
    const kind = b.kind || 'intro';
    if (bubble.classList.contains('shown') && bubbleKind !== kind) return;
    showBubble(b.text, false, kind);
  });
  api.onBubbleSet((b) => {
    if (bubble.classList.contains('shown') && bubbleKind === b.kind && bubbleText.textContent.endsWith(b.text)) return;
    showBubble(b.text, true, b.kind);
  });

  api.onPlayMeow((m) => {
    if (m && typeof m.volume === 'number') volume = m.volume;
    playMeow(m && m.style ? m.style : meowStyle);
  });

  api.onPose((p) => {
    base = { pose: p.pose, facing: p.facing === -1 ? -1 : 1, spot: p.spot || null };
    // walking interrupts a one-shot; going to sleep lets the "sleep-enter" animation finish
    if (anim && p.pose === 'walk') { anim = null; }
    runBase();
  });
  api.onAnim((a) => playAnim(a.name, a));
  api.onColorsChanged((l) => applyLook(l));

  api.getState().then((s) => {
    render(s);
    if (s.pose) base = { pose: s.pose, facing: 1 };
    runBase();
    const rect = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    // cat = the drawn sitting cat, in window coordinates
    api.report('ready', { cat: lastBox, hideBtn: rect(hideBtn), resetBtn: rect(resetBtn), restartBtn: rect(restartBtn), quitBtn: rect(quitBtn), grip: rect(grip) });
  });
})();
