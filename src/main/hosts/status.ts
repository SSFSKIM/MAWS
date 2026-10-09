// What the app shows of the engine host's supervisor (E10 execution document, Interfaces "X2 additions", §Design 1 "The
// crash of a supervisor", §11): `host.status`, main's composition of the supervisor's last `host.supervisorStatus` with
// main's own facts (the transport, the state, why it is crashed, the app's build and wire, main's own build stamp, the
// last unexpected exit),
// answered as a command and emitted on every SupervisorStatus and every transition of the engine host; and the two
// actions behind the Settings and Diagnostics rows and the banners, `host.restart` and `host.openLog`.
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { ipcError } from '@shared/ipc/errors';
import type { HostStatus, MainBuild, SupervisorStatus } from '@shared/ipc/schema/host';
import { CommandFailure, type registerMainHandler } from '../ipc/router';
import type { HostSupervisor } from './supervisor';

export interface HostStatusDeps {
  hosts: Pick<HostSupervisor, 'snapshot' | 'onState' | 'onEvent' | 'facts' | 'restartSupervisor'>;
  appBuildId(): string; // the build id of the engine-host bundle this app would start
  appWire(): string; // this app's wire fingerprint
  mainBuild: MainBuild; // E11 §2.7: main's own build, for Diagnostics
  logPath(): string | null; // where a detached supervisor's log is, connected or not; null for a utility host
  emit(status: HostStatus): void;
  register: typeof registerMainHandler;
  openPath(path: string): Promise<string>; // shell.openPath: '' when opened, else the reason
}

export interface HostStatusService {
  status(): HostStatus;
  stop(): void;
}

export function startHostStatus(deps: HostStatusDeps): HostStatusService {
  let supervisor: SupervisorStatus | null = null; // the connected supervisor's last status; none while the host is not ready
  let liveAtLastStatus = 0; // what a crash interrupted: the rows live at the last status any supervisor sent
  let lastExit: HostStatus['lastExit'] = null;

  const matchesOf = (status: SupervisorStatus): NonNullable<HostStatus['matches']> => {
    if (status.protocol !== SOCKET_PROTOCOL) return 'protocol';
    if (status.wire !== deps.appWire()) return 'wire';
    return status.buildId !== deps.appBuildId() ? 'build' : 'same';
  };

  const status = (): HostStatus => {
    const facts = deps.hosts.facts('engine-host');
    // an exit is counted against the status before it, once: a successor's status does not rewrite it, and a successor
    // that dies before sending one interrupted nothing
    if (facts.lastExit && facts.lastExit.at !== lastExit?.at) {
      lastExit = { ...facts.lastExit, interrupted: liveAtLastStatus };
      liveAtLastStatus = 0;
    }
    return {
      transport: facts.transport,
      state: deps.hosts.snapshot('engine-host').state,
      supervisor,
      appBuildId: deps.appBuildId(),
      appWire: deps.appWire(),
      mainBuild: deps.mainBuild,
      // while an incompatible supervisor is waited for, nothing is connected; what it refused says how it differs
      matches: supervisor ? matchesOf(supervisor) : facts.reason === 'incompatible' ? facts.refused : null,
      reason: facts.reason,
      waitingLiveSessions: facts.waitingLiveSessions,
      lastExit,
    };
  };

  const offs = [
    deps.hosts.onState('engine-host', (state) => {
      if (state.state !== 'ready') supervisor = null;
      deps.emit(status());
    }),
    deps.hosts.onEvent('host.supervisorStatus', (next) => {
      supervisor = next;
      liveAtLastStatus = next.liveSessions;
      deps.emit(status());
    }),
  ];

  deps.register('host.status', () => status());
  deps.register('host.restart', async ({ stopSessions }) => {
    const result = await deps.hosts.restartSupervisor({ stopSessions });
    if (!result.ok) throw new CommandFailure(result.error);
  });
  deps.register('host.openLog', async () => {
    const path = supervisor?.logPath ?? deps.logPath();
    if (path === null) throw new CommandFailure(ipcError('internal', 'the engine host runs as a utility process and keeps no log of its own'));
    const failed = await deps.openPath(path);
    if (failed) throw new CommandFailure(ipcError('internal', `${path} could not be opened: ${failed}`));
  });

  return { status, stop: () => offs.forEach((off) => off()) };
}
