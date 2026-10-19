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
import { FILES_ROOT, readFiles } from '../files';
import type { KindAdapter, ThreadChange } from '../host';
import {
  applyV1,
  applyV2,
  attributionMap,
  carriedBy,
  carryAttribution,
  contentIdsOf,
  diffV1,
  idAt,
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
import { documentAdapter, unplacedThreads, type DocumentAdapter } from './adapter';
import { DocIndex } from './block-index';
import { applyEdit } from './patch-writer';
import { readDocument } from './read';
import { schemaFor } from './schema';
import { TABS, addTab, createDocument, deleteTab, listTabs } from './tabs';
import { addThread, anchorOfMark, getThread, listThreads, locate, reply, resolve } from './threads';
import { body, coveredIn, dupes, ids, marksOf, nodeOf, now, order, replica, seedDoc, sequence, textOf, TAB } from './writer.fixture';

const human: Actor = { kind: 'human' };
const agent1 = { kind: 'session', appSessionId: 'session-1' } as Actor;
const agent2 = { kind: 'session', appSessionId: 'session-2' } as Actor;
const MIRROR = Symbol('mirror');
const PULL = Symbol('pull');
const ARTIFACT = 'art-1';
const adapterOf = (options: Parameters<typeof documentAdapter>[0] = {}): DocumentAdapter => documentAdapter(options);

/**
 * A's service in miniature: the live doc, a host replica per actor, the hooks in A's order, provenance per update. One
 * difference from A's service as built, which this child needs of A (X24, raised by M2's review fix wave): the
 * carries `afterUpdate` returns re-credit every row the frame writes, in order (the incoming update's, the forwarding
 * edit's and the hook's own), not only the incoming update's, since text the adapter replays or copies through a host
 * replica lands in those later rows.
 */
class Host {
  readonly live: Doc;
  readonly replicas = new Map<string, Doc>();
  readonly maps: ContentMap[] = [];
  readonly threadChanges: ThreadChange[] = [];
  private readonly writers = new Map<unknown, Actor>();

  constructor(
    seed: Doc,
    readonly adapter: KindAdapter,
    readonly artifactId = ARTIFACT,
  ) {
    this.live = newDoc();
    onUpdate(this.live, (update, origin) => {
      for (const doc of this.replicas.values()) if (doc !== origin) applyV1(doc, update, MIRROR);
      const actor = this.writers.get(origin) ?? human;
      const entry = { update, map: attributionMap(contentIdsOf(update), { insertActor: actorKey(actor), deleteActor: actorKey(actor), at: now() }) };
      if (this.deferring) this.pending.push(entry.map); // the frame's rows wait for afterUpdate's carries
      else this.maps.push(entry.map);
    });
    applyV1(this.live, diffV1(seed)); // the seed, credited to the human
  }

  private pending: ContentMap[] = [];
  private deferring = false;
  private attribute(carries?: AttributionCarry[]): void {
    for (const map of this.pending.splice(0)) {
      const prior = this.maps.length ? mergeMaps(this.maps) : map;
      this.maps.push(carries?.length ? carryAttribution(map, prior, carries) : map);
    }
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
    const forward = this.adapter.beforeApply?.(this.live, update, { artifactId: this.artifactId, actor, step2 }) ?? null;
    let applied: Uint8Array | null = null;
    const off = onUpdate(this.live, (u) => (applied ??= u));
    this.deferring = true;
    applyV1(this.live, update, conn);
    off();
    const doc = this.replicaOf(actor);
    if (forward) transact(doc, () => forward(doc), doc);
    const box: { outcome?: ReturnType<NonNullable<KindAdapter['afterUpdate']>> } = {};
    if (applied) transact(doc, () => (box.outcome = this.adapter.afterUpdate?.(doc, { artifactId: this.artifactId, update: applied!, actor })), doc);
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
  adapter.registerCarries(host.artifactId, applied.carries);
  return { applied, outcome: host.send(doc, actor) };
}
/** The distinct authors the host's provenance credits for a block's characters. */
const authors = (host: Host, id: string): string[] => {
  const node = nodeOf(host.live, id);
  const map = host.provenance();
  return [...new Set([...Array(node.length).keys()].map((k) => insertedBy(map, idAt(node, k)!)?.actor ?? '?'))];
};
const withoutForwarding = (adapter: DocumentAdapter): KindAdapter => ({ ...adapter, kind: 'document', beforeApply: undefined, afterUpdate: adapter.afterUpdate, revertScope: adapter.revertScope });

describe('forwarding (S4 moves A)', () => {
  for (const forwarding of [true, false]) {
    it(forwarding ? 'keystrokes in flight while their block moved land in the moved block' : 'without forwarding the in-flight keystrokes are lost (shown)', () => {
      const adapter = adapterOf();
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

  it('an incremental deletion into the original after the move is replayed into the moved copy', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const person = host.peer();
    agentBatch(host, adapter, agent, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    const at = textOf(person, 'p3').indexOf(' the human');
    transact(person, () => nodeOf(person, 'p3').delete(at, ' the human'.length)); // the person has not seen the move
    host.send(person, human);
    host.pull(person);
    expect(textOf(host.live, 'p3')).toBe('A plain paragraph types into. Words to keep.');
    expect(order(host.live).indexOf('p3')).toBe(order(host.live).indexOf('c1') + 1);
    expect(textOf(person, 'p3')).toBe(textOf(host.live, 'p3'));
  });

  it('text after a surrogate pair typed into the original after the move follows into the moved copy, and so does its deletion', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const person = host.peer();
    agentBatch(host, adapter, agent, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    typeAt(person, 'p3', 'end', '🍕x'); // the person has not seen the move
    host.send(person, human);
    expect(textOf(host.live, 'p3')).toBe('A plain paragraph the human types into. Words to keep.🍕x');
    transact(person, () => nodeOf(person, 'p3').delete(nodeOf(person, 'p3').length - 1, 1));
    host.send(person, human);
    expect(textOf(host.live, 'p3')).toBe('A plain paragraph the human types into. Words to keep.🍕');
  });

  it('replays nothing from a sync step 2: a reconnecting replica that saw the move does not delete the moved text', () => {
    const adapter = adapterOf();
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
    const adapter = adapterOf();
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
    const adapter = adapterOf();
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
    const adapter = adapterOf();
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
      const adapter = adapterOf({ generateID: sequence('r') });
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
    const adapter = adapterOf();
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

  it('a third copy re-id’d beside a moved block: the move’s copy keeps the id, so a later concurrent move still keeps one copy', () => {
    const adapter = adapterOf({ generateID: sequence('r') });
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer(); // stale for the person's drag
    const person = host.peer();
    const index = DocIndex.of(person);
    const p3 = index.pm(index.find('p3')!.top);
    transact(person, () => {
      body(person).insert(0, [pmnodeToDelta(p3)]); // a paste that kept the id
      body(person).delete(order(person).lastIndexOf('p3'), 1); // and a drag of the original after p4, one update
      body(person).insert(order(person).indexOf('p4') + 1, [pmnodeToDelta(p3)]);
    });
    host.send(person, human);
    let after = order(host.live);
    expect(dupes(ids(host.live))).toEqual([]);
    expect(after.indexOf('p3')).toBe(after.indexOf('p4') + 1); // the dragged block kept its id
    expect(after[0]).toMatch(/^r\d+$/); // the paste re-id'd, its text kept
    const moved = applyEdit(agent, [{ op: 'move', id: 'p3', after: 'h1' }]);
    adapter.registerCarries(ARTIFACT, moved.carries);
    host.send(agent, agent1);
    after = order(host.live);
    expect(dupes(ids(host.live))).toEqual([]);
    expect(after.indexOf('p3')).toBe(after.indexOf('h1') + 1); // the later move's copy kept
    expect(after.filter((id) => textOf(host.live, id) === 'A plain paragraph the human types into. Words to keep.')).toHaveLength(2);
  });

  it('concurrent splits that carry one id: the earliest keeps it, the later ones are re-id’d, no text deleted', () => {
    const adapter = adapterOf({ generateID: sequence('r') });
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
    const adapter = adapterOf();
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

  it('text a person typed into the old copy before the move’s update keeps its author once carried into the moved copy', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const person = host.peer();
    const applied = applyEdit(agent, [{ op: 'move', id: 'p3', after: 'c1' }]);
    adapter.registerCarries(ARTIFACT, applied.carries);
    typeAt(person, 'p3', 0, 'Late: '); // reaches the host before the move
    host.send(person, human);
    const { outcome } = { outcome: host.send(agent, agent1) };
    expect(textOf(host.live, 'p3')).toBe('Late: A plain paragraph the human types into. Words to keep.');
    expect(authors(host, 'p3')).toEqual(['human']);
    expect(carriedBy(host.provenance(), idAt(nodeOf(host.live, 'p3'), 0)!)).toBe('move');
    expect(outcome?.provenance?.length).toBeGreaterThan(1); // the writer's carry and the run copied with it
  });

  it('the edits the id repair carries from a losing copy keep their author', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const a1 = host.peer();
    const a2 = host.peer(); // stale: it moves p3 without having seen a1's move
    const person = host.peer();
    agentBatch(host, adapter, a1, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    host.pull(person);
    typeAt(person, 'p3', 0, 'Edited: '); // into a1's copy, which the repair then drops for a2's
    host.send(person, human);
    agentBatch(host, adapter, a2, agent2, [{ op: 'move', id: 'p3', after: 'h1' }]);
    expect(textOf(host.live, 'p3')).toBe('Edited: A plain paragraph the human types into. Words to keep.');
    expect(authors(host, 'p3')).toEqual(['human']);
  });

  it('ids a block that arrives without one, and re-ids a duplicate a replica wrote', () => {
    const adapter = adapterOf({ generateID: sequence('x') });
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
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const peer = host.peer();
    transact(peer, () => nodeOf(peer, 'p4').format(0, 7, { 'comment--stray': { threadId: 'ghost' } }));
    const key = Object.keys([...(nodeOf(host.live, 'p1').toDelta() as unknown as { children: Iterable<{ format?: Record<string, unknown> }> }).children][1].format ?? {})[0];
    transact(peer, () => nodeOf(peer, 'p4').format(8, 9, { [key]: { threadId: 't1' } }));
    host.send(peer, human);
    expect(coveredIn(host.live, 'p4')).toEqual({ t1: 'paragraph' });
  });

  it('refreshes an anchor that drifted (a type change re-creates the commented text)', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const stale = JSON.stringify(getThread(host.live, 't3')?.anchor);
    agentBatch(host, adapter, agent, agent1, [{ op: 'replace_block', id: 'p2', markdown: '## The review is scheduled for Friday and the owner signs off after it.' }]);
    expect(JSON.stringify(getThread(host.live, 't3')?.anchor)).not.toBe(stale);
    expect(JSON.stringify(getThread(host.live, 't3')?.anchor)).toBe(JSON.stringify(anchorOfMark(body(host.live), 't3')));
  });

  it('returns the threads mirror rows of the threads an update changed', () => {
    const adapter = adapterOf();
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
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    agentBatch(host, adapter, agent, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    expect(adapter.stats().carries).toBe(1);
    host.pull(agent);
    agentBatch(host, adapter, agent, agent1, [{ op: 'delete', id: 'p3' }]);
    expect(adapter.stats().carries).toBe(0);
  });

  it('keeps each artifact’s carries apart: two artifacts copied from one version, a move in the second leaves the first’s forwards', () => {
    const adapter = adapterOf();
    const version = seedDoc();
    const first = new Host(version, adapter, 'art-a');
    const second = new Host(version, adapter, 'art-b'); // a duplicate: the same item ids as the first
    const stale = first.peer(); // a person on the first artifact who has not seen its move
    agentBatch(first, adapter, first.peer(), agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    agentBatch(second, adapter, second.peer(), agent2, [{ op: 'move', id: 'p3', after: 'h1' }]);
    typeAt(stale, 'p3', 0, 'A only: ');
    first.send(stale, human);
    expect(textOf(first.live, 'p3')).toBe('A only: A plain paragraph the human types into. Words to keep.');
    expect(textOf(second.live, 'p3')).toBe('A plain paragraph the human types into. Words to keep.');
    adapter.forgetArtifact('art-b');
    typeAt(stale, 'p3', 'end', ' Still.');
    first.send(stale, human);
    expect(textOf(first.live, 'p3')).toBe('A only: A plain paragraph the human types into. Words to keep. Still.');
    expect(dupes(ids(first.live))).toEqual([]);
  });

  it('a human drag (a delete and an insert of one id in one update) counts as a move: a later concurrent move keeps one copy', () => {
    const adapter = adapterOf();
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

  it('a human drag installs forwarding: keystrokes and a deletion in flight into the original land in the dragged copy', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const typist = host.peer(); // has not seen the drag
    const dragger = host.peer();
    const p3 = DocIndex.of(dragger).pm(DocIndex.of(dragger).find('p3')!.top);
    transact(dragger, () => {
      body(dragger).delete(order(dragger).indexOf('p3'), 1);
      body(dragger).insert(order(dragger).indexOf('p4') + 1, [pmnodeToDelta(p3)]);
    });
    host.send(dragger, human);
    typeAt(typist, 'p3', 'end', ' late');
    host.send(typist, human);
    const at = textOf(typist, 'p3').indexOf('plain ');
    transact(typist, () => nodeOf(typist, 'p3').delete(at, 'plain '.length));
    host.send(typist, human);
    expect(textOf(host.live, 'p3')).toBe('A paragraph the human types into. Words to keep. late');
    expect(order(host.live).indexOf('p3')).toBe(order(host.live).indexOf('p4') + 1);
    expect(dupes(ids(host.live))).toEqual([]);
  });
});

// P3-F W-DOC-B (tracker L168): a replica that has not seen a move deletes the old copy whole. The move already took the
// block: that delete is stale and is not forwarded (forwarding it emptied the moved copy); the replica's other edits are.
describe('a stale whole-block delete of a moved block', () => {
  it.each(['p3', 'l1'])('is refused for a block the agent moved (%s): the moved copy keeps everything it holds', (id) => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const person = host.peer(); // has not seen the move
    const before = textOf(host.live, id);
    const inner = ids(host.live).filter((other) => other !== id && DocIndex.of(host.live).find(other)?.top.id === id);
    agentBatch(host, adapter, agent, agent1, [{ op: 'move', id, after: 'c1' }]);
    transact(person, () => body(person).delete(order(person).indexOf(id), 1));
    host.send(person, human);
    host.pull(person);
    host.pull(agent);
    expect(textOf(host.live, id)).toBe(before);
    expect(order(host.live).indexOf(id)).toBe(order(host.live).indexOf('c1') + 1);
    for (const nested of inner) expect(DocIndex.of(host.live).find(nested)?.top.id).toBe(id);
    expect(dupes(ids(host.live))).toEqual([]);
    expect(textOf(person, id)).toBe(before);
    expect(textOf(agent, id)).toBe(before);
  });

  it('is refused for a block a person dragged: another person’s stale delete of the original leaves the dragged copy whole', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const stale = host.peer(); // has not seen the drag
    const dragger = host.peer();
    const before = textOf(host.live, 'p3');
    const p3 = DocIndex.of(dragger).pm(DocIndex.of(dragger).find('p3')!.top);
    transact(dragger, () => {
      body(dragger).delete(order(dragger).indexOf('p3'), 1);
      body(dragger).insert(order(dragger).indexOf('p4') + 1, [pmnodeToDelta(p3)]);
    });
    host.send(dragger, human);
    transact(stale, () => body(stale).delete(order(stale).indexOf('p3'), 1));
    host.send(stale, human);
    host.pull(stale);
    expect(textOf(host.live, 'p3')).toBe(before);
    expect(order(host.live).indexOf('p3')).toBe(order(host.live).indexOf('p4') + 1);
    expect(dupes(ids(host.live))).toEqual([]);
    expect(textOf(stale, 'p3')).toBe(before);
  });

  it('refuses only that delete: the same update’s deletion inside another moved block, its typing and its delete of an unmoved block land', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const person = host.peer(); // has not seen either move
    const p3 = textOf(host.live, 'p3');
    agentBatch(host, adapter, agent, agent1, [
      { op: 'move', id: 'p3', after: 'c1' },
      { op: 'move', id: 'p4', after: 'h1' },
    ]);
    const root = body(person);
    const [p1, p4] = [nodeOf(person, 'p1'), nodeOf(person, 'p4')];
    const words = textOf(person, 'p4').indexOf(' of this section');
    const [at2, at3] = [order(person).indexOf('p2'), order(person).indexOf('p3')];
    transact(person, () => {
      root.delete(at3, 1); // the moved block, whole: stale
      root.delete(at2, 1); // a block nobody moved, whole
      p4.delete(words, ' of this section'.length); // words inside the other moved block
      p1.insert(0, 'Note: ', {}); // typing in a block nobody moved
    });
    host.send(person, human);
    host.pull(person);
    expect(textOf(host.live, 'p3')).toBe(p3);
    expect(textOf(host.live, 'p4')).toBe('Closing paragraph, with enough words to look like prose that a person wrote.');
    expect(textOf(host.live, 'p1').startsWith('Note: The quick')).toBe(true);
    expect(order(host.live)).toEqual(['h1', 'p4', 'p1', 'l1', 'tb1', 'c1', 'p3']);
    expect(dupes(ids(host.live))).toEqual([]);
    expect(textOf(person, 'p4')).toBe(textOf(host.live, 'p4'));
  });
});

describe('restore (revertScope, afterRestore)', () => {
  it('reverts text, marks and a thread’s status, and keeps a thread created after the version and a reply posted after it', () => {
    const adapter = adapterOf();
    const live = seedDoc();
    const version = stateV2(live);
    resolve(live, 't1', human, now());
    reply(live, 't1', { id: 't1:m1', by: agent1, at: now(), body: 'Later reply.' });
    applyEdit(live, [{ op: 'replace_text', block: 'p4', old: 'Closing paragraph', new: 'Changed paragraph' }]);
    addThread(live, { threadId: 't9', tabId: TAB, blockId: 'p4', quote: 'Changed', anchor: { start: null, end: null, block: null }, by: human, at: now(), body: 'New thread.' });
    reply(live, 't9', { id: 't9:m1', by: agent2, at: now(), body: 'And a reply.' });
    const old = newDoc();
    applyV2(old, version);
    const scope = adapter.revertScope!(live, old, { artifactId: ARTIFACT });
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
    const adapter = adapterOf({ generateID: sequence('z') });
    const doc = seedDoc();
    transact(doc, () => body(doc).insert(0, [pmnodeToDelta(schemaFor().nodeFromJSON({ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'dup' }] }))]));
    const box: { outcome?: ReturnType<NonNullable<KindAdapter['afterRestore']>> } = {};
    transact(doc, () => (box.outcome = adapter.afterRestore!(doc, { artifactId: ARTIFACT, versionId: 3 })));
    expect(box.outcome?.threads?.upsert?.map((row) => row.threadId).sort()).toEqual(listThreads(doc).map((thread) => thread.id).sort());
    expect(dupes(ids(doc))).toEqual([]);
  });

  it('summarizes a turn as the batches’ result lines', () => {
    const adapter = adapterOf();
    expect(adapter.summarizeTurn!([{ results: [{ line: 'replaced ^p1' }, { line: 'deleted ^p2' }] }, { results: [{ line: 'moved ^p3 after ^c1' }] }])).toBe('replaced ^p1\ndeleted ^p2\nmoved ^p3 after ^c1');
    expect(adapter.summarizeTurn!([{ ok: true }, {}])).toBe('2 edits');
    expect(adapter.summarizeTurn!([{ status: 'dataset', artifactId: 'a1', id: 'sales', revision: 3 }])).toBe('1 edit'); // a dashboard's one dataset call (sitting candidate 69: "1 edits")
  });

  it('takes a reply’s or a resolve’s own line beside the batches’ lines, in call order', () => {
    const adapter = adapterOf();
    expect(adapter.summarizeTurn!([{ results: [{ line: 'replaced ^p1' }] }, { status: 'replied', line: 'replied on c:t1' }, { status: 'resolved', line: 'resolved c:t1' }])).toBe('replaced ^p1\nreplied on c:t1\nresolved c:t1');
  });
});

// P3-F document-model scalpel-2#1 (P1): a human drag copies the block as the dragging replica saw it. Text that reached
// the live block before the drag, which that replica had not seen, is carried into the dragged copy (the carry pairs the
// units the two hold in common), and an edit still in flight into the original, after either kind of text, follows.
describe('a human drag of a block that concurrent text reached', () => {
  const drag = (doc: Doc, id: string, after: string) => {
    const pm = DocIndex.of(doc).pm(DocIndex.of(doc).find(id)!.top);
    transact(doc, () => {
      body(doc).delete(order(doc).indexOf(id), 1);
      body(doc).insert(order(doc).indexOf(after) + 1, [pmnodeToDelta(pm)]);
    });
  };

  it('carries the text that reached the block before the drag into the dragged copy, and later edits into the original follow it', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer(); // types before the drag, and stays stale for it
    const dragger = host.peer(); // drags without having seen the agent's text
    const other = host.peer(); // sees neither
    typeAt(agent, 'p3', 0, 'BEFORE ');
    host.send(agent, agent1);
    drag(dragger, 'p3', 'c1');
    const dragged = host.send(dragger, human);
    expect(textOf(host.live, 'p3')).toBe('BEFORE A plain paragraph the human types into. Words to keep.');
    expect(dragged?.provenance?.map((carry) => carry.kind)).toEqual(['move', 'move']); // the drag, and the run carried into it
    expect(adapter.stats().carries).toBe(1);
    typeAt(agent, 'p3', 'BEFORE '.length, 'AFTER '); // after its own run, into the original
    host.send(agent, agent1);
    typeAt(other, 'p3', 'end', ' END'); // after the seed's text, into the original
    host.send(other, human);
    for (const doc of [agent, dragger, other]) host.pull(doc);
    const text = 'BEFORE AFTER A plain paragraph the human types into. Words to keep. END';
    expect(textOf(host.live, 'p3')).toBe(text);
    expect(order(host.live).indexOf('p3')).toBe(order(host.live).indexOf('c1') + 1);
    expect(dupes(ids(host.live))).toEqual([]);
    for (const doc of [agent, dragger, other]) expect(textOf(doc, 'p3')).toBe(text);
    expect(new Set(authors(host, 'p3'))).toEqual(new Set(['human', actorKey(agent1)]));
    expect(marksOf(host.live, 'p3')).toBe('BEFORE AFTER A plain paragraph the human types into. |Words[c:t4]| to keep. END');
  });

  it('a drag of a block nothing reached registers one carry', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const dragger = host.peer();
    drag(dragger, 'p3', 'p4');
    const dragged = host.send(dragger, human);
    expect(dragged?.provenance?.map((carry) => carry.kind)).toEqual(['move']);
    expect(adapter.stats().carries).toBe(1);
  });
});

// P3-F document-model sweep#1 (P2): a textblock's forward follows the chain of carries as a character's does, so a
// keystroke into an empty paragraph the agent moved twice lands in the live copy, not the tombstoned first one.
describe('a textblock moved twice', () => {
  it('a keystroke into the original of an empty paragraph moved twice lands in the live copy', () => {
    const adapter = adapterOf();
    const seed = seedDoc();
    transact(seed, () => body(seed).insert(order(seed).indexOf('p1') + 1, [pmnodeToDelta(schemaFor().nodes.paragraph.create({ id: 'e1' }))]));
    const host = new Host(seed, adapter);
    const agent = host.peer();
    const person = host.peer(); // sees neither move
    agentBatch(host, adapter, agent, agent1, [{ op: 'move', id: 'e1', after: 'p2' }]);
    host.pull(agent);
    agentBatch(host, adapter, agent, agent1, [{ op: 'move', id: 'e1', after: 'p3' }]);
    typeAt(person, 'e1', 0, 'Hello');
    host.send(person, human);
    host.pull(person);
    expect(textOf(host.live, 'e1')).toBe('Hello');
    expect(order(host.live).filter((id) => id === 'e1')).toHaveLength(1);
    expect(order(host.live).indexOf('e1')).toBe(order(host.live).indexOf('p3') + 1);
    expect(textOf(person, 'e1')).toBe('Hello');
  });
});

// P3-F document-model sweep#2 (P2): a forwarded insertion whose left neighbour's copy was deleted since the move falls
// back to its right neighbour (then to its textblock) rather than being dropped.
describe('a forwarded insertion whose anchor was deleted', () => {
  it('a keystroke after a character the agent deleted from the moved copy lands before the next one', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const agent = host.peer();
    const person = host.peer(); // has not seen the move
    agentBatch(host, adapter, agent, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    host.pull(agent);
    transact(agent, () => nodeOf(agent, 'p3').delete(0, 1)); // the moved copy's 'A'
    host.send(agent, agent1);
    expect(textOf(host.live, 'p3')).toBe(' plain paragraph the human types into. Words to keep.');
    typeAt(person, 'p3', 1, 'X'); // after the original's 'A'
    host.send(person, human);
    host.pull(person);
    expect(textOf(host.live, 'p3')).toBe('X plain paragraph the human types into. Words to keep.');
    expect(textOf(person, 'p3')).toBe(textOf(host.live, 'p3'));
  });
});

// P3-F document-model scalpel-2#2 (P2): the id repair matches a losing copy's characters to the kept copy's by their
// common origin, following copies of copies, so a block moved twice and then moved once more by a stale replica holds
// its text once, with the edit made in the losing copy carried over.
describe('a stale move of a block moved twice', () => {
  it('keeps the later copy with the text once and the losing copy’s edit carried into it', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const a1 = host.peer();
    const a2 = host.peer(); // stale: it moves the original p3 without having seen either of a1's moves
    const person = host.peer();
    agentBatch(host, adapter, a1, agent1, [{ op: 'move', id: 'p3', after: 'c1' }]);
    host.pull(a1);
    agentBatch(host, adapter, a1, agent1, [{ op: 'move', id: 'p3', after: 'l1' }]);
    host.pull(person);
    typeAt(person, 'p3', 0, 'Edited: '); // into a1's second copy
    host.send(person, human);
    agentBatch(host, adapter, a2, agent2, [{ op: 'move', id: 'p3', after: 'h1' }]);
    host.pull(person);
    expect(order(host.live).filter((id) => id === 'p3')).toHaveLength(1);
    expect(order(host.live).indexOf('p3')).toBe(order(host.live).indexOf('h1') + 1);
    expect(textOf(host.live, 'p3')).toBe('Edited: A plain paragraph the human types into. Words to keep.');
    expect(marksOf(host.live, 'p3')).toBe('Edited: A plain paragraph the human types into. |Words[c:t4]| to keep.');
    expect(dupes(ids(host.live))).toEqual([]);
    expect(textOf(person, 'p3')).toBe(textOf(host.live, 'p3'));
  });
});

// P3-F document-model sweep#5 (P3): two replicas each deleting one of a document's last two tabs both pass the writer's
// guard; the host's repair gives the merged document one empty tab again, so it stays readable.
describe('concurrent deletions of the last two tabs', () => {
  it('leave one readable tab', () => {
    const adapter = adapterOf({ generateID: sequence('t') });
    const seed = seedDoc();
    addTab(seed, { title: 'Second', id: 'tab2' });
    const host = new Host(seed, adapter);
    const a = host.peer();
    const b = host.peer();
    deleteTab(a, TAB);
    deleteTab(b, 'tab2');
    host.send(a, human);
    host.send(b, human);
    expect(listTabs(host.live).map((tab) => tab.id)).toEqual([expect.stringMatching(/^t\d+$/)]);
    expect(readDocument(host.live).shown).toEqual([expect.stringMatching(/^t\d+$/)]);
    host.pull(a);
    host.pull(b);
    expect(listTabs(a)).toEqual(listTabs(host.live));
    expect(listTabs(b)).toEqual(listTabs(host.live));
  });
});

// P3-F document-model scalpel-3#2 (P3): a thread marked in a deleted top-level block and in a surviving one is refreshed
// by the update that deleted the block, so it locates to its surviving text rather than to the gap the block left.
describe('a thread marked in a deleted block', () => {
  it('locates to its surviving text once the block holding its anchor is deleted', () => {
    const adapter = adapterOf();
    const seed = seedDoc();
    const key = 'comment--t9mark00';
    transact(seed, () => {
      nodeOf(seed, 'p1').format(0, 3, { [key]: { threadId: 't9' } });
      nodeOf(seed, 'p2').format(0, 3, { [key]: { threadId: 't9' } });
    });
    addThread(seed, { threadId: 't9', tabId: TAB, blockId: 'p1', quote: 'The', anchor: anchorOfMark(body(seed), 't9')!, by: human, at: now(), body: 'Both.' });
    const host = new Host(seed, adapter);
    const person = host.peer();
    transact(person, () => body(person).delete(order(person).indexOf('p1'), 1));
    host.send(person, human);
    const thread = getThread(host.live, 't9')!;
    expect(locate(host.live, thread)).toEqual(expect.objectContaining({ how: 'text', blockId: 'p2', index: 0 }));
    expect(thread.blockId).toBe('p2');
  });
});

// P3-F document-model review (fable, P1): the tab restore keeps a held legacy dashboard held. A restore to the files an
// older build wrote deletes the tab a later write created; the merged document then has files and no tab, which is the
// hold's marker (src/artifacts/dashboard/legacy.ts), so no tab is restored there, nor by a resync restating the deletion.
describe('the tab restore and a held legacy dashboard', () => {
  const legacy = () => {
    const seed = newDoc();
    transact(seed, () => seed.get(FILES_ROOT).setAttr('index.html', '<p>old</p>'));
    createDocument(seed, { title: 'Board', id: TAB }); // a document of today written over the files, which a restore takes back
    return seed;
  };
  const revert = (doc: Doc) => transact(doc, () => doc.get(TABS).deleteAttr(TAB)); // the restore's revert, not the writer's guarded delete

  it('a deletion of the tab over nonempty files (a restore to them) leaves the document held, with no tab', () => {
    const adapter = adapterOf();
    const host = new Host(legacy(), adapter);
    const restorer = host.peer();
    revert(restorer);
    host.send(restorer, human);
    expect(listTabs(host.live)).toEqual([]);
    expect(Object.keys(readFiles(host.live))).toEqual(['index.html']);
  });

  it('a resync restating that deletion restores none either', () => {
    const adapter = adapterOf();
    const host = new Host(legacy(), adapter);
    const restorer = host.peer();
    revert(restorer);
    host.send(restorer, human);
    const peer = host.peer(); // saw the deletion; reconnects with a step 2 that restates it beside its own change
    transact(peer, () => peer.get(FILES_ROOT).setAttr('notes.txt', 'x'));
    host.receive(diffV1(peer, stateVector(host.live)), human, { step2: true });
    expect(listTabs(host.live)).toEqual([]);
    expect(Object.keys(readFiles(host.live)).sort()).toEqual(['index.html', 'notes.txt']);
  });
});

// P3-F document-model review (fable, P3): text replayed into a losing copy (a run that reached the block before a drag)
// is matched to the kept copy by its origin, so a winner whose base already holds that run does not get it again.
describe('the id repair and a losing copy’s replayed text', () => {
  it('does not insert a run the winner was made with again', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const other = host.peer();
    const dragger = host.peer(); // drags without having seen the run
    const agent = host.peer(); // sees the run, not the drag
    typeAt(other, 'p3', 0, 'BEFORE ');
    host.send(other, human);
    host.pull(agent);
    const pm = DocIndex.of(dragger).pm(DocIndex.of(dragger).find('p3')!.top);
    transact(dragger, () => {
      body(dragger).delete(order(dragger).indexOf('p3'), 1);
      body(dragger).insert(order(dragger).indexOf('c1') + 1, [pmnodeToDelta(pm)]);
    });
    host.send(dragger, human);
    expect(textOf(host.live, 'p3')).toBe('BEFORE A plain paragraph the human types into. Words to keep.');
    const moved = applyEdit(agent, [{ op: 'move', id: 'p3', after: 'h1' }]); // the original, the run in it
    adapter.registerCarries(ARTIFACT, moved.carries);
    host.send(agent, agent1);
    expect(order(host.live).filter((id) => id === 'p3')).toHaveLength(1);
    expect(order(host.live).indexOf('p3')).toBe(order(host.live).indexOf('h1') + 1);
    expect(textOf(host.live, 'p3')).toBe('BEFORE A plain paragraph the human types into. Words to keep.');
    expect(dupes(ids(host.live))).toEqual([]);
  });
});

// P3-F document-model review (fable, P3): a block thread carries no mark and nothing in the refresh can move it, so one
// whose block is gone is left out of the refresh scope (in it, every deletion update walked every node of every tab);
// a text thread whose recorded block is gone is in it, for the mark it may still have elsewhere.
describe('unplacedThreads', () => {
  it('names text threads whose recorded block is gone, never block threads', () => {
    const doc = seedDoc();
    transact(doc, () => nodeOf(doc, 'p1').format(0, 3, { 'comment--t9mark00': { threadId: 't9' } }));
    addThread(doc, { threadId: 't9', tabId: TAB, blockId: 'p1', quote: 'The', anchor: anchorOfMark(body(doc), 't9')!, by: human, at: now(), body: 'Text.' });
    addThread(doc, { threadId: 'tb', tabId: TAB, blockId: 'c1', quote: 'const x = 1', anchor: { kind: 'block' }, by: human, at: now(), body: 'Block.' });
    expect(unplacedThreads(doc)).toEqual([]);
    transact(doc, () => {
      body(doc).delete(order(doc).indexOf('c1'), 1);
      body(doc).delete(order(doc).indexOf('p1'), 1);
    });
    expect(unplacedThreads(doc)).toEqual(['t9']);
  });
});

// P3-F document-model recheck (fable, P2): a drag delivered in a sync step 2 (an unacked drag the provider re-sends after
// a reconnect) keeps its carry on a block with edit history. A step 2 restates the sender's whole delete set, so its
// tombstones cannot be told from the dragger's own: the view is paired from the live units alone there, as before.
describe('a human drag delivered in a sync step 2', () => {
  const drag = (doc: Doc, id: string, after: string) => {
    const pm = DocIndex.of(doc).pm(DocIndex.of(doc).find(id)!.top);
    transact(doc, () => {
      body(doc).delete(order(doc).indexOf(id), 1);
      body(doc).insert(order(doc).indexOf(after) + 1, [pmnodeToDelta(pm)]);
    });
  };

  it('keeps its carry on a block with earlier deletions: concurrent text and a later stale edit land in the dragged copy', () => {
    const adapter = adapterOf();
    const host = new Host(seedDoc(), adapter);
    const editor = host.peer();
    const at = textOf(editor, 'p3').indexOf(' the human');
    transact(editor, () => nodeOf(editor, 'p3').delete(at, ' the human'.length)); // edit history: tombstones in the block
    host.send(editor, human);
    const dragger = host.peer(); // synced after that deletion; drags while disconnected
    const typist = host.peer(); // stale for the drag
    const agent = host.peer();
    typeAt(agent, 'p3', 0, 'BEFORE '); // reaches the host while the dragger is away
    host.send(agent, agent1);
    drag(dragger, 'p3', 'c1');
    host.receive(diffV1(dragger, stateVector(host.live)), human, { step2: true }); // the reconnect's step 2 carries the drag
    expect(textOf(host.live, 'p3')).toBe('BEFORE A plain paragraph types into. Words to keep.');
    expect(adapter.stats().carries).toBe(1);
    typeAt(typist, 'p3', 'end', ' END');
    host.send(typist, human);
    for (const doc of [dragger, typist, agent]) host.pull(doc);
    const text = 'BEFORE A plain paragraph types into. Words to keep. END';
    expect(textOf(host.live, 'p3')).toBe(text);
    expect(order(host.live).indexOf('p3')).toBe(order(host.live).indexOf('c1') + 1);
    expect(dupes(ids(host.live))).toEqual([]);
    for (const doc of [dragger, typist, agent]) expect(textOf(doc, 'p3')).toBe(text);
  });
});
