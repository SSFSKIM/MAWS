// The threads model (D1 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.4 as amended by S5, Decision Log 31),
// ported from S5's `s5-pins.mjs` and `s5-concurrency.mjs` as far as they need no editor (the rest in M4): overlapping
// comments under two storage keys, a thread a nested node whose messages are a sequence, resolve and reopen written
// to the threads map only, orphaned derived (open and no live text), the stored anchor's locate and the host's
// refresh, and the strip of a mark whose thread is absent.
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { applyV1, applyV2, diffV1, newDoc, onUpdate, stateV2, stateVector, transact, type Doc, type Node } from '../yjs';
import { UndoManager, YNode } from '../yjs/document';
import { pmnodeToDelta, ynodeToPmnode } from '../yjs/prosemirror';
import { schemaFor } from './schema';
import { addTab, createDocument, tabBody } from './tabs';
import {
  addThread,
  anchorOfMark,
  getThread,
  listThreads,
  liveThreadIds,
  locate,
  markExtents,
  refreshAnchors,
  reopen,
  reply,
  resolve,
  stripMarklessComments,
  threadStates,
} from './threads';
import type { Actor } from '@shared/artifacts/actor';

const schema = schemaFor();
const owner: Actor = { kind: 'human' };
const agent = { kind: 'session', appSessionId: 'session-1' } as Actor;
let clock = 1_760_000_000_000;
const now = () => (clock += 1000);

const P1 = 'The plan ships quarterly with design review notes. Owners track the budget.';
const comment = (threadId: string) => ({ type: 'comment', attrs: { threadId } });
const seedJSON = (): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
    {
      type: 'paragraph',
      attrs: { id: 'p1' },
      content: [
        { type: 'text', text: 'The plan ' },
        { type: 'text', text: 'ships quarterly with ', marks: [comment('t1')] },
        { type: 'text', text: 'design review', marks: [comment('t1'), comment('t2')] },
        { type: 'text', text: ' notes', marks: [comment('t2')] },
        { type: 'text', text: '. Owners track the budget.' },
      ],
    },
    { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Second paragraph ' }, { type: 'text', text: 'keeps going', marks: [comment('t3')] }, { type: 'text', text: ' here.' }] },
    { type: 'paragraph', attrs: { id: 'p3' }, content: [{ type: 'text', text: 'Third paragraph.' }] },
  ],
});

/** A document with t1 and t2 overlapping on p1 and t3 on p2, each thread written with its anchor from the live mark. */
function seeded(doc: Doc = newDoc()): { doc: Doc; tab: string; body: Node } {
  const tab = createDocument(doc, { title: 'Main', body: schema.nodeFromJSON(seedJSON()) });
  const body = tabBody(doc, tab)!;
  const quotes: Record<string, string> = { t1: 'ships quarterly with design review', t2: 'design review notes', t3: 'keeps going' };
  for (const id of ['t1', 't2', 't3']) {
    addThread(doc, { threadId: id, tabId: tab, blockId: id === 't3' ? 'p2' : 'p1', quote: quotes[id], anchor: anchorOfMark(body, id)!, by: owner, at: now(), body: `About ${id}` });
  }
  return { doc, tab, body };
}

const blockY = (root: Node, id: string): Node => {
  for (const child of root.toArray()) {
    if (!(child instanceof YNode)) continue;
    if (child.getAttr('id') === id) return child;
    const inner = child.toArray().some((c) => c instanceof YNode) ? blockY(child, id) : undefined;
    if (inner) return inner;
  }
  return undefined as unknown as Node;
};
const plain = (node: Node): string =>
  node
    .toArray()
    .map((c) => (typeof c === 'string' ? c : ''))
    .join('');
const deleteText = (root: Node, blockId: string, text: string) => {
  const node = blockY(root, blockId);
  const at = plain(node).indexOf(text);
  if (at < 0) throw new Error(`no "${text}" in ${blockId}`);
  node.delete(at, text.length);
};
const states = (doc: Doc) =>
  threadStates(doc, liveThreadIds(doc))
    .map((t) => `${t.id}:${t.status}${t.orphan ? ':orphan' : ''}`)
    .join(' ');
const covered = (body: Node) => {
  const out: Record<string, string> = {};
  for (const [id, extent] of markExtents(body)) {
    out[id] = plain(extent.first.node).slice(extent.first.index, extent.last.index);
  }
  return out;
};
/** The storage key a block's text carries thread `id`'s mark under (the schema derived it; never hand-written). */
const keyOf = (root: Node, blockId: string, id: string): string => {
  for (const op of blockY(root, blockId).toDelta().children as unknown as Iterable<{ format?: Record<string, { threadId?: string } | null> }>) {
    const hit = Object.entries(op.format ?? {}).find(([, value]) => value?.threadId === id);
    if (hit) return hit[0];
  }
  throw new Error(`no mark of ${id} in ${blockId}`);
};
/** Two replicas offline: each edits, then they exchange what the other lacks. */
const exchange = (a: Doc, b: Doc) => {
  const toB = diffV1(a, stateVector(b));
  const toA = diffV1(b, stateVector(a));
  applyV1(b, toB);
  applyV1(a, toA);
};
const replica = (doc: Doc): Doc => {
  const copy = newDoc();
  applyV2(copy, stateV2(doc));
  return copy;
};

describe('the comment mark in Yjs', () => {
  it('stores two overlapping comments under two hashed keys', () => {
    const { body } = seeded();
    const keys = new Set(JSON.stringify(blockY(body, 'p1').toDelta().toJSON()).match(/comment--[A-Za-z0-9+/=]+/g));
    expect(keys.size).toBe(2);
  });

  it('covers what was marked, and a reader without the threads map still renders the marks', () => {
    const { body } = seeded();
    expect(covered(body)).toEqual({ t1: 'ships quarterly with design review', t2: 'design review notes', t3: 'keeps going' });
    expect(JSON.stringify(ynodeToPmnode(body, schema).toJSON())).toContain('"threadId":"t2"');
  });
});

describe('a thread', () => {
  it('is a nested node: the record’s fields, the first message, ordered by creation', () => {
    const { doc, tab } = seeded();
    const t1 = getThread(doc, 't1')!;
    expect(t1).toMatchObject({ id: 't1', tabId: tab, blockId: 'p1', status: 'open', quote: 'ships quarterly with design review', createdBy: owner });
    expect(t1.messages).toEqual([{ id: 't1:m0', by: owner, at: t1.createdAt, body: 'About t1' }]);
    expect(listThreads(doc).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('takes replies as a sequence: concurrent replies both land', () => {
    const { doc } = seeded();
    const other = replica(doc);
    reply(doc, 't1', { id: 'r1', by: owner, at: now(), body: 'First' });
    reply(other, 't1', { id: 'r2', by: agent, at: now(), body: 'Second' });
    exchange(doc, other);
    expect(getThread(doc, 't1')!.messages.map((m) => m.id).sort()).toEqual(['r1', 'r2', 't1:m0']);
    expect(getThread(other, 't1')!.messages).toEqual(getThread(doc, 't1')!.messages);
  });

  it('resolves with one write to the threads map, the text untouched, and reopens', () => {
    const { doc, body } = seeded();
    const before = JSON.stringify(body.toDelta().toJSON());
    const updates: Uint8Array[] = [];
    const off = onUpdate(doc, (update) => updates.push(update));
    resolve(doc, 't1', owner, now());
    off();
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(body.toDelta().toJSON())).toBe(before);
    expect(getThread(doc, 't1')).toMatchObject({ status: 'resolved', resolvedBy: owner });
    expect(states(doc)).toBe('t1:resolved t2:open t3:open');
    reopen(doc, 't1', agent, now());
    expect(getThread(doc, 't1')).toMatchObject({ status: 'open', reopenedBy: agent });
  });

  it('keeps a resolve racing a reply: both land on both replicas', () => {
    const { doc } = seeded();
    const other = replica(doc);
    resolve(doc, 't1', owner, now());
    reply(other, 't1', { id: 'r1', by: agent, at: now(), body: 'Done.' });
    exchange(doc, other);
    for (const d of [doc, other]) expect(getThread(d, 't1')).toMatchObject({ status: 'resolved', messages: [{ id: 't1:m0' }, { id: 'r1' }] });
  });

  it('reopens on the passage as it now reads, edits made while it was resolved included (S5 item 1)', () => {
    const { doc, body } = seeded();
    resolve(doc, 't1', owner, now());
    const p1 = blockY(body, 'p1');
    p1.insert(plain(p1).indexOf('quarterly'), 'very ', { [keyOf(body, 'p1', 't1')]: { threadId: 't1' } });
    reopen(doc, 't1', agent, now());
    expect(covered(body).t1).toBe('ships very quarterly with design review');
    expect(states(doc)).toBe('t1:open t2:open t3:open');
  });

  it('converges when one replica resolves while the other reopens', () => {
    const { doc } = seeded();
    resolve(doc, 't2', owner, now());
    const other = replica(doc);
    resolve(doc, 't2', owner, now());
    reopen(other, 't2', agent, now());
    exchange(doc, other);
    expect(getThread(doc, 't2')!.status).toBe(getThread(other, 't2')!.status);
  });
});

describe('the derived orphan state', () => {
  it('orphans an open thread whose text is gone, and un-orphans it with no thread write when the text returns', () => {
    const { doc, body } = seeded();
    const before = stateV2(doc);
    deleteText(body, 'p1', 'ships quarterly with design review notes');
    expect(states(doc)).toBe('t1:open:orphan t2:open:orphan t3:open');
    const restored = newDoc();
    applyV2(restored, before);
    expect(states(restored)).toBe('t1:open t2:open t3:open');
  });

  it('lists a resolved thread whose text is deleted as resolved, and orphaned once reopened', () => {
    const { doc, body } = seeded();
    resolve(doc, 't2', owner, now());
    deleteText(body, 'p1', ' notes');
    deleteText(body, 'p1', 'design review');
    expect(states(doc)).toBe('t1:open t2:resolved t3:open');
    reopen(doc, 't2', owner, now());
    expect(states(doc)).toBe('t1:open t2:open:orphan t3:open');
  });

  it('reads live marks across every tab, and a deletion in one replica orphans on both', () => {
    const { doc, tab } = seeded();
    const second = addTab(doc, { title: 'Two', body: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'x1' }, content: [{ type: 'text', text: 'Elsewhere', marks: [comment('t9')] }] }] }) });
    addThread(doc, { threadId: 't9', tabId: second, blockId: 'x1', quote: 'Elsewhere', anchor: anchorOfMark(tabBody(doc, second)!, 't9')!, by: owner, at: now() });
    expect(states(doc)).toBe('t1:open t2:open t3:open t9:open');
    const other = replica(doc);
    deleteText(tabBody(other, tab)!, 'p2', 'keeps going');
    exchange(doc, other);
    expect(states(doc)).toBe('t1:open t2:open t3:open:orphan t9:open');
  });

  it('un-orphans when a peer undoes the deletion while another replica typed elsewhere (S5 orphan (d))', () => {
    const { doc, tab } = seeded();
    const other = replica(doc);
    const otherBody = tabBody(other, tab)!;
    const undo = new UndoManager(otherBody, { trackedOrigins: new Set(['peer']) });
    transact(other, () => deleteText(otherBody, 'p1', 'design review notes'), 'peer');
    exchange(doc, other);
    expect(states(doc)).toBe('t1:open t2:open:orphan t3:open');
    const p3 = blockY(tabBody(doc, tab)!, 'p3');
    p3.insert(0, 'Meanwhile. ');
    exchange(doc, other);
    undo.undo();
    exchange(doc, other);
    expect(states(doc)).toBe('t1:open t2:open t3:open');
    expect(covered(tabBody(doc, tab)!).t2).toBe('design review notes');
    expect(plain(p3)).toBe('Meanwhile. Third paragraph.');
  });

  it('survives a reload (the restart row): statuses and marks back, no write on load', () => {
    const { doc } = seeded();
    resolve(doc, 't2', owner, now());
    const reloaded = replica(doc);
    expect(states(reloaded)).toBe('t1:open t2:resolved t3:open');
    expect(covered(tabBody(reloaded, listThreads(reloaded)[0].tabId)!)).toEqual({ t1: 'ships quarterly with design review', t2: 'design review notes', t3: 'keeps going' });
  });
});

describe('the stored anchor', () => {
  it('locates a passage deleted in place at the gap where it was, in its block', () => {
    const { doc, body } = seeded();
    deleteText(body, 'p1', 'ships quarterly with design review notes');
    const where = locate(doc, getThread(doc, 't1')!);
    expect(where).toMatchObject({ how: 'text', blockId: 'p1' });
    expect(where.how === 'text' && P1.slice(0, where.index)).toBe('The plan ');
  });

  it('names the nearest surviving block when the whole block is gone', () => {
    const { doc, body } = seeded();
    body.delete(1, 1); // p1
    const where = locate(doc, getThread(doc, 't1')!);
    expect(where.how).toBe('block-gap');
    expect(['h1', 'p2']).toContain(where.blockId);
  });

  it('refreshes a drifted pair from the live mark in one pass, and leaves a bracketing pair alone', () => {
    const { doc, body } = seeded();
    expect(refreshAnchors(doc)).toEqual([]);
    // the passage moves (as a cut and paste does): out of p2, into p3, re-created under the same key (the leading space with it)
    const key = keyOf(body, 'p2', 't3');
    deleteText(body, 'p2', 'keeps going');
    const p3 = blockY(body, 'p3');
    p3.insert(plain(p3).length, ' keeps going', { [key]: { threadId: 't3' } });
    const before = getThread(doc, 't3')!.anchor;
    expect(refreshAnchors(doc, { actor: 'host' })).toEqual(['t3']);
    expect(getThread(doc, 't3')!.blockId).toBe('p3');
    expect(getThread(doc, 't3')!.anchor).not.toEqual(before);
    expect(locate(doc, getThread(doc, 't3')!)).toMatchObject({ how: 'text', blockId: 'p3', index: 'Third paragraph.'.length });
    expect(refreshAnchors(doc)).toEqual([]);
  });

  it('after a split before the passage and the passage deleted, names the split point without a refresh and the passage’s own block with one (S5 orphan (c))', () => {
    for (const refresh of [false, true]) {
      const { doc, body } = seeded();
      // Enter before "ships": the rest of p1 moves into a new block under new items, its marks with it
      const p1 = blockY(body, 'p1');
      const rest = ynodeToPmnode(body, schema).child(1).cut('The plan '.length);
      const tail = schema.nodes.paragraph.create({ id: 'p1b' }, rest.content);
      p1.delete('The plan '.length, plain(p1).length - 'The plan '.length);
      body.insert(2, [YNode.from(pmnodeToDelta(tail))]);
      expect([plain(p1), plain(blockY(body, 'p1b'))]).toEqual(['The plan ', 'ships quarterly with design review notes. Owners track the budget.']);
      if (refresh) expect(refreshAnchors(doc)).toEqual(['t1', 't2']);
      deleteText(body, 'p1b', 'ships quarterly with design review notes');
      const where = locate(doc, getThread(doc, 't1')!);
      if (refresh) expect(where).toMatchObject({ how: 'text', blockId: 'p1b', index: 0 });
      else expect(where).toMatchObject({ blockId: 'p1' });
    }
  });

  it('records the tab and block a moved comment now lives in', () => {
    const { doc, body } = seeded();
    const second = addTab(doc, { title: 'Two' });
    deleteText(body, 'p2', 'keeps going');
    const target = tabBody(doc, second)!;
    const moved = schema.nodeFromJSON({ type: 'paragraph', attrs: { id: 'y1' }, content: [{ type: 'text', text: 'keeps going', marks: [comment('t3')] }] });
    target.insert(1, [YNode.from(pmnodeToDelta(moved))]);
    expect(refreshAnchors(doc)).toEqual(['t3']);
    expect(getThread(doc, 't3')).toMatchObject({ tabId: second, blockId: 'y1' });
  });
});

describe('the markless-comment strip', () => {
  it('removes a comment mark whose thread is absent and keeps the rest', () => {
    const { doc, body } = seeded();
    const p3 = blockY(body, 'p3');
    p3.format(0, 5, { 'comment--ghost123': { threadId: 'ghost' } });
    expect(JSON.stringify(ynodeToPmnode(body, schema).toJSON())).toContain('ghost');
    expect(stripMarklessComments(doc, { actor: 'host' })).toEqual(['ghost']);
    expect(JSON.stringify(ynodeToPmnode(body, schema).toJSON())).not.toContain('ghost');
    expect(covered(body)).toEqual({ t1: 'ships quarterly with design review', t2: 'design review notes', t3: 'keeps going' });
    expect(stripMarklessComments(doc)).toEqual([]);
  });
});
