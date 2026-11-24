'use strict';
// Customize window page. Loaded ONLY by customize.html. Every change is sent to main
// (applySettings -> atomic save -> the cat redraws on 'colors-changed').
(() => {
  const api = window.customizeApi;
  const S = window.CatSprite;
  const $ = (id) => document.getElementById(id);

  window.addEventListener('error', (e) => api.report('error', { message: e.message, line: e.lineno }));

  const PART_LABELS = {
    eyes: 'Eyes', pupils: 'Pupils', eyeShine: 'Eye shine', earOuter: 'Ear outer', earInner: 'Ear inner', nose: 'Nose',
    mouth: 'Mouth', tail: 'Tail', paws: 'Paws', whiskers: 'Whiskers', belly: 'Belly', cheeks: 'Cheeks',
    furBase: 'Fur base', furShade: 'Fur shade', muzzle: 'Muzzle / chest', patchA: 'Patch A', patchB: 'Patch B', outline: 'Outline',
  };
  // Basic tab: the 16 parts from the brief (pupils + eye shine are in Advanced)
  const BASIC_PARTS = ['eyes', 'earOuter', 'earInner', 'nose', 'mouth', 'tail', 'paws', 'whiskers', 'belly', 'cheeks',
    'furBase', 'furShade', 'muzzle', 'patchA', 'patchB', 'outline'];
  const PATTERN_LABELS = { solid: 'Solid', tabby: 'Tabby stripes', tuxedo: 'Tuxedo', calico: 'Calico patches', spots: 'Spots', points: 'Colourpoint (Siamese)' };
  const MAIN_PRESETS = ['gargorl', 'fainu', 'orangetabby', 'black', 'white', 'graytabby', 'siamese', 'tuxedo'];

  let st = null; // last settings from main
  const status = $('status');
  let statusTimer = null;
  function showStatus(text, isError) {
    status.textContent = text;
    status.classList.toggle('error', !!isError);
    clearTimeout(statusTimer);
    if (!isError) statusTimer = setTimeout(() => { status.textContent = ''; }, 1800);
  }

  // ---- drawing --------------------------------------------------------------
  function lookOf(s) {
    return { colors: s.colors, pattern: s.furPattern, ears: s.earStyle, fluffy: s.fluffy, tufts: s.tufts, tail: s.tail, whiskers: s.whiskersEnabled };
  }
  function draw(canvas, look, frame = 'sit') {
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    const cell = Math.floor(canvas.width / S.CANVAS.cols);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.save();
    g.translate(0, -(S.CANVAS.rows - 19) * cell); // skip the empty rows kept for the cat tree
    S.render('sit', frame, look, 1).forEach((row, y) => row.forEach((col, x) => {
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x * cell, y * cell, cell, cell);
    }));
    g.fillStyle = look.colors.whiskers;
    for (const [px, py, t] of S.whiskerSquares(S.whiskerLines('sit', frame, look, 1), cell)) g.fillRect(px, py, t, t);
    g.restore();
  }

  // ---- sleeping spot (Stage E): per-cat spot + colours, global sleep toggles ----------
  const spotPreview = $('spot-preview');
  let spotShown = 'bed';
  function drawSpot() {
    if (!st) return;
    const g = spotPreview.getContext('2d');
    g.imageSmoothingEnabled = false;
    const cell = Math.floor(spotPreview.width / S.CANVAS.cols);
    g.clearRect(0, 0, spotPreview.width, spotPreview.height);
    const sc = S.SPOT_CAT[spotShown];
    const r = S.renderScene({ pose: sc.pose, frame: sc.frames[0], look: lookOf(st), place: sc.place, spot: spotShown, spotColors: st.sleepSpotColors, overlay: sc.overlay });
    for (const grid of [r.under, r.over]) grid.forEach((row, y) => row.forEach((col, x) => {
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x * cell, y * cell, cell, cell);
    }));
  }
  function spotColor(part) {
    return (st.sleepSpotColors && st.sleepSpotColors[part]) || S.SPOT_DEFAULT_COLORS[part];
  }
  function setSpotColors(colors) {
    queue({ sleepSpotColors: colors });
    fillSpotColors();
    drawSpot();
  }
  function fillSpotColors() {
    const box = $('spot-colors');
    const spots = st.sleepSpot === 'random' ? S.SPOT_IDS : st.sleepSpot === 'none' ? [] : [st.sleepSpot];
    box.replaceChildren(...spots.map((spot) => {
      const block = document.createElement('div');
      block.className = 'spot-block';
      block.dataset.spot = spot;
      const h = document.createElement('h3');
      h.textContent = { bed: 'Cat bed', tree: 'Cat tree', box: 'Cardboard box' }[spot];
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = 'Reset';
      reset.id = `spot-reset-${spot}`;
      reset.addEventListener('click', () => {
        const c = { ...(st.sleepSpotColors || {}) };
        for (const p of S.SPOT_PARTS[spot]) delete c[p];
        setSpotColors(c);
        showStatus(`${h.firstChild.textContent} colours reset`);
      });
      h.append(reset);
      block.append(h);
      block.addEventListener('mouseenter', () => { spotShown = spot; drawSpot(); });
      for (const part of S.SPOT_PARTS[spot]) {
        const row = document.createElement('div');
        row.className = 'spot-part';
        const name = document.createElement('span');
        name.textContent = S.SPOT_LABELS[part];
        const pick = document.createElement('input');
        pick.type = 'color';
        pick.id = `spot-${part}`;
        pick.value = spotColor(part);
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.value = spotColor(part);
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.textContent = '💧';
        drop.title = 'Pick a colour from the screen';
        const set = (v) => {
          if (!/^#[0-9a-f]{6}$/i.test(v)) return false;
          spotShown = spot;
          setSpotColors({ ...(st.sleepSpotColors || {}), [part]: v.toLowerCase() });
          return true;
        };
        pick.addEventListener('input', () => set(pick.value));
        hex.addEventListener('change', () => { if (!set(hex.value.trim())) showStatus('Use a hex colour like #c8955a', true); });
        drop.addEventListener('click', async () => {
          if (typeof window.EyeDropper !== 'function') return showStatus("The eyedropper isn't available here", true);
          try {
            const res = await new window.EyeDropper().open();
            set(res.sRGBHex);
          } catch (_) { /* cancelled */ }
        });
        row.append(name, pick, hex, drop);
        block.append(row);
      }
      return block;
    }));
  }
  function fillSleep() {
    $('sleepSpot').value = st.sleepSpot || 'random';
    $('sleepSpot').previousSibling.textContent = `Where ${pr().they} sleeps`;
    if (st.sleepSpot && !['random', 'none'].includes(st.sleepSpot)) spotShown = st.sleepSpot;
    $('idleSleepEnabled').checked = st.idleSleepEnabled;
    if (document.activeElement !== $('idleSleepMinutes')) $('idleSleepMinutes').value = st.idleSleepMinutes;
    $('quietSleepEnabled').checked = st.quietSleepEnabled;
    $('systemIdleSleep').checked = st.systemIdleSleep;
    fillSpotColors();
    drawSpot();
  }
  $('sleepSpot').addEventListener('change', (e) => {
    queue({ sleepSpot: e.target.value });
    fillSleep();
  });
  $('preview-sleep').addEventListener('click', async () => {
    await flush();
    const ok = await api.previewSleep(st.sleepSpot === 'random' ? spotShown : st.sleepSpot);
    $('spot-msg').textContent = ok ? (st.selectedCatId === st.activeCatId ? 'Look at the desktop cat 💤' : 'Shown on the cat on the desktop 💤')
      : 'She is hidden or being dragged right now.';
  });
  async function setGlobal(partial) {
    st = await api.setGlobal(selectedId, partial);
    fillSleep();
    showStatus('Saved ✓');
  }
  for (const id of ['idleSleepEnabled', 'quietSleepEnabled', 'systemIdleSleep']) {
    $(id).addEventListener('change', (e) => setGlobal({ [id]: e.target.checked }));
  }
  $('idleSleepMinutes').addEventListener('change', (e) => {
    const n = Math.round(Number(e.target.value));
    if (n >= 1 && n <= 120) setGlobal({ idleSleepMinutes: n });
    else { e.target.value = st.idleSleepMinutes; showStatus('Pick 1 to 120 minutes', true); }
  });
  const preview = $('preview');
  let previewTimer = null;
  function drawPreview(frame) {
    if (st) draw(preview, lookOf(st), frame);
  }
  function blinkLoop() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      drawPreview('blink');
      previewTimer = setTimeout(() => { drawPreview('sit'); blinkLoop(); }, 160);
    }, 2500 + Math.random() * 3000);
  }

  // ---- saving (throttled: colour pickers fire many events while dragging) ----
  let pending = {};
  let sendTimer = null;
  function queue(partial) {
    // merge colours part by part
    if (partial.colors) pending.colors = { ...(pending.colors || {}), ...partial.colors };
    for (const [k, v] of Object.entries(partial)) if (k !== 'colors') pending[k] = v;
    // local state follows immediately so the preview is live
    st = { ...st, ...partial, colors: { ...st.colors, ...(partial.colors || {}) } };
    drawPreview();
    if (!sendTimer) sendTimer = setTimeout(flush, 80);
  }
  async function flush() {
    clearTimeout(sendTimer);
    sendTimer = null;
    const p = pending;
    pending = {};
    if (!Object.keys(p).length) return;
    const forCat = selectedId; // the cat these edits belong to
    try {
      const s = await api.set(forCat, p);
      if (forCat === selectedId) {
        st = s;
        fillCatList(s);
        refreshActivePreset();
      }
      api.report('saved', { catId: forCat, keys: Object.keys(p) });
      showStatus('Saved ✓');
    } catch (err) {
      showStatus('Could not save', true);
      api.report('error', { message: String(err) });
    }
  }

  // ---- cat selector: each cat is saved on its own ------------------------------------
  let selectedId = null;
  const catSel = $('cat-select');
  const SYMBOL = { female: '♀', male: '♂', unspecified: '⚧' };
  // Pronouns for text we generate (gender changes nothing else)
  const PRONOUNS = {
    female: { they: 'she', them: 'her', their: 'her' },
    male: { they: 'he', them: 'him', their: 'his' },
    unspecified: { they: 'they', them: 'them', their: 'their' },
  };
  const pr = (s = st) => PRONOUNS[(s && s.catGender) || 'unspecified'] || PRONOUNS.unspecified;
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  window.__pronouns = pr; // selftest
  function fillCatList(s) {
    catSel.replaceChildren(...s.cats.map((c) => new Option(`${c.name} ${SYMBOL[c.gender] || ''}${c.id === s.activeCatId ? '  (on desktop)' : ''}`, c.id)));
    catSel.value = selectedId;
    $('active-badge').hidden = selectedId !== s.activeCatId;
    $('cat-active').disabled = selectedId === s.activeCatId;
    $('cat-del').disabled = s.cats.length <= 1;
    // only shown when Gargorl or Fainu was deleted
    const missing = s.missingStarters || [];
    $('restore-starters').hidden = !missing.length;
    $('restore-starters').textContent = `↩ Restore ${missing.map((id) => (id === 'gargorl' ? 'Gargorl' : 'Fainu')).join(' & ')}`;
  }
  // While a cat is being selected / created / deleted, main's "changed" broadcasts are
  // ignored: they race with the answer and could switch the window back to the old cat
  // (then typing would rename the wrong cat).
  let catBusy = 0;
  async function catOp(fn) {
    catBusy += 1;
    try {
      // typing still waiting for its 500 ms pause belongs to the cat we're leaving: save it now
      clearTimeout(typingTimer);
      saveName();
      saveDesc();
      await flush(); // finish saving edits for the cat we're leaving
      const v = await fn();
      if (v) fill(v, true);
      return v;
    } finally {
      catBusy -= 1;
    }
  }
  async function selectCat(id) {
    await catOp(() => api.get(id));
    api.report('selected', { catId: selectedId });
  }
  catSel.addEventListener('change', () => selectCat(catSel.value));
  $('cat-new').addEventListener('click', async () => {
    const v = await catOp(() => api.newCat());
    nameIn.focus();
    nameIn.select();
    showStatus(`${v.catName} created - type ${pr(v).their} name`);
  });
  $('cat-dup').addEventListener('click', async () => {
    const v = await catOp(() => api.duplicateCat(selectedId));
    showStatus(`Duplicated as ${v.catName}`);
  });
  $('cat-del').addEventListener('click', async () => {
    if (st.cats.length <= 1) return showStatus("Can't delete the last cat", true);
    if (!window.__autoConfirm && !window.confirm(`Delete ${st.catName}? ${cap(pr().their)} look and pets count will be gone.`)) return;
    pending = {};
    let err = null;
    await catOp(async () => {
      const r = await api.deleteCat(selectedId);
      if (!r.ok) err = r.error;
      return r.ok ? r.view : null;
    });
    showStatus(err || 'Cat deleted', !!err);
  });
  $('restore-starters').addEventListener('click', async () => {
    let restored = [];
    await catOp(async () => {
      const r = await api.restoreStarters(selectedId);
      restored = r.restored;
      return r.view;
    });
    showStatus(restored.length ? `Restored ${restored.join(' & ')}` : 'Nothing to restore');
  });
  $('cat-active').addEventListener('click', async () => {
    await catOp(() => api.setActive(selectedId));
    showStatus(`${st.catName} is on the desktop now`);
  });

  // ---- header card: name, gender, description (saved for THIS cat) ---------------
  const nameIn = $('catName');
  const descIn = $('catDescriptor');
  let typingTimer = null;
  const saveName = () => {
    const v = nameIn.value.replace(/\s+/g, ' ').trim();
    if (!v) return showStatus(`${cap(pr().they)} ${pr().they === 'they' ? 'need' : 'needs'} a name`, true);
    if (v !== st.catName) queue({ catName: v });
  };
  const saveDesc = () => {
    const v = descIn.value;
    if (v.length > 200) return showStatus('200 characters max', true);
    if (v.trim() !== (st.catDescriptor || '').trim()) queue({ catDescriptor: v });
  };
  // save ~500 ms after typing stops, and on blur
  nameIn.addEventListener('input', () => { clearTimeout(typingTimer); typingTimer = setTimeout(saveName, 500); });
  nameIn.addEventListener('blur', () => { clearTimeout(typingTimer); saveName(); });
  descIn.addEventListener('input', () => {
    $('desc-count').textContent = descIn.value.length;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(saveDesc, 500);
  });
  descIn.addEventListener('blur', () => { clearTimeout(typingTimer); saveDesc(); });
  $('catGender').addEventListener('change', (e) => queue({ catGender: e.target.value }));

  // ---- tabs ------------------------------------------------------------------------
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $('panel-basic').hidden = t.dataset.tab !== 'basic';
    $('panel-advanced').hidden = t.dataset.tab !== 'advanced';
  }));

  // ---- Basic: presets --------------------------------------------------------------
  const presetsBox = $('presets');
  function buildPresets(s) {
    presetsBox.replaceChildren();
    const ids = [...MAIN_PRESETS, ...s.breeds.map((b) => b.id).filter((id) => !MAIN_PRESETS.includes(id))];
    for (const id of ids) {
      const p = S.PRESETS[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.preset = id;
      const c = document.createElement('canvas');
      c.width = 60;
      c.height = 38;
      draw(c, { colors: p.colors, pattern: p.pattern, ears: p.ears, fluffy: p.fluffy, tufts: p.tufts, tail: true, whiskers: true });
      b.append(c, document.createTextNode(p.label));
      // the look's own description (a cat picks it up unless she has written her own)
      b.title = p.description ? `${p.label}: ${p.description.replace(/\{They\}/g, 'They').replace(/\{they\}/g, 'they').replace(/\{them\}/g, 'them').replace(/\{their\}/g, 'their').replace(/\{s\}/g, '')}` : p.label;
      b.addEventListener('click', () => {
        queue({ breed: id });
        // main expands the preset; show it right away from the sprite data too
        st = { ...st, breed: id, colors: { ...p.colors }, furPattern: p.pattern, earStyle: p.ears, fluffy: p.fluffy, tufts: p.tufts };
        fillLook();
      });
      presetsBox.appendChild(b);
    }
    refreshActivePreset();
  }
  function refreshActivePreset() {
    presetsBox.querySelectorAll('button').forEach((b) => b.classList.toggle('active', st && b.dataset.preset === st.breed));
  }
  // Reset to THIS cat's own default look (Gargorl: gray, Fainu: calico, new cats: Gargorl's)
  $('reset').addEventListener('click', () => {
    const id = st.catDefaultPreset || 'gargorl';
    (presetsBox.querySelector(`[data-preset="${id}"]`) || presetsBox.querySelector('[data-preset="gargorl"]')).click();
    api.report('reset', { catId: selectedId, preset: id });
  });

  // Randomize: a harmonious random cat
  const hsl = (h, s, l) => {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return rgbToHex(f(0), f(8), f(4));
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);
  $('randomize').addEventListener('click', () => {
    const h = rnd(0, 360);
    const s = rnd(5, 55);
    const l = rnd(28, 78);
    const colors = {
      furBase: hsl(h, s, l), furShade: hsl(h, s, l - 10), muzzle: hsl(h, s * 0.6, Math.min(94, l + 18)),
      patchA: pick([hsl(h, s, l - 22), '#e8913a', '#4a4040', hsl((h + 30) % 360, s, l - 15)]), patchB: hsl(h, s * 0.4, Math.min(96, l + 22)),
      outline: hsl(h, s * 0.5, Math.max(8, l - 45)), eyes: pick(['#bfd35a', '#62a8e8', '#e6a23c', '#9ccc4a', '#f2c230', '#d97f2e', '#4f8fe8']),
      pupils: '#1f2226', eyeShine: '#f5f8d8', earOuter: hsl(h, s, l), earInner: pick(['#f4a6b8', '#d9a3ae', '#8a7880', '#c98a95']),
      nose: pick(['#f19aa8', '#e7838f', '#6f6870', '#8b7a82', '#4a3a42']), mouth: hsl(h, 20, 25), tail: hsl(h, s, l),
      paws: pick([hsl(h, s, l), hsl(h, s * 0.4, Math.min(95, l + 22))]), belly: hsl(h, s * 0.5, Math.min(94, l + 16)),
      cheeks: hsl(350, 50, Math.min(85, l + 10)), whiskers: '#e6e6ea',
    };
    queue({ colors, furPattern: pick(['solid', 'tabby', 'tuxedo', 'calico', 'spots']) });
    fillLook();
    api.report('randomized', { colors: colors.furBase });
  });

  // ---- Basic: swatches, toggles, pattern, size --------------------------------------
  const swatchBox = $('swatches');
  for (const part of BASIC_PARTS) {
    const lab = document.createElement('label');
    lab.textContent = PART_LABELS[part];
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.id = `sw-${part}`;
    inp.addEventListener('input', () => setPart(part, inp.value));
    lab.appendChild(inp);
    swatchBox.appendChild(lab);
  }
  $('tail').addEventListener('change', (e) => queue({ tail: e.target.checked }));
  $('whiskersEnabled').addEventListener('change', (e) => queue({ whiskersEnabled: e.target.checked }));
  const patternSel = $('furPattern');
  for (const p of S.PATTERNS) patternSel.add(new Option(PATTERN_LABELS[p] || p, p));
  patternSel.addEventListener('change', () => queue({ furPattern: patternSel.value }));
  document.querySelectorAll('input[name="size"]').forEach((r) => r.addEventListener('change', () => queue({ catSize: Number(r.value) })));

  function setPart(part, hex) {
    queue({ colors: { [part]: hex.toLowerCase() } });
    if (part === advPart) fillEditor();
    const sw = $(`sw-${part}`);
    if (sw && document.activeElement !== sw) sw.value = hex;
  }

  // ---- Advanced: one part editor ------------------------------------------------------
  const partSel = $('part');
  for (const part of S.PARTS) partSel.add(new Option(PART_LABELS[part] || part, part));
  let advPart = 'eyes';
  partSel.value = advPart;
  partSel.addEventListener('change', () => { advPart = partSel.value; fillEditor(); });

  function hexToRgb(h) {
    return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [Math.round((h * 60 + 360) % 360), Math.round(max ? (d / max) * 100 : 0), Math.round(max * 100)];
  }
  function hsvToRgb(h, s, v) {
    s /= 100; v /= 100;
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5) * 255, f(3) * 255, f(1) * 255];
  }
  function fillEditor() {
    if (!st) return;
    const hex = st.colors[advPart];
    const [r, g, b] = hexToRgb(hex);
    const [h, s, v] = rgbToHsv(r, g, b);
    $('big-swatch').style.background = hex;
    if (document.activeElement !== $('hex')) $('hex').value = hex;
    for (const [id, val] of [['r', r], ['g', g], ['b', b]]) if (document.activeElement !== $(id)) $(id).value = val;
    for (const [id, val] of [['h', h], ['s', s], ['v', v]]) if (document.activeElement !== $(id)) $(id).value = val;
  }
  $('hex').addEventListener('input', (e) => {
    let v = e.target.value.trim();
    if (/^[0-9a-fA-F]{6}$/.test(v)) v = '#' + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) setPart(advPart, v);
  });
  for (const id of ['r', 'g', 'b']) {
    $(id).addEventListener('input', () => {
      const [r, g, b] = ['r', 'g', 'b'].map((k) => Number($(k).value));
      if ([r, g, b].every((x) => Number.isFinite(x) && x >= 0 && x <= 255)) setPart(advPart, rgbToHex(r, g, b));
    });
  }
  for (const id of ['h', 's', 'v']) {
    $(id).addEventListener('input', () => {
      const [r, g, b] = hsvToRgb(Number($('h').value), Number($('s').value), Number($('v').value));
      setPart(advPart, rgbToHex(r, g, b));
    });
  }

  // Eyedropper: pick any colour on the screen (Chromium EyeDropper API)
  $('eyedropper').addEventListener('click', async () => {
    const msg = $('eyedropper-msg');
    if (typeof window.EyeDropper !== 'function') {
      msg.textContent = "The eyedropper isn't available here - type a hex colour instead.";
      api.report('eyedropper', { ok: false, reason: 'unavailable' });
      return;
    }
    msg.textContent = 'Click anywhere on the screen… (Esc cancels)';
    try {
      const res = await new window.EyeDropper().open();
      setPart(advPart, res.sRGBHex.length === 7 ? res.sRGBHex : rgbToHex(...(res.sRGBHex.match(/\d+/g) || [0, 0, 0]).map(Number)));
      msg.textContent = `Picked ${res.sRGBHex}`;
      api.report('eyedropper', { ok: true, hex: res.sRGBHex });
    } catch (err) {
      msg.textContent = 'Eyedropper cancelled or not available - the hex field still works.';
      api.report('eyedropper', { ok: false, reason: String(err && err.name) });
    }
  });

  // My presets
  function fillMyPresets(list) {
    const ul = $('my-presets');
    ul.replaceChildren();
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No saved looks yet.';
      ul.appendChild(li);
      return;
    }
    for (const p of list) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = p.name;
      const load = document.createElement('button');
      load.type = 'button';
      load.textContent = 'Load';
      load.addEventListener('click', async () => {
        const r = await api.applyLook(selectedId, p.look);
        showStatus(r.ok ? `Loaded "${p.name}"` : r.error, !r.ok);
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.title = 'Delete';
      del.addEventListener('click', () => api.deletePreset(p.name));
      li.append(span, load, del);
      ul.appendChild(li);
    }
  }
  $('save-preset').addEventListener('click', async () => {
    await flush();
    const r = await api.savePreset(selectedId, $('preset-name').value);
    showStatus(r.ok ? 'Look saved ✓' : r.error, !r.ok);
    if (r.ok) $('preset-name').value = '';
  });

  // Export / import
  $('export').addEventListener('click', async () => {
    await flush();
    const r = await api.exportLook(selectedId, st.catName);
    if (r.cancelled) return;
    showStatus(r.ok ? 'Exported ✓' : r.error, !r.ok);
  });
  $('import').addEventListener('click', async () => {
    const r = await api.importLook(selectedId);
    if (r.cancelled) return;
    showStatus(r.ok ? `Imported${r.name ? ` "${r.name}"` : ''} ✓` : r.error, !r.ok);
  });

  // ---- fill from settings ------------------------------------------------------------
  function fillLook() {
    for (const part of BASIC_PARTS) {
      const sw = $(`sw-${part}`);
      if (document.activeElement !== sw) sw.value = st.colors[part];
    }
    $('tail').checked = st.tail;
    $('whiskersEnabled').checked = st.whiskersEnabled;
    patternSel.value = st.furPattern;
    const sizeR = document.querySelector(`input[name="size"][value="${st.catSize}"]`);
    document.querySelectorAll('input[name="size"]').forEach((r) => { r.checked = r === sizeR; });
    $('size-note').textContent = sizeR ? '' : `(now ${Math.round((st.catSize / 8) * 100)}% - set in Settings)`;
    fillEditor();
    drawPreview();
    refreshActivePreset();
  }
  // force: switching cats always refreshes every field, even the one being typed in
  // Locked look (Gargorl + Fainu by default): colours / presets / pattern can't change.
  function applyLock() {
    const locked = !!st.catLookLocked;
    document.body.classList.toggle('locked', locked);
    $('catLookLocked').checked = locked;
    $('lock-note').textContent = locked
      ? `${st.catName}'s look is protected. Untick to change ${pr().their} colours, preset or pattern.`
      : 'Tick to protect this look from changes.';
    const sel = '#presets button, #randomize, #swatches input, #furPattern, #hex, #r, #g, #b, #h, #s, #v, #eyedropper, #import, #my-presets button';
    document.querySelectorAll(sel).forEach((el) => {
      if (el.closest('#my-presets') && el.textContent === '×') return; // deleting a saved look is fine
      el.disabled = locked;
    });
  }
  $('catLookLocked').addEventListener('change', (e) => {
    queue({ catLookLocked: e.target.checked });
    applyLock();
    showStatus(e.target.checked ? 'Look locked' : 'Look unlocked');
  });

  function fill(s, force) {
    st = s;
    selectedId = s.selectedCatId;
    if (force || document.activeElement !== nameIn) nameIn.value = s.catName;
    if (force || document.activeElement !== descIn) descIn.value = s.catDescriptor || '';
    $('desc-count').textContent = descIn.value.length;
    descIn.placeholder = `Write something about ${s.catName}...`;
    $('catGender').value = s.catGender;
    // read-only label: follows the cat's id ("In loving memory of" only for Gargorl)
    $('label-badge').textContent = s.catLabel || 'About';
    $('label-badge').classList.toggle('memory', s.catLabel && s.catLabel !== 'About');
    fillCatList(s);
    fillLook();
    fillMyPresets(s.customPresets || []);
    applyLock();
    fillSleep();
  }

  // Something changed elsewhere (menu, Settings, another cat): reload the cat we show.
  api.onChanged(async () => {
    if (catBusy || sendTimer || Object.keys(pending).length) return; // our own change is on its way; its answer refreshes us
    const id = selectedId;
    const v = await api.get(id);
    if (catBusy || id !== selectedId) return; // the selection changed meanwhile: this answer is stale
    fill(v);
  });
  $('close').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

  api.get().then((s) => {
    st = s;
    selectedId = s.selectedCatId;
    buildPresets(s);
    fill(s);
    blinkLoop();
    api.report('ready', { breed: s.breed, eyedropper: typeof window.EyeDropper === 'function', presets: presetsBox.children.length });
  });
})();
