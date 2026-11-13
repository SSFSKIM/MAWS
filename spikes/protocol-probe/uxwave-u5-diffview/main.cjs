// Electron main for the harness: one window on index.html, nothing else.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1200, height: 900, webPreferences: { contextIsolation: true } });
  win.loadFile(path.join(process.env.HARNESS_DIR, 'index.html'));
});
