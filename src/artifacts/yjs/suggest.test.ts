// The binding module's accept and reject of suggestions (P3-A M8; Decision Log 45): the copy keeps what a proposal
// carries (a mark, a block attribute, a comment anchor) when blocks are accepted out of the order they were written, no
// doc is left with a gap, and a rejected deletion comes back content-identical.
import * as Y from '@y/y';
import { describe, expect, it } from 'vitest';
import { checkUpdate, hasPending } from './check';
import { insertedBy } from './attribution';
import { clientAbove, planAccept, planReject, SuggestionError, type SuggestionPlan, type SuggestionRange } from './suggest';

const para = (type: string, attrs: Record<string, unknown>, text: string, format?: Record<string, unknown>) => {
  const node = new Y.Node(type);
  for (const [key, value] of Object.entries(attrs)) node.setAttr(key, value);
  if (text) node.insert(0, text, format);
  return node;
};
const byId = (node: Y.Node, id: string) => node.toArray().find((child) => (child as Y.Node).getAttr?.('id') === id) as Y.Node;
const idOf = (item: Y.Item | null): SuggestionRange['start'] => ({ client: item!.id.client, clock: item!.id.clock });
const block = (node: Y.Node): SuggestionRange => ({ start: idOf(node._item), end: idOf(node._item) });

// A main doc, its suggestion doc kept in step, an agent's replica of the suggestion doc, and a second replica of the main
// doc standing for an editor; `land` does what the host does with a plan.
function world({ agentClient }: { agentClient?: number } = {}) {
  const main = new Y.Doc({ gc: true });
  main.transact(() => {
    main.get('default').insert(0, [
      para('heading', { id: 'h1', level: 2 }, 'Draft'),
      para('paragraph', { id: 'p1' }, 'The owner types here.'),
      para('paragraph', { id: 'p2' }, 'Agent will rewrite the middle of this paragraph.'),
      para('paragraph', { id: 'p3' }, 'Closing line.'),
    ]);
    main.get('files').setAttr('a.txt', 'A1');
  });
  const suggestion = new Y.Doc({ gc: false, isSuggestionDoc: true });
  Y.applyUpdate(suggestion, Y.encodeStateAsUpdate(main));
  const editor = new Y.Doc();
  Y.applyUpdate(editor, Y.encodeStateAsUpdate(main));
  main.on('update', (u: Uint8Array) => {
    Y.applyUpdate(suggestion, u);
    Y.applyUpdate(editor, u);
  });
  const agent = new Y.Doc({ gc: false, isSuggestionDoc: true });
  Y.applyUpdate(agent, Y.encodeStateAsUpdate(suggestion));
  if (agentClient !== undefined) agent.clientID = agentClient; // after the load: v14 keeps a clientID no update carries
  const proposals: Uint8Array[] = [];
  agent.on('update', (u: Uint8Array) => {
    proposals.push(u);
    Y.applyUpdate(suggestion, u);
  });
  const attributions = () =>
    Y.mergeContentMaps(proposals.map((u) => Y.createContentMapFromContentIds(Y.createContentIdsFromUpdate(u), [Y.createContentAttribute('insert', 'session:agent')], [Y.createContentAttribute('delete', 'session:agent')])));
  const land = (plan: SuggestionPlan) => {
    let pairs = null;
    if (plan.edit) {
      const replica = new Y.Doc();
      Y.applyUpdateV2(replica, Y.encodeStateAsUpdateV2(main));
      replica.clientID = clientAbove([main, suggestion]);
      let update: Uint8Array | null = null;
      replica.on('update', (u: Uint8Array) => (update = u));
      replica.transact(() => plan.edit!(replica));
      expect(checkUpdate(main, update!)).toBeNull();
      Y.applyUpdate(main, update!);
      pairs = plan.pairs(replica);
    }
    if (plan.remove) {
      expect(checkUpdate(suggestion, plan.remove)).toBeNull();
      Y.applyUpdate(suggestion, plan.remove);
    }
    for (const doc of [main, suggestion, editor]) expect(hasPending(doc)).toBe(false);
    return pairs;
  };
  return { main, suggestion, agent, editor, attributions, land };
}

const json = (doc: Y.Doc) => JSON.stringify({ d: doc.get('default').toDelta({ deep: true } as never), f: doc.get('files').toJSON() });

describe('accepting suggestions by copy (Decision Log 45)', () => {
  it('keeps a mark, a block attribute and a comment anchor through the copy, accepted block by block out of write order, with no gap anywhere', () => {
    const w = world();
    const root = w.agent.get('default');
    w.agent.transact(() => {
      const p2 = byId(root, 'p2');
      p2.delete('Agent will rewrite '.length, 'the middle of'.length); // first in clock order
      p2.insert('Agent will rewrite '.length, 'a part of');
      byId(root, 'h1').setAttr('level', 3); // a block attribute
      const pA = para('paragraph', { id: 'pA', align: 'center' }, '');
      root.insert(3, [pA]);
      pA.insert(0, 'Agent ');
      pA.insert(6, 'proposed', { bold: true }); // a mark
      pA.insert(14, ' paragraph', { comment: { threadId: 't1' } }); // a comment anchor
      w.agent.get('files').setAttr('a.txt', 'A2');
    });
    const target = json(w.suggestion);

    // the inserted block first (the last thing written), then the attribute, then the files entry, then the rewrite
    const pA = byId(w.suggestion.get('default'), 'pA');
    const pairs = w.land(planAccept(w.main, w.suggestion, w.attributions(), [block(pA)]));
    const copied = byId(w.main.get('default'), 'pA');
    expect(copied.getAttr('align')).toBe('center');
    expect(copied.toDelta().toJSON()).toMatchObject({ children: [{ insert: 'Agent ' }, { insert: 'proposed', format: { bold: true } }, { insert: ' paragraph', format: { comment: { threadId: 't1' } } }] });
    expect(copied._item!.id.client).not.toBe(w.agent.clientID); // a copy, under the host's clientID
    expect(pairs!.from.length).toBeGreaterThan(0);
    expect(pairs!.from.every(([client]) => client === w.agent.clientID)).toBe(true);
    expect(byId(w.main.get('default'), 'p2').toString()).toContain('the middle of'); // not accepted yet

    const level = byId(w.suggestion.get('default'), 'h1')._map.get('level')!;
    w.land(planAccept(w.main, w.suggestion, w.attributions(), [{ start: idOf(level), end: idOf(level) }]));
    expect(byId(w.main.get('default'), 'h1').getAttr('level')).toBe(3);
    expect(byId(w.suggestion.get('default'), 'h1').getAttr('level')).toBe(3); // the copy is the key's value there too

    const file = w.suggestion.get('files')._map.get('a.txt')!;
    w.land(planAccept(w.main, w.suggestion, w.attributions(), [{ start: idOf(file), end: idOf(file) }]));
    expect(w.main.get('files').getAttr('a.txt')).toBe('A2');
    expect(w.suggestion.get('files').getAttr('a.txt')).toBe('A2');

    // the rewrite: an editor's range runs from the struck words to the end of the new ones
    const p2 = byId(w.suggestion.get('default'), 'p2');
    let struck: Y.Item | null = p2._start;
    while (struck && !struck.deleted) struck = struck.right as Y.Item | null;
    const lastNew = Y.createRelativePositionFromTypeIndex(p2, 'Agent will rewrite a part of'.length - 1).item!;
    w.land(planAccept(w.main, w.suggestion, w.attributions(), [{ start: idOf(struck), end: lastNew }]));

    expect(json(w.main)).toBe(target);
    expect(json(w.suggestion)).toBe(target);
    expect(json(w.editor)).toBe(target);
    // nothing is left to accept: every proposal was taken
    const rest = planAccept(w.main, w.suggestion, w.attributions(), [block(byId(w.suggestion.get('default'), 'pA'))]);
    expect(rest.edit).toBeNull();
  });

  it('refuses a range that takes the words of an inserted block without the block (S1’s pitfall 7)', () => {
    const w = world();
    const root = w.agent.get('default');
    w.agent.transact(() => root.insert(1, [para('paragraph', { id: 'pB' }, 'New words.')]));
    const pB = byId(w.suggestion.get('default'), 'pB');
    const first = Y.createRelativePositionFromTypeIndex(pB, 0).item!;
    const last = Y.createRelativePositionFromTypeIndex(pB, 9).item!;
    expect(() => planAccept(w.main, w.suggestion, w.attributions(), [{ start: first, end: last }])).toThrow(SuggestionError);
    expect(() => planAccept(w.main, w.suggestion, w.attributions(), [{ start: { client: 1, clock: 0 }, end: { client: 1, clock: 0 } }])).toThrow(/no content/);
  });
});

describe('rejecting suggestions (Decision Log 45)', () => {
  it('takes a proposed insert out of the suggestion doc and brings a proposed deletion back as a content-identical copy, pairing each copy with the deleted original', () => {
    const w = world();
    const root = w.agent.get('default');
    const before = json(w.main);
    w.agent.transact(() => {
      byId(root, 'p3').insert('Closing line.'.length, ' Agent remark.');
    });
    w.agent.transact(() => {
      const p1 = byId(root, 'p1');
      p1.delete(4, 'owner '.length);
    });
    const p3 = byId(w.suggestion.get('default'), 'p3');
    const remark = Y.createRelativePositionFromTypeIndex(p3, 'Closing line.'.length).item!;
    const insert = w.land(planReject(w.main, w.suggestion, w.attributions(), [{ start: remark, end: remark }]));
    expect(insert).toBeNull(); // a rejected insert writes nothing to the main doc
    expect(json(w.main)).toBe(before);

    const p1 = byId(w.suggestion.get('default'), 'p1');
    const deleted = p1._start!.right!; // "owner " was split out of the text and deleted
    expect(deleted.deleted).toBe(true);
    const originalId = { client: deleted.id.client, clock: deleted.id.clock };
    const pairs = w.land(planReject(w.main, w.suggestion, w.attributions(), [{ start: originalId, end: originalId }]));
    expect(json(w.main)).toBe(before); // content-identical
    expect(json(w.suggestion)).toBe(before); // nothing left proposed
    expect(pairs!.from).toContainEqual([originalId.client, originalId.clock]); // the restored text pairs with its original
    expect(pairs!.from).toHaveLength('owner '.length);
  });
});

describe('suggestions: fix wave 1', () => {
  // A proposer clientID above any random one, so a restored value is always the lower concurrent write (finding 1).
  const HIGH = Number.MAX_SAFE_INTEGER - 1_000;

  it('rejecting an attribute replacement leaves the restored value in both docs (a file and a block attribute)', () => {
    for (const which of ['file', 'block'] as const) {
      const w = world({ agentClient: HIGH });
      w.agent.transact(() => {
        if (which === 'file') w.agent.get('files').setAttr('a.txt', 'A2');
        else byId(w.agent.get('default'), 'h1').setAttr('level', 3);
      });
      const item = which === 'file' ? w.suggestion.get('files')._map.get('a.txt')! : byId(w.suggestion.get('default'), 'h1')._map.get('level')!;
      w.land(planReject(w.main, w.suggestion, w.attributions(), [{ start: idOf(item), end: idOf(item) }]));
      const value = (doc: Y.Doc) => (which === 'file' ? doc.get('files').getAttr('a.txt') : byId(doc.get('default'), 'h1').getAttr('level'));
      expect(value(w.main)).toBe(which === 'file' ? 'A1' : 2);
      expect(value(w.suggestion)).toBe(which === 'file' ? 'A1' : 2);
    }
  });

  it('refuses a range whose end is not on its start’s item chain', () => {
    const w = world();
    const root = w.agent.get('default');
    w.agent.transact(() => {
      byId(root, 'p1').insert(0, 'One ');
      byId(root, 'p2').insert(0, 'Two ');
    });
    const start = Y.createRelativePositionFromTypeIndex(byId(w.suggestion.get('default'), 'p1'), 0).item!;
    const end = Y.createRelativePositionFromTypeIndex(byId(w.suggestion.get('default'), 'p2'), 0).item!;
    expect(() => planAccept(w.main, w.suggestion, w.attributions(), [{ start, end }])).toThrow(SuggestionError);
    expect(() => planReject(w.main, w.suggestion, w.attributions(), [{ start: end, end: start }])).toThrow(SuggestionError);
    expect(json(w.main)).not.toContain('One ');
  });

  it('pairs a proposed format change with its copy, so its author can be carried', () => {
    const w = world();
    w.agent.transact(() => byId(w.agent.get('default'), 'p3').format(0, 7, { bold: true })); // "Closing" made bold
    const p3 = byId(w.suggestion.get('default'), 'p3');
    const marker = p3._start!; // the proposal's opening format marker
    const plan = planAccept(w.main, w.suggestion, w.attributions(), [{ start: idOf(marker), end: idOf(marker) }]);
    const pairs = w.land(plan)!;
    expect(byId(w.main.get('default'), 'p3').toDelta().toJSON()).toMatchObject({ children: [{ insert: 'Closing', format: { bold: true } }, { insert: ' line.' }] });
    expect(pairs.complete).toBe(true);
    expect(pairs.from.filter(([client]) => client === w.agent.clientID)).toHaveLength(2); // both markers carried
  });
});

// Fix wave 3: a main doc of paragraphs, its suggestion doc, and proposers each writing under clientIDs of their own;
// the attributions name each write's actor, as the host's provenance does.
function textWorld(paragraphs: Record<string, [string, Record<string, unknown>?][]>) {
  const main = new Y.Doc({ gc: true });
  main.transact(() =>
    main.get('default').insert(
      0,
      Object.entries(paragraphs).map(([id, runs]) => {
        const node = para('paragraph', { id }, '');
        let at = 0;
        for (const [text, format] of runs) {
          node.insert(at, text, format);
          at += text.length;
        }
        return node;
      }),
    ),
  );
  const suggestion = new Y.Doc({ gc: false, isSuggestionDoc: true });
  Y.applyUpdate(suggestion, Y.encodeStateAsUpdate(main));
  main.on('update', (u: Uint8Array) => Y.applyUpdate(suggestion, u));
  const maps: Y.ContentMap[] = [];
  const propose = (actor: string, client: number, edit: (root: Y.Node) => void) => {
    const replica = new Y.Doc({ gc: false, isSuggestionDoc: true });
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(suggestion));
    replica.clientID = client;
    replica.on('update', (u: Uint8Array) => {
      maps.push(Y.createContentMapFromContentIds(Y.createContentIdsFromUpdate(u), [Y.createContentAttribute('insert', actor), Y.createContentAttribute('insertAt', client)], [Y.createContentAttribute('delete', actor), Y.createContentAttribute('deleteAt', client)]));
      Y.applyUpdate(suggestion, u);
    });
    replica.transact(() => edit(replica.get('default')));
    replica.destroy();
  };
  const accept = (ranges: SuggestionRange[]) => {
    const plan = planAccept(main, suggestion, Y.mergeContentMaps(maps), ranges);
    const replica = new Y.Doc();
    Y.applyUpdateV2(replica, Y.encodeStateAsUpdateV2(main));
    replica.clientID = clientAbove([main, suggestion]);
    let update: Uint8Array | null = null;
    replica.on('update', (u: Uint8Array) => (update = u));
    replica.transact(() => plan.edit!(replica));
    expect(checkUpdate(main, update!)).toBeNull();
    Y.applyUpdate(main, update!);
    const pairs = plan.pairs(replica);
    if (plan.remove) Y.applyUpdate(suggestion, plan.remove);
    for (const doc of [main, suggestion]) expect(hasPending(doc)).toBe(false);
    return { pairs: pairs!, attributions: Y.mergeContentMaps(maps), copyClient: replica.clientID };
  };
  const text = (doc: Y.Doc, id: string) => byId(doc.get('default'), id);
  const ends = (node: Y.Node) => {
    let last: Y.Item | null = node._start;
    while (last?.right) last = last.right as Y.Item;
    return { start: idOf(node._start), end: idOf(last) };
  };
  return { main, suggestion, propose, accept, text, ends };
}

describe('suggestions: fix wave 3', () => {
  it('keeps a person’s unchanged formatting inside an accepted range (the copy reads as the suggestion did before the accept)', () => {
    const w = textWorld({ p1: [['a'], ['b', { bold: true }], ['c']] });
    w.propose('session:a', 100, (root) => {
      const p1 = byId(root, 'p1');
      p1.format(0, 1, { bold: true });
      p1.format(2, 1, { bold: true });
    });
    w.propose('session:b', 200, (root) => byId(root, 'p1').insert(3, 'd'));
    const proposed = w.text(w.suggestion, 'p1').toDelta().toJSON(); // captured before the accept: what the owner saw
    expect(proposed).toMatchObject({ children: [{ insert: 'abc', format: { bold: true } }, { insert: 'd' }] });
    w.accept([w.ends(w.text(w.suggestion, 'p1'))]);
    expect(w.text(w.main, 'p1').toDelta().toJSON()).toEqual(proposed);
  });

  it('credits copied formatting to the one actor who proposed it, whichever of its replicas wrote each marker', () => {
    // each bold proposal extends a run the person made, so the copy places its markers differently (the fallback)
    const w = textWorld({ p1: [['a', { bold: true }], ['bc']], p2: [['x', { bold: true }], ['yz']] });
    w.propose('session:a', 100, (root) => byId(root, 'p1').format(1, 1, { bold: true })); // A's host replica
    w.propose('session:a', 150, (root) => byId(root, 'p2').format(1, 1, { bold: true })); // A's agent replica
    w.propose('session:b', 200, (root) => byId(root, 'p1').insert(3, '!'));
    const { pairs, attributions, copyClient } = w.accept([w.ends(w.text(w.suggestion, 'p1')), w.ends(w.text(w.suggestion, 'p2'))]);
    expect(w.text(w.main, 'p1').toDelta().toJSON()).toEqual(w.text(w.suggestion, 'p1').toDelta().toJSON());
    const markerCopies = pairs.to.filter(([client, clock]) => {
      const item = w.main.store.getItem(Y.createID(client, clock));
      return item instanceof Y.Item && item.content instanceof Y.ContentFormat;
    });
    expect(markerCopies.length).toBeGreaterThan(0);
    for (const [i, to] of pairs.to.entries()) {
      if (!markerCopies.includes(to)) continue;
      const [client, clock] = pairs.from[i];
      expect(insertedBy(attributions, { client, clock })?.actor).toBe('session:a');
    }
    // every copied marker is paired: none falls to the copy's binding
    const copied: [number, number][] = [];
    for (const id of ['p1', 'p2']) {
      for (let item: Y.Item | null = w.text(w.main, id)._start; item; item = item.right as Y.Item | null) {
        if (!item.deleted && item.content instanceof Y.ContentFormat && item.id.client === copyClient) copied.push([item.id.client, item.id.clock]);
      }
    }
    for (const marker of copied) expect(markerCopies).toContainEqual(marker);
  });
});
