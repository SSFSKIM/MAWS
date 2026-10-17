// P3-E1 M1 (XE4 as amended by the parent's Decision Log 10 (1); Decision Log 13 (4)): an element moved across boards
// always takes a new id derived from the source board, the destination board and its old id (C's minter when that
// collides), its subtree with it, every thread anchored there rewritten in the move's one transaction; and a model-only
// origin association on each moved element, stable across later moves, so history can credit a move. E0's race proofs
// (keeping the id loses an element under a concurrent insertion of that id) ported against the module.
import { describe, expect, it } from 'vitest';
import { readFlat, readSlide, resolveAnchor, setStyle } from '../slides/model';
import { publishDeck } from '../slides/publish';
import { slidePath } from '../slides/deck';
import { deckFiles } from '../slides/model';
import { addThread, threadStates } from '../slides/threads';
import { applyV2, newDoc, stateV2, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { createDeckUndo } from '../yjs/slides-undo';
import { boardPath } from './canvas';
import { designFiles } from './model';
import { MOVE_ORIGIN_KEY, moveElementToBoard, moveOriginOf } from './move';
import { BoardError, duplicateBoard } from './writers';
import { design, replicaFrom, sync, updatesOf } from './fixtures/support';

const B1 = `<h1 id="title" style="font-size:72px">Title b1</h1><p id="e1" style="font-size:32px">Moved text</p><div id="card" style="display:flex; flex-direction:column"><p id="note" style="font-size:20px">Card note</p></div><p id="pin" style="position:absolute; left:10px; top:20px; width:100px">Pinned</p>`;
const B2 = `<h1 id="title" style="font-size:72px">Title b2</h1><p id="note" style="font-size:20px">B2 note</p>`;
const B3 = `<p id="other" style="font-size:20px">Other</p>`;
const human = { kind: 'human' as const };
const DERIVED = /^m[0-9a-z]{8}$/;
const MINTED = /^e\d+-[0-9a-z]{4}$/;

function fixture(clientId = 100): Doc {
  const doc = design(
    [
      { id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 }, body: B1 },
      { id: 'b2', at: { x: 500, y: 0, w: 1440, h: 1024 }, body: B2 },
      { id: 'b3', at: { x: 2000, y: 0, w: 390, h: 844 }, body: B3 },
    ],
    clientId,
  );
  for (const [threadId, slideId, elementId] of [
    ['t-e1', 'b1', 'e1'],
    ['t-title', 'b1', 'title'],
    ['t-note', 'b1', 'note'],
    ['t-b2title', 'b2', 'title'],
  ] as const)
    addThread(doc, { threadId, slideId, elementId, quote: '', by: human, at: 1, body: `on ${slideId}/${elementId}` }, 'deck-comments');
  return doc;
}
const anchor = (doc: Doc, t: string) => {
  const s = Y.threadScalars(doc, t);
  return { slideId: s.slideId, elementId: s.elementId };
};
const textOf = (doc: Doc, board: string, id: string) =>
  readFlat(doc, board)
    .find((e) => e.id === id)
    ?.text?.map((b) => b.inline.map((r) => ('text' in r ? r.text : '')).join(''))
    .join('\n');
const reload = (doc: Doc): Doc => {
  const fresh = newDoc();
  applyV2(fresh, stateV2(doc));
  return fresh;
};
const refusal = (write: () => void): string[] => {
  try {
    write();
  } catch (e) {
    expect(e).toBeInstanceOf(BoardError);
    return (e as BoardError).problems;
  }
  throw new Error('not refused');
};

describe('moveElementToBoard', () => {
  it('derives a new id, lands the element last in the destination’s flow with its text, and its thread follows, in one update', () => {
    const doc = fixture();
    let result!: ReturnType<typeof moveElementToBoard>;
    expect(updatesOf(doc, () => (result = moveElementToBoard(doc, 'b1', 'b2', 'e1')))).toHaveLength(1);
    const moved = result.ids.get('e1')!;
    expect(moved).toMatch(DERIVED);
    expect(result.threads).toEqual(['t-e1']);
    expect(Y.hasElement(doc, 'b1', 'e1')).toBe(false);
    expect(Y.elementScalars(doc, 'b2', moved)).toMatchObject({ tag: 'p', parent: '', 'style:font-size': '32px' });
    expect(textOf(doc, 'b2', moved)).toBe('Moved text');
    expect(readSlide(doc, 'b2').children.map((c) => c.id)).toEqual(['title', 'note', moved]);
    expect(anchor(doc, 't-e1')).toEqual({ slideId: 'b2', elementId: moved });
    expect(threadStates(doc).find((t) => t.id === 't-e1')).toMatchObject({ live: true, orphan: false, quote: 'Moved text' });
    // the id is a function of the move alone: another replica moving the same element derives the same one
    expect(moveElementToBoard(fixture(999), 'b1', 'b2', 'e1').ids.get('e1')).toBe(moved);
  });

  it('moves a container’s whole subtree under derived ids, rewriting its descendants’ threads, and one ⌘Z restores both boards', () => {
    const doc = fixture();
    const before = { b1: readSlide(doc, 'b1'), b2: readSlide(doc, 'b2') };
    const undo = createDeckUndo(doc);
    undo.cut();
    const { ids, threads } = moveElementToBoard(doc, 'b1', 'b2', 'card', {}, undo.origin);
    undo.cut();
    const [card, note] = [ids.get('card')!, ids.get('note')!];
    expect([card, note].every((id) => DERIVED.test(id))).toBe(true);
    expect(Y.elementScalars(doc, 'b2', note).parent).toBe(card);
    expect(textOf(doc, 'b2', 'note')).toBe('B2 note'); // the destination's own `note` untouched
    expect(threads).toEqual(['t-note']);
    expect(anchor(doc, 't-note')).toEqual({ slideId: 'b2', elementId: note });
    expect(undo.undo()).toBe(true);
    expect(readSlide(doc, 'b1')).toEqual(before.b1);
    expect(readSlide(doc, 'b2')).toEqual(before.b2);
    expect(anchor(doc, 't-note')).toEqual({ slideId: 'b1', elementId: 'note' });
    expect(threadStates(doc).every((t) => t.live && !t.orphan)).toBe(true);
  });

  it('places a pinned element at the given left and top, front of the destination’s stack', () => {
    const doc = fixture();
    const { ids } = moveElementToBoard(doc, 'b1', 'b3', 'pin', { at: { left: 40.5, top: 60 } });
    expect(Y.elementScalars(doc, 'b3', ids.get('pin')!)).toMatchObject({ 'style:position': 'absolute', 'style:left': '40.5px', 'style:top': '60px', 'style:width': '100px' });
  });

  it('falls back to C’s minter when the derived id is taken in the destination, and records the origin all the same', () => {
    const doc = fixture();
    const derived = moveElementToBoard(fixture(), 'b1', 'b2', 'e1').ids.get('e1')!;
    Y.createElement(doc, 'b2', derived, { tag: 'p', parent: '', order: 'a5' }, [{ type: 'p', inline: [{ text: 'Squatter', marks: {} }] }]);
    const { ids } = moveElementToBoard(doc, 'b1', 'b2', 'e1');
    expect(ids.get('e1')).toMatch(MINTED);
    expect(textOf(doc, 'b2', derived)).toBe('Squatter');
    expect(textOf(doc, 'b2', ids.get('e1')!)).toBe('Moved text');
    expect(moveOriginOf(doc, 'b2', ids.get('e1')!)).toEqual({ board: 'b1', element: 'e1' });
  });

  it('refuses a move within one board, of an element that is not there, onto a held, missing or overfull board, writing nothing', () => {
    const doc = fixture();
    const before = designFiles(doc);
    expect(refusal(() => moveElementToBoard(doc, 'b1', 'b1', 'e1'))).toEqual(['board b1: a move within one board is a re-parent, not a cross-board move']);
    expect(refusal(() => moveElementToBoard(doc, 'b1', 'b2', 'nope'))).toEqual(['board b1: no element nope']);
    expect(refusal(() => moveElementToBoard(doc, 'b1', 'zz', 'e1'))).toEqual(['board zz: no such board']);
    // a cell alone cannot stand on a board: the destination's file would not load
    const table = design([
      { id: 'a', at: { x: 0, y: 0, w: 100, h: 100 }, body: '<table id="t"><tr id="r"><td>x</td></tr></table>' },
      { id: 'b', at: { x: 0, y: 0, w: 100, h: 100 } },
    ]);
    expect(refusal(() => moveElementToBoard(table, 'a', 'b', 'r'))[0]).toMatch(/^board b: the move would leave it unloadable \(/);
    // the dialect's 24 pinned children per host (Decision Log 10)
    const pins = Array.from({ length: 24 }, (_, i) => `<p id="p${i}" style="position:absolute; left:${i}px; top:0px">${i}</p>`).join('');
    const full = design([
      { id: 'a', at: { x: 0, y: 0, w: 100, h: 100 }, body: '<p id="one" style="position:absolute; left:0px; top:0px">1</p>' },
      { id: 'b', at: { x: 0, y: 0, w: 100, h: 100 }, body: pins },
    ]);
    expect(refusal(() => moveElementToBoard(full, 'a', 'b', 'one'))[0]).toMatch(/^board b: the move would leave it unloadable \(.*pinned/);
    Y.setSlideKey(doc, 'b3', 'held', { source: '<section id="b3"><script></script></section>', reasons: ['no'] });
    expect(refusal(() => moveElementToBoard(doc, 'b1', 'b3', 'e1'))).toEqual(['board b3: its file does not load (held); fix it first']);
    expect(designFiles(doc)).toEqual({ ...before, [boardPath('b3')]: '<section id="b3"><script></script></section>' });
  });
});

describe('the race E0 reproduced: a move against a concurrent insertion of the same id into the destination', () => {
  type Insert = 'createElement' | 'publishDeck';
  const insertE1 = (b: Doc, how: Insert) => {
    if (how === 'createElement') Y.createElement(b, 'b2', 'e1', { tag: 'p', parent: '', order: 'a5', 'style:font-size': '24px' }, [{ type: 'p', inline: [{ text: 'Agent e1', marks: {} }] }]);
    else {
      const read = deckFiles(b);
      const out = publishDeck(b, read, { [slidePath('b2')]: read[slidePath('b2')]!.replace('</section>', '<p id="e1" style="font-size:24px">Agent e1</p></section>') }, false);
      expect(out.conflicts).toEqual([]);
    }
  };
  for (const how of ['createElement', 'publishDeck'] as const)
    it(`keeps both elements in both clientID orders, the thread on the moved one (B inserting through ${how})`, () => {
      for (const [ca, cb] of [
        [20, 10],
        [10, 20],
      ] as const) {
        const base = fixture();
        const a = replicaFrom(base, ca); // the owner, moving
        const b = replicaFrom(base, cb); // the agent's host replica, publishing
        const moved = moveElementToBoard(a, 'b1', 'b2', 'e1').ids.get('e1')!;
        insertE1(b, how);
        sync(a, b);
        expect(a.get(Y.SLIDES_ROOT).toJSON()).toEqual(b.get(Y.SLIDES_ROOT).toJSON());
        expect(Object.fromEntries(['e1', moved].map((id) => [id, textOf(a, 'b2', id)]))).toEqual({ e1: 'Agent e1', [moved]: 'Moved text' });
        expect(threadStates(a).find((t) => t.id === 't-e1')).toMatchObject({ slideId: 'b2', elementId: moved, live: true, orphan: false, quote: 'Moved text' });
      }
    });

  it('leaves one copy when two replicas move one element into one board at once (both derive one id), its subtree’s threads on it', () => {
    for (const [ca, cb] of [
      [20, 10],
      [10, 20],
    ] as const) {
      const base = fixture();
      const a = replicaFrom(base, ca);
      const b = replicaFrom(base, cb);
      moveElementToBoard(a, 'b1', 'b2', 'card');
      moveElementToBoard(b, 'b1', 'b2', 'card');
      sync(a, b);
      const copies = Y.elementIds(a, 'b2').filter((id) => textOf(a, 'b2', id) === 'Card note');
      expect(copies).toHaveLength(1);
      expect(anchor(a, 't-note')).toEqual({ slideId: 'b2', elementId: copies[0] });
      expect(resolveAnchor(a, { slideId: 'b2', elementId: copies[0]! }).live).toBe(true);
    }
  });

  it('leaves a copy on each board when two replicas move one element to two boards at once; the thread follows one, live', () => {
    const base = fixture();
    const a = replicaFrom(base, 10);
    const b = replicaFrom(base, 20);
    moveElementToBoard(a, 'b1', 'b2', 'e1');
    moveElementToBoard(b, 'b1', 'b3', 'e1');
    sync(a, b);
    const on = (board: string) => Y.elementIds(a, board).filter((id) => textOf(a, board, id) === 'Moved text');
    expect([on('b2').length, on('b3').length]).toEqual([1, 1]);
    const t = anchor(a, 't-e1');
    expect(resolveAnchor(a, { slideId: String(t.slideId), elementId: String(t.elementId) }).live).toBe(true);
  });
});

describe('the move-origin association (model-only, for history)', () => {
  it('names the element’s first source across later moves, survives an encode and reload, and never reaches a file', () => {
    const doc = fixture();
    const first = moveElementToBoard(doc, 'b1', 'b2', 'card').ids;
    expect(moveOriginOf(doc, 'b2', first.get('card')!)).toEqual({ board: 'b1', element: 'card' });
    expect(moveOriginOf(doc, 'b2', first.get('note')!)).toEqual({ board: 'b1', element: 'note' });
    const again = reload(doc);
    const second = moveElementToBoard(again, 'b2', 'b3', first.get('card')!).ids;
    const card = second.get(first.get('card')!)!;
    expect(card).not.toBe(first.get('card'));
    const after = reload(again);
    expect(moveOriginOf(after, 'b3', card)).toEqual({ board: 'b1', element: 'card' });
    expect(moveOriginOf(after, 'b3', second.get(first.get('note')!)!)).toEqual({ board: 'b1', element: 'note' });
    expect(moveOriginOf(after, 'b2', 'title')).toBeNull(); // never moved
    const stripped = reload(after);
    for (const board of ['b2', 'b3']) for (const id of Y.elementIds(stripped, board)) Y.deleteElementKey(stripped, board, id, MOVE_ORIGIN_KEY);
    expect(designFiles(after)).toEqual(designFiles(stripped)); // no file carries it
    expect(anchor(after, 't-note')).toEqual({ slideId: 'b3', elementId: second.get(first.get('note')!) });
  });

  it('keeps the first origin through a collision-fallback hop', () => {
    const doc = fixture();
    const m1 = moveElementToBoard(doc, 'b1', 'b2', 'e1').ids.get('e1')!;
    const derived = moveElementToBoard(fixture(), 'b1', 'b2', 'e1').ids.get('e1')!;
    expect(m1).toBe(derived);
    const squat = moveElementToBoard(reload(doc), 'b2', 'b3', m1).ids.get(m1)!; // where the next hop would land
    Y.createElement(doc, 'b3', squat, { tag: 'p', parent: '', order: 'a5' }, [{ type: 'p', inline: [{ text: 'Squatter', marks: {} }] }]);
    const m2 = moveElementToBoard(doc, 'b2', 'b3', m1).ids.get(m1)!;
    expect(m2).toMatch(MINTED);
    expect(moveOriginOf(reload(doc), 'b3', m2)).toEqual({ board: 'b1', element: 'e1' });
  });

  it('stays through an edit of the moved element and is not copied by a board duplicate', () => {
    const doc = fixture();
    const m = moveElementToBoard(doc, 'b1', 'b2', 'e1').ids.get('e1')!;
    setStyle(doc, 'b2', m, { color: '#123456' });
    expect(moveOriginOf(doc, 'b2', m)).toEqual({ board: 'b1', element: 'e1' });
    const { id, elements } = duplicateBoard(doc, 'b2');
    expect(moveOriginOf(doc, id, elements.get(m)!)).toBeNull();
    expect(Y.elementScalars(doc, id, elements.get(m)!)[MOVE_ORIGIN_KEY]).toBeUndefined();
  });
});
