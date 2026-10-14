// What the Artifacts tab shows (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4): the view (All, Pinned, By
// Space), the search, the type filter and, in By Space, the one Space the owner narrowed it to. Kept for the app run, so
// leaving the tab and coming back finds the library as it was left (the plugin library's choices are kept the same way).
import { create } from 'zustand';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { LibraryFilter } from '@shared/ipc/schema/library';

export type LibraryViewName = 'all' | 'pinned' | 'bySpace';

export interface LibraryViewState {
  view: LibraryViewName;
  query: string;
  kind: ArtifactKind | null; // null: every type
  spaceId: string | null; // By Space narrowed to one Space; null: every Space
}

const INITIAL: LibraryViewState = { view: 'all', query: '', kind: null, spaceId: null };

export const useLibraryView = create<LibraryViewState>()(() => INITIAL);

export const setLibraryView = (patch: Partial<LibraryViewState>): void => useLibraryView.setState(patch);

// The By Space view narrowed to one Space (a row's Space chip, a Space's heading).
export const showSpace = (spaceId: string): void => setLibraryView({ view: 'bySpace', spaceId });

// The filter main is asked for the view's list (By Space unnarrowed asks for every row and groups them here).
export function filterOf({ view, query, kind, spaceId }: LibraryViewState): LibraryFilter {
  return {
    ...(kind !== null && { kind }),
    ...(query.trim() !== '' && { query: query.trim() }),
    ...(view === 'pinned' && { pinned: true }),
    ...(view === 'bySpace' && spaceId !== null && { spaceId }),
  };
}

// The Space new artifacts are made in: the one the view is narrowed to, if any (Decision Log 13).
export const currentSpaceOf = ({ view, spaceId }: LibraryViewState): string | null => (view === 'bySpace' ? spaceId : null);

// Tests.
export const resetLibraryView = (): void => useLibraryView.setState(INITIAL, true);
