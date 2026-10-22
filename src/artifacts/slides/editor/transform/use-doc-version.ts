// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8; M5): a number that changes with every update the
// replica takes, so chrome that reads the model directly (the overlay's measures, the arrange buttons) renders again.
// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D13; tracker row 280): the settled version, for the
// inspector, which shows where a gesture left the selection rather than following each of its frames.
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { onUpdate } from '../../../yjs';
import type { SlideCanvas } from '../../canvas';
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

/**
 * P4-B2 (D13): a number that advances on an update the replica takes, or a layout pass of `canvas` (faces arriving, a
 * design-system restyle, a fit), outside a drag, and once when a drag ends (committed or cancelled): what was written and
 * laid out meanwhile is read then. A keyboard nudge is an update outside a drag, so each key advances it.
 */
export function useSettledVersion(session: DeckSession, canvas: SlideCanvas | null): number {
  const version = useRef(0);
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        const advance = () => {
          version.current++;
          listener();
        };
        const settled = () => {
          if (!session.snapshot().dragging) advance();
        };
        let dragging = session.snapshot().dragging;
        const offSession = session.subscribe(() => {
          const now = session.snapshot().dragging;
          if (dragging && !now) advance(); // the gesture's end
          dragging = now;
        });
        const offDoc = onUpdate(session.doc, settled);
        const offLayout = canvas?.onLayout(settled);
        return () => {
          offSession();
          offDoc();
          offLayout?.();
        };
      },
      [session, canvas],
    ),
    () => version.current,
  );
}
