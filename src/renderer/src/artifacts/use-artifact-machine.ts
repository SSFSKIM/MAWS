// `artifactMachineOf` in a render (P5 O7 M5a), followed as the page's table changes; apart from ./machines.ts, which the
// renderer's client imports and the node project compiles.
import { useSyncExternalStore } from 'react';
import type { MachineRef } from '@shared/machine/ref';
import { artifactMachineOf, subscribeArtifactMachines } from './machines';

/** The artifact's machine when it is another machine's; null for this Mac's. */
export const useArtifactMachine = (artifactId: string | null): MachineRef | null =>
  useSyncExternalStore(subscribeArtifactMachines, () => (artifactId === null ? null : artifactMachineOf(artifactId)));
