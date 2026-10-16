// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8; M5): a number that changes with every update the
// replica takes, so chrome that reads the model directly (the overlay's measures, the arrange buttons) renders again.
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { onUpdate } from '../../../yjs';
import type { DeckSession } from '../session';

export function useDocVersion(session: DeckSession): number {
  const version = useRef(0);
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        onUpdate(session.doc, () => {
          version.current++;
          listener();
        }),
      [session],
    ),
    () => version.current,
  );
}
