'use strict';
// Preload for the cat info window ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('infoApi', {
  get: () => ipcRenderer.invoke('info:get'),
  ready: (height) => ipcRenderer.send('info:ready', height),
  close: (reason) => ipcRenderer.send('info:close', reason),
  report: (type, data) => ipcRenderer.send('report', 'info:' + String(type), data),
});
