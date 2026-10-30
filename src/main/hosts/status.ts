// What the app shows of the engine host's supervisor (E10 execution document, Interfaces "X2 additions", §Design 1 "The
// crash of a supervisor", §11): `host.status`, main's composition of the supervisor's last `host.supervisorStatus` with
// main's own facts (the transport, the state, why it is crashed, the app's build and wire, main's own build stamp, the
// last unexpected exit),
// answered as a command and emitted on every SupervisorStatus and every transition of the engine host; and the two
// actions behind the Settings and Diagnostics rows and the banners, `host.restart` and `host.openLog`.
// P5 O2 M7: on the daemon shape (`daemon` given) the transport reads `daemon`, the status carries the daemon's own
// `daemon.status` (daemon.ts's watch, re-emitted through `refresh`), and `matches` compares the engine host's build with
// the one the daemon would start, since the engine host's updates are `mawsd`'s to make; the embedded shape compares
// with the app's own, as before, and carries no daemon.
import { ipcError } from '@shared/ipc/errors';
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import type { HostStatus, MainBuild, SupervisorStatus } from '@shared/ipc/schema/host';
import { CommandFailure, type registerMainHandler } from '../ipc/router';
import type { HostSupervisor } from './supervisor';

export interface HostStatusDeps {
  hosts: Pick<HostSupervisor, 'snapshot' | 'onState' | 'onEvent' | 'facts' | 'restartSupervisor' | 'dispatch'>;
  appBuildId(): string; // the build id of the engine-host bundle this app would start
  appWire(): string; // this app's wire fingerprint
  mainBuild: MainBuild; // E11 §2.7: main's own build, for Diagnostics
  logPath(): string | null; // where a detached supervisor's log is, connected or not; null for a utility host
  emit(status: HostStatus): void;
  register: typeof registerMainHandler;
  openPath(path: string): Promise<string>; // shell.openPath: '' when opened, else the reason
  daemon?(): DaemonStatus | null; // P5 O2 M7: the daemon shape's last daemon.status (null until it first answers)
  daemonUnavailable?: string | null; // P5 O2 M7: why the daemon shape the setting asks for does not run this launch
  spineRefused?: string | null; // P5 O3-A: why this run does not run the spine (src/services/settings/spine-lock.ts); the embedded shape's
}

export interface HostStatusService {
  status(): HostStatus;
  refresh(): void; // P5 O2 M7: the daemon's status changed: emitted again
  stop(): void;
}

export function startHostStatus(deps: HostStatusDeps): HostStatusService {
  let supervisor: SupervisorStatus | null = null; // the connected supervisor's last status; none while the host is not ready
  let liveAtLastStatus = 0; // what a crash interrupted: the rows live at the last status any supervisor sent
  let lastExit: HostStatus['lastExit'] = null;

  // P5 O1 M6 (OX1): a supervisor that sends its status was welcomed, so it shares the wire's major or (the protocol-2
  // window) the fingerprint, and differs at most by build; what an incompatible one refused comes from the transport
  // P5 O2 M7: on the daemon shape, against the engine-host build the daemon would start; unknown until it answers
  const matchesOf = (status: SupervisorStatus): HostStatus['matches'] => {
    if (!deps.daemon) return status.buildId !== deps.appBuildId() ? 'build' : 'same';
    const daemon = deps.daemon();
    return daemon === null ? null : status.buildId !== daemon.build.engineHostBuildId ? 'build' : 'same';
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
      transport: deps.daemon ? 'daemon' : facts.transport, // P5 O2 M7
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
      daemon: deps.daemon?.() ?? null, // P5 O2 M7
      daemonUnavailable: deps.daemonUnavailable ?? null,
      // P5 O3-A; P5 O3-D M5b: on the daemon shape the spine is mawsd's, and its last daemon.status says why it does not run
      spineRefused: deps.daemon ? (deps.daemon()?.spine?.refused ?? null) : (deps.spineRefused ?? null),
    };
  };

  const take = (next: SupervisorStatus) => {
    supervisor = next;
    liveAtLastStatus = next.liveSessions;
    deps.emit(status());
  };
  // M5b fix round 2: on the daemon shape `mawsd`'s link to the engine host is permanent, so an app that attaches to a host
  // already running gets no connect burst, and so no status, until the host's status changes; main asks for it at each
  // ready, a status heard while the answer is out winning over it.
  // M5b fix round 4: asked over machine.sock, where a post-D app hears the host's events (mawsd's relay keeps them off
  // engine-host.sock), so on one ordered connection an event sent before the answer arrives before it and the rule above
  // covers one sent after (D19's one connection); and asked again when machine.sock is ready again, its events between lost
  let heard = 0;
  const ask = () => {
    const before = heard;
    void deps.hosts.dispatch('machine', 'host.supervisorStatus', undefined).then((answer) => {
      if (answer.ok && heard === before && deps.hosts.snapshot('engine-host').state === 'ready') take(answer.value as SupervisorStatus);
    });
  };
  const bothReady = () => deps.hosts.snapshot('engine-host').state === 'ready' && deps.hosts.snapshot('machine').state === 'ready';
  const offs = [
    deps.hosts.onState('engine-host', (state) => {
      if (state.state !== 'ready') supervisor = null;
      deps.emit(status());
      if (deps.daemon && bothReady()) ask();
    }),
    ...(deps.daemon ? [deps.hosts.onState('machine', () => void (bothReady() && ask()))] : []),
    deps.hosts.onEvent('host.supervisorStatus', (next) => {
      heard += 1;
      take(next);
    }),
  ];

  if (deps.daemon && bothReady()) ask();
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

  return { status, refresh: () => deps.emit(status()), stop: () => offs.forEach((off) => off()) };
}
