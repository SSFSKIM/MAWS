// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3): the design as the workbench's chrome
// reads it, the deck view's counterpart (C's `deck-view.ts`): the boards in manifest order (back to front) with their
// frames, titles, held reasons, missing-source marks and a token of each board's node (a view re-mounts when a board is
// written anew), the deck root's overrides and faces. Read again at every update of the replica, and the same object
// returned while nothing it shows changed, so a drag's frames re-render only the boards that moved. Pure: no React.
import type { Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { slideToken } from '../../yjs/slides-observe';
import type { DeckFace } from '../../slides/deck';
import { heldOf } from '../../slides/model';
import type { BoardFrame } from '../canvas';
import { boardFrame, boardOrder, isMissingSource } from '../model';

export interface BoardView {
  id: string;
  /** The manifest's title, '' when it has none (the id names it then). */
  title: string;
  /** Null while a merge has left it partial (the host's repair completes it); such a board is listed, not drawn. */
  frame: BoardFrame | null;
  /** The reasons its file does not load (it shows its last good version, read-only). */
  held: readonly string[] | null;
  /** The manifest names it but its file never arrived (Decision Log 11 (3)): a labelled frame, read-only. */
  missing: boolean;
  token: object;
}
export interface DesignBoards {
  boards: readonly BoardView[];
  overrides: Readonly<Record<string, string>>;
  faces: Readonly<Record<string, DeckFace>>;
}

/** How a board is named in the chrome: its title, else its id. */
export const boardLabel = (b: Pick<BoardView, 'id' | 'title'>): string => b.title || b.id;

export function readBoards(doc: Doc): DesignBoards {
  const boards = boardOrder(doc).map((id): BoardView => {
    const title = Y.slideScalars(doc, id).title;
    return { id, title: typeof title === 'string' ? title : '', frame: boardFrame(doc, id), held: heldOf(doc, id)?.reasons ?? null, missing: isMissingSource(doc, id), token: slideToken(doc, id)! };
  });
  return {
    boards,
    overrides: (Y.deckEntries(doc, 'dsOverrides') ?? {}) as Record<string, string>,
    faces: (Y.deckEntries(doc, 'faces') ?? {}) as unknown as Record<string, DeckFace>,
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameBoard = (a: BoardView, b: BoardView) =>
  a.id === b.id && a.title === b.title && a.token === b.token && a.missing === b.missing && sameJson(a.frame, b.frame) && sameJson(a.held, b.held);

/** `next` with every part equal to `prev`'s replaced by `prev`'s (each unchanged board too), and `prev` when nothing changed. */
export function keepEqualBoards(prev: DesignBoards, next: DesignBoards): DesignBoards {
  const before = new Map(prev.boards.map((b) => [b.id, b]));
  const kept = next.boards.map((b) => {
    const was = before.get(b.id);
    return was && sameBoard(was, b) ? was : b;
  });
  const boards = kept.length === prev.boards.length && kept.every((b, i) => b === prev.boards[i]) ? prev.boards : kept;
  const overrides = sameJson(prev.overrides, next.overrides) ? prev.overrides : next.overrides;
  const faces = sameJson(prev.faces, next.faces) ? prev.faces : next.faces;
  return boards === prev.boards && overrides === prev.overrides && faces === prev.faces ? prev : { boards, overrides, faces };
}
