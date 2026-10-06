// The shell renderer's preload (the stand-in for MAWS's own sandboxed renderer). It carries two messages main needs for
// the browser view: where the `browser` pane's rect is (`browser.view.place`) and whether a renderer-drawn layer covers
// it (`browser.view.cover`).
const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('shellBridge', {
  place: (rect) => ipcRenderer.send('browser.view.place', rect),
  cover: (covered, t) => ipcRenderer.send('browser.view.cover', { covered, t }),
  epoch: () => performance.timeOrigin + performance.now(),
});
