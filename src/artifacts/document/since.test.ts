// `sinceRevision`'s pure half (D7): the blocks the changes since a revision touched, found from the changes' item ids,
// and the blocks deleted since; and the read showing only the touched blocks of its range.
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { applyV1, contentIdsOf, diffV1, newDoc, onUpdate, transact, type Doc, type Node } from '../yjs';
import { DocIndex } from './block-index';
import { readDocument } from './read';
import { schemaFor } from './schema';
import { blockIdsOf, deletedSince, touchedBlocks } from './since';
import { addTab, createDocument, tabBody } from './tabs';
import { pmnodeToDelta } from '../yjs/prosemirror';

const schema = schemaFor();
const text = (value: string): JSONContent => ({ type: 'text', text: value });
const para = (id: string, value: string): JSONContent => ({ type: 'paragraph', attrs: { id }, content: [text(value)] });

function world(): { doc: Doc; tab: string; other: string } {
  const doc = newDoc();
  const tab = createDocument(doc, {
    title: 'One',
    body: schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [text('Title')] },
        para('p1', 'First paragraph.'),
        { type: 'heading', attrs: { id: 'h2', level: 2 }, content: [text('Section')] },
        para('p2', 'Untouched paragraph.'),
        { type: 'bulletList', attrs: { id: 'ul' }, content: [{ type: 'listItem', attrs: { id: 'li1' }, content: [para('li1p', 'Item one')] }, { type: 'listItem', attrs: { id: 'li2' }, content: [para('li2p', 'Item two')] }] },
        para('p3', 'Doomed paragraph.'),
        para('p4', 'Also untouched.'),
      ],
    }),
  });
  const other = addTab(doc, { title: 'Two', body: schema.nodeFromJSON({ type: 'doc', content: [para('z1', 'Other tab.')] }) });
  return { doc, tab, other };
}

const node = (doc: Doc, id: string): Node => DocIndex.of(doc).find(id)!.node;
const tops = (set: Set<{ id: string | null }>) => [...set].map((top) => top.id).sort();

/** Another replica's changes to `doc`, applied to it; answers their item ids as the host's provenance holds them. */
function changes(doc: Doc, edit: (peer: Doc) => void): Array<ReturnType<typeof contentIdsOf>> {
  const peer = newDoc();
  applyV1(peer, diffV1(doc));
  const updates: Uint8Array[] = [];
  onUpdate(peer, (update) => updates.push(update));
  edit(peer);
  for (const update of updates) applyV1(doc, update);
  return updates.map(contentIdsOf);
}

describe('what changed since a revision', () => {
  it('names the top-level blocks whose text, attributes or nested blocks changed, and the blocks deleted', () => {
    const { doc, tab } = world();
    const before = blockIdsOf(doc);
    expect([...before].sort()).toEqual(['h1', 'h2', 'li1', 'li1p', 'li2', 'li2p', 'p1', 'p2', 'p3', 'p4', 'ul', 'z1']);
    const ids = changes(doc, (peer) => {
      transact(peer, () => node(peer, 'p1').insert(0, 'Edited: '));
      transact(peer, () => node(peer, 'h2').setAttr('level', 3));
      transact(peer, () => node(peer, 'li2p').delete(0, 5));
      const body = tabBody(peer, tab)!;
      transact(peer, () => body.delete(5, 1)); // p3
      transact(peer, () => body.insert(2, [pmnodeToDelta(schema.nodeFromJSON(para('n1', 'New paragraph.')))]));
    });
    const touched = touchedBlocks(doc, ...ids.flatMap((set) => [set.inserts, set.deletes]));
    expect(tops(touched)).toEqual(['h2', 'n1', 'p1', 'ul']);
    expect(deletedSince(doc, before)).toEqual(['p3']);
  });

  it('names nothing for changes outside the tabs (a thread’s messages)', () => {
    const { doc } = world();
    const ids = changes(doc, (peer) => transact(peer, () => peer.get('threads').setAttr('t1', 'x')));
    expect(touchedBlocks(doc, ...ids.flatMap((set) => [set.inserts, set.deletes])).size).toBe(0);
  });

  it('a read of only the touched blocks shows them, in order, inside its range', () => {
    const { doc } = world();
    const ids = changes(doc, (peer) => {
      transact(peer, () => node(peer, 'p4').insert(0, 'Late: '));
      transact(peer, () => node(peer, 'p1').insert(0, 'Early: '));
    });
    const touched = touchedBlocks(doc, ...ids.flatMap((set) => [set.inserts, set.deletes]));
    const read = readDocument(doc, { only: touched });
    expect(read.shown).toEqual(['p1', 'p4']);
    expect(read.markdown).toBe('Early: First paragraph. ^p1\n\nLate: Also untouched. ^p4\n');
    expect(readDocument(doc, { only: touched, from: 'p2', count: 2 }).shown).toEqual([]);
  });
});

describe('the read through the block index (Decision Log 20)', () => {
  it('converts each block it shows once, through the index the writer plans with', () => {
    const { doc } = world();
    const index = DocIndex.of(doc);
    const read = readDocument(doc, { count: 3 });
    expect(read.shown).toEqual(['h1', 'p1', 'h2']);
    const [h1] = index.tops(read.tab);
    const pm = index.pm(h1);
    readDocument(doc, { count: 3 });
    expect(index.pm(h1)).toBe(pm); // cached, not converted again
    transact(doc, () => node(doc, 'h1').insert(0, 'New '));
    expect(index.pm(index.tops(read.tab)[0])).not.toBe(pm); // a change rebuilds it
  });

  it('warms every block of every tab in slices, stopping when asked and finishing later', () => {
    const { doc, other } = world();
    const index = DocIndex.of(doc);
    let slice = 0;
    expect(index.warm(() => ++slice > 3)).toBe(false);
    const tops = () => index.tabIds().flatMap((id) => index.tops(id));
    const warmed = () => tops().filter((top) => top.textCache !== null).length;
    // M9: every block's Yjs text first (the unscoped quote's prefilter), then the converted text
    expect(tops().filter((top) => top.rawTextCache !== null).length).toBe(3);
    expect(warmed()).toBe(0);
    expect(index.warm()).toBe(true);
    expect(tops().every((top) => top.rawTextCache !== null)).toBe(true);
    expect(warmed()).toBe(8);
    expect(index.tops(other)[0].textCache).toBe('Other tab.');
  });
});
