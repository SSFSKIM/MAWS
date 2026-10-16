// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the parent's Decision Logs 13 (4) and 23):
// the design's projection of C's per-board history (../slides/history.ts, `deckChanges`). C diffs by ids, so an element
// moved across boards (XE4: always a new id at the destination, derived or minted) reads there as a removal from its
// source and an addition to its destination. The projection pairs the two through the model-only origin association
// (`moveOrigin`, move.ts), read on both sides: an element's logical identity is its origin when it carries one, else its
// own board and id, so a move of several hops, a collision-fallback id, a retained version's bytes after a restart and a
// move back home all pair. Removals and additions are taken from C's per-element lists and, for a board added or removed
// whole (whose elements C does not list), from the board's elements in that state. Only removals and additions pair,
// one with one per identity: an element present on both sides keeps its own identity, and an ambiguous identity (two
// candidates on a side) stays as C reads it.
//
// A paired move across boards is one change at its destination, credited to whoever added it there, carrying what else
// differs in it (its geometry, its style, its text; never the association, its parent or its place in the stack, which
// the move itself sets), and its moved descendants grouped under it, each counted only for a change of its own. A pair on
// one board is an element that went away and came back: shown as a change of what actually differs, or nothing. The
// source keeps a ghost entry, `movedAway`, that counts nothing. The count and ↑ ↓'s stops are this projection's: the
// workbench's bar and navigation read them, and the new-change pill counts them through C's `countChanges` hook, so the
// pill and the preview agree. Pure: no DOM.
import type { DeckChanges, DeckDiff, ElementChange, KeyChange, SlideChange, Touch } from '../slides/history';
import { ROOT } from '../slides/model';
import type { Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { MOVE_ORIGIN_KEY, moveOriginOf } from './move';

/** An element moved here from another board (its id here), with what else changed in it and what moved with it. */
export interface ElementMove extends Touch {
  kind: 'moved';
  id: string;
  from: { board: string; id: string };
  /** What differs beyond the move itself (its geometry, style or text), each credited to the move. */
  keys: KeyChange[];
  /** Its descendants as they are here, moved with it. */
  descendants: string[];
}
/** An element that left this board for another (its id here before), drawn as a ghost where it was; counts nothing. */
export interface ElementMovedAway extends Touch {
  kind: 'movedAway';
  id: string;
  to: { board: string; id: string };
}
export type DesignElementChange = ElementChange | ElementMove | ElementMovedAway;

export interface DesignBoardChange extends Touch {
  id: string;
  kind: SlideChange['kind'];
  /** The board's own keys that changed: its frame (`x`, `y`, `w`, `h`), title, fill. */
  keys: KeyChange[];
  elements: DesignElementChange[];
  /** How many runs of its (hidden) notes changed. */
  notes: number;
}

export interface DesignChanges {
  deck: DeckChanges['deck'];
  /** C's board order: the shown design's, a removed board at its earlier place. */
  boards: DesignBoardChange[];
  /** "N changes": the deck, each board added or removed or with its own keys or notes changed, each element change. */
  count: number;
}

/** One stop of ↑ ↓, in the order they visit. */
export type DesignStop = { part: 'deck' } | { part: 'board'; boardId: string } | { part: 'element'; boardId: string; elementId: string };

interface Side extends Touch {
  board: string;
  id: string;
}

const identity = (doc: Doc, board: string, id: string): string => {
  const origin = moveOriginOf(doc, board, id);
  return origin ? `${origin.board}\u0000${origin.element}` : `${board}\u0000${id}`;
};

/** The removals and additions a change set holds, a whole board's elements read from its state. */
function sidesOf(changes: DeckChanges, prev: Doc, next: Doc): { removals: Side[]; additions: Side[] } {
  const removals: Side[] = [];
  const additions: Side[] = [];
  for (const s of changes.slides) {
    if (s.kind === 'removed') for (const id of Y.hasSlide(prev, s.id) ? Y.elementIds(prev, s.id) : []) removals.push({ board: s.id, id, by: s.by, at: s.at });
    else if (s.kind === 'added') for (const id of Y.hasSlide(next, s.id) ? Y.elementIds(next, s.id) : []) additions.push({ board: s.id, id, by: s.by, at: s.at });
    else
      for (const e of s.elements) {
        if (e.kind === 'removed') removals.push({ board: s.id, id: e.id, by: e.by, at: e.at });
        else if (e.kind === 'added') additions.push({ board: s.id, id: e.id, by: e.by, at: e.at });
      }
  }
  return { removals, additions };
}

/** One removal with one addition per identity; any identity with more than one on a side stays as it is. */
function pairsOf(removals: Side[], additions: Side[], prev: Doc, next: Doc): { removal: Side; addition: Side }[] {
  const group = (sides: Side[], doc: Doc) => {
    const out = new Map<string, Side[]>();
    for (const side of sides) {
      const key = identity(doc, side.board, side.id);
      out.set(key, [...(out.get(key) ?? []), side]);
    }
    return out;
  };
  const gone = group(removals, prev);
  const came = group(additions, next);
  const pairs: { removal: Side; addition: Side }[] = [];
  for (const [key, [removal, ...moreGone]] of gone) {
    const [addition, ...moreCame] = came.get(key) ?? [];
    if (removal && addition && moreGone.length === 0 && moreCame.length === 0) pairs.push({ removal, addition });
  }
  return pairs;
}

const plain = (v: unknown): string => JSON.stringify(v);

/**
 * What differs between an element as it was and as it is (its scalars and its text), ignoring the association, and its
 * parent when `parent` says the parent is the same one; `place` ignores the paint keys too (a move sets them).
 */
function differences(prev: Doc, was: Side, next: Doc, now: Side, ignore: { parentSame: boolean; place: boolean }, touch: Touch): KeyChange[] {
  const a = Y.elementScalars(prev, was.board, was.id);
  const b = Y.elementScalars(next, now.board, now.id);
  const skip = new Set<string>([MOVE_ORIGIN_KEY, ...(ignore.parentSame ? ['parent'] : []), ...(ignore.place ? ['parent', 'order', 'z'] : [])]);
  const keys: KeyChange[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (skip.has(key) || plain(a[key]) === plain(b[key])) continue;
    keys.push({ key, kind: key in b ? 'set' : 'removed', by: touch.by, at: touch.at });
  }
  const text = (doc: Doc, s: Side) => (Y.hasText(doc, s.board, s.id) ? plain(Y.readText(doc, s.board, s.id)) : '');
  if (text(prev, was) !== text(next, now)) keys.push({ key: 'text', kind: 'set', by: touch.by, at: touch.at });
  return keys.sort((x, y) => (x.key < y.key ? -1 : 1));
}

const touchOf = (t: Touch): Touch => ({ by: t.by, at: t.at });

/** The design's projection of C's change set over the same two states (module header). */
export function designChanges(docs: Pick<DeckDiff, 'prevDoc' | 'nextDoc'>, changes: DeckChanges): DesignChanges {
  const { prevDoc: prev, nextDoc: next } = docs;
  const { removals, additions } = sidesOf(changes, prev, next);
  const pairs = pairsOf(removals, additions, prev, next);
  const at = (s: Side) => `${s.board}\u0000${s.id}`;
  const paired = new Set(pairs.flatMap(({ removal, addition }) => [`-${at(removal)}`, `+${at(addition)}`]));
  const byAddition = new Map(pairs.map((p) => [at(p.addition), p]));
  const byRemoval = new Map(pairs.map((p) => [at(p.removal), p]));

  // a paired addition whose parent here is a paired addition on the same board moved with it: the topmost one is the root
  const parentOf = (s: Side) => String(Y.elementScalars(next, s.board, s.id).parent ?? ROOT);
  const rootOf = (s: Side): Side => {
    let cur = s;
    for (let hops = 0; hops < 10_000; hops++) {
      const parent = parentOf(cur);
      const up = parent === ROOT ? undefined : byAddition.get(`${cur.board}\u0000${parent}`);
      if (!up || up.removal.board === up.addition.board) return cur;
      cur = up.addition;
    }
    return cur;
  };

  const added = new Map<string, DesignElementChange[]>(); // board → the projection's own entries
  const push = (board: string, entry: DesignElementChange) => added.set(board, [...(added.get(board) ?? []), entry]);
  const moves = new Map<string, ElementMove>();
  for (const { removal, addition } of pairs) {
    const touch = touchOf(addition);
    const earlierParent = String(Y.elementScalars(prev, removal.board, removal.id).parent ?? ROOT);
    const mappedParent = earlierParent === ROOT ? ROOT : (byRemoval.get(`${removal.board}\u0000${earlierParent}`)?.addition.id ?? earlierParent);
    const parentSame = mappedParent === parentOf(addition);
    if (removal.board === addition.board) {
      // home again: what actually differs, or nothing
      const keys = differences(prev, removal, next, addition, { parentSame, place: false }, touch);
      if (keys.length > 0) push(addition.board, { id: addition.id, kind: 'changed', keys, ...touch });
      continue;
    }
    const root = rootOf(addition);
    if (root !== addition) {
      const keys = differences(prev, removal, next, addition, { parentSame, place: false }, touch);
      if (keys.length > 0) push(addition.board, { id: addition.id, kind: 'changed', keys, ...touch });
      continue;
    }
    const move: ElementMove = { kind: 'moved', id: addition.id, from: { board: removal.board, id: removal.id }, keys: differences(prev, removal, next, addition, { parentSame, place: true }, touch), descendants: [], ...touch };
    moves.set(at(addition), move);
    push(addition.board, move);
    push(removal.board, { kind: 'movedAway', id: removal.id, to: { board: addition.board, id: addition.id }, ...touchOf(removal) });
  }
  for (const { removal, addition } of pairs) {
    if (removal.board === addition.board) continue;
    const root = rootOf(addition);
    if (root !== addition) moves.get(at(root))?.descendants.push(addition.id);
  }

  const boards: DesignBoardChange[] = [];
  for (const s of changes.slides) {
    const pairedHere = (e: ElementChange) => (e.kind === 'removed' && paired.has(`-${s.id}\u0000${e.id}`)) || (e.kind === 'added' && paired.has(`+${s.id}\u0000${e.id}`));
    const own = s.kind === 'changed' ? s.elements.filter((e) => !pairedHere(e)) : [];
    const elements: DesignElementChange[] = [...own, ...(added.get(s.id) ?? [])];
    const board: DesignBoardChange = { id: s.id, kind: s.kind, keys: s.kind === 'changed' ? s.keys : [], elements, notes: s.kind === 'changed' ? s.notes.length : 0, by: s.by, at: s.at };
    if (board.kind === 'changed' && board.keys.length === 0 && board.notes === 0 && elements.length === 0) continue;
    boards.push(board);
  }
  const count = (changes.deck ? 1 : 0) + boards.reduce((n, b) => n + (b.kind !== 'changed' ? 1 : (b.keys.length > 0 ? 1 : 0) + b.notes) + b.elements.filter((e) => e.kind !== 'movedAway').length, 0);
  return { deck: changes.deck, boards, count };
}

/** ↑ ↓'s stops: the deck, then per board its own change, then each element change but the ghosts of moves away. */
export function designStops(changes: DesignChanges): DesignStop[] {
  const stops: DesignStop[] = [];
  if (changes.deck) stops.push({ part: 'deck' });
  for (const b of changes.boards) {
    if (b.kind !== 'changed' || b.keys.length > 0 || b.notes > 0) stops.push({ part: 'board', boardId: b.id });
    for (const e of b.elements) if (e.kind !== 'movedAway') stops.push({ part: 'element', boardId: b.id, elementId: e.id });
  }
  return stops;
}

/** C's `countChanges` hook for a design's history controller: the projection's count (Decision Log 23). */
export const countDesignChanges = (diff: Pick<DeckDiff, 'prevDoc' | 'nextDoc'>, changes: DeckChanges): number => designChanges(diff, changes).count;
