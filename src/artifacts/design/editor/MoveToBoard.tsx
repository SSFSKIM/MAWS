// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the parent's Decision Log 20 (2) and XE4): the
// one way an element crosses boards in this cut, an explicit "Move to board…" in the inspector while elements are
// selected, over M1's atomic writer (`moveElementToBoard`): each selected element whose ancestors are not selected too
// moves with its subtree, under new ids, its comments rewritten in the same transaction, the whole gesture one undo
// step. A pinned element keeps its place on the destination, nudged inside it when the destination is smaller; flow
// content joins the end of the destination's flow. Boards that cannot take a write (held, missing, the active one)
// are not offered; a refusal (a limit of the destination) is shown and writes nothing. The menu may stay open while the
// design changes under it, so a choice is checked again as it is made, against the replica as it is then: the session
// still takes writes (not read-only, no version shown), both boards still take a write, the board is still the active
// one and the selected elements still on it; else nothing is written. Drag-across-boards is not this
// cut's (deferred to the owner's sitting with first-press drag-through).
import { DropdownMenu } from 'radix-ui';
import { isPinned } from '../../slides/ir';
import { heldOf, readFlat, resolveParents, ROOT } from '../../slides/model';
import type { SlideCanvas } from '../../slides/canvas';
import type { DeckSession } from '../../slides/editor/session';
import { measure } from '../../slides/editor/transform/measure';
import { applyV2, newDoc, stateV2 } from '../../yjs';
import * as Y from '../../yjs/slides';
import { boardFrame, isMissingSource } from '../model';
import { moveElementToBoard } from '../move';
import { BoardError } from '../writers';
import { boardLabel, type BoardView } from './boards';
import { DESIGN_COPY as C } from './copy';

/** The selected elements a move takes: each one none of whose ancestors is selected too (their subtrees go with them). */
export function movedRoots(session: DeckSession, boardId: string, selection: readonly string[]): string[] {
  const flat = readFlat(session.doc, boardId, false);
  const parents = resolveParents(flat);
  const chosen = new Set(selection);
  return selection.filter((id) => {
    if (!parents.has(id)) return false;
    for (let p = parents.get(id)!, hops = 0; p !== ROOT && hops <= flat.length; p = parents.get(p) ?? ROOT, hops++) if (chosen.has(p)) return false;
    return true;
  });
}

const px = (v: string | undefined): number | null => (v !== undefined && /^-?\d+(\.\d+)?px$/.test(v.trim()) ? Number.parseFloat(v) : null);

/** Whether a board takes a write now: it exists with its frame, and is neither held nor missing its file. */
const boardWritable = (session: DeckSession, id: string): boolean => Y.hasSlide(session.doc, id) && boardFrame(session.doc, id) !== null && heldOf(session.doc, id) === null && !isMissingSource(session.doc, id);

/**
 * Moves the selection's roots from board `fromId` to board `toId` as one gesture; answers each root's id on `toId`, or
 * null, writing nothing, when the move no longer holds (module header). A pinned root keeps its left and top, kept
 * inside the destination by its drawn size (`canvas` at `zoom`).
 */
export function moveSelectionToBoard(session: DeckSession, fromId: string, toId: string, selection: readonly string[], canvas: SlideCanvas | null, zoom: number): string[] | null {
  if (fromId === toId || !session.writable() || !boardWritable(session, fromId) || !boardWritable(session, toId)) return null;
  const present = selection.filter((id) => Y.hasElement(session.doc, fromId, id));
  if (present.length === 0) return null;
  const to = boardFrame(session.doc, toId)!;
  const flat = new Map(readFlat(session.doc, fromId, false).map((e) => [e.id, e]));
  const plans = movedRoots(session, fromId, present).map((id) => {
    const e = flat.get(id)!;
    const [left, top] = [px(e.style.left), px(e.style.top)];
    if (!isPinned(e.tag, e.style, e.attrs) || left === null || top === null) return { id, options: {} };
    const box = canvas ? measure(canvas, id, zoom)?.bounds : undefined;
    const [w, h] = [box?.w ?? 0, box?.h ?? 0];
    return { id, options: { at: { left: Math.max(0, Math.min(left, to.w - w)), top: Math.max(0, Math.min(top, to.h - h)) } } };
  });
  // the writer refuses one move whole; several are tried together on a copy first, so a refusal of a later one leaves
  // nothing of the earlier ones written
  if (plans.length > 1) {
    const scratch = newDoc();
    try {
      applyV2(scratch, stateV2(session.doc));
      for (const { id, options } of plans) moveElementToBoard(scratch, fromId, toId, id, options);
    } finally {
      scratch.destroy();
    }
  }
  const moved: string[] = [];
  session.edit((origin) => {
    for (const { id, options } of plans) moved.push(moveElementToBoard(session.doc, fromId, toId, id, options, origin).ids.get(id)!);
  });
  return moved;
}

export interface MoveToBoardProps {
  session: DeckSession;
  boards: readonly BoardView[];
  active: BoardView;
  selection: readonly string[];
  canvas: SlideCanvas | null;
  zoom: number;
  readOnly: boolean;
  /** After a move: the destination and the moved roots' ids there. */
  onMoved(to: BoardView, ids: string[]): void;
  onNotice(text: string): void;
}

const takesWrites = (b: BoardView) => b.frame !== null && b.held === null && !b.missing;

export function MoveToBoard({ session, boards, active, selection, canvas, zoom, readOnly, onMoved, onNotice }: MoveToBoardProps) {
  const targets = boards.filter((b) => b.id !== active.id && takesWrites(b));
  const disabled = readOnly || !takesWrites(active) || selection.length === 0 || targets.length === 0;
  const move = (to: BoardView) => {
    // the menu may have stayed open while the design changed: the choice is taken against the replica as it is now
    const now = session.snapshot();
    if (readOnly || now.currentSlide !== active.id) return;
    try {
      const ids = moveSelectionToBoard(session, active.id, to.id, now.selection, canvas, zoom);
      if (ids) onMoved(to, ids);
    } catch (error) {
      onNotice(error instanceof BoardError ? error.problems.join('; ') : error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="design-move-to-board" data-move-to-board>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="deck-button" title={C.moveToBoardTitle} disabled={disabled}>
            {C.moveToBoard}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} className="deck-menu" aria-label={C.moveToBoard}>
            {targets.map((b) => (
              <DropdownMenu.Item key={b.id} className="deck-menu-item" data-move-target={b.id} disabled={disabled} onSelect={() => move(b)}>
                {boardLabel(b)}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
