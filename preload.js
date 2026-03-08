'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── File dialogs ──────────────────────────────────────
  selectVideo: () => ipcRenderer.invoke('select-video'),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  openFile: (p) => ipcRenderer.invoke('open-file', p),

  // ── Video info ────────────────────────────────────────
  getVideoInfo: (p) => ipcRenderer.invoke('get-video-info', p),

  // ── Process & Cancel ──────────────────────────────────
  processVideo: (inputPath, keepSec, skipSec, trimStartSec, speedFactor, outputDir, outputName) =>
    ipcRenderer.invoke('process-video', inputPath, keepSec, skipSec, trimStartSec, speedFactor, outputDir, outputName),
  cancelProcessing: () => ipcRenderer.invoke('cancel-processing'),

  // ── Progress events ───────────────────────────────────
  onProgress: (cb) => {
    ipcRenderer.on('progress', (_e, data) => cb(data));
  },
  removeProgressListener: () => {
    ipcRenderer.removeAllListeners('progress');
  },

  // ── Settings ──────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),

  // ── History ───────────────────────────────────────────
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // ── Window controls ───────────────────────────────────────
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close'),
});
