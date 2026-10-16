// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11; M8): the deck's history controller as the editor
// holds it, B's `use-history.ts` for a deck: one per replica and history api, attached while the editor is mounted (a
// StrictMode remount re-attaches the same one), and its snapshot.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { HistoryApi } from '../../../document/editor/history/api';
import type { DocumentHandle } from '../../../host';
import { DeckHistoryController, type DeckHistorySnapshot } from './controller';

/** What the deck's history reads: B's api on A's IPC for this artifact, and the replica (its doc, its restores). */
export interface DeckHistorySource {
  api: HistoryApi;
  handle: Pick<DocumentHandle, 'doc' | 'onRestored'>;
}

const idle = () => () => {};
const none = () => null;

export function useDeckHistoryController(source: DeckHistorySource | undefined): DeckHistoryController | null {
  const api = source?.api;
  const handle = source?.handle;
  const controller = useMemo(() => (api && handle ? new DeckHistoryController(handle, api) : null), [api, handle]);
  useEffect(() => controller?.attach(), [controller]);
  return controller;
}

export function useDeckHistorySnapshot(controller: DeckHistoryController | null): DeckHistorySnapshot | null {
  return useSyncExternalStore(controller?.subscribe ?? idle, controller?.getSnapshot ?? none);
}
