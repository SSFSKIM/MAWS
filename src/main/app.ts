// P5 O5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §E): the app's composition root, moved verbatim
// from src/main/index.ts, which is now the entry: it runs the bootstrap every mode shares (the stdio guard, the SIGUSR1
// refusal, MAWS_USER_DATA, Chromium's switches, the store's scheme) and then loads this module. Everything below the
// imports is today's index.ts below that bootstrap, unchanged in behaviour.
// P5 O3-C (docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md): the library's one door, its two roots
import { COMMAND_BUDGETS_MS, openSpineData, startMachineIdentity, startSpine, type SpineData } from '../services/entry';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult } from '@shared/ipc/schema';
import { REGISTRY } from '@shared/ipc/registry'; // P5 O3-D M1: the bus's register reads each name's owner
import { statSync } from 'node:fs'; // E11 F2b: the bundle on disk
import { join } from 'node:path';
import { hostname } from 'node:os'; // P5 O6 M1: the machine's name
import { app, BrowserWindow, dialog, screen } from 'electron';
import type { ClientRef } from '@shared/ipc/client';
import { mainClient, pageOf } from './ipc/clients'; // P5 O3-E: mainClient, main's own asker
import { createHosts, prepareLaunch, refuseTestLaunchOnDefaultProfile, type LaunchShape } from './hosts'; // P5 O2 M7: prepareLaunch; the landing: the refusal
import { dispatchLocal, installRouter, invokeOwn } from './ipc/router'; // P5 O6 M3: dispatchLocal, the local link's and the stand-in's; P5 O3-E: invokeOwn, main's own calls
import { startSettings, type SettingsService } from './client/settings'; // P5 O3-A: the client half, composed with the machine's
import { readLaunchShape } from './client/settings-store'; // P5 O3-A
import { createMachineSettingsMirror } from './client/machine-settings-mirror'; // P5 O3-D M5b: the daemon shape's machine half
import { startDaemonSpine, type DaemonSpine } from './sessions/daemon-spine'; // P5 O3-D M5b: the daemon shape's spine
import { CUA_SOCKET_DIR } from '@shared/browser/cua-socket'; // P5 O3-D M5b
import { launchMode, scenarioPath } from '@shared/sessions/select-source'; // P5 O3-D M5b (D11)
import { settingsPaths } from '@shared/settings/paths';
import { startWithProfileLock } from './files/profile-lock';
import { describeMainBuild, loadedBundlePath, olderInstanceNotice, staleBuildCheck, type MainBuild } from './build-identity'; // E11 §2.7; F2b 2.7b
import { builtAtLabel } from '@shared/app/build-time'; // E11 §2.7
import { registerPtyOpenLink } from './pty-links'; // C9
import { appUrl, createWindow, installContentSecurityPolicy, prepareHarness } from './window'; // C9: prepareHarness
// C3 start (the attention service is the spine's: src/services/spine-root.ts)
import { emit, emitFrom } from './ipc/events'; // P5 O9 M9: emitFrom, remote lane A's events
import { registerMachineHandler, registerMainHandler } from './ipc/router'; // P5 O6 M1: registerMachineHandler
import { bindLocalMachine } from './machine/local'; // P5 O6 M2
import { startMachines } from './machines'; // P5 O6 M3: the connection manager (P5 O3-D M6: the stand-in gone)
import { createStateSigner, createStepUp } from './device/step-up'; // P5 O7 M1: the development org session's signer; P5 O8 M1: the production session's; M3: its state signer
import { createDevOrgSession } from './org/dev-session'; // P5 O7 M1
import type { MachineRef } from '@shared/machine/ref'; // P5 O6 M2
import type { RemoteLink } from './machines/remote/link'; // P5 O8 M3: the deliveries' links
import { powerMonitor } from 'electron'; // P5 O8 M1: the Registry feed reconnects at wake and unlock
import { openExternalUrl } from './open-external'; // P5 O8 M1: the Access login's browser trip
import { createOrgSession } from './org/org-session'; // P5 O8 M1
import { excludeFromBackup } from '@shared/fs/backup-exclusion';
import { createRegistryFeed } from './org/registry-feed'; // P5 O8 M1
import { registerOrgHandlers, registerRowsHandler } from './org/register'; // P5 O8 M1; M2: org.rows
import { orgFiles } from './org/files'; // P5 O8 M1
import { createRemoteRows } from './org/rows'; // P5 O8 M2
import { installOrgPageFixture } from './org/page-fixture'; // P5 O8 M4a Task 8: a harness build's only
import { createRemoteLaneA, routeLaneA } from './lane-a/remote'; // P5 O9 M9
// C3 end
// C5 start (emit comes with C3's imports)
import { notificationActions } from './attention/actions';
import { startAttention } from './attention';
import { LayoutFileStore } from './layout/store';
import { registerChatPanels } from './sessions/panel-lifetime';
import { askToQuit, installQuitGuard, listProcesses } from './lifecycle/quit-guard';
import { registerMenuHandlers, startMenu } from './menu';
import { registerOpenExternal } from './open-external';
import { electronClientPort } from './client/electron-port'; // P5 O1 M3
import { restoreWindowState, trackWindowState } from './window-state';
// C5 end
// C7 start
import { pickFiles } from './files/pick';
import { onEmitted } from './ipc/events';
import { claudeConfigDir } from '@shared/engine/config-dir';
import { ClaudeUsageReader, claudeUsageDir } from './usage/claude-usage-reader';
// C7 end
import { baseUrlFrom, ClaudeUsageControl } from './usage/claude-usage-control'; // W6 route executor
// C8c start (emit comes with C3's imports)
import { shell } from 'electron';
// C8c end
// C10 start (emit comes with C3's imports, shell with C8c's)
import { captureShellEnvironment } from '@shared/host/shell-env';
// C10 end
// C11 start
// (electron's `shell` comes with C8c's imports above, `onEmitted` with C7's)
import { saveTextFile } from './files/save-text';
import { captureChords } from './settings/capture-chords';
import { captureRegion } from './layout/capture-region'; // P3-G
import { createClaudeUsageApp, execRunner } from './gateway/claude-usage-app';
import { appInterest, startInterest } from './sessions/interest'; // P5 O2 M2; P5 O3-C: appInterest
import { revealPath } from './settings/reveal';
import { knownSessionDirectories } from '@shared/sessions/directories';
import { CommandFailure, interceptCommand } from './ipc/router';
import { installWidgetBackend } from './widgets/fixture-backend';
// C11 end
// E9 start (emit comes with C3's imports, registerMainHandler with C3's, shell with C8c's)
import { startVoice } from './voice/register';
// E9 end
// E5 start
import { trackUnsavedFiles } from './lifecycle/quit-guard';
// E5 end
// E2 start
import { appWindows } from './windows';
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
// P5 O3-A start: the browser's own database, out of the index
import { BROWSER_DATA_PATH } from '@shared/browser/data-schema';
import { BrowserData } from './browser/data';
// P5 O3-A end
// E4b start
import { ImportedProfiles, startBrowserImport, sweepBrowserImports } from './browser/import';
// E4b end
// P3-A start
import { installStorePolicies, startArtifacts } from './artifacts'; // P5 O5: registerStoreSchemes runs in the entry's shared bootstrap
// P3-A end
// P3-L start
import { readResolvedThrough, registerLibraryFiles } from './library/files'; // P5 O3-C (D22): the client's, beside the spine's derived index
import type { ServicesBus } from '@shared/spine/bus'; // P5 O3-C
// P3-L end
// P3-B start
import { registerInspectionExporters } from './artifacts/inspection';
import { registerDocumentExporters } from './artifacts/export-document'; // P3-B
import { resolveExportHumanName } from '@shared/artifacts/export-author';
// P3-B end
// P3-D start
import { engineHostCall, governDocumentExporter } from './design-systems/documents';
import { registerDesignSystemExporters } from './design-systems/export';
import { registerPresentationExporters } from './presentations/export'; // P3-C M9
import { registerDesignExporters } from './design/export'; // P3-E (E1's M5)
import { registerPresenter } from './presentations/present'; // P3-C M6
// P3-D end
// P3-E start
import { registerAssetDownload } from './dashboard/download';
import { holdAsset, registerDatasetHolds } from './dashboard/holds'; // E3
import { registerDashboardExporters } from './dashboard/export'; // E2 M5
// P3-E end
import { startCatalog } from './catalog'; // P4-AGG M2: Discover's catalog

// P5 O2 landing: a test or harness launch never runs on the default profile, whose daemon and LaunchAgent are the
// owner's; it exits here, before the profile lock, the machine identity, the settings or a host (hosts/mode.ts).
refuseTestLaunchOnDefaultProfile();

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
  // P5 O6 M1 (OX2): the profile's MachineRef, minted at its first start into <userData>/machine.json and read ever after,
  // before anything starts or any window opens. A malformed file stops startup, naming its path: a fresh ref would
  // re-address everything kept under the old one.
  let local: MachineRef;
  let localName: string; // P5 O6 M3: a display attribute, for machines.list
  try {
    ({ ref: local, name: localName } = startMachineIdentity({ userData: app.getPath('userData'), env: process.env, hostname: hostname(), register: registerMachineHandler }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[machine] ${message}`);
    dialog.showErrorBox('MAWS cannot start', message);
    app.exit(1);
    return;
  }
  bindLocalMachine(local); // P5 O6 M2: the router's, `emit`'s and every app window's local machine
  // P5 O2 M7: the launch's shape (`supervisor.shape`, read once) settled before the hosts are created: the default
  // profile's LaunchAgent installed, repaired or uninstalled first. P5 O3-A (the O3 document §2): the shape is the client
  // file's own field, read without the spine lock and writing nothing; the lock is taken once the shape is settled.
  const profile = app.getPath('userData');
  const paths = settingsPaths(profile);
  const machine = { local, localName };
  return Promise.resolve(prepareLaunch(readLaunchShape(paths.client))).then(
    // P5 O3-A, O3-C: the spine's data (spine.lock, then the split and the machine half) once the shape has settled. P5 O3-D
    // M5b: on the daemon shape the spine is `mawsd`'s, which takes spine.lock and alone writes the machine's files; main
    // opens none of them
    async (settled) => startMain(settled.mode === 'daemon' ? null : await openSpineData(profile, { build: `${MAIN_BUILD.version}+${MAIN_BUILD.commit}` }), settled, machine),
    (error: unknown) => {
      console.error('[hosts] the launch could not settle its shape; quitting', error);
      app.exit(1);
    },
  ).catch((error: unknown) => {
    console.error('[main] MAWS could not start; quitting', error);
    app.exit(1);
  });
}, { build: MAIN_BUILD, onSecondInstance: answerSecondLaunch }); // E11 §2.7

// P5 O3-A (the O3 document §2, §3; contracts O3X2, O3X3): `openSpineData` took `spine.lock` before either settings file
// is migrated or written and before the index opens (startSpine), then, holding it, split a unified settings file, once,
// and started the machine half; the client half composes with it here. Refused, nothing is migrated, the machine half is
// read and never written, and the client file is written only once it is a client file. The lock is held for the
// process's life.
// P5 O3-D M5b (D11): a scenario launch on the daemon shape plays its scenario in mawsd, which inherits this environment;
// the scenario's path is resolved here, against main's root, before mawsd is started with it.
function absoluteScenarioPath(): void {
  if (launchMode(process.env, app.isPackaged) !== 'scenario') return;
  try {
    process.env.MAWS_SESSION_SOURCE = `stub:${scenarioPath(process.env, { packaged: app.isPackaged, appRoot: process.cwd() })}`;
  } catch (error) {
    console.error('[sessions] the scenario path could not be resolved; mawsd reads it as given', error);
  }
}

// P5 O3-D M5b (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §F, §G, §E; D11, D19, D20, D25): two
// roots by shape. The embedded one (`data`, this run's spine.lock and machine half) composes the spine here, as above. On
// the daemon shape (`data` null) the spine runs in `mawsd`: main binds `machine` as `host`, reads the spine through its
// mirror (src/main/sessions/spine-mirror.ts), the machine half through its settings mirror, answers the client port's
// requests and holds neither spine.lock nor any of the machine's files.
function startMain(data: SpineData | null, launch: LaunchShape, { local, localName }: { local: MachineRef; localName: string }): void {
  const profile = app.getPath('userData');
  // D11: a scenario's path made absolute before mawsd is started with this environment, so its own root is never consulted
  if (data === null) absoluteScenarioPath();
  // P5 O3-A (the O3 document §2): whether this run holds `spine.lock`. Refused, none of the spine's services that write
  // the machine's files or launch a session starts (startSpine says which), the index is opened unavailable, and the
  // client half runs.
  const { hosts, daemon } = createHosts(MAIN_BUILD, launch, { spineRefused: data?.refused ?? null, machineBudgetsMs: COMMAND_BUDGETS_MS }); // E11 §2.7: main's build for host.status; P5 O2 M7: the launch's shape; P5 O3-A: why the spine does not run
  // P5 O3-D M5b (§G, D20): the daemon shape's machine half mirrors mawsd's, from machine-settings.json read and never written;
  // a client change waits for mawsd's settings split at the first launch on a profile before it (composeSettings)
  const mirror = data === null ? createMachineSettingsMirror({ file: settingsPaths(profile).machine, hosts, log: (line) => console.log(line) }) : null;
  const settings: SettingsService = startSettings({ clientFile: settingsPaths(profile).client, machine: data?.machineSettings ?? mirror!, ...(mirror && { split: mirror.answered }) });
  installContentSecurityPolicy();
  // C9 block begin: the harness's fake session directories; a terminal's links open through pty.openLink
  if (process.env.MAWS_HARNESS === '1') prepareHarness();
  registerPtyOpenLink();
  // C9 block end
  // P5 O1 M3 (OX4): the client port, the one way a machine-bound service reaches the person's screen: dialogs, the
  // Replace question, Finder, the browser, notifications, the badge and focus. `openWindow` is read when a focus needs it.
  // (Made before the org session, whose weekly successor notifies through it: P5 O8 M3.)
  const clientPort = electronClientPort({ env: process.env, openWindow: () => openWindow() });
  // P5 O8 M2: O7's RL2 roster, as machines.onRemote reports it (wired once the machines start, below), for M2's rows and
  // M3's deliveries; M3: the links themselves, through machines.remote once it exists
  let roster: readonly MachineRef[] = [];
  const rosterListeners = new Set<() => void>();
  const onRoster = (listener: () => void) => {
    rosterListeners.add(listener);
    return () => void rosterListeners.delete(listener);
  };
  let remoteLink: (ref: MachineRef) => RemoteLink | null = () => null;
  // P5 O8 M1: this profile's org session (src/main/org/org-session.ts): the sign-in from a pairing code, the held org
  // state and the hub's credential, read from <userData>/org/ in the background; a profile that never signs in makes no
  // keys, files or requests. A development build started with MAWS_DEV_ORG=<dir> runs O7's development session instead
  // (dev-session.ts), and org.status says so. One Registry feed (?app=1) follows the hub for whichever session runs, and
  // hands the production session its notices; org.* answers the Org section.
  const devOrg =
    process.env.MAWS_DEV_ORG && !app.isPackaged
      ? createDevOrgSession({
          dir: process.env.MAWS_DEV_ORG,
          userData: app.getPath('userData'),
          packaged: app.isPackaged,
          build: `${MAIN_BUILD.version}+${MAIN_BUILD.commit}`,
          stepUp: (keys, device) => createStepUp({ device, key: keys.stepUp }),
          log: (line) => console.log(line),
        })
      : null;
  // One handle on <userData>/org/ for the session and M2's rows cache; excluded from Time Machine at its creation
  const orgDir = orgFiles({ userData: app.getPath('userData'), excludeFromBackup: (path) => excludeFromBackup(path), log: (line) => console.log(`[org] ${line}`) });
  const orgSession =
    devOrg === null
      ? createOrgSession({
          files: orgDir,
          userData: app.getPath('userData'),
          build: `${MAIN_BUILD.version}+${MAIN_BUILD.commit}`,
          packaged: app.isPackaged,
          env: process.env,
          openExternal: (url) => openExternalUrl(url),
          stepUp: (keys, device) => createStepUp({ device, key: keys.stepUp }),
          // `<userData>/org/` stays out of Time Machine, as the device keys do: a restored token or chain is no one's
          excludeFromBackup: (path) => excludeFromBackup(path),
          // M3: the app as the org's signer. Org states are signed with the device's step-up key behind Touch ID (the
          // key stays in step-up.ts); the weekly successor asks at a window's focus, and notifies once a day while no
          // window is in front (a click brings the app forward, whose focus may then ask); revocations go to the RL2
          // roster's machines over their links.
          signing: {
            stateSigner: (keys) => createStateSigner({ key: keys.stepUp }),
            focused: () => BrowserWindow.getFocusedWindow() !== null,
            onFocus: (listener) => {
              const focused = () => listener();
              app.on('browser-window-focus', focused);
              return () => void app.off('browser-window-focus', focused);
            },
            notify: (text) =>
              void clientPort.notify(null, { title: 'MAWS', body: text, silent: false }, (event) => {
                if (event.kind === 'clicked') clientPort.focus(null, 'bring');
              }),
            roster: () => roster,
            onRoster,
            link: (ref) => remoteLink(ref),
          },
          log: (line) => console.log(line),
        })
      : null;
  const session = devOrg ?? orgSession!;
  const orgFeed = createRegistryFeed({ session, log: (line) => console.log(line) });
  orgSession?.attach(orgFeed);
  const unpublishOrgStatus = registerOrgHandlers({ register: registerMainHandler, emit: (name, status) => void emit(name, status), service: orgSession, development: devOrg });
  // P5 O8 M4a Task 8: the Org page's e2e look seeds org.* from a fixture (org/page-fixture.ts), which also stops the
  // session's org.changed. The guard folds to false outside a harness build, which then carries none of it.
  if (typeof __MAWS_HARNESS_BUILD__ !== 'undefined' && __MAWS_HARNESS_BUILD__) {
    installOrgPageFixture({ env: process.env, packaged: app.isPackaged, intercept: interceptCommand, unpublish: unpublishOrgStatus });
  }
  powerMonitor.on('resume', () => orgFeed.probe());
  powerMonitor.on('unlock-screen', () => orgFeed.probe());
  // P5 O6 M3: every other machine through the connection manager (one link per machine; MAWS_LOCAL_MACHINES names another
  // profile's serve directory in a build that is not packaged), and machines.list and machines.changed
  const machines = startMachines({
    local,
    localName,
    userData: app.getPath('userData'),
    packaged: app.isPackaged,
    env: process.env,
    build: `${MAIN_BUILD.version}+${MAIN_BUILD.commit}`,
    register: registerMainHandler,
    dispatchLocal,
    // P5 O7 M1: the org session the RL2 links read; P5 O8 M1: production's sign-in, or O7's development session
    session,
  });
  // P5 O9 M9: `laneA.*` for a machine O7's link reaches is remote lane A's (src/main/lane-a/remote.ts), over that link;
  // every other command for another machine, and `laneA.*` for a socket-linked profile, goes to the manager. It writes
  // no file, so it runs in a run that doesn't hold spine.lock too.
  const remoteLaneA = createRemoteLaneA({ local, emit: (machine, name, payload) => void emitFrom(machine, name, payload), log: (line) => console.log(`[lane-a] ${line}`) });
  // P5 O3-D M5b: on the daemon shape a `machine` name goes to mawsd's services front (the `machine` host); the spine's
  // mirror, once it runs, is told each forward, to replay the pages' visibility claims at each streaming of mawsd
  // P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §E): a page's git.watch and git.unwatch
  // go through the spine's watch replay, which sends them under units of its own and gives them back at each streaming
  let forwardedToMachine: ((name: string, input: unknown, client: ClientRef | undefined) => void) | null = null;
  let watchReplay: DaemonSpine['watches'] | null = null;
  const dispatchToHost: typeof hosts.dispatch = (owner, name, input, client) => {
    if (owner === 'machine' && client !== undefined && watchReplay?.owns(name)) return watchReplay.dispatch(name as 'git.watch' | 'git.unwatch', input, client);
    if (owner === 'machine') forwardedToMachine?.(name, input, client);
    return hosts.dispatch(owner, name, input, client);
  };
  installRouter({ appUrl, local, dispatchToHost, remote: routeLaneA(machines.dispatch, (ref) => machines.remote(ref), remoteLaneA), machine: { kind: data === null ? 'host' : 'embedded' } });
  // P5 O3-C (Interfaces §A): the services bus, how the library (the spine and the checkouts) registers its commands,
  // installs its intercepts, emits its events and taps them, bound here to the router and `emit`, so every tap main's
  // own code holds (the menu's, the stand-in's) still hears the library's events. O3-D's mawsd binds its services front.
  // P5 O3-D M1: the spine's commands are `machine`-owned, so a `machine` name goes to the router's embedded machine
  // binding (its output checked as a host runtime checks it) and a `main` one to its main handlers (P5 O3-E: the
  // checkouts' are `machine`-owned too, composed by the spine's root).
  const bus: ServicesBus = {
    register: (name, handler) => (REGISTRY.commands[name].owner === 'machine' ? registerMachineHandler(name, handler) : registerMainHandler(name, handler)),
    intercept: interceptCommand,
    emit,
    onEmitted,
    // P5 O3-D M2 (Interfaces §H): the router's local route, which answers a `machine` name through the embedded binding;
    // P5 O3-E M2 (Interfaces §D): main's own route past the main-only refusal (`machine.op`'s claimed acts are graded
    // acts, never main-only), which on the daemon shape forwards to mawsd
    invoke: (name, input, context) => invokeOwn(name, input, { ...context, target: local }) as never,
  };
  remoteLink = (ref) => machines.remote(ref);
  // E11: every will-quit step below joins one ordered list behind one listener (tracker row E10 "14 will-quit listeners");
  // a step's promise (the hosts' draining close of a kept supervisor's socket) holds the exit, bounded by the port's grace;
  // P4 W2-B: the hosts' stop is a drain, run before the rest, which stop once it has settled
  const shutdown = shutdownSteps(app, CLOSE_GRACE_MS);
  shutdown.add('remote lane A', () => remoteLaneA.stop()); // P5 O9 M9: its subscriptions closed before the links
  // C3 start: the engine host's userData travels in the environment it is forked with (the host protocol's hello carries
  // no fields).
  process.env.MAWS_USER_DATA = app.getPath('userData');
  // C3 end
  // E2's frame policies on the window's session and the capture partition, before any window loads (P3-L M6b: the
  // artifact scheme's, `installStorePolicies`; the deliverable store's reader, scheme and IPC are gone)
  installStorePolicies(process.env, appUrl);

  // P5 O8 M2: the roster of other machines (declared above), for the org rows composed over the spine's view below
  machines.onRemote((refs) => {
    roster = refs;
    for (const listener of [...rosterListeners]) listener();
  });
  // The engine's environment (the login-shell capture): the spine's launches and transcripts, the checkouts' scm, and
  // Send to's gws (P5 O4: the spine's delivery) read it.
  const home = app.getPath('home');
  const engineEnv = captureShellEnvironment();
  // P5 O3-C (docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §D): the spine, composed by its root
  // from what main binds (O3-D's mawsd calls the same root): the index with its session source, replay and the read
  // model, attention's core, the owner channel, the session service and its siblings, the configure and defaults relays
  // and the library's derived index. From here main holds of it only its view, the one way the code that stays in the
  // app reads the spine (the notifier, the quit guard, the chat panels, the interest report, the browser, until O4 the connectors,
  // the export authors, the org rows, Settings' reveal, and until O3-E the checkouts), and its stop. Its reverse reads
  // are ports: the sweep keeps this app's interest set (bound below, once the layout and the view exist; D11), and a
  // launch is told the browser's cua socket (E13; the browser starts below, and a launch asked before it carries none).
  let boundInterest: ReturnType<typeof appInterest> | null = null;
  let cuaSockets: Browser['cua'] | null = null;
  const spine = data === null
    ? // P5 O3-D M5b: the daemon shape's, mawsd's spine through main's mirror and the client port's answers
      startDaemonSpine({ hosts, daemon: daemon!, port: clientPort, browserSocket: () => (cuaSockets ? join(profile, ...CUA_SOCKET_DIR) : null), emit: (name, payload) => void emit(name, payload), budgetsMs: COMMAND_BUDGETS_MS })
    : startSpine({
        profile: app.getPath('userData'),
        machine: local,
        data,
        hosts,
        bus,
        clientPort,
        interest: () => {
          if (boundInterest === null) throw new Error('the interest set was read before main bound it');
          return boundInterest.set();
        },
        browserSocket: (appSessionId) => cuaSockets?.socketPathFor(appSessionId) ?? null,
        trash: (path) => shell.trashItem(path),
        engineEnv,
        env: process.env,
        packaged: app.isPackaged,
        appPath: app.getAppPath(), // the replay fixtures' checkout
        devRoot: process.cwd(), // a relative scenario path is the repository's: `pnpm dev`, `pnpm dev:stub` and the smoke's launch alike
        home,
      });
  shutdown.add('spine', spine.stop);
  if ('forwarded' in spine) {
    forwardedToMachine = spine.forwarded; // the daemon shape's mirror and watch replay (the router's forwards above)
    watchReplay = spine.watches;
  }
  const view = spine.view;

  // ---- C5: layout store ----
  const layout = new LayoutFileStore(join(app.getPath('userData'), 'layout.json'));
  registerOpenExternal();
  // P5 O8 M2: other machines' sessions, from their signed listings through the feed, verified against the held org state,
  // for the machines of O7's RL2 roster (src/main/org/rows.ts); org.rows and org.rows.changed carry them to the sidebar.
  // P5 O3-C (reader R10): this machine's projects, as session.projects.list answers them, through the spine's view.
  const remoteRows = createRemoteRows({
    session,
    feed: orgFeed,
    roster: () => roster,
    onRoster,
    localProjects: async () => view.projects(),
    onLocalProjects: (listener) => view.on('projects', () => listener()),
    files: orgDir,
    emit: (rows) => void emit('org.rows.changed', rows),
    log: (line) => console.log(`[org-rows] ${line}`),
  });
  registerRowsHandler({ register: registerMainHandler, rows: remoteRows });
  const stopChatPanels = registerChatPanels(layout, view, local); // P5 O6 M2: local; P5 O3-C (reader R4): the view
  shutdown.add('chat panels', stopChatPanels);
  shutdown.add('layout', () => layout.flush());
  // P5 O2 M2; P5 O3-C (D11): the sessions this app holds open (its tabs and the sessions on screen), one memoized set the
  // interest report sends and the inactive sweep keeps
  const interest = appInterest(layout, view, local); // P5 O6: the local machine's
  boundInterest = interest;

  // The application menu from the action table, rebuilt on settings and on the page's registered handlers.
  registerMenuHandlers(startMenu({ settings: () => settings.state().settings, emit }));
  // Window bounds persist under `window.main`; a window opens where the last one was left, if that is still on screen.
  const placement = () =>
    restoreWindowState(layout.get('window.main'), screen.getAllDisplays().map((d) => d.workArea), screen.getPrimaryDisplay().workArea);
  const tracked = (win: BrowserWindow) => trackWindowState(win, (state) => layout.set('window.main', state));
  // ---- end C5 ----

  // C7 start: the composer's main services (C7 execution document, M1): ClaudeUsage's files for the status line (read
  // only) and the picker. (P5 O3-C: the prompt history, the resume chooser's preview and the `@` menu's listing are the
  // spine's and the checkouts', composed by their roots above.)
  const usage = new ClaudeUsageReader({ dir: claudeUsageDir(process.env, home), emit: (snapshot) => void emit('settings.usageChanged', snapshot) });
  usage.start();
  registerMainHandler('settings.usage', ({ engineSessionIds }) => usage.snapshot(engineSessionIds));
  // C10: the port's pick answers through the e2e seam under MAWS_E2E=1 (MAWS_E2E_PICK_PATHS or cancelled), else the panel
  registerMainHandler('layout.pickFiles', (input, { client }) => pickFiles(input, client, { port: clientPort }));
  shutdown.add('usage', () => usage.stop());
  // C7 end
  // C11 start: the plumbing of settings v3 (C11 execution document, M1): ClaudeUsage's hand-off and status; the reveal
  // guard; the export's Save as…. (P5 O3-C: the engine host's configure relays, which follow the machine half, are the
  // spine's.)
  // P5 O2 M2: the sessions this app holds open, which the engine host's idle release never stops
  const stopInterest = startInterest({
    sessions: () => interest.set(),
    onChange: (listener) => interest.onChange(listener),
    streaming: () => hosts.streaming('engine-host'),
    onStreaming: (listener) => hosts.onStreaming('engine-host', listener),
    dispatch: (input) => hosts.dispatch('engine-host', 'host.interest', input) as Promise<CommandResult<'host.interest'>>,
  });
  shutdown.add('interest', () => {
    stopInterest();
    interest.stop();
  });
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
  const sessionDirectories = () => knownSessionDirectories(view); // P5 O3-C (reader R11)
  registerMainHandler('settings.reveal', ({ path }, { client }) =>
    revealPath(path, client, { configHome: () => claudeConfigDir(process.env, home), sessionDirectories, port: clientPort }),
  );
  registerMainHandler('layout.captureChords', captureChords); // the Settings tab's chord capture sets the menu aside (M5 fix wave)
  // P3-G (§D4.1): Mark-up's still of a region the sender's window draws
  registerMainHandler('layout.captureRegion', async (input, { client }) => {
    const page = pageOf(client);
    return page ? captureRegion(input, page, BrowserWindow.fromWebContents(page)) : { image: null }; // a page gone is a window closed meanwhile
  });
  registerMainHandler('layout.saveTextFile', (input, { client }) => saveTextFile(input, client, { downloads: app.getPath('downloads'), port: clientPort }));
  // The widget e2e's engine stand-in: under MAWS_WIDGET_BACKEND=fixtures in launch mode scenario only (M2).
  const stopWidgetBackend = installWidgetBackend({ env: process.env, packaged: app.isPackaged, appRoot: process.cwd(), intercept: interceptCommand, emit, fail: (error) => new CommandFailure(error) });
  if (stopWidgetBackend) shutdown.add('widget backend', stopWidgetBackend);
  // C11 end

  // P5 O3-A start (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §4): the browser's history, bookmarks and agent
  // activity, in its own database since they left the index at migration 14; opened after the index, so it reads the
  // index at 14 and promotes what migration 14 staged, and before the sweep, which removes rows from it
  const browserData = new BrowserData({ file: join(app.getPath('userData'), ...BROWSER_DATA_PATH), index: join(app.getPath('userData'), 'index.sqlite') });
  // P5 O3-A end
  // E4b start: the Chrome import's records and its boot sweep, before E4a's browser opens any partition (E4b execution
  // document, Decision Log 24, 27, 34): profiles.json's one owner in memory, which E4a reads through `profiles` below, and
  // the sweep of what a crash, a quit mid-import or a removal left (staging, unlisted partition folders, storage
  // directories and history rows).
  const browserProfiles = ImportedProfiles.open(app.getPath('userData'));
  sweepBrowserImports({ userData: app.getPath('userData'), profiles: browserProfiles, history: browserData.history, bookmarks: browserData.bookmarks /* cua #90 */ });
  // E4b end

  // E4a start: the in-app browser's main side (E4a execution document, Design §1 to §3, §9): the tab store over
  // <userData>/browser/tabs.json, the partitions, the views and browser.*, after the index (a deleted session closes its
  // tabs) and before any window, so the first page finds its handlers. Its will-quit write runs once the hosts' drain has
  // settled (P4 W2-B).
  // Settings 11's browser section is read from the service at each use: the profile when a tab opens, the link target
  // when a page opens a window.
  const browser = startBrowser({
    userData: app.getPath('userData'),
    settings: () => settings.state().settings.browser,
    view, // P5 O3-C (readers R6, R7)
    data: browserData, // P5 O3-A
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
    data: browserData, // P5 O3-A
    register: registerMainHandler,
    emit,
    env: process.env,
    browser,
    profiles: browserProfiles,
  });
  shutdown.add('browser import', browserImport.stop);
  // E4b end
  // P5 O3-A: once the browser and its import have stopped; the agent activity's last flush runs as it closes
  shutdown.add('browser data', () => browserData.close());

  // The hosts belong to the app, not to a window or a page (§4.1): they start here, before any window exists, and
  // `start()` is idempotent, so opening a window again forks nothing and a reload never reaches them.
  const openWindow = () => {
    void hosts.start();
    const win = createWindow(settings.state().resolvedTheme, placement()); // C5: restored placement
    tracked(win); // C5: tracked placement
    return win; // C5: the notifier re-creates the window through here
  };
  // P3-A M4: `artifacts.open` (a document's port to the asking window), before the first window loads (P5 O3-C, D23: the
  // design-system defaults' relay is the spine's)
  const artifacts = startArtifacts({
    hosts,
    register: registerMainHandler,
    emit, // P3-A M5: artifacts.resync
    env: process.env,
    openWindow,
    root: join(app.getPath('userData'), 'artifacts'), // P3-A M7: the store's directory (the host's own rule)
  });
  shutdown.add('artifacts', artifacts.stop);
  // P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D7): an artifact page's connectors, the owner's
  // grants, rows and sign-ins, the engine's MCP sign-in and the owner's Send to are the machine's, composed with the spine
  // (mawsd's on the daemon shape, startSpine's above on the embedded one). Main keeps the export step of Send to.
  // P4-AGG M2: Discover's catalog (the person's, never an agent's): the seed marketplaces, Anthropic's directory and the
  // official install counts through the `catalog` egress rule, cached under userData, joined with the engine's reads per
  // cwd through the host, re-read on its `plugins.changed`
  const catalog = startCatalog({
    register: registerMainHandler,
    emit: (name, payload) => emit(name, payload),
    call: (name, input) => hosts.dispatch('engine-host', name, input) as never,
    onPluginsChanged: (listener) => hosts.onEvent('plugins.changed', () => listener()),
    userData: app.getPath('userData'),
    env: process.env,
    userAgent: `MAWS/${app.getVersion()}`,
  });
  shutdown.add('catalog', catalog.stop);
  // P3-B: document × md, html, docx, pdf. P3-D (the P3 spec's Decision Log 61): each run handed its governing design system
  const exportAuthors = {
    sessionTitle: (appSessionId: string) => view.record(appSessionId as AppSessionId)?.title.text, // P5 O3-C (reader R9)
    humanAuthorName: async () => {
      const saved = settings.state().settings.artifacts.exportAuthorName;
      return resolveExportHumanName(saved, saved ? null : await usage.routedAccountName());
    },
  };
  shutdown.add('document-exporters', registerDocumentExporters((exporter) => artifacts.exporters.register(governDocumentExporter(exporter, engineHostCall(hosts.dispatch))), exportAuthors)); // P3-B, P3-D; WR 73
  registerDesignSystemExporters(artifacts.exporters); // P3-D M7: `design_system` as `claude` (Claude's files, zipped)
  registerPresentationExporters(artifacts.exporters, { call: engineHostCall(hosts.dispatch), env: process.env }); // P3-C M9: `presentation` as html, pdf, png, pptx, claude; the governing system from D's `designSystems.governing` (Decision Log 27 (2))
  shutdown.add('inspection-exporters', registerInspectionExporters(artifacts.exporters, { call: engineHostCall(hosts.dispatch), env: process.env }));
  // P3-E (E2 M5; E's Decision Log 32): `dashboard` as md, html, docx, pdf: B's four, governed by D, over the captured views
  shutdown.add('dashboard-exporters', registerDashboardExporters((exporter) => artifacts.exporters.register(exporter), { call: engineHostCall(hosts.dispatch), env: process.env, ...exportAuthors })); // WR 73: the same resolved identity for every document/dashboard export entry point
  registerDesignExporters(artifacts.exporters, { call: engineHostCall(hosts.dispatch), env: process.env }); // P3-E (E1's M5): `design` as png and pdf over C's capture window, never cropped (XE9)
  shutdown.add('presenter', registerPresenter({ register: registerMainHandler, appUrl, env: process.env }).end); // P3-C M6: `presentations.present`, the show's windows
  // P3-L M5b: the viewers' and the library's reach to a byte kind's stored file and its exports, whatever the index's
  // state. P5 O3-C (D22): the client's; the library's derived index is the spine's, and `library.read` reaches the
  // checkouts' files service.
  registerLibraryFiles(registerMainHandler, {
    call: (name, input) => hosts.dispatch('engine-host', name, input) as never,
    exporters: artifacts.exporters,
    root: join(app.getPath('userData'), 'artifacts'),
    downloads: () => app.getPath('downloads'),
    port: clientPort, // Save as…, the Replace question, Open externally, Reveal
    // M6b fix wave 2: `library.read`; P5 O3-E (Interfaces §D): the files service's files.readResolved over main's own route
    readFile: readResolvedThrough((name, input) => bus.invoke(name, input, { client: mainClient })),
    env: process.env,
  });
  // P3-E start (E2 M3; E's Decision Log 18): a dashboard source sheet's Download, the artifact's own asset saved through
  // main's dialog under Downloads
  registerAssetDownload(registerMainHandler, {
    call: (name, input) => hosts.dispatch('engine-host', name, input) as never,
    hold: (artifactId, ref) => holdAsset((name, input) => hosts.dispatch('engine-host', name, input) as never, artifactId, ref), // E3: its own hold through the dialog and the copy
    downloads: () => app.getPath('downloads'),
    port: clientPort,
    env: process.env,
  });
  // P3-E end
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): a window's holds over a dashboard's snapshots, each
  // released by its window alone or with it; the host's going takes the host's holds with it
  shutdown.add(
    'dataset-holds',
    registerDatasetHolds(registerMainHandler, {
      call: (name, input) => hosts.dispatch('engine-host', name, input) as never,
      onHostLost: (listener) => hosts.onState('engine-host', (state) => (state.state === 'ready' ? undefined : listener())),
    }),
  );
  openWindow();

  // E5 start: each window's unsaved editor files for the quit guard (E5 execution document, M5): the page pushes its
  // whole dirty set, forgotten when the window navigates or closes; the question's Save all asks every window to save
  // and waits for the answers of the windows that hold files.
  const unsavedFiles = trackUnsavedFiles();
  registerMainHandler('layout.unsavedFiles', ({ paths }, { client }) => unsavedFiles.update(client, paths));
  registerMainHandler('layout.saveAllDone', ({ requestId, failed }, { client }) => unsavedFiles.done(client, requestId, failed));
  // E5 end

  // ---- C5: notifications, dock badge and the quit guard ----
  startAttention(view, { actions: notificationActions({ dispatch: hosts.dispatch, view }), settings: () => settings.state().settings, port: clientPort }); // P5 O3-C (readers R1, R2)
  // C12: the busy report asks C9's pty host (read only: pty.list and pty.foreground) and publishes Quit when idle's wait
  const quitGuard = installQuitGuard(view, { // P5 O3-C (reader R3)
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
    ...engineQuitDeps(hosts, () => settings.state().settings, () => launch.mode === 'daemon'), // P5 O2 M7, P5 O3-D (Q1): terminals and sessions outlive the app on the daemon shape
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
  // that close drains what the supervisor wrote before it saw the end, and the quit waits for it (the shutdown's bound).
  // P4 W2-B (tracker 2026-10-07 "The keep-quit drain…"): a drain, so it runs before every other step and those stop only
  // once it has settled or the bound passed; the lines it reads are folded by services still running (the index, side
  // threads, attention, the read model), where they once reached services already stopped
  shutdown.drain('hosts', () => hosts.stop());
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
  // P5 O6 M3: the links stop at quit; no far side is ever stopped. P5 O3-D M6: this profile's machine services reach
  // another profile's app from this profile's mawsd, so main serves nothing here (O6's stand-in is gone)
  shutdown.add('machines', () => machines.stop());
  // P5 O8 M1: the feed and the session stop (every org file is written whole and renamed); M2: the rows' last change is
  // written to their cache first, so a relaunch keeps every mark; M4a: the exit waits for the session's close, which
  // resolves once nothing more is written under org/ (bounded by the steps' grace)
  shutdown.add('org', () => {
    orgFeed.close();
    return Promise.all([orgSession?.close(), remoteRows.close()]).then(() => undefined);
  });
  // P5 O3-A: spine.lock is released at the process's exit alone (openSpineData), never at a will-quit step: the steps'
  // promises settle after the last step is called, and a writer still finishing (an intent's rename) must not run
  // beside a candidate that took the lock meanwhile.
}
