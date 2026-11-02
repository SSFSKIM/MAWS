// Fixtures for the renderer's remote artifact suites (P5 O7 M5a): main's rows and records, valid for the client's output
// validation, with ids the suites number.
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { ArtifactRow } from '@shared/ipc/schema/artifacts';
import type { LibraryCounts, LibraryRow } from '@shared/ipc/schema/library';

export const artifactId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.now();

export const artifactRow = (n: number, over: Partial<ArtifactRow> = {}): ArtifactRow => ({
  id: artifactId(n), kind: 'document', title: `Artifact ${n}`, createdBy: { kind: 'human' }, createdAt: NOW, updatedAt: NOW, lastViewedAt: null, pinned: false,
  agentEditsAsSuggestions: false, revision: 1, ...over,
});

export const libraryRow = (n: number, over: Partial<LibraryRow> = {}): LibraryRow => ({
  ...artifactRow(n), lastEditor: { kind: 'human' }, lastEditedAt: NOW, sessions: [], ...over,
});

export const countsOf = (rows: readonly LibraryRow[]): LibraryCounts => Object.fromEntries(ARTIFACT_KINDS.map((k) => [k, rows.filter((row) => row.kind === k).length])) as LibraryCounts;
