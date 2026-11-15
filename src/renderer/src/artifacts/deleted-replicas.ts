// UX wave U10b (M5; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.5): the replicas that wait while an
// agent's delete stands (./host.ts parks a synced replica whose reopen the host refuses because an agent deleted the
// artifact, until it is restored), and how many edits each holds that the host never acknowledged. The editor's notice
// reads it: "Your last edit is not saved" while any replica of the artifact holds one.
import { useSyncExternalStore } from 'react';

const held = new Map<object, { artifactId: string; unsent: number }>();
const listeners = new Set<() => void>();
let version = 0;

const changed = () => {
  version += 1;
  for (const listener of [...listeners]) listener();
};

/** A replica of `artifactId` waits for the artifact's restore holding `unsent` unacknowledged edits; null: it no longer waits. */
export function noteDeletedReplica(replica: object, artifactId: string, unsent: number | null): void {
  const was = held.get(replica);
  if (unsent === null) {
    if (held.delete(replica)) changed();
    return;
  }
  if (was?.artifactId === artifactId && was.unsent === unsent) return;
  held.set(replica, { artifactId, unsent });
  changed();
}

/** Whether a waiting replica of the artifact holds an edit the host never acknowledged. */
export const unsentWhileDeleted = (artifactId: string): boolean => [...held.values()].some((entry) => entry.artifactId === artifactId && entry.unsent > 0);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The same, followed in a render. */
export function useUnsentWhileDeleted(artifactId: string): boolean {
  useSyncExternalStore(subscribe, () => version);
  return unsentWhileDeleted(artifactId);
}

// Tests.
export function resetDeletedReplicas(): void {
  held.clear();
  changed();
}
