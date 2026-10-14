// The engine host's library module (the P3-L document, M2; Decision Log 2 and 12; the P3 interface ledger §1 and §7):
// main's reads of the artifact store (`library.snapshot`, `library.entry`, `library.text`) and the linked-directory
// mirror, wired by one line beside P3-A's `registerArtifacts` and closed with it, before the store closes. With no
// store this run, the reads answer `unavailable` and nothing is mirrored.
//
// M6b (Decision Log 5, 22b, 32b, 33a): the cutover's X12 import runs once here at every host start, over the store as it
// opened: the deliverables the owner's sessions made before P3 land as File and HTML artifacts under their record ids,
// and a start over records that all landed (or that A imported on touch) skips each by its id, so no marker is kept.
// It runs beside the first reads: each landed artifact announces itself on the store's change feed, which main's
// library and the mirror follow. Under MAWS_E2E=1, `library.testImport` runs it again for a test's seeded records.
import { HostCommandError, type HostOn } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import { importDeliverables, type DeliverablesImport } from './import';
import { LibraryMirror } from './mirror';
import type { LibraryDocuments } from './reads';
import { registerLibraryReads } from './register';

export interface LibraryDeps {
  documents: LibraryDocuments | null;
  deliverablesDir: string; // `<userData>/deliverables`, X12's tree (read, never written)
  log?: (line: string) => void;
  e2e?: boolean; // MAWS_E2E=1: `library.testImport` answers
}

const describe = (counts: DeliverablesImport) => `imported ${counts.imported}, skipped ${counts.skipped}, missing ${counts.missing}, failed ${counts.failed}`;

export function registerLibrary(on: HostOn, { documents, deliverablesDir, log = (line) => console.warn(`[library] ${line}`), e2e = false }: LibraryDeps): { close(): void } {
  registerLibraryReads(on, documents);
  const mirror = documents ? new LibraryMirror(documents) : null;
  void mirror?.start(); // its steps log their own failures
  const runImport = async (): Promise<DeliverablesImport> => {
    const counts = await importDeliverables(documents!.store, deliverablesDir, log);
    log(`the X12 deliverables import: ${describe(counts)}`);
    return counts;
  };
  if (documents) void runImport().catch((error: unknown) => log(`the X12 deliverables import did not run: ${error instanceof Error ? error.message : String(error)}`));
  on('library.testImport', async () => {
    if (!e2e) throw new HostCommandError(ipcError('internal', 'library.testImport answers only when the engine host runs under MAWS_E2E=1'));
    if (!documents) throw new HostCommandError(ipcError('internal', 'the artifact store could not be opened this run'));
    return runImport();
  });
  return { close: () => mirror?.close() };
}
