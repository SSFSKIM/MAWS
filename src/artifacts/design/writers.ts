// P3-E1 M1 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, "Execution constraints"; the parent's §1
// "Identity", XE4): the workbench's board writers beside C's element writers, one gesture one transaction with the
// caller's origin (C's undo scope tracks it, so a board move and an element restyle undo as one stack). A frame is checked
// by the manifest's one rule (`frameProblems`) and refused naming the board, nothing written; never clamped. C's
// `duplicateSlide` keeps element ids and drops the geometry (Decision Log 10), so the duplicate here mints a new board id
// and new element ids, keeps the notes, size and title, and copies no conversation.
import type { SlideIR } from '../slides/ir';
import { cellMinter, deleteSlide, elementMinter, insertSlide, readFlat, ROOT, toScalars } from '../slides/model';
import { CELL_TAGS } from '../slides/ir';
import { ID_RE, loadSlide } from '../slides/parse';
import { mintSlideId } from '../slides/writers';
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { CANVAS_LIMITS, FRAME_KEYS, frameProblems, type BoardFrame } from './canvas';
import { boardEntry, boardFrame, isMissingSource, PLACEMENT_GAP, writeBoardEntry } from './model';

/** A board write the model refuses: the board and every reason, each naming the board. */
export class BoardError extends Error {
  constructor(
    readonly board: string,
    readonly problems: string[],
  ) {
    super(problems.join('; '));
    this.name = 'BoardError';
  }
}

const exists = (doc: Doc, id: string) => {
  if (!Y.hasSlide(doc, id)) throw new BoardError(id, [`board ${id}: no such board`]);
};
const refuseIf = (board: string, problems: string[]) => {
  if (problems.length > 0) throw new BoardError(board, problems);
};
function needRoom(doc: Doc, board: string): void {
  if (Y.slideIds(doc).length >= CANVAS_LIMITS.boards) throw new BoardError(board, [`a design holds at most ${CANVAS_LIMITS.boards} boards`]);
}
function newId(doc: Doc, id: string): void {
  if (!ID_RE.test(id)) throw new BoardError(id, [`board id "${id}" is not [A-Za-z0-9_-]{1,64}`]);
  if (Y.hasSlide(doc, id)) throw new BoardError(id, [`board ${id}: the design already holds it`]);
}

/** Moves or resizes a board: the keys given, the whole frame checked as it would stand; nothing written when unchanged. */
export function setBoardFrame(doc: Doc, boardId: string, frame: Partial<BoardFrame>, origin?: unknown): void {
  exists(doc, boardId);
  const s = Y.slideScalars(doc, boardId);
  const next: Record<string, unknown> = {};
  for (const k of FRAME_KEYS) next[k] = k in frame ? frame[k] : s[k];
  refuseIf(boardId, frameProblems(boardId, next));
  const changed = FRAME_KEYS.filter((k) => k in frame && s[k] !== frame[k]);
  if (changed.length === 0) return;
  transact(doc, () => changed.forEach((k) => Y.setSlideKey(doc, boardId, k, frame[k]!)), origin);
}

/** A blank board: the design system's ground. Built through the loader, as every write is. */
export function blankBoard(id: string): SlideIR {
  const loaded = loadSlide(`<section id="${id}" style="background:var(--ds-color-bg, #ffffff)"></section>`, { fileId: id });
  if (!loaded.ok) throw new Error(`a blank board does not load: ${loaded.held.reasons.join('; ')}`);
  return loaded.slide;
}

export interface NewBoard {
  id: string;
  frame: BoardFrame;
  title?: string;
  /** Its content (a layout, a paste); blank when absent. Its id must be the board's. */
  slide?: SlideIR;
}

/** A new board after `afterId` (first when null): its content, frame and title in one transaction. */
export function insertBoard(doc: Doc, board: NewBoard, afterId: string | null, origin?: unknown): void {
  newId(doc, board.id);
  const missing = FRAME_KEYS.filter((k) => !(k in board.frame));
  refuseIf(board.id, missing.length ? [`board ${board.id}: a frame has x, y, w and h`] : frameProblems(board.id, board.frame));
  if (board.slide && board.slide.id !== board.id) throw new BoardError(board.id, [`board ${board.id}: its content is board ${board.slide.id}’s`]);
  needRoom(doc, board.id);
  transact(
    doc,
    () => {
      insertSlide(doc, board.slide ?? blankBoard(board.id), afterId);
      writeBoardEntry(doc, board.id, { ...board.frame, ...(board.title !== undefined && { title: board.title }) });
    },
    origin,
  );
}

/**
 * A copy of a board right after it under a new id (minted as C mints slide ids, or `options.id`): every element under a
 * new id (C's minters), its notes, size, title and kept manifest keys; placed right of the original a gap apart unless
 * `options.at` says where. Its conversations are not copied. A held or missing-source board has nothing to copy. Returns
 * the new id and each original element's copy.
 */
export function duplicateBoard(doc: Doc, boardId: string, options: { id?: string; at?: { x: number; y: number } } = {}, origin?: unknown): { id: string; elements: Map<string, string> } {
  exists(doc, boardId);
  const s = Y.slideScalars(doc, boardId);
  if (s.held) throw new BoardError(boardId, [`board ${boardId}: its file does not load (held), so there is nothing to copy`]);
  if (isMissingSource(doc, boardId)) throw new BoardError(boardId, [`board ${boardId}: its file never arrived, so there is nothing to copy`]);
  const id = options.id ?? mintSlideId(doc);
  newId(doc, id);
  needRoom(doc, id);
  const frame = boardFrame(doc, boardId);
  const at = options.at ?? (frame ? { x: frame.x + frame.w + PLACEMENT_GAP, y: frame.y } : undefined);
  const entry = { ...boardEntry(doc, boardId), ...at };
  refuseIf(id, frameProblems(id, entry));

  const els = readFlat(doc, boardId, true);
  const taken = els.map((e) => e.id);
  const mint = elementMinter(doc, id, taken);
  const mintCell = cellMinter(doc, taken);
  const ids = new Map<string, string>();
  const byId = new Map(els.map((e) => [e.id, e]));
  // a cell's id is its row's and a token, so rows first: parents before children, by the stored parent chain
  const depth = (e: (typeof els)[number]): number => {
    let n = 0;
    for (let p = e.parent; p !== ROOT && byId.has(p) && n <= els.length; p = byId.get(p)!.parent) n++;
    return n;
  };
  const sorted = [...els].sort((a, b) => depth(a) - depth(b));
  for (const e of sorted) ids.set(e.id, CELL_TAGS.has(e.tag) ? mintCell(ids.get(e.parent) ?? e.parent) : mint(e.id));

  const section: SlideIR = { id, attrs: {}, style: {}, children: [], notes: Y.readNotes(doc, boardId) };
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith('style:')) section.style[k.slice(6)] = v as string;
    else if (k.startsWith('attr:')) section.attrs[k.slice(5)] = v as string;
  }
  transact(
    doc,
    () => {
      insertSlide(doc, section, boardId);
      writeBoardEntry(doc, id, entry);
      for (const e of sorted) Y.createElement(doc, id, ids.get(e.id)!, toScalars({ ...e, id: ids.get(e.id)!, parent: e.parent === ROOT ? ROOT : (ids.get(e.parent) ?? ROOT) }), e.text);
    },
    origin,
  );
  return { id, elements: ids };
}

/** Removes a board (C's slide removal: every thread anchored on it keeps its last text, the board's own included). */
export function deleteBoard(doc: Doc, boardId: string, origin?: unknown): void {
  deleteSlide(doc, boardId, origin);
}
