// The history controller as the editor holds it (M5 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): one per
// document handle and history api, attached while the editor is mounted (a StrictMode remount re-attaches the same
// one), and its snapshot.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { DocumentHandle } from '../../../host';
import type { HistoryApi } from './api';
import { HistoryController, type HistorySnapshot } from './controller';

const idle = () => () => {};
const none = () => null;

export function useHistoryController(handle: DocumentHandle, api: HistoryApi | undefined): HistoryController | null {
  const controller = useMemo(() => (api ? new HistoryController(handle, api) : null), [handle, api]);
  useEffect(() => controller?.attach(), [controller]);
  return controller;
}

export function useHistorySnapshot(controller: HistoryController | null): HistorySnapshot | null {
  return useSyncExternalStore(controller?.subscribe ?? idle, controller?.getSnapshot ?? none);
}
