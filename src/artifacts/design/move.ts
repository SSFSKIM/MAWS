// P3-E1 M1 (the parent's §1 "Identity" and XE4, amended by Decision Log 10 (1); Decision Log 13 (4)): an element moved
// from one board to another, from E0's prototype (`spikes/p3-design/model/move.ts`, its `derived` rule). In one
// transaction the element and its descendants (as the model resolves them now) are deleted from the source and created
// at the destination's top level, last in their paint group, every thread anchored to one of them rewritten to its new
// `{slideId, elementId}`. Every moved id is new, derived from the source board, the destination board and the old id
// alone, so two replicas moving one element to one board derive one id, while a concurrent insertion of the old id into
// the destination (an agent's publish) can no longer overwrite it (Yjs keeps one value per key; E0 (c) lost an element
// so in both clientID orders); a derived id the destination already holds falls back to C's minter. Each moved element
// carries a model-only origin association, `moveOrigin {board, element}`, naming where it was before its first move and
// carried unchanged by later ones, so history can pair a removal with an addition as one move (Decision Log 13 (4)). No
// serializer reads it: the dialect, the files and publish's comparison never see it.
import { CELL_TAGS, type ElementIR, type SlideIR } from '../slides/ir';
import { cellMinter, elementMinter, GROUP_BOUNDS, groupKey, groupOf, readFlat, readSlide, resolveParents, ROOT, toScalars, type FlatElement } from '../slides/model';
import { keyAfter } from '../slides/order';
import { hash4, loadSlide } from '../slides/parse';
import { serializeSlide } from '../slides/serialize';
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { isMissingSource } from './model';
import { BoardError } from './writers';

/** The element key holding where a moved element came from before its first cross-board move. */
export const MOVE_ORIGIN_KEY = 'moveOrigin';
export interface MoveOrigin {
  board: string;
  element: string;
}

/** Where an element was before its first cross-board move, or null when it never moved. */
export function moveOriginOf(doc: Doc, boardId: string, elementId: string): MoveOrigin | null {
  if (!Y.hasElement(doc, boardId, elementId)) return null;
  const v = Y.elementScalars(doc, boardId, elementId)[MOVE_ORIGIN_KEY] as Partial<MoveOrigin> | undefined;
  return v && typeof v.board === 'string' && typeof v.element === 'string' ? { board: v.board, element: v.element } : null;
}

/** An id from the move alone (no clientID, no counter): 8 base36 characters of two FNV hashes. */
const derivedId = (from: string, to: string, id: string): string => `m${hash4(`${from}\u0000${to}\u0000${id}`)}${hash4(`${id}\u0000${to}\u0000${from}`)}`;

function usable(doc: Doc, board: string): void {
  if (!Y.hasSlide(doc, board)) throw new BoardError(board, [`board ${board}: no such board`]);
  if (Y.slideScalars(doc, board).held) throw new BoardError(board, [`board ${board}: its file does not load (held); fix it first`]);
  if (isMissingSource(doc, board)) throw new BoardError(board, [`board ${board}: its file never arrived; publish it first`]);
}

function findIR(children: ElementIR[], id: string): ElementIR | null {
  for (const c of children) {
    if (c.id === id) return c;
    const inner = findIR(c.children, id);
    if (inner) return inner;
  }
  return null;
}

export interface MoveResult {
  /** Each moved element's id on the source → its id on the destination. */
  ids: Map<string, string>;
  /** The threads whose anchor the move rewrote. */
  threads: string[];
}

/**
 * Moves an element and its subtree from `fromBoard` to the top level of `toBoard` (one gesture, one transaction under
 * `origin`). A pinned element lands at `options.at` (px, board coordinates) when given, front of the stack; a flow one
 * last in the flow. Refused naming the board, nothing written, when either board is absent, held or missing its file, the
 * element is not on the source, or the destination's file would not load after it (a limit such as the 24 pinned
 * children per host, or a row or cell standing alone).
 */
export function moveElementToBoard(doc: Doc, fromBoard: string, toBoard: string, elementId: string, options: { at?: { left: number; top: number } } = {}, origin?: unknown): MoveResult {
  if (fromBoard === toBoard) throw new BoardError(fromBoard, [`board ${fromBoard}: a move within one board is a re-parent, not a cross-board move`]);
  usable(doc, fromBoard);
  usable(doc, toBoard);
  const src = readFlat(doc, fromBoard, true);
  const eff = resolveParents(src);
  const root = src.find((e) => e.id === elementId);
  if (!root) throw new BoardError(fromBoard, [`board ${fromBoard}: no element ${elementId}`]);
  const moved: FlatElement[] = [root]; // each parent before its children
  for (let i = 0; i < moved.length; i++) for (const e of src) if (e !== root && eff.get(e.id) === moved[i]!.id) moved.push(e);

  const dest = readFlat(doc, toBoard, false);
  const taken = new Set(dest.map((e) => e.id));
  const mint = elementMinter(doc, toBoard, [...taken, ...moved.map((e) => e.id)]);
  const mintCell = cellMinter(doc, taken);
  const ids = new Map<string, string>();
  for (const e of moved) {
    const cell = CELL_TAGS.has(e.tag);
    const row = cell ? ids.get(eff.get(e.id)!)! : '';
    let id = cell ? `${row}/${derivedId(fromBoard, toBoard, e.id)}` : derivedId(fromBoard, toBoard, e.id);
    if (taken.has(id)) id = cell ? mintCell(row) : mint(e.id);
    taken.add(id);
    ids.set(e.id, id);
  }

  const g = groupOf(root);
  const destEff = resolveParents(dest);
  const key = keyAfter(
    dest.filter((e) => destEff.get(e.id) === ROOT && groupOf(e) === g).map((e) => e[groupKey(g)]),
    GROUP_BOUNDS[g],
  );
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  const placed = (e: FlatElement): FlatElement => {
    const copy: FlatElement = { ...e, id: ids.get(e.id)!, parent: e === root ? ROOT : ids.get(eff.get(e.id)!)! };
    if (e !== root) return copy;
    delete copy.order;
    delete copy.z;
    copy[groupKey(g)] = key;
    if (options.at && g !== 'flow') copy.style = { ...copy.style, left: px(options.at.left), top: px(options.at.top) };
    return copy;
  };

  // the destination as it would stand, judged by the loader before anything is written
  const after: SlideIR = readSlide(doc, toBoard);
  const remap = (el: ElementIR, top: boolean): ElementIR => ({
    ...el,
    id: ids.get(el.id) ?? el.id,
    ...(top && options.at && g !== 'flow' && { style: { ...el.style, left: px(options.at.left), top: px(options.at.top) } }),
    children: el.children.map((c) => remap(c, false)),
  });
  after.children.push(remap(findIR(readSlide(doc, fromBoard).children, elementId)!, true));
  const loaded = loadSlide(serializeSlide(after), { fileId: toBoard });
  if (!loaded.ok) throw new BoardError(toBoard, [`board ${toBoard}: the move would leave it unloadable (${loaded.held.reasons.join('; ')})`]);

  const threads: string[] = [];
  transact(
    doc,
    () => {
      for (const e of moved) {
        const first: MoveOrigin = moveOriginOf(doc, fromBoard, e.id) ?? { board: fromBoard, element: e.id }; // stable across hops
        Y.deleteElement(doc, fromBoard, e.id);
        const copy = placed(e);
        Y.createElement(doc, toBoard, copy.id, { ...toScalars(copy), [MOVE_ORIGIN_KEY]: { ...first } }, e.text);
      }
      for (const t of Y.threadIds(doc)) {
        if (!Y.hasThread(doc, t)) continue;
        const s = Y.threadScalars(doc, t);
        const elementWas = String(s.elementId ?? '');
        if (s.slideId !== fromBoard || elementWas === ROOT || !ids.has(elementWas)) continue;
        Y.setThreadKey(doc, t, 'slideId', toBoard);
        Y.setThreadKey(doc, t, 'elementId', ids.get(elementWas)!);
        threads.push(t);
      }
    },
    origin,
  );
  return { ids, threads: threads.sort() };
}
