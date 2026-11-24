'use strict';
// Preload for the cat info window ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

// Colour theme from main (themes.js): CSS variables on <html>.
ipcRenderer.on('theme', (_e, t) => {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(`--${k}`, v);
  root.classList.toggle('dark', !!t.dark);
});

contextBridge.exposeInMainWorld('infoApi', {
  get: () => ipcRenderer.invoke('info:get'),
  ready: (height) => ipcRenderer.send('info:ready', height),
  close: (reason) => ipcRenderer.send('info:close', reason),
  report: (type, data) => ipcRenderer.send('report', 'info:' + String(type), data),
});
