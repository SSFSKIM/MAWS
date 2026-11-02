// P5 O16 panel fix wave 1 (scalpel-1#1; follow-up: an unattached host's stop too, process-table.ts `UnattachedHost`; docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3, Interfaces §D; D61(3)
// and (4), D64(7)): a stop-all's stop of a session the start holds for adoption. A stop-all closes reservation, so such a
// session never becomes a row the ladder could stop, and its adoption, under way or given up, leaves its engine running.
// It is ended through its session host's own shutdown: SIGTERM to the host, which closes admission, waits for a fork
// under way to record its outcome, sends SIGTERM to the child's process group and gives it HOST_EXIT_GRACE_MS (the M1
// rule a lost transport's `endHost` relies on too). That reaches a child the roster entry could not name yet (a
// committed spawn) and needs no writer, so it neither waits for the adoption nor races its attach. A child still running
// past the grace is killed with its group, as the ladder's SIGKILL; the child is read again from the roster entry,
// which the host keeps while its child outlives it. Both processes are named by pid and start time, never by pid alone.
import { HOST_EXIT_GRACE_MS } from './protocol';
import { readRoster, type RosterEntry } from './roster';

export type HeldStopOutcome = 'stopped' | 'forced' | 'gone';

export const HELD_STOP_MARGIN_MS = 1_000; // past the host's own grace, before the child's SIGKILL
const POLL_MS = 100;

export interface HeldStopDeps {
  hostsDir: string;
  isAlive(pid: number): boolean;
  procStartOf(pid: number): string | null;
  signal(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void; // signalOrphan in production: SIGKILL to the group
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  graceMs?: number; // HOST_EXIT_GRACE_MS + HELD_STOP_MARGIN_MS
}

// A process by pid and start time (the roster's, the orphan ledger's shape), never by pid alone.
export type ProcessKey = { pid: number; procStart: string };

// `stopped` when the engine (or the spawn the host was forking) ended within the grace, `forced` when its group was
// killed, `gone` when neither the host nor an engine was running.
export async function stopHeldHost(entry: RosterEntry, deps: HeldStopDeps): Promise<HeldStopOutcome> {
  const same = (p: ProcessKey | null): p is ProcessKey => p !== null && p.procStart !== '' && deps.isAlive(p.pid) && deps.procStartOf(p.pid) === p.procStart;
  const current = () => readRoster(deps.hostsDir, () => {}).find((e) => e.holderId === entry.holderId) ?? null;
  const childNow = (): ProcessKey | null => current()?.child ?? entry.child;
  const host: ProcessKey = { pid: entry.pid, procStart: entry.procStart };
  const name = `session host ${entry.holderId} (pid ${entry.pid}) of ${entry.appSessionId ?? 'no session'}, held for adoption`;
  const hostLive = same(host);
  const child = childNow();
  const childLive = same(child);
  const engine = childLive || (hostLive && child === null && (current()?.state ?? entry.state) === 'committed');
  if (!hostLive && !childLive) return 'gone';
  const signal = (pid: number, sig: 'SIGTERM' | 'SIGKILL') => {
    try {
      deps.signal(pid, sig);
    } catch (error) {
      deps.log(`${name}: ${sig} to ${pid} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  deps.log(`${name}: stop all ends it, SIGTERM to ${hostLive ? 'the host' : `its engine pid ${child!.pid} (the host is gone)`}`);
  signal(hostLive ? host.pid : child!.pid, 'SIGTERM');
  const graceMs = deps.graceMs ?? HOST_EXIT_GRACE_MS + HELD_STOP_MARGIN_MS;
  // polled with isAlive alone (no `ps` per poll on the event loop); the start time is read again before the SIGKILL
  const running = () => deps.isAlive(host.pid) || [child, current()?.child ?? null].some((c) => c !== null && deps.isAlive(c.pid));
  for (let waited = 0; waited < graceMs && running(); waited += POLL_MS) await deps.sleep(Math.min(POLL_MS, graceMs - waited));
  const left = childNow();
  if (same(left)) {
    deps.log(`${name}: its engine pid ${left.pid} still running after ${graceMs} ms: SIGKILL`);
    signal(left.pid, 'SIGKILL');
    return 'forced';
  }
  return engine ? 'stopped' : 'gone';
}
