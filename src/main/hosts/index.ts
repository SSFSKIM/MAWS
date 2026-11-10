// Wires the host supervisor into main: the `engine.hostState` and `pty.hostState` snapshot commands, and the events of
// the same names on every transition. P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7); P5 O15 M2
// (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Interfaces §A): the launch's outcome is settled before the
// hosts are created (`prepareLaunch`: the main profile's unit installed or repaired and started, or a private daemon);
// main reaches the engine host, the pty host and `mawsd`'s own `daemon` namespace through `mawsd`'s three relay sockets,
// starting `mawsd` the profile's way, and watches the daemon's status and build (daemon.ts). The host bundles' paths
// (electron-vite's `?modulePath`, the emitted file's path in dev and inside the packaged asar alike) name the builds the
// daemon would start, for the build check and the hello's identity.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { app, shell } from 'electron';
import engineHostPath from '../../engine-host/index?modulePath';
import ptyHostPath from '../../pty-host/index?modulePath';
import { daemonPaths } from '@shared/daemon/files';
import { appIdentity } from '@shared/host/identity';
import type { HostSpec } from '@shared/host/host-supervisor';
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import type { MainBuild } from '@shared/ipc/schema/host'; // E11 §2.7
import { buildIdOf, SUPERVISOR_FILES } from '../../engine-host/supervisor-files';
import { isDefaultProfile, unitFor, type InstallDeps } from '../../mawsd/install';
import { DEFAULT_LABEL, type UnitProgram } from '../../mawsd/units/unit';
import { emit } from '../ipc/events';
import { registerMainHandler } from '../ipc/router';
import { daemonHostSpecs, daemonStart, launchFailed, resolveLaunch, unitRunsThisApp, watchDaemon, type LaunchOutcome, type LaunchShape } from './daemon';
import { watchEngineHandover } from './engine-handover'; // P5 O16 M3c fix wave 2
import { hostEventToWindows } from './window-events'; // P5 O17 M9b
import { retiredHostModeNotice, testLaunchRefusal } from './mode'; // P5 O2 landing; P5 O15 M2: the retired variable
import { startHostStatus, type HostStatusService } from './status';
import { createHostSupervisor, type HostSupervisor } from './supervisor';

export type { LaunchOutcome, LaunchShape, Unavailable } from './daemon';

// `mawsd`'s entry, beside main's own (electron-vite's second main input): out/main/mawsd.js, inside app.asar when packaged
const mawsdPath = (): string => join(__dirname, 'mawsd.js');

// This app as a unit runs it: the app binary as Node, and the real path of its mawsd.js.
const program = (): UnitProgram => {
  let entry = mawsdPath();
  try {
    entry = realpathSync(entry);
  } catch {
    // not built beside main (a test's main): the path as it is
  }
  return { runtime: process.execPath, entry };
};

// The account's name; $USER where the system has no passwd entry to give it (userInfo throws then)
function userName(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? '';
  }
}

const unitDeps = (): InstallDeps => ({
  platform: process.platform,
  home: homedir(),
  env: process.env,
  uid: process.getuid?.() ?? -1,
  user: userName(), // fix wave 1: read on the launch's way, so it never throws
  run: (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? (result.error ? String(result.error) : '') };
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

// The launch's outcome (daemon.ts's table), with the unit work it needs done before any host exists; synchronous when
// there is none (every profile but the main one). Asked again by the repair window's each attempt. P5 O15 M2: a
// MAWS_HOST_MODE the environment still names is said once, at the first ask.
let hostModeTold = false;
// Fix wave 1: never a throw or a rejection either; what goes wrong before resolveLaunch (the launch's facts) is
// `install-refused` with its words, as resolveLaunch's own errors are, so the repair window opens.
export function prepareLaunch(): LaunchOutcome | Promise<LaunchOutcome> {
  const log = (line: string) => console.log(line);
  try {
    const retired = hostModeTold ? null : retiredHostModeNotice(process.env);
    hostModeTold = true;
    if (retired !== null) log(retired);
    return resolveLaunch({ env: process.env, packaged: app.isPackaged, profileDir: app.getPath('userData'), program: program() }, { ...unitDeps(), log, exit: refuse });
  } catch (error) {
    return launchFailed(error, { log });
  }
}

// P5 O2 landing: a test or harness launch on the default profile (testLaunchRefusal) ends here, before the profile's
// machine identity, settings or hosts are touched; prepareLaunch holds the same line.
export function refuseTestLaunchOnDefaultProfile(): void {
  const deps = unitDeps();
  const refusal = testLaunchRefusal(process.env, isDefaultProfile(app.getPath('userData'), deps.platform, deps.env, deps.home));
  if (refusal !== null) refuse(1, refusal);
}

function refuse(code: number, line: string): never {
  console.error(line);
  process.exit(code);
}

// P5 O3-D M5b: the daemon's last `daemon.status` and each new one, for main's mirror of the spine
export interface DaemonStatusWatch {
  status(): DaemonStatus | null;
  refresh(): void; // read it again (src/main/hosts/daemon.ts)
  onStatus(listener: () => void): () => void;
}

// The panel's sweep#3: `machineBudgetsMs`, the spine's commands that run past a request's default deadline (the services'
// COMMAND_BUDGETS_MS), which the `machine` host applies.
export function createHosts(mainBuild: MainBuild, launch: LaunchShape, { machineBudgetsMs }: { machineBudgetsMs?: HostSpec['requestBudgetsMs'] } = {}): { hosts: HostSupervisor; daemon: DaemonStatusWatch } {
  const userData = app.getPath('userData');
  console.log(`[hosts] the engine host runs under the machine daemon (${launch.daemon === 'unit' ? 'its LaunchAgent' : 'a private mawsd'})`);
  // E10 Task 2.4: one identity for the hello and for host.status. P5 O2 M7: the e2e seams are mawsd's (daemon.ts), and
  // host.status compares with the daemon's engine-host build instead.
  const identity = appIdentity(engineHostPath, process.env, 'utility');
  const paths = daemonPaths(userData);
  const modules = { engineHost: engineHostPath, ptyHost: ptyHostPath, mawsd: mawsdPath() };
  const unit = () => unitFor(DEFAULT_LABEL, unitDeps());
  const engineHandover = watchEngineHandover(); // P5 O16 M3c fix wave 2: mawsd's report, on machine.sock
  const supervisor = createHostSupervisor({
    hosts: daemonHostSpecs(paths, daemonStart(launch.daemon, { paths, modules, execPath: process.execPath, env: process.env, packaged: app.isPackaged, unitStart: () => unit().start() }), modules, process.env, machineBudgetsMs, () => engineHandover.drainingAt()),
    emit: hostEventToWindows(emit), // P5 O17 M9b: but what is main's alone
    detached: { identity },
  });
  engineHandover.bind(supervisor); // for the launch's life
  // E10: the engine host is told ready after main's resync (X13), which the session read side registers
  // (sessions/index.ts `hostEventSource`); with none registered (launch mode scenario) it is told at once.
  registerMainHandler('engine.hostState', () => supervisor.snapshot('engine-host'));
  registerMainHandler('pty.hostState', () => supervisor.snapshot('pty-host'));
  supervisor.onState('engine-host', (state) => emit('engine.hostState', state));
  supervisor.onState('pty-host', (state) => emit('pty.hostState', state));
  // P5 O2 M7: the daemon's status for host.status and Diagnostics, and its build checked once for the launch
  let status: HostStatusService | null = null;
  const statusListeners = new Set<() => void>();
  const watch = watchDaemon({
    hosts: supervisor,
    buildId: buildIdOf(mawsdPath()),
    unitRunsThisApp: () => unitRunsThisApp({ profileDir: userData, program: program() }, unitDeps()),
    onChange: () => {
      status?.refresh();
      for (const listener of [...statusListeners]) listener();
    },
    log: (line) => console.log(line),
  });
  // E10: host.status (the supervisor's status with main's facts), host.restart and host.openLog
  status = startHostStatus({
    hosts: supervisor,
    appBuildId: identity.buildId,
    appWire: identity.wire,
    mainBuild, // E11 §2.7
    logPath: () => join(userData, 'supervisor', SUPERVISOR_FILES.log),
    emit: (next) => void emit('host.status', next),
    register: registerMainHandler,
    openPath: (path) => shell.openPath(path),
    daemon: () => watch.status(),
    engineHandover, // P5 O16 M3c fix wave 2
  });
  const daemonWatch = {
    status: () => watch.status(),
    refresh: () => watch.refresh(),
    onStatus: (listener: () => void) => {
      statusListeners.add(listener);
      return () => void statusListeners.delete(listener);
    },
  };
  return { hosts: supervisor, daemon: daemonWatch };
}
