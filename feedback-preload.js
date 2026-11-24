'use strict';
// Preload for the Feedback window ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

// Colour theme from main (themes.js): CSS variables on <html>.
ipcRenderer.on('theme', (_e, t) => {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(`--${k}`, v);
  root.classList.toggle('dark', !!t.dark);
});
// Clicked while Windows hasn't given this window the keyboard: bring it to the front.
window.addEventListener('pointerdown', () => { if (!document.hasFocus()) ipcRenderer.send('window:claim-focus'); }, true);

contextBridge.exposeInMainWorld('feedbackApi', {
  get: () => ipcRenderer.invoke('feedback:get'),
  send: (msg) => ipcRenderer.invoke('feedback:send', msg),
  onKind: (cb) => ipcRenderer.on('feedback:kind', (_e, k) => cb(k)),
  report: (type, data) => ipcRenderer.send('report', 'feedback:' + String(type), data),
});
