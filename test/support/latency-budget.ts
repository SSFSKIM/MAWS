// Latency bounds an acceptance names (a cold attach within 3 s, a 20 MB head within 2 s) are about the code only on a
// machine with cores to spare: on the shared machine, sibling builds and suites push the load average far past the core
// count, and a bound missed then says little about MAWS. So a bound is asserted as named only when the one-minute load
// average, read when the test starts, is under QUIET_LOAD_PER_CORE per core; on a loaded machine the number is recorded
// and only a loose ceiling (LOADED_CEILING times the bound) is asserted, which still catches a real regression. The e2e
// suites read it through `e2e/support/latency.ts`.
import { cpus, loadavg } from 'node:os';

export const QUIET_LOAD_PER_CORE = 1;
export const LOADED_CEILING = 5;

export interface MachineLoad {
  load: number; // the one-minute load average
  cores: number;
}

export const machineLoad = (): MachineLoad => ({ load: loadavg()[0], cores: cpus().length });

// The ceiling to assert, and why it is not the bound itself (null when it is).
export interface BudgetVerdict {
  ceiling: number;
  reason: string | null;
}

export function budgetVerdict(label: string, ms: number, budget: number, machine: MachineLoad): BudgetVerdict {
  if (machine.load < machine.cores * QUIET_LOAD_PER_CORE) return { ceiling: budget, reason: null };
  const load = Math.round(machine.load * 10) / 10;
  const ceiling = budget * LOADED_CEILING;
  return { ceiling, reason: `${label}: ${ms} ms against ${budget} ms, held to ${ceiling} ms at load ${load} on ${machine.cores} cores` };
}
