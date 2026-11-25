'use strict';
// Preload for the play-mode overlay ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

// a click into the play area takes the keyboard (so Esc works), even when Windows'
// foreground lock kept it from the overlay
window.addEventListener('pointerdown', () => { if (!document.hasFocus()) ipcRenderer.send('play:focus'); }, true);

contextBridge.exposeInMainWorld('playApi', {
  onStart: (cb) => ipcRenderer.on('play:start', (_e, o) => cb(o)),
  onStop: (cb) => ipcRenderer.on('play:stop', () => cb()),
  rects: (list) => ipcRenderer.send('play:rects', list), // toy / cat / Stop: main lets clicks reach these
  onPointer: (cb) => ipcRenderer.on('play:pointer', (_e, p) => cb(p)), // the real mouse, from main
  stop: (reason) => ipcRenderer.send('play:stop', String(reason || 'page')),
  stopPos: (pos) => ipcRenderer.send('play:stop-pos', pos), // she dragged the Stop button (null = back to default)
  pet: () => ipcRenderer.invoke('pet'),
  menu: () => ipcRenderer.send('play:menu'), // right-click on the cat / toy: the usual menu (with Stop playing)
  report: (type, data) => ipcRenderer.send('report', 'play:' + String(type), data),
});
