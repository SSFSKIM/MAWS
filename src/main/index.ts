import { app, BrowserWindow } from 'electron';
import { createWindow, installContentSecurityPolicy } from './window';

// macOS convention (D-11): closing the last window keeps the app running; the dock icon re-creates it.
app.whenReady().then(() => {
  installContentSecurityPolicy();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
