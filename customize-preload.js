'use strict';
// Preload for the Customize window ONLY. Channel names must match main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('customizeApi', {
  // every call is for one cat (catId = the cat selected in this window)
  get: (catId) => ipcRenderer.invoke('customize:get', catId),
  set: (catId, partial) => ipcRenderer.invoke('customize:set', catId, partial),
  applyLook: (catId, look) => ipcRenderer.invoke('customize:apply-look', catId, look),
  savePreset: (catId, name) => ipcRenderer.invoke('customize:save-preset', catId, name),
  deletePreset: (name) => ipcRenderer.invoke('customize:delete-preset', name),
  exportLook: (catId, name) => ipcRenderer.invoke('customize:export', catId, name),
  importLook: (catId) => ipcRenderer.invoke('customize:import', catId),
  newCat: () => ipcRenderer.invoke('customize:new-cat'),
  duplicateCat: (catId) => ipcRenderer.invoke('customize:duplicate-cat', catId),
  deleteCat: (catId) => ipcRenderer.invoke('customize:delete-cat', catId),
  setActive: (catId) => ipcRenderer.invoke('customize:set-active', catId),
  restoreStarters: (catId) => ipcRenderer.invoke('customize:restore-starters', catId),
  previewSleep: (spot) => ipcRenderer.invoke('customize:preview-sleep', spot),
  setGlobal: (catId, partial) => ipcRenderer.invoke('customize:set-global', catId, partial),
  onChanged: (cb) => ipcRenderer.on('customize:changed', (_e, s) => cb(s)),
  // updates (footer)
  updateStatus: () => ipcRenderer.invoke('customize:update-status'),
  checkUpdates: () => ipcRenderer.invoke('customize:check-updates'),
  restartToUpdate: () => ipcRenderer.invoke('customize:restart-to-update'),
  releaseNotes: () => ipcRenderer.invoke('customize:release-notes'),
  onUpdateStatus: (cb) => ipcRenderer.on('customize:update-status', (_e, s) => cb(s)),
  report: (type, data) => ipcRenderer.send('report', 'customize:' + String(type), data),
});
