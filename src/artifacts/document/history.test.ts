// Version history's pure half (M5 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; P3-0's S3 checks,
// `spikes/p3-store/s3/s3-history.mjs`, headless): a realistic history (the human typing key by key, two agent sessions
// on their own replicas, attribute, table, code-block and format edits), any two versions rendered through the
// DiffRenderer with every expected run credited to its author inside its time window, from provenance alone; "N changes"
// merging touching runs with ↑ ↓ visiting each; comment marks and a new node's attributes not counted; Show editors per
// block from provenance; and the blocks a move or a retype re-inserted, from the carries A's attribution keeps.
import { describe, expect, it } from 'vitest';
import { applyV2, newDoc } from '../yjs';
import { applyEdit } from './patch-writer';
import { attributedRuns, carriedBlocks, changeList, countChanges, diffBody, diffTabs, documentChanges, nextChange, openDiff, prevChange, renderDiff, showEditors, type Run } from './history';
import { AGENT_1, AGENT_2, HUMAN, HistoryHub, TAB, block, body, markFormat, seededHub, textOf, yblock, type Version } from './history.fixture';
import { schemaFor } from './schema';
import { addTab, createDocument, deleteTab, renameTab, tabBody } from './tabs';
import { ynodeToPmnode } from '../yjs/prosemirror';

interface Expectation {
  id: string;
  kind: Run['kind'];
  who: string;
  where: string | null;
  text?: string;
  attr?: string;
  from: number;
  to: number;
}

// S3's history: five phases, a version after each, and the expectation every phase leaves.
function s3History() {
  const hub = seededHub(15);
  const human = hub.connect(HUMAN);
  const a1 = hub.connect(AGENT_1);
  const a2 = hub.connect(AGENT_2);
  const expectations: Expectation[] = [];
  let phaseStart = 0;
  const phase = () => (phaseStart = hub.lastAt + 1);
  const expect_ = (e: Omit<Expectation, 'from' | 'to'>) => expectations.push({ ...e, from: phaseStart, to: hub.lastAt });
  const type = (id: string, text: string) => {
    for (const ch of text) {
      const node = block(human, id);
      node.insert(textOf(node).length, ch);
    }
  };
  const V: Record<string, Version> = {};
  V.V0 = hub.version('V0', HUMAN);

  // phase 1: the human types key by key and starts a new paragraph
  phase();
  type('s0p2', ' Typed by the human.');
  human.transact(() => {
    const top = body(human);
    const at = top.toArray().findIndex((child) => (child as { getAttr?(k: string): unknown }).getAttr?.('id') === 's1p4');
    top.insert(at + 1, [yblock({ type: 'paragraph', attrs: { id: 'hNew' } })]);
  });
  type('hNew', 'A new human paragraph.');
  expect_({ id: 'h-type-s0p2', kind: 'ins', who: HUMAN, where: 'paragraph#s0p2', text: 'Typed by the human.' });
  expect_({ id: 'h-newpara', kind: 'ins', who: HUMAN, where: null, text: 'A new human paragraph.' });
  V.V1 = hub.version('V1', HUMAN);

  // phase 2: agent session 1's turn
  phase();
  a1.transact(() => {
    const node = block(a1, 's2p2');
    const text = textOf(node);
    const i = text.indexOf(' ') + 1;
    const j = text.indexOf(' ', i);
    node.delete(i, j - i);
    node.insert(i, 'REWORDED');
  });
  expect_({ id: 'a1-rewrite-ins', kind: 'ins', who: AGENT_1, where: 'paragraph#s2p2', text: 'REWORDED' });
  expect_({ id: 'a1-rewrite-del', kind: 'del', who: AGENT_1, where: 'paragraph#s2p2' });
  a1.transact(() => {
    const top = body(a1);
    const at = top.toArray().findIndex((child) => (child as { getAttr?(k: string): unknown }).getAttr?.('id') === 's3h');
    top.insert(at + 1, [
      yblock({ type: 'heading', attrs: { level: 3, id: 'aH1' }, content: [{ type: 'text', text: 'Agent section' }] }),
      yblock({ type: 'paragraph', attrs: { id: 'aP1' }, content: [{ type: 'text', text: 'Inserted by agent one after a heading.' }] }),
    ]);
  });
  expect_({ id: 'a1-section', kind: 'ins', who: AGENT_1, where: 'paragraph#aP1', text: 'Inserted by agent one' });
  a1.transact(() => {
    const cell = block(a1, 's4r1c1p');
    cell.delete(0, textOf(cell).length);
    cell.insert(0, '4242');
  });
  expect_({ id: 'a1-cell', kind: 'ins', who: AGENT_1, where: 'paragraph#s4r1c1p', text: '4242' });
  a1.transact(() => {
    const code = block(a1, 's5c');
    code.insert(textOf(code).length, '\nreturn v5 * 2');
  });
  expect_({ id: 'a1-code', kind: 'ins', who: AGENT_1, where: 'codeBlock#s5c', text: 'return v5 * 2' });
  V.V2 = hub.version('V2', AGENT_1);

  // phase 3: the human changes attributes and formats
  phase();
  human.transact(() => block(human, 's6h').setAttr('level', 3));
  expect_({ id: 'h-level', kind: 'attrs', who: HUMAN, where: 'heading#s6h', attr: 'level' });
  human.transact(() => block(human, 's0ti1').setAttr('checked', true));
  expect_({ id: 'h-check', kind: 'attrs', who: HUMAN, where: 'taskItem#s0ti1', attr: 'checked' });
  human.transact(() => block(human, 's7co').setAttr('tone', 'warn'));
  expect_({ id: 'h-tone', kind: 'attrs', who: HUMAN, where: 'callout#s7co', attr: 'tone' });
  human.transact(() => {
    const image = block(human, 's8p3')
      .toArray()
      .find((child) => child instanceof Object && (child as { name?: string }).name === 'image') as { setAttr(k: string, v: unknown): void };
    image.setAttr('alt', 'a better alt');
  });
  expect_({ id: 'h-img-alt', kind: 'attrs', who: HUMAN, where: 'image#?', attr: 'alt' });
  human.transact(() => block(human, 's9p2').format(0, 11, markFormat({ type: 'bold' })));
  expect_({ id: 'h-bold', kind: 'fmt', who: HUMAN, where: 'paragraph#s9p2' });
  V.V3 = hub.version('V3', HUMAN);

  // phase 4: agent session 2's turn: a table row, the code block's language and text, a deleted paragraph, a comment
  phase();
  a2.transact(() => {
    const row = yblock({
      type: 'tableRow',
      attrs: { id: 'nR' },
      content: [0, 1, 2].map((ci) => ({ type: 'tableCell', attrs: { id: `nRc${ci}` }, content: [{ type: 'paragraph', attrs: { id: `nRc${ci}p` }, content: [{ type: 'text', text: `new ${ci}` }] }] })),
    });
    block(a2, 's10t').insert(2, [row]);
  });
  expect_({ id: 'a2-row', kind: 'ins', who: AGENT_2, where: 'paragraph#nRc1p', text: 'new 1' });
  a2.transact(() => {
    const code = block(a2, 's10c');
    code.setAttr('language', 'ts');
    code.delete(0, 5);
    code.insert(0, 'let');
  });
  expect_({ id: 'a2-lang', kind: 'attrs', who: AGENT_2, where: 'codeBlock#s10c', attr: 'language' });
  expect_({ id: 'a2-code-ins', kind: 'ins', who: AGENT_2, where: 'codeBlock#s10c', text: 'let' });
  expect_({ id: 'a2-code-del', kind: 'del', who: AGENT_2, where: 'codeBlock#s10c', text: 'const' });
  a2.transact(() => {
    const top = body(a2);
    top.delete(
      top.toArray().findIndex((child) => (child as { getAttr?(k: string): unknown }).getAttr?.('id') === 's11p4'),
      1,
    );
  });
  expect_({ id: 'a2-delpara', kind: 'del', who: AGENT_2, where: 'paragraph#s11p4' });
  a2.transact(() => block(a2, 's12p2').format(0, 8, markFormat({ type: 'comment', attrs: { threadId: 'th3' } })));
  V.V4 = hub.version('V4', AGENT_2);

  // phase 5: the human types again and deletes a word the seed wrote
  phase();
  type('s13p2', ' More.');
  expect_({ id: 'h-type-s13p2', kind: 'ins', who: HUMAN, where: 'paragraph#s13p2', text: 'More.' });
  block(human, 's0p2').delete(0, 4);
  expect_({ id: 'h-del-s0p2', kind: 'del', who: HUMAN, where: 'paragraph#s0p2' });
  V.V5 = hub.version('V5', HUMAN);

  return { hub, human, V, expectations };
}

// Keystroke typing renders one run per keystroke, each with its own time: adjacent text runs of one kind, author and
// block are joined for matching, keeping the latest time (S3's `joinRuns`).
function joinRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && !run.node && !last.node && last.kind === run.kind && last.who === run.who && last.where === run.where && last.attr === run.attr && last.to === run.from) {
      last.text += run.text;
      last.to = run.to;
      last.at = Math.max(last.at ?? 0, run.at ?? 0);
    } else out.push({ ...run });
  }
  return out;
}

function score(runs: Run[], expectations: Expectation[]) {
  const joined = joinRuns(runs);
  return expectations.map((e) => {
    const hit = joined.find(
      (r) =>
        r.kind === e.kind &&
        r.who === e.who &&
        (e.where === null || r.where === e.where || (e.where.endsWith('#?') && r.where.startsWith(e.where.slice(0, -1)))) &&
        (e.attr ? r.attr === e.attr : e.text ? r.text.includes(e.text) : true),
    );
    const inWindow = hit !== undefined && hit.at !== null && hit.at >= e.from && hit.at <= e.to;
    return { id: e.id, ok: inWindow, got: hit ? `${hit.kind}${hit.attr ? `(${hit.attr})` : ''} by ${hit.who} at ${hit.at}` : 'not rendered' };
  });
}

function render(prev: Version | null, next: Version, attributions: ReturnType<HistoryHub['attributions']>) {
  const diff = openDiff({ prevState: prev?.state ?? null, nextState: next.state, attributions });
  try {
    return renderDiff(tabBody(diff.nextDoc, TAB)!, diff.renderer);
  } finally {
    diff.destroy();
  }
}

describe('S3: any two versions from provenance', () => {
  const { hub, human, V, expectations } = s3History();
  const all = hub.attributions();
  const doc = render(V.V0, V.V5, all);

  it('credits every expected run to its author within its phase (19 of 19)', () => {
    const scored = score(attributedRuns(doc), expectations);
    expect(scored.filter((s) => !s.ok)).toEqual([]);
    expect(scored).toHaveLength(19);
    expect(() => doc.check()).not.toThrow();
  });

  it('renders the same runs from the log window as from all provenance (a compaction keeps the diff)', () => {
    const spans = (map: ReturnType<HistoryHub['attributions']>) => JSON.stringify(attributedRuns(render(V.V0, V.V3, map)));
    expect(spans(hub.attributions(V.V0.seq, V.V3.seq))).toBe(spans(all));
    const v1v3 = (map: ReturnType<HistoryHub['attributions']>) => JSON.stringify(attributedRuns(render(V.V1, V.V3, map)));
    expect(v1v3(hub.attributions(V.V1.seq, V.V3.seq))).toBe(v1v3(all));
  });

  it('credits only the window’s authors between two later versions', () => {
    const who = new Set(attributedRuns(render(V.V2, V.V4, all)).map((run) => run.who));
    expect([...who].sort()).toEqual([HUMAN, AGENT_2].sort());
  });

  it('counts touching runs as one change and steps ↓ and ↑ through every change, wrapping', () => {
    const runs = attributedRuns(doc);
    const changes = changeList(doc);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.length).toBeLessThan(runs.length); // the keystroke runs merge
    expect(changes.reduce((n, change) => n + change.runs, 0)).toBe(runs.length);
    const typed = changes.find((change) => change.where === 'paragraph#s0p2' && change.kinds.includes('ins'))!;
    expect(typed.runs).toBeGreaterThan(10); // " Typed by the human." key by key is one change

    let pos = 0;
    const down: number[] = [];
    for (let i = 0; i <= changes.length; i++) down.push((pos = nextChange(changes, pos)!.from));
    expect(down).toEqual([...changes.map((c) => c.from), changes[0].from]);
    pos = doc.content.size;
    const up: number[] = [];
    for (let i = 0; i < changes.length; i++) up.push((pos = prevChange(changes, pos)!.from));
    expect(up).toEqual(changes.map((c) => c.from).reverse());
  });

  it('does not count a comment mark as a change', () => {
    const runs = attributedRuns(doc);
    expect(runs.filter((run) => run.where === 'paragraph#s12p2')).toEqual([]);
    // the same comment beside a real format change still counts the format
    expect(runs.some((run) => run.kind === 'fmt' && run.where === 'paragraph#s9p2')).toBe(true);
  });

  it('does not count the attributes of a node the diff inserts', () => {
    const runs = attributedRuns(doc);
    expect(runs.filter((run) => run.where === 'heading#aH1').map((run) => run.kind)).toEqual(['ins', 'ins']); // the node and its text
    expect(runs.some((run) => run.kind === 'attrs' && run.where === 'heading#s6h')).toBe(true);
  });

  it('shows the editors of a selection from provenance, newest first, with what each did', () => {
    const live = ynodeToPmnode(body(human), schemaFor());
    const editorsOf = (id: string) => {
      let range: { from: number; to: number } | null = null;
      live.descendants((node, pos) => {
        if (!range && node.attrs.id === id) range = { from: pos, to: pos + node.nodeSize };
        return !range;
      });
      return showEditors({ doc: live, ...range!, liveRoot: body(human), provenance: all });
    };
    const s0p2 = editorsOf('s0p2');
    expect(s0p2.map((e) => e.who)).toEqual([HUMAN]);
    expect(s0p2[0].kinds).toEqual(['ins']); // a deletion at the selection's very edge is not inside it (S3's rule)
    expect(s0p2[0].at).toBeGreaterThan(V.V0.at); // the human's typing of phase 1
    expect(s0p2[0].at).toBeLessThan(V.V1.at);
    const s2p2 = editorsOf('s2p2');
    expect(s2p2.map((e) => e.who)).toEqual([AGENT_1, HUMAN]); // the agent's rewrite after the seed's text
    expect(s2p2[0]).toMatchObject({ kinds: ['del', 'ins'] });
    expect(editorsOf('s6h')[0]).toMatchObject({ who: HUMAN, kinds: ['attrs:level', 'ins'] });
    expect(editorsOf('s10c')[0]).toMatchObject({ who: AGENT_2, kinds: ['attrs:language', 'ins'] });
    expect(editorsOf('s9p2')[0]).toMatchObject({ who: HUMAN, kinds: ['fmt', 'ins'] });
    // an edit older than any later window: the seed's author and time survive in the merged map
    expect(editorsOf('s14p1')).toEqual([{ who: HUMAN, at: hub.log[0].at, kinds: ['fmt', 'ins'] }]); // its bold and italic came with the seed
  });
});

describe('the oldest version', () => {
  it('compares with nothing: everything in it reads as inserted', () => {
    const hub = new HistoryHub();
    hub.write(HUMAN, (doc) => createDocument(doc, { title: 'Main', id: TAB, body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'first' }] }] }) }));
    const only = hub.version('V0', HUMAN);
    const changes = changeList(render(null, only, hub.attributions()));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ who: [HUMAN], kinds: ['ins'] });
  });
});

describe('moved and retyped blocks', () => {
  const seed = {
    type: 'doc',
    content: ['p1', 'p2', 'p3'].map((id, i) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text: `Paragraph ${i + 1} as the human wrote it.` }] })),
  };

  it('names the blocks a carry re-inserted, by kind, and nothing without carries', () => {
    const hub = new HistoryHub();
    hub.write(HUMAN, (doc) => createDocument(doc, { title: 'Main', id: TAB, body: schemaFor().nodeFromJSON(seed) }));
    const before = hub.version('before', HUMAN);
    const agent = hub.connect(AGENT_1);
    const moved = applyEdit(agent, [{ op: 'move', id: 'p1', after: 'p3' }]);
    expect(moved.carries.map((carry) => carry.kind)).toEqual(['move']);
    const uncarried = hub.attributions();
    hub.carryLast(moved.carries);
    const retyped = applyEdit(agent, [{ op: 'replace_block', id: 'p2', markdown: '## Paragraph 2 as the human wrote it. ^p2' }]);
    expect(retyped.carries.map((carry) => carry.kind)).toEqual(['retype']);
    hub.carryLast(retyped.carries);
    const after = hub.version('after', AGENT_1);

    const nextDoc = newDoc();
    applyV2(nextDoc, after.state);
    expect(Object.fromEntries(carriedBlocks(tabBody(nextDoc, TAB)!, hub.attributions()))).toEqual({ p1: 'move', p2: 'retype' });
    expect(carriedBlocks(tabBody(nextDoc, TAB)!, uncarried).size).toBe(0);

    // the moved text keeps the human as its author, so the preview credits the agent with no characters
    const runs = attributedRuns(render(before, after, hub.attributions()));
    expect(runs.filter((run) => run.kind === 'ins' && run.who === AGENT_1 && !run.node && run.text.length > 1)).toEqual([]);
  });
});

// M5 fix wave 1 (the review's finding 1): a tab the later state no longer has is part of the comparison, inspectable
// through the renderer as deleted text, and counted as one change; a rename counts as one too.
describe('tabs between two versions', () => {
  const paragraph = (id: string, text: string) => schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] }] });
  function twoTabs() {
    const hub = new HistoryHub();
    hub.write(HUMAN, (doc) => {
      createDocument(doc, { title: 'Main', id: 'main', body: paragraph('p1', 'Kept') });
      addTab(doc, { title: 'Removed tab', id: 'removed', body: paragraph('p2', 'The agent deletes this whole tab') });
    });
    return { hub, before: hub.version('before', HUMAN), agent: hub.connect(AGENT_1) };
  }

  it('lists a deleted tab, draws its content as deleted by its deleter, and counts the deletion as one change', () => {
    const { hub, before, agent } = twoTabs();
    deleteTab(agent, 'removed');
    const after = hub.version('after', AGENT_1);
    const diff = openDiff({ prevState: before.state, nextState: after.state, attributions: hub.attributions() });
    try {
      expect(diffTabs(diff).map(({ id, title, change }) => ({ id, title, change }))).toEqual([
        { id: 'main', title: 'Main', change: undefined },
        { id: 'removed', title: 'Removed tab', change: 'removed' },
      ]);
      const removed = renderDiff(diffBody(diff, 'removed')!, diff.renderer);
      expect(removed.textContent).toBe('The agent deletes this whole tab');
      expect(attributedRuns(removed).filter((run) => run.kind === 'del' && run.who === AGENT_1).length).toBeGreaterThan(0);
      expect(countChanges(diff)).toBe(1); // the deletion alone: not zero
    } finally {
      diff.destroy();
    }
  });

  it('counts a renamed tab as one change and a new tab by its content', () => {
    const { hub, before, agent } = twoTabs();
    renameTab(agent, 'removed', 'Appendix');
    addTab(agent, { title: 'Notes', id: 'notes', body: paragraph('p3', 'New notes') });
    const after = hub.version('after', AGENT_1);
    const diff = openDiff({ prevState: before.state, nextState: after.state, attributions: hub.attributions() });
    try {
      expect(diffTabs(diff).map(({ id, change, previousTitle }) => ({ id, change, previousTitle }))).toEqual([
        { id: 'main', change: undefined, previousTitle: undefined },
        { id: 'removed', change: 'renamed', previousTitle: 'Removed tab' },
        { id: 'notes', change: 'added', previousTitle: undefined },
      ]);
      expect(countChanges(diff)).toBe(2); // the rename, and the new tab's paragraph
    } finally {
      diff.destroy();
    }
  });
});

// M5 fix wave 1 (the review's finding 2): Show editors names who changed a selected container's attributes.
describe('Show editors on containers', () => {
  const editorsOf = (hub: HistoryHub, id: string) => {
    const doc = ynodeToPmnode(body(hub.host), schemaFor());
    let range: { from: number; to: number } | null = null;
    doc.descendants((node, pos) => {
      if (!range && node.attrs.id === id) range = { from: pos + 1, to: pos + node.nodeSize - 1 };
      return !range;
    });
    return showEditors({ doc, ...range!, liveRoot: body(hub.host), provenance: hub.attributions() });
  };
  const seeded = (json: object) => {
    const hub = new HistoryHub();
    hub.write(HUMAN, (doc) => createDocument(doc, { title: 'Main', id: TAB, body: schemaFor().nodeFromJSON({ type: 'doc', content: [json] }) }));
    return { hub, agent: hub.connect(AGENT_1) };
  };

  it('names the agent who checked the selected task', () => {
    const { hub, agent } = seeded({ type: 'taskList', attrs: { id: 'tasks' }, content: [{ type: 'taskItem', attrs: { id: 'task1', checked: false }, content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Write the report' }] }] }] });
    block(agent, 'task1').setAttr('checked', true);
    const editors = editorsOf(hub, 'p1');
    expect(editors.map((e) => e.who)).toEqual([AGENT_1, HUMAN]);
    expect(editors[0].kinds).toEqual(['attrs:checked']);
  });

  it('names the agent who changed the selected callout’s tone', () => {
    const { hub, agent } = seeded({ type: 'callout', attrs: { id: 'co1', tone: 'note' }, content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Mind the gap' }] }] });
    block(agent, 'co1').setAttr('tone', 'warn');
    const editors = editorsOf(hub, 'p1');
    expect(editors.map((e) => e.who)).toEqual([AGENT_1, HUMAN]);
    expect(editors[0].kinds).toEqual(['attrs:tone']);
  });
});

// M5 fix wave 2 (the re-review's probe): the preview's count and the pill's are one list, tab changes included.
describe('the whole comparison’s changes', () => {
  it('lists a rename-only change as the one change the pill counts', () => {
    const hub = new HistoryHub();
    hub.write(HUMAN, (doc) => createDocument(doc, { id: TAB, title: 'Before', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Unchanged text' }] }] }) }));
    const before = hub.version('before', HUMAN);
    renameTab(hub.connect(AGENT_1), TAB, 'After');
    const after = hub.version('after', AGENT_1);
    const diff = openDiff({ prevState: before.state, nextState: after.state, attributions: hub.attributions() });
    try {
      const changes = documentChanges(diff);
      expect(changes.map(({ tab, entry, body: inBody }) => ({ id: tab.id, title: tab.title, previousTitle: tab.previousTitle, entry, inBody }))).toEqual([{ id: TAB, title: 'After', previousTitle: 'Before', entry: 'renamed', inBody: 0 }]);
      expect(countChanges(diff)).toBe(1);
      expect(changeList(renderDiff(body(diff.nextDoc), diff.renderer))).toHaveLength(0); // the body alone has none
    } finally {
      diff.destroy();
    }
  });
});

