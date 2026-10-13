// A document's tabs as React reads them: one external store per Y.Doc, its snapshot the tab list (a new array only when
// a tab's id, title or order changed, so a keystroke in a body re-renders no tab strip).
import { useSyncExternalStore } from 'react';
import { onUpdate, type Doc } from '../../yjs';
import { listTabs, type TabInfo } from '../tabs';

interface TabsStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TabInfo[];
}

const stores = new WeakMap<Doc, TabsStore>();

function tabsStore(doc: Doc): TabsStore {
  let store = stores.get(doc);
  if (store) return store;
  let key = '';
  let tabs: TabInfo[] = [];
  const read = () => {
    const next = listTabs(doc);
    const nextKey = JSON.stringify(next);
    if (nextKey !== key) {
      key = nextKey;
      tabs = next;
    }
    return tabs;
  };
  store = { subscribe: (listener) => onUpdate(doc, listener), getSnapshot: read };
  stores.set(doc, store);
  return store;
}

export function useTabs(doc: Doc): TabInfo[] {
  const store = tabsStore(doc);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
