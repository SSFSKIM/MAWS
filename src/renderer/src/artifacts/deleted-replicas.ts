// UX wave U10b (M5; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.5): the replicas that wait while an
// agent's delete stands (./host.ts parks a synced replica whose reopen the host refuses because an agent deleted the
// artifact, until it is restored), and how many edits each holds that the host never acknowledged. The editor's notice
// reads it: "Your last edit is not saved" while any replica of the artifact holds one (its hook is in
// ../library/undo-delete.ts, so this module, which host.ts imports, stays free of React for the node project).

import type { MachineRef } from '@shared/machine/ref';

const held = new Map<object, { artifactId: string; machine: MachineRef; unsent: number }>();
const listeners = new Set<() => void>();

const changed = () => {
  for (const listener of [...listeners]) listener();
};

/** A replica of `artifactId` waits for the artifact's restore holding `unsent` unacknowledged edits; null: it no longer waits. */
export function noteDeletedReplica(replica: object, artifactId: string, machine: MachineRef, unsent: number | null): void {
  const was = held.get(replica);
  if (unsent === null) {
    if (held.delete(replica)) changed();
    return;
  }
  if (was?.artifactId === artifactId && was.machine === machine && was.unsent === unsent) return;
  held.set(replica, { artifactId, machine, unsent });
  changed();
}

/** Whether a waiting replica of the artifact holds an edit the host never acknowledged. */
export const unsentWhileDeleted = (artifactId: string, machine: MachineRef): boolean => [...held.values()].some((entry) => entry.artifactId === artifactId && entry.machine === machine && entry.unsent > 0);

/** Called at every change of the waiting replicas; answers its unsubscribe. */
export function subscribeDeletedReplicas(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Tests.
export function resetDeletedReplicas(): void {
  held.clear();
  changed();
}
