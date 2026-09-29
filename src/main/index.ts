import { join } from 'node:path';
import { app, BrowserWindow, dialog, screen } from 'electron';
import { createHosts } from './hosts';
import { installRouter } from './ipc/router';
import { startSettings } from './settings';
import { appUrl, createWindow, installContentSecurityPolicy } from './window';
// C3 start (the attention service's imports moved with its start into C4's block: src/main/index/attention-service.ts)
import { emit } from './ipc/events';
import { registerMainHandler } from './ipc/router';
// C3 end
// C4 start (emit comes with C3's imports)
import { startIndexAttention } from './index/attention-service';
import { Index } from './index/index';
import { registerIndexHandlers } from './index/register';
import { registerReplayHandlers } from './index/replay';
import { appRoot, seedReplayFixtures } from './index/replay-fixtures';
import { IndexSessionSource } from './index/source';
import { registerGitHandlers } from './git/register';
import { GitService } from './git/service';
// C4 end
// C5 start (emit comes with C3's imports)
import { startAttention } from './attention';
import { dropPanelKeysOfRemovedSessions, LayoutFileStore, registerLayoutHandlers } from './layout/store';
import { askToQuit, installQuitGuard } from './lifecycle/quit-guard';
import { registerMenuHandlers, startMenu } from './menu';
import { registerOpenExternal } from './open-external';
import { startSessions } from './sessions';
import { restoreWindowState, trackWindowState } from './window-state';
// C5 end

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
  // (the attention service starts in C4's block below, over the index that now implements its store: C3's handover)
  // C3 end

  // C4 start: the index (<userData>/index.sqlite) answers the record side of session.*, and its session source folds the
  // engine host's store events into it once the host is ready. C5's read model starts the source (its block below:
  // SessionReadModel.register, which refuses it in launch mode scenario) and stops it at will-quit.
  const index = new Index(join(app.getPath('userData'), 'index.sqlite'));
  registerIndexHandlers(index);
  const indexSource = new IndexSessionSource(index, hosts, { emit });
  // C3's attention service, as C3 started it, with `Index.attention` as its store (C3's file store only when this app
  // cannot read the index); an archive the index records retires the session's attention.
  const attention = startIndexAttention(index, {
    onEvent: (name, listener) => hosts.onEvent(name, listener),
    dispatch: hosts.dispatch,
    emit,
    register: registerMainHandler,
    fallbackFile: join(app.getPath('userData'), 'attention.json'),
  });
  // Replay (M5): started here, run in the engine host; the fixtures table lists the checkout's probe journals and
  // transcripts (none in a packaged app).
  const replays = registerReplayHandlers(index, hosts);
  if (index.unavailable === null) seedReplayFixtures(index.fixtures, appRoot(app.getAppPath()));
  // The read-only git service (M6): git.* for any directory in a repository, and git.changed for watched roots.
  const git = new GitService({ emit: (change) => void emit('git.changed', change) });
  registerGitHandlers(git);
  app.on('will-quit', () => {
    git.dispose();
    replays.dispose();
    attention.stop();
    // (the index closes at will-quit after C5's block below, once the read model has stopped the source that reads it)
  });
  // C4 end

  // ---- C5: layout store and the read side (launch mode, read model, stub source in scenario mode) ----
  const layout = new LayoutFileStore(join(app.getPath('userData'), 'layout.json'));
  registerOpenExternal();
  // A relative scenario path is the repository's: the working directory of `pnpm dev`, `pnpm dev:stub` and the smoke's
  // launch alike (`app.getAppPath()` is `out/main` when the built app is launched by file, as the smoke does).
  const sessions = startSessions({ env: process.env, packaged: app.isPackaged, appRoot: process.cwd(), hosts, indexSource });
  registerLayoutHandlers(layout, (appSessionId) => sessions.model.record(appSessionId) !== null);
  dropPanelKeysOfRemovedSessions(sessions.model, layout);
  app.on('will-quit', () => {
    layout.flush();
    sessions.stop();
  });
  // C4 start: registered after C5's will-quit above, so the index source has stopped before the index it reads closes
  app.on('will-quit', () => index.close());
  // C4 end
  // The application menu from the action table, rebuilt on settings and on the page's registered handlers.
  registerMenuHandlers(startMenu({ settings: () => settings.state().settings, emit }));
  // Window bounds persist under `window.main`; a window opens where the last one was left, if that is still on screen.
  const placement = () =>
    restoreWindowState(layout.get('window.main'), screen.getAllDisplays().map((d) => d.workArea), screen.getPrimaryDisplay().workArea);
  const tracked = (win: BrowserWindow) => trackWindowState(win, (state) => layout.set('window.main', state));
  // ---- end C5 ----

  // The hosts belong to the app, not to a window or a page (§4.1): they start here, before any window exists, and
  // `start()` is idempotent, so opening a window again forks nothing and a reload never reaches them.
  const openWindow = () => {
    void hosts.start();
    const win = createWindow(settings.state().resolvedTheme, placement()); // C5: restored placement
    tracked(win); // C5: tracked placement
    return win; // C5: the notifier re-creates the window through here
  };
  openWindow();

  // ---- C5: notifications, dock badge and the quit guard ----
  startAttention(sessions.model, { settings: () => settings.state().settings, openWindow });
  installQuitGuard(sessions.model, {
    ask: (count) =>
      askToQuit(count, {
        env: process.env,
        show: (options) => {
          const win = BrowserWindow.getFocusedWindow();
          return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
        },
      }),
    // C3's engine host stops its sessions within the grace; a host that cannot answer (not started, or a build without
    // C3's command) has nothing to stop.
    shutdownEngine: async () => {
      const result = await hosts.dispatch('engine-host', 'engine.shutdown', { graceMs: 5000 });
      if (!result.ok && result.error.code !== 'unknown_command' && result.error.code !== 'host_unavailable') {
        console.warn('[quit-guard] engine.shutdown failed', result.error);
      }
    },
  });
  // ---- end C5 ----
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
  app.on('will-quit', () => hosts.stop());
});
