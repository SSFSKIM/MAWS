// Discover's view choices per tab (search, the filter chips, the category, a shelf's See all filter, Not installed, the
// sort and its direction), kept for the app run like the libraries' own (`widgets/plugins/library-store.ts`): switching
// tabs or leaving Customize keeps them, a restart does not. No setting is kept, so no settings version.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { CatalogChip, CatalogQueryInput, CatalogSort, CatalogTab } from '@shared/ipc/schema/catalog';

export interface DiscoverChoices {
  text: string;
  chips: CatalogChip[];
  category: { value: string; title: string } | null;
  source: { key: string; title: string } | null; // a shelf's See all: a seed's source key, or 'added'
  notInstalled: boolean;
  sort: CatalogSort;
  reverse: boolean;
}

export const NO_CHOICES: DiscoverChoices = { text: '', chips: [], category: null, source: null, notInstalled: false, sort: 'installs', reverse: false };

type DiscoverTab = CatalogTab;
export const useDiscoverStore: UseBoundStore<StoreApi<Record<DiscoverTab, DiscoverChoices>>> = create<Record<DiscoverTab, DiscoverChoices>>()(() => ({ plugins: NO_CHOICES, skills: NO_CHOICES, connectors: NO_CHOICES }));

export const setChoices = (tab: DiscoverTab, patch: Partial<DiscoverChoices>) => useDiscoverStore.setState((s) => ({ [tab]: { ...s[tab], ...patch } }));

/** Whether the choices narrow the list: then the grid of results shows in place of the home. */
export const filtering = (c: DiscoverChoices): boolean => c.text.trim() !== '' || c.chips.length > 0 || c.category !== null || c.source !== null || c.notInstalled;

/** The query the choices ask (the cursor is the pages' own). */
export const queryOf = (tab: CatalogTab, cwd: string | null, c: DiscoverChoices): Omit<CatalogQueryInput, 'cursor'> => ({
  tab,
  cwd,
  text: c.text.trim(),
  chips: c.chips,
  category: c.category?.value ?? null,
  source: c.source?.key ?? null,
  notInstalled: c.notInstalled,
  sort: c.sort,
  reverse: c.reverse,
});
