// The Diagnostics strip's supervisor row (E10 execution document, §Design 11): main's `host.status` read out (mode,
// pid, whether the build matches, sessions held, the idle exit, orphans killed at start, the socket, the last
// unexpected exit), "Open log" (`host.openLog`, main opening `host.log`), and, while no supervisor runs (waiting on an
// incompatible one, a held lock, the crash limit), Restart now (Decision Log 90f959f4: a way back stays in view after
// the banner is dismissed). The strip connects the hosts store; the app root keeps it connected too.
import type { HostStatus } from '@shared/ipc/schema/host';
import { clockTime } from '../budget/copy';
import { ipc } from '../ipc/client';
import { useHosts } from '../stores/hosts';
import { useNotices } from '../stores/notices';
import { SUPERVISOR_ROW } from './copy';
import { restartSupervisor } from './supervisor-notices';

const ROW = SUPERVISOR_ROW;

// A wait on an incompatible supervisor is not a fault of this one: it reads as a warning, not a crash.
const dotOf = (status: HostStatus | null): string => {
  if (!status) return 'bg-fg-faint';
  if (status.state === 'ready') return 'bg-success';
  if (status.state === 'crashed' && status.reason !== 'incompatible') return 'bg-danger';
  return 'bg-warning';
};

export function describeSupervisor(status: HostStatus | null): string {
  if (!status) return ROW.unknown;
  const parts: string[] = [ROW.label, ROW.mode(status.transport)];
  const s = status.supervisor;
  if (status.state === 'crashed') {
    if (status.reason === 'incompatible') parts.push(ROW.waiting(status.waitingLiveSessions ?? 0));
    else parts.push(status.reason === 'held_lock' ? ROW.heldLock : ROW.crashed);
  } else if (status.state === 'restarting') parts.push(ROW.restarting);
  else if (status.state === 'starting' || s === null) parts.push(ROW.starting);
  else {
    const idle = status.transport === 'utility' ? ROW.idleWithApp : s.exitWhenIdle ? ROW.idleWithLast : s.idleExitMs === null ? ROW.idleNever : ROW.idleAfter(s.idleExitMs);
    parts.push(ROW.pid(s.pid));
    if (status.matches) parts.push(ROW.matches[status.matches]);
    parts.push(ROW.held(s.liveSessions), idle, ROW.orphans(s.orphansKilled));
    if (s.socketPath) parts.push(ROW.socket(s.socketPath));
  }
  if (status.state === 'crashed' && status.reason === 'incompatible' && status.matches) parts.push(ROW.matches[status.matches]);
  const exit = status.lastExit;
  parts.push(exit ? ROW.lastExit(clockTime(exit.at), exit.code, exit.signal, exit.interrupted) : ROW.noExit);
  return parts.join(' · ');
}

const BUTTON = 'rounded-sm border border-border px-2 py-0.5 text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';

export function SupervisorRow() {
  const status = useHosts((s) => s.supervisor);
  const openLog = async () => {
    const result = await ipc.invoke('host.openLog', undefined);
    if (!result.ok) useNotices.getState().toast({ level: 'warning', text: ROW.openLogFailed(result.error.message), actions: [], dismissible: true });
  };
  return (
    <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1">
      <output aria-label={ROW.label} className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${dotOf(status)}`} />
        {describeSupervisor(status)}
      </output>
      {status?.state === 'crashed' && (
        <button type="button" className={BUTTON} onClick={() => void restartSupervisor(ipc, useNotices)}>
          {ROW.restartNow}
        </button>
      )}
      {status?.transport === 'detached' && (
        <button type="button" className={BUTTON} onClick={() => void openLog()}>
          {ROW.openLog}
        </button>
      )}
    </div>
  );
}
