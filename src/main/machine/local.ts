// The local machine's ref in main (P5 O6 M2, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md; OX2), bound
// once at startup from the identity M1 reads or mints, before the router answers or any window opens. The router treats a
// command with no machine as this one's, `emit` stamps every event with it, and every app window gets it in its arguments.
import type { MachineRef } from '@shared/machine/ref';

let local: MachineRef | null = null;

export function bindLocalMachine(ref: MachineRef): void {
  if (local !== null && local !== ref) throw new Error(`the local machine is already ${local}`);
  local = ref;
}

// Throws before startup bound it: a window or a route with no local machine is main's programming error.
export function localMachine(): MachineRef {
  if (local === null) throw new Error('the local machine is not bound yet');
  return local;
}

// For the event senders, which run in tests that start no identity: an event with no machine is read as local.
export const boundLocalMachine = (): MachineRef | null => local;
