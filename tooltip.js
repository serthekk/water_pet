'use strict';
// Pretty hover tooltips for Settings (needs <div id="tooltip"> in the page).
//  - [data-tip="text"]: any element (toolbar buttons, small buttons)
//  - <i class="tip-host">?<span class="tip">text</span></i>: a little "?" with richer text
//    (the hidden .tip span may hold pronoun spans that settings.js keeps up to date)
(() => {
  const tip = document.getElementById('tooltip');
  if (!tip) return;
  let showTimer = null;
  let current = null;

  const textOf = (el) => (el.classList.contains('tip-host') ? (el.querySelector('.tip') || {}).textContent : el.dataset.tip) || '';

  function place(el) {
    const r = el.getBoundingClientRect();
    const pad = 6;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(pad, Math.min(x, window.innerWidth - w - pad));
    let y = r.bottom + 6; // below; flip above when there's no room
    if (y + h > window.innerHeight - pad) y = r.top - h - 6;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(Math.max(pad, y))}px`;
  }
  function show(el) {
    const text = textOf(el).trim();
    if (!text) return;
    current = el;
    tip.textContent = text;
    tip.hidden = false;
    tip.classList.remove('on');
    place(el);
    requestAnimationFrame(() => tip.classList.add('on'));
  }
  function hide() {
    clearTimeout(showTimer);
    current = null;
    tip.classList.remove('on');
    tip.hidden = true;
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip], .tip-host');
    if (el === current) return;
    hide();
    if (!el) return;
    showTimer = setTimeout(() => show(el), el.classList.contains('tip-host') ? 120 : 450);
  });
  document.addEventListener('mouseleave', hide);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('mousedown', hide, true);
  // the "?" sits inside labels: clicking it must not tick the checkbox
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.tip-host')) e.preventDefault(); }, true);
})();
