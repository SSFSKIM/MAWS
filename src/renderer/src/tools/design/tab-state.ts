// The state a design tab owns (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; X32's lifetime rule):
// C's deck tab state as it stands (the replica, its saved state, the deck session with the one undo stack, the awaited
// edits and the composition hold, the open-thread count, the close guard, the history api) composed with the
// workbench's own view (`DesignView`: the viewport and the selected board frame), so the header's Zoom to fit acts with
// no body mounted and a body remounting on a tab switch finds the world where it was. A restore of a version clears the
// undo stack (C's); the view stays.
import type { BoardFrame } from '@artifacts/design/canvas';
import { boardFrame, boardOrder } from '@artifacts/design/model';
import { BOARD_FIT_MAX, DesignView, unionRect } from '@artifacts/design/editor/viewport';
import { DeckTabState, openDeckTabs, type DeckTabDeps } from '../presentation/tab-state';

export type DesignTabDeps = DeckTabDeps;

export class DesignTabState extends DeckTabState {
  /** The workbench's view of this tab's world. */
  readonly view = new DesignView();

  /** Every board in view (the header's Zoom to fit); waits for the body's room when none is measured yet. */
  fitAll = (): void => {
    const doc = this.snapshot().handle?.doc;
    if (!doc) return;
    const rect = unionRect(boardOrder(doc).flatMap((id): BoardFrame[] => {
      const frame = boardFrame(doc, id);
      return frame ? [frame] : [];
    }));
    if (rect) this.view.fitTo(rect, BOARD_FIT_MAX);
  };
}

/** Every open design tab (the e2e seam's). */
export const openDesignTabs = (): readonly DesignTabState[] => openDeckTabs().filter((tab): tab is DesignTabState => tab instanceof DesignTabState);
