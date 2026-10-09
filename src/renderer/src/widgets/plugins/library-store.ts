// The libraries' view choices (P2-B execution document §5.4): search, filter and sort live for the app run (they
// survive closing and reopening the dialog, not a restart); the tab, the selection and the scroll are the components'
// own state, so every open starts on My items with no selection. No setting is kept, so no settings version (X15: none).
// Browse keeps its own search, Status, Source and sort beside My items' (M5).
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { BrowseChoices } from './browse';
import type { LibraryFilter, LibrarySort } from './library';

interface LibraryState {
  plugins: { search: string; filter: LibraryFilter; sort: LibrarySort };
  browse: BrowseChoices;
  skills: { search: string; sort: 'name' | 'plugin' };
}

export const useLibraryStore: UseBoundStore<StoreApi<LibraryState>> = create<LibraryState>()(() => ({
  plugins: { search: '', filter: 'all', sort: 'updated' },
  browse: { search: '', sort: null, status: { installed: true, notInstalled: true }, source: null },
  skills: { search: '', sort: 'name' },
}));
