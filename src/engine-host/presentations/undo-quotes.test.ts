// P3-C M7 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; Decision Log 31): the re-review's
// repro (/tmp/maws-review/p3c-m7-undo-review.test.ts) as a regression, its undos run as the deck session runs them
// (`keepingRemovedQuotes` around the stack's undo, what ⌘Z and Undo call): an undo that removes a commented element (an
// undo of its creation) keeps the element's last text across a reconnecting replica's merged frame, through A's real
// service. The session's own wiring is comments.dom.test.tsx's.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { slidePath } from '@artifacts/slides/deck';
import { deckFiles, setText } from '@artifacts/slides/model';
import { publishDeck } from '@artifacts/slides/publish';
import { addThread, elementQuote, getThread, keepingRemovedQuotes } from '@artifacts/slides/threads';
import { createDeckUndo } from '@artifacts/yjs/slides-undo';
import { mergeUpdates, transact } from '@artifacts/yjs';
import * as Y from '@artifacts/yjs/slides';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { registerPresentations, type Presentations } from '.';

let world: DocumentWorld;
let presentations: Presentations;
beforeEach(() => {
  world = openDocumentWorld();
  presentations = registerPresentations({ documents: world, chain: null, refresh: () => {} });
});
afterEach(() => {
  presentations.close();
  world.close();
});
const text = (value: string) => [{ type: 'p' as const, inline: [{ text: value, marks: {} }] }];

it('keeps the pre-delete text when a reconnect merges an undo of typing and an undo of creation', async () => {
  const { id } = await world.store.create({ kind: 'presentation', title: 'T' }, HUMAN);
  await world.service.writeAs(id, HUMAN, (doc) => void publishDeck(doc, deckFiles(doc), { [slidePath('s1')]: '<section id="s1"><p id="p">Seed</p></section>' }, false));
  const remote = world.connect(id, HUMAN);
  const undo = createDeckUndo(remote.doc);
  const undoStep = () => keepingRemovedQuotes(remote.doc, () => undo.undo());
  try {
    remote.edit((doc) => transact(doc, () => Y.createElement(doc, 's1', 'q', { tag: 'p', parent: '', order: 'a1' }, text('Old')), undo.origin));
    undo.cut();
    remote.edit((doc) => setText(doc, 's1', 'q', text('New'), undo.origin));
    undo.cut();
    remote.edit((doc) => addThread(doc, { threadId: 't1', slideId: 's1', elementId: 'q', quote: elementQuote(doc, 's1', 'q'), by: HUMAN, at: 1, body: 'Please edit' }, 'deck-comments'));
    await world.store.readCommitted(() => null);
    expect(elementQuote(world.service.live(id), 's1', 'q')).toBe('New');
    const untype = remote.edit(() => void expect(undoStep()).toBe(true), { hold: true });
    expect(elementQuote(remote.doc, 's1', 'q')).toBe('Old');
    const uncreate = remote.edit(() => void expect(undoStep()).toBe(true), { hold: true });
    expect(Y.hasElement(remote.doc, 's1', 'q')).toBe(false);
    remote.send(mergeUpdates([untype, uncreate]));
    await world.store.readCommitted(() => null);
    expect(getThread(world.service.live(id), 't1')!.quote).toBe('Old');
  } finally {
    undo.destroy();
    remote.doc.destroy();
  }
});
