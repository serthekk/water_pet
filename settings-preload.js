'use strict';
// Preload for the Settings window ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

// Clicked while Windows hasn't given this window the keyboard (typed letters would be
// lost): ask main to bring it properly to the front.
window.addEventListener('pointerdown', () => { if (!document.hasFocus()) ipcRenderer.send('window:claim-focus'); }, true);

contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (partial) => ipcRenderer.invoke('settings:set', partial),
  testMeow: (style) => ipcRenderer.send('settings:test-meow', style),
  openSoundsFolder: () => ipcRenderer.invoke('settings:open-sounds-folder'),
  testAlarm: (id) => ipcRenderer.invoke('settings:test-alarm', id),
  restart: () => ipcRenderer.invoke('settings:restart'),
  openCustomize: () => ipcRenderer.invoke('settings:open-customize'),
  onChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  report: (type, data) => ipcRenderer.send('report', 'settings:' + String(type), data),
});
