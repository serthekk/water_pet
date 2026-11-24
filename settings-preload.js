'use strict';
// Preload for the Settings window ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

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
