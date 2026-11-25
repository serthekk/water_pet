'use strict';
// Preload for the play-mode overlay ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('playApi', {
  onStart: (cb) => ipcRenderer.on('play:start', (_e, o) => cb(o)),
  onStop: (cb) => ipcRenderer.on('play:stop', () => cb()),
  hover: (over) => ipcRenderer.send('play:hover', !!over), // over the toy / cat: take clicks
  stop: (reason) => ipcRenderer.send('play:stop', String(reason || 'page')),
  pet: () => ipcRenderer.invoke('pet'),
  report: (type, data) => ipcRenderer.send('report', 'play:' + String(type), data),
});
