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

// `incomplete` and `unverified`: the stop is not done (see stopHeldHost); its record and the launch guard stay
export type HeldStopOutcome = 'stopped' | 'forced' | 'gone' | 'incomplete' | 'unverified';
export const stopUnresolved = (outcome: HeldStopOutcome): boolean => outcome === 'incomplete' || outcome === 'unverified';
// What a launch's or a forget's `already_live` refusal says of an unresolved stop
export const UNRESOLVED_STOP: Record<'incomplete' | 'unverified', string> = {
  incomplete: 'its previous session host is still starting its engine; try again in a moment',
  unverified: 'its previous session host could not be verified (its start time is unreadable); try again in a moment',
};

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

// A process by pid and `ps`'s start time (procStart: the roster's, the orphan ledger's shape), never by pid alone. Not
// shared/host/completion-routes.ts's `StartedAtKey` (a pid with the start its lock declares), which a client keys by
// from a welcome or a status; this one is checked against the live process (`isSameProcess`).
export type ProcStartKey = { pid: number; procStart: string };

// `stopped` when the engine (or the spawn the host was forking) ended within the grace, `forced` when its group was
// killed, `gone` when neither the host nor an engine was running. Wave 1 verification: two outcomes say the stop is not
// done, so its caller keeps the record and refuses what would start a second engine. `incomplete`: the host lives past
// the grace with no child known, a committed spawn whose fork it still waits for (native `awaitSpawn`), so a child may
// yet appear. `unverified`: a process alive whose start time cannot be read (a `ps` timed out, under load) is neither
// signalled nor taken for gone. A process is gone only when verified so: `kill(pid, 0)` refused (ESRCH), or its start
// read and another's.
// A process's state, verified: `gone` only when kill(pid, 0) refused (ESRCH) or its start read and another's (the pid
// reused); alive with a start that cannot be read (or none recorded) is `unverifiable`. Wave 1 re-verification: also the
// process table's test of whether an unattached host's record still guards anything (process-table.ts `liveUnattached`).
export function processState(p: ProcStartKey | null, deps: Pick<HeldStopDeps, 'isAlive' | 'procStartOf'>): 'same' | 'gone' | 'unverifiable' {
  if (p === null || !deps.isAlive(p.pid)) return 'gone';
  const start = deps.procStartOf(p.pid);
  if (start === null || p.procStart === '') return 'unverifiable';
  return start === p.procStart ? 'same' : 'gone'; // another process under the pid
}

// The host's engine as the roster names it now (the host keeps its entry while its child outlives it), else as the
// entry the start read named it
export function heldChild(entry: RosterEntry, hostsDir: string): ProcStartKey | null {
  return readRoster(hostsDir, () => {}).find((e) => e.holderId === entry.holderId)?.child ?? entry.child;
}

export async function stopHeldHost(entry: RosterEntry, deps: HeldStopDeps): Promise<HeldStopOutcome> {
  const check = (p: ProcStartKey | null) => processState(p, deps);
  const current = () => readRoster(deps.hostsDir, () => {}).find((e) => e.holderId === entry.holderId) ?? null;
  const childNow = (): ProcStartKey | null => heldChild(entry, deps.hostsDir);
  const host: ProcStartKey = { pid: entry.pid, procStart: entry.procStart };
  const name = `session host ${entry.holderId} (pid ${entry.pid}) of ${entry.appSessionId ?? 'no session'}, held for adoption`;
  const hostState = check(host);
  const child = childNow();
  const childState = check(child);
  if (hostState === 'unverifiable' || childState === 'unverifiable') {
    deps.log(`${name}: ${hostState === 'unverifiable' ? 'the host' : `its engine pid ${child!.pid}`} lives and its start time cannot be read; not signalled`);
    return 'unverified';
  }
  const engine = childState === 'same' || (hostState === 'same' && child === null && (current()?.state ?? entry.state) === 'committed');
  if (hostState === 'gone' && childState === 'gone') return 'gone';
  const signal = (pid: number, sig: 'SIGTERM' | 'SIGKILL') => {
    try {
      deps.signal(pid, sig);
    } catch (error) {
      deps.log(`${name}: ${sig} to ${pid} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  deps.log(`${name}: stop all ends it, SIGTERM to ${hostState === 'same' ? 'the host' : `its engine pid ${child!.pid} (the host is gone)`}`);
  signal(hostState === 'same' ? host.pid : child!.pid, 'SIGTERM');
  const graceMs = deps.graceMs ?? HOST_EXIT_GRACE_MS + HELD_STOP_MARGIN_MS;
  // polled with isAlive alone (no `ps` per poll on the event loop); the start time is read again after the grace
  const running = () => deps.isAlive(host.pid) || [child, current()?.child ?? null].some((c) => c !== null && deps.isAlive(c.pid));
  for (let waited = 0; waited < graceMs && running(); waited += POLL_MS) await deps.sleep(Math.min(POLL_MS, graceMs - waited));
  const left = childNow();
  const leftState = check(left);
  if (leftState === 'unverifiable') {
    deps.log(`${name}: its engine pid ${left!.pid} lives past ${graceMs} ms and its start time cannot be read; not killed`);
    return 'unverified';
  }
  if (leftState === 'same') {
    deps.log(`${name}: its engine pid ${left!.pid} still running after ${graceMs} ms: SIGKILL`);
    signal(left!.pid, 'SIGKILL');
    return 'forced';
  }
  if (left === null && hostState === 'same' && check(host) !== 'gone') {
    deps.log(`${name}: the host still waits for its spawn after ${graceMs} ms, no child known; its stop is not done`);
    return 'incomplete';
  }
  return engine ? 'stopped' : 'gone';
}
