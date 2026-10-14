// Whether an open document is read-only (the whole-branch review of docs/doperpowers/plans/2026-10-12-p3-b-documents.md):
// A's `DocumentState.readOnly`, set when the store was written by a newer MAWS and said again after each reconnect. The
// editor and every control that writes the document follow it, since the host refuses whatever they would write.
import { useCallback, useSyncExternalStore } from 'react';
import type { DocumentHandle } from './host-types';

export function useReadOnly(handle: DocumentHandle): boolean {
  const subscribe = useCallback((changed: () => void) => handle.subscribe(changed), [handle]);
  return useSyncExternalStore(subscribe, () => handle.state().readOnly);
}
