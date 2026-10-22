// An acceptance's latency bound in an end-to-end case (`test/support/latency-budget.ts` says which ceiling holds). Call
// `latencyBudgets()` when the test starts, so the load it reads is the machine the case ran on; each bound then records
// its number as an annotation and is asserted, or, on a loaded machine, held to the loose ceiling with the reason
// annotated and printed, so the list reporter shows it. Guest reservations are read at each verdict over [start, now].
import { expect, test } from '@playwright/test';
import { budgetVerdict, LOADED_CEILING, loosenedOn, machineLoad, type MachineLoad } from '../../test/support/latency-budget';

// How long a case waits for the state whose latency it then measures: long enough that a loaded machine reaches the
// measurement, so the bound, not the wait, is what can fail.
export const MEASURED_WAIT_MS = 30_000;

export function latencyBudgets(machine: MachineLoad = machineLoad(), started: number = Date.now()): (label: string, ms: number, budget: number, message: string) => void {
  return (label, ms, budget, message) => {
    const info = test.info();
    info.annotations.push({ type: label, description: `${ms} ms` });
    const { ceiling, reason } = budgetVerdict(label, ms, budget, machine, started);
    if (reason !== null) {
      info.annotations.push({ type: 'latency bound loosened under load', description: reason });
      console.log(`[latency] ${reason}`);
    }
    expect(ms, message).toBeLessThanOrEqual(ceiling);
  };
}

// Call when the test starts, as latencyBudgets. Without a VM lane, the wait's own timeout is the bound (so polling adds
// no post-wait assertion). With a configured lane, wait to the ceiling, then call assertElapsed: only a guest actually
// beside the test, or the original load/shared/guest snapshot, loosens its bound. Configuration alone never does.
export function latencyWait(label: string, budget: number, machine: MachineLoad = machineLoad()): { timeout: number; assertElapsed?: (ms: number) => void } {
  const ceiling = budget * LOADED_CEILING;
  if (process.env.CI_KIT_VM_RESERVATION) {
    const assertBudget = latencyBudgets(machine);
    return { timeout: ceiling, assertElapsed: (ms) => assertBudget(label, ms, budget, label) };
  }
  const where = loosenedOn(machine);
  if (where === null) return { timeout: budget };
  const reason = `${label}: waited up to ${ceiling} ms for ${budget} ms ${where}`;
  test.info().annotations.push({ type: 'latency bound loosened under load', description: reason });
  console.log(`[latency] ${reason}`);
  return { timeout: ceiling };
}
