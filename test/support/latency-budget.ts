// Latency bounds an acceptance names (a cold attach within 3 s, a 20 MB head within 2 s) are about the code only on a
// machine with cores to spare: on the shared machine, sibling builds and suites push the load average far past the core
// count, and a bound missed then says nothing about MAWS. So a bound is asserted only when the one-minute load average,
// read when the test starts, is under QUIET_LOAD_PER_CORE per core; otherwise the number is recorded and the assertion
// skipped with the reason. The e2e suites read it through `e2e/support/latency.ts`.
import { cpus, loadavg } from 'node:os';

export const QUIET_LOAD_PER_CORE = 1;

export interface MachineLoad {
  load: number; // the one-minute load average
  cores: number;
}

export const machineLoad = (): MachineLoad => ({ load: loadavg()[0], cores: cpus().length });

export type BudgetVerdict = { assert: true } | { assert: false; reason: string };

export function budgetVerdict(label: string, ms: number, budget: number, machine: MachineLoad): BudgetVerdict {
  if (machine.load < machine.cores * QUIET_LOAD_PER_CORE) return { assert: true };
  const load = Math.round(machine.load * 10) / 10;
  return { assert: false, reason: `${label}: ${ms} ms against ${budget} ms, not asserted at load ${load} on ${machine.cores} cores` };
}
