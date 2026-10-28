// E10: main's `host.status` and the supervisor's own status for renderer tests, a detached supervisor of this build
// holding three sessions unless a test says otherwise.
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import type { HostStatus, SupervisorStatus } from '@shared/ipc/schema/host';

export const SUPERVISOR_STARTED = new Date(2026, 9, 6, 14, 2).toISOString(); // 14:02 local
export const MAIN_BUILT = new Date(2026, 9, 8, 2, 5).toISOString(); // E11 §2.7: main's build, 02:05 local

export const supervisorStatus = (over: Partial<SupervisorStatus> = {}): SupervisorStatus => ({
  mode: 'detached',
  pid: 48213,
  startedAt: SUPERVISOR_STARTED,
  buildId: 'b',
  protocol: 1,
  wire: 'w',
  liveSessions: 3,
  rows: 4,
  idleExitMs: 600_000,
  idleExitAt: null,
  exitWhenIdle: false,
  socketPath: '/u/supervisor/host.sock',
  logPath: '/u/supervisor/host.log',
  orphansKilled: 0,
  ...over,
});

export const hostStatus = (over: Partial<HostStatus> = {}): HostStatus => ({
  transport: 'detached',
  state: 'ready',
  supervisor: supervisorStatus(),
  appBuildId: 'b',
  appWire: 'w',
  mainBuild: { version: '0.0.0', commit: 'ac8724a6', builtAt: MAIN_BUILT },
  matches: 'same',
  reason: null,
  waitingLiveSessions: null,
  lastExit: null,
  daemon: null, // P5 O2 M7: the embedded shape
  daemonUnavailable: null,
  ...over,
});

// An older build's supervisor, served while it still runs `live` sessions (exit-when-idle armed).
export const updatedStatus = (live = 2): HostStatus =>
  hostStatus({ matches: 'build', supervisor: supervisorStatus({ buildId: 'old', liveSessions: live, exitWhenIdle: true }) });

// An incompatible supervisor main waits on (`crashed` with reason `incompatible`), running `live` sessions.
export const waitingStatus = (live = 2): HostStatus =>
  hostStatus({ state: 'crashed', supervisor: null, matches: 'wire', reason: 'incompatible', waitingLiveSessions: live });

// P5 O2 M7: a private `mawsd` of this build, its hosts ready, as main's daemon.status reads it
export const daemonStatus = (over: Partial<DaemonStatus> = {}): DaemonStatus => ({
  pid: 4100,
  startedAt: SUPERVISOR_STARTED,
  kind: 'private',
  build: { version: '0.0.0', commit: 'ac8724a6', builtAt: MAIN_BUILT, buildId: 'a1b2c3d4e5f60718', engineHostBuildId: 'b' },
  machine: 'mRef0123456789abcdefAB' as DaemonStatus['machine'],
  profile: '/u',
  platform: 'darwin',
  role: 'laptop',
  hosts: { 'engine-host': { state: 'ready', pid: 48213, build: 'b', liveSessions: 3 }, 'pty-host': { state: 'ready', pid: 48300, build: 'p', liveSessions: 1 } },
  clients: { engineHost: true, ptyHost: true, machine: 1 },
  idleExitAt: null,
  logPath: '/u/mawsd/mawsd.log',
  endpoint: { present: false, detail: null },
  ...over,
});

// P5 O2 M7: the engine host reached through that daemon
export const daemonShapeStatus = (over: Partial<HostStatus> = {}): HostStatus => hostStatus({ transport: 'daemon', daemon: daemonStatus(), ...over });
