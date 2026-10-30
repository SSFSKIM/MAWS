// Wires the host supervisor into main: the two utility-process entries (bundled by electron-vite's `?modulePath`,
// which evaluates to the emitted file's path in dev and inside the packaged asar alike), the `engine.hostState` and
// `pty.hostState` snapshot commands, and the events of the same names on every transition.
// E10: the engine host runs in the mode MAWS_HOST_MODE picks (mode.ts): detached (the supervisor) or a utility process
// (under the harnesses); the pty host is a utility process.
// P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7): the launch's shape is settled before the hosts are
// created (`prepareLaunch`: the setting, the default profile's unit installed, repaired or uninstalled; daemon.ts). On
// the daemon shape main reaches the engine host, the pty host and `mawsd`'s own `daemon` namespace through `mawsd`'s
// three relay sockets, starting `mawsd` the profile's way, and watches the daemon's status and build (daemon.ts).
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
import type { SupervisorShape } from '@shared/ipc/schema/settings';
import { buildIdOf, SUPERVISOR_FILES } from '../../engine-host/supervisor-files';
import { isDefaultProfile, unitFor, type InstallDeps } from '../../mawsd/install';
import { DEFAULT_LABEL, type UnitProgram } from '../../mawsd/units/unit';
import { emit } from '../ipc/events';
import { registerMainHandler } from '../ipc/router';
import { daemonHostSpecs, daemonStart, resolveLaunch, unitRunsThisApp, watchDaemon, type LaunchShape } from './daemon';
import { testLaunchRefusal } from './mode'; // P5 O2 landing
import { startHostStatus, type HostStatusService } from './status';
import { createHostSupervisor, type HostSupervisor } from './supervisor';

export type { LaunchShape } from './daemon';

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

const unitDeps = (): InstallDeps => ({
  platform: process.platform,
  home: homedir(),
  env: process.env,
  uid: process.getuid?.() ?? -1,
  user: userInfo().username,
  run: (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? (result.error ? String(result.error) : '') };
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

// The launch's shape from the setting `supervisor.shape`, read once, with the unit work it needs done before any host
// exists; synchronous when there is none (every profile but the default one).
export function prepareLaunch(shape: SupervisorShape): LaunchShape | Promise<LaunchShape> {
  return resolveLaunch({ env: process.env, shape, packaged: app.isPackaged, profileDir: app.getPath('userData'), program: program() }, { ...unitDeps(), log: (line) => console.log(line), exit: refuse });
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

// P5 O3-D M5b: on the daemon shape, the daemon's last `daemon.status` and each new one, for main's mirror of the spine
export interface DaemonStatusWatch {
  status(): DaemonStatus | null;
  refresh(): void; // read it again (src/main/hosts/daemon.ts)
  onStatus(listener: () => void): () => void;
}

// P5 O3-A: `spineRefused`, why this run does not run the spine, for host.status (the embedded shape's; on the daemon
// shape the daemon's status says it)
// The panel's sweep#3: `machineBudgetsMs`, the spine's commands that run past a request's default deadline (the services
// entry's COMMAND_BUDGETS_MS), which the daemon shape's `machine` host applies.
export function createHosts(
  mainBuild: MainBuild,
  launch: LaunchShape,
  { spineRefused = null, machineBudgetsMs }: { spineRefused?: string | null; machineBudgetsMs?: HostSpec['requestBudgetsMs'] } = {},
): { hosts: HostSupervisor; daemon: DaemonStatusWatch | null } {
  const { mode } = launch;
  const daemon = mode === 'daemon';
  const userData = app.getPath('userData');
  console.log(`[hosts] the engine host runs ${daemon ? `under the machine daemon (${launch.daemon === 'unit' ? 'its LaunchAgent' : 'a private mawsd'})` : mode === 'detached' ? 'detached (the supervisor)' : 'as a utility process'}`);
  // E10 Task 2.4: one identity for the hello and for host.status, so the e2e seams (MAWS_E2E_BUILD_ID, MAWS_E2E_WIRE)
  // read the same in both; a utility host is never compared, so they apply only when detached. P5 O2 M7: on the daemon
  // shape the seams are mawsd's (daemon.ts), and host.status compares with the daemon's engine-host build instead.
  const identity = appIdentity(engineHostPath, process.env, mode === 'detached' ? 'detached' : 'utility');
  const paths = daemonPaths(userData);
  const modules = { engineHost: engineHostPath, ptyHost: ptyHostPath, mawsd: mawsdPath() };
  const unit = () => unitFor(DEFAULT_LABEL, unitDeps());
  const supervisor = createHostSupervisor({
    hosts: daemon
      ? daemonHostSpecs(paths, daemonStart(launch.daemon ?? 'private', { paths, modules, execPath: process.execPath, env: process.env, packaged: app.isPackaged, unitStart: () => unit().start() }), modules, process.env, machineBudgetsMs)
      : {
          'engine-host': { modulePath: engineHostPath, serviceName: 'maws-engine-host', transport: mode },
          'pty-host': { modulePath: ptyHostPath, serviceName: 'maws-pty-host' },
        },
    emit,
    detached: { identity },
  });
  // E10: the engine host is told ready after main's resync (X13), which the session read side registers
  // (sessions/index.ts `hostEventSource`); with none registered (launch mode scenario) it is told at once.
  registerMainHandler('engine.hostState', () => supervisor.snapshot('engine-host'));
  registerMainHandler('pty.hostState', () => supervisor.snapshot('pty-host'));
  supervisor.onState('engine-host', (state) => emit('engine.hostState', state));
  supervisor.onState('pty-host', (state) => emit('pty.hostState', state));
  // P5 O2 M7: the daemon's status for host.status and Diagnostics, and its build checked once for the launch
  let status: HostStatusService | null = null;
  const statusListeners = new Set<() => void>();
  const watch = daemon
    ? watchDaemon({
        hosts: supervisor,
        buildId: buildIdOf(mawsdPath()),
        unitRunsThisApp: () => unitRunsThisApp({ profileDir: userData, program: program() }, unitDeps()),
        onChange: () => {
          status?.refresh();
          for (const listener of [...statusListeners]) listener();
        },
        log: (line) => console.log(line),
      })
    : null;
  // E10: host.status (the supervisor's status with main's facts), host.restart and host.openLog
  status = startHostStatus({
    hosts: supervisor,
    appBuildId: identity.buildId,
    appWire: identity.wire,
    mainBuild, // E11 §2.7
    logPath: () => (mode !== 'utility' ? join(userData, 'supervisor', SUPERVISOR_FILES.log) : null),
    emit: (next) => void emit('host.status', next),
    register: registerMainHandler,
    openPath: (path) => shell.openPath(path),
    ...(watch ? { daemon: () => watch.status() } : {}),
    daemonUnavailable: launch.unavailable,
    spineRefused, // P5 O3-A
  });
  const daemonWatch = watch
    ? {
        status: () => watch.status(),
        refresh: () => watch.refresh(),
        onStatus: (listener: () => void) => {
          statusListeners.add(listener);
          return () => void statusListeners.delete(listener);
        },
      }
    : null;
  return { hosts: supervisor, daemon: daemonWatch };
}
