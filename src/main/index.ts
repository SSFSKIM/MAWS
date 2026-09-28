import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { installRouter } from './ipc/router';
import { startSettings } from './settings';
import { appUrl, createWindow, installContentSecurityPolicy } from './window';

// A fresh profile for the end-to-end smoke (and anyone else who wants one); must be set before the app is ready.
if (process.env.MAWS_USER_DATA) app.setPath('userData', process.env.MAWS_USER_DATA);

// macOS convention (D-11): closing the last window keeps the app running; the dock icon re-creates it.
app.whenReady().then(() => {
  installContentSecurityPolicy();
  installRouter({ appUrl });
  const settings = startSettings(join(app.getPath('userData'), 'settings.json'));
  createWindow(settings.state().resolvedTheme);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings.state().resolvedTheme);
  });
});
