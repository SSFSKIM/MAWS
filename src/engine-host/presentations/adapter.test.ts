// P3-C M2 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D5): the presentation adapter on A's real document
// service and store (a fresh SQLite file, as `openDocuments` makes them): a create seeds the cover; the repair after a
// concurrent update lands as the triggering actor's write; a restore brings the deck's files back exactly (S7a's
// restore equality) and keeps the messages posted since the version (parent Decision Log 32). M3 registers the adapter
// in the host; this test registers it as the store's tests register theirs.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPresentationAdapter } from '@artifacts/slides/adapter';
import { DECK_PATH, slidePath } from '@artifacts/slides/deck';
import { deckFiles, deleteElementTree, moveInto, readFlat, setStyle } from '@artifacts/slides/model';
import { publishDeck } from '@artifacts/slides/publish';
import { applyV1, applyV2, diffV1, newDoc, stateVector, type Doc } from '@artifacts/yjs';
import * as Y from '@artifacts/yjs/slides';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-1' as AppSessionId };
const other: Actor = { kind: 'session', appSessionId: 'app-2' as AppSessionId };

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-deck-'));
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id), adapters: [createPresentationAdapter()] });
  store = new ArtifactStore(service, storage, { root: dir, log: () => {} });
});
afterEach(() => {
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const committed = (sql: string, ...params: (string | number)[]) => {
  const db = new DatabaseSync(join(dir, 'store.sqlite'), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as Record<string, unknown>[];
  } finally {
    db.close();
  }
};
/** The deck as a fresh replica sees it. */
function replicaOf(artifactId: string): Doc {
  const doc = newDoc();
  applyV2(doc, service.readState(artifactId).state);
  return doc;
}
const SLIDE = `<section id="s1" style="background:#ffffff; padding:128px">
  <h2 id="title" style="font-size:64px">Title</h2>
  <div id="g1" style="position:absolute; left:100px; top:600px; width:800px; height:300px"></div>
  <p id="e1" style="position:absolute; left:100px; top:300px; width:400px">One</p>
  <aside>Notes</aside>
</section>`;

describe('the presentation adapter on the document service', () => {
  it('seeds a created deck with its index and cover slide, in the create’s commit, credited to the creator', async () => {
    const deck = await store.create({ kind: 'presentation', title: 'Quarterly review' }, agent);
    const files = deckFiles(replicaOf(deck.id));
    expect(Object.keys(files)).toEqual([DECK_PATH, slidePath('cover')]);
    expect(files[slidePath('cover')]).toContain('>Quarterly review</h1>');
    expect(committed('SELECT actor FROM artifact_updates WHERE artifactId = ?', deck.id)).toEqual([{ actor: 'session:app-1' }]);
  });

  it('repairs what concurrency left as the write of the actor whose update produced it', async () => {
    const deck = await store.create({ kind: 'presentation', title: 'T' }, human);
    await service.writeAs(deck.id, human, (doc) => void publishDeck(doc, deckFiles(doc), { [slidePath('s1')]: SLIDE }, false));
    // another replica moves e1 into g1 while the human deletes g1
    const replica = replicaOf(deck.id);
    const sv = stateVector(replica);
    moveInto(replica, 's1', 'e1', 'g1');
    await service.writeAs(deck.id, human, (doc) => deleteElementTree(doc, 's1', 'g1'));
    const before = committed('SELECT seq FROM artifact_updates WHERE artifactId = ?', deck.id).length;
    await service.writeAs(deck.id, other, (doc) => applyV1(doc, diffV1(replica, sv)));
    const rows = committed('SELECT actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq', deck.id).slice(before);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.actor === 'session:app-2')).toBe(true);
    const live = replicaOf(deck.id);
    expect(readFlat(live, 's1', false).find((e) => e.id === 'e1')!.parent).toBe('');
    // the repaired state needs no further repair: an unrelated write adds exactly one row
    await service.writeAs(deck.id, human, (doc) => setStyle(doc, 's1', 'title', { color: '#ff0000' }));
    expect(committed('SELECT seq FROM artifact_updates WHERE artifactId = ?', deck.id).length).toBe(before + rows.length + 1);
  });

  it('restores a version’s files exactly and keeps the messages posted since', async () => {
    const deck = await store.create({ kind: 'presentation', title: 'T' }, human);
    await service.writeAs(deck.id, agent, (doc) => {
      publishDeck(doc, deckFiles(doc), { [slidePath('s1')]: SLIDE, [slidePath('s2')]: '<section id="s2"><p id="x">x</p></section>' }, false);
      Y.createThread(doc, 't1', { slideId: 's1', elementId: 'title', status: 'open' });
      Y.postMessage(doc, 't1', { by: 'human', text: 'Bigger?' });
    });
    const at = (await store.createVersion(deck.id, { kind: 'named', actor: human, label: 'v1' }))!;
    const atVersion = deckFiles(replicaOf(deck.id));

    // a month of edits: a property overwritten twice, a slide removed and one added, text, order, the index, a reply
    await service.writeAs(deck.id, human, (doc) => setStyle(doc, 's1', 'title', { color: '#111111' }));
    await service.writeAs(deck.id, human, (doc) => setStyle(doc, 's1', 'title', { color: '#222222' }));
    await service.writeAs(deck.id, agent, (doc) => {
      const read = deckFiles(doc);
      publishDeck(doc, read, { [slidePath('s2')]: null, [slidePath('s3')]: '<section id="s3"><h1 id="h">New</h1></section>', [slidePath('s1')]: read[slidePath('s1')]!.replace('>Title<', '>Retitled<').replace('Notes', 'New notes'), [DECK_PATH]: read[DECK_PATH]!.replace('"title": "T"', '"title": "Renamed"') }, false);
      Y.postMessage(doc, 't1', { by: 'agent', text: 'Done.' });
      Y.setThreadKey(doc, 't1', 'status', 'resolved');
    });
    await service.writeAs(deck.id, other, (doc) => {
      Y.createThread(doc, 't2', { slideId: 's3', elementId: 'h', status: 'open' });
      Y.postMessage(doc, 't2', { by: 'other', text: 'On the new slide' });
    });
    expect(deckFiles(replicaOf(deck.id))).not.toEqual(atVersion);

    await store.restore(deck.id, at, human);
    const live = replicaOf(deck.id);
    expect(deckFiles(live)).toEqual(atVersion);
    expect(Y.threadMessages(live, 't1')).toEqual([
      { by: 'human', text: 'Bigger?' },
      { by: 'agent', text: 'Done.' },
    ]);
    expect(Y.threadScalars(live, 't1').status).toBe('open');
    expect(Y.threadMessages(live, 't2')).toEqual([{ by: 'other', text: 'On the new slide' }]); // its slide gone: an orphan for M7
    expect(store.listVersions(deck.id).map((v) => v.kind)).toEqual(['named', 'auto', 'restore']);
  });
});
