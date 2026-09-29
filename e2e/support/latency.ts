// An acceptance's latency bound in an end-to-end case (`test/support/latency-budget.ts` says when one is asserted). Call
// `latencyBudgets()` when the test starts, so the load it reads is the machine the case ran on; each bound then records
// its number as an annotation and is asserted, or, on a loaded machine, annotated as not asserted.
import { expect, test } from '@playwright/test';
import { budgetVerdict, machineLoad, type MachineLoad } from '../../test/support/latency-budget';

// How long a case waits for the state whose latency it then measures: long enough that a loaded machine reaches the
// measurement, so the bound, not the wait, is what can fail.
export const MEASURED_WAIT_MS = 30_000;

export function latencyBudgets(machine: MachineLoad = machineLoad()): (label: string, ms: number, budget: number, message: string) => void {
  return (label, ms, budget, message) => {
    const info = test.info();
    info.annotations.push({ type: label, description: `${ms} ms` });
    const verdict = budgetVerdict(label, ms, budget, machine);
    if (verdict.assert) expect(ms, message).toBeLessThanOrEqual(budget);
    else info.annotations.push({ type: 'latency bound not asserted', description: verdict.reason });
  };
}
