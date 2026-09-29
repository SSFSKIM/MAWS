import { join } from 'node:path';
import { app, BrowserWindow, dialog, screen } from 'electron';
import { createHosts } from './hosts';
import { installRouter } from './ipc/router';
import { startSettings } from './settings';
import { registerPtyOpenLink } from './pty-links'; // C9
import { appUrl, createWindow, installContentSecurityPolicy, prepareHarness } from './window'; // C9: prepareHarness
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
// C7 start
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { pickFiles } from './files/pick';
import { FileLister } from './git/ls-files';
import { createGitRunner } from './git/runner';
import { claudeConfigDir, PromptHistory } from './history/prompt-history';
import { ClaudeUsageReader, claudeUsageDir } from './usage/claude-usage-reader';
// C7 end
// C10 start (emit comes with C3's imports, createGitRunner with C7's)
import { shell } from 'electron';
import { captureShellEnvironment } from '@shared/host/shell-env';
import { WorktreeService } from './git/worktrees';
import { registerWorktreeHandlers } from './git/worktrees-register';
import { BootstrapNotes, FileIntentStore } from './sessions/intents';
import { ReplaySeam } from './sessions/replay-seam';
import { trashFor } from './sessions/e2e-trash';
import { openDialogFor } from './files/e2e-pick';
import { SessionService } from './sessions/service';
import { engineHostSettled, registerSessionServiceHandlers } from './sessions/service-register';
// C10 end

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
  // C9 block begin: the harness's fake session directories; a terminal's links open through pty.openLink
  if (process.env.MAWS_HARNESS === '1') prepareHarness();
  registerPtyOpenLink();
  // C9 block end
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

  // C7 start: the composer's main services (C7 execution document, M1): ClaudeUsage's files for the status line (read
  // only), the prompt history (MAWS's own file; the terminal's read only), the `@` menu's file listing and the picker.
  const home = app.getPath('home');
  const usage = new ClaudeUsageReader({ dir: claudeUsageDir(process.env, home), emit: (snapshot) => void emit('settings.usageChanged', snapshot) });
  usage.start();
  registerMainHandler('settings.usage', ({ engineSessionIds }) => usage.snapshot(engineSessionIds));
  // a session's record from the read model (both launch modes), else the index; none for an unstarted session
  const recordOf = (appSessionId: AppSessionId) => {
    try {
      return sessions.model.record(appSessionId) ?? index.sessions.get(appSessionId);
    } catch {
      return null; // the index is unavailable
    }
  };
  const history = new PromptHistory({
    file: join(app.getPath('userData'), 'prompt-history.jsonl'),
    configDir: claudeConfigDir(process.env, home),
    session: (appSessionId) => {
      const record = recordOf(appSessionId);
      return record && { directory: record.directory, engineSessionId: record.engineSessionId };
    },
  });
  registerMainHandler('session.history.list', async ({ appSessionId, limit }) => ({ entries: await history.list(appSessionId as AppSessionId, limit) }));
  registerMainHandler('session.history.append', ({ appSessionId, display, pastedContents, project }) => history.append(appSessionId as AppSessionId, display, pastedContents, project ?? null));
  // listable roots: the directories of every session the read model holds (both launch modes) or the index holds
  // (archived included), and every indexed project's directory
  const roots = () => {
    const directoriesOf = (r: SessionRecord) => [r.directory, ...r.additionalDirectories, ...(r.worktree ? [r.worktree.path] : [])];
    const held = sessions.model.allRecords().flatMap(directoriesOf);
    try {
      return [...held, ...index.sessions.list({ includeArchived: true }).flatMap(directoriesOf), ...index.projects.list({ includeHidden: true }).map((p) => p.directory)];
    } catch {
      return held; // the index is unavailable
    }
  };
  const files = new FileLister({ run: createGitRunner(), roots });
  registerMainHandler('git.lsFiles', (input) => files.list(input));
  registerMainHandler('layout.pickFiles', (input, { sender }) =>
    pickFiles(input, {
      // C10: the e2e seam (MAWS_E2E=1 never opens the native panel; MAWS_E2E_PICK_PATHS or cancelled), else the panel
      showOpenDialog: openDialogFor(process.env, (options) => {
        const win = BrowserWindow.fromWebContents(sender);
        return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
      }),
    }),
  );
  app.on('will-quit', () => usage.stop());
  // C7 end
  // C10 start: the worktree service (M2): git.worktree.*, every git mutation MAWS makes, with occupancy from holder
  // authority (C3's process table and C4's fresh registry read through the engine host, the index's records).
  const worktrees = new WorktreeService({ git: createGitRunner(), holders: { dispatch: hosts.dispatch, sessions: index.sessions } });
  registerWorktreeHandlers(worktrees);
  // The session service (M3): intents, start, fork, archive, delete, rename and the trust check, reading the global
  // config and the store with the environment the engine receives (the login-shell capture, as C3's host builds every
  // launch's). Its start resets every stale `self` holder at once (D-16), then forgets stale bootstrap ids and
  // reconciles interrupted handoffs once the engine host answers; `session.intent.list` waits for that.
  const sessionsDir = join(app.getPath('userData'), 'sessions');
  const sessionService = new SessionService({
    index,
    host: { dispatch: hosts.dispatch, onEvent: (name, listener) => hosts.onEvent(name, listener), ready: () => engineHostSettled(hosts) },
    git: createGitRunner(),
    worktrees,
    intents: new FileIntentStore(join(sessionsDir, 'intents')),
    bootstraps: new BootstrapNotes(join(sessionsDir, 'bootstraps')),
    userData: app.getPath('userData'),
    env: captureShellEnvironment(),
    emit,
    trash: trashFor(process.env, (path) => shell.trashItem(path)), // the e2e seam (MAWS_E2E_TRASH_DIR) or the Trash
    reveal: (path) => shell.showItemInFolder(path),
    replay: ReplaySeam.fromEnv(process.env, process.cwd()), // the e2e seam (MAWS_E2E_REPLAY_FIXTURES)
  });
  registerSessionServiceHandlers(sessionService);
  sessionService.start().catch((error: unknown) => console.error('[sessions] the session service failed to start:', error));
  // C10 end

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
