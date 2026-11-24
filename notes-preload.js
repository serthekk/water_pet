'use strict';
// Preload for the "What's new" window ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

// Colour theme from main (themes.js): CSS variables on <html>.
ipcRenderer.on('theme', (_e, t) => {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(`--${k}`, v);
  root.classList.toggle('dark', !!t.dark);
});
// Clicked while Windows hasn't given this window the keyboard: bring it to the front.
window.addEventListener('pointerdown', () => { if (!document.hasFocus()) ipcRenderer.send('window:claim-focus'); }, true);

contextBridge.exposeInMainWorld('notesApi', {
  get: () => ipcRenderer.invoke('notes:get'),
  restartToUpdate: () => ipcRenderer.invoke('customize:restart-to-update'),
  openGithub: () => ipcRenderer.send('notes:github'),
  onUpdateStatus: (cb) => ipcRenderer.on('notes:update-status', (_e, s) => cb(s)),
  report: (type, data) => ipcRenderer.send('report', 'notes:' + String(type), data),
});
