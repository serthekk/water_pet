'use strict';
// The cat's right-click / tray menu page. Loaded ONLY by menu.html. Main sends the items
// ('menu:show'); this page draws them, tells main its size (main places + shows it) and
// sends the picked item's id. Submenus open in place (click or → / Enter).
(() => {
  const api = window.menuApi;
  const box = document.getElementById('menu');
  window.addEventListener('error', (e) => api.report('error', { message: e.message, line: e.lineno }));

  const DANGER = new Set(['Quit']);
  let rows = []; // the visible, enabled rows (keyboard navigation)
  let kbd = -1;

  // Measured right away (getBoundingClientRect forces layout): a hidden window gets no
  // animation frames, and the menu is hidden until main has its size.
  function sendSize() {
    const r = box.getBoundingClientRect();
    // the card + its margin (shadow room)
    api.size(Math.ceil(r.right + 10), Math.ceil(r.bottom + 12));
  }

  function build(items, parent) {
    for (const it of items) {
      if (it.type === 'separator') {
        parent.append(Object.assign(document.createElement('div'), { className: 'sep' }));
        continue;
      }
      const row = document.createElement('div');
      row.className = `item ${it.enabled ? 'enabled' : 'disabled'}${it.role === 'title' ? ' title' : ''}${DANGER.has(it.label) ? ' danger' : ''}`;
      row.setAttribute('role', it.type === 'checkbox' ? 'menuitemcheckbox' : it.type === 'radio' ? 'menuitemradio' : 'menuitem');
      row.dataset.id = it.id;
      const mark = document.createElement('span');
      mark.className = 'mark';
      if (it.type === 'checkbox' && it.checked) mark.textContent = '✓';
      if (it.type === 'radio' && it.checked) mark.textContent = '●';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = it.label;
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      if (it.sub) arrow.textContent = '›';
      row.append(mark, label, arrow);
      parent.append(row);
      if (it.sub) {
        const sub = document.createElement('div');
        sub.className = 'sub';
        build(it.sub, sub);
        parent.append(sub);
        row.addEventListener('click', () => toggleSub(row, sub));
      } else if (it.enabled) {
        row.addEventListener('click', () => api.click(it.id));
      }
    }
  }
  function toggleSub(row, sub, open = !sub.classList.contains('open')) {
    sub.classList.toggle('open', open);
    row.classList.toggle('open', open);
    collectRows();
    sendSize();
  }
  function collectRows() {
    rows = [...box.querySelectorAll('.item.enabled')].filter((r) => r.offsetParent !== null);
  }
  function setKbd(i) {
    rows.forEach((r) => r.classList.remove('kbd'));
    kbd = rows.length ? (i + rows.length) % rows.length : -1;
    if (kbd >= 0) rows[kbd].classList.add('kbd');
  }

  api.onShow((m) => {
    // a small screen: the menu scrolls inside instead of being cut off
    box.style.maxHeight = Number.isFinite(m.maxH) ? `${Math.max(120, m.maxH - 20)}px` : '';
    box.replaceChildren();
    build(m.items, box);
    collectRows();
    kbd = -1;
    sendSize();
    api.report('shown', { source: m.source, items: m.items.length });
  });
  api.onHidden(() => {
    rows.forEach((r) => r.classList.remove('kbd'));
    kbd = -1;
  });

  // the mouse takes over from the keyboard highlight
  box.addEventListener('mousemove', () => {
    if (kbd < 0) return;
    rows.forEach((r) => r.classList.remove('kbd'));
    kbd = -1;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return api.close('esc');
    if (e.key === 'ArrowDown') return setKbd(kbd + 1);
    if (e.key === 'ArrowUp') return setKbd(kbd < 0 ? rows.length - 1 : kbd - 1);
    const row = rows[kbd];
    if (!row) return;
    const sub = row.nextElementSibling && row.nextElementSibling.classList.contains('sub') ? row.nextElementSibling : null;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      row.click();
    } else if (e.key === 'ArrowRight' && sub && !sub.classList.contains('open')) {
      toggleSub(row, sub, true);
    } else if (e.key === 'ArrowLeft' && sub && sub.classList.contains('open')) {
      toggleSub(row, sub, false);
    }
  });
  // a right-click inside the menu shouldn't do anything
  document.addEventListener('contextmenu', (e) => e.preventDefault());
})();
