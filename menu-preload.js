'use strict';
// Preload for the right-click / tray menu window ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

// Colour theme from main (themes.js): CSS variables on <html>.
ipcRenderer.on('theme', (_e, t) => {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(`--${k}`, v);
  root.classList.toggle('dark', !!t.dark);
});

contextBridge.exposeInMainWorld('menuApi', {
  size: (w, h) => ipcRenderer.send('menu:size', w, h),
  click: (id) => ipcRenderer.send('menu:click', String(id)),
  close: (reason) => ipcRenderer.send('menu:close', reason),
  onShow: (cb) => ipcRenderer.on('menu:show', (_e, m) => cb(m)),
  onHidden: (cb) => ipcRenderer.on('menu:hidden', () => cb()),
  report: (type, data) => ipcRenderer.send('report', 'menu:' + String(type), data),
});
