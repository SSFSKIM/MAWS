import { join } from 'node:path';
import { totalmem } from 'node:os'; // C12: the default memory budget
import { app, BrowserWindow, dialog, screen } from 'electron';
import { createHosts } from './hosts';
import { installRouter } from './ipc/router';
import { startSettings } from './settings';
import { startWithProfileLock } from './files/profile-lock';
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
import { LayoutFileStore } from './layout/store';
import { registerChatPanels } from './sessions/panel-lifetime';
import { askToQuit, installQuitGuard, listProcesses } from './lifecycle/quit-guard';
import { registerMenuHandlers, startMenu } from './menu';
import { registerOpenExternal } from './open-external';
import { startSessions } from './sessions';
import { startYield } from './sessions/yield'; // W7
import { restoreWindowState, trackWindowState } from './window-state';
// C5 end
// C7 start
import type { AppSessionId } from '@shared/graph/ids';
import { pickFiles } from './files/pick';
import { FileLister, listableRoots } from './git/ls-files';
import { onEmitted } from './ipc/events';
import { createGitRunner } from './git/runner';
import { claudeConfigDir, PromptHistory } from './history/prompt-history';
import { readUserEngineDefaults } from './settings/user-engine-defaults'; // W3
import { ClaudeUsageReader, claudeUsageDir } from './usage/claude-usage-reader';
// C7 end
import { baseUrlFrom, ClaudeUsageControl } from './usage/claude-usage-control'; // W6 route executor
// C8c start (emit comes with C3's imports)
import { shell } from 'electron';
import { registerFilesHandlers } from './files/register';
// C8c end
// C10 start (emit comes with C3's imports, createGitRunner with C7's, shell with C8c's)
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
// C11 start
// (electron's `shell` comes with C8c's imports above, `onEmitted` with C7's)
import type { CommandResult } from '@shared/ipc/schema';
import { saveTextFile } from './files/save-text';
import { captureChords } from './settings/capture-chords';
import { createClaudeUsageApp, execRunner } from './gateway/claude-usage-app';
import { startEngineConfigure } from './settings/engine-configure';
import { revealPath } from './settings/reveal';
import { sessionSettingsOf } from './settings/session-settings';
import { knownSessionDirectories } from './settings/session-directories';
import { CommandFailure, interceptCommand } from './ipc/router';
import { installWidgetBackend } from './widgets/fixture-backend';
// C11 end
// W13 start
import { rm } from 'node:fs/promises';
// W13 end
// E9 start (emit comes with C3's imports, registerMainHandler with C3's, shell with C8c's)
import { startVoice } from './voice/register';
// E9 end
// E5 start
import { trackUnsavedFiles } from './lifecycle/quit-guard';
// E5 end

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

void startWithProfileLock(app, () => {
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
    onState: (owner, listener) => hosts.onState(owner, listener),
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
  const sessionsDir = join(app.getPath('userData'), 'sessions');
  const intents = new FileIntentStore(join(sessionsDir, 'intents'));
  const stopChatPanels = registerChatPanels(layout, sessions.model, intents);
  app.on('will-quit', stopChatPanels);
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
  const engineEnv = captureShellEnvironment();
  const engineConfigDir = engineEnv.then((env) => claudeConfigDir(env, env.HOME || home));
  const userDefaults = async () => readUserEngineDefaults(await engineConfigDir);
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
  const history = engineConfigDir.then((configDir) => new PromptHistory({
    file: join(app.getPath('userData'), 'prompt-history.jsonl'),
    configDir,
    session: (appSessionId) => {
      const record = recordOf(appSessionId);
      return record && { directory: record.directory, engineSessionId: record.engineSessionId };
    },
  }));
  registerMainHandler('session.history.list', async ({ appSessionId, limit }) => ({ entries: await (await history).list(appSessionId as AppSessionId, limit) }));
  registerMainHandler('session.history.append', async ({ appSessionId, display, pastedContents, project }) => (await history).append(appSessionId as AppSessionId, display, pastedContents, project ?? null));
  // listable roots: the directories of every unarchived session the read model holds (both launch modes) or the index
  // holds, and every indexed project's directory; read again after any session or project change main tells the renderer
  const roots = () => {
    let projectDirectories: string[] = [];
    try {
      projectDirectories = index.projects.list({ includeHidden: true }).map((p) => p.directory);
    } catch {
      // the projects are unavailable; the session walk falls back to the read model on its own (with a warning)
    }
    const intentDirectories = intents.list().flatMap((intent) => [
      ...intent.additionalDirectories,
      ...(intent.location === null ? [] : [intent.location.kind === 'newWorktree' ? intent.location.repoRoot : intent.location.path]),
      ...(intent.progress.worktree === null ? [] : [intent.progress.worktree.path]),
    ]);
    return listableRoots([...knownSessionDirectories(sessions.model, index, { includeArchived: false }), ...intentDirectories], projectDirectories); // debt wave 4: C11's walk
  };
  const files = new FileLister({ run: createGitRunner(), roots });
  for (const name of ['session.changed', 'session.removed', 'session.projects.changed', 'session.intent.changed'] as const) onEmitted(name, () => files.invalidateRoots());
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
  // C8c start: files.* over each session's own directories (the allowlist is read from the read model, which C4's index
  // fills in launch mode index and the stub in scenario); watches are released per window inside the handlers.
  const filesService = registerFilesHandlers(sessions.model, {
    emit: (payload) => void emit('files.changed', payload),
    openPath: (path) => shell.openPath(path),
    showItemInFolder: (path) => shell.showItemInFolder(path), // E1: files.reveal
  });
  app.on('will-quit', () => filesService.dispose());
  // C8c end
  // C10 start: the worktree service (M2): git.worktree.*, every git mutation MAWS makes, with occupancy from holder
  // authority (C3's process table and C4's fresh registry read through the engine host, the index's records).
  const worktrees = new WorktreeService({ git: createGitRunner(), holders: { dispatch: hosts.dispatch, sessions: index.sessions } });
  registerWorktreeHandlers(worktrees);
  // The session service (M3): intents, start, fork, archive, delete, rename and the trust check, reading the global
  // config and the store with the environment the engine receives (the login-shell capture, as C3's host builds every
  // launch's). Its start resets every stale `self` holder at once (D-16), then forgets stale bootstrap ids and
  // reconciles interrupted handoffs once the engine host answers; `session.intent.list` waits for that.
  const sessionService = new SessionService({
    index,
    host: { dispatch: hosts.dispatch, onEvent: (name, listener) => hosts.onEvent(name, listener), ready: () => engineHostSettled(hosts) },
    git: createGitRunner(),
    worktrees,
    intents,
    bootstraps: new BootstrapNotes(join(sessionsDir, 'bootstraps')),
    userData: app.getPath('userData'),
    env: engineEnv,
    emit,
    trash: trashFor(process.env, (path) => shell.trashItem(path)), // the e2e seam (MAWS_E2E_TRASH_DIR) or the Trash
    reveal: (path) => shell.showItemInFolder(path),
    replay: ReplaySeam.fromEnv(process.env, process.cwd()), // the e2e seam (MAWS_E2E_REPLAY_FIXTURES)
    settings: () => sessionSettingsOf(settings.state().settings), // C11: the route, the relay policy and the subagent model from settings v3
    userDefaults, // W3: the user's defaultMode seeds a new intent's mode (read only)
    launchGate: () => engineConfigure.launchGate(), // C12: a launch waits for the host to hold the binary settings name (W13: custody retired)
  });
  registerSessionServiceHandlers(sessionService);
  sessionService.start().catch((error: unknown) => console.error('[sessions] the session service failed to start:', error));
  // C10 end
  // W7: a live MAWS process yields when a terminal or job that resumed its session starts writing into it
  const stopYield = startYield({ dispatch: hosts.dispatch, onEvent: (name, listener) => hosts.onEvent(name, listener), sessions: index.sessions, emit });
  app.on('will-quit', stopYield);

  // C11 start: the plumbing of settings v3 (C11 execution document, M1). The engine host's binary configuration follows
  // settings.engine; ClaudeUsage's hand-off and status; the reveal guard; the export's Save as….
  // W13: custody of a pinned copy is retired (charter D-1 as amended 2026-10-01); the copy an earlier run kept under
  // <userData>/engine/ is MAWS's own data, removed here
  void rm(join(app.getPath('userData'), 'engine'), { recursive: true, force: true }).catch((error: unknown) => console.warn('[engine] could not remove the retired custody copy', error));
  const engineConfigure = startEngineConfigure({ // C12: the coordinator (C11's stopEngineConfigure is its stop)
    settings: () => settings.state().settings,
    onSettingsChanged: (listener) => onEmitted('settings.changed', (state) => listener(state.settings)),
    hostState: () => hosts.snapshot('engine-host'),
    onHostState: (listener) => hosts.onState('engine-host', listener),
    dispatch: (config) => hosts.dispatch('engine-host', 'engine.configure', config) as Promise<CommandResult<'engine.configure'>>,
    // C12 start: the memory budget's policy from settings v4
    dispatchPolicy: (policy) => hosts.dispatch('engine-host', 'engine.policy.set', policy) as Promise<CommandResult<'engine.policy.set'>>,
    totalMemBytes: totalmem(),
    // C12 end
  });
  app.on('will-quit', engineConfigure.stop); // C12: .stop
  // C12 start: the Settings tab's read of the configuration main holds for it
  registerMainHandler('settings.engineApplied', () => engineConfigure.applied());
  // C12 end
  // Under the end-to-end harness nothing may activate the owner's ClaudeUsage: `open` answers as if it had.
  const e2e = process.env.MAWS_E2E === '1';
  const claudeUsage = createClaudeUsageApp({
    run: (file, args, timeoutMs) => (e2e && file === '/usr/bin/open' ? Promise.resolve({ stdout: '' }) : execRunner(file, args, timeoutMs)),
    relayRunning: async () => {
      const health = await hosts.dispatch('engine-host', 'engine.relayHealth', { force: true });
      return health.ok && (health.value as { ok: boolean }).ok;
    },
    dataDirPresent: () => usage.available(), // not usage.snapshot, which would replace the ids settings.usage last named
  });
  registerMainHandler('settings.claudeUsage.status', () => claudeUsage.status());
  registerMainHandler('settings.claudeUsage.open', (intent) => claudeUsage.open(intent));
  // W6 route executor: ClaudeUsage's control API for the usage popover's actions, asked when the popover opens and on
  // each usage change while it is open. Under the end-to-end harness only a stub named by MAWS_CLAUDE_USAGE_CONTROL_URL
  // is ever reached: without it there is no port, so the owner's relay is never called. Outside the harness the variable
  // is ignored, so a launch that inherits it cannot send the owner's token anywhere but ClaudeUsage's own port.
  const controlUrl = baseUrlFrom(process.env);
  const usageControl = new ClaudeUsageControl({
    dir: claudeUsageDir(process.env, home),
    port: () => (e2e && controlUrl === null ? Promise.resolve(null) : usage.gatewayPort()),
    baseUrl: controlUrl,
  });
  registerMainHandler('settings.usageControls', () => usageControl.controls());
  registerMainHandler('settings.usageAction', (action) => usageControl.act(action));
  registerMainHandler('settings.userEngineDefaults', userDefaults); // W3: read only
  const sessionDirectories = () => knownSessionDirectories(sessions.model, index);
  registerMainHandler('settings.reveal', ({ path }) =>
    revealPath(path, { configHome: () => claudeConfigDir(process.env, home), sessionDirectories, showItemInFolder: (p) => shell.showItemInFolder(p) }),
  );
  registerMainHandler('layout.captureChords', captureChords); // the Settings tab's chord capture sets the menu aside (M5 fix wave)
  registerMainHandler('layout.saveTextFile', (input, { sender }) =>
    saveTextFile(input, {
      downloads: app.getPath('downloads'),
      showSaveDialog: (options) => {
        const win = BrowserWindow.fromWebContents(sender);
        return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
      },
    }),
  );
  // The widget e2e's engine stand-in: under MAWS_WIDGET_BACKEND=fixtures in launch mode scenario only (M2).
  const stopWidgetBackend = installWidgetBackend({ env: process.env, packaged: app.isPackaged, appRoot: process.cwd(), intercept: interceptCommand, emit, fail: (error) => new CommandFailure(error) });
  if (stopWidgetBackend) app.on('will-quit', stopWidgetBackend);
  // C11 end

  // The hosts belong to the app, not to a window or a page (§4.1): they start here, before any window exists, and
  // `start()` is idempotent, so opening a window again forks nothing and a reload never reaches them.
  const openWindow = () => {
    void hosts.start();
    const win = createWindow(settings.state().resolvedTheme, placement()); // C5: restored placement
    tracked(win); // C5: tracked placement
    return win; // C5: the notifier re-creates the window through here
  };
  openWindow();

  // E5 start: each window's unsaved editor files for the quit guard (E5 execution document, M5): the page pushes its
  // whole dirty set, forgotten when the window navigates or closes; the question's Save all asks every window to save
  // and waits for the answers of the windows that hold files.
  const unsavedFiles = trackUnsavedFiles();
  registerMainHandler('layout.unsavedFiles', ({ paths }, { sender }) => unsavedFiles.update(sender, paths));
  registerMainHandler('layout.saveAllDone', ({ requestId, failed }, { sender }) => unsavedFiles.done(sender, requestId, failed));
  // E5 end

  // ---- C5: notifications, dock badge and the quit guard ----
  startAttention(sessions.model, { restoredIds: attention.restoredIds, settings: () => settings.state().settings, openWindow });
  // C12: the busy report asks C9's pty host (read only: pty.list and pty.foreground) and publishes Quit when idle's wait
  const quitGuard = installQuitGuard(sessions.model, {
    // C12 start
    pty: {
      list: async () => {
        const result = await hosts.dispatch('pty-host', 'pty.list', undefined);
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        return (result.value as { ptys: { ptyId: string; alive: boolean }[] }).ptys;
      },
      foreground: async (ptyId) => {
        const result = await hosts.dispatch('pty-host', 'pty.foreground', { ptyId });
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        return result.value as { busy: boolean };
      },
      hostGone: () => hosts.snapshot('pty-host').state !== 'ready',
    },
    publish: (waiting) => void emit('layout.quitWait', { waiting }),
    log: process.env.MAWS_E2E === '1' ? (line) => console.error(line) : undefined,
    // C12 end
    ask: (report, asked /* E5 */) =>
      askToQuit(
        report,
        {
          env: process.env,
          show: (options) => {
            const win = BrowserWindow.getFocusedWindow();
            return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
          },
        },
        asked,
      ),
    // C3's engine host stops its sessions within the grace; a host that cannot answer (not started, or a build without
    // C3's command) has nothing to stop.
    shutdownEngine: async () => {
      const result = await hosts.dispatch('engine-host', 'engine.shutdown', { graceMs: 5000 });
      if (!result.ok && result.error.code !== 'unknown_command' && result.error.code !== 'host_unavailable') {
        console.warn('[quit-guard] engine.shutdown failed', result.error);
      }
    },
    // debt wave 6: past the bound, the ladder's SIGKILL rung for the engines still the engine host's children
    engines: { hostPid: () => hosts.snapshot('engine-host').pid, ps: listProcesses, kill: (pid) => process.kill(pid, 'SIGKILL') },
    // E5 start: the unsaved files the windows pushed, and Save all's round trip
    unsavedFiles: () => unsavedFiles.paths(),
    saveAll: () => unsavedFiles.saveAll((requestId) => void emit('layout.saveAll', { requestId })),
    // E5 end
  });
  // C12 start: the banner's reads and answers
  registerMainHandler('layout.quitWait', () => ({ waiting: quitGuard.waiting() }));
  registerMainHandler('layout.quitWaitAnswer', ({ action }) => (action === 'quitNow' ? quitGuard.quitNow() : quitGuard.cancelWait()));
  // C12 end
  // ---- end C5 ----
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
  app.on('will-quit', () => hosts.stop());
  // E9 start: push-to-talk dictation (E9 execution document, M2): voice.* over the bundled helper, spawned on first use
  // (or, under the harness, the scripted backend or the probe-only helper); the helper is asked to quit at will-quit.
  const voice = startVoice({
    env: process.env,
    packaged: app.isPackaged,
    appRoot: process.cwd(), // the development app root, as C5's sessions read it
    resourcesPath: process.resourcesPath,
    emit: (event) => void emit('voice.event', event),
    openExternal: (url) => shell.openExternal(url),
    register: registerMainHandler,
  });
  app.on('will-quit', () => voice.dispose());
  // E9 end
});
