// E10: main's `host.status` and the supervisor's own status for renderer tests, a detached supervisor of this build
// holding three sessions unless a test says otherwise.
import type { HostStatus, SupervisorStatus } from '@shared/ipc/schema/host';

export const SUPERVISOR_STARTED = new Date(2026, 9, 6, 14, 2).toISOString(); // 14:02 local

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
  matches: 'same',
  reason: null,
  waitingLiveSessions: null,
  lastExit: null,
  ...over,
});

// An older build's supervisor, served while it still runs `live` sessions (exit-when-idle armed).
export const updatedStatus = (live = 2): HostStatus =>
  hostStatus({ matches: 'build', supervisor: supervisorStatus({ buildId: 'old', liveSessions: live, exitWhenIdle: true }) });

// An incompatible supervisor main waits on (`crashed` with reason `incompatible`), running `live` sessions.
export const waitingStatus = (live = 2): HostStatus =>
  hostStatus({ state: 'crashed', supervisor: null, matches: 'wire', reason: 'incompatible', waitingLiveSessions: live });
