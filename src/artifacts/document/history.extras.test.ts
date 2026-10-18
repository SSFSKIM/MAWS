// P3-E (E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md; E's Decision Log 8 and 28 (3), (4)): changes B's
// text diff cannot see, given by the artifact's kind (a dashboard's dataset replaced under byte-identical chart
// attributes), merged into the one change list: a bound extra is a change of its block, in document order, counted once
// where the body already changed that block; an unbound extra (no tab, no block) is an entry of its own; without extras
// every count and list is B's.
import { describe, expect, it } from 'vitest';
import { changeList, countChanges, documentChanges, mergeExtraChanges, openDiff, renderDiff, type ExtraChange } from './history';
import { AGENT_1, HUMAN, HistoryHub, TAB, block, body } from './history.fixture';
import { schemaFor } from './schema';
import { createDocument } from './tabs';

const chart = (id: string, title: string) => ({ type: 'chart', attrs: { id, source: 'sales', spec: { view: 'bar', x: 'region', y: 'total', title } } });
const paragraph = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });

function hub() {
  const h = new HistoryHub();
  h.write(HUMAN, (doc) => createDocument(doc, { title: 'Main', id: TAB, body: schemaFor().nodeFromJSON({ type: 'doc', content: [paragraph('p1', 'Intro'), chart('c1', 'Sales'), chart('c2', 'Costs'), paragraph('p2', 'End')] }) }));
  const before = h.version('before', HUMAN);
  const agent = h.connect(AGENT_1);
  return { h, before, agent };
}
const extra = (over: Partial<ExtraChange> & Pick<ExtraChange, 'key'>): ExtraChange => ({ label: `Dataset ${over.key}`, tabId: TAB, blockId: null, who: AGENT_1, at: 1, ...over });

describe('extra changes in B’s change list (P3-E)', () => {
  it('a bound extra on an unchanged block is one change at the block, in document order, with its author and time', () => {
    const { h, before, agent } = hub();
    block(agent, 'p2').insert(3, '!');
    const after = h.version('after', AGENT_1);
    const diff = openDiff({ prevState: before.state, nextState: after.state, attributions: h.attributions() });
    try {
      const pm = renderDiff(body(diff.nextDoc), diff.renderer);
      const plain = changeList(pm);
      expect(plain).toHaveLength(1);
      const merged = mergeExtraChanges(pm, plain, [extra({ key: 'dataset:sales:c1', blockId: 'c1', at: 42 })]);
      expect(merged.map((c) => c.where)).toEqual(['chart#c1', 'paragraph#p2']);
      expect(merged[0]).toMatchObject({ who: [AGENT_1], at: 42, kinds: ['attrs'], runs: 0 });
      expect(pm.nodeAt(merged[0]!.from)?.attrs.id).toBe('c1');
      expect(merged[0]!.to - merged[0]!.from).toBe(pm.nodeAt(merged[0]!.from)!.nodeSize);

      const extras = [extra({ key: 'dataset:sales:c1', blockId: 'c1' }), extra({ key: 'dataset:sales:c2', blockId: 'c2' })];
      expect(documentChanges(diff, extras).map((tab) => tab.body)).toEqual([3]);
      expect(countChanges(diff, extras)).toBe(3);
      expect(countChanges(diff)).toBe(1);
      expect(documentChanges(diff)).toEqual(documentChanges(diff, []));
    } finally {
      diff.destroy();
    }
  });

  it('a block the body changed too is counted once; two extras on one block are one change', () => {
    const { h, before, agent } = hub();
    block(agent, 'c1').setAttr('spec', { view: 'line', x: 'region', y: 'total', title: 'Sales' });
    const after = h.version('after', AGENT_1);
    const diff = openDiff({ prevState: before.state, nextState: after.state, attributions: h.attributions() });
    try {
      expect(countChanges(diff)).toBe(1);
      const extras = [extra({ key: 'dataset:sales:c1', blockId: 'c1' }), extra({ key: 'dataset:other:c1', blockId: 'c1' })];
      expect(countChanges(diff, extras)).toBe(1);
      const pm = renderDiff(body(diff.nextDoc), diff.renderer);
      expect(mergeExtraChanges(pm, changeList(pm), extras)).toEqual(changeList(pm));
    } finally {
      diff.destroy();
    }
  });

  it('an unbound extra is an entry of its own; an extra naming a block the tab does not hold adds nothing to it', () => {
    const { h, before } = hub();
    const after = h.version('after', HUMAN);
    const diff = openDiff({ prevState: before.state, nextState: after.state, attributions: h.attributions() });
    try {
      expect(countChanges(diff)).toBe(0);
      const extras = [extra({ key: 'dataset:orphaned', tabId: null }), extra({ key: 'dataset:sales:gone', blockId: 'gone' })];
      expect(documentChanges(diff, extras).map((tab) => tab.body)).toEqual([0]);
      expect(countChanges(diff, extras)).toBe(1);
    } finally {
      diff.destroy();
    }
  });
});
