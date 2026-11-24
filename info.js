'use strict';
// Cat info card. Loaded ONLY by info.html.
(() => {
  const api = window.infoApi;
  const S = window.CatSprite;
  const $ = (id) => document.getElementById(id);
  window.addEventListener('error', (e) => api.report('error', { message: e.message, line: e.lineno }));

  // Small pixel portrait at an integer scale, cropped to the sitting cat.
  function portrait(look) {
    const grid = S.render('sit', 'sit', look, 1);
    const bb = S.bbox(grid);
    const cell = 3;
    const c = $('portrait');
    c.width = bb.w * cell;
    c.height = bb.h * cell;
    c.style.width = `${c.width}px`;
    c.style.height = `${c.height}px`;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    grid.forEach((row, y) => row.forEach((col, x) => {
      if (!col || x < bb.x || y < bb.y) return;
      g.fillStyle = col;
      g.fillRect((x - bb.x) * cell, (y - bb.y) * cell, cell, cell);
    }));
    g.fillStyle = look.colors.whiskers;
    for (const [px, py, t] of S.whiskerSquares(S.whiskerLines('sit', 'sit', look, 1), cell)) g.fillRect(px - bb.x * cell, py - bb.y * cell, t, t);
  }

  $('close').addEventListener('click', () => api.close('button'));
  // Esc works once she has clicked into the card (it never takes focus on its own)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close('esc'); });

  api.get().then((d) => {
    if (!d) return;
    $('badge').textContent = d.label;
    $('badge').classList.toggle('memory', d.label !== 'About');
    $('name').textContent = d.name;
    $('symbol').textContent = d.symbol;
    const desc = $('description');
    desc.textContent = d.description || `Nothing written about ${d.name} yet.`;
    desc.classList.toggle('empty', !d.description);
    portrait(d.look);
    document.title = `${d.label} ${d.name}`;
    // tell main how tall the card is so the window fits it exactly
    requestAnimationFrame(() => {
      const h = Math.ceil(document.getElementById('card').getBoundingClientRect().height) + 16;
      api.ready(h);
      api.report('shown', { catId: d.catId, label: d.label, name: d.name, symbol: d.symbol, description: d.description, height: h });
    });
  });
})();
