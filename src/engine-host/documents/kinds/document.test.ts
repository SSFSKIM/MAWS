// The document kind registered with A's real store (M7; D8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md,
// Decision Log 21): A's document service runs the adapter's hooks on every update of a document artifact, keyed by the
// artifact id A passes; the forwarding into a re-inserted block and the id repair land through A's frames; and the
// authorship the adapter carries reaches every row A persists for a frame (A's per-row attribution, its M4a), checked
// in the store's committed attribution rows, never assumed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { carriedBy, decodeMap, idAt, mergeMaps, transact } from '@artifacts/yjs';
import { DocIndex } from '@artifacts/document/block-index';
import { documentMirrorWriter } from '@artifacts/document/mirror';
import { mirrorWriterFor } from '@artifacts/library/mirror';
import { createDocument, listTabs } from '@artifacts/document/tabs';
import { applyEdit } from '@artifacts/document/patch-writer';
import { schemaFor } from '@artifacts/document/schema';
import { addThread, anchorOfMark } from '@artifacts/document/threads';
import { body, dupes, ids, nodeOf, now, TAB, textOf } from '@artifacts/document/writer.fixture';
import { pmnodeToDelta } from '@artifacts/yjs/prosemirror';
import { HUMAN, liveText, openDocumentWorld, sessionActor, type DocumentWorld } from './document-world.fixture';

const AGENT = sessionActor('app-agent');
const OTHER = sessionActor('app-other');
let world: DocumentWorld;

beforeEach(() => {
  world = openDocumentWorld();
});
afterEach(() => world.close());

const committed = () => world.service.whenCommitted();
const typeAt = (end: { edit: (change: (doc: import('@artifacts/yjs').Doc) => void, options?: { hold?: boolean }) => Uint8Array }, id: string, at: number, text: string) =>
  end.edit((doc) => transact(doc, () => nodeOf(doc, id).insert(at, text, {})));

describe('the document kind on A’s store', () => {
  it('registers its adapter for the document kind', () => {
    expect(world.service.adapterFor('document')).toBe(world.kind.adapter);
    expect(world.store.service.adapterFor('document')?.kind).toBe('document');
  });

  // M8 fix wave 1: a document is created with its first tab (the spec's Terms), written once, by the host, as the
  // creator: replicas never initialise it themselves, so two editors opening a new document bind the one live body.
  it('gives a document created empty its first tab, once, titled as the document and credited to its creator', async () => {
    const artifact = await world.store.create({ kind: 'document', title: 'Launch plan' }, AGENT);
    await committed();
    await committed();
    const tabs = listTabs(world.service.live(artifact.id));
    expect(tabs.map((tab) => tab.title)).toEqual(['Launch plan']);
    const version = await world.store.create({ kind: 'document', title: 'Seeded', initial: (doc) => createDocument(doc, { title: 'Own tab' }) }, HUMAN);
    await committed();
    expect(listTabs(world.service.live(version.id)).map((tab) => tab.title)).toEqual(['Own tab']); // content given: untouched
    const copy = await world.store.duplicate(artifact.id, {}, HUMAN);
    await committed();
    expect(listTabs(world.service.live(copy.id)).map((tab) => tab.id)).toEqual([tabs[0].id]); // a copy keeps the source's
    expect(world.store.lastWrite(artifact.id)?.actor).toEqual(AGENT); // the first tab is the creator's write
  });

  it('registers the document mirror writer while the kind is registered (M8: a linked Space mirrors <slug>.md)', () => {
    expect(mirrorWriterFor('document')).toBe(documentMirrorWriter);
    world.kind.close();
    expect(mirrorWriterFor('document')).toBeUndefined();
  });

  it('a duplicate id a replica wrote is repaired by A’s service through the adapter, the text kept', async () => {
    const id = await world.seeded();
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => body(doc).insert(0, [pmnodeToDelta(schemaFor().nodeFromJSON({ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Pasted twice.' }] }))])));
    await committed();
    const live = world.service.live(id);
    expect(dupes(ids(live))).toEqual([]);
    expect(textOf(live, 'p1')).toBe('The quick brown fox jumps over the lazy dog. It has two sentences.');
    const first = DocIndex.of(live).tops(TAB)[0];
    expect(first.id).not.toBe('p1');
    expect(DocIndex.of(live).pm(first).textContent).toBe('Pasted twice.');
  });

  it('keystrokes in flight into a block the agent moved are forwarded into the moved copy, credited to the person', async () => {
    const id = await world.seeded();
    const person = world.connect(id, HUMAN); // has not seen the move
    await world.service.writeAs(id, AGENT, (doc) => {
      const applied = applyEdit(doc, [{ op: 'move', id: 'p3', after: 'c1' }]);
      world.kind.adapter.registerCarries(id, applied.carries);
    });
    typeAt(person, 'p3', 0, 'Typed: ');
    await committed();
    expect(liveText(world, id, 'p3')).toBe('Typed: A plain paragraph the human types into. Words to keep.');
    expect(body(world.service.live(id)).toArray().map((node) => (node as never as { getAttr(k: string): unknown }).getAttr('id'))).toEqual(['h1', 'p1', 'p2', 'l1', 'tb1', 'c1', 'p3', 'p4']);
    expect(world.persistedAuthors(id, 'p3')).toEqual(['human']);
    const map = mergeMaps(world.storage.attributions(id, 1, Number.MAX_SAFE_INTEGER).map(decodeMap));
    expect(carriedBy(map, idAt(nodeOf(world.service.live(id), 'p3'), 'Typed: '.length)!)).toBe('move');
  });

  it('A’s per-row attribution: text a person typed into the old copy before an agent replica’s move arrived keeps its author in every persisted row', async () => {
    const id = await world.seeded();
    const agent = world.connect(id, AGENT); // an agent replica that moves before it sees the keystrokes
    const person = world.connect(id, HUMAN);
    const move = agent.edit(
      (doc) => {
        const applied = applyEdit(doc, [{ op: 'move', id: 'p3', after: 'c1' }]);
        world.kind.adapter.registerCarries(id, applied.carries);
      },
      { hold: true },
    );
    typeAt(person, 'p3', 0, 'Late: '); // reaches the host before the move
    await committed();
    agent.send(move); // the move's frame carries the late keystrokes into the moved copy through the agent's host replica
    await committed();
    expect(liveText(world, id, 'p3')).toBe('Late: A plain paragraph the human types into. Words to keep.');
    expect(world.persistedAuthors(id, 'p3')).toEqual(['human']);
  });

  it('A’s per-row attribution: the edits the id repair carries from a losing copy keep their author', async () => {
    const id = await world.seeded();
    const first = world.connect(id, AGENT);
    const stale = world.connect(id, OTHER); // moves p3 without having seen the first move
    const person = world.connect(id, HUMAN);
    first.edit((doc) => world.kind.adapter.registerCarries(id, applyEdit(doc, [{ op: 'move', id: 'p3', after: 'c1' }]).carries));
    await committed();
    person.pull();
    typeAt(person, 'p3', 0, 'Edited: '); // into the first copy, which the repair then drops for the stale one's
    await committed();
    stale.edit((doc) => world.kind.adapter.registerCarries(id, applyEdit(doc, [{ op: 'move', id: 'p3', after: 'h1' }]).carries));
    await committed();
    const live = world.service.live(id);
    expect(dupes(ids(live))).toEqual([]);
    expect(textOf(live, 'p3')).toBe('Edited: A plain paragraph the human types into. Words to keep.');
    expect(world.persistedAuthors(id, 'p3')).toEqual(['human']);
  });

  it('writes the threads mirror A keeps from the rows the adapter returns', async () => {
    const id = await world.seeded();
    await world.service.writeAs(id, AGENT, (doc) => {
      const anchor = anchorOfMark(body(doc), 't4')!;
      addThread(doc, { threadId: 'tAgent', tabId: TAB, blockId: 'p3', quote: 'Words', anchor, by: AGENT, at: now(), body: 'Why keep these?' });
    });
    await committed();
    const rows = world.storage.db.prepare('SELECT threadId, status, quote, appSessionId FROM artifact_threads WHERE artifactId = ? ORDER BY threadId').all(id);
    expect(rows).toContainEqual({ threadId: 'tAgent', status: 'open', quote: 'Words', appSessionId: 'app-agent' });
  });

  it('forgets an artifact’s carries when the artifact is deleted', async () => {
    const id = await world.seeded();
    await world.service.writeAs(id, AGENT, (doc) => world.kind.adapter.registerCarries(id, applyEdit(doc, [{ op: 'move', id: 'p3', after: 'c1' }]).carries));
    expect(world.kind.adapter.stats().carries).toBeGreaterThan(0);
    await world.store.delete(id);
    expect(world.kind.adapter.stats().carries).toBe(0);
  });
});
