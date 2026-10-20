// The page's bridge to main: trusted input and the report.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('harness', {
  versions: { ...process.versions },
  insertText: (text) => ipcRenderer.invoke('insertText', text),
  key: (keyCode, modifiers) => ipcRenderer.invoke('key', keyCode, modifiers),
  focusContents: () => ipcRenderer.invoke('focusContents'),
  report: (result) => ipcRenderer.invoke('report', result),
});
