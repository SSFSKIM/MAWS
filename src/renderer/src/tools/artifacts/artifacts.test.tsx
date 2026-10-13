// The panel's Artifacts tool (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5a; Decision Log 8, 15, 21a, 23, 25b)
// over a fake main: the session's list (its lineage's artifacts by kind) and All, "Open library", the record view
// mounting the kind's registered `Panel` with the tab's state and X32 scope, `markViewed` once per showing, the state
// given back on Back, on a re-target and when the instance goes, Open in tab, a kind with no editor yet, and a pinned
// tab following the shown session.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryFilter, LibraryRow } from '@shared/ipc/schema/library';
import { registerArtifactEditor, resetArtifactEditors, type ArtifactEditorProps } from '../../artifacts/registry';
import { connectLibrary, resetLibrary } from '../../library/store';
import { editorHostOf, useEditorHost, type EditorHostScope } from '../../panel/editor-host';
import { panelHost, registerPanelTool } from '../../panel/host';
import type { PanelToolContext } from '../../panel/tool';
import { useLayout } from '../../stores/layout';
import { activeTab, allTabs } from '../../stores/layout-model';
import { fail, installFakeMain, ok } from '../../test-support/code';
import { A, B, panelOf, resetPanelStores, TestHost } from '../../test-support/panel';
import { ARTIFACTS_TOOL_ID, artifactsTool, type ArtifactsHandle, type ArtifactsParams } from './ArtifactsTool';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.now();
const MIN = 60_000;

function row(n: number, over: Partial<LibraryRow> = {}): LibraryRow {
  return {
    id: id(n),
    kind: 'document',
    title: `Artifact ${n}`,
    createdBy: { kind: 'human' },
    createdAt: NOW - 60 * MIN,
    updatedAt: NOW - n * MIN,
    lastViewedAt: null,
    pinned: false,
    agentEditsAsSuggestions: false,
    revision: 1,
    lastEditor: { kind: 'human' },
    lastEditedAt: NOW - n * MIN,
    sessions: [{ appSessionId: A, title: 'Fix the dashboard', roles: ['created'], lastAt: NOW - n * MIN }],
    ...over,
  };
}

const NOTES = row(1, { title: 'Launch notes' });
const PAGE = row(2, { kind: 'html', title: 'Pricing page', lastEditor: { kind: 'session', appSessionId: A } });
const DECK = row(3, { kind: 'presentation', title: 'Q3 deck' });
const SPEC = row(4, { title: 'Spec' });
const CSV = row(5, { kind: 'file', title: 'data.csv' });
const OTHER = row(6, { title: 'Other session’s doc', sessions: [{ appSessionId: B, title: 'Other work', roles: ['created'], lastAt: NOW }] });

let rows: LibraryRow[];
let main: ReturnType<typeof installFakeMain>;
const offs: (() => void)[] = [];

// Main's index: a session filter keeps the rows linked to that session (the lineage is the session itself here).
function installMain() {
  main = installFakeMain((name, input) => {
    if (name === 'library.list') {
      const filter = (input.filter ?? {}) as LibraryFilter;
      const listed = filter.appSessionId === undefined ? rows : rows.filter((r) => r.sessions.some((s) => s.appSessionId === filter.appSessionId));
      return ok({ rows: listed, counts: Object.fromEntries(ARTIFACT_KINDS.map((k) => [k, listed.filter((r) => r.kind === k).length])) });
    }
    if (name === 'library.get') return ok({ row: rows.find((r) => r.id === input.artifactId) ?? null });
    if (name === 'artifacts.get') return ok({ artifact: null });
    if (name === 'artifacts.markViewed') return ok();
    if (name === 'layout.set') return ok();
    return fail(`unexpected ${name}`);
  });
}

beforeEach(() => {
  resetPanelStores();
  resetArtifactEditors();
  resetLibrary();
  rows = [NOTES, PAGE, DECK, SPEC, CSV, OTHER];
  installMain();
  offs.push(connectLibrary());
});

const handles: ArtifactsHandle[] = [];
afterEach(() => {
  cleanup();
  handles.splice(0).forEach((handle) => artifactsTool.dispose(handle));
  offs.splice(0).forEach((off) => off());
});

const TAB = 'artifacts:test';
const SCOPE: EditorHostScope = { surface: 'panel', tabId: TAB };

const create = (params?: ArtifactsParams, appSessionId: AppSessionId | null = A) => {
  const handle = artifactsTool.createState({ appSessionId, session: null, instanceId: TAB, params: params as ArtifactsParams });
  handles.push(handle);
  return handle;
};

function Mounted({ state, appSessionId = A, visible = true }: { state: ArtifactsHandle; appSessionId?: AppSessionId | null; visible?: boolean }) {
  const ctx: PanelToolContext = {
    appSessionId, session: null, status: null, pinned: false, visible, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: panelHost.addTool,
    editorHost: SCOPE,
  };
  const Body = artifactsTool.render;
  return <Body state={state} ctx={ctx} />;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function mount(params?: ArtifactsParams, appSessionId: AppSessionId | null = A) {
  const handle = create(params, appSessionId);
  const view = render(<Mounted state={handle} appSessionId={appSessionId} />);
  await settle();
  return { handle, view };
}

const groups = () => Array.from(document.querySelectorAll<HTMLElement>('[data-artifacts-group]')).map((g) => [g.dataset.artifactsGroup, g.querySelector('h3')?.textContent]);
const listed = () => Array.from(document.querySelectorAll<HTMLElement>('[data-artifact-row]')).map((r) => r.dataset.artifactId);
const rowOf = (n: number) => document.querySelector<HTMLElement>(`[data-artifact-row][data-artifact-id="${id(n)}"]`)!;
const button = (name: string) => screen.queryByRole('button', { name });
const listFilters = () => main.callsOf('library.list').map((c) => c.filter);

async function openRow(n: number) {
  fireEvent.click(rowOf(n));
  await settle();
}

// A test editor for documents whose header (and, when guarded, closeGuard) read the state its tab owns, and which says
// its content is on screen at mount.
type TestState = { artifactId: string; surface: string; allowClose: boolean };
function testEditor({ guarded = false } = {}) {
  const createState = vi.fn(({ artifactId, surface }: { artifactId: string; surface: string }): TestState => ({ artifactId, surface, allowClose: false }));
  const dispose = vi.fn();
  function Panel({ artifactId, state, scope, visible, onShown }: ArtifactEditorProps<TestState>) {
    useEditorHost(scope, { title: `Editing ${artifactId.slice(-1)}`, saved: 'saved', closeGuard: guarded ? async () => state.allowClose : undefined });
    useEffect(() => onShown(), [onShown]);
    return (
      <p data-visible={String(visible)}>
        panel editor for {state.artifactId} in {scope.surface}:{scope.tabId}
      </p>
    );
  }
  const Main = () => <p>main editor</p>;
  const editor = { Panel, Main, createState, dispose };
  registerArtifactEditor('document', editor);
  return editor;
}

describe('the list', () => {
  it('shows the session’s lineage grouped by kind in the kinds’ order, newest first, each row with its title and last edit', async () => {
    await mount();
    expect(listFilters()).toEqual([{ appSessionId: A, lineage: true }]);
    expect(groups()).toEqual([
      ['document', 'Documents'],
      ['presentation', 'Presentations'],
      ['html', 'HTML pages'],
      ['file', 'Files'],
    ]);
    expect(listed()).toEqual([NOTES.id, SPEC.id, DECK.id, PAGE.id, CSV.id]);
    expect(rowOf(1).textContent).toContain('Launch notes');
    expect(rowOf(1).textContent).toMatch(/Edited .+ by You/);
    expect(rowOf(2).textContent).toMatch(/Edited .+ by Fix the dashboard/);
  });

  it('All lists every artifact in the library, and This session returns to the session’s', async () => {
    await mount();
    fireEvent.click(button('All')!);
    await settle();
    expect(listFilters().at(-1)).toEqual({});
    expect(button('All')!.getAttribute('aria-pressed')).toBe('true');
    expect(listed()).toContain(OTHER.id);
    fireEvent.click(button('This session')!);
    await settle();
    expect(listed()).not.toContain(OTHER.id);
  });

  it('a library change reads the list again', async () => {
    await mount();
    rows = [...rows, row(7, { title: 'Fresh' })];
    await act(async () => main.emit('library.changed', { revision: 2 }));
    await settle();
    expect(listed()).toContain(id(7));
  });

  it('says what puts artifacts here when the session has none', async () => {
    rows = [OTHER];
    await mount();
    expect(screen.getByText(/Nothing made in this session yet/)).toBeTruthy();
  });

  it('a refused read shows with Try again, which reads again', async () => {
    main = installFakeMain((name) => (name === 'library.list' ? fail('index unavailable') : fail(`unexpected ${name}`)));
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('index unavailable');
    installMain();
    fireEvent.click(button('Try again')!);
    await settle();
    expect(listed()).toHaveLength(5);
  });

  it('with no session shown, This session says so and All still lists', async () => {
    await mount(undefined, null);
    expect(screen.getByText('Open a session to see its artifacts')).toBeTruthy();
    expect(listFilters()).toEqual([]);
    fireEvent.click(button('All')!);
    await settle();
    expect(listed()).toHaveLength(6);
  });

  it('Open library opens the Artifacts main tab', async () => {
    await mount();
    fireEvent.click(button('Open library')!);
    expect(activeTab(useLayout.getState().main)?.kind).toBe('artifacts');
  });
});

describe('the record view', () => {
  it('mounts the kind’s Panel with the tab’s state and scope, records the view once, and Back gives the state and header back', async () => {
    const editor = testEditor();
    const { handle } = await mount();
    const list = document.querySelector<HTMLElement>('[data-artifacts-list]')!;
    list.scrollTop = 80;
    fireEvent.scroll(list);
    await openRow(1);
    expect(screen.getByText(`panel editor for ${NOTES.id} in panel:${TAB}`)).toBeTruthy();
    expect(editor.createState).toHaveBeenCalledTimes(1);
    expect(editor.createState).toHaveBeenCalledWith({ artifactId: NOTES.id, kind: 'document', surface: 'panel' });
    expect(editorHostOf(SCOPE)?.title).toBe('Editing 1');
    await waitFor(() => expect(main.callsOf('artifacts.markViewed')).toEqual([{ artifactId: NOTES.id }]));
    expect(handle.snapshot().view).toEqual({ kind: 'record', artifactId: NOTES.id });

    fireEvent.click(button('Back')!);
    await settle();
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(editor.dispose).toHaveBeenCalledWith(editor.createState.mock.results[0]!.value);
    expect(editorHostOf(SCOPE), 'the list shows the tool’s own label').toBeNull();
    expect(document.querySelector<HTMLElement>('[data-artifacts-list]')!.scrollTop, 'where the list was').toBe(80);

    // shown again: a new showing, a new state, another view recorded
    await openRow(1);
    expect(editor.createState).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(main.callsOf('artifacts.markViewed')).toHaveLength(2));
  });

  it('the body unmounting while the tab is hidden keeps the state and the one view', async () => {
    const editor = testEditor();
    const handle = create({ target: NOTES.id });
    const view = render(<Mounted state={handle} />);
    await screen.findByText(/panel editor for/);
    view.unmount();
    render(<Mounted state={handle} />);
    await screen.findByText(/panel editor for/);
    await settle();
    expect(editor.createState).toHaveBeenCalledTimes(1);
    expect(editor.dispose).not.toHaveBeenCalled();
    expect(main.callsOf('artifacts.markViewed')).toHaveLength(1);
  });

  it('a re-target to another artifact gives the first one’s state back; to the same one keeps it; to none shows the list', async () => {
    const editor = testEditor();
    const { handle } = await mount({ target: NOTES.id });
    await screen.findByText(`panel editor for ${NOTES.id} in panel:${TAB}`);
    act(() => artifactsTool.open!(handle, { target: NOTES.id }));
    await settle();
    expect(editor.createState).toHaveBeenCalledTimes(1);
    expect(editor.dispose).not.toHaveBeenCalled();

    act(() => artifactsTool.open!(handle, { target: SPEC.id }));
    await screen.findByText(`panel editor for ${SPEC.id} in panel:${TAB}`);
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(editor.createState).toHaveBeenLastCalledWith({ artifactId: SPEC.id, kind: 'document', surface: 'panel' });
    expect(editorHostOf(SCOPE)?.title).toBe('Editing 4');

    act(() => artifactsTool.open!(handle, {}));
    await settle();
    expect(editor.dispose).toHaveBeenCalledTimes(2);
    expect(listed().length).toBeGreaterThan(0);
  });

  it('a re-target while the tab is hidden gives the state and the header back at once', async () => {
    const editor = testEditor();
    const handle = create({ target: NOTES.id });
    const view = render(<Mounted state={handle} />);
    await screen.findByText(/panel editor for/);
    view.unmount();
    act(() => artifactsTool.open!(handle, { target: PAGE.id }));
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(editorHostOf(SCOPE)).toBeNull();
  });

  it('Back and a re-target ask the editor’s closeGuard first: false keeps the record view and its state', async () => {
    const editor = testEditor({ guarded: true });
    const { handle } = await mount({ target: NOTES.id });
    await screen.findByText(`panel editor for ${NOTES.id} in panel:${TAB}`);
    const state = editor.createState.mock.results[0]!.value as TestState;

    fireEvent.click(button('Back')!);
    await settle();
    expect(handle.snapshot().view, 'the guard kept it').toEqual({ kind: 'record', artifactId: NOTES.id });
    act(() => artifactsTool.open!(handle, { target: SPEC.id }));
    await settle();
    expect(handle.snapshot().view).toEqual({ kind: 'record', artifactId: NOTES.id });
    expect(editor.dispose).not.toHaveBeenCalled();
    expect(editorHostOf(SCOPE)?.title).toBe('Editing 1');

    state.allowClose = true;
    act(() => artifactsTool.open!(handle, { target: SPEC.id }));
    await screen.findByText(`panel editor for ${SPEC.id} in panel:${TAB}`);
    expect(editor.dispose).toHaveBeenCalledWith(state);
    const next = editor.createState.mock.results[1]!.value as TestState;
    next.allowClose = true;
    fireEvent.click(button('Back')!);
    await settle();
    expect(editor.dispose).toHaveBeenCalledTimes(2);
    expect(listed()).toHaveLength(5);
  });

  it('a guarded move the view left meanwhile, or a disposed instance, does not apply', async () => {
    const editor = testEditor({ guarded: true });
    const { handle } = await mount({ target: NOTES.id });
    await screen.findByText(/panel editor for/);
    (editor.createState.mock.results[0]!.value as TestState).allowClose = true;
    act(() => {
      handle.back(); // asked, pending
      artifactsTool.dispose(handle); // the tab closed meanwhile
    });
    await settle();
    expect(handle.snapshot().view, 'nothing moves after disposal').toEqual({ kind: 'record', artifactId: NOTES.id });
    expect(editor.dispose).toHaveBeenCalledTimes(1);
  });

  it('the editor is told whether the panel shows it', async () => {
    testEditor();
    const handle = create({ target: NOTES.id });
    const view = render(<Mounted state={handle} />);
    expect((await screen.findByText(/panel editor for/)).dataset.visible).toBe('true');
    view.rerender(<Mounted state={handle} visible={false} />);
    expect(screen.getByText(/panel editor for/).dataset.visible).toBe('false');
  });

  it('disposing the instance gives the state back', async () => {
    const editor = testEditor();
    const { handle } = await mount({ target: NOTES.id });
    await screen.findByText(/panel editor for/);
    artifactsTool.dispose(handle);
    expect(editor.dispose).toHaveBeenCalledTimes(1);
  });

  it('a kind with no editor yet says so with the row’s facts and records no view', async () => {
    testEditor();
    await mount();
    await openRow(3);
    expect(await screen.findByText('No editor for presentations yet')).toBeTruthy();
    expect(document.querySelector('[data-artifact-facts]')!.textContent).toContain('Q3 deck');
    expect(editorHostOf(SCOPE)?.title).toBe('Q3 deck');
    expect(main.callsOf('artifacts.markViewed')).toEqual([]);
    fireEvent.click(button('Back')!);
    await settle();
    expect(editorHostOf(SCOPE)).toBeNull();
    expect(listed()).toHaveLength(5);
  });

  it('a gone artifact says so, with Back', async () => {
    testEditor();
    await mount({ target: id(99) });
    expect(await screen.findByText('This artifact was deleted, or it is not in the library.')).toBeTruthy();
    fireEvent.click(button('Back')!);
    await settle();
    expect(listed()).toHaveLength(5);
  });

  it('Open in tab opens the artifact in a main tab of its own', async () => {
    testEditor();
    await mount({ target: NOTES.id });
    await screen.findByText(/panel editor for/);
    fireEvent.click(button('Open in tab')!);
    expect(allTabs(useLayout.getState().main).find((t) => t.kind === 'artifact')).toMatchObject({ artifactId: NOTES.id });
  });

  it('a pinned tab keeps its record when the shown session changes; its list follows the session', async () => {
    testEditor();
    const handle = create({ target: NOTES.id });
    const view = render(<Mounted state={handle} />);
    await screen.findByText(/panel editor for/);
    view.rerender(<Mounted state={handle} appSessionId={B} />);
    await settle();
    expect(screen.getByText(/panel editor for/)).toBeTruthy();
    fireEvent.click(button('Back')!);
    await settle();
    expect(listFilters().at(-1)).toEqual({ appSessionId: B, lineage: true });
    expect(listed()).toEqual([OTHER.id]);
  });
});

describe('in the panel', () => {
  it('is offered as a single-instance, pinnable tool; the editor registers under the tab; closing the tab gives the state back', async () => {
    const editor = testEditor();
    registerPanelTool(artifactsTool);
    expect(artifactsTool).toMatchObject({ id: ARTIFACTS_TOOL_ID, title: 'Artifacts', pinnable: true, multiInstance: false });
    render(<TestHost />);
    let tabId = '';
    act(() => void (tabId = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: A, params: { target: NOTES.id } })));
    await screen.findByText(`panel editor for ${NOTES.id} in panel:${tabId}`);
    expect(editorHostOf({ surface: 'panel', tabId })?.title, 'the header the panel draws over the tab').toBe('Editing 1');
    // a second open re-targets the one tab
    act(() => void panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: A, params: { target: SPEC.id } }));
    await screen.findByText(`panel editor for ${SPEC.id} in panel:${tabId}`);
    expect(panelOf(A)!.tabs.map((t) => t.id)).toEqual([tabId]);
    await act(() => panelHost.closeTab(tabId));
    expect(editor.dispose).toHaveBeenCalledTimes(2);
    expect(editorHostOf({ surface: 'panel', tabId })).toBeNull();
  });
});
