// The provisional layer in DocumentEditor (P4-A2, X35; M5 of docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md;
// docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2's four rules; happy-dom over the in-memory host, whose
// `announce` sends the host's provisional frames on every real port): each op drawn at its target in the agent's colour
// and name; a committed batch's layer kept until the replica has integrated the write, then swapped for the real text
// in the same task, under a composition hold only once the hold releases; a dropped batch withdrawn at once; nothing
// drawn inside the block the person composes in until the composition ends; no Y write, no unsaved change; the
// layer's growth told to the page frame; the person's typing mapping the layer rather than redrawing it.
import type { Editor, JSONContent } from '@tiptap/core';
import { cleanup, render } from '@testing-library/react';
import type { ArtifactProvisional, ProvisionalOp } from '@shared/artifacts/provisional';
import { afterEach, describe, expect, it } from 'vitest';
import { setDataset } from '../../dashboard/datasets';
import { ProvisionalLayers } from '../../provisional';
import { stateVector } from '../../yjs';
import { applyEdit } from '../patch-writer';
import type { CommentOverlayProps } from './comments/surface';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle } from './host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import { Provisional, provisionalKey } from './provisional';
import { pmnodeToDelta } from '../../yjs/prosemirror';
import { YNode } from '../../yjs/document';
import { schemaFor } from '../schema';
import { tabBody } from '../tabs';
import { TAB, World, blocks, doc, endOf, para, ticks, until } from './test-world';

let world: World | null = null;
let handles: DocumentHandle[] = [];
let stops: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const stop of stops) stop();
  stops = [];
  for (const handle of handles) handle.close();
  handles = [];
  world?.destroy();
  world = null;
});

const AGENT = { kind: 'session', appSessionId: 'agent' } as never;
const table = (id: string, text: string): JSONContent => ({
  type: 'table',
  attrs: { id },
  content: [{ type: 'tableRow', attrs: { id: `${id}r` }, content: [{ type: 'tableCell', attrs: { id: `${id}c` }, content: [para(`${id}p`, text)] }] }],
});
const content = () => doc(para('p1', 'The kickoff is on Monday.'), para('p2', 'The budget review is on Friday.'), para('p3', 'Risks are listed below.'), table('tb', 'A cell.'), para('p4', 'The end.'));

let at = 0;
const frame = (toolUseId: string, state: ArtifactProvisional['state'], ops: ProvisionalOp[], commitSeq?: number): ArtifactProvisional => ({
  toolUseId: toolUseId as never,
  appSessionId: 's1' as never,
  artifactId: 'doc1',
  kind: 'document',
  state,
  ...(commitSeq !== undefined ? { commitSeq } : {}),
  at: (at += 1),
  name: 'Fix the build',
  color: '--author-3',
  ops,
});

// P4-B1: `commentsView` 'hide' keeps the margin off, so the comment overlay is drawn over the frame
async function mount(comments?: { overlay(props: CommentOverlayProps): null }, commentsView?: 'expand' | 'hide', initial: JSONContent = content()) {
  world = new World(initial);
  const handle = openMemoryHandle(world.host, { log: () => {} });
  handles.push(handle);
  await whenSynced(handle);
  let editor: Editor | null = null;
  const view = render(
    <DocumentEditor
      artifactId="doc1"
      handle={handle}
      host={memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' })}
      onEditor={(e) => (editor = e)}
      {...(comments ? { comments: { opened: () => {}, overlay: comments.overlay } } : {})}
      {...(commentsView ? { commentsView } : {})}
    />,
  );
  await until(() => editor !== null && editor.getText().length > 0, 'the editor to bind');
  await ticks();
  return { handle, container: view.container, editor: () => editor! };
}

const drawn = (root: ParentNode, toolUseId?: string) => [...root.querySelectorAll<HTMLElement>('[data-provisional]')].filter((el) => toolUseId === undefined || el.dataset.provisional === toolUseId);
const blockEl = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
const inBlock = (el: HTMLElement) => el.parentElement?.closest('[data-id]')?.getAttribute('data-id') ?? '';
// a block's own text as drawn, the layer's widgets left out
const ownText = (root: ParentNode, id: string) => {
  const clone = blockEl(root, id).cloneNode(true) as HTMLElement;
  for (const extra of clone.querySelectorAll('[data-provisional]')) extra.remove();
  return clone.textContent;
};
const ORIGINAL: Array<[string | null, string]> = [
  ['p1', 'The kickoff is on Monday.'],
  ['p2', 'The budget review is on Friday.'],
  ['p3', 'Risks are listed below.'],
  ['tb', 'A cell.'],
  ['p4', 'The end.'],
];

describe('the provisional layer', () => {
  it('draws a streaming call’s text at its target in the agent’s colour and name, each frame replacing the last', async () => {
    const { container, editor } = await mount();
    world!.host.announce(frame('tu1', 'streaming', [{ op: 'replace_text', block: 'p2', old: 'on Friday', text: 'on Thu' }]));
    await until(() => drawn(container).length === 1, 'the layer');
    const [first] = drawn(container);
    expect(first.textContent).toBe('on Thu');
    expect(inBlock(first)).toBe('p2');
    expect(first.dataset.provisionalOp).toBe('replace_text');
    expect(first.dataset.provisionalBy, 'the label, as presence names the agent').toBe('Fix the build');
    expect(first.style.getPropertyValue('--doc-presence')).toBe('var(--author-3)');
    expect(first.getAttribute('contenteditable')).toBe('false');
    expect(first.hasAttribute('tabindex')).toBe(false);

    world!.host.announce(frame('tu1', 'streaming', [{ op: 'replace_text', block: 'p2', old: 'on Friday', text: 'on Thursday' }]));
    await until(() => drawn(container)[0]?.textContent === 'on Thursday', 'the next frame');
    expect(drawn(container)).toHaveLength(1);
    expect(blocks(editor()), 'the document as it was').toEqual(ORIGINAL);
  });

  it('draws each op where it lands: a quote dimmed with the text after it, an insert at its anchor, a block replaced, a cell after its table', async () => {
    const { container } = await mount();
    world!.host.announce(
      frame('tu1', 'streaming', [
        { op: 'replace_text', block: 'p2', old: 'on Friday', text: 'on Thursday' },
        { op: 'insert', after: 'p3', text: '- A new risk' },
        { op: 'insert', before: 'p1', text: '# Minutes' },
        { op: 'replace_block', block: 'p4', text: 'The close.' },
        { op: 'set_cell', table: 'tb', row: 0, col: 0, text: 'Another cell.' },
        { op: 'replace_text', block: null, old: 'nowhere', text: 'unplaced' },
        { op: 'delete', block: 'p1' },
      ]),
    );
    await until(() => drawn(container).length === 5, 'every placed op');

    const old = blockEl(container, 'p2').querySelector<HTMLElement>('.doc-provisional-old')!;
    expect(old.textContent).toBe('on Friday');
    expect(old.style.getPropertyValue('--doc-presence')).toBe('var(--author-3)');
    expect(blockEl(container, 'p2').textContent, 'the text drawn after the quote, before the rest').toBe('The budget review is on Fridayon Thursday.');

    const [insertAfter] = drawn(container).filter((el) => el.textContent === '- A new risk');
    expect([insertAfter.dataset.provisionalOp, inBlock(insertAfter), insertAfter.classList.contains('doc-provisional-block')]).toEqual(['insert', '', true]);
    expect((insertAfter.previousElementSibling as HTMLElement).dataset.id).toBe('p3');
    const [insertBefore] = drawn(container).filter((el) => el.textContent === '# Minutes');
    expect((insertBefore.nextElementSibling as HTMLElement).dataset.id).toBe('p1');

    expect(blockEl(container, 'p4').classList.contains('doc-provisional-replaced')).toBe(true);
    const [replaced] = drawn(container).filter((el) => el.dataset.provisionalOp === 'replace_block');
    expect([replaced.textContent, (replaced.previousElementSibling as HTMLElement).dataset.id]).toEqual(['The close.', 'p4']);

    const [cell] = drawn(container).filter((el) => el.dataset.provisionalOp === 'set_cell');
    expect(cell.textContent).toBe('Another cell.');
    const beforeCell = cell.previousElementSibling as HTMLElement;
    expect(beforeCell.matches('[data-id="tb"]') || beforeCell.querySelector('[data-id="tb"]') !== null, 'after the table').toBe(true);

    expect(container.textContent, 'an unresolved quote draws nothing').not.toContain('unplaced');
    for (const el of drawn(container)) expect(el.dataset.provisionalBy).toBe('Fix the build');
  });

  it('draws a quote it cannot find in the block’s text as a block after the block', async () => {
    const { container } = await mount();
    world!.host.announce(frame('tu1', 'streaming', [{ op: 'replace_text', block: 'p2', old: '**on Friday**', text: 'on Thursday' }]));
    await until(() => drawn(container).length === 1, 'the layer');
    const [el] = drawn(container);
    expect([el.classList.contains('doc-provisional-block'), inBlock(el), (el.previousElementSibling as HTMLElement).dataset.id]).toEqual([true, '', 'p2']);
  });

  it('keeps a committed layer until its write is integrated, then swaps it for the real text in the same task', async () => {
    const { container, editor } = await mount();
    const ops: ProvisionalOp[] = [{ op: 'replace_text', block: 'p2', old: 'on Friday', text: 'on Thursday' }];
    world!.host.announce(frame('tu1', 'streaming', ops));
    await until(() => drawn(container).length === 1, 'the layer');
    world!.host.announce(frame('tu1', 'committed', ops, world!.host.nextRevision)); // ahead of the write's frames, as the service sends it
    await ticks();
    expect(drawn(container), 'the layer waits for its write').toHaveLength(1);

    const real = () => ownText(container, 'p2') === 'The budget review is on Thursday.';
    const samples: Array<{ real: boolean; layer: boolean }> = [];
    let swappedInTask: boolean | null = null;
    const sample = () => {
      samples.push({ real: real(), layer: drawn(container).length > 0 });
      if (swappedInTask === null && real()) queueMicrotask(() => (swappedInTask = drawn(container).length === 0));
    };
    editor().on('transaction', sample);
    world!.host.write((d) => void applyEdit(d, [{ op: 'replace_text', block: 'p2', old: 'on Friday', new: 'on Thursday' }]), AGENT);
    await until(() => real() && drawn(container).length === 0, 'the swap');
    editor().off('transaction', sample);
    expect(swappedInTask, 'the layer went in the task that drew the write').toBe(true);
    expect(samples.filter((s) => !s.real && !s.layer), 'no moment showing neither').toEqual([]);
  });

  it('under a composition hold, keeps a committed layer past its write until the hold releases, then swaps at once', async () => {
    const { handle, container } = await mount();
    const ops: ProvisionalOp[] = [{ op: 'replace_text', block: 'p1', old: 'on Monday', text: 'on Tuesday' }];
    handle.holdRemote(true);
    world!.host.announce(frame('tu1', 'streaming', ops));
    await until(() => drawn(container).length === 1, 'the layer, through the hold');
    world!.host.announce(frame('tu1', 'committed', ops, world!.host.nextRevision));
    world!.host.write((d) => void applyEdit(d, [{ op: 'replace_text', block: 'p1', old: 'on Monday', new: 'on Tuesday' }]), AGENT);
    await ticks(20);
    expect(drawn(container), 'the layer stays while the write is held').toHaveLength(1);
    expect(ownText(container, 'p1')).toBe('The kickoff is on Monday.');

    handle.holdRemote(false);
    expect([ownText(container, 'p1'), drawn(container).length], 'swapped as the hold releases').toEqual(['The kickoff is on Tuesday.', 0]);
  });

  it('withdraws a dropped batch at once, under a composition hold too, leaving the document as it was', async () => {
    const { handle, container, editor } = await mount();
    handle.holdRemote(true);
    world!.host.announce(frame('tu1', 'streaming', [{ op: 'replace_block', block: 'p2', text: 'Refused.' }]));
    await until(() => drawn(container).length === 1, 'the layer');
    world!.host.announce(frame('tu1', 'dropped', []));
    await until(() => drawn(container).length === 0 && container.querySelector('.doc-provisional-replaced') === null, 'the withdrawal');
    handle.holdRemote(false);
    expect(blocks(editor())).toEqual(ORIGINAL);
  });

  it('draws nothing inside the block the person composes in until the composition ends, and elsewhere meanwhile', async () => {
    const { container, editor } = await mount();
    world!.host.announce(frame('tu1', 'streaming', [{ op: 'replace_text', block: 'p2', old: 'on Friday', text: 'on Thu' }]));
    await until(() => drawn(container, 'tu1').length === 1, 'the layer in p2');
    editor().commands.setTextSelection(endOf(editor(), 'p2'));
    const selection = editor().state.selection.toJSON();
    const focused = document.activeElement;

    editor().view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    await until(() => drawn(container, 'tu1').length === 0, 'the layer leaving the composing block');
    expect(container.querySelector('.doc-provisional-old'), 'nothing of it in the block').toBeNull();
    world!.host.announce(frame('tu1', 'streaming', [{ op: 'replace_text', block: 'p2', old: 'on Friday', text: 'on Thursday' }]));
    world!.host.announce(frame('tu2', 'streaming', [{ op: 'insert', after: 'p3', text: 'Elsewhere.' }]));
    await until(() => drawn(container, 'tu2').length === 1, 'the other layer');
    expect(drawn(container, 'tu1'), 'still nothing in the composing block').toHaveLength(0);

    editor().view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await until(() => drawn(container, 'tu1').length === 1, 'the layer once the composition ended');
    expect([drawn(container, 'tu1')[0].textContent, inBlock(drawn(container, 'tu1')[0])]).toEqual(['on Thursday', 'p2']);
    expect(editor().state.selection.toJSON(), 'the selection untouched').toEqual(selection);
    expect(document.activeElement, 'the focus untouched').toBe(focused);
  });

  it('writes nothing: the replica’s and the host’s state vectors, the revision and the unsaved count stay through a layer’s life', async () => {
    const { handle, container, editor } = await mount();
    const replica = stateVector(handle.doc);
    const host = stateVector(world!.host.doc);
    const revision = world!.host.revision;
    const unsaved: number[] = [];
    for (const text of ['A', 'A new', 'A new block.']) {
      world!.host.announce(frame('tu1', 'streaming', [{ op: 'replace_block', block: 'p2', text }, { op: 'replace_text', block: 'p1', old: 'Monday', text }]));
      await until(() => drawn(container).some((el) => el.textContent === text), `the frame ${text}`);
      unsaved.push(handle.state().unsaved);
    }
    world!.host.announce(frame('tu1', 'dropped', []));
    await until(() => drawn(container).length === 0, 'the withdrawal');
    await ticks();
    expect(stateVector(handle.doc)).toEqual(replica);
    expect(stateVector(world!.host.doc)).toEqual(host);
    expect(world!.host.revision).toBe(revision);
    expect([...unsaved, handle.state().unsaved]).toEqual([0, 0, 0, 0]);
    expect(editor().can().undo(), 'nothing to undo').toBe(false);
  });

  it('maps the layer through the person’s own typing instead of redrawing it', async () => {
    const { container, editor } = await mount();
    world!.host.announce(frame('tu1', 'streaming', [{ op: 'replace_text', block: 'p2', old: 'on Friday', text: 'on Thursday' }]));
    await until(() => drawn(container).length === 1, 'the layer');
    const state = () => provisionalKey.getState(editor().state)!;
    const before = state();
    const element = drawn(container)[0];
    editor().commands.insertContentAt(endOf(editor(), 'p1'), ' Typed.'); // before the layer: its positions move
    const after = state();
    expect(after.drawn, 'not drawn afresh').toBe(before.drawn);
    const types = (set: typeof before.set) => set.find().map((d) => (d as unknown as { type: unknown }).type);
    expect(types(after.set), 'the same decorations, mapped').toEqual(types(before.set));
    expect(after.set.find().map((d) => d.from)).toEqual(before.set.find().map((d) => d.from + ' Typed.'.length));
    expect(drawn(container)[0], 'the same element').toBe(element);
  });

  it('bumps the comment overlay’s layout as the layer grows', async () => {
    const keys = new Set<string>();
    const { container } = await mount(
      {
        overlay: ({ layoutKey }) => {
          keys.add(layoutKey);
          return null;
        },
      },
      'hide', // P4-B1: the overlay over the frame, where its key carries the passages' moves
    );
    await ticks(30);
    const settled = keys.size;
    for (const text of ['A', 'A longer', 'A longer text']) world!.host.announce(frame('tu1', 'streaming', [{ op: 'insert', after: 'p3', text }]));
    await until(() => drawn(container)[0]?.textContent === 'A longer text', 'the last frame');
    await until(() => keys.size > settled, 'a layout bump');
    await ticks(30);
    expect(keys.size - settled, 'coalesced to the animation frame').toBeLessThanOrEqual(2);
  });

  // P4-B1: with the margin drawn the growth is told to the margin from the page frame's frame callback (`relayoutRef`),
  // and the overlay it hosts (in flow, its key carrying no moves) is not drawn again for it. The follow-up wave: an
  // agent's streamed write owes the margin a pass, run once the growth pauses, none in the growth's own frames
  it.each([['with', true], ['without', false]] as const)('re-lays the margin once the layer’s growth pauses, %s a comment surface, without drawing its overlay again', async (_, surface) => {
    const keys: string[] = [];
    const overlay = (props: CommentOverlayProps) => {
      keys.push(props.layoutKey);
      return null;
    };
    const { container } = await mount(surface ? { overlay } : undefined);
    const margin = container.querySelector<HTMLElement>('.doc-margin[data-margin-tier]')!;
    expect(margin.dataset.marginTier, 'the margin drawn').not.toBe('off');
    await ticks(30);
    const passes = () => Number(margin.dataset.relayouts ?? 0);
    const settled = { passes: passes(), calls: keys.length };
    const frames = () => Number(container.querySelector<HTMLElement>('.ds-doc')?.dataset.frames ?? 0);
    const framesBefore = frames();
    for (const text of ['A', 'A longer', 'A longer text']) world!.host.announce(frame('tu1', 'streaming', [{ op: 'insert', after: 'p3', text }]));
    await until(() => drawn(container)[0]?.textContent === 'A longer text', 'the last frame');
    await until(() => frames() > framesBefore, 'the growth’s frame callback');
    expect(passes() - settled.passes, 'none in the growth’s frames').toBe(0);
    await until(() => passes() > settled.passes, 'a margin layout pass');
    await ticks(30);
    expect(passes() - settled.passes, 'one pass once the growth paused').toBe(1);
    expect(keys.length, 'the hosted overlay not drawn again').toBe(settled.calls); // its key is the margin's constant one: the calls, not the distinct keys, say whether it was drawn
  });
});

describe('the provisional layer’s growth', () => {
  it('is told after each redraw of the layer, and not for the person’s typing', async () => {
    world = new World(content());
    let grown = 0;
    const { editor } = await world.replica('owner', (handle) => {
      const layers = new ProvisionalLayers(handle);
      stops.push(layers.attach());
      return [Provisional.configure({ layers, onGrow: () => (grown += 1) })];
    });
    const shown = () => drawn(editor.view.dom).map((el) => el.textContent);
    world.host.announce(frame('tu1', 'streaming', [{ op: 'insert', after: 'p3', text: 'One' }]));
    await until(() => shown()[0] === 'One', 'the layer');
    expect(grown).toBe(1);
    world.host.announce(frame('tu1', 'streaming', [{ op: 'insert', after: 'p3', text: 'One two' }]));
    await until(() => shown()[0] === 'One two', 'the next frame');
    expect(grown).toBe(2);
    editor.commands.insertContentAt(endOf(editor, 'p1'), 'X');
    expect(grown, 'typing maps the layer; the editor’s own update reports it').toBe(2);
    world.host.announce(frame('tu1', 'dropped', []));
    await until(() => shown().length === 0, 'the withdrawal');
    expect(grown).toBe(3);
  });
});

// G2.5 (G-R7): a dashboard's `artifact_dataset` streams its id alone; the layer labels every chart block whose source
// names that dataset (the plain editor draws a chart as its placeholder atom, which the label rides as on a drawn view)
describe('the provisional layer on a dashboard’s charts', () => {
  const chart = (id: string, source: string): JSONContent => ({ type: 'chart', attrs: { id, source, spec: null } });
  const dashboard = () =>
    doc(
      para('p1', 'Quarterly sales.'),
      chart('c1', 'sales'),
      chart('c2', '\n  sales \n'), // an imported fence's padding: bound all the same, as the views read it
      chart('c3', 'costs'),
      { type: 'callout', attrs: { id: 'k1' }, content: [para('kp', 'A note beside the chart.'), chart('c4', 'sales')] },
      para('p4', 'The end.'),
    );
  const dataset = (toolUseId: string, state: ArtifactProvisional['state'], id: string, commitSeq?: number): ArtifactProvisional => ({ ...frame(toolUseId, state, state === 'dropped' ? [] : [{ op: 'dataset', dataset: id, text: '' }], commitSeq), kind: 'dashboard' });
  // the chart blocks in document order, and which of them carry a dataset label
  const charts = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-node="chart"]')];
  const labelled = (root: ParentNode) => charts(root).map((el, index) => (el.dataset.provisionalOp === 'dataset' ? `c${index + 1}` : null)).filter(Boolean);
  const DESCRIPTOR = {
    title: 'Sales',
    source: { kind: 'file', ref: 'assets/sales.csv', name: 'sales.csv', format: 'csv', sha256: 'a'.repeat(64), size: 42 },
    columns: [{ name: 'region', type: 'string' }],
    rows: 2,
    updated: { at: 1_760_000_000_000, by: AGENT },
    state: { status: 'ok', at: 1_760_000_000_000 },
  } as const;

  it('labels every chart bound to the dataset with the agent’s name and colour, and nothing else', async () => {
    const { container, editor } = await mount(undefined, undefined, dashboard());
    const before = blocks(editor());
    world!.host.announce(dataset('tu1', 'streaming', 'sales'));
    await until(() => labelled(container).length > 0, 'the labels');
    expect(labelled(container), 'the charts whose source names it').toEqual(['c1', 'c2', 'c4']);
    for (const el of charts(container).filter((c) => c.dataset.provisionalOp === 'dataset')) {
      expect(el.dataset.provisionalLabel, 'the label the page shows').toBe('Fix the build is updating sales…');
      expect([el.dataset.provisional, el.dataset.provisionalBy, el.dataset.provisionalDataset]).toEqual(['tu1', 'Fix the build', 'sales']);
      expect(el.classList.contains('doc-provisional-dataset')).toBe(true);
      expect(el.style.getPropertyValue('--doc-presence')).toBe('var(--author-3)');
      expect(el.hasAttribute('tabindex')).toBe(false);
    }
    expect(container.querySelectorAll('.doc-provisional-block, .doc-provisional-text'), 'a label, not a block of text').toHaveLength(0);
    expect(blocks(editor()), 'the document as it was').toEqual(before);
  });

  it('keeps the labels until the dataset’s write is integrated, and withdraws a dropped call’s at once', async () => {
    const { container } = await mount(undefined, undefined, dashboard());
    world!.host.announce(dataset('tu1', 'streaming', 'sales'));
    await until(() => labelled(container).length === 3, 'the labels');
    world!.host.announce(dataset('tu1', 'committed', 'sales', world!.host.nextRevision));
    await ticks();
    expect(labelled(container), 'the labels wait for the write').toEqual(['c1', 'c2', 'c4']);
    world!.host.write((d) => setDataset(d, 'sales', DESCRIPTOR as never), AGENT);
    await until(() => labelled(container).length === 0, 'the withdrawal at integration');

    world!.host.announce(dataset('tu2', 'streaming', 'costs'));
    await until(() => labelled(container).length === 1, 'the next call’s label');
    expect([labelled(container), charts(container)[2].dataset.provisionalLabel]).toEqual([['c3'], 'Fix the build is updating costs…']);
    world!.host.announce(dataset('tu2', 'dropped', 'costs'));
    await until(() => labelled(container).length === 0, 'the dropped call withdrawn');
  });

  // Rule 1 against the editor's own repairs: a remote write that leaves a chart last arms TrailingNode, which appends a
  // paragraph on the editor's next transaction that is not the binding's; the layer's redraws must not be that
  // transaction, or a frame would write the person's doc (the Mac run 39733208468's revision 24, there set off by
  // Presence's redraw).
  it('writes nothing when a frame arrives after a remote write left a chart last: no trailing paragraph, no Y update', async () => {
    const { handle, container, editor } = await mount(undefined, undefined, doc(para('p1', 'Quarterly sales.'), para('p4', 'The end.')));
    world!.host.write((d) => {
      const body = tabBody(d, TAB)!;
      body.insert(body.length, [YNode.from(pmnodeToDelta(schemaFor().nodeFromJSON(chart('c9', 'sales'))))]);
    }, AGENT);
    await until(() => charts(container).length === 1, 'the remote chart');
    await ticks();
    expect(editor().state.doc.lastChild?.type.name, 'the remote write itself repairs nothing').toBe('chart');
    const replica = stateVector(handle.doc);
    const host = stateVector(world!.host.doc);
    const revision = world!.host.revision;
    world!.host.announce(dataset('tu1', 'streaming', 'sales'));
    await until(() => labelled(container).length === 1, 'the dataset’s label');
    world!.host.announce(frame('tu2', 'streaming', [{ op: 'replace_text', block: 'p1', old: 'sales', text: 'revenue' }]));
    await until(() => drawn(container, 'tu2').length === 1, 'the edit’s layer');
    await ticks();
    expect(editor().state.doc.lastChild?.type.name, 'no paragraph appended after the chart').toBe('chart');
    expect(stateVector(handle.doc)).toEqual(replica);
    expect(stateVector(world!.host.doc)).toEqual(host);
    expect([world!.host.revision, handle.state().unsaved]).toEqual([revision, 0]);
  });

  it('labels no chart inside the block the person composes in until the composition ends', async () => {
    const { container, editor } = await mount(undefined, undefined, dashboard());
    editor().commands.setTextSelection(endOf(editor(), 'kp'));
    editor().view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    world!.host.announce(dataset('tu1', 'streaming', 'sales'));
    await until(() => labelled(container).length > 0, 'the labels outside the composition');
    await ticks();
    expect(labelled(container), 'the callout’s chart waits').toEqual(['c1', 'c2']);
    editor().view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await until(() => labelled(container).length === 3, 'the callout’s chart once the composition ended');
  });
});
