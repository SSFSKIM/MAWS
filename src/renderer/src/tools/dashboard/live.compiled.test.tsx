// E3 M3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3, R4; the M3 entry): the dashboard editor's live
// datasets as L's surfaces mount it, under the React Compiler as electron-vite builds it (vitest's `renderer-compiled`
// project) and without it. A shown live dashboard owns its tab's H surface and one watch per scheduled query; the body
// going inactive, its window's document hiding and a history preview hide the surface, never ending the watch; the tab's
// end closes it. The view's label says the live pause; the source sheet's Start runs H's context and start policy (an
// artifact with no context refuses in H's words), and nothing starts a session from a mount or ten minutes of timers.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { newDoc } from '@artifacts/yjs'; // E3 panel residual
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument } from '@artifacts/document/tabs';
import type { ArtifactHost, DatasetPage } from '@artifacts/host';
import type { ConnectorCallOutcome } from '@shared/artifacts/connectors';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { NO_SESSION_CONTEXT } from '../../artifacts/session-context';
import { artifactEditorFor, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors } from '../../artifacts/registry';
import { resetMarkupSurfaces } from '../../markup/surface';
import { EditorHostScopeContext, editorHostOf, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { resetShellStores } from '../../test-support/shell-stores';
import type { DocumentTabDeps } from '../document/tab-state';
import { registerDashboardEditor } from './index';
import type { DashboardTabState } from './tab-state';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d10';
const scope: EditorHostScope = { surface: 'panel', tabId: 'panel-tab-live' };
const AT = Date.UTC(2026, 9, 17, 9, 0);
const live: DatasetDescriptor = {
  title: 'Live sales',
  source: { kind: 'query', server: 'fixture', tool: 'rows', args: { region: 'north' }, schedule: 30, snapshot: { ref: 'assets/query-1.json', at: AT } },
  columns: [{ name: 'region', type: 'string' }, { name: 'sales', type: 'number' }],
  rows: 2,
  updated: { at: AT, by: { kind: 'human' } },
  state: { status: 'ok', at: AT },
};
const PAGE: DatasetPage = { columns: live.columns, rows: [['North', 12], ['South', 7]], total: 2, truncated: false };

let memory: MemoryDocumentHost;
let off = () => {};
let client: FakeClient;
let surface: ReturnType<typeof fakeSurface>;
// E3 panel residual: the window's dataset holds, as main answers them
let holds: { refs: string[]; released: boolean; lose(): void }[] = [];
beforeEach(() => {
  resetShellStores();
  resetEditorHosts();
  resetMarkupSurfaces();
  resetArtifactEditors();
  client = fakeClient({ 'session.intent.get': null, 'library.get': { row: null }, 'library.spaces': { spaces: [] } });
  window.maws = client.client;
  memory = new MemoryDocumentHost();
  surface = fakeSurface();
  holds = [];
});
afterEach(() => {
  cleanup();
  releaseArtifactEditorState(scope);
  off();
  memory.destroy();
  delete (window as { maws?: unknown }).maws;
  vi.useRealTimers();
});

function fakeSurface() {
  const listeners: ((update: ConnectorCallOutcome) => void)[] = [];
  return {
    listeners,
    declareTools: vi.fn(async (tools: unknown[]) => ({ ok: true, declared: tools })),
    callTool: vi.fn(async () => ({ ok: false, state: 'paused', reason: 'noRoute' })),
    watchTool: vi.fn<(request: unknown, listener: (update: ConnectorCallOutcome) => void, options?: unknown) => Promise<unknown>>(async (_request, listener) => {
      listeners.push(listener);
      return { ok: true, watchId: `w${listeners.length}`, intervalMs: 30_000 };
    }),
    unwatchTool: vi.fn(async () => true),
    refreshWatch: vi.fn(async () => true),
    setVisible: vi.fn(),
    close: vi.fn(),
  };
}

const until = async (check: () => boolean, what: string) => {
  const give = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > give) throw new Error(`timed out waiting for ${what}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }
};

function deps(): DocumentTabDeps {
  const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
    invoke: (async (name: CommandName) => ({ ok: true, value: name === 'artifacts.get' ? { artifact: { id: A, kind: 'dashboard', title: 'Live board', lastViewedAt: null, revision: 1 } } : name === 'artifacts.versions' ? { versions: [] } : undefined })) as MawsBridge['invoke'],
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
    readDataset: vi.fn(async () => PAGE),
    holdDatasets: async (_artifactId: string, refs: readonly string[]) => {
      let lose!: () => void;
      const invalidated = new Promise<void>((resolve) => (lose = resolve));
      const entry = { refs: [...refs], released: false, lose };
      holds.push(entry);
      return { release: () => void (entry.released = true), invalidated };
    },
    downloadAsset: vi.fn(async () => ({ path: null })),
    versionState: async () => new Uint8Array(),
    attributions: async () => new Uint8Array(),
    openConnectors: vi.fn(() => surface),
    connectorGrants: vi.fn(async () => [{ server: 'fixture', tool: 'rows', fingerprint: 'fp', mode: 'read', grantedAt: AT }]),
    grantConnectorTool: vi.fn(),
    revokeConnectorTool: vi.fn(async () => true),
  } as unknown as ArtifactHost;
  return { host, ipc, log: () => {}, confirm: () => false, sessionTitle: () => undefined, sessions: () => [] };
}

function mount() {
  memory.write((doc) => {
    createDocument(doc, { title: 'Live board', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'chart', attrs: { id: 'c1', source: 'sales', spec: { view: 'bar', x: 'region', y: 'sales', title: 'Sales by region' } } }] }) });
    setDataset(doc, 'sales', live);
  });
  off = registerDashboardEditor(deps);
  const editor = artifactEditorFor('dashboard')!;
  const hold = holdArtifactEditorState<DashboardTabState>(scope, A, 'dashboard', editor as never);
  const state = hold.state as DashboardTabState;
  const view = (visible: boolean) => (
    <EditorHostScopeContext.Provider value={scope}>
      <editor.Panel artifactId={A} state={state} scope={scope} visible={visible} onShown={() => {}} />
    </EditorHostScopeContext.Provider>
  );
  const rendered = render(view(true));
  return { state, show: (visible: boolean) => rendered.rerender(view(visible)), unmount: () => rendered.unmount() };
}
const visibility = () => surface.setVisible.mock.calls.map(([shown]) => shown);
const starts = () => client.calls.filter((call) => /session\.(start|acquire|create)/.test(call));

describe('a live dashboard in L’s surfaces (E3 M3)', () => {
  it('owns one watch while shown, hidden by an inactive body, a hidden window document or a history preview, closed with the tab', async () => {
    const m = mount();
    await until(() => surface.watchTool.mock.calls.length > 0, 'the watch');
    expect(surface.watchTool.mock.calls[0]![0]).toEqual({ server: 'fixture', tool: 'rows', args: { region: 'north' }, intervalMs: 30_000 });
    expect(surface.watchTool.mock.calls[0]![2]).toEqual({ dataset: { id: 'sales' } });
    expect(visibility()).toEqual([true]);

    m.show(false); // the tab went inactive or the panel collapsed
    expect(visibility().at(-1)).toBe(false);
    m.show(true);
    expect(visibility().at(-1)).toBe(true);

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(visibility().at(-1)).toBe(false);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(visibility().at(-1)).toBe(true);

    act(() => m.state.document.setPreviewing(true)); // a history preview (or a suggestion review) is read-only
    expect(visibility().at(-1)).toBe(false);
    act(() => m.state.document.setPreviewing(false));
    expect(visibility().at(-1)).toBe(true);

    m.unmount(); // the body unmounted with its tab inactive: suspended, the tab's state kept
    expect(visibility().at(-1)).toBe(false);
    expect(surface.close).not.toHaveBeenCalled();
    expect(surface.watchTool).toHaveBeenCalledTimes(1);
    releaseArtifactEditorState(scope); // the tab closed
    expect(surface.close).toHaveBeenCalledTimes(1);
    expect(starts()).toEqual([]);
  });

  it('labels the view with the live pause, and the sheet’s Start runs H’s context policy on the owner’s press alone', async () => {
    mount();
    await until(() => surface.listeners.length > 0, 'the watch');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => surface.listeners[0]!({ ok: false, state: 'paused', reason: 'noRoute' }));
    await until(() => document.querySelector('button.dash-source-label')?.textContent?.endsWith('paused: no live session') === true, 'the paused label');
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(starts()).toEqual([]);
    expect(screen.queryByText(NO_SESSION_CONTEXT)).toBeNull(); // no Start was asked

    act(() => document.querySelector<HTMLButtonElement>('button.dash-source-label')!.click());
    const block = within(screen.getByRole('dialog')).getByRole('group', { name: 'Live query' });
    expect(within(block).getByText('Allowed to read')).toBeTruthy();
    fireEvent.click(within(block).getByRole('button', { name: 'Refresh Live sales' }));
    expect(surface.refreshWatch).toHaveBeenCalledWith('w1');
    fireEvent.click(within(block).getByRole('button', { name: 'Start session' }));
    await until(() => within(block).queryByText(NO_SESSION_CONTEXT) !== null, 'the refusal in H’s words');
    expect(client.invoked('library.get')).toContainEqual({ artifactId: A }); // the artifact's context read at the press
    expect(starts()).toEqual([]); // no context: nothing started
    expect(editorHostOf(scope)?.actions?.at(-2)?.id).toBe('datasets'); // P4-B5: Send to, pinned, last
  });

  // E3 panel wave (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16): the ruled failure line
  it('an open sheet says the live descriptor’s committed error in its footer’s words beside its controls, its capture unchanged (E3 panel)', async () => {
    mount();
    await until(() => document.querySelector('button.dash-source-label') !== null && surface.listeners.length > 0, 'the view');
    act(() => document.querySelector<HTMLButtonElement>('button.dash-source-label')!.click());
    const dialog = screen.getByRole('dialog');
    await until(() => within(dialog).queryByRole('button', { name: 'Revoke fixture · rows' }) !== null, 'the live controls');
    const block = within(dialog).getByRole('group', { name: 'Live query' });
    const words = 'the last refresh was refused: its structured content is neither an array of rows nor an object with a rows array';
    act(() => memory.write((doc) => setDataset(doc, 'sales', { ...live, state: { status: 'error', message: words, at: AT + 60_000 } }))); // the host's committed error state
    await until(() => within(block).queryByText(words) !== null, 'the committed error in the sheet');
    expect(document.querySelector('button.dash-source-label')!.textContent).toContain(` · ${words}`); // the footer's same words
    expect(within(dialog).getByText(/^Live sales · fixture · rows · updated [^·]+$/)).toBeTruthy(); // the captured label, as captured
    expect(within(block).getByText('Allowed to read')).toBeTruthy();
    expect(within(block).getByRole('button', { name: 'Refresh Live sales' })).toBeTruthy();
    act(() => surface.listeners[0]!({ ok: true, result: { status: 'failed', reason: 'validation' }, fetchedAt: AT, via: { route: 'engine' } })); // the bridge's phase
    expect(within(block).getByText(words)).toBeTruthy(); // transient answers are no authority over it
    act(() => memory.write((doc) => setDataset(doc, 'sales', { ...live, state: { status: 'ok', at: AT + 90_000 } }))); // a later success
    await until(() => within(block).queryByText(words) === null, 'the error gone with the success');
  });

  // E3 panel residual (the retained high review): L's pane renders only its active tab's body, and B's history drops a
  // preview when its editor detaches; the body's unmount lets the preview's hold go, where its window hiding does not
  it('a displayed preview’s hold outlasts its window hiding and goes with its body’s unmount, taken again by nothing (E3 panel residual)', async () => {
    const m = mount();
    await until(() => document.querySelector('button.dash-source-label') !== null, 'the view');
    const version = newDoc(); // the version the editor displays (B's history preview reports it so)
    setDataset(version, 'sales', { ...live, source: { ...live.source, snapshot: { ref: 'assets/query-0.json', at: AT - 60_000 } } } as DatasetDescriptor);
    act(() => m.state.displayed(version));
    const previewed = () => holds.filter((hold) => hold.refs.includes('assets/query-0.json'));
    await until(() => previewed().length === 1, 'the preview’s hold');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => void document.dispatchEvent(new Event('visibilitychange'))); // the window hid: the body stays mounted
    expect(visibility().at(-1)).toBe(false);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(previewed().map((hold) => hold.released)).toEqual([false]);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    m.unmount(); // its tab went inactive: the pane unmounts the body
    await until(() => previewed()[0]!.released, 'the preview’s hold let go');
    previewed()[0]!.lose(); // a host restart afterwards
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(previewed()).toHaveLength(1); // nothing taken again
  });

  it('an open sheet loses its live controls while a history preview or suggestion review runs, and gets them back (E3 M3 fix)', async () => {
    const m = mount();
    await until(() => document.querySelector('button.dash-source-label') !== null && surface.listeners.length > 0, 'the view');
    act(() => document.querySelector<HTMLButtonElement>('button.dash-source-label')!.click());
    const dialog = screen.getByRole('dialog');
    await until(() => within(dialog).queryByRole('button', { name: 'Revoke fixture · rows' }) !== null, 'the live controls');
    act(() => m.state.document.setPreviewing(true));
    expect(within(dialog).queryByRole('group', { name: 'Live query' })).toBeNull();
    expect(within(dialog).queryAllByRole('button', { name: /Allow|Revoke|Refresh|Start/ })).toHaveLength(0);
    expect(within(dialog).getByText(/Live sales · fixture · rows · updated/)).toBeTruthy(); // the captured label stays
    act(() => m.state.document.setPreviewing(false));
    expect(within(dialog).getByRole('button', { name: 'Revoke fixture · rows' })).toBeTruthy();
  });
});
