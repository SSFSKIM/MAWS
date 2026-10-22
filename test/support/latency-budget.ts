// Latency bounds an acceptance names (a cold attach within 3 s, a 20 MB head within 2 s) are about the code only on a
// machine with cores to spare: on the shared machine, sibling builds and suites push the load average far past the core
// count, and a bound missed then says little about MAWS. So a bound is asserted as named only when the one-minute load
// average, read when the test starts, is under QUIET_LOAD_PER_CORE per core; on a loaded machine the number is recorded
// and only a loose ceiling (LOADED_CEILING times the bound) is asserted, which still catches a real regression. The e2e
// suites read it through `e2e/support/latency.ts`.
// A job on one of ci-kit's shared Mac runner instances (CI_KIT_SHARED_DESKTOP=1 in its environment; ci-kit's mac-lane
// concurrency spec, M2) counts as loaded whatever the load reads when it starts: the job beside it may start its build or
// its flood at any moment after that read. So does a job in ci-kit's macOS guest (CI_KIT_VM_GUEST=1, set in the guest's
// runner environment alone; the spec's VM lane, V3), which runs at 1.3-1.7x the host's time whatever its own load reads.
// A host runner's CI_KIT_VM_RESERVATION names the lane's vm-reserved file, present from before clone until after delete.
// At the verdict, a reservation still present or a sibling vm-released epoch second >= floor(test start / 1000) means
// a guest was beside the test. ci-kit writes vm-released before removing the reservation. Merely installing the lane
// does not loosen a bound; read errors other than not-found and malformed release stamps do. Only a missing release
// means none seen: ci-kit writes the stamp atomically, so malformed contents mean something went wrong.
import { readFileSync, statSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';

export const QUIET_LOAD_PER_CORE = 1;
export const LOADED_CEILING = 5;

export interface MachineLoad {
  load: number; // the one-minute load average
  cores: number;
  shared?: boolean; // on a desktop ci-kit shares with another job
  guest?: boolean; // in ci-kit's macOS guest
}

export const machineLoad = (env: Record<string, string | undefined> = process.env): MachineLoad => ({
  load: loadavg()[0],
  cores: cpus().length,
  shared: env.CI_KIT_SHARED_DESKTOP === '1',
  guest: env.CI_KIT_VM_GUEST === '1',
});

function guestBeside(started: number, reservation: string | undefined): string | null {
  if (!reservation) return null;
  // Read the reservation first, then the release stamp: a release between these reads cannot be missed, because
  // ci-kit writes the stamp before removing the reservation. Reversing the reads could miss both.
  try {
    statSync(reservation);
    return 'beside a guest reserved now';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'guest reservation unreadable (assumed loaded)';
  }
  try {
    const released = readFileSync(join(dirname(reservation), 'vm-released'), 'utf8');
    const epoch = Number(released);
    if (/^\d+\n?$/.exec(released)?.[0] !== released || !Number.isSafeInteger(epoch)) return 'guest release malformed (assumed loaded)';
    return epoch >= Math.floor(started / 1000) ? 'beside a guest released since the test started' : null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'guest release unreadable (assumed loaded)';
  }
}

// The ceiling to assert, and why it is not the bound itself (null when it is).
export interface BudgetVerdict {
  ceiling: number;
  reason: string | null;
}

// Where a bound is loosened, the machine that makes it so ("at load 74.3 on 10 cores"); null where it holds as named.
export function loosenedOn(machine: MachineLoad, beside: string | null = null): string | null {
  if (!machine.shared && !machine.guest && beside === null && machine.load < machine.cores * QUIET_LOAD_PER_CORE) return null;
  const load = Math.round(machine.load * 10) / 10;
  return `${machine.shared ? 'on a shared desktop (CI_KIT_SHARED_DESKTOP=1), ' : ''}${machine.guest ? 'in a VM guest (CI_KIT_VM_GUEST=1), ' : ''}${beside === null ? '' : `${beside}, `}at load ${load} on ${machine.cores} cores`;
}

export function budgetVerdict(label: string, ms: number, budget: number, machine: MachineLoad, started: number = Date.now(), env: Record<string, string | undefined> = process.env): BudgetVerdict {
  const where = loosenedOn(machine, guestBeside(started, env.CI_KIT_VM_RESERVATION));
  if (where === null) return { ceiling: budget, reason: null };
  const ceiling = budget * LOADED_CEILING;
  return { ceiling, reason: `${label}: ${ms} ms against ${budget} ms, held to ${ceiling} ms ${where}` };
}
