// The start's adoptions (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D10): every live
// session host the roster names, adopted in parallel through the launcher's `adopt(entry)`, each bounded by its own
// ADOPT_MS. A host of another protocol major is not adopted: logged, counted as failed and left running with its child
// (that major's migration owns the rest). Two live hosts naming one session (a launch's host left behind by a crash, and
// its successor's) cannot both be its row: the newest is adopted and the other left running, counted.
// P5 O16 panel fix wave 1 (sweep#3): a host's roster entry reads `committed` from before its fork until the child is
// recorded, and the fork goes on whether or not the engine host that committed it lives; such an entry holds an engine,
// or is about to, so it is held and adopted as one, never released as empty. An adoption is counted by its outcome, not
// by what the entry said at the start: one that ends in the host's accepted release (`null`) is no failure, and every
// other end that adopts nothing is counted, so no host is left running unaccounted.
// Ticket 851, M1 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, R4-1 and R4-2; Decision Logs 8 and 9): an entry
// marked `prestart` is a prestart whose promotion was never acknowledged. Its session is held at the start (a launch of it
// is refused until its end is decided). Its host is asked to discard it (transport.ts `discardHost`), which the host
// decides atomically against a promotion in flight: discarded, that launch's staged files (its journal and host map,
// base and rotations) are removed, then its entry, which the host kept for that; promoted meanwhile, it is adopted as
// any host. A discard that fails is a failed adoption, its host then guarded as unattached.
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import { HOST_EXIT_GRACE_MS, SESSION_HOST_PROTOCOL } from './protocol';
import { readRoster, removeHostFiles, type RosterEntry } from './roster';
import type { ProcessTable } from '../process-table'; // P5 O16 wave 1 verification
import type { HeldStopOutcome, ProcStartKey } from './stop-held'; // P5 O16 wave 1 verification; re-verification: ProcStartKey

// Whether the entry's host holds an engine, or is forking one, for a session: what the start holds a row for.
export function holdsEngine(entry: RosterEntry): boolean {
  return entry.appSessionId !== null && (entry.child !== null || entry.state === 'committed');
}

export interface AdoptionOutcome {
  adopted: AppSessionId[];
  failed: { entry: RosterEntry; reason: string }[];
  ended: RosterEntry[]; // ticket 851: the prestarts never promoted, discarded rather than adopted
}

// The entries an adoption takes, the prestarts it ends, and the rest with the reason they are left: the rows
// `holdForAdoption` holds are the taken ones that name a session.
export function adoptable(entries: readonly RosterEntry[]): { take: RosterEntry[]; leave: AdoptionOutcome['failed']; end: RosterEntry[] } {
  const leave: AdoptionOutcome['failed'] = [];
  const newest = new Map<string, RosterEntry>();
  const take: RosterEntry[] = [];
  const end: RosterEntry[] = [];
  for (const entry of entries) {
    if (entry.protocol !== SESSION_HOST_PROTOCOL) {
      leave.push({ entry, reason: `it speaks session host protocol ${entry.protocol}, not ${SESSION_HOST_PROTOCOL}; left running` });
      continue;
    }
    if (entry.prestart === true) {
      end.push(entry);
      continue;
    }
    if (!holdsEngine(entry) || entry.appSessionId === null) {
      take.push(entry); // holds no engine: the adoption releases it
      continue;
    }
    const other = newest.get(entry.appSessionId);
    if (other === undefined || other.startedAt < entry.startedAt) {
      if (other !== undefined) leave.push({ entry: other, reason: `a newer session host (${entry.holderId}) holds its session; left running` });
      newest.set(entry.appSessionId, entry);
    } else leave.push({ entry, reason: `a newer session host (${other.holderId}) holds its session; left running` });
  }
  return { take: [...take, ...newest.values()], leave, end };
}

// `adopt` answers the session adopted, or null for a host that held no engine and accepted its release; `end` ends a
// prestart never promoted (endPrestart), answering `promoted` for one its host found promoted, which is then adopted. An
// end that throws is a failed adoption, counted, and its host guarded (recordFailed).
export async function adoptAll(
  entries: readonly RosterEntry[],
  deps: { adopt(entry: RosterEntry): Promise<AppSessionId | null>; end(entry: RosterEntry): Promise<'ended' | 'promoted'>; log(line: string): void },
): Promise<AdoptionOutcome> {
  const { take, leave, end } = adoptable(entries);
  for (const { entry, reason } of leave) deps.log(`session host ${entry.holderId} (pid ${entry.pid}) not adopted: ${reason}`);
  const outcome: AdoptionOutcome = { adopted: [], failed: [...leave], ended: [] };
  const counted = async (entry: RosterEntry, step: () => Promise<void>) => {
    try {
      await step();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      deps.log(`session host ${entry.holderId} (pid ${entry.pid}) not adopted: ${reason}`);
      outcome.failed.push({ entry, reason });
    }
  };
  const adoptOne = async (entry: RosterEntry) => {
    const adopted = await deps.adopt(entry);
    if (adopted !== null) outcome.adopted.push(adopted); // null: released, nothing was there to adopt
  };
  await Promise.all([
    ...end.map((entry) => counted(entry, async () => {
      if ((await deps.end(entry)) === 'ended') outcome.ended.push(entry);
      else await adoptOne({ ...entry, prestart: false }); // promoted meanwhile: an ordinary host
    })),
    ...take.map((entry) => counted(entry, () => adoptOne(entry))),
  ]);
  return outcome;
}

export interface PrestartFiles {
  stagedDir(entry: RosterEntry): string | null; // its session's journal directory; null for an entry that names none
  removeEntry(entry: RosterEntry): void; // its roster entry, token and socket (roster.ts `removeHostFiles`)
  log(line: string): void;
}

// The launch's staged files removed, or null when one could not be (logged: the entry then stays for the next start).
function removeStaged(entry: RosterEntry, deps: PrestartFiles): number | null {
  try {
    const dir = deps.stagedDir(entry);
    return dir === null ? 0 : removeStagedFiles(dir, entry.holderId);
  } catch (error) {
    deps.log(`session host ${entry.holderId} (pid ${entry.pid}) held a prestart never promoted: its staged files could not all be removed (${error instanceof Error ? error.message : String(error)}); its entry stays for the next start`);
    return null;
  }
}

function removeEntry(entry: RosterEntry, deps: PrestartFiles): boolean {
  try {
    deps.removeEntry(entry);
    return true;
  } catch (error) {
    deps.log(`session host ${entry.holderId} (pid ${entry.pid}): its files could not be removed (${error instanceof Error ? error.message : String(error)})`);
    return false;
  }
}

// Ticket 851, M1: a live prestart never promoted, discarded by its host (`discard`, transport.ts `discardHost`); then
// its launch's staged files removed, then its entry once its host has exited. Answers `promoted` for one its host found
// promoted meanwhile, and removes nothing of it. Throws only when the discard does.
export async function endPrestart(entry: RosterEntry, deps: PrestartFiles & { discard(entry: RosterEntry): Promise<'discarded' | 'discarding' | 'promoted'> }): Promise<'ended' | 'promoted'> {
  const answer = await deps.discard(entry);
  const name = `session host ${entry.holderId} (pid ${entry.pid})`;
  if (answer === 'promoted') {
    deps.log(`${name} was marked prestart and its host says it was promoted: adopted as any host`);
    return 'promoted';
  }
  const removed = removeStaged(entry, deps);
  if (removed === null) return 'ended';
  const entryGone = answer === 'discarded' && removeEntry(entry, deps);
  deps.log(`${name} holds a prestart never promoted: discarded, ${removed} staged file(s) removed, ${entryGone ? 'its entry removed' : 'its entry kept until its host has exited'}`);
  return 'ended';
}

// A dead host's files at the start, never throwing: a marked one's staged files first, and its entry only once they
// are gone (the entry is the only record naming them), else kept for the next start.
export function clearDeadHost(entry: RosterEntry, deps: PrestartFiles): void {
  if (entry.prestart === true) {
    const removed = removeStaged(entry, deps);
    if (removed === null) return;
    deps.log(`session host ${entry.holderId} held a prestart never promoted: ${removed} staged file(s) removed`);
  }
  removeEntry(entry, deps);
}

// Ticket 851, M2: the end of a prestart this engine host ended itself (prestart-host.ts), its staged files already removed:
// the session host keeps its marked entry at its exit, so once the host has exited (within `exitMs`, its ladder's bound)
// the entry goes too, while it still says `prestart`; a host still running keeps it for the next start's discard.
export async function clearEndedPrestart(hostsDir: string, host: { holderId: string; pid: number }, deps: { isAlive(pid: number): boolean; exitMs?: number }): Promise<'removed' | 'kept'> {
  const until = Date.now() + (deps.exitMs ?? 2 * HOST_EXIT_GRACE_MS + 2_000);
  while (deps.isAlive(host.pid) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
  if (deps.isAlive(host.pid)) return 'kept';
  const entry = readRoster(hostsDir, () => {}).find((candidate) => candidate.holderId === host.holderId);
  if (entry?.prestart !== true) return 'kept';
  removeHostFiles(hostsDir, entry);
  return 'removed';
}

const STAGED_FILE = /^([A-Za-z0-9_-]+?)(?:\.\d+)?\.(?:jsonl|hseq)$/;

// The launch's journal files and host map files in a session's journal directory, base and rotations
// (`<launchId>.jsonl`, `<launchId>.<n>.jsonl`, `<launchId>.hseq`, `<launchId>.<n>.hseq`; journal.ts, checkpoint.ts),
// removed; nothing else. Answers how many went; a directory that does not exist has none.
export function removeStagedFiles(dir: string, launchId: string): number {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (STAGED_FILE.exec(name)?.[1] !== launchId) continue;
    rmSync(join(dir, name), { force: true });
    removed += 1;
  }
  return removed;
}

// The start's records in the process table (index.ts `adoptAtStart`). `recordStart` runs synchronously in `listening`,
// before any client is served: a hold for each host the start adopts, a stop-all's stop beside it. `recordFailed` runs
// once the adoptions have ended: each failed host still running its engine under this major with no row of its own is
// unattached (D59(6)); one `recordStart` unattached already (D59(10)) is not recorded twice; a host of another major is
// that major's.
export type StartTable = Pick<ProcessTable, 'holdForAdoption' | 'unattach' | 'get'>;

// How a host the start holds or leaves is stopped, and its engine as the roster names it now (stop-held.ts `stopHeldHost`,
// `heldChild`; wave 1 re-verification: an unattached record guards its engine too)
export interface HeldHosts {
  stop(entry: RosterEntry): Promise<HeldStopOutcome>;
  child(entry: RosterEntry): ProcStartKey | null;
}

// ticket 851: a marked host naming a session is guarded with no child known too, since a commit may be in flight to it
const unattachable = (entry: RosterEntry): boolean => (holdsEngine(entry) || (entry.prestart === true && entry.appSessionId !== null)) && entry.protocol === SESSION_HOST_PROTOCOL;

function unattachEntry(table: StartTable, entry: RosterEntry, held: HeldHosts): void {
  table.unattach(entry.appSessionId as AppSessionId, { holderId: entry.holderId, host: { pid: entry.pid, procStart: entry.procStart }, child: () => held.child(entry), stop: () => held.stop(entry) });
}

// Wave 1 verification: a host left to a newer host of its session (D59(10)) is known from the roster alone, so it is
// unattached here, before any adoption runs; a stop-all during the adoptions then stops it beside the holds.
export function recordStart(table: StartTable, live: readonly RosterEntry[], held: HeldHosts): AppSessionId[] {
  const { take, leave, end } = adoptable(live);
  const holding = new Map(take.filter(holdsEngine).map((entry) => [entry.appSessionId as AppSessionId, entry]));
  // ticket 851: a prestart's session is held until its discard is decided, a commit in flight to it too; beside an
  // ordinary host of its session, which takes the hold, it is guarded as unattached
  for (const entry of end) {
    if (entry.appSessionId === null) continue;
    if (holding.has(entry.appSessionId as AppSessionId)) unattachEntry(table, entry, held);
    else holding.set(entry.appSessionId as AppSessionId, entry);
  }
  table.holdForAdoption([...holding.keys()], (id) => held.stop(holding.get(id)!));
  for (const { entry } of leave) if (unattachable(entry)) unattachEntry(table, entry, held);
  return [...holding.keys()];
}

export function recordFailed(table: StartTable, failed: AdoptionOutcome['failed'], held: HeldHosts): void {
  for (const { entry } of failed) {
    if (!unattachable(entry)) continue;
    if (table.get(entry.appSessionId as AppSessionId)?.status().holder?.holderId === entry.holderId) continue; // its row's
    unattachEntry(table, entry, held);
  }
}
