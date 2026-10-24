// The dashboard editor registered into L's registry and mounted as L's surfaces mount it (P3-E2 M3; X32, E's Decision
// Log 19): B's document body over B's tab state with the dashboard's charts drawn in the page, the Datasets action after
// B's header actions opening the source sheet on the shown document's datasets, a source label opening it on its own
// dataset, and a held legacy dashboard shown as held (its files and the way forward), never as a blank editable page.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument } from '@artifacts/document/tabs';
import { FILES_ROOT } from '@artifacts/files';
import type { ArtifactHost, DatasetPage } from '@artifacts/host';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, CommandOutput, MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../../test/support/fake-client';
import { artifactEditorFor, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors } from '../../artifacts/registry';
import { resetMarkupSurfaces } from '../../markup/surface';
import { editorHostOf, EditorHostScopeContext, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { resetShellStores } from '../../test-support/shell-stores';
import type { DocumentTabDeps } from '../document/tab-state';
import { registerDashboardEditor } from './index';
import type { DashboardTabState } from './tab-state';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1f';
const SESSION = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const scope: EditorHostScope = { surface: 'panel', tabId: 'panel-tab-dash' };
const AT = Date.UTC(2026, 9, 16, 8, 30);
const sales: DatasetDescriptor = {
  title: 'Regional sales',
  source: { kind: 'file', ref: 'assets/sales.csv', name: 'sales.csv', format: 'csv', sha256: 'c'.repeat(64), size: 64 },
  columns: [{ name: 'region', type: 'string' }, { name: 'sales', type: 'number' }],
  rows: 2,
  updated: { at: AT, by: { kind: 'session', appSessionId: SESSION } },
  state: { status: 'ok', at: AT },
};
const PAGE: DatasetPage = { columns: sales.columns, rows: [['North', 12], ['South', 7]], total: 2, truncated: false };

let memory: MemoryDocumentHost;
let off = () => {};
let readDataset: ReturnType<typeof vi.fn>;
let fileChecks: ReturnType<typeof vi.fn<(input: unknown) => Promise<CommandOutput<'artifacts.datasetFiles'>>>>;
let rereads: ReturnType<typeof vi.fn<(input: unknown) => Promise<CommandOutput<'artifacts.rereadDatasetFile'>>>>;
beforeEach(() => {
  resetShellStores();
  resetEditorHosts();
  resetMarkupSurfaces();
  resetArtifactEditors();
  window.maws = fakeClient({ 'session.intent.get': null }).client;
  memory = new MemoryDocumentHost();
  readDataset = vi.fn(async () => PAGE);
  fileChecks = vi.fn<(input: unknown) => Promise<CommandOutput<'artifacts.datasetFiles'>>>().mockResolvedValue({ revision: 12, files: [] });
  rereads = vi.fn<(input: unknown) => Promise<CommandOutput<'artifacts.rereadDatasetFile'>>>().mockResolvedValue({ revision: 13, versionId: 4 });
});
afterEach(() => {
  cleanup();
  releaseArtifactEditorState(scope);
  off();
  memory.destroy();
  delete (window as { maws?: unknown }).maws;
});

const until = async (check: () => boolean, what: string) => {
  const give = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > give) throw new Error(`timed out waiting for ${what}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }
};

function deps(): DocumentTabDeps {
  const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
    invoke: (async (name: CommandName, input: unknown) => ({ ok: true, value: name === 'artifacts.get' ? { artifact: { id: A, kind: 'dashboard', title: 'Sales board', lastViewedAt: null, revision: 1 } } : name === 'artifacts.versions' ? { versions: [] } : name === 'artifacts.datasetFiles' ? await fileChecks(input) : name === 'artifacts.rereadDatasetFile' ? await rereads(input) : undefined })) as MawsBridge['invoke'],
    on: (() => () => {}) as MawsBridge['on'],
  };
  const editor = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });
  const host = {
    ...editor,
    open: async () => {
      const handle = openMemoryHandle(memory, { log: () => {} });
      await whenSynced(handle);
      return handle;
    },
    readDataset,
    downloadAsset: vi.fn(async () => ({ path: null })),
    versionState: async () => new Uint8Array(),
    attributions: async () => new Uint8Array(),
  } as unknown as ArtifactHost;
  return { host, ipc, log: () => {}, confirm: () => false, sessionTitle: (id) => (id === SESSION ? 'Quarterly numbers' : undefined), sessions: () => [] };
}

function mount() {
  off = registerDashboardEditor(deps);
  const editor = artifactEditorFor('dashboard')!;
  const hold = holdArtifactEditorState<DashboardTabState>(scope, A, 'dashboard', editor as never);
  const onShown = vi.fn();
  render(
    <EditorHostScopeContext.Provider value={scope}>
      <editor.Panel artifactId={A} state={hold.state} scope={scope} visible onShown={onShown} />
    </EditorHostScopeContext.Provider>,
  );
  return { state: hold.state as DashboardTabState, onShown };
}
const header = () => editorHostOf(scope)!;
const action = (id: string) => header().actions?.find((a) => a.id === id);

describe('the dashboard editor in L’s registry', () => {
  it('draws its chart blocks in B’s editor with their source labels, and adds Datasets after B’s header actions', async () => {
    memory.write((doc) => {
      createDocument(doc, { title: 'Sales board', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Notes on the quarter.' }] }, { type: 'chart', attrs: { id: 'c1', source: 'sales', spec: { view: 'bar', x: 'region', y: 'sales', title: 'Sales by region' } } }] }) });
      setDataset(doc, 'sales', sales);
    });
    const { onShown } = mount();
    expect(artifactEditorFor('dashboard')!.Panel.name).toBe('DashboardPanel');
    await until(() => document.querySelector('.ds-doc .dash-figure svg') !== null, 'the chart');
    expect(document.querySelector('.dash-caption')?.textContent).toBe('Sales by region');
    expect([...document.querySelectorAll('.dash-figure [data-tip]')].map((el) => el.getAttribute('data-tip'))).toEqual(['North · sales: 12', 'South · sales: 7']);
    const label = document.querySelector<HTMLButtonElement>('button.dash-source-label')!;
    expect(label.textContent).toBe('Regional sales · from sales.csv · updated 2026-10-16 08:30 UTC by Quarterly numbers');
    expect(readDataset).toHaveBeenCalledWith(A, 'assets/sales.csv', { format: 'csv' });
    await until(() => onShown.mock.calls.length > 0, 'the owner’s view');

    const ids = header().actions!.map((a) => a.id);
    expect(ids.at(-1)).toBe('sendTo'); // P4-B5: Send to, pinned, after every other action
    expect(ids.slice(0, -1)).toEqual(['save-version', 'suggestions', 'datasets']);
    const documentTools = within(screen.getByRole('toolbar', { name: 'Formatting' }));
    expect(documentTools.getAllByRole('button', { name: 'Version history' })).toHaveLength(1);
    expect(documentTools.getAllByRole('button', { name: /^Comments(?: |$)/ })).toHaveLength(1);

    // the label opens the sheet on its own dataset; Datasets closes it, and opens it on the shown document's datasets
    act(() => label.click());
    expect(screen.getByRole('dialog', { name: 'Source of Regional sales' })).toBeTruthy();
    expect(action('datasets')?.pressed).toBe(true);
    act(() => action('datasets')!.onSelect());
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => action('datasets')!.onSelect());
    await until(() => screen.queryAllByRole('cell').length > 0, 'the sheet’s rows');
    expect(within(screen.getByRole('dialog')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['North', '12', 'South', '7']);
    act(() => void fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('signals a changed source on the dashboard and rereads it with one action, without requiring an agent', async () => {
    memory.write((doc) => {
      createDocument(doc, { title: 'Sales board' });
      setDataset(doc, 'sales', sales);
    });
    fileChecks.mockResolvedValue({ revision: 12, files: [{ id: 'sales', ref: 'assets/sales.csv', state: 'changed' }] });
    mount();
    await until(() => screen.queryByRole('button', { name: 'Reread Regional sales' }) !== null, 'changed source action');
    expect(screen.getByRole('status').textContent).toContain('sales.csv changed');
    let finish!: (result: { revision: number; versionId: number }) => void;
    rereads.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    act(() => screen.getByRole('button', { name: 'Reread Regional sales' }).click());
    expect(rereads).toHaveBeenCalledWith({ artifactId: A, id: 'sales', baseRevision: 12 });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reread Regional sales' }).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Rereading');
    fileChecks.mockResolvedValue({ revision: 13, files: [{ id: 'sales', ref: 'assets/new-sales.csv', state: 'current' }] });
    await act(async () => finish({ revision: 13, versionId: 4 }));
    await until(() => screen.queryByRole('button', { name: 'Reread Regional sales' }) === null, 'stale signal cleared');
  });

  it('shows an unavailable source without replacing the last good dataset or offering an unsafe reread', async () => {
    memory.write((doc) => {
      createDocument(doc, { title: 'Sales board' });
      setDataset(doc, 'sales', sales);
    });
    fileChecks.mockResolvedValue({ revision: 12, files: [{ id: 'sales', ref: 'assets/sales.csv', state: 'unavailable' }] });
    mount();
    await until(() => screen.queryByText(/sales.csv is unavailable/) !== null, 'missing source signal');
    expect(screen.queryByRole('button', { name: 'Reread Regional sales' })).toBeNull();
    expect(rereads).not.toHaveBeenCalled();
  });

  it('shows a held legacy dashboard as held: its files and the way forward, no editor', async () => {
    memory.write((doc) => {
      const files = doc.get(FILES_ROOT);
      files.setAttr('index.html', '<h1>Old board</h1>');
      files.setAttr('data.csv', 'a,b\n1,2\n');
    });
    const { onShown } = mount();
    await until(() => screen.queryByText(/made before dashboards were documents/) !== null, 'the held notice');
    expect(screen.getByText('data.csv')).toBeTruthy();
    expect(screen.getByText('index.html')).toBeTruthy();
    expect(document.querySelector('.ProseMirror')).toBeNull();
    expect(header().saved).toBe('readonly');
    await until(() => onShown.mock.calls.length > 0, 'the owner’s view');
  });
});
