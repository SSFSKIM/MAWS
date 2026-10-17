// P3-E1 M1 (the parent's Decision Log 13 (2)): a board-level comment anchors `{slideId: board, elementId: ROOT}`; C's
// anchor and quote readers learn, board-only, that such an anchor lives while its board exists with a frame and that its
// quote is the board's title (its id when untitled). A deck's slide has no frame, so its ROOT anchor stays as C had it.
import { describe, expect, it } from 'vitest';
import { deleteSlide, importSlide, resolveAnchor, ROOT } from '../slides/model';
import { addThread, captureQuotes, elementQuote, storeDeletedQuotes, threadStates } from '../slides/threads';
import { transact } from '../yjs';
import * as Y from '../yjs/slides';
import { writeBoardEntry } from './model';
import { boardIR, design } from './fixtures/support';

const human = { kind: 'human' as const };
const onBoard = (doc: ReturnType<typeof design>, threadId: string, slideId: string) =>
  addThread(doc, { threadId, slideId, elementId: ROOT, quote: '', by: human, at: 1, body: `on ${slideId}` }, 'deck-comments');
const state = (doc: ReturnType<typeof design>, id: string) => {
  const t = threadStates(doc).find((x) => x.id === id)!;
  return { live: t.live, orphan: t.orphan, quote: t.quote };
};

describe('a board-level (ROOT) anchor', () => {
  it('lives while its board exists with a frame, quoting the board’s title, else its id', () => {
    const doc = design();
    expect(resolveAnchor(doc, { slideId: 'b1', elementId: ROOT })).toEqual({ live: true, board: true });
    expect(elementQuote(doc, 'b1', ROOT)).toBe('Phone');
    expect(elementQuote(doc, 'b2', ROOT)).toBe('b2');
    onBoard(doc, 't1', 'b1');
    expect(state(doc, 't1')).toEqual({ live: true, orphan: false, quote: 'Phone' });
  });

  it('follows a rename: the quote is derived while the board lives', () => {
    const doc = design();
    onBoard(doc, 't1', 'b1');
    transact(doc, () => writeBoardEntry(doc, 'b1', { title: 'Phone — sign in' }));
    expect(state(doc, 't1')).toEqual({ live: true, orphan: false, quote: 'Phone — sign in' });
  });

  it('keeps the last title when its board is deleted by the writer, and orphans', () => {
    const doc = design();
    onBoard(doc, 't1', 'b1');
    deleteSlide(doc, 'b1');
    expect(state(doc, 't1')).toEqual({ live: false, orphan: true, quote: 'Phone' });
  });

  it('keeps the last title when another replica’s frame deletes the board (the host’s capture, then its store)', () => {
    const doc = design();
    onBoard(doc, 't1', 'b2');
    const quotes = captureQuotes(doc);
    expect(quotes.get('t1')).toBe('b2');
    transact(doc, () => Y.deleteSlide(doc, 'b2'));
    expect(storeDeletedQuotes(doc, quotes)).toEqual(['t1']);
    expect(state(doc, 't1')).toEqual({ live: false, orphan: true, quote: 'b2' });
  });

  it('is not live on a board whose frame is gone, nor on a deck’s slide (C’s default unchanged)', () => {
    const doc = design();
    transact(doc, () => Y.deleteSlideKey(doc, 'b3', 'w'));
    expect(resolveAnchor(doc, { slideId: 'b3', elementId: ROOT })).toEqual({ live: false });
    transact(doc, () => importSlide(doc, boardIR('slide1'), 'a8'));
    expect(resolveAnchor(doc, { slideId: 'slide1', elementId: ROOT })).toEqual({ live: false });
    expect(elementQuote(doc, 'slide1', ROOT)).toBe('');
    expect(resolveAnchor(doc, { slideId: 'nope', elementId: ROOT })).toEqual({ live: false });
  });
});
