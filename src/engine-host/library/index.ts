// The engine host's library module (the P3-L document, M2; Decision Log 2 and 12; the P3 interface ledger §1 and §7):
// main's reads of the artifact store (`library.snapshot`, `library.entry`, `library.text`) and the linked-directory
// mirror, wired by one line beside P3-A's `registerArtifacts` and closed with it, before the store closes. With no
// store this run, the reads answer `unavailable` and nothing is mirrored.
import type { HostOn } from '@shared/host/runtime';
import { LibraryMirror } from './mirror';
import type { LibraryDocuments } from './reads';
import { registerLibraryReads } from './register';

export function registerLibrary(on: HostOn, { documents }: { documents: LibraryDocuments | null }): { close(): void } {
  registerLibraryReads(on, documents);
  const mirror = documents ? new LibraryMirror(documents) : null;
  void mirror?.start(); // its steps log their own failures
  return { close: () => mirror?.close() };
}
