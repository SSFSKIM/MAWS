// P3-E (E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md; E's Decision Log 8 and 28 (3), (4)): the history's
// optional `extraChanges` in DocumentEditor (happy-dom over the in-memory host and history). A change outside every tab
// body (a dashboard's dataset replaced, its chart's attributes byte-identical) counts in the "See N new changes" pill
// and the bar's "N changes" alike; a bound one marks its block and ↑ ↓ reach it (the block selected and outlined); an
// unbound one is a labelled stop of the bar's own, with no tab faked; without the hook, the same writes count nothing.
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { actorKey, type Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { ExtraChange } from '../../history';
import { schemaFor } from '../../schema';
import { createDocument } from '../../tabs';
import type { Doc } from '../../../yjs';
import { DocumentEditor } from '../DocumentEditor';
import type { DocumentHandle } from '../host-types';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '../memory-host';
import { until } from '../test-world';
import { MemoryHistory } from './memory-history';

const SESSION = '00000000-0000-4000-8000-0000000000a1' as AppSessionId;
const AGENT: Actor = { kind: 'session', appSessionId: SESSION };
const HUMAN: Actor = { kind: 'human' };
const TAB = 't1';

let host: MemoryDocumentHost | null = null;
let history: MemoryHistory | null = null;
let handles: DocumentHandle[] = [];
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  handles = [];
  history?.destroy();
  history = null;
  host?.destroy();
  host = null;
});

// A stand-in kind's hook: a value in a root of its own changed is a change of the chart bound to it and an entry of its own.
const valueOf = (doc: Doc, key: string): unknown => doc.get('data').getAttr(key);
const hook = (prev: Doc, next: Doc): readonly ExtraChange[] =>
  valueOf(prev, 'sales') === valueOf(next, 'sales')
    ? []
    : [
        { key: 'data:sales:c1', label: 'Dataset sales replaced', tabId: TAB, blockId: 'c1', who: actorKey(AGENT), at: 1 },
        { key: 'data:spare', label: 'Dataset spare replaced', tabId: null, blockId: null, who: actorKey(AGENT), at: 1 },
      ];

async function setup({ withHook }: { withHook: boolean }): Promise<() => Editor> {
  const t = { value: Date.now() - 60 * 60_000 };
  host = new MemoryDocumentHost();
  history = new MemoryHistory(host, { now: () => t.value });
  if (withHook) Object.assign(history, { extraChanges: hook });
  host.write((doc) => {
    createDocument(doc, {
      title: 'Main',
      id: TAB,
      body: schemaFor().nodeFromJSON({
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Sales rose.' }] },
          { type: 'chart', attrs: { id: 'c1', source: 'sales', spec: { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' } } },
          { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Notes.' }] },
        ],
      }),
    });
    doc.get('data').setAttr('sales', 1);
  });
  history.version('auto', HUMAN);
  await history.markViewed();
  t.value += 10 * 60_000;
  host.write((doc) => doc.get('data').setAttr('sales', 2), AGENT); // the data alone: no tab body changes
  history.version('auto', AGENT);
  t.value += 10 * 60_000;
  const handle = openMemoryHandle(host, { log: () => {}, actor: HUMAN });
  handles.push(handle);
  await whenSynced(handle);
  let editor: Editor | null = null;
  render(<DocumentEditor artifactId="dash1" handle={handle} host={memoryEditorHost({ actor: HUMAN, name: 'Owner', color: '--author-2' })} history={history} onEditor={(e) => (editor = e)} />);
  await until(() => editor !== null && editor.getText().length > 0, 'the editor to bind');
  return () => editor!;
}

const bar = () => screen.getByRole('toolbar', { name: 'Version preview' });
const click = (element: Element) => act(() => void fireEvent.click(element));
const previewEditor = (): Editor | null => (document.querySelector('.ProseMirror[data-editor="preview"]') as unknown as { editor?: Editor } | null)?.editor ?? null;
const previewChart = () => document.querySelector<HTMLElement>('.ProseMirror[data-editor="preview"] [data-node="chart"]');
const step = (name: 'Next change' | 'Previous change') => click(within(bar()).getByRole('button', { name }));

describe('extra changes in the history (P3-E)', () => {
  it('a data-only change counts in the pill and the bar, marks its chart, and ↑ ↓ reach the chart and the unbound entry', async () => {
    await setup({ withHook: true });
    const pill = await until(() => screen.queryByRole('button', { name: 'See 2 new changes' }) !== null, 'the pill').then(() => screen.getByRole('button', { name: 'See 2 new changes' }));
    click(pill);
    await until(() => screen.queryByRole('toolbar', { name: 'Version preview' }) !== null && previewChart() !== null, 'the preview');
    expect(within(bar()).getByText('2 changes')).toBeTruthy();
    await until(() => previewChart()!.classList.contains('doc-change-attrs') && previewChart()!.hasAttribute('data-change-block'), 'the chart marked as changed');
    expect(within(bar()).queryByText('Dataset spare replaced')).toBeNull(); // named once reached

    step('Next change');
    await until(() => previewChart()!.classList.contains('doc-change-current'), 'the chart reached');
    const selection = previewEditor()!.state.selection;
    expect(selection instanceof NodeSelection && selection.node.attrs.id).toBe('c1');

    step('Next change');
    await until(() => within(bar()).queryByText('Dataset spare replaced') !== null, 'the unbound entry reached');
    expect(within(bar()).getByText('Dataset spare replaced').hasAttribute('data-current')).toBe(true);
    expect(previewChart()!.classList.contains('doc-change-current')).toBe(false);
    expect((within(bar()).queryByRole('combobox', { name: 'Tab' }) as HTMLSelectElement | null)?.value ?? TAB).toBe(TAB); // no tab faked

    step('Next change'); // wraps to the chart
    await until(() => previewChart()!.classList.contains('doc-change-current') && within(bar()).queryByText('Dataset spare replaced') === null, 'the wrap');
    step('Previous change');
    await until(() => within(bar()).queryByText('Dataset spare replaced') !== null, 'back to the unbound entry');
    expect(within(bar()).getByText('2 changes')).toBeTruthy();
  });

  it('reaching the unbound entry clears the reached chart’s block selection, so its outline is not left drawn (E2 M6)', async () => {
    await setup({ withHook: true });
    await until(() => screen.queryByRole('button', { name: 'See 2 new changes' }) !== null, 'the pill');
    click(screen.getByRole('button', { name: 'See 2 new changes' }));
    await until(() => screen.queryByRole('toolbar', { name: 'Version preview' }) !== null && previewChart() !== null, 'the preview');
    step('Next change');
    await until(() => previewChart()!.classList.contains('ProseMirror-selectednode'), 'the chart selected whole');
    step('Next change');
    await until(() => within(bar()).queryByText('Dataset spare replaced') !== null, 'the unbound entry reached');
    expect(previewEditor()!.state.selection instanceof NodeSelection).toBe(false);
    expect(previewChart()!.classList.contains('ProseMirror-selectednode')).toBe(false);
  });

  it('without the hook the same data-only change counts nothing: no pill', async () => {
    await setup({ withHook: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: /new change/ })).toBeNull();
  });
});
