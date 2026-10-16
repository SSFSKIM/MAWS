// P3-E (E2 M3; E's Decision Log 19): the document the editor shows, told to its caller (`onDisplayedDocument`) and to
// every chart it draws (`renderChart`'s environment): the live doc, a previewed version's doc with its revision, the
// suggestion replica's doc while the review shows; a version switched in the same preview editor moves the charts'
// displayed document too. B's editor without these props is unchanged (its own suites).
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { applyV2, attributionMap, contentIdsOf, encodeMap, newSuggestionDoc, stateV2, type Doc } from '../../yjs';
import { schemaFor } from '../schema';
import { createDocument, tabBody } from '../tabs';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle } from './host-types';
import { MemoryHistory } from './history/memory-history';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import type { ViewEnvironment } from './nodes/views';
import { Suggestions, type SuggestionHost } from './Suggestions';
import { until } from './test-world';

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

const open = async () => {
  const handle = openMemoryHandle(host!, { log: () => {}, actor: HUMAN });
  handles.push(handle);
  await whenSynced(handle);
  return handle;
};
const content = (text: string) =>
  schemaFor().nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text }] },
      { type: 'chart', attrs: { id: 'c1', source: 'sales', spec: { view: 'bar' } } },
    ],
  });

/** A recording renderChart: each drawing's displayed document and revision, as current when drawn or told. */
function recorder() {
  const seen: { doc: Doc; revision?: number }[] = [];
  const renderChart = vi.fn((_into: HTMLElement, _node: PMNode, env: ViewEnvironment) => {
    const note = () => seen.push({ ...env.displayed!.current() });
    note();
    return env.displayed!.subscribe(note);
  });
  return { seen, renderChart };
}

describe('the displayed document', () => {
  it('is the live doc, then a previewed version\'s with its revision, and the live doc again', async () => {
    host = new MemoryDocumentHost();
    history = new MemoryHistory(host);
    host.write((doc) => createDocument(doc, { title: 'Main', id: TAB, body: content('The first version.') }));
    const before = history.version('named', HUMAN, { label: 'Before' });
    host.write((doc) => (tabBody(doc, TAB)!.get(0) as { insert(i: number, s: string): void }).insert(0, 'Edited. '));
    const middle = history.version('named', HUMAN, { label: 'Middle' });
    host.write((doc) => (tabBody(doc, TAB)!.get(0) as { insert(i: number, s: string): void }).insert(0, 'Later. '));
    const handle = await open();
    const told: { doc: Doc; revision?: number }[] = [];
    const { seen, renderChart } = recorder();
    let editor: Editor | null = null;
    render(<DocumentEditor artifactId="doc1" handle={handle} host={memoryEditorHost({ actor: HUMAN, name: 'Owner', color: '--author-2' })} history={history} onEditor={(e) => (editor = e)} renderChart={renderChart} onDisplayedDocument={(doc, revision) => told.push({ doc, ...(revision !== undefined && { revision }) })} />);
    await until(() => editor !== null && editor.getText().length > 0, 'the editor to bind');
    expect(told).toEqual([{ doc: handle.doc }]);
    expect(seen).toEqual([{ doc: handle.doc }]);

    act(() => void fireEvent.click(within(screen.getByRole('toolbar', { name: 'Formatting' })).getByRole('button', { name: 'Version history' })));
    await until(() => screen.queryByRole('button', { name: /^Version Before/ }) !== null, 'the version list');
    act(() => void fireEvent.click(screen.getByRole('button', { name: /^Version Before/ })));
    await until(() => told.length === 2 && seen.length > 1, 'the preview');
    const version = told[1];
    expect(version.doc).not.toBe(handle.doc);
    expect(version.revision).toBe(before.seq);
    expect(tabBody(version.doc, TAB)?.toString()).not.toContain('Edited.');
    expect(seen.slice(1)).toEqual([{ doc: version.doc, revision: before.seq }]); // the preview's chart, the live one's untouched

    // another version in the same preview editor: its charts follow the displayed document there
    act(() => void fireEvent.click(screen.getByRole('button', { name: /^Version Middle/ })));
    await until(() => told.length === 3, 'the second version');
    expect(told[2].revision).toBe(middle.seq);
    expect(told[2].doc).not.toBe(version.doc);
    await until(() => seen.at(-1)?.doc === told[2].doc, 'the chart on the second version');
    expect(seen.at(-1)).toEqual({ doc: told[2].doc, revision: middle.seq });

    act(() => void fireEvent.click(within(screen.getByRole('toolbar', { name: 'Version preview' })).getByRole('button', { name: 'Back to document' })));
    await until(() => told.length === 4, 'the live document again');
    expect(told[3]).toEqual({ doc: handle.doc });
  });

  it('is the suggestion replica\'s doc in the review, told to its charts and its caller', async () => {
    host = new MemoryDocumentHost();
    host.write((doc) => createDocument(doc, { title: 'Main', id: TAB, body: content('Original.') }));
    const handle = await open();
    const proposal = newSuggestionDoc();
    applyV2(proposal, stateV2(handle.doc));
    let update: Uint8Array | null = null;
    proposal.on('update', (bytes: Uint8Array) => (update = bytes));
    (tabBody(proposal, TAB)!.get(0) as { insert(i: number, s: string): void }).insert(0, 'Proposed. ');
    const map = encodeMap(attributionMap(contentIdsOf(update!), { insertActor: 'session:agent', deleteActor: 'session:agent', at: Date.now() }));
    const suggestions: SuggestionHost = {
      open: vi.fn(async () => ({ ...handle, doc: proposal, close: () => {} })),
      attributions: vi.fn(async () => map),
      acceptSuggestion: vi.fn(async () => ({ revision: 2 })),
      rejectSuggestion: vi.fn(async () => ({ revision: 2 })),
    };
    const { seen, renderChart } = recorder();
    const told: Doc[] = [];
    render(<Suggestions artifactId="doc1" tabId={TAB} base={handle} host={suggestions} editorHost={memoryEditorHost({ actor: HUMAN, name: 'Owner', color: '--author-2' })} onPending={() => {}} renderChart={renderChart} onDisplayedDocument={(doc) => told.push(doc)} />);
    await until(() => seen.length > 0, 'the review\'s chart');
    expect(seen).toEqual([{ doc: proposal }]);
    expect(told).toEqual([proposal]);
    proposal.destroy();
  });
});
