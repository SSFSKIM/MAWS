import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { createHosts } from './hosts';
import { installRouter } from './ipc/router';
import { startSettings } from './settings';
import { appUrl, createWindow, installContentSecurityPolicy } from './window';
// C3 start
import { FileAttentionStore } from './attention/file-attention-store';
import { startAttentionService } from './attention/service';
import { emit } from './ipc/events';
import { registerMainHandler } from './ipc/router';
// C3 end
// C4 start (emit comes with C3's imports)
import { Index } from './index/index';
import { registerIndexHandlers } from './index/register';
import { registerReplayHandlers } from './index/replay';
import { appRoot, seedReplayFixtures } from './index/replay-fixtures';
import { IndexSessionSource, type ReadModelWriter } from './index/source';
// C4 end

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
  const hosts = createHosts();
  installRouter({ appUrl, dispatchToHost: hosts.dispatch });
  const settings = startSettings(join(app.getPath('userData'), 'settings.json'));
  // C3 start: the engine host's userData travels in the environment it is forked with (the host protocol's hello carries
  // no fields), and main's attention service answers `attention.*` over the hosts' events (C3 execution document, M5).
  process.env.MAWS_USER_DATA = app.getPath('userData');
  startAttentionService({ onEvent: (name, listener) => hosts.onEvent(name, listener), dispatch: hosts.dispatch, store: new FileAttentionStore(join(app.getPath('userData'), 'attention.json')), emit, register: registerMainHandler });
  // C3 end

  // C4 start: the index (<userData>/index.sqlite) answers the record side of session.*, and its session source folds the
  // engine host's store events into it once the host is ready. Until C5's read model registers the source, nothing
  // main-side reads what it writes, so its writer drops every observation.
  const index = new Index(join(app.getPath('userData'), 'index.sqlite'));
  registerIndexHandlers(index);
  const noReadModel: ReadModelWriter = { observeRecord() {}, observeRemoved() {}, observeProject() {}, observeProjectRemoved() {}, setDigest() {} };
  const stopSource = new IndexSessionSource(index, hosts, { emit }).start(noReadModel);
  // Replay (M5): started here, run in the engine host; the fixtures table lists the checkout's probe journals and
  // transcripts (none in a packaged app).
  const replays = registerReplayHandlers(index, hosts);
  if (index.unavailable === null) seedReplayFixtures(index.fixtures, appRoot(app.getAppPath()));
  app.on('will-quit', () => {
    replays.dispose();
    stopSource();
    index.close();
  });
  // C4 end

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
