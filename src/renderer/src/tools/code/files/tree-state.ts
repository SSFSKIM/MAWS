// RED stub (UX wave U6b-1, M3): the exports the tests name, behaving as nothing yet.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';

export const FILES_TREE_KEY = 'files.tree';
export const TREE_WRITE_DELAY_MS = 250;
export const TREE_WIDTH_DEFAULT = 220;
export const TREE_WIDTH_MIN = 160;
export const FILE_WIDTH_MIN = 320;
export type TreePlace = 'alone' | 'beside' | 'folded' | 'instead';
export function treePlace(_input: { holdsFile: boolean; tabWidth: number; treeWidth: number; folded: boolean; shown: boolean }): TreePlace {
  return 'alone';
}
export interface SessionTree {
  width: number | null;
  folded: boolean;
  expanded: ReadonlySet<string>;
  selected: string | null;
  scrollTop: number;
  defaultRoot: string | null;
  restored: boolean;
}
const NEW_TREE: SessionTree = { width: null, folded: false, expanded: new Set(), selected: null, scrollTop: 0, defaultRoot: null, restored: false };
export interface TreeStateStore {
  loaded: boolean;
  trees: ReadonlyMap<AppSessionId, SessionTree>;
  load(): Promise<void>;
  toggle(appSessionId: AppSessionId, path: string): void;
  setWidth(appSessionId: AppSessionId, width: number | null): void;
  setFolded(appSessionId: AppSessionId, folded: boolean): void;
  select(appSessionId: AppSessionId, path: string): void;
  scrolled(appSessionId: AppSessionId, scrollTop: number): void;
  firstRoot(appSessionId: AppSessionId, root: string): void;
}
export const treeOf = (state: Pick<TreeStateStore, 'trees'>, appSessionId: AppSessionId): SessionTree => state.trees.get(appSessionId) ?? NEW_TREE;
export function createTreeStateStore(_client: MawsBridge, _options: { writeDelayMs?: number; knows?: (appSessionId: AppSessionId) => boolean } = {}): UseBoundStore<StoreApi<TreeStateStore>> {
  return create<TreeStateStore>()(() => ({
    loaded: false,
    trees: new Map(),
    load: () => Promise.resolve(),
    toggle() {},
    setWidth() {},
    setFolded() {},
    select() {},
    scrolled() {},
    firstRoot() {},
  }));
}
export const useTreeState = createTreeStateStore(ipc);
export function resetTreeState(): void {}
