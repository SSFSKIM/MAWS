// P3-C M7 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9): the deck's comment threads, anchored by ids to
// an element. The anchor survives a move, a restyle, a slide re-order and a republish of the slide; a deleted element's
// thread reads orphaned with the element's last text (derived from the element while it lives, stored at its deletion:
// Decision Log 31's ruling); resolve and reopen write the thread alone; a reply racing a
// resolve keeps both; an empty thread can be withdrawn, a spoken one never.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { applyV1, diffV1, newDoc, stateVector, type Doc } from '../yjs';
import { DECK_PATH, slidePath } from './deck';
import { deckFiles, deleteElementTree, deleteSlide, moveSlide, setStyle, setText } from './model';
import { removeSlide } from './writers';
import { onUpdate } from '../yjs';
import { publishDeck } from './publish';
import * as Y from '../yjs/slides';
import { addThread, captureQuotes, discardThread, elementQuote, getThread, listThreads, reopen, reply, resolve, slideTitle, storeDeletedQuotes, storedQuotes, threadStates } from './threads';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-1' as AppSessionId };

const index = (order: string[]) => JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-14T09:00:00Z' }, title: 'Q3', cover: 's1', order });
const S1 = `<section id="s1" style="background:#ffffff; padding:128px">
  <h2 id="title" style="font-size:64px">Plan</h2>
  <p id="body" style="position:absolute; left:100px; top:300px; width:400px">One path</p>
  <div id="card" style="position:absolute; left:900px; top:300px; width:400px; height:300px"><h3 id="ct" style="font-size:40px">Card title</h3><p id="cb" style="font-size:24px">Card body</p></div>
  <img id="pic" alt="Revenue chart" style="position:absolute; left:100px; top:700px; width:200px; height:100px">
  <x-shape id="ring" kind="ellipse" style="position:absolute; left:500px; top:700px; width:200px; height:100px"></x-shape>
</section>`;
const S2 = `<section id="s2" style="background:#ffffff; padding:128px"><p id="lead" style="font-size:32px">Second</p></section>`;

function deck(): Doc {
  const doc = newDoc();
  publishDeck(doc, {}, { [DECK_PATH]: index(['s1', 's2']), [slidePath('s1')]: S1, [slidePath('s2')]: S2 }, false);
  return doc;
}
const comment = (doc: Doc, threadId: string, slideId: string, elementId: string, at = 1000) =>
  addThread(doc, { threadId, slideId, elementId, quote: elementQuote(doc, slideId, elementId), by: human, at });

describe('a deck’s comment threads (D9)', () => {
  it('quotes an element by its text, a container by its descendants’ text, else by its tag and alt or kind', () => {
    const doc = deck();
    expect(elementQuote(doc, 's1', 'body')).toBe('One path');
    expect(elementQuote(doc, 's1', 'card')).toBe('Card title\nCard body');
    expect(elementQuote(doc, 's1', 'pic')).toBe('img “Revenue chart”');
    expect(elementQuote(doc, 's1', 'ring')).toBe('x-shape ellipse');
    expect(slideTitle(doc, 's1')).toBe('Plan');
    expect(slideTitle(doc, 's2')).toBe('Second');
  });

  it('writes a thread with its first message, lists it oldest first, and keeps it live through a move, a restyle, a re-order and a republish', () => {
    const doc = deck();
    addThread(doc, { threadId: 't2', slideId: 's2', elementId: 'lead', quote: 'Second', by: human, at: 2000 });
    addThread(doc, { threadId: 't1', slideId: 's1', elementId: 'body', quote: 'One path', by: human, at: 1000, body: 'Shorter?' });
    expect(listThreads(doc).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(getThread(doc, 't1')).toMatchObject({ slideId: 's1', elementId: 'body', quote: 'One path', status: 'open', createdBy: human, messages: [{ id: 't1:m0', by: human, at: 1000, body: 'Shorter?' }] });

    setStyle(doc, 's1', 'body', { left: '300px', top: '500px' }); // moved
    setStyle(doc, 's1', 'body', { color: '#ff0000' }); // restyled
    moveSlide(doc, 's1', 's2'); // re-ordered
    const files = deckFiles(doc);
    publishDeck(doc, files, { [slidePath('s1')]: files[slidePath('s1')]!.replace('One path', 'Two paths') }, false); // the agent's republish
    const [state] = threadStates(doc).filter((t) => t.id === 't1');
    expect(state).toMatchObject({ live: true, orphan: false, slideId: 's1', elementId: 'body' });
  });

  // Decision Log 31's ruling (revising D9's "refreshed by the host while the element lives"): a living element's quote is
  // derived from it by every reader, the stored quote written only at the thread's creation and at the element's deletion
  it('reads a living element’s quote from the element, its stored quote untouched; a deleted element’s thread orphaned with the quote stored at its deletion', () => {
    const doc = deck();
    comment(doc, 't1', 's1', 'body');
    const stored = () => Y.threadScalars(doc, 't1').quote;
    setText(doc, 's1', 'body', [{ type: 'p', inline: [{ text: 'One path, rewritten', marks: {} }] }]);
    expect(getThread(doc, 't1')!.quote).toBe('One path, rewritten');
    expect(listThreads(doc)[0]!.quote).toBe('One path, rewritten');
    expect(threadStates(doc)[0]).toMatchObject({ live: true, quote: 'One path, rewritten' });
    expect(stored()).toBe('One path'); // nothing written while the element lives

    const before = captureQuotes(doc); // what the adapter reads before an update that deletes
    Y.deleteElement(doc, 's1', 'body'); // a raw deletion, not a writer's (the host's route)
    expect(storeDeletedQuotes(doc, before)).toEqual(['t1']);
    expect(storeDeletedQuotes(doc, before)).toEqual([]); // written once
    expect(stored()).toBe('One path, rewritten');
    expect(threadStates(doc)[0]).toMatchObject({ live: false, orphan: true, quote: 'One path, rewritten' });
    resolve(doc, 't1', human, 3000);
    expect(threadStates(doc)[0]).toMatchObject({ live: false, orphan: false, status: 'resolved' }); // resolved is never orphaned
  });

  it('captures the quotes of the slides it is given, and stores nothing for an element that lives', () => {
    const doc = deck();
    comment(doc, 't1', 's1', 'body');
    comment(doc, 't2', 's2', 'lead');
    setText(doc, 's2', 'lead', [{ type: 'p', inline: [{ text: 'B', marks: {} }] }]);
    expect([...captureQuotes(doc, { slides: ['s2'] })]).toEqual([['t2', 'B']]);
    expect(storeDeletedQuotes(doc, captureQuotes(doc))).toEqual([]);
    expect(Y.threadScalars(doc, 't2').quote).toBe('Second');
  });

  it('resolves and reopens by writing the thread alone, and a reply racing a resolve keeps both', () => {
    const doc = deck();
    comment(doc, 't1', 's1', 'body');
    const other = newDoc();
    applyV1(other, diffV1(doc, stateVector(other)));
    const sv = stateVector(doc);
    resolve(doc, 't1', human, 2000);
    reply(other, 't1', { id: 't1:a', by: agent, at: 2001, body: 'Done' });
    const fromDoc = diffV1(doc, stateVector(other));
    applyV1(doc, diffV1(other, sv));
    applyV1(other, fromDoc);
    for (const d of [doc, other]) expect(getThread(d, 't1')).toMatchObject({ status: 'resolved', resolvedBy: human, resolvedAt: 2000, messages: [{ id: 't1:a', body: 'Done' }] });
    reopen(doc, 't1', agent, 4000);
    expect(getThread(doc, 't1')).toMatchObject({ status: 'open', reopenedBy: agent, reopenedAt: 4000 });
  });

  it('withdraws a thread nothing was said in, never one with a message or a resolve', () => {
    const doc = deck();
    comment(doc, 't1', 's1', 'body');
    addThread(doc, { threadId: 't2', slideId: 's1', elementId: 'title', quote: 'Plan', by: human, at: 1, body: 'Bigger' });
    comment(doc, 't3', 's2', 'lead');
    resolve(doc, 't3', human, 2);
    expect(discardThread(doc, 't1')).toBe(true);
    expect(discardThread(doc, 't2')).toBe(false);
    expect(discardThread(doc, 't3')).toBe(false);
    expect(discardThread(doc, 'nope')).toBe(false);
    expect(listThreads(doc).map((t) => t.id)).toEqual(['t2', 't3']);
  });

  it('refuses a reply to, or a resolve of, a thread that does not exist', () => {
    const doc = deck();
    expect(() => reply(doc, 'nope', { id: 'x', by: human, at: 1, body: 'hi' })).toThrow(/no thread nope/);
    expect(() => resolve(doc, 'nope', human, 1)).toThrow(/no thread nope/);
  });

  // fix wave 1: a removal writer stores the last text in the write that removes the element
  it('the removal writers store each removed element’s last text in the one update that removes it', () => {
    const rewrite = (doc: Doc) => setText(doc, 's1', 'body', [{ type: 'p', inline: [{ text: 'Last words', marks: {} }] }]);
    const updates = (doc: Doc, write: () => void) => {
      let n = 0;
      const off = onUpdate(doc, () => n++);
      write();
      off();
      return n;
    };
    const cases: Array<{ remove: (doc: Doc) => void; t1: string; t2: string }> = [
      { remove: (doc) => deleteElementTree(doc, 's1', 'body'), t1: 'Last words', t2: 'Card title' },
      { remove: (doc) => deleteElementTree(doc, 's1', 'card'), t1: 'One path', t2: 'Card title (kept)' },
      { remove: (doc) => removeSlide(doc, 's1'), t1: 'Last words', t2: 'Card title (kept)' },
      { remove: (doc) => deleteSlide(doc, 's1'), t1: 'Last words', t2: 'Card title (kept)' },
    ];
    for (const { remove, t1, t2 } of cases) {
      const doc = deck();
      comment(doc, 't1', 's1', 'body');
      comment(doc, 't2', 's1', 'ct'); // inside the card: removed with it, or with the slide
      rewrite(doc);
      setText(doc, 's1', 'ct', [{ type: 'p', inline: [{ text: 'Card title (kept)', marks: {} }] }]);
      expect(updates(doc, () => remove(doc))).toBe(1);
      expect(Y.threadScalars(doc, 't1').quote).toBe(t1); // stored only for what was removed
      expect(Y.threadScalars(doc, 't2').quote).toBe(t2);
    }
  });

  it('the host’s store leaves a quote the deleting frame wrote itself', () => {
    const doc = deck();
    comment(doc, 't1', 's1', 'body');
    const captured = captureQuotes(doc); // the host's read before the frame: 'One path'
    const before = storedQuotes(doc, captured.keys());
    setText(doc, 's1', 'body', [{ type: 'p', inline: [{ text: 'Offline words', marks: {} }] }]); // the frame: a rewrite,
    deleteElementTree(doc, 's1', 'body'); // and the writer's deletion, storing the rewrite
    expect(storeDeletedQuotes(doc, captured, undefined, before)).toEqual([]);
    expect(Y.threadScalars(doc, 't1').quote).toBe('Offline words');
  });
});
