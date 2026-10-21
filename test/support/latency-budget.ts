// Latency bounds an acceptance names (a cold attach within 3 s, a 20 MB head within 2 s) are about the code only on a
// machine with cores to spare: on the shared machine, sibling builds and suites push the load average far past the core
// count, and a bound missed then says little about MAWS. So a bound is asserted as named only when the one-minute load
// average, read when the test starts, is under QUIET_LOAD_PER_CORE per core; on a loaded machine the number is recorded
// and only a loose ceiling (LOADED_CEILING times the bound) is asserted, which still catches a real regression. The e2e
// suites read it through `e2e/support/latency.ts`.
// A job on one of ci-kit's shared Mac runner instances (CI_KIT_SHARED_DESKTOP=1 in its environment; ci-kit's mac-lane
// concurrency spec, M2) counts as loaded whatever the load reads when it starts: the job beside it may start its build or
// its flood at any moment after that read.
import { cpus, loadavg } from 'node:os';

export const QUIET_LOAD_PER_CORE = 1;
export const LOADED_CEILING = 5;

export interface MachineLoad {
  load: number; // the one-minute load average
  cores: number;
  shared?: boolean; // on a desktop ci-kit shares with another job
}

export const machineLoad = (env: Record<string, string | undefined> = process.env): MachineLoad => ({ load: loadavg()[0], cores: cpus().length, shared: env.CI_KIT_SHARED_DESKTOP === '1' });

// The ceiling to assert, and why it is not the bound itself (null when it is).
export interface BudgetVerdict {
  ceiling: number;
  reason: string | null;
}

// Where a bound is loosened, the machine that makes it so ("at load 74.3 on 10 cores"); null where it holds as named.
export function loosenedOn(machine: MachineLoad): string | null {
  if (!machine.shared && machine.load < machine.cores * QUIET_LOAD_PER_CORE) return null;
  const load = Math.round(machine.load * 10) / 10;
  return `${machine.shared ? 'on a shared desktop (CI_KIT_SHARED_DESKTOP=1), ' : ''}at load ${load} on ${machine.cores} cores`;
}

export function budgetVerdict(label: string, ms: number, budget: number, machine: MachineLoad): BudgetVerdict {
  const where = loosenedOn(machine);
  if (where === null) return { ceiling: budget, reason: null };
  const ceiling = budget * LOADED_CEILING;
  return { ceiling, reason: `${label}: ${ms} ms against ${budget} ms, held to ${ceiling} ms ${where}` };
}
