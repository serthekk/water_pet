'use strict';
// Settings page. Loaded ONLY by settings.html. Every change is saved and applied immediately.
(() => {
  const api = window.settingsApi;
  const $ = (id) => document.getElementById(id);
  const volume = $('volume');
  const volumeOut = $('volume-out');
  const status = $('status');
  let statusTimer = null;
  let volumeTimer = null;

  window.addEventListener('error', (e) => api.report('error', { message: e.message, line: e.lineno }));

  function showStatus(text, isError) {
    status.textContent = text;
    status.classList.toggle('error', !!isError);
    clearTimeout(statusTimer);
    if (!isError) statusTimer = setTimeout(() => { status.textContent = ''; }, 1500);
  }

  const styleSel = $('meowStyle');

  function fillStyles(list, selected) {
    styleSel.replaceChildren(new Option('Random (mix it up)', 'random'));
    const groups = [['builtin', 'Built-in'], ['user', 'Your sounds']];
    for (const [key, title] of groups) {
      const items = list.filter((m) => m.group === key);
      if (!items.length) continue;
      const g = document.createElement('optgroup');
      g.label = title;
      for (const m of items) g.appendChild(new Option(m.label, m.id));
      styleSel.appendChild(g);
    }
    styleSel.value = selected;
    if (styleSel.value !== selected) styleSel.value = 'random';
  }

  // Live preview of her look (same sprite code as the cat, 4 px cells). The look itself
  // is edited in the Customize window.
  const preview = $('preview');
  let previewTimer = null;
  let lastS = null; // the settings main last confirmed
  function drawPreview(frame = 'sit') {
    const S = window.CatSprite;
    if (!lastS) return;
    const g = preview.getContext('2d');
    g.imageSmoothingEnabled = false;
    const cell = preview.width / S.CANVAS.cols;
    g.clearRect(0, 0, preview.width, preview.height);
    g.save();
    g.translate(0, -(S.CANVAS.rows - 19) * cell); // the rows above her are room for the cat tree
    const look = {
      colors: lastS.colors, pattern: lastS.furPattern, ears: lastS.earStyle, fluffy: lastS.fluffy, tufts: lastS.tufts,
      tail: lastS.tail, whiskers: lastS.whiskersEnabled,
    };
    S.render('sit', frame, look, 1).forEach((row, y) => row.forEach((col, x) => {
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x * cell, y * cell, cell, cell);
    }));
    g.fillStyle = look.colors.whiskers;
    for (const [px, py, t] of S.whiskerSquares(S.whiskerLines('sit', frame, look, 1), cell)) g.fillRect(px, py, t, t);
    g.restore();
  }
  function blinkLoop() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      drawPreview('blink');
      previewTimer = setTimeout(() => { drawPreview('sit'); blinkLoop(); }, 160);
    }, 2500 + Math.random() * 3000);
  }

  // --- Alarms editor ------------------------------------------------------
  const alarmsBox = $('alarms');
  let savedAlarms = [];

  function alarmRow(a, isNew) {
    const row = document.createElement('div');
    row.className = 'alarm-row' + (a.enabled ? '' : ' off');
    row.dataset.id = a.id;
    row.innerHTML = `
      <input class="a-on" type="checkbox" title="On / off">
      <input class="a-time" type="time" required>
      <span></span>
      <button class="a-test" type="button" title="Test this alarm now">▶</button>
      <button class="a-del" type="button" title="Delete">×</button>
      <input class="a-text" type="text" maxlength="120" placeholder="Message (e.g. Pill time!)">`;
    row.querySelector('.a-on').checked = a.enabled;
    row.querySelector('.a-time').value = a.time;
    row.querySelector('.a-text').value = a.text;
    row.querySelector('.a-test').disabled = !!isNew;
    return row;
  }

  function fillAlarms(list) {
    if (alarmsBox.contains(document.activeElement)) return; // don't wipe what she's typing
    savedAlarms = list;
    alarmsBox.replaceChildren(...list.map((a) => alarmRow(a)));
  }

  function readAlarms() {
    return [...alarmsBox.querySelectorAll('.alarm-row')].map((row) => ({
      id: row.dataset.id,
      enabled: row.querySelector('.a-on').checked,
      time: row.querySelector('.a-time').value,
      text: row.querySelector('.a-text').value.trim(),
    }));
  }

  let alarmTimer = null;
  async function saveAlarms() {
    clearTimeout(alarmTimer);
    const list = readAlarms();
    const bad = list.find((a) => !a.time || !a.text);
    if (bad) return showStatus(!bad.text ? 'Add a message to save the alarm' : 'Pick a time to save the alarm', true);
    const s = await save({ alarms: list });
    if (s) {
      savedAlarms = s.alarms;
      alarmsBox.querySelectorAll('.a-test').forEach((b) => { b.disabled = false; });
    }
  }

  alarmsBox.addEventListener('change', (e) => {
    const row = e.target.closest('.alarm-row');
    if (row && e.target.classList.contains('a-on')) row.classList.toggle('off', !e.target.checked);
    saveAlarms();
  });
  alarmsBox.addEventListener('input', (e) => {
    if (!e.target.classList.contains('a-text')) return;
    clearTimeout(alarmTimer);
    alarmTimer = setTimeout(saveAlarms, 700);
  });
  alarmsBox.addEventListener('click', async (e) => {
    const row = e.target.closest('.alarm-row');
    if (!row) return;
    if (e.target.classList.contains('a-del')) {
      row.remove();
      saveAlarms();
    } else if (e.target.classList.contains('a-test')) {
      const ok = await api.testAlarm(row.dataset.id);
      showStatus(ok ? 'Alarm going off - click the cat to stop it' : 'Save the alarm first', !ok);
    }
  });
  $('add-alarm').addEventListener('click', () => {
    if (alarmsBox.children.length >= 20) return showStatus('20 alarms max', true);
    const a = { id: 'a' + Date.now().toString(36), time: '12:00', text: '', enabled: true };
    const row = alarmRow(a, true);
    alarmsBox.appendChild(row);
    row.querySelector('.a-text').focus();
    showStatus('Type a message to save it');
  });

  $('mouseResize').addEventListener('change', (e) => save({ mouseResize: e.target.checked }));
  $('soundEnabled').addEventListener('change', (e) => save({ soundEnabled: e.target.checked }));
  $('cupChirp').addEventListener('change', (e) => save({ cupChirp: e.target.checked }));

  // Name, colours, presets, tail + whiskers live in the Customize window.
  $('open-customize').addEventListener('click', () => api.openCustomize());

  // --- Quick-action toolbar -----------------------------------------------------
  const ACTION_DONE = {
    'test-reminder': 'Reminder sent - click the cat to stop it',
    sleep: 'Good night 💤',
    wake: 'Good morning ☀',
    hide: 'Cat hidden - click the tray icon to bring her back',
    show: 'Cat is back 🐾',
  };
  // the Feedback card's buttons work like toolbar actions (they open the Feedback window)
  $('feedback-card').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-action]');
    if (b) api.action(b.dataset.action);
  });
  $('toolbar').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const r = await api.action(b.dataset.action);
    if (r && r.done && ACTION_DONE[r.done]) showStatus(ACTION_DONE[r.done]);
    else if (r && r.error) showStatus(r.error, true);
    if (r && r.state) fillToolbar(r.state);
    api.report('action', { action: b.dataset.action, result: r });
  });
  function fillToolbar(st) {
    const sleep = $('tb-sleep');
    sleep.dataset.tip = st.asleep ? 'Wake the cat up' : 'Put the cat to sleep';
    sleep.classList.toggle('on', !!st.asleep);
    const hide = $('tb-hide');
    hide.textContent = st.visible ? '🙈' : '🐱';
    hide.dataset.tip = st.visible ? 'Hide the cat (the tray icon brings her back)' : 'Show the cat again';
  }

  // --- Colour themes ------------------------------------------------------------
  // --- Drink (icon next to the counter + the counter word) ---------------------------
  const drinksBox = $('drinks');
  const wordIn = $('drinkWord');
  function fillDrinks(list, selected, word) {
    if (!drinksBox.children.length) {
      for (const d of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'drink';
        b.dataset.drink = d.id;
        b.setAttribute('role', 'radio');
        const pic = document.createElement('span');
        pic.className = 'pic';
        if (d.id === 'bowl') {
          const img = document.createElement('img');
          img.src = 'assets/bowl.png';
          img.alt = '';
          pic.appendChild(img);
        } else {
          const c = document.createElement('canvas');
          window.Drinks.draw(c, d.id, 2);
          pic.appendChild(c);
        }
        b.append(pic, document.createTextNode(d.label));
        b.dataset.tip = `Counter: "3 / 8 ${d.word}"`;
        b.addEventListener('click', () => save({ drink: d.id }));
        drinksBox.appendChild(b);
      }
    }
    drinksBox.querySelectorAll('.drink').forEach((b) => {
      const on = b.dataset.drink === selected;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    const d = list.find((x) => x.id === selected);
    wordIn.placeholder = d ? d.word : 'cups';
    if (document.activeElement !== wordIn) wordIn.value = word || '';
  }
  let wordTimer = null;
  wordIn.addEventListener('input', () => {
    clearTimeout(wordTimer);
    wordTimer = setTimeout(() => save({ drinkWord: wordIn.value.replace(/\s+/g, ' ').trim() }), 500);
  });

  // Each chip: its colour stripe, its name and a dot for every colour it uses.
  const themesBox = $('themes');
  const DOT_KEYS = ['bg', 'card', 'ink', 'accent', 'hover', 'check'];
  let lastThemes = [];
  function fillThemes(list, selected, labels) {
    lastThemes = list;
    themesBox.replaceChildren(...list.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `theme${t.id === 'custom' ? ' custom' : ''}${t.id === selected ? ' active' : ''}`;
      b.dataset.theme = t.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(t.id === selected));
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = t.vars.grad.replace(/^linear-gradient\(90deg/, 'linear-gradient(135deg');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = t.id === 'custom' ? '🎨 My colours' : t.label;
      const dots = document.createElement('span');
      dots.className = 'dots';
      for (const k of DOT_KEYS) {
        const d = document.createElement('i');
        d.style.background = t.vars[k];
        d.title = labels && labels[k] ? `${labels[k]}: ${t.vars[k]}` : t.vars[k];
        dots.appendChild(d);
      }
      b.append(sw, name, dots);
      b.addEventListener('click', () => save({ theme: t.id }));
      return b;
    }));
    fillCustomEditor(list.find((t) => t.id === 'custom'), selected === 'custom', labels);
  }

  // "My colours" editor (shown while that theme is picked)
  const customBox = $('custom-theme');
  let customTimer = null;
  function fillCustomEditor(t, shown, labels) {
    customBox.hidden = !shown;
    if (!t) return;
    if (!customBox.children.length) {
      for (const k of DOT_KEYS) {
        const lab = document.createElement('label');
        lab.textContent = labels[k] || k;
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.dataset.key = k;
        inp.addEventListener('input', () => {
          clearTimeout(customTimer);
          customTimer = setTimeout(saveCustom, 150);
        });
        lab.appendChild(inp);
        customBox.appendChild(lab);
      }
      // copy another theme's colours as a starting point
      const from = document.createElement('select');
      from.id = 'custom-from';
      from.dataset.tip = "Copy another theme's colours, then change what you like";
      from.addEventListener('change', () => {
        const src = lastThemes.find((x) => x.id === from.value);
        from.value = '';
        if (!src) return;
        const c = {};
        for (const k of DOT_KEYS) c[k] = src.vars[k];
        save({ customTheme: c });
      });
      const row = document.createElement('div');
      row.className = 'from';
      row.append(from);
      customBox.appendChild(row);
    }
    const from = $('custom-from');
    from.replaceChildren(new Option('Start from a theme…', ''), ...lastThemes.filter((x) => x.id !== 'custom').map((x) => new Option(x.label, x.id)));
    from.value = '';
    customBox.querySelectorAll('input[type=color]').forEach((inp) => {
      if (document.activeElement !== inp) inp.value = t.vars[inp.dataset.key];
    });
  }
  function saveCustom() {
    const c = {};
    customBox.querySelectorAll('input[type=color]').forEach((inp) => { c[inp.dataset.key] = inp.value.toLowerCase(); });
    save({ customTheme: c });
  }

  // Hints about the cat use the desktop cat's pronouns (she/her, he/him, they/them).
  const PRONOUNS = {
    female: { they: 'she', them: 'her', their: 'her', s: 's' },
    male: { they: 'he', them: 'him', their: 'his', s: 's' },
    unspecified: { they: 'they', them: 'them', their: 'their', s: '' },
  };
  function fillPronouns(gender) {
    const p = PRONOUNS[gender] || PRONOUNS.unspecified;
    const set = (cls, text) => document.querySelectorAll(cls).forEach((el) => { el.textContent = text; });
    set('.pr-they', p.they);
    set('.pr-they-cap', p.they.charAt(0).toUpperCase() + p.they.slice(1));
    set('.pr-them', p.them);
    set('.pr-their', p.their);
    set('.pr-walks', `walk${p.s}`);
    set('.pr-sits', `sit${p.s}`);
    set('.pr-acts', `act${p.s}`);
  }

  function fill(s) {
    $('look-name').textContent = s.catName;
    fillPronouns(s.catGender);
    $('soundEnabled').checked = s.soundEnabled;
    $('cupChirp').checked = s.cupChirp;
    $('mouseResize').checked = s.mouseResize;
    fillAlarms(s.alarms);
    if (s.themes) fillThemes(s.themes, s.theme, s.customThemeLabels);
    if (s.drinks) fillDrinks(s.drinks, s.drink, s.drinkWord);
    if (s.catState) fillToolbar(s.catState);
    lastS = s;
    $('idleSleepEnabled').checked = s.idleSleepEnabled;
    $('idleSleepMinutes').value = s.idleSleepMinutes;
    $('idleSleepMinutes').disabled = !s.idleSleepEnabled;
    $('idleAnimations').checked = s.idleAnimations;
    $('chaseMouse').checked = s.chaseMouse;
    drawPreview();
    fillStyles(s.meowStyles, s.meowStyle);
    volume.value = Math.round(s.volume * 100);
    volumeOut.textContent = `${volume.value}%`;
    $('goalCups').value = s.goalCups;
    $('reminderMinutes').value = s.reminderMinutes;
    $('repeatMinutes').value = s.repeatMinutes;
    $('quietStart').value = s.quietStart;
    $('quietEnd').value = s.quietEnd;
    $('startWithWindows').checked = s.startWithWindows;
    $('login-hint').hidden = s.packaged;
  }

  async function save(partial) {
    try {
      const s = await api.set(partial);
      lastS = s;
      drawPreview();
      // Main ignores invalid values; show what was actually stored.
      // (alarms: main trims spaces, so compare the trimmed text it would store)
      const same = (k) => (k === 'alarms'
        ? JSON.stringify(s.alarms.map((a) => [a.id, a.time, a.text, a.enabled])) === JSON.stringify(partial.alarms.map((a) => [a.id, a.time, a.text.replace(/\s+/g, ' ').trim(), a.enabled]))
        : JSON.stringify(s[k]) === JSON.stringify(partial[k]));
      const rejected = Object.keys(partial).filter((k) => !same(k));
      if (rejected.length) fill(s); // put the stored value back in the form
      if (rejected.length) showStatus('Not saved: invalid value', true);
      else showStatus('Saved ✓');
      api.report('saved', { partial, rejected });
      return s;
    } catch (err) {
      showStatus('Could not save', true);
      api.report('error', { message: String(err) });
      return null;
    }
  }

  // Volume: update the label live, save shortly after the slider stops moving.
  volume.addEventListener('input', () => {
    volumeOut.textContent = `${volume.value}%`;
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => save({ volume: Number(volume.value) / 100 }), 120);
  });
  volume.addEventListener('change', async () => {
    volumeOut.textContent = `${volume.value}%`;
    clearTimeout(volumeTimer);
    await save({ volume: Number(volume.value) / 100 });
    api.testMeow(styleSel.value); // let her hear the new volume
  });
  $('test-meow').addEventListener('click', () => api.testMeow(styleSel.value));
  styleSel.addEventListener('change', async () => {
    await save({ meowStyle: styleSel.value });
    api.testMeow(styleSel.value); // preview the style she picked
  });

  for (const id of ['idleSleepEnabled', 'idleAnimations', 'chaseMouse']) {
    $(id).addEventListener('change', (e) => {
      if (id === 'idleSleepEnabled') $('idleSleepMinutes').disabled = !e.target.checked;
      save({ [id]: e.target.checked });
    });
  }

  for (const id of ['goalCups', 'reminderMinutes', 'repeatMinutes', 'idleSleepMinutes']) {
    $(id).addEventListener('change', (e) => {
      if (!e.target.checkValidity()) return showStatus('Not saved: invalid value', true);
      save({ [id]: Number(e.target.value) });
    });
  }
  for (const id of ['quietStart', 'quietEnd']) {
    $(id).addEventListener('change', (e) => {
      if (!e.target.checkValidity() || !e.target.value) return showStatus('Not saved: invalid time', true);
      save({ [id]: e.target.value });
    });
  }
  $('startWithWindows').addEventListener('change', (e) => save({ startWithWindows: e.target.checked }));

  $('open-sounds').addEventListener('click', async () => {
    const ok = await api.openSoundsFolder();
    if (!ok) showStatus('Could not open the folder', true);
  });
  // Changed elsewhere (sounds folder, right-click "Chase the mouse") -> show the stored values.
  api.onChanged((s) => fill(s));

  $('form').addEventListener('submit', (e) => e.preventDefault());
  $('close').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

  api.get().then((s) => {
    fill(s);
    blinkLoop();
    api.report('ready', s);
  });
})();
