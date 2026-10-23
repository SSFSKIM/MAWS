// The engine host's `designSystems.*` reads (the P3 spec's Decision Log 61; the ledger's X28): what a window asks of the
// host's design-system module. `designSystems.house` answers the default chain's house link (`DesignSystemChain.house()`),
// which the renderer passes to the portable `governingSystem` as `house`, so a scope draws the system the host's chain
// would name rather than the bundled floor. Answered from the store at its commit (`readCommitted`), so every read is
// `immediate`; a store that failed to open answers `unavailable`, as A's and L's surfaces do.
// `designSystems.governing` (main's alone; Decision Log 61, part 2) answers the system governing a document main exports:
// a version's pin (X29), the floor for a version written with none, else the live artifact's through the same chain A's
// pin asks, so an export draws what the editor draws.
import { HostCommandError, type HostOn } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import type { commands as DesignSystemCommands } from '@shared/ipc/schema/design-systems';
import type { ArtifactStore } from '../documents/store';
import type { DeadlineShape } from '../ipc';
import type { DesignSystemChain } from './chain';

export const DESIGN_SYSTEMS_DEADLINE_SHAPES: Record<keyof typeof DesignSystemCommands, DeadlineShape> = { 'designSystems.house': 'immediate', 'designSystems.governing': 'immediate' };

const refused = (reason: ArtifactRefusal['reason'], message: string, code: 'invalid_input' | 'internal' = 'invalid_input') => new HostCommandError(ipcError(code, message, { reason, data: {} } satisfies ArtifactRefusal));

/** `reads` null: the store could not be opened this run (`openDocuments` logged why). */
export function registerDesignSystemReads(on: HostOn, reads: { store: ArtifactStore; chain: DesignSystemChain } | null): void {
  const opened = () => {
    if (!reads) throw refused('unavailable', 'the artifact store could not be opened this run', 'internal');
    return reads;
  };
  on('designSystems.house', async () => {
    const { store, chain } = opened();
    return store.readCommitted(() => ({ houseId: chain.house() }));
  });
  on('designSystems.governing', async ({ artifactId, versionId }) => {
    const { store, chain } = opened();
    return store.readCommitted(() => {
      const artifact = store.get(artifactId);
      if (!artifact) throw refused('notFound', `no artifact ${artifactId}`);
      if (versionId === undefined) return { system: chain.governing(artifact) };
      const version = store.versions.version(artifactId, versionId);
      if (!version) throw refused('notFound', `no version ${versionId} of ${artifactId}`);
      return { system: version.designSystemRef ?? { builtin: 'maws' as const } };
    });
  });
}
