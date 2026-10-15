// P3-C M7 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9): the deck's comment threads, anchored by ids to
// an element. The anchor survives a move, a restyle, a slide re-order and a republish of the slide; a deleted element's
// thread reads orphaned with the element's last text; resolve and reopen write the thread alone; a reply racing a
// resolve keeps both; an empty thread can be withdrawn, a spoken one never.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { applyV1, diffV1, newDoc, stateVector, type Doc } from '../yjs';
import { DECK_PATH, slidePath } from './deck';
import { deckFiles, deleteElementTree, moveSlide, setStyle, setText } from './model';
import { publishDeck } from './publish';
import { addThread, discardThread, elementQuote, getThread, listThreads, refreshQuotes, reopen, reply, resolve, slideTitle, threadStates } from './threads';

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

  it('reads a thread whose element was deleted as orphaned, with the text the host last refreshed into its quote', () => {
    const doc = deck();
    comment(doc, 't1', 's1', 'body');
    setText(doc, 's1', 'body', [{ type: 'p', inline: [{ text: 'One path, rewritten', marks: {} }] }]);
    expect(refreshQuotes(doc)).toEqual(['t1']);
    expect(refreshQuotes(doc)).toEqual([]); // written only when it drifted
    deleteElementTree(doc, 's1', 'body');
    expect(refreshQuotes(doc)).toEqual([]); // a dead element keeps its last quote
    expect(threadStates(doc)[0]).toMatchObject({ live: false, orphan: true, quote: 'One path, rewritten' });
    resolve(doc, 't1', human, 3000);
    expect(threadStates(doc)[0]).toMatchObject({ live: false, orphan: false, status: 'resolved' }); // resolved is never orphaned
  });

  it('refreshes only the threads of the slides it is given', () => {
    const doc = deck();
    comment(doc, 't1', 's1', 'body');
    comment(doc, 't2', 's2', 'lead');
    setText(doc, 's1', 'body', [{ type: 'p', inline: [{ text: 'A', marks: {} }] }]);
    setText(doc, 's2', 'lead', [{ type: 'p', inline: [{ text: 'B', marks: {} }] }]);
    expect(refreshQuotes(doc, { slides: ['s2'] })).toEqual(['t2']);
    expect(getThread(doc, 't1')!.quote).toBe('One path');
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
});
