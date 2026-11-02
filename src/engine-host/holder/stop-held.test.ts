// P5 O16 wave 1 verification: the held and unattached host's stop (stop-held.ts) against a fake process world. A stop
// whose outcome is not known is never read as done: a committed spawn still unresolved past the grace answers
// `incomplete`, and a process whose start time cannot be read answers `unverified`, with no signal to its pid. Only a
// process verified gone (kill(pid, 0) refused, ESRCH) or verified another (its start time read, and different) is gone.
import { describe, expect, it } from 'vitest';
import type { RosterEntry } from './roster';
import { stopHeldHost, type HeldStopDeps } from './stop-held';

const HOST = { pid: 5100, procStart: 'host-start' };
const CHILD = { pid: 5101, procStart: 'child-start' };

const entry = (over: Partial<RosterEntry> = {}): RosterEntry => ({
  protocol: 1, holderId: 'Lheld0001', pid: HOST.pid, procStart: HOST.procStart, startedAt: '2026-11-01T10:00:00.000Z', socket: '/x/h.sock', binary: '/x/maws-session-host',
  appSessionId: 'app-held', engineSessionId: 'eng', state: 'running', child: CHILD, fence: 1, exit: null, ...over,
});

// The world: each pid alive or not, and the start time `ps` reads for it (null: unreadable)
function world(processes: Record<number, { alive: boolean; start: string | null }>) {
  const signals: string[] = [];
  const deps: HeldStopDeps = {
    hostsDir: '/nonexistent/hosts', // no roster entry on disk: the entry given is the latest word
    isAlive: (pid) => processes[pid]?.alive ?? false,
    procStartOf: (pid) => (processes[pid]?.alive ? (processes[pid]!.start ?? null) : null),
    signal: (pid, name) => {
      signals.push(`${name} ${pid}`);
      if (name === 'SIGKILL' && processes[pid]) processes[pid]!.alive = false;
    },
    sleep: async () => {},
    log: () => {},
    graceMs: 300,
  };
  return { deps, signals };
}

describe('the held host’s stop, when its outcome is not known', () => {
  it('a committed spawn still unresolved past the grace (the host alive, waiting for its fork; no child known) is incomplete', async () => {
    const { deps, signals } = world({ [HOST.pid]: { alive: true, start: HOST.procStart } });
    expect(await stopHeldHost(entry({ state: 'committed', child: null }), deps)).toBe('incomplete');
    expect(signals).toEqual([`SIGTERM ${HOST.pid}`]);
  });

  it('a host whose start cannot be read is unverified: no signal, never gone', async () => {
    const { deps, signals } = world({ [HOST.pid]: { alive: true, start: null }, [CHILD.pid]: { alive: true, start: CHILD.procStart } });
    expect(await stopHeldHost(entry(), deps)).toBe('unverified');
    expect(signals).toEqual([]);
  });

  it('a host gone and a child whose start cannot be read is unverified: no signal', async () => {
    const { deps, signals } = world({ [CHILD.pid]: { alive: true, start: null } });
    expect(await stopHeldHost(entry(), deps)).toBe('unverified');
    expect(signals).toEqual([]);
  });

  it('a child that outlives the grace with its start now unreadable is unverified, not killed', async () => {
    const processes = { [HOST.pid]: { alive: true, start: HOST.procStart }, [CHILD.pid]: { alive: true, start: CHILD.procStart as string | null } };
    const { deps, signals } = world(processes);
    const sleep = deps.sleep;
    deps.sleep = async (ms) => {
      processes[HOST.pid]!.alive = false; // the host left after its grace
      processes[CHILD.pid]!.start = null; // and `ps` no longer answers for the child
      return sleep(ms);
    };
    expect(await stopHeldHost(entry(), deps)).toBe('unverified');
    expect(signals).toEqual([`SIGTERM ${HOST.pid}`]);
  });

  it('a host and child verified gone, or their pids reused by others (a start read and different), are gone', async () => {
    expect(await stopHeldHost(entry(), world({}).deps)).toBe('gone');
    const reused = world({ [HOST.pid]: { alive: true, start: 'another' }, [CHILD.pid]: { alive: true, start: 'another' } });
    expect(await stopHeldHost(entry(), reused.deps)).toBe('gone');
    expect(reused.signals).toEqual([]);
  });
});
