// The engine host's `library.*` commands (the P3-L document, Decision Log 2; the P3 interface ledger §1): main's reads
// of the host's artifact store, from which it rebuilds and reconciles its derived library (index version 9). Main-only
// by the registry (`mainOnlyCommands`), so no window reads the store around main's index. Each is answered from the
// store at its commit (reads.ts), so none can outlive the bridge's router timeout: all `immediate`. A refusal the store
// names reaches main as A's surface sends it (an `ArtifactRefusal` in the IpcError's `issues`); a store that failed to
// open answers `unavailable`.
import { HostCommandError, type HostOn } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import { ArtifactStoreError } from '../documents/errors';
import type { DeadlineShape } from '../ipc';
import { readEntry, readSnapshot, readText, type LibraryDocuments } from './reads';

type LibraryHostCommand = 'library.snapshot' | 'library.entry' | 'library.text';

// M6b: `library.testImport` (e2e only, `./index.ts`) walks the X12 tree and copies pages: bounded, not immediate.
export const LIBRARY_DEADLINE_SHAPES: Record<LibraryHostCommand | 'library.testImport', DeadlineShape> = { 'library.snapshot': 'immediate', 'library.entry': 'immediate', 'library.text': 'immediate', 'library.testImport': 'bounded' };

function refused(reason: ArtifactRefusal['reason'], message: string, data: Record<string, unknown>, code: 'invalid_input' | 'internal'): HostCommandError {
  return new HostCommandError(ipcError(code, message, { reason, data } satisfies ArtifactRefusal));
}

// `documents` null: the store could not be opened this run (`openDocuments` logged why).
export function registerLibraryReads(on: HostOn, documents: LibraryDocuments | null): void {
  const serve = <N extends LibraryHostCommand>(name: N, handler: (input: CommandInput<N>, documents: LibraryDocuments) => Promise<CommandOutput<N>>) =>
    on(name, async (input) => {
      if (!documents) throw refused('unavailable', 'the artifact store could not be opened this run', {}, 'internal');
      try {
        return await handler(input, documents);
      } catch (error) {
        throw error instanceof ArtifactStoreError ? refused(error.code, error.message, error.data, 'invalid_input') : error;
      }
    });
  serve('library.snapshot', (_, { store }) => readSnapshot(store));
  serve('library.entry', ({ artifactId }, { store }) => readEntry(store, artifactId));
  serve('library.text', ({ artifactId }, docs) => readText(docs, artifactId));
}
