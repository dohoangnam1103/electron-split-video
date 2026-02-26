const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectVideo: () => ipcRenderer.invoke('select-video'),
  processVideo: (filePath, keepSec, skipSec) => ipcRenderer.invoke('process-video', filePath, keepSec, skipSec),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  onProgress: (callback) => {
    ipcRenderer.on('progress', (_event, data) => callback(data));
  },
  removeProgressListener: () => {
    ipcRenderer.removeAllListeners('progress');
  },
});
