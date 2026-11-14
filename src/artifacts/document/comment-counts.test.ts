// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M7; A3): a document's and a dashboard's
// open comments count a thread once it holds a message. The editor writes a thread and its mark when a comment card
// opens, so the count no longer rises before a word is sent, and falls back to nothing when that card closes unsent.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { newDoc, type Doc } from '../yjs';
import { documentCommentCounts } from './comment-counts';
import { createDocument } from './tabs';
import { addThread, discardThread, reply, resolve } from './threads';

const human: Actor = { kind: 'human' };

// The reader as the chrome holds it: subscribed, so its snapshot follows thread writes at once.
function counted(doc: Doc): () => number {
  const store = documentCommentCounts(doc);
  store.subscribe(() => {});
  return () => store.getSnapshot().total;
}

// A dashboard's view commented whole: a block thread on a block of the tab, live while that block is.
function dashboard(): Doc {
  const doc = newDoc();
  createDocument(doc, { id: 'tab1', title: 'Revenue', generateID: () => 'view1' });
  return doc;
}
const openCard = (doc: Doc, threadId: string, body?: string) =>
  addThread(doc, { threadId, tabId: 'tab1', blockId: 'view1', quote: 'Revenue by month', anchor: { kind: 'block' }, by: human, at: 1, ...(body !== undefined && { body }) });

describe('the count of open comments (A3)', () => {
  it('ignores a card opened and closed unsent, and rises by one when the comment is sent', () => {
    const doc = dashboard();
    openCard(doc, 'sent-before', 'Is March final?');
    const total = counted(doc);
    expect(total(), 'before').toBe(1);

    openCard(doc, 'drafted');
    expect(total(), 'with an unsent card').toBe(1);
    expect(discardThread(doc, 'drafted')).toBe(true);
    expect(total(), 'after Close').toBe(1);

    openCard(doc, 'posted');
    expect(total(), 'with the card open again').toBe(1);
    reply(doc, 'posted', { id: 'posted:m1', by: human, at: 2, body: 'Label the axis.' });
    expect(total(), 'after the send').toBe(2);
  });

  it('counts a thread with a message whoever wrote it, and still leaves out a resolved one', () => {
    const doc = dashboard();
    addThread(doc, { threadId: 'agent', tabId: 'tab1', blockId: 'view1', quote: 'Revenue by month', anchor: { kind: 'block' }, by: { kind: 'session', appSessionId: 'a1111111-1111-4111-8111-111111111111' } as Actor, at: 1, body: 'Added the totals row.' });
    openCard(doc, 'answered', 'Why the dip?');
    const total = counted(doc);
    expect(total()).toBe(2);
    resolve(doc, 'answered', human, 3);
    expect(total()).toBe(1);
  });
});
