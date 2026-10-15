// The page's reach into the system it shows: the replica's state as a React store (one immutable snapshot per change,
// so the page re-renders with every edit, its own and a remote one), and one view over that replica for the previews'
// scopes, so the page restyles from its own doc in the same frame as the edit, with no second replica.
import { useSyncExternalStore } from 'react';
import { onUpdate, type Doc } from '../../yjs';
import type { AssetUrl } from '../assets';
import { readSystem, type SystemState } from '../model';
import { resolveTokens, type ResolvedTokens } from '../resolve';
import { liveView, type DesignSystemView } from '../view';

/** What the page renders from: the system as read, and its tokens resolved. */
export interface PageState {
  system: SystemState;
  resolved: ResolvedTokens;
}

interface Store {
  subscribe(listener: () => void): () => void;
  get(): PageState;
}
const stores = new WeakMap<Doc, Store>();

function storeOf(doc: Doc): Store {
  let store = stores.get(doc);
  if (store) return store;
  let cached: PageState | null = null;
  const listeners = new Set<() => void>();
  // Held for the doc's life: the snapshot is dropped on every update, whoever is listening.
  onUpdate(doc, () => {
    cached = null;
    for (const listener of [...listeners]) listener();
  });
  store = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => {
      if (!cached) {
        const system = readSystem(doc);
        cached = { system, resolved: resolveTokens(system.tokens) };
      }
      return cached;
    },
  };
  stores.set(doc, store);
  return store;
}

/** The system in `doc`, re-read after every change. */
export function usePageState(doc: Doc): PageState {
  const store = storeOf(doc);
  return useSyncExternalStore(store.subscribe, store.get);
}

const views = new WeakMap<Doc, DesignSystemView>();
/** The one view of `doc` the previews' scopes share; it lives as long as the doc. */
export function pageViewOf(doc: Doc, toUrl: AssetUrl): DesignSystemView {
  let view = views.get(doc);
  if (!view) {
    view = liveView(doc, toUrl);
    views.set(doc, view);
  }
  return view;
}
