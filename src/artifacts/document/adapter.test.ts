// The document kind adapter (D8) on A's hook points, driven the way A's service drives them (src/engine-host/documents/
// service.ts `content`, `writeThrough`, `afterUpdate`): `beforeApply` with the live doc and the raw bytes, the apply,
// the forwarding edit and `afterUpdate` on the actor's host replica (a synchronous mirror of the live doc), whose writes
// land as that actor's own update. S4's `moves.ts` (12 checks) re-expressed against the adapter: in-flight keystrokes
// into a moved block, two concurrent moves of one block (keep the later copy after carrying the other's edits), an edit
// into the original after both moves, concurrent splits carrying one id; then the rest of D8: provenance carries, the
// markless strip, the anchor refresh, the threads mirror, the registry's pruning, `revertScope` and `afterRestore`.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { actorKey } from '@shared/artifacts/actor';
import type { KindAdapter, ThreadChange } from '../host';
import {
  applyV1,
  applyV2,
  attributionMap,
  carriedBy,
  carryAttribution,
  contentIdsOf,
  diffV1,
  insertedBy,
  mergeMaps,
  newDoc,
  onUpdate,
  revertUpdate,
  stateV2,
  stateVector,
  transact,
  type Carry as AttributionCarry,
  type ContentMap,
  type Doc,
} from '../yjs';
import { pmnodeToDelta } from '../yjs/prosemirror';
import { documentAdapter, type DocumentAdapter } from './adapter';
import { DocIndex } from './block-index';
import { applyEdit } from './patch-writer';
import { schemaFor } from './schema';
import { addThread, anchorOfMark, getThread, listThreads, reply, resolve } from './threads';
import { body, coveredIn, dupes, ids, marksOf, nodeOf, now, order, replica, seedDoc, sequence, textOf, TAB } from './writer.fixture';

const human: Actor = { kind: 'human' };
const agent1 = { kind: 'session', appSessionId: 'session-1' } as Actor;
const agent2 = { kind: 'session', appSessionId: 'session-2' } as Actor;
const MIRROR = Symbol('mirror');
const PULL = Symbol('pull');
const ARTIFACT = 'art-1';

/** A's service in miniature: the live doc, a host replica per actor, the hooks in A's order, provenance per update. */
class Host {
  readonly live: Doc;
  readonly replicas = new Map<string, Doc>();
  readonly maps: ContentMap[] = [];
  readonly threadChanges: ThreadChange[] = [];
  private readonly writers = new Map<unknown, Actor>();

  constructor(
    seed: Doc,
    readonly adapter: KindAdapter,
  ) {
    this.live = newDoc();
    onUpdate(this.live, (update, origin) => {
      for (const doc of this.replicas.values()) if (doc !== origin) applyV1(doc, update, MIRROR);
      const actor = this.writers.get(origin) ?? human;
      const entry = { update, map: attributionMap(contentIdsOf(update), { insertActor: actorKey(actor), deleteActor: actorKey(actor), at: now() }) };
      if (this.deferring && !this.pending) this.pending = entry; // the frame's own update waits for afterUpdate
      else this.maps.push(entry.map);
    });
    applyV1(this.live, diffV1(seed)); // the seed, credited to the human
  }

  private pending: { update: Uint8Array; map: ContentMap } | null = null;
  private deferring = false;
  private attribute(carries?: AttributionCarry[]): void {
    if (!this.pending) return;
    const prior = this.maps.length ? mergeMaps(this.maps) : this.pending.map;
    this.maps.push(carries?.length ? carryAttribution(this.pending.map, prior, carries) : this.pending.map);
    this.pending = null;
  }

  replicaOf(actor: Actor): Doc {
    const key = actorKey(actor);
    let doc = this.replicas.get(key);
    if (!doc) {
      doc = newDoc();
      applyV1(doc, diffV1(this.live), MIRROR);
      const mine = doc;
      this.writers.set(mine, actor);
      onUpdate(mine, (update, origin) => {
        if (origin !== MIRROR) applyV1(this.live, update, mine);
      });
      this.replicas.set(key, doc);
    }
    return doc;
  }

  /** One content frame from a connection of `actor`. */
  receive(update: Uint8Array, actor: Actor, { step2 = false } = {}): ReturnType<NonNullable<KindAdapter['afterUpdate']>> {
    const conn = { actor };
    this.writers.set(conn, actor);
    const forward = this.adapter.beforeApply?.(this.live, update, { actor, step2 }) ?? null;
    let applied: Uint8Array | null = null;
    const off = onUpdate(this.live, (u) => (applied ??= u));
    this.deferring = true;
    applyV1(this.live, update, conn);
    off();
    const doc = this.replicaOf(actor);
    if (forward) transact(doc, () => forward(doc), doc);
    const box: { outcome?: ReturnType<NonNullable<KindAdapter['afterUpdate']>> } = {};
    if (applied) transact(doc, () => (box.outcome = this.adapter.afterUpdate?.(doc, { update: applied!, actor })), doc);
    this.deferring = false;
    this.attribute(box.outcome?.provenance);
    if (box.outcome?.threads) this.threadChanges.push(box.outcome.threads);
    return box.outcome;
  }

  /** A replica connected to the host by hand: its own transactions queue as incremental updates until `send`. */
  peer(): Doc {
    const doc = replica(this.live);
    const queue: Uint8Array[] = [];
    onUpdate(doc, (update, origin) => origin !== PULL && queue.push(update));
    this.queues.set(doc, queue);
    return doc;
  }
  private readonly queues = new WeakMap<Doc, Uint8Array[]>();

  /** Sends the peer's queued updates one by one, as its provider would; answers the last frame's outcome. */
  send(doc: Doc, actor: Actor) {
    const queue = this.queues.get(doc)!;
    let outcome: ReturnType<Host['receive']> = undefined;
    while (queue.length) outcome = this.receive(queue.shift()!, actor);
    return outcome;
  }

  /** Brings `doc` up to the host's state. */
  pull(doc: Doc): void {
    applyV1(doc, diffV1(this.live, stateVector(doc)), PULL);
  }

  provenance(): ContentMap {
    return mergeMaps(this.maps);
  }
}

const typeAt = (doc: Doc, id: string, at: number | 'end', text: string) => transact(doc, () => nodeOf(doc, id).insert(at === 'end' ? nodeOf(doc, id).length : at, text, {}));
const compose = (doc: Doc, id: string, from: number, len: number, text: string) =>
  transact(doc, () => {
    nodeOf(doc, id).delete(from, len);
    nodeOf(doc, id).insert(from, text, {});
  });
/** The agent's batch on its replica, its carries registered, its update sent. */
function agentBatch(host: Host, adapter: DocumentAdapter, doc: Doc, actor: Actor, ops: Parameters<typeof applyEdit>[1]) {
  const applied = applyEdit(doc, ops);
  adapter.registerCarries(ARTIFACT, applied.carries);
  return { applied, outcome: host.send(doc, actor) };
}
const withoutForwarding = (adapter: DocumentAdapter): KindAdapter => ({ ...adapter, kind: 'document', beforeApply: undefined, afterUpdate: adapter.afterUpdate, revertScope: adapter.revertScope });

describe('forwarding (S4 moves A)', () => {
  for (const forwarding of [true, false]) {
    it(forwarding ? 'keystrokes in flight while their block moved land in the moved block' : 'without forwarding the in-flight keystrokes are lost (shown)', () => {
      const adapter = documentAdapter();
      const host = new Host(seedDoc(), forwarding ? adapter : withoutForwarding(adapter));
      const agent = host.peer();
      const person = host.peer();
      typeAt(person, 'p3', 'end', ' ㅎ');
      host.send(person, human);
      host.pull(agent);
      agentBatch(host, adapter, agent, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
      // the person keeps composing on a replica that has not seen the move: each step its own incremental update
      const len = nodeOf(person, 'p3').length;
      compose(person, 'p3', len - 1, 1, '하');
      compose(person, 'p3', len - 1, 1, '한');
      typeAt(person, 'p3', 'end', '글');
      host.send(person, human);
      host.pull(person);
      host.pull(agent);
      const p3 = textOf(host.live, 'p3');
      if (forwarding) {
        expect(p3).toBe('A plain paragraph the human types into. Words to keep. 한글');
        expect(order(host.live).indexOf('p3')).toBe(order(host.live).indexOf('c1') + 1);
        expect(dupes(ids(host.live))).toEqual([]);
        expect(textOf(person, 'p3')).toBe(p3);
        expect(textOf(agent, 'p3')).toBe(p3);
      } else expect(p3).not.toBe('A plain paragraph the human types into. Words to keep. 한글');
    });
  }

  it('replays nothing from a sync step 2: a reconnecting replica that saw the move does not delete the moved text', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const person = host.peer();
    agentBatch(host, adapter, agent, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    host.pull(person); // the person saw the move (its delete set holds the original's characters)
    typeAt(person, 'p1', 0, 'Hi. ');
    // reconnect: the whole state as a step 2, the move's deletion included
    host.receive(diffV1(person, stateVector(host.live)), human, { step2: true });
    expect(textOf(host.live, 'p3')).toBe('A plain paragraph the human types into. Words to keep.');
    expect(textOf(host.live, 'p1').startsWith('Hi. The quick')).toBe(true);
  });

  it('an edit that reached the original block before the move’s update is carried into the moved copy', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const person = host.peer();
    const applied = applyEdit(agent, [{ op: 'move', id: 'p3', after: 'c1' }]);
    adapter.registerCarries(ARTIFACT, applied.carries);
    // the person's keystrokes and a deletion reach the host first, into the original
    typeAt(person, 'p3', 0, 'So: ');
    transact(person, () => nodeOf(person, 'p3').delete(nodeOf(person, 'p3').length - ' to keep.'.length, ' to keep'.length));
    host.send(person, human);
    host.send(agent, agent1); // then the move
    host.pull(person);
    expect(textOf(host.live, 'p3')).toBe('So: A plain paragraph the human types into. Words.');
    expect(textOf(person, 'p3')).toBe(textOf(host.live, 'p3'));
    expect(dupes(ids(host.live))).toEqual([]);
  });
  it('a keystroke that raced the agent’s rewrite into another type is carried over, and the words the agent replaced stay replaced', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const person = host.peer();
    const applied = applyEdit(agent, [{ op: 'replace_block', id: 'p4', markdown: '## Closing words of this section, with enough words to look like prose that a person wrote.' }]);
    adapter.registerCarries(ARTIFACT, applied.carries);
    typeAt(person, 'p4', textOf(person, 'p4').length - 1, ' today'); // before the final period, into the old paragraph
    typeAt(person, 'p4', 'Closing paragraph'.length, ' text'); // right after a word the agent replaces
    host.send(person, human);
    const { outcome } = { outcome: host.send(agent, agent1) };
    host.pull(person);
    expect(nodeOf(host.live, 'p4').name).toBe('heading');
    expect(textOf(host.live, 'p4')).toBe('Closing words text of this section, with enough words to look like prose that a person wrote today.');
    expect(outcome?.provenance?.[0]?.kind).toBe('retype');
    expect(textOf(person, 'p4')).toBe(textOf(host.live, 'p4'));
  });

  it('a human retype (the editor re-inserting a block under its id as another type) keeps the characters’ authors, marked retyped', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const person = host.peer();
    const index = DocIndex.of(person);
    const p2 = index.find('p2')!.top;
    const heading = schemaFor().nodes.heading.create({ id: 'p2', level: 2 }, index.pm(p2).content);
    const at = order(person).indexOf('p2');
    transact(person, () => {
      body(person).delete(at, 1);
      body(person).insert(at, [pmnodeToDelta(heading)]);
    });
    const outcome = host.send(person, human);
    expect(outcome?.provenance?.map((carry) => carry.kind)).toEqual(['retype']);
    expect(carriedBy(host.provenance(), nodeOf(host.live, 'p2')._start!.id)).toBe('retype');
  });
});

describe('concurrent moves and the id repair (S4 moves B, C, D)', () => {
  for (const registered of [true, false]) {
    it(registered ? 'keeps the later copy after carrying the other copy’s edits into it' : 'a copy whose carries were never registered is re-id’d, never deleted: no text is lost', () => {
      const adapter = documentAdapter({ generateID: sequence('r') });
      const host = new Host(seedDoc(), adapter);
      const a1 = host.peer();
      const a2 = host.peer(); // stale: it moves p3 without having seen a1's move
      const person = host.peer();
      agentBatch(host, adapter, a1, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
      host.pull(person);
      typeAt(person, 'p3', 0, 'Edited: '); // into a1's copy
      const second = applyEdit(a2, [{ op: 'move', id: 'p3', after: 'h1' }]);
      host.send(person, human);
      if (registered) adapter.registerCarries(ARTIFACT, second.carries);
      host.send(a2, agent2);
      host.pull(person);
      const after = order(host.live);
      expect(dupes(ids(host.live))).toEqual([]);
      if (registered) {
        expect(after.filter((id) => id === 'p3')).toHaveLength(1);
        expect(after.indexOf('p3')).toBe(after.indexOf('h1') + 1);
        expect(textOf(host.live, 'p3')).toBe('Edited: A plain paragraph the human types into. Words to keep.');
        expect(marksOf(host.live, 'p3')).toBe('Edited: A plain paragraph the human types into. |Words[c:t4]| to keep.');
      } else {
        expect(after.map((id) => textOf(host.live, id)).filter((text) => text.endsWith('types into. Words to keep.'))).toEqual(['A plain paragraph the human types into. Words to keep.', 'Edited: A plain paragraph the human types into. Words to keep.']);
        expect(after.filter((id) => /^r\d+$/.test(id))).toHaveLength(1);
      }
    });
  }

  it('an edit into the original after two concurrent moves is forwarded into the kept copy, once', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const a1 = host.peer();
    const a2 = host.peer();
    const person = host.peer();
    agentBatch(host, adapter, a1, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    const second = applyEdit(a2, [{ op: 'move', id: 'p3', after: 'h1' }]);
    adapter.registerCarries(ARTIFACT, second.carries);
    typeAt(person, 'p3', 2, 'very ');
    host.send(a2, agent2);
    host.send(person, human);
    expect(textOf(host.live, 'p3')).toBe('A very plain paragraph the human types into. Words to keep.');
    expect(dupes(ids(host.live))).toEqual([]);
    expect(order(host.live).indexOf('p3')).toBe(order(host.live).indexOf('h1') + 1);
  });

  it('concurrent splits that carry one id: the earliest keeps it, the later ones are re-id’d, no text deleted', () => {
    const adapter = documentAdapter({ generateID: sequence('r') });
    const host = new Host(seedDoc(), adapter);
    const split = (doc: Doc, at: number) => {
      const root = body(doc);
      const i = order(doc).indexOf('p4');
      const p4 = nodeOf(doc, 'p4');
      const tail = textOf(doc, 'p4').slice(at);
      transact(doc, () => {
        p4.delete(at, p4.length - at);
        root.insert(i + 1, [pmnodeToDelta(schemaFor().nodeFromJSON({ type: 'paragraph', attrs: { id: 'p4' }, content: [{ type: 'text', text: tail }] }))]);
      });
    };
    const d1 = host.peer();
    const d2 = host.peer();
    split(d1, 8);
    split(d2, 20);
    host.send(d1, human);
    host.send(d2, human);
    expect(dupes(ids(host.live))).toEqual([]);
    expect(ids(host.live)).toContain('p4');
    expect(ids(host.live).filter((id) => /^r\d+$/.test(id))).toHaveLength(2);
    expect(order(host.live).map((id) => textOf(host.live, id)).join('')).toContain('Closing ');
  });
});

describe('afterUpdate: provenance, repair, comments and the threads mirror', () => {
  it('returns the carries the update performed, so a move credits no character to the mover', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const { outcome } = agentBatch(host, adapter, agent, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    expect(outcome?.provenance).toHaveLength(1);
    expect(outcome?.provenance?.[0].kind).toBe('move');
    const map = host.provenance();
    const p3 = nodeOf(host.live, 'p3');
    const first = p3._start!.id;
    expect(insertedBy(map, first)?.actor).toBe('human');
    expect(carriedBy(map, first)).toBe('move');
  });

  it('ids a block that arrives without one, and re-ids a duplicate a replica wrote', () => {
    const adapter = documentAdapter({ generateID: sequence('x') });
    const host = new Host(seedDoc(), adapter);
    const peer = host.peer();
    transact(peer, () => {
      body(peer).insert(0, [pmnodeToDelta(schemaFor().nodeFromJSON({ type: 'paragraph', attrs: { id: null }, content: [{ type: 'text', text: 'no id' }] }))]);
      body(peer).insert(1, [pmnodeToDelta(schemaFor().nodeFromJSON({ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'a copied id' }] }))]);
    });
    host.send(peer, human);
    expect(order(host.live).slice(0, 2)).toEqual(['x1', 'x2']);
    expect(textOf(host.live, 'p1').startsWith('The quick')).toBe(true);
  });

  it('strips a comment mark whose thread is absent, and leaves one whose thread exists', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const peer = host.peer();
    transact(peer, () => nodeOf(peer, 'p4').format(0, 7, { 'comment--stray': { threadId: 'ghost' } }));
    const key = Object.keys([...(nodeOf(host.live, 'p1').toDelta() as unknown as { children: Iterable<{ format?: Record<string, unknown> }> }).children][1].format ?? {})[0];
    transact(peer, () => nodeOf(peer, 'p4').format(8, 9, { [key]: { threadId: 't1' } }));
    host.send(peer, human);
    expect(coveredIn(host.live, 'p4')).toEqual({ t1: 'paragraph' });
  });

  it('refreshes an anchor that drifted (a type change re-creates the commented text)', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const stale = JSON.stringify(getThread(host.live, 't3')?.anchor);
    agentBatch(host, adapter, agent, agent1, [{ op: 'replace_block', id: 'p2', markdown: '## The review is scheduled for Friday and the owner signs off after it.' }]);
    expect(JSON.stringify(getThread(host.live, 't3')?.anchor)).not.toBe(stale);
    expect(JSON.stringify(getThread(host.live, 't3')?.anchor)).toBe(JSON.stringify(anchorOfMark(body(host.live), 't3')));
  });

  it('returns the threads mirror rows of the threads an update changed', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const peer = host.peer();
    resolve(peer, 't1', human, 1_760_000_500_000);
    let outcome = host.send(peer, human);
    expect(outcome?.threads?.upsert?.map((row) => [row.threadId, row.status, row.resolvedAt])).toEqual([['t1', 'resolved', 1_760_000_500_000]]);
    reply(peer, 't2', { id: 't2:m1', by: agent1, at: 1_760_000_900_000, body: 'Done.' });
    outcome = host.send(peer, human);
    expect(outcome?.threads?.upsert).toEqual([expect.objectContaining({ threadId: 't2', status: 'open', updatedAt: 1_760_000_900_000, quote: 'brown fox' })]);
    typeAt(peer, 'p4', 0, 'x');
    expect(host.send(peer, human)?.threads).toBeUndefined();
  });

  it('prunes a carry once its moved copy is gone', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    agentBatch(host, adapter, agent, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    expect(adapter.stats().carries).toBe(1);
    host.pull(agent);
    agentBatch(host, adapter, agent, agent1, [{ op: 'delete', id: 'p3' }]);
    expect(adapter.stats().carries).toBe(0);
  });

  it('a human drag (a delete and an insert of one id in one update) counts as a move: a later concurrent move keeps one copy', () => {
    const adapter = documentAdapter();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer(); // stale for the drag
    const person = host.peer();
    const root = body(person);
    const p3 = DocIndex.of(person).find('p3')!.top;
    const json = DocIndex.of(person).pm(p3);
    transact(person, () => {
      root.delete(order(person).indexOf('p3'), 1);
      root.insert(order(person).indexOf('p4') + 1, [pmnodeToDelta(json)]);
    });
    const dragged = host.send(person, human);
    expect(dragged?.provenance?.[0]?.kind).toBe('move');
    const moved = applyEdit(agent, [{ op: 'move', id: 'p3', after: 'h1' }]);
    adapter.registerCarries(ARTIFACT, moved.carries);
    host.send(agent, agent1);
    expect(order(host.live).filter((id) => id === 'p3')).toHaveLength(1);
    expect(order(host.live).indexOf('p3')).toBe(order(host.live).indexOf('h1') + 1);
  });
});

describe('restore (revertScope, afterRestore)', () => {
  it('reverts text, marks and a thread’s status, and keeps a thread created after the version and a reply posted after it', () => {
    const adapter = documentAdapter();
    const live = seedDoc();
    const version = stateV2(live);
    resolve(live, 't1', human, now());
    reply(live, 't1', { id: 't1:m1', by: agent1, at: now(), body: 'Later reply.' });
    applyEdit(live, [{ op: 'replace_text', block: 'p4', old: 'Closing paragraph', new: 'Changed paragraph' }]);
    addThread(live, { threadId: 't9', tabId: TAB, blockId: 'p4', quote: 'Changed', anchor: { start: null, end: null, block: null }, by: human, at: now(), body: 'New thread.' });
    reply(live, 't9', { id: 't9:m1', by: agent2, at: now(), body: 'And a reply.' });
    const old = newDoc();
    applyV2(old, version);
    const scope = adapter.revertScope!(live, old);
    applyV2(live, revertUpdate(version, stateV2(live), scope?.keep ?? null));
    expect(textOf(live, 'p4').startsWith('Closing paragraph')).toBe(true);
    expect(getThread(live, 't1')?.status).toBe('open');
    expect(getThread(live, 't1')?.messages.map((message) => message.body)).toEqual(['About "quick brown"', 'Later reply.']);
    expect(getThread(live, 't9')?.messages.map((message) => message.body)).toEqual(['New thread.', 'And a reply.']);
    expect(getThread(live, 't9')?.status).toBe('open');
  });

  it('a plain revert (no scope) would have removed the conversation: the scope is what keeps it', () => {
    const live = seedDoc();
    const version = stateV2(live);
    reply(live, 't1', { id: 't1:m1', by: agent1, at: now(), body: 'Later reply.' });
    applyV2(live, revertUpdate(version, stateV2(live), null));
    expect(getThread(live, 't1')?.messages).toHaveLength(1);
  });

  it('afterRestore writes every thread’s mirror row and repairs ids', () => {
    const adapter = documentAdapter({ generateID: sequence('z') });
    const doc = seedDoc();
    transact(doc, () => body(doc).insert(0, [pmnodeToDelta(schemaFor().nodeFromJSON({ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'dup' }] }))]));
    const box: { outcome?: ReturnType<NonNullable<KindAdapter['afterRestore']>> } = {};
    transact(doc, () => (box.outcome = adapter.afterRestore!(doc, { versionId: 3 })));
    expect(box.outcome?.threads?.upsert?.map((row) => row.threadId).sort()).toEqual(listThreads(doc).map((thread) => thread.id).sort());
    expect(dupes(ids(doc))).toEqual([]);
  });

  it('summarizes a turn as the batches’ result lines', () => {
    const adapter = documentAdapter();
    expect(adapter.summarizeTurn!([{ results: [{ line: 'replaced ^p1' }, { line: 'deleted ^p2' }] }, { results: [{ line: 'moved ^p3 after ^c1' }] }])).toBe('replaced ^p1\ndeleted ^p2\nmoved ^p3 after ^c1');
    expect(adapter.summarizeTurn!([{ ok: true }, {}])).toBe('2 edits');
  });
});
