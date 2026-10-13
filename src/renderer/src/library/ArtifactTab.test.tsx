// The `artifact` main tab (the P3-L execution document, M3; Decision Log 7, 15): the kind's registered editor mounted
// with the state it made for the tab and the tab's X32 scope; the editor's header registration drawn above it and its
// closeGuard holding a close; the state made once per tab and disposed when the tab closes; `markViewed` once per open;
// the row's title as the tab's label; a gone artifact's notice and a kind with no editor yet.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ArtifactRow } from '@shared/ipc/schema/artifacts';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { registerShellActions } from '../app/shell-actions';
import { Shell } from '../app/Shell';
import { resetSlots } from '../app/slots';
import { registerArtifactEditor, resetArtifactEditors, type ArtifactEditorProps } from '../artifacts/registry';
import { requestCloseTab } from '../keymap/actions-runtime';
import { editorHostOf, resetEditorHosts, useEditorHost } from '../panel/editor-host';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { installFakeMain, ok } from '../test-support/code';
import { resetShellStores } from '../test-support/shell-stores';
import { openArtifactTab } from './actions';
import { registerArtifactTabs } from './ArtifactTab';
import { connectLibrary, resetLibrary } from './store';

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const A = '00000000-0000-4000-8000-000000000001';
const S1 = 'app-s1' as AppSessionId;
const NOW = Date.now();

function row(over: Partial<LibraryRow> = {}): LibraryRow {
  return {
    id: A,
    kind: 'document',
    title: 'Launch notes',
    createdBy: { kind: 'human' },
    createdAt: NOW - 60 * 60_000,
    updatedAt: NOW - 60 * 60_000,
    lastViewedAt: null,
    pinned: false,
    agentEditsAsSuggestions: false,
    revision: 3,
    lastEditor: { kind: 'human' },
    lastEditedAt: NOW - 60 * 60_000,
    sessions: [],
    ...over,
  };
}

// What main answers for the artifact: the index's row (null once gone, or before the index has it) and the host's
// (`artifacts.get`, asked when the index has none); `markViewed` recorded.
let current: LibraryRow | null;
let onHost: ArtifactRow | null | 'refused';
const hostRow = (over: Partial<ArtifactRow> = {}): ArtifactRow => {
  const { lastEditor: _e, lastEditedAt: _t, sessions: _s, ...entity } = row();
  void [_e, _t, _s];
  return { ...entity, ...over };
};
let main: ReturnType<typeof installFakeMain>;
const offs: (() => void)[] = [];
const mainRegion = () => document.querySelector<HTMLElement>('[data-region="main"]')!;
const headerTitle = () => mainRegion().querySelector('[data-editor-header] [data-header-title]')?.textContent ?? null;
const LIBRARY_GONE = 'This artifact was deleted, or it is not in the library.';
const tabOpen = () => allTabs(useLayout.getState().main).some((t) => t.id === `artifact:${A}`);
const changed = async () => {
  await act(async () => main.emit('library.changed', { revision: 9 }));
};

beforeEach(() => {
  resetShellStores();
  resetEditorHosts();
  resetArtifactEditors();
  resetLibrary();
  current = row();
  onHost = null;
  main = installFakeMain((name) => {
    if (name === 'library.get') return ok({ row: current });
    if (name === 'artifacts.get') return onHost === 'refused' ? { ok: false, error: { code: 'host_unavailable', message: 'the engine host is restarting' } } : ok({ artifact: onHost });
    if (name === 'artifacts.markViewed') return ok();
    if (name === 'attention.request') return ok({ event: null });
    return new Promise(() => {});
  });
  offs.push(registerShellActions({ invoke: vi.fn(async () => ({ ok: true, value: undefined })), on: vi.fn(() => () => {}) } as unknown as MawsBridge));
  offs.push(connectLibrary());
  offs.push(registerArtifactTabs());
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
  resetSlots();
  offs.splice(0).forEach((off) => off());
});

// A test editor whose header and closeGuard read the state its tab owns.
type TestState = { allowClose: boolean; artifactId: string; surface: string };
function testEditor() {
  const createState = vi.fn(({ artifactId, surface }: { artifactId: string; surface: string }): TestState => ({ allowClose: false, artifactId, surface }));
  const dispose = vi.fn();
  function Main({ artifactId, state, scope, onShown }: ArtifactEditorProps<TestState>) {
    useEditorHost(scope, { title: `Editing ${artifactId.slice(-1)}`, saved: 'saved', closeGuard: async () => state.allowClose });
    useEffect(() => onShown(), [onShown]); // its content is on screen at mount
    return <p>main editor for {state.artifactId} in {scope.surface}:{scope.tabId}</p>;
  }
  const Panel = () => <p>panel editor</p>;
  return { Panel, Main, createState, dispose };
}

describe('an artifact in a main tab', () => {
  it('mounts the kind’s Main with its tab’s state and scope; the editor’s header shows; its closeGuard holds the close; the state goes with the tab', async () => {
    const editor = testEditor();
    registerArtifactEditor('document', editor);
    render(<Shell />);
    act(() => openArtifactTab(A));
    await screen.findByText(`main editor for ${A} in main:artifact:${A}`);
    expect(editor.createState).toHaveBeenCalledTimes(1);
    expect(editor.createState).toHaveBeenCalledWith({ artifactId: A, kind: 'document', surface: 'main' });
    expect(headerTitle()).toBe('Editing 1');
    expect(within(mainRegion()).getByRole('tab', { name: 'Launch notes' }), 'the row’s title labels the tab').toBeTruthy();
    expect(document.querySelector('[data-toolbar]')!.textContent).toContain('Launch notes');
    await waitFor(() => expect(main.callsOf('artifacts.markViewed')).toEqual([{ artifactId: A }]));

    // inactive and active again: the body remounts, the tab's state and its open stay one
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' }));
    expect(screen.queryByText(/main editor for/)).toBeNull();
    act(() => openArtifactTab(A));
    await screen.findByText(/main editor for/);
    expect(editor.createState).toHaveBeenCalledTimes(1);
    expect(main.callsOf('artifacts.markViewed'), 'once per open').toHaveLength(1);

    await act(() => requestCloseTab(`artifact:${A}`));
    expect(tabOpen(), 'the editor’s guard keeps the tab').toBe(true);
    expect(editor.dispose).not.toHaveBeenCalled();
    const state = editor.createState.mock.results[0].value as TestState;
    state.allowClose = true;
    await act(() => requestCloseTab(`artifact:${A}`));
    expect(tabOpen()).toBe(false);
    expect(editor.dispose).toHaveBeenCalledWith(state);
    expect(editorHostOf({ surface: 'main', tabId: `artifact:${A}` })).toBeNull();

    // opened again: a new open, a new state
    act(() => openArtifactTab(A));
    await screen.findByText(/main editor for/);
    expect(editor.createState).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(main.callsOf('artifacts.markViewed')).toHaveLength(2));
  });

  it('a session opened over it does not replace it while its editor says changes are not saved', async () => {
    let saved: 'saved' | 'unsaved' = 'unsaved';
    registerArtifactEditor('document', {
      Panel: function Unsaved({ scope }: ArtifactEditorProps) {
        useEditorHost(scope, { title: 'Launch notes', saved });
        return <p>editing</p>;
      },
    });
    render(<Shell />);
    act(() => openArtifactTab(A));
    await screen.findByText('editing');
    act(() => useLayout.getState().openSession('app-x' as AppSessionId));
    expect(tabOpen(), 'kept: the session opened beside it').toBe(true);
    expect(allTabs(useLayout.getState().main).map((t) => t.id)).toContain('session:app-x');
    expect(await screen.findByText('Launch notes has unsaved changes, so it stays open')).toBeTruthy();

    saved = 'saved';
    act(() => openArtifactTab(A));
    await screen.findByText('editing');
    act(() => useLayout.getState().openSession('app-y' as AppSessionId));
    expect(tabOpen(), 'saved: it gives its place').toBe(false);
  });

  it('tells the editor whether its tab is on screen: not while the panel takes the main column’s place', async () => {
    registerArtifactEditor('document', {
      Panel: ({ visible }: ArtifactEditorProps) => <p data-visible={String(visible)}>shown editor</p>,
    });
    render(<Shell />);
    act(() => openArtifactTab(A));
    expect((await screen.findByText('shown editor')).dataset.visible).toBe('true');
    const { regions } = useLayout.getState();
    act(() => useLayout.setState({ regions: { ...regions, panel: { ...regions.panel, collapsed: false, maximized: true } } }));
    expect(screen.getByText('shown editor').dataset.visible).toBe('false');
  });

  it('a kind registered with Panel alone mounts Panel in the main tab', async () => {
    const { Panel } = testEditor();
    registerArtifactEditor('document', { Panel });
    render(<Shell />);
    act(() => openArtifactTab(A));
    expect(await screen.findByText('panel editor')).toBeTruthy();
  });

  it('a kind with no editor yet says so quietly with the row’s facts, and mounts the editor once one registers', async () => {
    current = row({ kind: 'presentation', title: 'Q3 deck', lastEditor: { kind: 'session', appSessionId: 'app-s2' as AppSessionId }, lastEditorTitle: 'Deck reviewer', sessions: [{ appSessionId: S1, title: 'Deck builder', roles: ['created'], lastAt: NOW }], space: { id: '00000000-0000-4000-8000-000000000101', name: 'Research' }, project: { id: 'proj-1' as never, name: 'maws' } });
    render(<Shell />);
    act(() => openArtifactTab(A));
    expect(await screen.findByText('No editor for presentations yet')).toBeTruthy();
    const body = within(mainRegion()).getByRole('tabpanel');
    expect(body.textContent).toContain('Q3 deck');
    expect(body.textContent).toContain('Presentation');
    expect(body.textContent).toContain('in Research');
    expect(body.textContent).toContain('maws');
    expect(body.textContent).toMatch(/Edited .+ by Deck reviewer/); // an editor that never linked it, by its title (DL 27f)
    expect(main.callsOf('artifacts.markViewed'), 'nothing of the content was shown').toEqual([]);

    const editor = testEditor();
    act(() => void registerArtifactEditor('presentation', editor));
    expect(await screen.findByText(/main editor for/)).toBeTruthy();
    expect(headerTitle()).toBe('Editing 1');
  });

  it('a gone artifact shows the notice; deleted while open, its editor’s state and header go with it', async () => {
    const editor = testEditor();
    registerArtifactEditor('document', editor);
    render(<Shell />);
    act(() => openArtifactTab(A));
    await screen.findByText(/main editor for/);
    current = null;
    await changed();
    expect(await screen.findByText(LIBRARY_GONE)).toBeTruthy();
    expect(main.callsOf('artifacts.get'), 'the host confirms it is gone').toEqual([{ artifactId: A }]);
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(headerTitle(), 'the stale editor header is replaced').toBe('Artifact not found');
    expect(editorHostOf({ surface: 'main', tabId: `artifact:${A}` })?.closeGuard ?? null, 'no editor guard holds the tab now').toBeNull();
    await act(() => requestCloseTab(`artifact:${A}`));
    expect(tabOpen()).toBe(false);
    expect(editor.dispose).toHaveBeenCalledTimes(1);
  });

  it('an artifact the index has not caught up with (just created) opens from the host’s row, and stays mounted when the index has it', async () => {
    const editor = testEditor();
    registerArtifactEditor('document', editor);
    current = null;
    onHost = hostRow({ title: 'Untitled document' });
    render(<Shell />);
    act(() => openArtifactTab(A));
    expect(await screen.findByText(/main editor for/)).toBeTruthy();
    expect(main.callsOf('artifacts.get')).toEqual([{ artifactId: A }]);
    expect(screen.queryByText(LIBRARY_GONE)).toBeNull();
    current = row({ title: 'Untitled document' });
    await changed();
    expect(within(mainRegion()).getByRole('tab', { name: 'Untitled document' })).toBeTruthy();
    expect(screen.getByText(/main editor for/)).toBeTruthy();
    expect(editor.createState, 'one showing: the hold is the same').toHaveBeenCalledTimes(1);
    expect(editor.dispose).not.toHaveBeenCalled();
    expect(main.callsOf('artifacts.markViewed')).toHaveLength(1);
  });

  it('a view is recorded when the editor says its content is first on screen, once per showing, not while it loads', async () => {
    let shown: () => void = () => {};
    registerArtifactEditor('document', {
      Panel: function Loading({ onShown }: ArtifactEditorProps) {
        shown = onShown;
        return <p>loading</p>;
      },
    });
    render(<Shell />);
    act(() => openArtifactTab(A));
    await screen.findByText('loading');
    await act(async () => {});
    expect(main.callsOf('artifacts.markViewed'), 'still loading: no view').toEqual([]);
    await act(async () => {
      shown();
      shown();
    });
    expect(main.callsOf('artifacts.markViewed')).toEqual([{ artifactId: A }]);
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' }));
    act(() => openArtifactTab(A));
    await screen.findByText('loading');
    await act(async () => shown());
    expect(main.callsOf('artifacts.markViewed'), 'the same showing').toHaveLength(1);
  });

  it('a host that cannot answer is not a deletion: the editor, its state and its guard stay, with a quiet Retry; a confirmed absence then shows Gone', async () => {
    const editor = testEditor();
    registerArtifactEditor('document', editor);
    render(<Shell />);
    act(() => openArtifactTab(A));
    await screen.findByText(/main editor for/);
    current = null;
    onHost = 'refused';
    await changed();
    expect(await screen.findByText('Couldn’t confirm this artifact with its host: the engine host is restarting')).toBeTruthy();
    expect(screen.getByText(/main editor for/), 'still mounted').toBeTruthy();
    expect(editor.dispose).not.toHaveBeenCalled();
    expect(headerTitle()).toBe('Editing 1');
    await act(() => requestCloseTab(`artifact:${A}`));
    expect(tabOpen(), 'its closeGuard still holds the tab').toBe(true);

    onHost = null;
    await act(async () => screen.getByRole('button', { name: 'Try again' }).click());
    expect(await screen.findByText(LIBRARY_GONE)).toBeTruthy();
    expect(editor.dispose).toHaveBeenCalledTimes(1);
  });

  it('with no editor shown yet, a refused host read says so quietly and the next change asks again', async () => {
    const editor = testEditor();
    registerArtifactEditor('document', editor);
    current = null;
    onHost = 'refused';
    render(<Shell />);
    act(() => openArtifactTab(A));
    expect(await screen.findByText('Couldn’t confirm this artifact with its host: the engine host is restarting')).toBeTruthy();
    expect(screen.queryByText(LIBRARY_GONE)).toBeNull();
    expect(editor.createState).not.toHaveBeenCalled();
    onHost = hostRow();
    await changed();
    expect(await screen.findByText(/main editor for/)).toBeTruthy();
  });

  it('a failed first read says why and reads again on Try again', async () => {
    let refuse = true;
    main = installFakeMain((name) => {
      if (name === 'library.get') return refuse ? { ok: false, error: { code: 'internal', message: 'index unavailable' } } : ok({ row: current });
      if (name === 'attention.request') return ok({ event: null });
      return new Promise(() => {});
    });
    registerArtifactEditor('document', testEditor());
    render(<Shell />);
    act(() => openArtifactTab(A));
    expect(await screen.findByText('Couldn’t read this artifact: index unavailable')).toBeTruthy();
    refuse = false;
    act(() => screen.getByRole('button', { name: 'Try again' }).click());
    expect(await screen.findByText(/main editor for/)).toBeTruthy();
  });
});
