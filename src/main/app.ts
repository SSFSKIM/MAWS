// P5 O5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §E): the app's composition root, moved verbatim
// from src/main/index.ts, which is now the entry: it runs the bootstrap every mode shares (the stdio guard, the SIGUSR1
// refusal, MAWS_USER_DATA, Chromium's switches, the store's scheme) and then loads this module. Everything below the
// imports is today's index.ts below that bootstrap, unchanged in behaviour.
// P5 O15 M2 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): the app composes none of the machine's services,
// which run in `mawsd` alone; of the library it takes only the command budgets its `machine` host applies (lint rule B)
import { COMMAND_BUDGETS_MS } from '../services/command-budgets';
import type { AppSessionId } from '@shared/graph/ids';
import { workingFolder } from '@shared/sessions/working-folder'; // UX wave U5: an export's fallback folder
import type { CommandInput, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { REGISTRY } from '@shared/ipc/registry'; // P5 O3-D M1: the bus's register reads each name's owner
import { statSync } from 'node:fs'; // E11 F2b: the bundle on disk
import { join } from 'node:path';
import { hostname } from 'node:os'; // P5 O6 M1: the machine's name
import { app, BrowserWindow, dialog, MessageChannelMain, screen, systemPreferences } from 'electron';
import type { ClientRef } from '@shared/ipc/client';
import { mainClient, pageOf } from './ipc/clients'; // P5 O3-E: mainClient, main's own asker
import { createHosts, prepareLaunch, refuseTestLaunchOnDefaultProfile, type LaunchOutcome, type LaunchShape } from './hosts'; // P5 O2 M7: prepareLaunch; the landing: the refusal
import { repairLaunch } from './repair'; // P5 O15 M2: the launch `mawsd` cannot start
import { readMachineIdentity } from './machine/identity'; // P5 O15 M2: the profile's MachineRef, with no services' module
import { beforeCommand, dispatchLocal, installRouter, invokeOwn } from './ipc/router'; // P5 O6 M3: dispatchLocal, the local link's and the stand-in's; P5 O3-E: invokeOwn, main's own calls; P5 O4: beforeCommand
import { startSettings, type SettingsService } from './client/settings'; // P5 O3-A: the client half, composed with the machine's
import { createMachineSettingsMirror } from './client/machine-settings-mirror'; // P5 O3-D M5b: mawsd's machine half
import { startDaemonSpine, type DaemonSpine } from './sessions/daemon-spine'; // P5 O3-D M5b: mawsd's spine, through main's mirror
import { CUA_SOCKET_DIR } from '@shared/browser/cua-socket'; // P5 O3-D M5b
import { daemonPaths } from '@shared/daemon/files'; // P5 O5 M2: artifacts.sock
import { launchMode, scenarioPath } from '@shared/sessions/select-source'; // P5 O3-D M5b (D11)
import { settingsPaths } from '@shared/settings/paths';
import { startWithProfileLock } from './files/profile-lock';
import { captureMainLog } from './log-file'; // P5 O15 M2b §H: main's log file
import { describeMainBuild, loadedBundlePath, olderInstanceNotice, staleBuildCheck, type MainBuild } from './build-identity'; // E11 §2.7; F2b 2.7b
import { builtAtLabel } from '@shared/app/build-time'; // E11 §2.7
import { registerPtyOpenLink } from './pty-links'; // C9
import { appUrl, createWindow, installContentSecurityPolicy, prepareHarness } from './window'; // C9: prepareHarness
// C3 start (the attention service is the spine's: src/services/spine-root.ts)
import { emit, emitFrom, emitTo } from './ipc/events'; // P5 O9 M9: emitFrom, remote lane A's events; P5 O17 M9b: emitTo, the remote view's
import { registerMachineHandler, registerMainHandler } from './ipc/router'; // P5 O6 M1: registerMachineHandler
import { bindLocalMachine } from './machine/local'; // P5 O6 M2
import { startMachines } from './machines'; // P5 O6 M3: the connection manager (P5 O3-D M6: the stand-in gone)
import { localProjectActsSource, PROJECT_ACT_COMMANDS, refuseUnservedProjectActs } from './machines/project-acts-peer'; // panel scalpel-3#2
import { refuseUnservedSideThreads, SIDE_THREAD_COMMANDS } from './machines/side-thread-peer'; // UX wave U5a, Decision Log 52
import { createRecordSigner, createStateSigner, createStepUp, promptTouchIDConfirmation } from './device/step-up'; // P5 O7 M1: the development org session's signer; P5 O8 M1: the production session's; M3: its state signer; M4b: its record signer
import { harnessConfirmation, sheetConfirmation } from './device/step-up-sheet'; // P5 O7 M2: the step-up sheet before Touch ID
import { createDevOrgSession } from './org/dev-session'; // P5 O7 M1
import type { MachineRef } from '@shared/machine/ref'; // P5 O6 M2
import type { RemoteLink } from './machines/remote/link'; // P5 O8 M3: the deliveries' links
import type { LocalAnswer } from './org/channel/machines'; // P5 O8 M7b
import type { HostEntry } from '@shared/ipc/schema/channel'; // P5 O8 M7b
import { powerMonitor } from 'electron'; // P5 O15 M2b: the wake source's one listener to suspend, resume and unlock
import { openExternalUrl } from './open-external'; // P5 O8 M1: the Access login's browser trip
import { createOrgSession } from './org/org-session'; // P5 O8 M1
import { openProvisioningSecret, PROVISIONING_SECRET_FILE } from './org/provisioning-secret-store'; // P5 O8 M4c
import { resolveGcloud, secretStore } from './org/secret-store'; // P5 O8 M4c
import { excludeFromBackup } from '@shared/fs/backup-exclusion';
import { createRegistryFeed } from './org/registry-feed'; // P5 O8 M1
import { registerOrgHandlers, registerPolicyHandlers, registerProjectsHandlers, registerRowsHandler } from './org/register'; // P5 O8 M1; M2: org.rows; M6b: org.policy.*; the project registry: org.projects, org.removals.*
import { createProjectRegistry } from './org/project-registry'; // the project registry (M10)
import { startProjectActs } from './org/project-acts'; // the project registry's M12: maws aimed at another machine
import { orgFiles } from './org/files'; // P5 O8 M1
import { createRemoteRows } from './org/rows'; // P5 O8 M2
import { createOrgPolicies } from './org/policy'; // P5 O8 M6b
import type { GrantDoor } from './org/grants'; // P5 O8 M4b
import { installOrgPageFixture } from './org/page-fixture'; // P5 O8 M4a Task 8: a harness build's only
import { installChannelFixture } from './org/channel-fixture'; // P5 O8 M7a Task 3: a harness build's only
import { installShareFixture } from './org/share-fixture'; // P5 O8 M6b Task 3: a harness build's only
import { installRegistryFixture } from './org/registry-fixture'; // the project registry's M11: a harness build's only
import { createRemoteLaneA, routeLaneA } from './lane-a/remote'; // P5 O9 M9
import { createRemoteLaneB, routeLaneB, standInForMachines } from './lane-b/remote'; // P5 O7 M2; the project registry's M11: standInForMachines, its e2e fixture's
import { ArtifactMachines } from './artifacts/machines'; // P5 O7 M5a
import { dialDirect } from './machines/remote/carriers'; // P5 O7 M2: the dev session's directMap in front of it
import { relayOnlyDial } from './machines/remote/bench-seam'; // P5 O7 M7: the live bench's relay case
import { createWakeSource, installWakeSeam } from './net/wake'; // P5 O15 M2b: main's one listener to suspend, resume and unlock
import { createReach } from './net/reach'; // P5 O15 M2b: the window after a wake or an address change, and its probes
// C3 end
// C5 start (emit comes with C3's imports)
import { notificationActions } from './attention/actions';
import { startAttention } from './attention';
import { LayoutFileStore } from './layout/store';
import { registerChatPanels } from './sessions/panel-lifetime';
import { askToQuit, installQuitGuard, type BusyReport } from './lifecycle/quit-guard';
import { registerMenuHandlers, startMenu } from './menu';
import { openForMachine, registerOpenExternal } from './open-external'; // P5 O7 M5c: openForMachine
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
import { ipcError } from '@shared/ipc/errors'; // P5 O7 M5a: remote.openCopy's refusal
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
// E11 start
import { shutdownSteps } from './lifecycle/shutdown';
import { startReaper } from './lifecycle/reaper'; // the quit reaper
import { flushSessions } from './lifecycle/flush-sessions'; // the quit reaper's flush
import { session as electronSession } from 'electron'; // the quit reaper's flush: `session` below is the org's
import { CLOSE_GRACE_MS } from '@shared/host/socket-port';
import { MACHINE_DELIVERY_CAPABILITY, MACHINE_RENDER_CAPABILITY } from '@shared/host/socket-protocol'; // P5 O5 M4; P5 O7 M5c: delivery
// E11 end
// E4a start
import { startBrowser, type Browser } from './browser';
import { createRemoteViews } from './browser/remote-view'; // P5 O17 M9b
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
import { registerLibraryFiles } from './library/files'; // P5 O3-C (D22): the client's, beside the spine's derived index; P5 O4 M3: the export formats and Save as alone
import type { ServicesBus } from '@shared/spine/bus'; // P5 O3-C
// P3-L end
// P3-B start
import { resolveExportHumanName } from '@shared/artifacts/export-author'; // P5 O5 M3: every kind's exporters are the render library's, composed by startArtifacts
// P3-B end
// P3-D start
import { registerPresenter } from './presentations/present'; // P3-C M6
// P3-D end
// P3-E start
import { registerAssetDownload } from './dashboard/download';
import { holdAsset, registerDatasetHolds } from './dashboard/holds'; // E3
// P3-E end
import { startCatalog } from './catalog'; // P4-AGG M2: Discover's catalog
// P5 O4 M2 start: what stays in the app of the connectors and delivery
import { startAppConnectors } from './connectors';
import { adoptLegacyGrants } from './connectors/adoption';
import { legacySealer } from './connectors/legacy-custody';
import { electronWindowShown } from './client/window-shown';
import { registerDeliverySend } from './delivery/send';
import { exportHeldFor } from './delivery/e2e-hold';
import { registerCommentContent } from './side/comment-content'; // UX wave U5a
// P5 O4 M2 end

// P5 O2 landing: a test or harness launch never runs on the default profile, whose daemon and LaunchAgent are the
// owner's; it exits here, before the profile lock, the machine identity, the settings or a host (hosts/mode.ts).
refuseTestLaunchOnDefaultProfile();
// P5 O15 M2b §H: from here each console line is also held, with the time it was said, until this instance holds the
// profile lock and installs the file (the start below); a second launch never does, and writes only its own streams.
const mainLog = captureMainLog(console);

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
// P5 O15 M2: while the repair window is up, a second launch brings it forward and tries the launch once more
let repairSecondLaunch: (() => void) | null = null;
function answerSecondLaunch(launched: MainBuild | null): void {
  console.log(`[main] a second launch (${launched === null ? 'an unknown build' : describeMainBuild(launched)}) was handed to this instance`); // P5 O15 M2b §H
  if (repairSecondLaunch !== null) return repairSecondLaunch();
  const win = bringForward();
  if (win === null) return; // quitting (or not yet started): nothing to bring forward or offer
  const onDisk = diskBuildIsNewer(); // asked either way, so the build on disk this answer covers is not said again
  const notice = olderInstanceNotice(MAIN_BUILD, launched, builtAtLabel) ?? onDisk;
  if (notice !== null) offerQuit(win, notice);
}

void startWithProfileLock(app, () => {
  mainLog.install(join(app.getPath('userData'), 'logs')); // P5 O15 M2b §H: the profile lock's holder alone writes main.log
  // P5 O6 M1 (OX2): the profile's MachineRef, minted at its first start into <userData>/machine.json and read ever after,
  // before anything starts or any window opens. A malformed file stops startup, naming its path: a fresh ref would
  // re-address everything kept under the old one.
  let local: MachineRef;
  let localName: string; // P5 O6 M3: a display attribute, for machines.list
  try {
    ({ ref: local, name: localName } = readMachineIdentity({ userData: app.getPath('userData'), env: process.env, hostname: hostname() }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[machine] ${message}`);
    dialog.showErrorBox('MAWS cannot start', message);
    app.exit(1);
    return;
  }
  bindLocalMachine(local); // P5 O6 M2: the router's, `emit`'s and every app window's local machine
  // P5 O15 M2 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Interfaces §A, §B): the launch's one outcome,
  // settled before the hosts are created: `mawsd` (the main profile's LaunchAgent installed or repaired and started, or a
  // private daemon), or the repair window, which says why and resolves once an attempt succeeds; the same process then
  // goes on into the app. Main opens none of the machine's files and takes no spine.lock: `mawsd` does.
  const machine = { local, localName };
  // fix wave 1: a throw from the outcome's synchronous part is a rejection the chain handles (prepareLaunch throws none)
  return new Promise<LaunchOutcome>((resolve) => resolve(prepareLaunch()))
    .then((outcome) => (outcome.ok ? outcome.launch : repairLaunch(outcome.unavailable, prepareLaunch, { packaged: app.isPackaged, profileDir: app.getPath('userData'), env: process.env, onSecondLaunch: (listener) => (repairSecondLaunch = listener) })))
    .then((launch) => {
      repairSecondLaunch = null;
      startMain(launch, machine);
    })
    .catch((error: unknown) => {
      console.error('[main] MAWS could not start; quitting', error);
      app.exit(1);
    });
}, { build: MAIN_BUILD, onSecondInstance: answerSecondLaunch }); // E11 §2.7

// P5 O3-D M5b (D11): a scenario launch plays its scenario in mawsd, which inherits this environment; the scenario's path
// is resolved here, against main's root, before mawsd is started with it.
function absoluteScenarioPath(): void {
  if (launchMode(process.env, app.isPackaged) !== 'scenario') return;
  try {
    process.env.MAWS_SESSION_SOURCE = `stub:${scenarioPath(process.env, { packaged: app.isPackaged, appRoot: process.cwd() })}`;
  } catch (error) {
    console.error('[sessions] the scenario path could not be resolved; mawsd reads it as given', error);
  }
}

// P5 O3-D M5b (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §F, §G, §E; D11, D19, D20, D25); P5 O15
// M2: the spine runs in `mawsd`: main binds `machine` as `host`, reads the spine through its mirror
// (src/main/sessions/spine-mirror.ts), the machine half through its settings mirror, answers the client port's requests
// and holds neither spine.lock nor any of the machine's files.
function startMain(launch: LaunchShape, { local, localName }: { local: MachineRef; localName: string }): void {
  const profile = app.getPath('userData');
  // D11: a scenario's path made absolute before mawsd is started with this environment, so its own root is never consulted
  absoluteScenarioPath();
  const { hosts, daemon } = createHosts(MAIN_BUILD, launch, { machineBudgetsMs: COMMAND_BUDGETS_MS }); // E11 §2.7: main's build for host.status; P5 O2 M7: the launch's daemon
  // P5 O3-D M5b (§G, D20): the machine half mirrors mawsd's, from machine-settings.json read and never written; a client
  // change waits for mawsd's settings split at the first launch on a profile before it (composeSettings)
  const mirror = createMachineSettingsMirror({ file: settingsPaths(profile).machine, hosts, log: (line) => console.log(line) });
  const settings: SettingsService = startSettings({ clientFile: settingsPaths(profile).client, machine: mirror, split: mirror.answered });
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
  // P5 O8 M4b: this Mac's own endpoint's local door for the grants (mawsd's main-only endpoint.local.act and
  // endpoint.local.grants, through main's own route), bound once the services bus exists below; unavailable until then
  let grantsDoor: GrantDoor = { act: async () => ({ state: 'refused', reason: 'unavailable' }), grants: async () => ({ ok: false, code: 'unavailable' }) };
  // P5 O8 M7b: this Mac's spine for the project channels' to-human entries: `channel.history` through main's own route and
  // `channel.changed` from the bus's tap, both bound once the services bus exists below (a read before answers
  // `unavailable`, and is read again)
  let localChannelHistory: ((input: { project: string; before?: string; limit: number }) => Promise<LocalAnswer>) | null = null;
  const localChannelListeners = new Set<(payload: { project: string; entry: HostEntry }) => void>();
  // P5 O8 M1: this profile's org session (src/main/org/org-session.ts): the sign-in from a pairing code, the held org
  // state and the hub's credential, read from <userData>/org/ in the background; a profile that never signs in makes no
  // keys, files or requests. A development build started with MAWS_DEV_ORG=<dir> runs O7's development session instead
  // (dev-session.ts), and org.status says so. One Registry feed (?app=1) follows the hub for whichever session runs, and
  // hands the production session its notices; org.* answers the Org section.
  // P5 O7 M2: every step-up signature (the org sessions' acts and M3's state signer) is confirmed on the step-up sheet,
  // the action's summary and fields on the window, then Touch ID; an e2e harness build injects its own answer instead.
  // P5 O7 M10 B: but a spawn on a machine the member owns, which step-up.ts signs unasked on the session's held head.
  const confirm =
    harnessConfirmation(process.env, app.isPackaged) ??
    sheetConfirmation({ window: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null, dialog, prompt: promptTouchIDConfirmation(systemPreferences) });
  const devOrg =
    process.env.MAWS_DEV_ORG && !app.isPackaged
      ? createDevOrgSession({
          dir: process.env.MAWS_DEV_ORG,
          userData: app.getPath('userData'),
          packaged: app.isPackaged,
          build: `${MAIN_BUILD.version}+${MAIN_BUILD.commit}`,
          stepUp: (keys, device, org) => createStepUp({ device, key: keys.stepUp, confirm, org }),
          log: (line) => console.log(line),
        })
      : null;
  // P5 O8 M4c: where a new delegation's provisioning code goes (main's own <profile>/provisioning-secret.json, never a
  // settings file: O7 M9), and its custody: gcloud, resolved at each step through the login shell's PATH (the engine's
  // captured environment, below, read when a create runs) and then Homebrew's two places and ~/google-cloud-sdk/bin
  const provisioningSecret = openProvisioningSecret(join(profile, PROVISIONING_SECRET_FILE));
  const provisioningCustody = secretStore({
    gcloud: () => resolveGcloud({ loginPath: async () => (await engineEnv).PATH ?? null, home: app.getPath('home') }),
    log: (line) => console.log(`[org] ${line}`),
  });
  // P5 O15 M2b (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md §D to §G): the wake source and the reach, made
  // once for the profile and handed to the org session's project channels, the Registry feed and the machines' links;
  // §I's seam tells a wake that did not happen, under MAWS_E2E=1 in a build that is not packaged
  const wake = createWakeSource({ power: powerMonitor, log: (line) => console.log(line) });
  const reach = createReach({ log: (line) => console.log(line) });
  const removeWakeSeam = installWakeSeam(process.env, app.isPackaged, wake);
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
          stepUp: (keys, device, org) => createStepUp({ device, key: keys.stepUp, confirm, org }),
          // `<userData>/org/` stays out of Time Machine, as the device keys do: a restored token or chain is no one's
          excludeFromBackup: (path) => excludeFromBackup(path),
          local, // M4b: this Mac's own machine, which a drop refuses
          wake, // P5 O15 M2b §G: each project channel's socket drops at a wake and waits on the hub's path in the window
          reach,
          delegations: { secrets: provisioningCustody, destination: provisioningSecret }, // M4c: the create transaction's custody
          // M3: the app as the org's signer. Org states are signed with the device's step-up key behind Touch ID (the
          // key stays in step-up.ts); the weekly successor asks at a window's focus, and notifies once a day while no
          // window is in front (a click brings the app forward, whose focus may then ask); revocations go to the RL2
          // roster's machines over their links.
          // M7b: every machine's to-human entries in the project channels: this Mac's spine and the RL2 roster's links
          channelMachines: {
            local,
            localName,
            history: (input) => localChannelHistory?.(input) ?? Promise.resolve({ ok: false, code: 'unavailable' }),
            onChanged: (listener) => {
              localChannelListeners.add(listener);
              return () => void localChannelListeners.delete(listener);
            },
            roster: () => roster,
            onRoster,
            link: (ref) => remoteLink(ref),
          },
          signing: {
            stateSigner: (keys) => createStateSigner({ key: keys.stepUp, confirm }),
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
          // M4b: grants on a machine, signed with the step-up key behind the same confirmation, through this Mac's local
          // door for its own machine and the RL2 links for the rest
          grants: {
            recordSigner: (keys) => createRecordSigner({ key: keys.stepUp, confirm }),
            door: { act: (action) => grantsDoor.act(action), grants: () => grantsDoor.grants() },
            roster: () => roster,
            onRoster,
            link: (ref) => remoteLink(ref),
          },
          log: (line) => console.log(line),
        })
      : null;
  const session = devOrg ?? orgSession!;
  const orgFeed = createRegistryFeed({ session, wake, reach, log: (line) => console.log(line) }); // P5 O15 M2b §G: its wake, unlock and window
  orgSession?.attach(orgFeed);
  // P5 O8 M7a: the project channels (org/channel/), composed in the production session; org.channel.changed forwarded
  // for the app's life
  let rowsHeld = false; // P5 O8 M6b Task 3: a harness build's Share fixture seeds the rows (org/share-fixture.ts)
  const unpublishOrgStatus = registerOrgHandlers({
    register: registerMainHandler,
    emit: (name, status) => void emit(name, status),
    emitChannel: (changed) => void emit('org.channel.changed', changed),
    emitGrants: (changed) => void emit('org.grants.changed', changed),
    service: orgSession,
    development: devOrg,
    destination: provisioningSecret, // M4c: org.provisioningSecret.*
  });
  // P5 O8 M4a Task 8: the Org page's e2e look seeds org.* from a fixture (org/page-fixture.ts), which also stops the
  // session's org.changed. The guard folds to false outside a harness build, which then carries none of it.
  if (typeof __MAWS_HARNESS_BUILD__ !== 'undefined' && __MAWS_HARNESS_BUILD__) {
    installOrgPageFixture({ env: process.env, packaged: app.isPackaged, intercept: interceptCommand, unpublish: unpublishOrgStatus });
    // P5 O8 M7a Task 3: the Channel tab's e2e look seeds org.status and a project's org.channel.open (org/channel-fixture.ts)
    installChannelFixture({ env: process.env, packaged: app.isPackaged, intercept: interceptCommand, unpublish: unpublishOrgStatus });
    // P5 O8 M6b Task 3: the Share sheet's and the reach marks' e2e look seeds org.*, org.rows and machines.list
    // (org/share-fixture.ts), holds the production rows' org.rows.changed, which signed out would clear the seed, and
    // follows each production machines.changed (this Mac alone) with the seeded machines
    installShareFixture({ env: process.env, packaged: app.isPackaged, intercept: interceptCommand, unpublish: unpublishOrgStatus, holdRows: () => void (rowsHeld = true), emit, onEmitted });
    installRegistryFixture({ env: process.env, packaged: app.isPackaged, intercept: interceptCommand, standIn: standInForMachines, emit, onEmitted, unpublish: unpublishOrgStatus, holdRows: () => void (rowsHeld = true) }); // the project registry's M11: org.* and org.projects seeded, the other machines' project acts stood in for (org/registry-fixture.ts)
  }
  // P5 O6 M3: every other machine through the connection manager (one link per machine; MAWS_LOCAL_MACHINES names another
  // profile's serve directory in a build that is not packaged), and machines.list and machines.changed
  const relayOnly = relayOnlyDial(process.env, app.isPackaged);
  const machines = startMachines({
    local,
    localName,
    userData: app.getPath('userData'),
    packaged: app.isPackaged,
    env: process.env,
    build: `${MAIN_BUILD.version}+${MAIN_BUILD.commit}`,
    register: registerMainHandler,
    dispatchLocal,
    budgets: COMMAND_BUDGETS_MS, // P5 O7 M5a: a cold machine's export is waited for its budget, not the link's 10 s
    // panel scalpel-3#2: whether this Mac's machine serves the project acts, as its daemon's welcome says
    localCapabilities: localProjectActsSource(hosts),
    // P5 O7 M1: the org session the RL2 links read; P5 O8 M1: production's sign-in, or O7's development session
    session,
    wake, // P5 O15 M2b: its wake notices reach every link, its unlocks probe them
    reach,
    // P5 O7 M2: the development session's directMap, read at each dial (it is set once the session signed in); P5 O7 M7:
    // the live bench's relay case before it (MAWS_E2E_REMOTE_CARRIER=relay, MAWS_E2E, unpackaged), every direct dial refused.
    // P5 O15 M2b §F: the window's probes go where the dials go (`directTarget`): through the directMap, and on the relay
    // case nowhere, so its direct lane has no target
    ...(relayOnly !== null
      ? { linkDeps: { dialDirect: relayOnly, directTarget: () => null } }
      : devOrg === null
        ? {}
        : { linkDeps: { dialDirect: (url: string, timeoutMs: number, signal?: AbortSignal) => dialDirect(devOrg.directMap()[url] ?? url, timeoutMs, signal), directTarget: (url: string) => devOrg.directMap()[url] ?? url } }),
  });
  // P5 O9 M9: `laneA.*` for a machine O7's link reaches is remote lane A's (src/main/lane-a/remote.ts), over that link;
  // every other command for another machine, and `laneA.*` for a socket-linked profile, goes to the manager. It writes
  // no file, so it runs in a run that doesn't hold spine.lock too.
  const remoteLaneA = createRemoteLaneA({ local, emit: (machine, name, payload) => void emitFrom(machine, name, payload), log: (line) => console.log(`[lane-a] ${line}`) });
  // C5's layout store, made here (its uses are below, under C5) since remote lane B reads `main.tabs` from it.
  const layout = new LayoutFileStore(join(app.getPath('userData'), 'layout.json'));
  // P5 O7 M2: lane B's acts, and the reads the pane makes that no offer row carries, for a machine O7's link reaches are
  // remote lane B's (src/main/lane-b/remote.ts), around lane A's; its subscriptions follow the tabs of that machine's
  // sessions. It writes no file either.
  // The org rows (made below, over the spine's view) say which of a machine's sessions are lane A: O9's, never placed here.
  let laneOfRow: (machine: MachineRef, session: string) => 'A' | 'B' | null = () => null;
  let othersRow: (machine: MachineRef, session: string) => boolean = () => false; // board #525
  const artifactMachines = new ArtifactMachines(); // P5 O7 M5a (src/main/artifacts/machines.ts)
  // P5 O4 M2: the window that shows a page, for the connectors' window veto (P5 O7 M5c: per RL2 machine too)
  const windowShownOf = (client: ClientRef) => {
    const page = pageOf(client);
    const win = page && BrowserWindow.fromWebContents(page);
    return win ? electronWindowShown(win) : null;
  };
  const remoteLaneB = createRemoteLaneB({
    local,
    layout,
    laneOf: (machine, session) => laneOfRow(machine, session),
    othersOf: (machine, session) => othersRow(machine, session), // board #525
    remote: (ref) => machines.remote(ref),
    onRemote: (listener) => machines.onRemote(listener),
    emit: (machine, name, payload) => void emitFrom(machine, name, payload),
    artifactMachines, // P5 O7 M5a: which machine an artifact is on, written by the adapter alone
    openPath: (path) => shell.openPath(path), // P5 O7 M5a: an open copy of another machine's file (A10)
    env: process.env, // P5 O7 M5a: MAWS_E2E_OPEN_LOG, the open seam
    docChannel: () => new MessageChannelMain(), // P5 O7 M5b: a remote document's port, bridged to a `document` stream
    // P5 O7 M5c: a machine's `connectors.reset` is main's own word to the windows; the window report per machine; a
    // consent page a machine's services asked this device to open
    emitOwn: (name, payload) => void emit(name, payload),
    windowShown: windowShownOf,
    openUrl: (url, machine) => openForMachine(url, machine),
    log: (line) => console.log(`[lane-b] ${line}`),
  });
  // P5 O7 M3: a loopback port of a machine forwarded to this Mac's for the in-app browser (Interfaces §K); the listeners
  // close with remote lane B's `stop`, a shutdown step below
  registerMainHandler('remote.forward.open', async (input) => {
    const result = await remoteLaneB.forward.open(input);
    if (!result.ok) throw new CommandFailure(result.error);
    return result.value;
  });
  registerMainHandler('remote.forward.close', async (input) => {
    const result = await remoteLaneB.forward.close(input);
    if (!result.ok) throw new CommandFailure(result.error);
  });
  // P5 O7 M5a (A10): "Open externally" on another machine's file opens a copy here; invoked on this app, or (a checkout
  // file, its address lowered) on the machine it names, which must be the one the input names
  registerMainHandler('remote.openCopy', async (input, { target }) => {
    if (target !== local && target !== input.machine) throw new CommandFailure(ipcError('invalid_input', `remote.openCopy: its source is on ${target}, not ${input.machine}`));
    const result = await remoteLaneB.artifacts.openCopy(input);
    if (!result.ok) throw new CommandFailure(result.error);
    return result.value;
  });
  // P5 O3-D M5b: a `machine` name goes to mawsd's services front (the `machine` host); the spine's
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
  // P5 O5 M4: artifacts.export goes to mawsd's render seam while its welcome lists machine.render, and is answered by
  // this root's own registration (startArtifacts) on an older daemon; before any welcome it is forwarded
  const daemonRenders = () => {
    const peer = hosts.peer('machine');
    return peer === null || peer.capabilities.includes(MACHINE_RENDER_CAPABILITY);
  };
  // P5 O7 M5c: delivery.send the same way, by machine.delivery: main's shim (./delivery/send.ts) for an older daemon
  const daemonDelivers = () => {
    const peer = hosts.peer('machine');
    return peer === null || peer.capabilities.includes(MACHINE_DELIVERY_CAPABILITY);
  };
  // panel scalpel-3#2: an act the attached daemon predates is refused `not-offered`, never sent to have its `into`
  // passed by as an unknown field (./machines/project-acts-peer.ts)
  beforeCommand(PROJECT_ACT_COMMANDS, refuseUnservedProjectActs(() => hosts.peer('machine'), localName));
  // UX wave U5a (Decision Log 52): a side thread of several comments the attached daemon predates is refused in the
  // card's words, never sent to be opened from its first comment alone (./machines/side-thread-peer.ts)
  beforeCommand(SIDE_THREAD_COMMANDS, refuseUnservedSideThreads(() => hosts.peer('machine'), localName));
  installRouter({ appUrl, local, dispatchToHost, remote: routeLaneB(routeLaneA(machines.dispatch, (ref) => machines.remote(ref), remoteLaneA), (ref) => machines.remote(ref), remoteLaneB), machine: { kind: 'host', daemonRenders, daemonDelivers } });
  // P5 O3-C (Interfaces §A): the services bus, bound here to the router and `emit`, so every tap main's own code holds
  // (the menu's) hears mawsd's events, and main's own calls take main's own route. P5 O15 M2: no library registers its
  // commands here any more; `register` is the older-daemon answers' (a `machine` name answered here only while the
  // daemon's welcome lacks what serves it, the router's `answeredHere`) and main's own.
  const bus: ServicesBus = {
    register: (name, handler) => (REGISTRY.commands[name].owner === 'machine' ? registerMachineHandler(name, handler) : registerMainHandler(name, handler)),
    intercept: interceptCommand,
    emit,
    onEmitted,
    // P5 O3-D M2 (Interfaces §H); P5 O3-E M2 (Interfaces §D): main's own route past the main-only refusal (`machine.op`'s
    // claimed acts are graded acts, never main-only), which forwards a `machine` name to mawsd
    invoke: (name, input, context) => invokeOwn(name, input, { ...context, target: local }) as never,
  };
  remoteLink = (ref) => machines.remote(ref);
  grantsDoor = {
    act: async (action) => {
      const answer = await bus.invoke('endpoint.local.act', { action }, { client: mainClient });
      // the door's way to mawsd failed under an act it may have taken: the grant stays pending, sent again
      return answer.ok ? answer.value : { state: 'unknown', reason: answer.error.code };
    },
    grants: async () => {
      const answer = await bus.invoke('endpoint.local.grants', undefined, { client: mainClient });
      return answer.ok ? answer.value : { ok: false, code: answer.error.code };
    },
  };
  localChannelHistory = async (input) => {
    const answer = await bus.invoke('channel.history', input, { client: mainClient });
    return answer.ok ? { ok: true, value: answer.value } : { ok: false, code: answer.error.code };
  };
  bus.onEmitted('channel.changed', (payload) => {
    for (const listener of [...localChannelListeners]) listener(payload);
  });
  // E11: every will-quit step below joins one ordered list behind one listener (tracker row E10 "14 will-quit listeners");
  // a step's promise (the hosts' draining close of a kept supervisor's socket) holds the exit, bounded by the port's grace;
  // P4 W2-B: the hosts' stop is a drain, run before the rest, which stop once it has settled
  const shutdown = shutdownSteps(app, CLOSE_GRACE_MS, () => startReaper()); // the quit reaper: lifecycle/reaper.ts
  shutdown.add('remote lane B', () => remoteLaneB.stop()); // P5 O7 M2: its subscriptions closed before the links
  // P5 O17 M9b (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §K, "The app's bridge"): a window's own
  // viewers of the agent's tabs on another machine's session, over its RL2 link (src/main/browser/remote-view.ts); the
  // router answers them here for any machine. Its feeds and streams close before the links
  const remoteViews = createRemoteViews({
    local,
    remote: (ref) => machines.remote(ref),
    emit: (client, name, payload) => {
      const page = pageOf(client);
      if (page) emitTo(page, name, payload);
    },
    log: (line) => console.log(line),
  });
  registerMainHandler('browser.remote.open', (input, context) => remoteViews.open(input, context));
  registerMainHandler('browser.remote.select', (input, context) => remoteViews.select(input, context));
  registerMainHandler('browser.remote.takeControl', (input, context) => remoteViews.takeControl(input, context));
  registerMainHandler('browser.remote.releaseControl', (input, context) => remoteViews.releaseControl(input, context));
  registerMainHandler('browser.remote.input', (input, context) => remoteViews.input(input, context));
  registerMainHandler('browser.remote.ack', (input, context) => remoteViews.ack(input, context));
  registerMainHandler('browser.remote.close', (input, context) => remoteViews.close(input, context));
  shutdown.add('remote views', () => remoteViews.stop());
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
  // The engine's environment (the login-shell capture): main's gcloud lookup reads its PATH (mawsd captures its own for
  // the spine's launches, the checkouts' scm and Send to's gws).
  const home = app.getPath('home');
  const engineEnv = captureShellEnvironment();
  // P5 O3-C (docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §D); P5 O3-D M5b: the spine is
  // `mawsd`'s; main holds of it only its view through main's mirror, the one way the code that stays in the app reads the
  // spine (the notifier, the quit guard, the chat panels, the interest report, the browser, the export authors, the org
  // rows, Settings' reveal), the client port's answers and its stop. A launch is told mawsd's cua socket once the browser
  // starts below (E13).
  let cuaSockets: Browser['cua'] | null = null;
  const spine = startDaemonSpine({ hosts, daemon, port: clientPort, browserSocket: () => (cuaSockets ? join(profile, ...CUA_SOCKET_DIR) : null), emit: (name, payload) => void emit(name, payload), budgetsMs: COMMAND_BUDGETS_MS });
  shutdown.add('spine', spine.stop);
  forwardedToMachine = spine.forwarded; // the mirror and the watch replay (the router's forwards above)
  watchReplay = spine.watches;
  const view = spine.view;
  // P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §B, §F; D8, D28, D32): the connectors are
  // the spine's, in mawsd. The app reports each page's window to them through the router's seam before a lease command,
  // adopts the grants Electron's safeStorage sealed once per launch (at the machine host's first streaming), and at each
  // later streaming of the machine host tells its windows `connectors.reset`, on which they rebuild their leases.
  const appConnectors = startAppConnectors({
    local, // P5 O7 M5c: the machine host's reset names this Mac's machine
    machine: { streaming: () => hosts.streaming('machine'), onStreaming: (listener) => hosts.onStreaming('machine', listener) },
    windowShown: windowShownOf,
    invoke: bus.invoke,
    before: beforeCommand,
    emit: (name, payload) => void emit(name, payload),
    adopt: () => adoptLegacyGrants({ directory: join(profile, 'connectors', 'oauth'), sealer: legacySealer(), invoke: bus.invoke, log: (line) => console.log(line) }),
  });
  shutdown.add('connectors', appConnectors.stop);

  // ---- C5: layout store ---- (the store itself is made above, before the router: remote lane B reads it)
  registerOpenExternal();
  // P5 O8 M2: other machines' sessions, from their signed listings through the feed, verified against the held org state,
  // for the machines of O7's RL2 roster (src/main/org/rows.ts); org.rows and org.rows.changed carry them to the sidebar.
  // P5 O3-C (reader R10): this machine's projects, as session.projects.list answers them, through the spine's view.
  // The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, M10): the machines' projects records
  // through the feed, verified, kept and keyed (src/main/org/project-registry.ts); org.projects and org.projects.changed
  // carry them to the page, the rows file each listing under the key it gives the listing's project, and a removal for
  // a machine that is off is held and sent over its link (remote lane B's act) when it is next up.
  const registry = createProjectRegistry({
    session,
    feed: orgFeed,
    local,
    files: orgDir,
    roster: () => roster,
    onRoster,
    link: (ref) => machines.remote(ref),
    localProjects: async () => view.projects(),
    onLocalProjects: (listener) => view.on('projects', () => listener()),
    sessions: () => remoteRows.rows().rows.map((row) => row.project),
    remove: async (machine, input) => {
      const link = machines.remote(machine);
      if (link === null) return { ok: false, error: { code: 'host_unavailable', message: `session.projects.remove: machine ${machine} is not reachable` } };
      return (await remoteLaneB.dispatch(link, 'session.projects.remove', input, { client: mainClient, target: machine })) as CommandResult<'session.projects.remove'>;
    },
    emit: (projects) => void emit('org.projects.changed', projects),
    notify: (text) => void clientPort.notify(null, { title: 'MAWS', body: text, silent: false }, () => {}),
    log: (line) => console.log(line),
  });
  shutdown.add('project registry', () => registry.close());
  registerProjectsHandlers({ register: registerMainHandler, registry });
  const projectActs = startProjectActs({ hosts, registry, roster: () => roster, link: (ref) => machines.remote(ref), send: (link, name, input) => remoteLaneB.dispatch(link, name, input, { client: mainClient, target: link.machine }), register: registerMainHandler, emit: (value) => void emit('org.projectActs.changed', value), log: (line) => console.log(line) });
  shutdown.add('project acts', projectActs.stop);
  const remoteRows = createRemoteRows({
    session,
    feed: orgFeed,
    roster: () => roster,
    onRoster,
    keys: registry, // the project registry (M10): a listing's row key is the key table's for its project
    link: (ref) => machines.remote(ref), // P5 O8 M6b: each roster machine's channel listings (a private session's)
    files: orgDir,
    emit: (rows) => {
      if (!rowsHeld) void emit('org.rows.changed', rows);
      remoteLaneB.refresh(); // P5 O7 M2: a row's lane decides whether its tab is remote lane B's
      registry.refresh(); // the project registry: a project the member sees only through a session
    },
    log: (line) => console.log(`[org-rows] ${line}`),
  });
  laneOfRow = (machine, session) => remoteRows.rows().rows.find((row) => row.machine === machine && row.session === session)?.lane ?? null;
  othersRow = (machine, session) => remoteRows.rows().rows.some((row) => row.machine === machine && row.session === session && !row.mine); // board #525
  void remoteRows.loaded.then(() => remoteLaneB.refresh());
  registerRowsHandler({ register: registerMainHandler, rows: remoteRows });
  // P5 O8 M6b: a session's reach (src/main/org/policy.ts): another machine's over its link, this Mac's over its own
  // endpoint's local door (mawsd's main-only endpoint.local.*, through main's own route); after each act the rows read
  // that machine's channel listings again, and org.policies.changed tells the windows a machine's whole read
  registerPolicyHandlers({
    register: registerMainHandler,
    policies: createOrgPolicies({
      session,
      local,
      remote: (ref) => machines.remote(ref),
      door: {
        act: async (action) => {
          const answer = await bus.invoke('endpoint.local.act', { action }, { client: mainClient });
          // the door's way to mawsd failed under an act it may have taken: its fate is sminos's ledger's
          return answer.ok ? answer.value : { state: 'unknown', reason: answer.error.code };
        },
        call: async (input) => {
          const answer = await bus.invoke('endpoint.local.call', { name: 'record.policy', input }, { client: mainClient });
          return answer.ok ? answer.value : { ok: false, code: answer.error.code };
        },
      },
      laneOf: (machine, id) => laneOfRow(machine, id),
      acted: (machine) => remoteRows.refreshChannel(machine),
      emit: (policy) => void emit('org.policies.changed', policy),
      log: (line) => console.log(line),
    }),
  });
  const stopChatPanels = registerChatPanels(layout, view, local); // P5 O6 M2: local; P5 O3-C (reader R4): the view
  shutdown.add('chat panels', stopChatPanels);
  shutdown.add('layout', () => layout.flush());
  // P5 O2 M2; P5 O3-C (D11): the sessions this app holds open (its tabs and the sessions on screen), one memoized set the
  // interest report sends and the inactive sweep keeps
  const interest = appInterest(layout, view, local); // P5 O6: the local machine's

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
  registerCommentContent(registerMainHandler, app.getPath('userData')); // UX wave U5a: a ticked comment's content, its screenshots under <userData>
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
    machineHost: true, // P5 O17 M9b: the app a tab engine to mawsd, whose machine host every launch runs (P5 O15 M2)
    // P5 O7 M3: a remote session's tabs are this Mac's, said from its machine; a forwarded port's tab opens its forward
    // again at its first load past a relaunch (src/main/browser/machines.ts, forwarded.ts)
    remote: {
      local,
      emitFrom: (machine, name, payload) => emitFrom(machine, name, payload),
      forwards: {
        open: (machine, port) => remoteLaneB.forward.open({ machine, port }),
        listening: (machine, port) => remoteLaneB.forward.listening(machine, port),
        at: (localPort) => remoteLaneB.forward.at(localPort),
      },
    },
  });
  shutdown.add('browser', browser.stop);
  cuaSockets = browser.cua; // E13
  // P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §H): a launch is told
  // mawsd's socket, which checks the engine's peer and relays the connection here from its own process; every session's
  // socket admits that relay by the daemon the machine link is connected to: its socket's peer, pid and start read
  // through the addon at each change of the link (none while it is down), never a pid remembered from a welcome; the pass
  // holds once mawsd answers a request sent on that same link after the read (machine.identity, the front's own, cold)
  let told = 0; // each change of the link: a confirmation counts only for the link it was sent on
  const tellRelay = () => {
    const link = ++told;
    const fd = hosts.snapshot('machine').state === 'ready' ? hosts.servedFd('machine') : null;
    if (fd === null) return browser.cua.relay(null);
    const current = () => link === told && hosts.snapshot('machine').state === 'ready' && hosts.servedFd('machine') === fd;
    browser.cua.relay({ fd, confirm: async () => (await hosts.dispatch('machine', 'machine.identity', undefined)).ok && current() });
  };
  tellRelay();
  shutdown.add('cua relay', hosts.onState('machine', tellRelay));
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
  // The quit reaper (tracker 2026-11-06): the app's own session and every browser partition opened write their storage
  // and cookies to disk, within the steps' bound, so a reap after the exit's stall loses only what Chromium had left
  shutdown.add('browser storage', () => flushSessions([electronSession.defaultSession, ...browser.partitions.sessions()]));

  // The hosts belong to the app, not to a window or a page (§4.1): they start here, before any window exists, and
  // `start()` is idempotent, so opening a window again forks nothing and a reload never reaches them.
  const openWindow = () => {
    void hosts.start();
    const win = createWindow(settings.state().resolvedTheme, placement()); // C5: restored placement
    tracked(win); // C5: tracked placement
    return win; // C5: the notifier re-creates the window through here
  };
  // WR 73: a document's and a dashboard's Word comment authors, the same resolved identity for every export entry point
  const exportAuthors = {
    sessionTitle: (appSessionId: string) => view.record(appSessionId as AppSessionId)?.title.text, // P5 O3-C (reader R9)
    humanAuthorName: async () => {
      const saved = settings.state().settings.artifacts.exportAuthorName;
      return resolveExportHumanName(saved, saved ? null : await usage.routedAccountName());
    },
  };
  // P3-A M4: `artifacts.open` (a document's port to the asking window), before the first window loads (P5 O3-C, D23: the
  // design-system defaults' relay is the spine's). P5 O5 M3: with it the render library, every kind's exporters (P3-B's
  // documents, P3-D's design systems and the governing system, P3-C's presentations, the inspections, P3-E's dashboards and
  // designs) composed in-process as before
  const artifacts = startArtifacts({
    hosts,
    register: registerMainHandler,
    registerMachine: registerMachineHandler, // P5 O5 M4: artifacts.export
    emit, // P3-A M5: artifacts.resync
    env: process.env,
    openWindow,
    root: join(app.getPath('userData'), 'artifacts'), // P3-A M7: the store's directory (the host's own rule)
    artifactsSocket: daemonPaths(profile).artifactsSocket, // P5 O5 M2: the scheme proxy's endpoint, while the daemon's welcome lists it
    authors: exportAuthors, // P5 O5 M3
    remote: remoteLaneB.artifacts.scheme, // P5 O7 M5b: another machine's artifact pages, over its link
  });
  shutdown.add('artifacts', artifacts.stop);
  // P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D7): an artifact page's connectors, the owner's
  // grants, rows and sign-ins, the engine's MCP sign-in and the owner's Send to are the machine's, composed with mawsd's
  // spine. P5 O7 M5c
  // (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "O4's surfaces: leases, the window, delivery on the
  // machine"): `delivery.send` is the machine's too, its export and its delivery both; main's own send
  // (./delivery/send.ts: the export here, the file handed to the machine's `delivery.deliver`, a cancel in its export phase
  // answered here) is kept as the shim for a daemon whose welcome lists no `machine.delivery`, which the router answers
  // here alone (`daemonDelivers`).
  shutdown.add(
    'delivery send',
    registerDeliverySend({
      register: (name, handler) => registerMachineHandler(name, handler),
      before: beforeCommand,
      // P5 O5 M4: the library's Export as the machine command, its dialect on the wire: mawsd's render seam, or this
      // root's handler on an older daemon; the e2e's hold around it (./delivery/e2e-hold.ts)
      exportArtifact: exportHeldFor(async (input: CommandInput<'artifacts.export'>, options?: { dialect?: 'notion' }) => {
        const exported = await invokeOwn('artifacts.export', { ...input, ...(options?.dialect && { dialect: options.dialect }) }, { client: mainClient, target: local });
        if (!exported.ok) throw new Error(exported.error.message);
        return exported.value as CommandOutput<'artifacts.export'>;
      }, process.env),
      call: (name, input) => hosts.dispatch('engine-host', name, input) as never,
      invoke: bus.invoke,
    }),
  );
  // P4-AGG M2: Discover's catalog (the person's, never an agent's): the seed marketplaces, Anthropic's directory and the
  // official install counts through the `catalog` egress rule, cached under userData, joined with the engine's reads per
  // cwd. P5 O4 M3 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D16): those reads and the watch of the engine's
  // plugin state are the machine's, composed with mawsd's spine, asked through main's own route and heard through the
  // bus's tap, which hears mawsd's events
  const catalog = startCatalog({
    register: registerMainHandler,
    emit: (name, payload) => emit(name, payload),
    call: (name, input) => hosts.dispatch('engine-host', name, input) as never, // catalog.postures' configured servers
    invoke: (name, input) => bus.invoke(name, input, { client: mainClient }),
    onEngineChanged: (listener) => bus.onEmitted('catalog.engineChanged', listener),
    userData: app.getPath('userData'),
    env: process.env,
    userAgent: `MAWS/${app.getVersion()}`,
  });
  shutdown.add('catalog', catalog.stop);
  shutdown.add('presenter', registerPresenter({ register: registerMainHandler, appUrl, env: process.env }).end); // P3-C M6: `presentations.present`, the show's windows
  // P3-L M5b: the library's export formats and Save as of an export or a stored file, whatever the index's state. P5
  // O3-C (D22): the client's; the library's derived index is the spine's. P5 O4 M3 (D19): the reads of a stored file
  // (content, read, open, reveal) are the machine's, composed with the spine; these two stay beside the exporters until O5.
  registerLibraryFiles(registerMainHandler, {
    call: (name, input) => hosts.dispatch('engine-host', name, input) as never,
    exporters: artifacts.exporters,
    root: join(app.getPath('userData'), 'artifacts'),
    downloads: () => app.getPath('downloads'),
    port: clientPort, // Save as…, the Replace question
    env: process.env,
    local, // P5 O7 M5a: Save As of another machine's artifact reads it over that machine's link
    remote: (machine) => remoteLaneB.artifacts.files(machine),
    // UX wave U5 (l6-artifacts-20): the dialog opens in the last export's folder, kept under main's layout key; with
    // none, in the artifact's Space's linked folder or the working folder of the session that made it
    layout,
    sessionFolder: (appSessionId) => {
      const record = view.record(appSessionId);
      return record ? workingFolder(record).path : null;
    },
  });
  // P3-E start (E2 M3; E's Decision Log 18): a dashboard source sheet's Download, the artifact's own asset saved through
  // main's dialog under Downloads
  registerAssetDownload(registerMainHandler, {
    call: (name, input) => hosts.dispatch('engine-host', name, input) as never,
    hold: (artifactId, ref) => holdAsset((name, input) => hosts.dispatch('engine-host', name, input) as never, artifactId, ref), // E3: its own hold through the dialog and the copy
    downloads: () => app.getPath('downloads'),
    port: clientPort,
    env: process.env,
    local, // P5 O7 M5b: another machine's asset is fetched over that machine's link
    remote: (machine) => remoteLaneB.artifacts.assets(machine),
  });
  // P3-E end
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): a window's holds over a dashboard's snapshots, each
  // released by its window alone or with it; the host's going takes the host's holds with it
  shutdown.add(
    'dataset-holds',
    registerDatasetHolds(registerMainHandler, {
      call: (name, input) => hosts.dispatch('engine-host', name, input) as never,
      // P5 O7 M5c: another machine's artifact (the router's target) is held on that machine, over its link
      local,
      remote: (machine) => machines.remote(machine),
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
  startAttention(view, {
    actions: notificationActions({ dispatch: hosts.dispatch, view }),
    settings: () => settings.state().settings,
    port: clientPort,
    // P5 O7 M6: other machines' items, from remote lane B's attention feeds, titled by their listed rows
    remote: remoteLaneB.attention,
    remoteTitle: (machine, app) => remoteRows.rows().rows.find((row) => row.machine === machine && row.session === app)?.title ?? null,
  }); // P5 O3-C (readers R1, R2)
  // C12: the busy report asks C9's pty host (read only: pty.list and pty.foreground)
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
    log: process.env.MAWS_E2E === '1' ? (line) => console.error(line) : undefined,
    // C12 end
    // P5 O3-D (Q1); P5 O15 M2: the sessions and the terminals are mawsd's and outlive the app, so a quit asks only about
    // the unsaved files (E5) and stops nothing of the machine's
    ask: (files, asked /* E5 */) =>
      askToQuit(
        files,
        {
          env: process.env,
          show: (options) => {
            const win = BrowserWindow.getFocusedWindow();
            return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
          },
        },
        asked,
      ),
    // E5 start: the unsaved files the windows pushed, and Save all's round trip
    unsavedFiles: () => unsavedFiles.paths(),
    saveAll: () => unsavedFiles.saveAll((requestId) => void emit('layout.saveAll', { requestId })),
    // E5 end
  });
  // The e2e's seam, under MAWS_E2E=1 in a build that is not packaged: the busy report a quit would read now, read through
  // Playwright's `app.evaluate` (e2e/supervisor.spec.ts (h) settles on it before its quit)
  if (process.env.MAWS_E2E === '1' && !app.isPackaged) (globalThis as { __maws_quit?: { report(): Promise<BusyReport> } }).__maws_quit = { report: () => quitGuard.report() };
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
  // P5 O15 M2b: the wake source's three powerMonitor listeners and its timer, and the reach's probes, after their users
  shutdown.add('wake and reach', () => {
    removeWakeSeam();
    wake.close();
    reach.close();
  });
}
