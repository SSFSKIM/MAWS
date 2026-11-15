// The window's preload: one name, as the app's. The viewer frames never get it (nodeIntegrationInSubFrames off).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maws', {
  checkFrame: (host) => ipcRenderer.invoke('check-frame', host),
  reportSlot: (rect) => ipcRenderer.send('slot', rect),
  menu: (open) => ipcRenderer.send('menu', open),
});
