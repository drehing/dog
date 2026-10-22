'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toastAPI', {
  onData: (cb) => {
    ipcRenderer.on('toast:data', (_e, payload) => cb(payload));
  },
  onHide: (cb) => {
    ipcRenderer.on('toast:hide', () => cb());
  },
  dismiss: () => ipcRenderer.send('toast:event', 'dismiss'),
  open: () => ipcRenderer.send('toast:event', 'open'),
  hover: (paused) => ipcRenderer.send('toast:event', 'hover', Boolean(paused)),
});
