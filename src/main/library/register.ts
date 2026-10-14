// Main's handlers for the library's reads (the P3-L document, Decision Log 9): `library.list`, `library.get` and
// `library.spaces`, answered from the derived index. An index this app cannot use (a newer app's) serves nothing: the
// reads answer empty, its reason logged once when the library starts (index.ts).
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { LibraryCounts, LibraryFilter } from '@shared/ipc/schema/library';
import type { Index } from '../index/index';
import type { registerMainHandler } from '../ipc/router';

const noCounts = (): LibraryCounts => Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, 0])) as LibraryCounts;

export function registerLibraryHandlers(index: Pick<Index, 'library' | 'unavailable'>, register: typeof registerMainHandler): void {
  const usable = () => index.unavailable === null;
  register('library.list', ({ filter }) => (usable() ? index.library.list(filter as LibraryFilter | undefined) : { rows: [], counts: noCounts() }));
  register('library.get', ({ artifactId }) => ({ row: usable() ? index.library.get(artifactId) : null }));
  register('library.spaces', () => ({ spaces: usable() ? index.library.spaces() : [] }));
}
