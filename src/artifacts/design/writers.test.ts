// P3-E1 M1: the workbench's board writers, one gesture one transaction with the caller's origin: frames checked by the
// manifest's one rule and refused (never clamped) with nothing written; insertion and deletion; and duplication with new
// board and element ids, the board's notes and size kept, its conversations not copied.
import { describe, expect, it } from 'vitest';
import { readFlat, readSlide, setStyle, slideOrder } from '../slides/model';
import { addThread, threadStates } from '../slides/threads';
import { transact } from '../yjs';
import * as Y from '../yjs/slides';
import { createDeckUndo } from '../yjs/slides-undo';
import { CANVAS_LIMITS } from './canvas';
import { boardFrame, designFiles, MISSING_SOURCE_KEY, readCanvas, writeBoardEntry } from './model';
import { BoardError, blankBoard, deleteBoard, duplicateBoard, insertBoard, setBoardFrame } from './writers';
import { BOARDS, boardIR, design, updatesOf } from './fixtures/support';

const human = { kind: 'human' as const };
const refusal = (write: () => void): string[] => {
  try {
    write();
  } catch (e) {
    expect(e).toBeInstanceOf(BoardError);
    return (e as BoardError).problems;
  }
  throw new Error('not refused');
};

describe('setBoardFrame', () => {
  it('writes the changed keys in one transaction under the caller’s origin, nothing when nothing changes', () => {
    const doc = design();
    const origin = { editor: 'design' };
    let seen: unknown;
    doc.on('afterTransaction', (tr: { origin: unknown }) => void (seen = tr.origin));
    expect(updatesOf(doc, () => setBoardFrame(doc, 'b2', { x: 640, w: 1200 }, origin))).toHaveLength(1);
    expect(seen).toBe(origin);
    expect(boardFrame(doc, 'b2')).toEqual({ x: 640, y: 0, w: 1200, h: 1024 });
    expect(updatesOf(doc, () => setBoardFrame(doc, 'b2', { x: 640 }, origin))).toHaveLength(0);
  });

  it('refuses a frame outside the cap or of the wrong type, naming the board, and writes nothing', () => {
    const doc = design();
    const before = designFiles(doc);
    expect(refusal(() => setBoardFrame(doc, 'b2', { w: 16_385 }))).toEqual(['board b2: w is 16385 px (over 16384 px a side)']);
    expect(refusal(() => setBoardFrame(doc, 'b3', { w: 8193 }))).toEqual(['board b3: 8193×8192 is 67117056 px (over 67108864 px)']);
    expect(refusal(() => setBoardFrame(doc, 'b1', { x: Number.NaN, h: 0 }))).toEqual(['board b1: x is not a finite number', 'board b1: h is 0 (a side is more than 0 px)']);
    expect(refusal(() => setBoardFrame(doc, 'nope', { x: 1 }))).toEqual(['board nope: no such board']);
    expect(designFiles(doc)).toEqual(before);
  });

  it('shares C’s one undo stack with the element edits of the same gesture', () => {
    const doc = design();
    const undo = createDeckUndo(doc);
    undo.cut();
    setBoardFrame(doc, 'b1', { x: 100, y: 50 }, undo.origin);
    setStyle(doc, 'b1', 'title', { color: '#ff0000' }, undo.origin);
    undo.cut();
    setBoardFrame(doc, 'b2', { w: 1000 }, undo.origin);
    undo.cut();
    expect(undo.undo()).toBe(true);
    expect(boardFrame(doc, 'b2')).toEqual(BOARDS[1]!.at);
    expect(boardFrame(doc, 'b1')).toEqual({ ...BOARDS[0]!.at, x: 100, y: 50 });
    expect(undo.undo()).toBe(true);
    expect(boardFrame(doc, 'b1')).toEqual(BOARDS[0]!.at);
    expect(readSlide(doc, 'b1').children[0]!.style.color).toBeUndefined();
    expect(undo.canUndo()).toBe(false);
  });
});

describe('insertBoard', () => {
  it('creates the board after the one named (first when null), its frame, title and content in one transaction', () => {
    const doc = design();
    const updates = updatesOf(doc, () => insertBoard(doc, { id: 'tab', frame: { x: 0, y: 2000, w: 834, h: 1194 }, title: 'Tablet', slide: boardIR('tab') }, 'b1'));
    expect(updates).toHaveLength(1);
    expect(slideOrder(doc)).toEqual(['b1', 'tab', 'b2', 'b3']);
    expect(readCanvas(doc).boards.tab).toEqual({ x: 0, y: 2000, w: 834, h: 1194, title: 'Tablet' });
    insertBoard(doc, { id: 'first', frame: { x: 0, y: 0, w: 10, h: 10 } }, null);
    expect(slideOrder(doc)[0]).toBe('first');
    expect(readSlide(doc, 'first')).toEqual(blankBoard('first'));
  });

  it('refuses an invalid frame, a bad or taken id, content of another id and a design at its board limit, writing nothing', () => {
    const doc = design();
    const before = designFiles(doc);
    expect(refusal(() => insertBoard(doc, { id: 'x', frame: { x: 0, y: 0, w: 16_384, h: 16_384 } }, null))).toEqual(['board x: 16384×16384 is 268435456 px (over 67108864 px)']);
    expect(refusal(() => insertBoard(doc, { id: 'x', frame: { x: 0, y: 0, w: 1 } as never }, null))).toEqual(['board x: a frame has x, y, w and h']);
    expect(refusal(() => insertBoard(doc, { id: 'a b', frame: { x: 0, y: 0, w: 1, h: 1 } }, null))).toEqual(['board id "a b" is not [A-Za-z0-9_-]{1,64}']);
    expect(refusal(() => insertBoard(doc, { id: 'b1', frame: { x: 0, y: 0, w: 1, h: 1 } }, null))).toEqual(['board b1: the design already holds it']);
    expect(refusal(() => insertBoard(doc, { id: 'x', frame: { x: 0, y: 0, w: 1, h: 1 }, slide: boardIR('y') }, null))).toEqual(['board x: its content is board y’s']);
    expect(designFiles(doc)).toEqual(before);
    const full = design(Array.from({ length: CANVAS_LIMITS.boards }, (_, i) => ({ id: `b${i}`, at: { x: i * 10, y: 0, w: 1, h: 1 } })));
    expect(refusal(() => insertBoard(full, { id: 'one-more', frame: { x: 0, y: 0, w: 1, h: 1 } }, null))).toEqual(['a design holds at most 200 boards']);
  });
});

describe('duplicateBoard', () => {
  const TABLE = '<h1 id="title" style="font-size:72px">Pricing</h1><table id="t"><tr id="r1"><td>A</td><td>B</td></tr></table><div id="g" style="display:flex"><p id="inner" style="font-size:20px">Inner</p></div>';

  it('copies a board under a new id with new element ids, its notes, size and title, right of the original and after it in order', () => {
    const doc = design([
      { id: 'b1', at: { x: 0, y: 40, w: 390, h: 844 }, body: TABLE, notes: 'Say the price', title: 'Pricing' },
      { id: 'b2', at: { x: 500, y: 0, w: 1440, h: 1024 } },
    ]);
    transact(doc, () => writeBoardEntry(doc, 'b1', { locked: true }));
    addThread(doc, { threadId: 't1', slideId: 'b1', elementId: 'title', quote: '', by: human, at: 1, body: 'hi' }, 'deck-comments');
    const before = readFlat(doc, 'b1');
    const { id, elements } = duplicateBoard(doc, 'b1');
    expect(id).not.toBe('b1');
    expect(slideOrder(doc)).toEqual(['b1', id, 'b2']);
    expect(readCanvas(doc).boards[id]).toEqual({ x: 0 + 390 + 100, y: 40, w: 390, h: 844, title: 'Pricing', locked: true });
    expect(Y.readNotes(doc, id)).toBe('Say the price');
    const copy = readFlat(doc, id);
    expect(copy).toHaveLength(before.length);
    const oldIds = new Set(before.map((e) => e.id));
    expect(copy.every((e) => !oldIds.has(e.id))).toBe(true); // cells included
    expect(new Set(copy.map((e) => e.id)).size).toBe(copy.length);
    expect([...elements.keys()].sort()).toEqual(before.map((e) => e.id).sort());
    expect(new Set(copy.map((e) => e.id))).toEqual(new Set(elements.values()));
    // the same content by meaning: the copy's file is the original's with the ids mapped
    const copied = readSlide(doc, id);
    expect(copied.children.map((c) => c.tag)).toEqual(readSlide(doc, 'b1').children.map((c) => c.tag));
    expect(copied.children[0]!.text).toEqual(readSlide(doc, 'b1').children[0]!.text);
    expect(threadStates(doc).map((t) => t.slideId)).toEqual(['b1']); // the conversation is not copied
  });

  it('takes a position and an id when given, and refuses a held board, a missing-source board, a taken id and a full design', () => {
    const doc = design();
    const { id } = duplicateBoard(doc, 'b2', { id: 'b2-copy', at: { x: 9000, y: 9000 } });
    expect(id).toBe('b2-copy');
    expect(boardFrame(doc, id)).toEqual({ x: 9000, y: 9000, w: 1440, h: 1024 });
    expect(refusal(() => duplicateBoard(doc, 'b1', { id: 'b2' }))).toEqual(['board b2: the design already holds it']);
    transact(doc, () => Y.setSlideKey(doc, 'b3', 'held', { source: '<section id="b3"><script></script></section>', reasons: ['no'] }));
    expect(refusal(() => duplicateBoard(doc, 'b3'))).toEqual(['board b3: its file does not load (held), so there is nothing to copy']);
    transact(doc, () => Y.setSlideKey(doc, 'b1', MISSING_SOURCE_KEY, true));
    expect(refusal(() => duplicateBoard(doc, 'b1'))).toEqual(['board b1: its file never arrived, so there is nothing to copy']);
    expect(refusal(() => duplicateBoard(doc, 'nope'))).toEqual(['board nope: no such board']);
    expect(refusal(() => duplicateBoard(doc, 'b2', { at: { x: Number.NaN, y: 0 } }))[0]).toMatch(/^board s[0-9a-z]+-\d+: x is not a finite number$/);
  });
});

describe('deleteBoard', () => {
  it('removes the board, its elements’ and its own conversations keeping their last text', () => {
    const doc = design();
    addThread(doc, { threadId: 'te', slideId: 'b1', elementId: 'title', quote: '', by: human, at: 1, body: 'el' }, 'deck-comments');
    addThread(doc, { threadId: 'tb', slideId: 'b1', elementId: '', quote: '', by: human, at: 2, body: 'board' }, 'deck-comments');
    expect(updatesOf(doc, () => deleteBoard(doc, 'b1'))).toHaveLength(1);
    expect(Y.hasSlide(doc, 'b1')).toBe(false);
    expect(threadStates(doc).map((t) => [t.id, t.orphan, t.quote])).toEqual([
      ['te', true, 'Title b1'],
      ['tb', true, 'Phone'],
    ]);
  });
});
