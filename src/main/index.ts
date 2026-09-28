import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { createHosts } from './hosts';
import { installRouter } from './ipc/router';
import { startSettings } from './settings';
import { appUrl, createWindow, installContentSecurityPolicy, prepareHarness } from './window';

// A fresh profile for the end-to-end smoke (and anyone else who wants one); must be set before the app is ready.
if (process.env.MAWS_USER_DATA) app.setPath('userData', process.env.MAWS_USER_DATA);
// The smoke runs unattended, so nothing may wait on a person: Chromium keeps its storage key in a mock keychain
// instead of asking the login keychain, whose access prompt an unsigned or re-signed build can raise.
if (process.env.MAWS_E2E) app.commandLine.appendSwitch('use-mock-keychain');

// macOS convention (D-11): closing the last window keeps the app running; the dock icon re-creates it (`activate`
// below). This empty listener is load-bearing: with no `window-all-closed` listener Electron quits when the last
// window closes, `will-quit` stops the hosts, and every live pty dies with a closed window (§4.1: hosts are app-scoped).
// Only an explicit quit (Cmd+Q, the menu, the Dock) ends the app.
app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  installContentSecurityPolicy();
  // C9 block begin: the harness's fake session directories
  if (process.env.MAWS_HARNESS === '1') prepareHarness();
  // C9 block end
  const hosts = createHosts();
  installRouter({ appUrl, dispatchToHost: hosts.dispatch });
  const settings = startSettings(join(app.getPath('userData'), 'settings.json'));

  // The hosts belong to the app, not to a window or a page (§4.1): they start here, before any window exists, and
  // `start()` is idempotent, so opening a window again forks nothing and a reload never reaches them.
  const openWindow = () => {
    void hosts.start();
    createWindow(settings.state().resolvedTheme);
  };
  openWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
  app.on('will-quit', () => hosts.stop());
});
