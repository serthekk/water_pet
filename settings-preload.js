'use strict';
// Preload for the Settings window ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

// Clicked while Windows hasn't given this window the keyboard (typed letters would be
// lost): ask main to bring it properly to the front.
window.addEventListener('pointerdown', () => { if (!document.hasFocus()) ipcRenderer.send('window:claim-focus'); }, true);

// Colour theme from main (themes.js): CSS variables on <html>.
ipcRenderer.on('theme', (_e, t) => {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(`--${k}`, v);
  root.classList.toggle('dark', !!t.dark);
});

contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (partial) => ipcRenderer.invoke('settings:set', partial),
  testMeow: (style) => ipcRenderer.send('settings:test-meow', style),
  openSoundsFolder: () => ipcRenderer.invoke('settings:open-sounds-folder'),
  testAlarm: (id) => ipcRenderer.invoke('settings:test-alarm', id),
  syncInfo: () => ipcRenderer.invoke('settings:sync-info'),
  syncNewCode: () => ipcRenderer.invoke('settings:sync-new-code'),
  syncForget: (id) => ipcRenderer.invoke('settings:sync-forget', id),
  onSyncChanged: (cb) => ipcRenderer.on('settings:sync-changed', (_e, info) => cb(info)),
  restart: () => ipcRenderer.invoke('settings:restart'),
  openCustomize: () => ipcRenderer.invoke('settings:open-customize'),
  // quick-action toolbar: customize | test-reminder | sleep | hide | notes | restart
  action: (name) => ipcRenderer.invoke('settings:action', name),
  onChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  report: (type, data) => ipcRenderer.send('report', 'settings:' + String(type), data),
});
