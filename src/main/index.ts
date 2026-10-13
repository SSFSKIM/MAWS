import { guardStdio } from './stdio-guard'; // cua board #97
import { statSync } from 'node:fs'; // E11 F2b: the bundle on disk
import { join } from 'node:path';
import { totalmem } from 'node:os'; // C12: the default memory budget
import { app, BrowserWindow, dialog, screen } from 'electron';
import { createHosts } from './hosts';
import { installRouter } from './ipc/router';
import { startSettings } from './settings';
import { startWithProfileLock } from './files/profile-lock';
import { describeMainBuild, loadedBundlePath, olderInstanceNotice, staleBuildCheck, type MainBuild } from './build-identity'; // E11 §2.7; F2b 2.7b
import { builtAtLabel } from '@shared/app/build-time'; // E11 §2.7
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
import { registerObservedFacts } from './sessions/observed'; // P2-A
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
import { allowlistOf } from './files/allowlist'; // E11
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
import { startOwnerChannel } from './owner/register'; // P2-C (2026-10-09)
import { engineHostSettled, registerSessionServiceHandlers } from './sessions/service-register';
import { transcriptPathOf } from './sessions/context'; // P2-D
import { readRecentTurns } from './sessions/recent-turns'; // P2-D
// C10 end
// C11 start
// (electron's `shell` comes with C8c's imports above, `onEmitted` with C7's)
import type { CommandResult } from '@shared/ipc/schema';
import { saveTextFile } from './files/save-text';
import { captureChords } from './settings/capture-chords';
import { captureRegion } from './layout/capture-region'; // P3-G
import { createClaudeUsageApp, execRunner } from './gateway/claude-usage-app';
import { startEngineConfigure } from './settings/engine-configure';
import { startHostConfigure } from './settings/host-configure'; // E10
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
// E6 start (createGitRunner comes with C7's imports; the login-shell capture is C7's engineEnv)
import { createMutatingRunner } from './git/mutate';
import { registerScmHandlers } from './scm/register';
import { ScmService } from './scm/service';
// E6 end
// E3 start
import { sideThreadEvents, startSideThreads } from './side/side-threads';
// E3 end
// E2 start
import { appWindows } from './windows';
import { registerDeliverableScheme, startDeliverables } from './deliverables';
// E2 end
// E10 start
import { engineQuitDeps } from './lifecycle/engine-quit';
// E10 end
// E11 start
import { shutdownSteps } from './lifecycle/shutdown';
import { CLOSE_GRACE_MS } from '@shared/host/socket-port';
// E11 end
// E4a start
import { startBrowser, type Browser } from './browser';
// E4a end
// E4b start
import { ImportedProfiles, startBrowserImport, sweepBrowserImports } from './browser/import';
// E4b end
// P3-A start
import { startArtifacts } from './artifacts';
// P3-A end

// cua board #97: before any log line, so a launcher's closed pipe or terminal never turns a console call into a crash.
guardStdio([process.stdout, process.stderr]);
// Socket peer authentication (cua spec 2026-10-09-maws-socket-peer-auth-design.md, Decision Log 2026-10-10): without a
// listener, a same-user SIGUSR1 opens a Node inspector on 127.0.0.1:9229 whose code runs inside main, a route around the
// cua socket's peer check. A listener of its own keeps Node from starting one; `--inspect` still works (the e2e harness).
process.on('SIGUSR1', () => {});

// A fresh profile for the end-to-end smoke (and anyone else who wants one); must be set before the app is ready.
if (process.env.MAWS_USER_DATA) app.setPath('userData', process.env.MAWS_USER_DATA);
// The smoke runs unattended, so nothing may wait on a person: Chromium keeps its storage key in a mock keychain
// instead of asking the login keychain, whose access prompt an unsigned or re-signed build can raise.
if (process.env.MAWS_E2E) app.commandLine.appendSwitch('use-mock-keychain');
// E2: the deliverable store's scheme is privileged before the app is ready (protocol.registerSchemesAsPrivileged)
registerDeliverableScheme();

// macOS convention (D-11): closing the last window keeps the app running; the dock icon re-creates it (`activate`
// below). This empty listener is load-bearing: with no `window-all-closed` listener Electron quits when the last
// window closes, `will-quit` stops the hosts, and every live pty dies with a closed window (§4.1: hosts are app-scoped).
// Only an explicit quit (Cmd+Q, the menu, the Dock) ends the app.
app.on('window-all-closed', () => {});

// E11 §2.7: main's own build (electron.vite.config.ts's stamp), logged once at startup so a log says which main ran, and
// handed to the running instance by a second launch, which brings the running one forward and, when the launch is a
// newer build, says the running one is older and offers to quit it (before, the second launch exited with no word).
const MAIN_BUILD: MainBuild = { version: __MAWS_VERSION__, ...__MAWS_BUILD__ };
console.log(`[main] ${describeMainBuild(MAIN_BUILD)} · pid ${process.pid}`);
let bringForward: () => BrowserWindow | null = () => null; // the started app's window, shown and focused (or opened)
const OLDER = { quit: 'Quit MAWS', keep: 'Keep running' };
function offerQuit(win: BrowserWindow, notice: string): void {
  const options = { type: 'info' as const, message: notice, buttons: [OLDER.quit, OLDER.keep], defaultId: 0, cancelId: 1 };
  void dialog.showMessageBox(win, options).then(({ response }) => {
    if (response === 0) app.quit(); // the ordinary quit, its question about running sessions included
  });
}
// E11 F2b (plan 2.7b; the owner's actual case): opening the app after a rebuild at the same bundle path activates this
// process and starts no other, so `activate` (and a second launch too) compares the bundle main loaded, as it is on disk
// now, with this process's start, once per build on disk (`staleBuildCheck`). Built on first use: the paths are read then.
const STARTED_AT = Date.now() - process.uptime() * 1000;
const bundleMtime = (path: string): number | null => {
  const asar = process.noAsar;
  process.noAsar = true; // the archive file itself, not the directory Electron's fs makes of it
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  } finally {
    process.noAsar = asar;
  }
};
let diskCheck: (() => string | null) | null = null;
const diskBuildIsNewer = (): string | null =>
  (diskCheck ??= staleBuildCheck({
    bundlePath: loadedBundlePath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }),
    stat: bundleMtime,
    startedAt: STARTED_AT,
    running: MAIN_BUILD,
    formatTime: builtAtLabel,
  }))();
function answerSecondLaunch(launched: MainBuild | null): void {
  const win = bringForward();
  if (win === null) return; // quitting (or not yet started): nothing to bring forward or offer
  const onDisk = diskBuildIsNewer(); // asked either way, so the build on disk this answer covers is not said again
  const notice = olderInstanceNotice(MAIN_BUILD, launched, builtAtLabel) ?? onDisk;
  if (notice !== null) offerQuit(win, notice);
}

void startWithProfileLock(app, () => {
  installContentSecurityPolicy();
  // C9 block begin: the harness's fake session directories; a terminal's links open through pty.openLink
  if (process.env.MAWS_HARNESS === '1') prepareHarness();
  registerPtyOpenLink();
  // C9 block end
  const hosts = createHosts(MAIN_BUILD); // E11 §2.7: main's build for host.status
  installRouter({ appUrl, dispatchToHost: hosts.dispatch });
  const settings = startSettings(join(app.getPath('userData'), 'settings.json'));
  // E11: every will-quit step below joins one ordered list behind one listener (tracker row E10 "14 will-quit listeners");
  // a step's promise (the hosts' draining close of a kept supervisor's socket) holds the exit, bounded by the port's grace
  const shutdown = shutdownSteps(app, CLOSE_GRACE_MS);
  // C3 start: the engine host's userData travels in the environment it is forked with (the host protocol's hello carries
  // no fields), and main's attention service answers `attention.*` over the hosts' events (C3 execution document, M5).
  process.env.MAWS_USER_DATA = app.getPath('userData');
  // (the attention service starts in C4's block below, over the index that now implements its store: C3's handover)
  // C3 end
  // E2 start: the deliverable store's read side (E2 execution document, Design §2, §3, §7): main's reader over the files
  // the engine host writes, the maws-deliverable: scheme and the frame policies on the window's session and the capture
  // partition, deliverables.* and the capture service; the files service below admits delivered paths through the reader.
  const deliverables = startDeliverables({ userData: app.getPath('userData'), hosts, register: registerMainHandler, env: process.env });
  shutdown.add('deliverables', deliverables.stop);
  // E2 end

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
  shutdown.add('git, replays and attention', () => {
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
  const sessions = startSessions({
    env: process.env, packaged: app.isPackaged, appRoot: process.cwd(), hosts, indexSource,
    // E3: a parent's side-thread rows, re-synthesised from the index (none while the index is unavailable)
    appEventsExtra: (appSessionId) => {
      if (index.unavailable !== null) return [];
      try {
        return sideThreadEvents(index, appSessionId);
      } catch (error) {
        console.warn(`[side] ${appSessionId}: the side-thread rows could not be read: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    },
  });
  const sessionsDir = join(app.getPath('userData'), 'sessions');
  const intents = new FileIntentStore(join(sessionsDir, 'intents'));
  const stopChatPanels = registerChatPanels(layout, sessions.model, intents);
  shutdown.add('chat panels', stopChatPanels);
  shutdown.add('layout and sessions', () => {
    layout.flush();
    sessions.stop();
  });
  // C4 start: registered after C5's will-quit above, so the index source has stopped before the index it reads closes
  shutdown.add('index', () => index.close());
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
  // P2-D (2026-10-09): the resume chooser's preview read, from the transcript path the index keeps, else where the
  // engine writes a launched session's transcript (the stub source intercepts it in launch mode scenario)
  registerMainHandler('session.recentTurns', async ({ appSessionId, limit }) => {
    const id = appSessionId as AppSessionId;
    const record = index.unavailable === null ? index.sessions.get(id) : null;
    const known = record ? index.sessions.summaryOf(id)?.transcriptPath : null;
    const path = known || (record?.engineSessionId ? await transcriptPathOf(await engineEnv, record.directory, record.engineSessionId) : null);
    return readRecentTurns(path, limit);
  });
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
  shutdown.add('usage', () => usage.stop());
  // C7 end
  // C8c start: files.* over each session's own directories (the allowlist is read from the read model, which C4's index
  // fills in launch mode index and the stub in scenario); watches are released per window inside the handlers.
  // E11: an unstarted session (a New chat before its first send) reads its setup intent's location
  const filesService = registerFilesHandlers(allowlistOf(sessions.model, intents), {
    emit: (payload) => void emit('files.changed', payload),
    openPath: (path) => shell.openPath(path),
    showItemInFolder: (path) => shell.showItemInFolder(path), // E1: files.reveal
    admitted: (appSessionId, real) => deliverables.reader.admitted(appSessionId, real), // E2: a delivered file outside the roots
  });
  shutdown.add('files', () => filesService.dispose());
  // C8c end
  // C10 start: the worktree service (M2): git.worktree.*, every git mutation MAWS makes, with occupancy from holder
  // authority (C3's process table and C4's fresh registry read through the engine host, the index's records).
  const worktrees = new WorktreeService({ git: createGitRunner(), holders: { dispatch: hosts.dispatch, sessions: index.sessions } });
  registerWorktreeHandlers(worktrees);
  // The session service (M3): intents, start, fork, archive, delete, rename and the trust check, reading the global
  // config and the store with the environment the engine receives (the login-shell capture, as C3's host builds every
  // launch's). Its start resets every stale `self` holder at once (D-16), then forgets stale bootstrap ids and
  // reconciles interrupted handoffs once the engine host answers; `session.intent.list` waits for that.
  // E13: the session's cua socket for its launch (the in-app browser spec of 2026-10-08); the browser starts below, and a
  // launch asked before it (none is expected) carries no socket
  let cuaSockets: Browser['cua'] | null = null;
  // P2-C start (2026-10-09): the owner channel's launch half (the P2-C document, §2, §9): mods.* over the index, and the
  // decision every MAWS-owned launch takes for the to-human lane, reading the engine's config home from its environment;
  // M4: the marks, the answers and their attention items (ownerChannel.*), projected into C3's attention service
  const ownerChannel = startOwnerChannel({
    index, settings: () => settings.state().settings, engineEnv, onEvent: (name, listener) => hosts.onEvent(name, listener), register: registerMainHandler,
    attention, dispatch: hosts.dispatch, onHostState: (listener) => hosts.onState('engine-host', listener), onStreaming: (listener) => hosts.onStreaming('engine-host', listener),
    streaming: () => hosts.streaming('engine-host'), emit: (name, payload) => void emit(name, payload), onSettings: (listener) => settings.onChange(listener),
  });
  shutdown.add('owner channel', ownerChannel.stop);
  // P2-C end
  const sessionService = new SessionService({
    index,
    host: {
      dispatch: hosts.dispatch,
      onEvent: (name, listener) => hosts.onEvent(name, listener),
      ready: () => engineHostSettled(hosts),
      onReady: (listener) => hosts.onStreaming('engine-host', listener), // E10: a recovery deferred while the host was unreachable
    },
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
    browserBackend: (appSessionId) => cuaSockets?.socketPathFor(appSessionId) ?? null, // E13
    ownerChannel: ownerChannel.launches, // P2-C (2026-10-09)
    acquisitions: sessions.model, // P2-A (X16): the digest's availability follows each acquisition
  });
  registerSessionServiceHandlers(sessionService);
  registerObservedFacts(hosts.dispatch); // P2-A (X17): the engine host's observed facts, beside session.digests
  sessionService.start().catch((error: unknown) => console.error('[sessions] the session service failed to start:', error));
  // C10 end
  // E6 start: source control (E6 execution document, M1, M2): scm.* over the session's checkout, from the read model in
  // both launch modes; mutations through the mutating runner under the login-shell capture, which is also the environment
  // its trust gate reads (the engine's); after each mutation C4's watcher re-reads the root, so git.changed tells every
  // surface. Push and gh run only from a confirmed plan, under the same capture with the owner's credential helpers, and
  // stream as scm.remote.output; will-quit stops them. Main's process.env serves only MAWS_GIT and MAWS_GH.
  const scm = new ScmService({
    records: (id) => sessions.model.record(id),
    read: createGitRunner(),
    status: (directory) => git.status(directory),
    mutate: createMutatingRunner({ captured: () => engineEnv }),
    refresh: (directory) => git.refresh(directory),
    captured: () => engineEnv,
    env: process.env,
    emit: (event) => void emit('scm.remote.output', event),
  });
  registerScmHandlers(scm);
  shutdown.add('scm', () => scm.dispose());
  // E6 end
  // W7: a live MAWS process yields when a terminal or job that resumed its session starts writing into it
  const stopYield = startYield({ dispatch: hosts.dispatch, onEvent: (name, listener) => hosts.onEvent(name, listener), sessions: index.sessions, emit });
  shutdown.add('yield', stopYield);
  // E3 start: each live turn end of a side thread summarises it in its parent's transcript (E3 execution document, Design §5)
  const stopSideThreads = startSideThreads({ onEvent: (name, listener) => hosts.onEvent(name, listener), emit, sessions: index.sessions, sideThreads: index.sideThreads });
  shutdown.add('side threads', stopSideThreads);
  // E3 end

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
  shutdown.add('engine configure', engineConfigure.stop); // C12: .stop
  // E10: the supervisor's idle time, pushed beside engine.configure at every ready
  const stopHostConfigure = startHostConfigure({
    settings: () => settings.state().settings,
    onSettingsChanged: (listener) => onEmitted('settings.changed', (state) => listener(state.settings)),
    hostState: () => hosts.snapshot('engine-host'),
    onHostState: (listener) => hosts.onState('engine-host', listener),
    dispatch: (input) => hosts.dispatch('engine-host', 'host.configure', input) as Promise<CommandResult<'host.configure'>>,
    env: process.env,
  });
  shutdown.add('host configure', stopHostConfigure);
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
  // P3-G (§D4.1): Mark-up's still of a region the sender's window draws
  registerMainHandler('layout.captureRegion', (input, { sender }) => captureRegion(input, sender, BrowserWindow.fromWebContents(sender)));
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
  if (stopWidgetBackend) shutdown.add('widget backend', stopWidgetBackend);
  // C11 end

  // E4b start: the Chrome import's records and its boot sweep, before E4a's browser opens any partition (E4b execution
  // document, Decision Log 24, 27, 34): profiles.json's one owner in memory, which E4a reads through `profiles` below, and
  // the sweep of what a crash, a quit mid-import or a removal left (staging, unlisted partition folders, storage
  // directories and history rows).
  const browserProfiles = ImportedProfiles.open(app.getPath('userData'));
  sweepBrowserImports({ userData: app.getPath('userData'), profiles: browserProfiles, history: index.browserHistory, bookmarks: index.browserBookmarks /* cua #90 */ });
  // E4b end

  // E4a start: the in-app browser's main side (E4a execution document, Design §1 to §3, §9): the tab store over
  // <userData>/browser/tabs.json, the partitions, the views and browser.*, after the index (a deleted session closes its
  // tabs) and before any window, so the first page finds its handlers. Its will-quit write runs before the hosts stop.
  // Settings 11's browser section is read from the service at each use: the profile when a tab opens, the link target
  // when a page opens a window.
  const browser = startBrowser({
    userData: app.getPath('userData'),
    settings: () => settings.state().settings.browser,
    index,
    register: registerMainHandler,
    emit,
    env: process.env,
    profiles: () => browserProfiles.browsable(), // E4b
    // E4c start: the browser tools answer the engine host's requests (E4c Design §4; Decision Log 36)
    hosts,
    // E4c end
  });
  shutdown.add('browser', browser.stop);
  cuaSockets = browser.cua; // E13
  // E4a end
  // E4b start: the Chrome import over E4a's handle (E4b Decision Log 31, 32, 34): browser.import.*, the per-boot loading
  // of an imported profile's extensions, the active profile's partition prepared now; at will-quit a running import is
  // cancelled as far as can be done synchronously and every staging directory deleted.
  const browserImport = startBrowserImport({
    userData: app.getPath('userData'),
    settings: () => settings.state().settings.browser,
    index,
    register: registerMainHandler,
    emit,
    env: process.env,
    browser,
    profiles: browserProfiles,
  });
  shutdown.add('browser import', browserImport.stop);
  // E4b end

  // The hosts belong to the app, not to a window or a page (§4.1): they start here, before any window exists, and
  // `start()` is idempotent, so opening a window again forks nothing and a reload never reaches them.
  const openWindow = () => {
    void hosts.start();
    const win = createWindow(settings.state().resolvedTheme, placement()); // C5: restored placement
    tracked(win); // C5: tracked placement
    return win; // C5: the notifier re-creates the window through here
  };
  // P3-A M4: `artifacts.open` (a document's port to the asking window) and the design-system defaults' relay, before the
  // first window loads
  const artifacts = startArtifacts({
    hosts,
    register: registerMainHandler,
    settings: () => settings.state().settings,
    onSettingsChanged: (listener) => onEmitted('settings.changed', (state) => listener(state.settings)),
    env: process.env,
    openWindow,
  });
  shutdown.add('artifacts', artifacts.stop);
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
    ask: (report, asked /* E5 */, keep /* E10 */) =>
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
        keep,
      ),
    // C3's engine host stops its sessions within the grace; a host that cannot answer (not started, or a build without
    // C3's command) has nothing to stop. E10: through the quit's stop-all (`host.stopAll` to a detached supervisor, which
    // then exits; `engine.shutdown` to a utility host), and keep offered in detached mode with the setting's default.
    ...engineQuitDeps(hosts, () => settings.state().settings),
    // debt wave 6: past the bound, the ladder's SIGKILL rung for the engines still the engine host's children
    engines: { hostPid: () => hosts.snapshot('engine-host').pid, ps: listProcesses, kill: (pid) => process.kill(pid, 'SIGKILL') },
    // E5 start: the unsaved files the windows pushed, and Save all's round trip
    unsavedFiles: () => unsavedFiles.paths(),
    onUnsavedFiles: (listener) => unsavedFiles.onChange(listener), // E11
    saveAll: () => unsavedFiles.saveAll((requestId) => void emit('layout.saveAll', { requestId })),
    // E5 end
  });
  // C12 start: the banner's reads and answers
  registerMainHandler('layout.quitWait', () => ({ waiting: quitGuard.waiting() }));
  registerMainHandler('layout.quitWaitAnswer', ({ action }) => (action === 'quitNow' ? quitGuard.quitNow() : quitGuard.cancelWait()));
  // C12 end
  // ---- end C5 ----
  app.on('activate', () => {
    if (shutdown.quitting()) return; // W-B review M6: the services are stopped or stopping (the keep-quit hold)
    const win = appWindows()[0] ?? openWindow(); // E2: a capture window is not the app's
    const notice = diskBuildIsNewer(); // E11 F2b (plan 2.7b): a rebuild on disk, said once per build
    if (notice !== null) offerQuit(win, notice);
  });
  // E11 §2.7: a second launch brings this instance forward, as activate does
  bringForward = () => {
    if (shutdown.quitting()) return null;
    const win = appWindows()[0] ?? openWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    app.focus({ steal: true });
    return win;
  };
  // E10: kills the pty host and a utility engine host; a detached engine host's socket closes with no exit, so after a
  // keep the supervisor serves its sessions on (after any other quit it has already stopped them and is exiting). E11:
  // that close drains what the supervisor wrote before it saw the end, and the quit waits for it (the shutdown's bound)
  shutdown.add('hosts', () => hosts.stop());
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
  shutdown.add('voice', () => voice.dispose());
  // E9 end
}, { build: MAIN_BUILD, onSecondInstance: answerSecondLaunch }); // E11 §2.7
