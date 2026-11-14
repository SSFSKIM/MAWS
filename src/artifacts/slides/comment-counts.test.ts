// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M7; A3): a deck's and a design's open
// comments count a thread once it holds a message, as a document's do. The editors write a thread when a comment card
// opens; the count no longer rises before a word is sent, and falls back when that card closes unsent.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { design } from '../design/fixtures/support';
import { newDoc, type Doc } from '../yjs';
import { deckCommentCounts } from './comment-counts';
import { DECK_PATH, slidePath } from './deck';
import { ROOT } from './model';
import { publishDeck } from './publish';
import { addThread, discardThread, reply } from './threads';

const human: Actor = { kind: 'human' };

// The reader as the chrome holds it: subscribed, so its snapshot follows thread writes at once.
function counted(doc: Doc): () => number {
  const store = deckCommentCounts(doc);
  store.subscribe(() => {});
  return () => store.getSnapshot().total;
}

function deck(): Doc {
  const doc = newDoc();
  const index = JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-14T09:00:00Z' }, title: 'Q3', cover: 's1', order: ['s1'] });
  publishDeck(doc, {}, { [DECK_PATH]: index, [slidePath('s1')]: '<section id="s1"><h2 id="title">Plan</h2><p id="body">One path</p></section>' }, false);
  return doc;
}

describe.each([
  { kind: 'a deck’s element', make: deck, slideId: 's1', elementId: 'body' },
  { kind: 'a design’s board', make: () => design(), slideId: 'b1', elementId: ROOT },
])('the count of open comments on $kind (A3)', ({ make, slideId, elementId }) => {
  const openCard = (doc: Doc, threadId: string, body?: string) => addThread(doc, { threadId, slideId, elementId, quote: '', by: human, at: 1, ...(body !== undefined && { body }) });

  it('ignores a card opened and closed unsent, and rises by one when the comment is sent', () => {
    const doc = make();
    openCard(doc, 'sent-before', 'Shorter?');
    const total = counted(doc);
    expect(total(), 'before').toBe(1);

    openCard(doc, 'drafted');
    expect(total(), 'with an unsent card').toBe(1);
    expect(discardThread(doc, 'drafted')).toBe(true);
    expect(total(), 'after Close').toBe(1);

    openCard(doc, 'posted');
    expect(total(), 'with the card open again').toBe(1);
    reply(doc, 'posted', { id: 'posted:m1', by: human, at: 2, body: 'Use the brand colour.' });
    expect(total(), 'after the send').toBe(2);
    expect([...deckCommentCounts(doc).getSnapshot().targets], 'the badge of its slide or board').toEqual([[slideId, 2]]);
  });
});
