// The state a design tab owns (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; X32's lifetime rule):
// C's deck tab state as it stands (the replica, its saved state, the deck session with the one undo stack, the awaited
// edits and the composition hold, the open-thread count, the close guard, the history api) composed with the
// workbench's own view (`DesignView`: the viewport and the selected board frame), so the header's Zoom to fit acts with
// no body mounted and a body remounting on a tab switch finds the world where it was. A restore of a version clears the
// undo stack (C's); the view stays. M4: the history api the workbench's history reads, C's through the design model
// (history-api.ts), made once per tab so the history controller is kept across remounts. M5 (the parent's Decision Log
// 31): what the header's Export exports, read from this state when an entry is chosen (never a body's closure): the
// selected board (its frame, else the active board) and the version the history shows.
import type { BoardFrame } from '@artifacts/design/canvas';
import { boardFrame, boardOrder } from '@artifacts/design/model';
import { boardLabel, readBoards } from '@artifacts/design/editor/boards';
import { BOARD_FIT_MAX, DesignView, unionRect } from '@artifacts/design/editor/viewport';
import type { HistoryApi } from '@artifacts/document/editor/history/api';
import type { SlideCanvas } from '@artifacts/slides/canvas';
import { DeckTabState, openDeckTabs, type DeckTabDeps } from '../presentation/tab-state';
import type { DesignExportContext } from './exports';
import { designHistoryApi } from './history-api';

export type DesignTabDeps = DeckTabDeps;

export class DesignTabState extends DeckTabState {
  /** The workbench's view of this tab's world. */
  readonly view = new DesignView();
  /** M4: the design's version history on A's IPC, its versions read through the design model; null without the IPC. */
  readonly designHistory: HistoryApi | null = this.history && designHistoryApi(this.history);
  /** M6: the canvases the body's live world draws now, by board (none while no body shows); the e2e seam's re-layout probe reads them. */
  canvases: ReadonlyMap<string, SlideCanvas> = new Map();
  setCanvases = (canvases: ReadonlyMap<string, SlideCanvas>): void => {
    this.canvases = canvases;
  };

  /**
   * Every board in view (the header's Zoom to fit); waits for the body's room when none is measured yet. Nothing while the
   * history shows a version in place of the live world: that world has its own view, which the tab does not hold (the
   * header offers the action disabled then), and the live view stays where Back finds it.
   */
  fitAll = (): void => {
    const doc = this.snapshot().handle?.doc;
    if (!doc || this.view.snapshot().shown !== null) return;
    const rect = unionRect(boardOrder(doc).flatMap((id): BoardFrame[] => {
      const frame = boardFrame(doc, id);
      return frame ? [frame] : [];
    }));
    if (rect) this.view.fitTo(rect, BOARD_FIT_MAX);
  };

  /**
   * M5: what an export from the header exports now: while the history previews a version, that version and its own board
   * (as the workbench published them); otherwise the live selection (its frame, else the active board), named as now.
   */
  exportContext = (): DesignExportContext => {
    const { frame, shown } = this.view.snapshot();
    if (shown !== null && shown !== 'compare') return { board: shown.board, label: shown.label, shown };
    const board = frame ?? this.snapshot().session?.snapshot().currentSlide ?? null;
    const doc = this.snapshot().handle?.doc;
    const live = board && doc ? readBoards(doc).boards.find((b) => b.id === board) : undefined;
    return { board, label: live ? boardLabel(live) : null, shown };
  };
}

/** Every open design tab (the e2e seam's). */
export const openDesignTabs = (): readonly DesignTabState[] => openDeckTabs().filter((tab): tab is DesignTabState => tab instanceof DesignTabState);
