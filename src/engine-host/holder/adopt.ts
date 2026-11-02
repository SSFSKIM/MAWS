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
import type { AppSessionId } from '@shared/graph/ids';
import { SESSION_HOST_PROTOCOL } from './protocol';
import type { RosterEntry } from './roster';
import type { ProcessTable } from '../process-table'; // P5 O16 wave 1 verification
import type { HeldStopOutcome, ProcStartKey } from './stop-held'; // P5 O16 wave 1 verification; re-verification: ProcStartKey

// Whether the entry's host holds an engine, or is forking one, for a session: what the start holds a row for.
export function holdsEngine(entry: RosterEntry): boolean {
  return entry.appSessionId !== null && (entry.child !== null || entry.state === 'committed');
}

export interface AdoptionOutcome {
  adopted: AppSessionId[];
  failed: { entry: RosterEntry; reason: string }[];
}

// The entries an adoption takes, and the rest with the reason they are left: the rows `holdForAdoption` holds are the
// taken ones that name a session.
export function adoptable(entries: readonly RosterEntry[]): { take: RosterEntry[]; leave: AdoptionOutcome['failed'] } {
  const leave: AdoptionOutcome['failed'] = [];
  const newest = new Map<string, RosterEntry>();
  const take: RosterEntry[] = [];
  for (const entry of entries) {
    if (entry.protocol !== SESSION_HOST_PROTOCOL) {
      leave.push({ entry, reason: `it speaks session host protocol ${entry.protocol}, not ${SESSION_HOST_PROTOCOL}; left running` });
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
  return { take: [...take, ...newest.values()], leave };
}

// `adopt` answers the session adopted, or null for a host that held no engine and accepted its release.
export async function adoptAll(entries: readonly RosterEntry[], deps: { adopt(entry: RosterEntry): Promise<AppSessionId | null>; log(line: string): void }): Promise<AdoptionOutcome> {
  const { take, leave } = adoptable(entries);
  for (const { entry, reason } of leave) deps.log(`session host ${entry.holderId} (pid ${entry.pid}) not adopted: ${reason}`);
  const outcome: AdoptionOutcome = { adopted: [], failed: [...leave] };
  await Promise.all(take.map(async (entry) => {
    try {
      const adopted = await deps.adopt(entry);
      if (adopted !== null) outcome.adopted.push(adopted); // null: released, nothing was there to adopt
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      deps.log(`session host ${entry.holderId} (pid ${entry.pid}) not adopted: ${reason}`);
      outcome.failed.push({ entry, reason });
    }
  }));
  return outcome;
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

const unattachable = (entry: RosterEntry): boolean => holdsEngine(entry) && entry.protocol === SESSION_HOST_PROTOCOL;

function unattachEntry(table: StartTable, entry: RosterEntry, held: HeldHosts): void {
  table.unattach(entry.appSessionId as AppSessionId, { holderId: entry.holderId, host: { pid: entry.pid, procStart: entry.procStart }, child: () => held.child(entry), stop: () => held.stop(entry) });
}

// Wave 1 verification: a host left to a newer host of its session (D59(10)) is known from the roster alone, so it is
// unattached here, before any adoption runs; a stop-all during the adoptions then stops it beside the holds.
export function recordStart(table: StartTable, live: readonly RosterEntry[], held: HeldHosts): AppSessionId[] {
  const { take, leave } = adoptable(live);
  const holding = new Map(take.filter(holdsEngine).map((entry) => [entry.appSessionId as AppSessionId, entry]));
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
