'use strict';
// Preload for the Stats window ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

const themeListeners = [];
// Colour theme from main (themes.js): CSS variables on <html>.
ipcRenderer.on('theme', (_e, t) => {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(`--${k}`, v);
  root.classList.toggle('dark', !!t.dark);
  themeListeners.forEach((cb) => cb());
});
// Clicked while Windows hasn't given this window the keyboard: bring it to the front.
window.addEventListener('pointerdown', () => { if (!document.hasFocus()) ipcRenderer.send('window:claim-focus'); }, true);

contextBridge.exposeInMainWorld('statsApi', {
  get: () => ipcRenderer.invoke('stats:get'),
  onChanged: (cb) => ipcRenderer.on('stats:changed', (_e, d) => cb(d)),
  onTheme: (cb) => themeListeners.push(cb), // the chart redraws in the new colours
  report: (type, data) => ipcRenderer.send('report', 'stats:' + String(type), data),
});
