// P3-E1 M4 fix wave (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the reconnect evidence the task
// review asked for): a design's threads through a reconnecting replica's one merged frame, on A's real service and SQLite
// file, C's harness (../presentations/quotes.test.ts) for the design kind. The replica held its edits while away and
// sends them as one frame: an element rewritten and deleted keeps the replica's last text, orphaned; a board renamed and
// deleted keeps its last title, orphaned; an element moved across boards (XE4: a new id, the threads rewritten in the
// move's transaction) and then edited lives at its new anchor, and moved then deleted is orphaned there with its last
// text. Every conversation is kept, and `artifact_threads` mirrors each quote.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CANVAS_PATH } from '@artifacts/design/canvas';
import { writeBoardEntry } from '@artifacts/design/model';
import { moveElementToBoard } from '@artifacts/design/move';
import { publishCanvas } from '@artifacts/design/publish';
import { deleteBoard } from '@artifacts/design/writers';
import { deleteElementTree, ROOT, setText } from '@artifacts/slides/model';
import { addThread, reply, threadStates } from '@artifacts/slides/threads';
import { mergeUpdates, transact, type Doc } from '@artifacts/yjs';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { registerDesigns, type Designs } from '.';

let world: DocumentWorld;
let designs: Designs;
beforeEach(() => {
  world = openDocumentWorld();
  designs = registerDesigns({ documents: world, chain: null, refresh: () => {}, env: {} });
});
afterEach(() => {
  designs.close();
  world.close();
});

const FILES = {
  [CANVAS_PATH]: JSON.stringify({ v: 1, title: 'T', boards: { phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, desktop: { x: 500, y: 0, w: 1440, h: 1024, title: 'Desktop' } }, order: ['phone', 'desktop'] }),
  'project/boards/phone.html': '<section id="phone"><p id="body">Old</p><p id="note">Note</p></section>',
  'project/boards/desktop.html': '<section id="desktop"><p id="other">Other</p></section>',
};
const THREADS = [
  ['t-el', 'phone', 'body', 'Old'],
  ['t-board', 'phone', ROOT, 'Phone'],
  ['t-move', 'phone', 'note', 'Note'],
] as const;

async function design(): Promise<string> {
  const created = await world.store.create({ kind: 'design', title: 'T' }, HUMAN);
  await world.service.writeAs(created.id, HUMAN, (doc) => {
    if (publishCanvas(doc, {}, FILES, true).conflicts.length > 0) throw new Error('seed');
    for (const [threadId, slideId, elementId, quote] of THREADS) {
      addThread(doc, { threadId, slideId, elementId, quote, by: HUMAN, at: 1, body: `On ${quote}` });
      reply(doc, threadId, { id: `${threadId}:r`, by: HUMAN, at: 2, body: 'And another thing.' });
    }
  });
  return created.id;
}
const row = (id: string, threadId: string): unknown => {
  const db = new DatabaseSync(join(world.dir, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    return (db.prepare('SELECT quote FROM artifact_threads WHERE artifactId = ? AND threadId = ?').get(id, threadId) as { quote: string } | undefined)?.quote;
  } finally {
    db.close();
  }
};
const text = (words: string) => [{ type: 'p' as const, inline: [{ text: words, marks: {} }] }];
const stateOf = (id: string, threadId: string) => {
  const t = threadStates(world.service.live(id)).find((x) => x.id === threadId)!;
  return { slideId: t.slideId, elementId: t.elementId, quote: t.quote, live: t.live, orphan: t.orphan, messages: t.messages.map((m) => m.body) };
};
/** One reconnect: the replica's edits, held while it was away, sent as one merged frame; answers once the host committed. */
async function reconnect(id: string, edits: ((doc: Doc) => void)[]) {
  const remote = world.connect(id, HUMAN);
  const held = edits.map((edit) => remote.edit(edit, { hold: true }));
  remote.send(mergeUpdates(held));
  await world.store.readCommitted(() => null);
  return remote;
}
const CONVERSATION = (quote: string) => [`On ${quote}`, 'And another thing.'];

describe('a design’s threads through a reconnecting replica’s one merged frame', () => {
  it('an element rewritten and deleted keeps the replica’s last text, orphaned, its conversation kept', async () => {
    const id = await design();
    await reconnect(id, [(doc) => setText(doc, 'phone', 'body', text('Last local words')), (doc) => deleteElementTree(doc, 'phone', 'body')]);
    expect(stateOf(id, 't-el')).toEqual({ slideId: 'phone', elementId: 'body', quote: 'Last local words', live: false, orphan: true, messages: CONVERSATION('Old') });
    expect(row(id, 't-el')).toBe('Last local words');
    expect(stateOf(id, 't-board')).toMatchObject({ live: true, orphan: false }); // the board itself stays
  });

  it('a board renamed and deleted keeps its last title on its board-level thread, orphaned, every conversation kept', async () => {
    const id = await design();
    await reconnect(id, [(doc) => transact(doc, () => writeBoardEntry(doc, 'phone', { title: 'Phone — sign in' })), (doc) => deleteBoard(doc, 'phone')]);
    expect(stateOf(id, 't-board')).toEqual({ slideId: 'phone', elementId: ROOT, quote: 'Phone — sign in', live: false, orphan: true, messages: CONVERSATION('Phone') });
    expect(row(id, 't-board')).toBe('Phone — sign in');
    expect(stateOf(id, 't-el')).toMatchObject({ quote: 'Old', live: false, orphan: true, messages: CONVERSATION('Old') }); // its element went with the board
  });

  it('an element moved across boards and edited lives at its rewritten anchor; moved and deleted is orphaned there with its last text', async () => {
    const live = await design();
    let moved = '';
    await reconnect(live, [(doc) => (moved = moveElementToBoard(doc, 'phone', 'desktop', 'note').ids.get('note')!), (doc) => setText(doc, 'desktop', moved, text('Moved, then edited'))]);
    expect(moved).toMatch(/^m[0-9a-z]{8}$/);
    expect(stateOf(live, 't-move')).toEqual({ slideId: 'desktop', elementId: moved, quote: 'Moved, then edited', live: true, orphan: false, messages: CONVERSATION('Note') });

    const gone = await design();
    let there = '';
    await reconnect(gone, [(doc) => (there = moveElementToBoard(doc, 'phone', 'desktop', 'note').ids.get('note')!), (doc) => setText(doc, 'desktop', there, text('Its last words')), (doc) => deleteElementTree(doc, 'desktop', there)]);
    expect(stateOf(gone, 't-move')).toEqual({ slideId: 'desktop', elementId: there, quote: 'Its last words', live: false, orphan: true, messages: CONVERSATION('Note') });
    expect(row(gone, 't-move')).toBe('Its last words');
  });
});
