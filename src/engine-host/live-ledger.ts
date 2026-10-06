// The orphan ledger (E10 execution document, §Design 1 "The orphan ledger and sweep"): `<supervisorDir>/live.json`
// names the supervisor that wrote it and every engine process it holds live, so a successor that finds the owner dead
// can stop the engines nobody can reach any more. The process table rewrites it at every launch and exit; the exit
// order clears it only when this supervisor still owns it, so a successor's ledger is never touched.
//
// The sweep is load-bearing (M0 Q1): an engine whose supervisor died does not exit on stdin EOF but finishes its turn,
// so it runs on, unreachable, holding a model turn and memory, and its registry row reads foreign-live meanwhile. SIGTERM
// comes first so the engine shuts its own tools down (its Bash tool runs in a process group of its own, which no signal
// to the engine's group reaches); past the grace, SIGKILL goes to the engine's group, as the transport's ladder does.
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod';
import { isSameProcess, SUPERVISOR_FILES } from './supervisor-files';

export interface Owner {
  pid: number;
  procStart: string;
}

export interface LiveRow {
  appSessionId: string;
  pid: number;
  procStart: string; // '' when it could not be read at the launch; such a row is never signalled
  launchId: string;
}

const OwnerSchema = z.object({ pid: z.number().int(), procStart: z.string() });
const LedgerSchema = z.object({
  owner: OwnerSchema,
  rows: z.array(z.object({ appSessionId: z.string(), pid: z.number().int(), procStart: z.string(), launchId: z.string() })),
});

export type Ledger = z.infer<typeof LedgerSchema>;

const ledgerPath = (dir: string) => join(dir, SUPERVISOR_FILES.live);

export function writeLive(dir: string, owner: Owner, rows: readonly LiveRow[]): void {
  const path = ledgerPath(dir);
  const temporary = `${path}.${owner.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ owner, rows: [...rows] } satisfies Ledger), { mode: 0o600 });
  renameSync(temporary, path);
}

function readLedger(dir: string): Ledger | 'absent' | 'unreadable' {
  let raw: string;
  try {
    raw = readFileSync(ledgerPath(dir), 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable';
  }
  try {
    const parsed = LedgerSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

// The ledger, or null when it is absent or unreadable.
export function readLive(dir: string): Ledger | null {
  const ledger = readLedger(dir);
  return typeof ledger === 'string' ? null : ledger;
}

// The exit order's step 3: a no-op unless the ledger's owner is `owner` (pid and start time).
export function clearLive(dir: string, owner: Owner): void {
  const ledger = readLive(dir);
  if (!ledger || ledger.owner.pid !== owner.pid || ledger.owner.procStart !== owner.procStart) return;
  try {
    unlinkSync(ledgerPath(dir));
  } catch {
    // already gone
  }
}

export const SWEEP_GRACE_MS = 5_000; // between an orphan's SIGTERM and its SIGKILL
const SWEEP_POLL_MS = 200;

export interface SweepDeps {
  isAlive(pid: number): boolean;
  procStartOf(pid: number): string | null;
  signal(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void; // signalOrphan in production
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  graceMs?: number; // SWEEP_GRACE_MS
}

// SIGTERM to the engine itself (its own shutdown stops its tools); SIGKILL to its process group (an engine is spawned
// `detached: true`, so it leads one), or to the pid alone if it leads none. A process already gone is not an error.
export function signalOrphan(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
  const send = (target: number) => {
    try {
      process.kill(target, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  };
  if (signal === 'SIGKILL' && send(-pid)) return;
  send(pid);
}

// Read once, at the call (synchronously, before the first await, so the caller can start writing its own ledger right
// after without racing this read): when the ledger's owner is dead, or its pid is another process now, every row whose
// pid is still the recorded engine (its start time recorded and unchanged) gets SIGTERM; those still the same process
// after the grace get SIGKILL. Answers how many orphans were stopped. Skipped (0) when there is no ledger, when it is
// unreadable (with a log line), and when its owner is alive: that supervisor's engines are its own.
export function sweepOrphans(dir: string, deps: SweepDeps): Promise<number> {
  const ledger = readLedger(dir);
  if (ledger === 'absent') return Promise.resolve(0);
  if (ledger === 'unreadable') {
    deps.log(`orphan sweep skipped: ${SUPERVISOR_FILES.live} is unreadable`);
    return Promise.resolve(0);
  }
  if (isSameProcess(ledger.owner, deps)) {
    deps.log(`orphan sweep skipped: the ledger's owner (pid ${ledger.owner.pid}) is alive, so its engines are its own`);
    return Promise.resolve(0);
  }
  return stopOrphans(ledger, deps);
}

async function stopOrphans(ledger: Ledger, deps: SweepDeps): Promise<number> {
  // strict where isSameProcess is lenient: a start time that cannot be compared never gets a process signalled
  const isOrphan = (row: LiveRow) => row.procStart !== '' && deps.isAlive(row.pid) && deps.procStartOf(row.pid) === row.procStart;
  const signal = (row: LiveRow, name: 'SIGTERM' | 'SIGKILL'): boolean => {
    try {
      deps.signal(row.pid, name);
      return true;
    } catch (error) {
      deps.log(`orphan ${row.appSessionId} (pid ${row.pid}): ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };
  const orphans = ledger.rows.filter(isOrphan).filter((row) => {
    deps.log(`orphan ${row.appSessionId} (pid ${row.pid}, launch ${row.launchId}) of the dead supervisor pid ${ledger.owner.pid}: SIGTERM`);
    return signal(row, 'SIGTERM');
  });
  const graceMs = deps.graceMs ?? SWEEP_GRACE_MS;
  let remaining = orphans;
  for (let waited = 0; remaining.length > 0 && waited < graceMs; waited += SWEEP_POLL_MS) {
    await deps.sleep(Math.min(SWEEP_POLL_MS, graceMs - waited));
    remaining = remaining.filter(isOrphan);
  }
  for (const row of remaining) {
    deps.log(`orphan ${row.appSessionId} (pid ${row.pid}) still running after ${graceMs} ms: SIGKILL`);
    signal(row, 'SIGKILL');
  }
  if (orphans.length > 0) deps.log(`orphan sweep: ${orphans.length} engine(s) of the dead supervisor pid ${ledger.owner.pid} stopped`);
  return orphans.length;
}
