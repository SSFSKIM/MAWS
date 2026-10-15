// P3-C M7 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; Decision Log 31, 34): a deleted
// element's thread keeps the element's last text on the replica routes, through A's real service and SQLite file. A
// replica's frame that deletes a commented element stores its quote through the forwarding edit and mirrors it into
// `artifact_threads`; a reconnecting replica's merged frame that rewrites and deletes the element keeps the quote the
// replica's own delete writer stored, which the host's forwarding edit does not overwrite.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECK_PATH, slidePath } from '@artifacts/slides/deck';
import { deckFiles, deleteElementTree, setText } from '@artifacts/slides/model';
import { publishDeck } from '@artifacts/slides/publish';
import { addThread, getThread } from '@artifacts/slides/threads';
import { mergeUpdates } from '@artifacts/yjs';
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

const S1 = `<section id="s1" style="background:#ffffff; padding:128px"><h2 id="title" style="font-size:64px">Plan</h2><p id="body" style="font-size:32px">Old</p></section>`;
async function deck(): Promise<string> {
  const created = await world.store.create({ kind: 'presentation', title: 'Q3' }, HUMAN);
  await world.service.writeAs(created.id, HUMAN, (doc) => {
    publishDeck(doc, deckFiles(doc), { [DECK_PATH]: JSON.stringify({ v: 4, title: 'Q3', cover: 's1', order: ['s1'] }), [slidePath('s1')]: S1, [slidePath('cover')]: null }, true);
    addThread(doc, { threadId: 't1', slideId: 's1', elementId: 'body', quote: 'Old', by: HUMAN, at: 1 });
  });
  return created.id;
}
const row = (id: string): unknown => {
  const db = new DatabaseSync(join(world.dir, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    return (db.prepare('SELECT quote FROM artifact_threads WHERE artifactId = ? AND threadId = ?').get(id, 't1') as { quote: string } | undefined)?.quote;
  } finally {
    db.close();
  }
};
const text = (words: string) => [{ type: 'p' as const, inline: [{ text: words, marks: {} }] }];

describe('a deleted element’s last text on the replica routes (fix wave 1)', () => {
  it('a replica’s deletion frame: the host stores the text it had and mirrors it into artifact_threads', async () => {
    const id = await deck();
    const remote = world.connect(id, HUMAN);
    remote.edit((doc) => setText(doc, 's1', 'body', text('Last words')));
    await world.store.readCommitted(() => null);
    // a raw frame carrying the deletion alone (not the editor's writer): the host's forwarding edit stores the quote
    remote.edit((doc) => Y.deleteElement(doc, 's1', 'body'));
    await world.store.readCommitted(() => null);
    expect(getThread(world.service.live(id), 't1')!.quote).toBe('Last words');
    expect(row(id)).toBe('Last words');
  });

  it('a reconnecting replica’s merged frame that rewrites and deletes the element keeps the replica’s last text', async () => {
    const id = await deck();
    const remote = world.connect(id, HUMAN);
    const rewrite = remote.edit((doc) => setText(doc, 's1', 'body', text('Last local words')), { hold: true });
    const removal = remote.edit((doc) => deleteElementTree(doc, 's1', 'body'), { hold: true });
    remote.send(mergeUpdates([rewrite, removal]));
    await world.store.readCommitted(() => null);
    expect(getThread(world.service.live(id), 't1')!.quote).toBe('Last local words');
    expect(row(id)).toBe('Last local words');
  });
});
