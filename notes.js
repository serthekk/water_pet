'use strict';
// "What's new" window. Loaded ONLY by notes.html. The notes come from release-notes.json
// (bundled with the app, so this works offline).
(() => {
  const api = window.notesApi;
  const $ = (id) => document.getElementById(id);
  window.addEventListener('error', (e) => api.report('error', { message: e.message, line: e.lineno }));

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const niceDate = (d) => {
    const t = Date.parse(d);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  };

  function fill(d) {
    $('current').textContent = `You have version ${d.current}`;
    const list = $('list');
    list.replaceChildren();
    for (const r of d.releases) {
      const box = el('section', `release${r.current ? ' current' : ''}${r.upcoming ? ' upcoming' : ''}`);
      const h = el('h2');
      h.append(el('span', 'ver', `v${r.version}`), document.createTextNode(r.title || ''));
      if (r.current) h.append(el('span', 'tag', '· you have this'));
      else if (r.upcoming) h.append(el('span', 'tag', '· coming next'));
      if (r.date) h.append(el('span', 'date', niceDate(r.date)));
      const ul = el('ul');
      for (const it of r.items || []) {
        const li = el('li');
        li.append(el('span', 'icon', it.icon || '•'), el('span', '', it.text));
        ul.append(li);
      }
      box.append(h, ul);
      list.append(box);
    }
    if (!d.releases.length) list.append(el('p', 'empty', 'No notes yet.'));
    fillUpdate(d.update);
  }
  function fillUpdate(u) {
    const box = $('update');
    const btn = $('update-btn');
    box.hidden = !u || !['downloaded', 'available', 'downloading'].includes(u.state);
    if (box.hidden) return;
    $('update-text').textContent = u.state === 'downloaded' ? `🎉 v${u.version} is ready to install`
      : u.state === 'downloading' ? `⬇ Downloading v${u.version}… ${u.progress || 0}%` : `✨ v${u.version} is out`;
    btn.hidden = u.state !== 'downloaded';
  }

  $('update-btn').addEventListener('click', () => api.restartToUpdate());
  $('github').addEventListener('click', () => api.openGithub());
  $('close').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
  api.onUpdateStatus(fillUpdate);

  api.get().then((d) => {
    fill(d);
    api.report('ready', { current: d.current, releases: d.releases.map((r) => r.version), marked: d.releases.filter((r) => r.current).map((r) => r.version) });
  });
})();
