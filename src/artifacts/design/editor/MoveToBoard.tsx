// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the parent's Decision Log 20 (2) and XE4): the
// one way an element crosses boards in this cut, an explicit "Move to board…" in the inspector while elements are
// selected, over M1's atomic writer (`moveElementToBoard`): each selected element whose ancestors are not selected too
// moves with its subtree, under new ids, its comments rewritten in the same transaction, the whole gesture one undo
// step. A pinned element keeps its place on the destination, nudged inside it when the destination is smaller; flow
// content joins the end of the destination's flow. Boards that cannot take a write (held, missing, the active one)
// are not offered; a refusal (a limit of the destination) is shown and writes nothing. Drag-across-boards is not this
// cut's (deferred to the owner's sitting with first-press drag-through).
import { DropdownMenu } from 'radix-ui';
import { isPinned } from '../../slides/ir';
import { readFlat, resolveParents, ROOT } from '../../slides/model';
import type { SlideCanvas } from '../../slides/canvas';
import type { DeckSession } from '../../slides/editor/session';
import { measure } from '../../slides/editor/transform/measure';
import { applyV2, newDoc, stateV2 } from '../../yjs';
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

/**
 * Moves the selection's roots from `from` to `to` as one gesture; answers each root's id on `to`. A pinned root keeps its
 * left and top, kept inside the destination by its drawn size (`canvas` at `zoom`).
 */
export function moveSelectionToBoard(session: DeckSession, from: BoardView, to: BoardView, selection: readonly string[], canvas: SlideCanvas | null, zoom: number): string[] {
  const flat = new Map(readFlat(session.doc, from.id, false).map((e) => [e.id, e]));
  const plans = movedRoots(session, from.id, selection).map((id) => {
    const e = flat.get(id)!;
    const [left, top] = [px(e.style.left), px(e.style.top)];
    if (!isPinned(e.tag, e.style, e.attrs) || left === null || top === null || !to.frame) return { id, options: {} };
    const box = canvas ? measure(canvas, id, zoom)?.bounds : undefined;
    const [w, h] = [box?.w ?? 0, box?.h ?? 0];
    return { id, options: { at: { left: Math.max(0, Math.min(left, to.frame.w - w)), top: Math.max(0, Math.min(top, to.frame.h - h)) } } };
  });
  // the writer refuses one move whole; several are tried together on a copy first, so a refusal of a later one leaves
  // nothing of the earlier ones written
  if (plans.length > 1) {
    const scratch = newDoc();
    try {
      applyV2(scratch, stateV2(session.doc));
      for (const { id, options } of plans) moveElementToBoard(scratch, from.id, to.id, id, options);
    } finally {
      scratch.destroy();
    }
  }
  const moved: string[] = [];
  session.edit((origin) => {
    for (const { id, options } of plans) moved.push(moveElementToBoard(session.doc, from.id, to.id, id, options, origin).ids.get(id)!);
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
    try {
      const ids = moveSelectionToBoard(session, active, to, selection, canvas, zoom);
      onMoved(to, ids);
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
              <DropdownMenu.Item key={b.id} className="deck-menu-item" data-move-target={b.id} onSelect={() => move(b)}>
                {boardLabel(b)}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
