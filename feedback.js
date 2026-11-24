'use strict';
// Feedback window: a problem report or an idea. Send = main opens a pre-filled GitHub
// issue (public) in her browser. Loaded ONLY by feedback.html.
(() => {
  const api = window.feedbackApi;
  const $ = (id) => document.getElementById(id);
  window.addEventListener('error', (e) => api.report('error', { message: e.message, line: e.lineno }));

  const TEXT = {
    bug: { title: 'What went wrong?', titleHint: 'e.g. The cat stopped meowing', text: 'Tell us more: what did you do, what happened, what did you expect?' },
    idea: { title: 'Your idea in a few words', titleHint: 'e.g. A pumpkin hat for autumn', text: 'Tell us more about it' },
  };
  let kind = 'bug';
  let info = null; // { version, os, errors } from main (already cleaned of personal paths)

  function setKind(k) {
    kind = k === 'idea' ? 'idea' : 'bug';
    document.querySelectorAll('.kind').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
    $('title-label').textContent = TEXT[kind].title;
    $('title').placeholder = TEXT[kind].titleHint;
    $('text-label').textContent = TEXT[kind].text;
    $('details-row').hidden = kind !== 'bug';
    $('preview-box').hidden = kind !== 'bug';
    updatePreview();
  }
  function updatePreview() {
    if (!info) return;
    $('preview').textContent = [`App version: ${info.version}`, `Windows: ${info.os}`, 'Recent errors:', info.errors.length ? info.errors.join('\n') : '(none)'].join('\n');
  }
  function showStatus(t, err) {
    $('status').textContent = t;
    $('status').classList.toggle('error', !!err);
  }

  document.querySelectorAll('.kind').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
  $('text').addEventListener('input', () => { $('count').textContent = $('text').value.length; });
  $('cancel').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
  $('send').addEventListener('click', async () => {
    const title = $('title').value.trim();
    const text = $('text').value.trim();
    if (!title) {
      $('title').focus();
      return showStatus('Please write a few words first', true);
    }
    $('send').disabled = true;
    const r = await api.send({ kind, title, text, details: kind === 'bug' && $('details').checked });
    $('send').disabled = false;
    if (r && r.ok) {
      showStatus('Opened in your browser - press "Submit new issue" there. Thank you! 💛');
      api.report('sent', { kind, length: r.length });
    } else {
      showStatus((r && r.error) || 'Could not open the page', true);
    }
  });

  api.onKind((k) => setKind(k));
  api.get().then((d) => {
    info = d;
    setKind(d.kind);
    $('title').focus();
    api.report('ready', { kind: d.kind, errors: d.errors.length });
  });
})();
