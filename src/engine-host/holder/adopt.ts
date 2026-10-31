// The start's adoptions (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D10): every live
// session host the roster names, adopted in parallel through the launcher's `adopt(entry)`, each bounded by its own
// ADOPT_MS. A host of another protocol major is not adopted: logged, counted as failed and left running with its child
// (that major's migration owns the rest). Two live hosts naming one session (a launch's host left behind by a crash, and
// its successor's) cannot both be its row: the newest is adopted and the other left running, counted.
import type { AppSessionId } from '@shared/graph/ids';
import { SESSION_HOST_PROTOCOL } from './protocol';
import type { RosterEntry } from './roster';

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
    if (entry.appSessionId === null || entry.child === null) {
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

export async function adoptAll(entries: readonly RosterEntry[], deps: { adopt(entry: RosterEntry): Promise<AppSessionId>; log(line: string): void }): Promise<AdoptionOutcome> {
  const { take, leave } = adoptable(entries);
  for (const { entry, reason } of leave) deps.log(`session host ${entry.holderId} (pid ${entry.pid}) not adopted: ${reason}`);
  const outcome: AdoptionOutcome = { adopted: [], failed: [...leave] };
  await Promise.all(take.map(async (entry) => {
    try {
      outcome.adopted.push(await deps.adopt(entry));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      deps.log(`session host ${entry.holderId} (pid ${entry.pid}) not adopted: ${reason}`);
      // a host released for holding no engine is no failure: nothing was there to adopt
      if (entry.appSessionId !== null && entry.child !== null) outcome.failed.push({ entry, reason });
    }
  }));
  return outcome;
}
