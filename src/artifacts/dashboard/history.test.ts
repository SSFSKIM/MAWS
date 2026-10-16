// P3-E2 M4 (E's Decision Log 8 and 28 (3); the execution document's M4 proof): a dashboard's dataset changes in B's
// history. Between two states, each dataset added, replaced or removed is a change of every chart block bound to it
// (its view redraws though its attributes are byte-identical), or, bound by none, an entry of its own; credited to the
// change itself from provenance (the replacer, the remover), never to the prior binding's creator. An equal descriptor
// is no change. Counted once with a block whose spec changed too; documents without datasets give none.
import { describe, expect, it } from 'vitest';
import { countChanges, documentChanges, openDiff } from '../document/history';
import { AGENT_1, AGENT_2, HUMAN, HistoryHub, TAB, block } from '../document/history.fixture';
import { schemaFor } from '../document/schema';
import { addTab, createDocument } from '../document/tabs';
import { removeDataset, setDataset, type DatasetDescriptor } from './datasets';
import { datasetChanges } from './history';

const actorOf = (key: string) => (key === HUMAN ? { kind: 'human' as const } : { kind: 'session' as const, appSessionId: key.slice('session:'.length) as never });
const descriptor = (ref: string, by: string, title = 'Sales'): DatasetDescriptor => ({
  title,
  source: { kind: 'file', ref: `assets/${ref}`, name: 'sales.csv', format: 'csv', sha256: [...ref].map((c) => c.charCodeAt(0).toString(16)).join('').padEnd(64, '0'), size: 10 },
  columns: [
    { name: 'region', type: 'string' },
    { name: 'total', type: 'number' },
  ],
  rows: 4,
  updated: { at: 1, by: actorOf(by) },
  state: { status: 'ok', at: 1 },
});
const chart = (id: string, source: string, title: string) => ({ type: 'chart', attrs: { id, source, spec: { view: 'bar', x: 'region', y: 'total', title } } });

function board() {
  const hub = new HistoryHub();
  hub.write(HUMAN, (doc) => {
    createDocument(doc, { title: 'Main', id: TAB, body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Intro' }] }, chart('c1', 'sales', 'Sales by region'), chart('c2', 'sales', 'Sales table')] }) });
    addTab(doc, { title: 'More', id: 'tab2', body: schemaFor().nodeFromJSON({ type: 'doc', content: [chart('c3', 'sales', 'Again'), chart('c4', 'costs', 'Costs')] }) });
    setDataset(doc, 'sales', descriptor('a', HUMAN));
    setDataset(doc, 'spare', descriptor('s', HUMAN, 'Spare'));
  });
  return hub;
}
function compare(hub: HistoryHub, from: { state: Uint8Array; seq: number }, to: { state: Uint8Array; seq: number }) {
  const diff = openDiff({ prevState: from.state, nextState: to.state, attributions: hub.attributions(from.seq, to.seq) });
  return { diff, extras: datasetChanges(diff.prevDoc, diff.nextDoc, hub.attributions(from.seq, to.seq)) };
}

describe('a dashboard’s dataset changes in the history (P3-E2 M4)', () => {
  it('a replacement alone is a change of every block bound to it, by its replacer, though no chart attribute changed', () => {
    const hub = board();
    const before = hub.version('before', HUMAN);
    const agent = hub.connect(AGENT_1);
    setDataset(agent, 'sales', descriptor('b', AGENT_1));
    const after = hub.version('after', AGENT_1);
    const { diff, extras } = compare(hub, before, after);
    try {
      expect(extras.map(({ key, tabId, blockId, who, label }) => ({ key, tabId, blockId, who, label }))).toEqual([
        { key: 'dataset:sales:c1', tabId: TAB, blockId: 'c1', who: AGENT_1, label: 'Dataset “sales” replaced' },
        { key: 'dataset:sales:c2', tabId: TAB, blockId: 'c2', who: AGENT_1, label: 'Dataset “sales” replaced' },
        { key: 'dataset:sales:c3', tabId: 'tab2', blockId: 'c3', who: AGENT_1, label: 'Dataset “sales” replaced' },
      ]);
      expect(extras.every((extra) => extra.at === hub.lastAt)).toBe(true);
      expect(countChanges(diff)).toBe(0); // B alone sees nothing
      expect(countChanges(diff, extras)).toBe(3);
      expect(documentChanges(diff, extras).map((tab) => tab.body)).toEqual([2, 1]);
    } finally {
      diff.destroy();
    }
  });

  it('credits an addition to its adder and a removal to its remover, not the binding’s creator; an unbound dataset is its own entry', () => {
    const hub = board();
    const before = hub.version('before', HUMAN);
    setDataset(hub.connect(AGENT_1), 'costs', descriptor('c', AGENT_1, 'Costs'));
    removeDataset(hub.connect(AGENT_2), 'spare');
    const after = hub.version('after', AGENT_2);
    const { diff, extras } = compare(hub, before, after);
    try {
      expect(extras.map(({ key, tabId, blockId, who, label }) => ({ key, tabId, blockId, who, label }))).toEqual([
        { key: 'dataset:costs:c4', tabId: 'tab2', blockId: 'c4', who: AGENT_1, label: 'Dataset “costs” added' },
        { key: 'dataset:spare', tabId: null, blockId: null, who: AGENT_2, label: 'Dataset “spare” removed' },
      ]);
      expect(countChanges(diff, extras)).toBe(2);
    } finally {
      diff.destroy();
    }
  });

  it('a replacement then a removal in one comparison is credited to the remover', () => {
    const hub = board();
    const before = hub.version('before', HUMAN);
    setDataset(hub.connect(AGENT_1), 'spare', descriptor('t', AGENT_1, 'Spare'));
    removeDataset(hub.connect(AGENT_2), 'spare');
    const after = hub.version('after', AGENT_2);
    const { diff, extras } = compare(hub, before, after);
    try {
      expect(extras.map(({ key, who }) => ({ key, who }))).toEqual([{ key: 'dataset:spare', who: AGENT_2 }]);
    } finally {
      diff.destroy();
    }
  });

  it('an equal descriptor written again is no change; a spec changed with its data is counted once', () => {
    const hub = board();
    const before = hub.version('before', HUMAN);
    const agent = hub.connect(AGENT_1);
    setDataset(agent, 'spare', descriptor('s', HUMAN, 'Spare')); // the same value, a new write
    setDataset(agent, 'sales', descriptor('b', AGENT_1));
    block(agent, 'c1').setAttr('spec', { view: 'line', x: 'region', y: 'total', title: 'Sales by region' });
    const after = hub.version('after', AGENT_1);
    const { diff, extras } = compare(hub, before, after);
    try {
      expect(extras.map((extra) => extra.key)).toEqual(['dataset:sales:c1', 'dataset:sales:c2', 'dataset:sales:c3']);
      expect(countChanges(diff)).toBe(1); // c1's spec
      expect(countChanges(diff, extras)).toBe(3); // c1 once, c2, c3
    } finally {
      diff.destroy();
    }
  });

  it('the oldest version (compared with nothing) adds every dataset; a document gives none', () => {
    const hub = board();
    const first = hub.version('first', HUMAN);
    const diff = openDiff({ prevState: null, nextState: first.state, attributions: hub.attributions() });
    try {
      expect(datasetChanges(diff.prevDoc, diff.nextDoc, hub.attributions()).map((extra) => [extra.key, extra.who, extra.label])).toEqual([
        ['dataset:sales:c1', HUMAN, 'Dataset “sales” added'],
        ['dataset:sales:c2', HUMAN, 'Dataset “sales” added'],
        ['dataset:sales:c3', HUMAN, 'Dataset “sales” added'],
        ['dataset:spare', HUMAN, 'Dataset “spare” added'],
      ]);
    } finally {
      diff.destroy();
    }
    const plain = new HistoryHub();
    plain.write(HUMAN, (doc) => createDocument(doc, { title: 'Main', id: TAB, body: schemaFor().nodeFromJSON({ type: 'doc', content: [chart('c1', 'sales', 'Unbound')] }) }));
    const v = plain.version('v', HUMAN);
    const empty = openDiff({ prevState: null, nextState: v.state, attributions: plain.attributions() });
    try {
      expect(datasetChanges(empty.prevDoc, empty.nextDoc, plain.attributions())).toEqual([]);
    } finally {
      empty.destroy();
    }
  });
});
