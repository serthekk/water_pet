'use strict';
// Stats window: pixel-style bar chart (last 7 / 30 days, goal line, today highlighted,
// a stub for zero days) + tiles. Loaded ONLY by stats.html. Data from main ('stats:get').
(() => {
  const api = window.statsApi;
  const $ = (id) => document.getElementById(id);
  window.addEventListener('error', (e) => api.report('error', { message: e.message, line: e.lineno }));

  let data = null;
  let range = 7;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';
  const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  function draw() {
    if (!data) return;
    const days = data.days.slice(-range); // oldest -> today
    const cv = $('chart');
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    const P = 2; // chart "pixel" size: everything snaps to it
    const snap = (v) => Math.round(v / P) * P;
    const left = 22;
    const bottom = cv.height - 18;
    const top = 8;
    const maxV = Math.max(data.goal, ...days.map((d) => d.cups), 1);
    const scaleY = (v) => snap(bottom - ((bottom - top) * v) / maxV);
    const slot = (cv.width - left - 4) / days.length;
    const barW = Math.max(P * 2, snap(slot * 0.62));
    g.font = '10px Segoe UI, sans-serif';
    g.textAlign = 'center';
    // y labels: 0 and the max
    g.fillStyle = css('--muted');
    g.textAlign = 'right';
    g.fillText(String(maxV), left - 4, top + 8);
    g.fillText('0', left - 4, bottom);
    g.textAlign = 'center';
    days.forEach((d, i) => {
      const x = snap(left + i * slot + (slot - barW) / 2);
      const isToday = i === days.length - 1;
      const y = d.cups > 0 ? scaleY(d.cups) : bottom - P; // zero days: a little stub
      g.fillStyle = isToday ? css('--accent') : d.cups >= d.goal ? css('--check') : css('--hover');
      g.fillRect(x, y, barW, bottom - y);
      // pixel outline on top of the bar
      g.fillStyle = css('--ink');
      g.fillRect(x, y, barW, P);
      // labels: weekday letters (7 days) / every 5th day number (30 days)
      if (range === 7 || i % 5 === 4 || isToday) {
        g.fillStyle = isToday ? css('--accent') : css('--muted');
        const [yy, mm, dd] = d.date.split('-').map(Number);
        const label = range === 7 ? WEEKDAY[new Date(yy, mm - 1, dd).getDay()] : String(dd);
        g.fillText(label, x + barW / 2, cv.height - 4);
      }
      if (range === 7 && d.cups > 0) {
        g.fillStyle = css('--ink');
        g.fillText(String(d.cups), x + barW / 2, y - 4);
      }
    });
    // goal line: dashed pixel line
    const gy = scaleY(data.goal);
    g.fillStyle = css('--ink');
    for (let x = left; x < cv.width - 4; x += P * 3) g.fillRect(x, gy, P * 2, P);
    // base line
    g.fillRect(left, bottom, cv.width - left - 4, P);
    api.report('drawn', { range, bars: days.length, today: days[days.length - 1].cups });
  }

  function fill(d) {
    data = d;
    $('unit').textContent = d.word;
    $('t-streak').textContent = d.streak;
    $('t-best').textContent = d.best;
    $('t-avg7').textContent = d.avg7;
    $('t-avg30').textContent = d.avg30;
    $('t-total').textContent = d.totalCups;
    $('t-total-l').textContent = `${d.word} in total`;
    $('t-pets').textContent = d.totalPets;
    $('t-met').textContent = `${d.met30} / 30`;
    draw();
  }

  document.querySelectorAll('.range button').forEach((b) => b.addEventListener('click', () => {
    range = Number(b.dataset.days);
    document.querySelectorAll('.range button').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  }));
  $('close').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
  api.onChanged(fill);
  api.onTheme(() => draw()); // bar colours come from the theme
  api.get().then((d) => {
    fill(d);
    api.report('ready', { days: d.days.length, streak: d.streak, today: d.days[d.days.length - 1] });
  });
})();
