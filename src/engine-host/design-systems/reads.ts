// The engine host's `designSystems.*` reads (the P3 spec's Decision Log 61; the ledger's X28): what a window asks of the
// host's design-system module. `designSystems.house` answers the default chain's house link (`DesignSystemChain.house()`),
// which the renderer passes to the portable `governingSystem` as `house`, so a scope draws the system the host's chain
// would name rather than the bundled floor. Answered from the store at its commit (`readCommitted`), so every read is
// `immediate`; a store that failed to open answers `unavailable`, as A's and L's surfaces do.
import { HostCommandError, type HostOn } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import type { commands as DesignSystemCommands } from '@shared/ipc/schema/design-systems';
import type { ArtifactStore } from '../documents/store';
import type { DeadlineShape } from '../ipc';
import type { DesignSystemChain } from './chain';

export const DESIGN_SYSTEMS_DEADLINE_SHAPES: Record<keyof typeof DesignSystemCommands, DeadlineShape> = { 'designSystems.house': 'immediate' };

/** `reads` null: the store could not be opened this run (`openDocuments` logged why). */
export function registerDesignSystemReads(on: HostOn, reads: { store: ArtifactStore; chain: DesignSystemChain } | null): void {
  on('designSystems.house', async () => {
    if (!reads) throw new HostCommandError(ipcError('internal', 'the artifact store could not be opened this run', { reason: 'unavailable', data: {} } satisfies ArtifactRefusal));
    const { store, chain } = reads;
    return store.readCommitted(() => ({ houseId: chain.house() }));
  });
}
