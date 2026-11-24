'use strict';
// Loaded by main.js via webPreferences.preload ONLY (never via a <script> tag).
// Channel names here must match main.js exactly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // renderer -> main
  pressStart: () => ipcRenderer.send('press-start'),
  release: (info) => ipcRenderer.invoke('release', info), // every left mouseup -> { click, how }
  pressCancel: () => ipcRenderer.send('press-cancel'),
  hitRects: (r) => ipcRenderer.send('hit-rects', r),
  resetCups: () => ipcRenderer.send('reset-cups'),
  hideCat: () => ipcRenderer.send('hide-cat'),
  quitApp: () => ipcRenderer.send('quit-app'),
  restartApp: () => ipcRenderer.send('restart-app'),
  resizeStart: () => ipcRenderer.send('resize-start'),
  resizeStep: (dir) => ipcRenderer.send('resize-step', dir),
  report: (type, data) => ipcRenderer.send('report', String(type), data),
  getState: () => ipcRenderer.invoke('get-state'),
  getMeows: () => ipcRenderer.invoke('get-meows'),

  // main -> renderer
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onReminder: (cb) => ipcRenderer.on('reminder', (_e, r) => cb(r)),
  onHideBubble: (cb) => ipcRenderer.on('hide-bubble', (_e, reason) => cb(reason)),
  onBubbleSet: (cb) => ipcRenderer.on('bubble-set', (_e, b) => cb(b)),
  onIntro: (cb) => ipcRenderer.on('bubble-intro', (_e, b) => cb(b)),
  onPlayMeow: (cb) => ipcRenderer.on('play-meow', (_e, m) => cb(m)),
  onMeowsChanged: (cb) => ipcRenderer.on('meows-changed', () => cb()),
  onDragBegan: (cb) => ipcRenderer.on('drag-began', () => cb()),
  onPose: (cb) => ipcRenderer.on('pose', (_e, p) => cb(p)),
  onAnim: (cb) => ipcRenderer.on('anim', (_e, a) => cb(a)),
  onColorsChanged: (cb) => ipcRenderer.on('colors-changed', (_e, look) => cb(look)),
  onPetted: (cb) => ipcRenderer.on('petted', (_e, p) => cb(p)),
  pet: () => ipcRenderer.invoke('pet'),
});
