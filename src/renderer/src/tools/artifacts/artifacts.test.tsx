// The panel's Artifacts tool (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5a; Decision Log 8, 15, 21a, 23, 25b)
// over a fake main: the session's list (its lineage's artifacts by kind) and All, "Open library", the record view
// mounting the kind's registered `Panel` with the tab's state and X32 scope, `markViewed` once per showing, the state
// given back on Back, on a re-target and when the instance goes, Move to tab, a kind with no editor yet, and a pinned
// tab following the shown session.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import type { LibraryFilter, LibraryRow } from '@shared/ipc/schema/library';
import { heldArtifactEditorState, registerArtifactEditor, resetArtifactEditors, type ArtifactEditorProps } from '../../artifacts/registry';
import { connectLibrary, resetLibrary, watchLibraryRow } from '../../library/store';
import { editorHostOf, registerEditorHost, useEditorHost, type EditorHostScope } from '../../panel/editor-host';
import { connectPanelHost, instanceOf, panelHost, registerPanelTool, resetPanelHost } from '../../panel/host';
import type { PanelToolContext } from '../../panel/tool';
import { persistLayout, useLayout } from '../../stores/layout';
import { activeTab, allTabs } from '../../stores/layout-model';
import { fail, installFakeMain, ok } from '../../test-support/code';
import { A, B, heldBridge, hydrateHeld, panelOf, persisted, resetPanelStores, TestHost } from '../../test-support/panel';
import { ARTIFACTS_TOOL_ID, artifactsTool, openArtifactInPanel, type ArtifactsHandle, type ArtifactsParams } from './ArtifactsTool';
import { ArtifactsSummary } from './Summary';
import { resetOpenRequests, useOpenRequest } from './viewers/requests';

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
// last edited by a session that never linked it (a side thread's write): main names it by its title (DL 27f)
const PAGE = row(2, { kind: 'html', title: 'Pricing page', lastEditor: { kind: 'session', appSessionId: 'app-side' as AppSessionId }, lastEditorTitle: 'Review the page' });
const DECK = row(3, { kind: 'presentation', title: 'Q3 deck' });
const SPEC = row(4, { title: 'Spec' });
const CSV = row(5, { kind: 'file', title: 'data.csv' });
const OTHER = row(6, { title: 'Other session’s doc', sessions: [{ appSessionId: B, title: 'Other work', roles: ['created'], lastAt: NOW }] });

// happy-dom has no layout: the list's scroller gets a viewport (tall enough for every fixture unless a test shrinks it)
// so the virtualiser mounts its lines, and every line a height, which the virtualiser measures it by (as
// library/Library.test.tsx gives them).
let viewport = 4000;
const LINE = 48;
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-artifacts-list')) return viewport;
      return this.hasAttribute('data-index') ? LINE : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

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
    if (name === 'layout.get') return ok({ value: null }); // nothing persisted: the panel's Summary reads its sections
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
  it('shows the session’s lineage grouped by kind in the kinds’ order, newest first, each row with its title and session relationship', async () => {
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
    expect(rowOf(1).textContent).toContain('Created');
    expect(rowOf(1).textContent).not.toContain('by You');
    expect(rowOf(2).textContent).toContain('Created');
  });


  it('keeps read-only context distinct from the session’s edits, while All preserves real human authorship', async () => {
    rows = [row(1, { sessions: [{ appSessionId: A, title: 'Agent', roles: ['viewed'], lastAt: NOW }] }),
      row(2, { sessions: [{ appSessionId: A, title: 'Agent', roles: ['edited', 'viewed'], lastAt: NOW }] })];
    await mount();
    expect(rowOf(1).textContent).toContain('Read');
    expect(rowOf(2).textContent).toContain('Edited');
    expect(rowOf(1).textContent).not.toContain('You');
    fireEvent.click(button('All')!);
    await settle();
    expect(rowOf(1).textContent).toMatch(/Edited .+ by You/);
  });

  it('All suppresses installation attribution only, keeping built-in provenance alongside genuine edits', async () => {
    rows = [row(1, { kind: 'design_system', builtIn: true, seedOnly: true }),
      row(2, { kind: 'design_system', builtIn: true }),
      row(3, { kind: 'design_system', builtIn: true, lastEditor: { kind: 'session', appSessionId: B }, lastEditorTitle: 'Improve house' })];
    await mount();
    fireEvent.click(button('All')!);
    await settle();
    expect(rowOf(1).textContent).toContain('Built in');
    expect(rowOf(1).textContent).not.toContain('by You');
    expect(rowOf(2).textContent).toMatch(/Built in.*Edited .+ by You/);
    expect(rowOf(3).textContent).toMatch(/Built in.*Edited .+ by Improve house/);
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

  it('a refused refresh keeps the rows and says so, with Try again', async () => {
    await mount();
    expect(listed()).toHaveLength(5);
    main = installFakeMain((name) => (name === 'library.list' ? fail('index unavailable') : fail(`unexpected ${name}`)));
    offs.push(connectLibrary());
    await act(async () => main.emit('library.changed', { revision: 2 }));
    await settle();
    expect(listed(), 'the last good rows stay').toHaveLength(5);
    expect(screen.getByRole('alert').textContent).toContain('index unavailable');
    installMain();
    fireEvent.click(button('Try again')!);
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(listed()).toHaveLength(5);
  });

  it('a scope change starts the list at its top', async () => {
    const { handle } = await mount();
    const list = document.querySelector<HTMLElement>('[data-artifacts-list]')!;
    list.scrollTop = 120;
    fireEvent.scroll(list);
    fireEvent.click(button('All')!);
    await settle();
    expect(document.querySelector<HTMLElement>('[data-artifacts-list]')!.scrollTop).toBe(0);
    expect(handle.snapshot().scrollTop).toBe(0);
  });

  // The list Back mounts again is put back where it was; a scope chosen after that is another list, which starts at its
  // top even when its lines arrive only after a reading (they mount afresh then, and must not be put back).
  it('a scope change after Back starts the list at its top, though its lines mount again once the scope is read', async () => {
    testEditor();
    const { handle } = await mount();
    const list = () => document.querySelector<HTMLElement>('[data-artifacts-list]')!;
    list().scrollTop = 120;
    fireEvent.scroll(list());
    await openRow(1);
    fireEvent.click(button('Back')!);
    await settle();
    expect(list().scrollTop, 'Back returns to where the list was').toBe(120);
    fireEvent.click(button('All')!); // a scope the library has not read yet: its lines wait for the reading
    expect(screen.getByText('Reading…')).toBeTruthy();
    await settle();
    expect(listed()).toContain(OTHER.id);
    expect(list().scrollTop).toBe(0);
    expect(handle.snapshot().scrollTop).toBe(0);
  });

  it('with no session shown, This session says so and All still lists', async () => {
    await mount(undefined, null);
    expect(screen.getByText('Open a session to see its artifacts')).toBeTruthy();
    expect(listFilters()).toEqual([]);
    fireEvent.click(button('All')!);
    await settle();
    expect(listed()).toHaveLength(6);
  });

  // P3-L's landing (debt): a library of thousands mounts only the lines near the view, as the Artifacts tab does; the
  // rows keep the kinds' order with their headings, every mounted row a tab stop in that order, the group at the top
  // keeps its heading pinned, and a row holding the keyboard stays mounted while the list scrolls away from it
  describe('a large library', () => {
    const DOCS = 1500;
    const DECKS = 1500;
    const scrollTo = async (top: number) => {
      const list = document.querySelector<HTMLElement>('[data-artifacts-list]')!;
      list.scrollTop = top;
      await act(async () => void list.dispatchEvent(new Event('scroll')));
    };
    // the expected order: documents newest first, then presentations
    const order = () => [...Array.from({ length: DOCS }, (_, i) => id(i + 1)), ...Array.from({ length: DECKS }, (_, i) => id(DOCS + i + 1))];
    beforeEach(() => {
      viewport = 300;
      rows = [
        ...Array.from({ length: DOCS }, (_, i) => row(i + 1, { title: `Note ${i + 1}` })),
        ...Array.from({ length: DECKS }, (_, i) => row(DOCS + i + 1, { kind: 'presentation', title: `Deck ${i + 1}` })),
      ];
    });
    afterEach(() => {
      viewport = 4000;
    });

    it('mounts a bounded number of rows, in the kinds’ order under their headings, wherever it is scrolled', async () => {
      await mount();
      await waitFor(() => expect(listed()[0]).toBe(id(1)));
      expect(listed().length).toBeLessThan(40);
      expect(listed()).toEqual(order().slice(0, listed().length)); // the first rows, in order
      expect(groups()).toEqual([['document', 'Documents']]);
      const tabStops = Array.from(document.querySelectorAll<HTMLElement>('[data-artifact-row]')).filter((r) => r.tabIndex === 0);
      expect(tabStops.map((r) => r.dataset.artifactId)).toEqual(listed()); // each row its own stop, in the list's order

      await scrollTo((DOCS + 100) * LINE); // among the presentations
      await waitFor(() => expect(listed()).not.toContain(id(1)));
      const shown = listed();
      expect(shown.length).toBeLessThan(40);
      const at = order().indexOf(shown[0]!);
      expect(at).toBeGreaterThan(DOCS);
      expect(shown).toEqual(order().slice(at, at + shown.length)); // a run of the list, in order
      expect(groups()).toEqual([['presentation', 'Presentations']]); // the group at the top keeps its heading
      expect(document.querySelector<HTMLElement>('[data-artifacts-group="presentation"]')!.className).toContain('sticky');
    });

    it('a row holding the keyboard stays mounted and focused while the list scrolls away from it', async () => {
      await mount();
      await waitFor(() => expect(listed()[0]).toBe(id(1)));
      const second = rowOf(2);
      act(() => second.focus());
      await scrollTo(1000 * LINE);
      await waitFor(() => expect(listed()).not.toContain(id(1)));
      expect(rowOf(2)).toBe(second);
      expect(document.activeElement).toBe(second);
    });
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

  // review sweep#1: a move asked while another waits on the guard supersedes it, so the guard's answer lands the latest
  // open (its version ask kept for its viewer); an open of the artifact shown withdraws the move waiting
  it('a newer move while the guard answers supersedes the older: the latest open lands, and an open of the shown one stays', async () => {
    const editor = testEditor({ guarded: true });
    const { handle } = await mount({ target: NOTES.id });
    await screen.findByText(`panel editor for ${NOTES.id} in panel:${TAB}`);
    function Asked() {
      const request = useOpenRequest(OTHER.id, 'panel');
      return <p data-asked="">{request === null ? 'none' : JSON.stringify(request.at)}</p>;
    }
    render(<Asked />);
    (editor.createState.mock.results[0]!.value as TestState).allowClose = true;
    act(() => {
      artifactsTool.open!(handle, { target: SPEC.id }); // waits on NOTES's guard
      artifactsTool.open!(handle, { target: OTHER.id, at: { version: 2 } }); // asked meanwhile
    });
    await screen.findByText(`panel editor for ${OTHER.id} in panel:${TAB}`);
    expect(editor.createState.mock.calls.map(([t]) => t.artifactId), 'the older move never landed').toEqual([NOTES.id, OTHER.id]);
    expect(document.querySelector('[data-asked]')!.textContent).toBe('{"version":2}');

    (editor.createState.mock.results[1]!.value as TestState).allowClose = true;
    act(() => {
      artifactsTool.open!(handle, { target: SPEC.id }); // waits on OTHER's guard
      artifactsTool.open!(handle, { target: OTHER.id }); // the artifact shown
    });
    await settle();
    expect(handle.snapshot().view).toEqual({ kind: 'record', artifactId: OTHER.id });
    expect(editor.createState).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-asked]')!.textContent).toBe('"latest"');
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

// P4-B3 (M3; its Decision Log 22, tracker row 290): the record a tab shows is its persisted params (`{target}`, none for
// the list), read back by a restored tab, so the tab shows the same record after a relaunch, pinned or a session's.
describe('restore', () => {
  const paramsOf = (tabId: string) => useLayout.getState().panelParams[tabId];

  it('writes the record it shows as its tab’s params, and none at Back, on a re-target to the list and when the instance goes', async () => {
    testEditor();
    const { handle } = await mount();
    expect(paramsOf(TAB)).toBeUndefined();
    await openRow(1);
    expect(paramsOf(TAB)).toEqual({ target: NOTES.id });
    act(() => handle.open({ target: SPEC.id }));
    await settle();
    expect(paramsOf(TAB)).toEqual({ target: SPEC.id });
    fireEvent.click(button('Back')!);
    await settle();
    expect(paramsOf(TAB)).toBeUndefined();
    await openRow(1);
    act(() => handle.open(undefined));
    await settle();
    expect(paramsOf(TAB)).toBeUndefined();
    await openRow(1);
    artifactsTool.dispose(handle);
    expect(paramsOf(TAB)).toBeUndefined();
  });

  it('a restored tab shows the record its params name; params it cannot read show the list', async () => {
    testEditor();
    const restore = (params: unknown) => {
      const handle = artifactsTool.createState({ appSessionId: A, session: null, instanceId: TAB, params: params as ArtifactsParams, restored: true });
      handles.push(handle);
      return handle.snapshot().view;
    };
    expect(restore({ target: NOTES.id })).toEqual({ kind: 'record', artifactId: NOTES.id });
    for (const unreadable of [undefined, null, 'x', 7, [], {}, { target: 7 }, { target: '' }, { target: null }]) expect(restore(unreadable), JSON.stringify(unreadable)).toEqual({ kind: 'list' });
  });

  // A launch over layout.json as the last one left it: the host forgets its instances (nothing is disposed at a quit),
  // the layout store reads the keys back, the host passes its barrier and the panel draws.
  async function launch(layoutJson: Record<string, unknown>) {
    cleanup();
    resetPanelHost();
    useLayout.setState({ hydrated: false, regions: LAYOUT_DEFAULTS.regions, main: LAYOUT_DEFAULTS.main, panelPinned: [], panelBySession: new Map(), panelActiveNoSession: null, panelParams: {} });
    const bridge = heldBridge(layoutJson);
    offs.push(persistLayout(bridge.client), connectPanelHost());
    registerPanelTool(artifactsTool);
    await hydrateHeld(bridge);
    render(<TestHost />);
    await settle();
    const quit = () => offs.splice(0).forEach((off) => off()); // persistence flushes what is pending
    return { left: () => (quit(), { ...layoutJson, ...Object.fromEntries(bridge.sets.map((s) => [s.key, s.value])) }) };
  }
  const overview = () => document.querySelector('[role="tabpanel"][aria-label="Session overview"]');

  it.each([
    ['a pinned tab, with no session in view', null, LAYOUT_DEFAULTS.main],
    ['a session’s tab', A, persisted({})['main.tabs']],
  ])('%s shows the same record after a relaunch, never the Session overview or the list; after Back, the list', async (_, appSessionId, shown) => {
    testEditor();
    const first = await launch(persisted({ 'main.tabs': shown }));
    let tabId = '';
    act(() => void (tabId = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId, pin: appSessionId === null, params: { target: NOTES.id } })));
    await screen.findByText(`panel editor for ${NOTES.id} in panel:${tabId}`);

    const second = await launch(first.left());
    expect(overview()).toBeNull();
    expect(screen.getByText(`panel editor for ${NOTES.id} in panel:${tabId}`)).toBeTruthy();
    fireEvent.click(button('Back')!);
    await settle();

    await launch(second.left());
    expect(overview()).toBeNull();
    expect(document.querySelector('[data-artifacts-list]')).toBeTruthy();
    expect(screen.queryByText(/panel editor for/)).toBeNull();
  });
});

// M6b: a transcript row's Open (`TranscriptActions.openArtifact`): the tool in the row's session on the artifact, the
// version the row names asked of the panel's viewer of it; nothing while no build registers the tool. Fix wave 2: every
// open asks (the latest when it names none), the next open supersedes, and an open the guard refused cancels its own.
describe('openArtifactInPanel (M6b)', () => {
  beforeEach(() => resetOpenRequests()); // every open asks, the earlier cases' too
  afterEach(() => resetOpenRequests());
  function Request() {
    const request = useOpenRequest(NOTES.id, 'panel');
    return <p data-request="">{request === null ? 'none' : JSON.stringify(request.at)}</p>;
  }
  const asked = () => document.querySelector('[data-request]')!.textContent;

  it('does nothing while no build registers the tool; opens the tool on the artifact and asks its panel viewer for the version; a version-less open asks for the latest', async () => {
    render(<Request />);
    openArtifactInPanel(A, NOTES.id, { version: 2 });
    expect(panelOf(A)?.tabs ?? []).toEqual([]);
    expect(asked()).toBe('none');
    registerPanelTool(artifactsTool);
    act(() => openArtifactInPanel(B, NOTES.id, { version: 2 }));
    expect(panelOf(B)!.tabs.map((tab) => tab.toolId)).toEqual([ARTIFACTS_TOOL_ID]);
    expect(asked()).toBe('{"version":2}');
    act(() => openArtifactInPanel(B, NOTES.id)); // no version: the latest, superseding the v2 ask
    expect(asked()).toBe('"latest"');
    act(() => openArtifactInPanel(B, NOTES.id, { revision: 7 }));
    expect(asked()).toBe('{"revision":7}');
  });

  // P4-B4: a link's place rides the same ask, to the editor of the artifact on that surface, whether the tab is opening
  // on it or already shows it; a later plain open supersedes it
  it('asks for the place a link names, beside the version, also of a tab already showing the artifact', () => {
    function Place() {
      const request = useOpenRequest(NOTES.id, 'panel');
      return <p data-place="">{request === null ? 'none' : JSON.stringify([request.at, request.location ?? null])}</p>;
    }
    const place = () => document.querySelector('[data-place]')!.textContent;
    render(<Place />);
    registerPanelTool(artifactsTool);
    act(() => openArtifactInPanel(B, NOTES.id, undefined, { tab: 't2', block: 'b7' }));
    expect(place()).toBe('["latest",{"tab":"t2","block":"b7"}]');
    act(() => openArtifactInPanel(B, NOTES.id, undefined, { version: 4 })); // the same tab, already on the artifact
    expect(panelOf(B)!.tabs).toHaveLength(1);
    expect(place()).toBe('["latest",{"version":4}]');
    act(() => openArtifactInPanel(B, NOTES.id));
    expect(place()).toBe('["latest",null]');
  });

  it('cancels the ask of an open the shown artifact’s guard refused', async () => {
    render(<Request />);
    registerPanelTool(artifactsTool);
    act(() => openArtifactInPanel(B, OTHER.id));
    const scope: EditorHostScope = { surface: 'panel', tabId: panelOf(B)!.tabs[0]!.id };
    act(() => void registerEditorHost(scope, { title: 'Other', closeGuard: async () => false }));
    act(() => openArtifactInPanel(B, NOTES.id, { version: 2 }));
    expect(asked()).toBe('{"version":2}');
    await waitFor(() => expect(asked()).toBe('none'));
  });
});

// M6b: the panel summary's Artifacts section (E2's Deliverables section's place): the session's lineage's count and
// latest title, else that nothing was made, else the refusal; Open opens the tool on its list.
describe('the summary (M6b)', () => {
  it('counts the session’s artifacts and names the latest; Open opens the list', async () => {
    const open = vi.fn();
    render(<ArtifactsSummary appSessionId={A} open={open} />);
    await settle();
    expect(document.querySelector('[data-summary="artifacts"]')!.textContent).toContain('5 artifacts · Launch notes');
    expect(listFilters()).toContainEqual({ appSessionId: A, lineage: true });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(open).toHaveBeenCalledWith();
  });

  it('says when nothing was made yet, and when the index refused', async () => {
    rows = [];
    const view = render(<ArtifactsSummary appSessionId={A} open={() => {}} />);
    await settle();
    expect(screen.getByText('Nothing made yet')).toBeTruthy();
    view.unmount();
    resetLibrary();
    main = installFakeMain((name) => (name === 'library.list' ? fail('index unavailable') : fail(`unexpected ${name}`)));
    render(<ArtifactsSummary appSessionId={A} open={() => {}} />);
    await settle();
    expect(screen.getByText('Couldn’t read the artifacts: index unavailable')).toBeTruthy();
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

  // P3-F wave S (F16, obs 7a): the record bar's button moves the artifact to a main tab of its own. P4-B3 (X38; its
  // Decision Log 19, 21): "Move to tab" (it was "Open in tab"), its editor's state going with it, so its guard has nothing
  // to ask; the move's rows are the transfer's (shell/transfer.test.ts).
  it('Move to tab moves the artifact to a main tab with its editor’s state, asking no guard: the record goes Back', async () => {
    const editor = testEditor({ guarded: true }); // a guard that would keep it
    registerPanelTool(artifactsTool);
    render(<TestHost />);
    let tabId = '';
    act(() => void (tabId = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: A, params: { target: NOTES.id } })));
    await screen.findByText(`panel editor for ${NOTES.id} in panel:${tabId}`);
    expect(button('Open in tab'), 'renamed').toBeNull();
    fireEvent.click(button('Move to tab')!);
    await settle();
    expect(allTabs(useLayout.getState().main).filter((t) => t.kind === 'artifact')).toMatchObject([{ artifactId: NOTES.id }]);
    expect((instanceOf(tabId)!.state as ArtifactsHandle).snapshot().view).toEqual({ kind: 'list' });
    expect(heldArtifactEditorState({ surface: 'main', tabId: `artifact:${NOTES.id}` })?.state).toBe(editor.createState.mock.results[0]!.value);
    expect(editor.createState).toHaveBeenCalledTimes(1);
    expect(editor.dispose).not.toHaveBeenCalled();
  });

  // While the tab is closing (from the host marking it closing, in the tick it asks the shown editor's guard, until the
  // close resolves) its record view is frozen: a Back or re-target asked meanwhile is dropped, and a move already waiting
  // on a guard does not land. So the guard the host asked is the only one the close needs, and no editor shown after it
  // asked can be disposed unasked.
  describe('while the tab is closing', () => {
    type GuardState = { artifactId: string };
    // Each artifact's guard answers at once with its `allow` entry, else when the test releases it (`answer`, in the
    // order it was asked).
    function guardedEditor() {
      const dispose = vi.fn();
      const createState = vi.fn(({ artifactId }: { artifactId: string }): GuardState => ({ artifactId }));
      const held = new Map<string, ((allowed: boolean) => void)[]>();
      const asked: string[] = [];
      const allow = new Map<string, boolean>();
      function Panel({ state, scope }: ArtifactEditorProps<GuardState>) {
        useEditorHost(scope, {
          title: state.artifactId,
          closeGuard: () => {
            asked.push(state.artifactId);
            const now = allow.get(state.artifactId);
            if (now !== undefined) return Promise.resolve(now);
            return new Promise<boolean>((resolve) => held.set(state.artifactId, [...(held.get(state.artifactId) ?? []), resolve]));
          },
        });
        return <p>editing {state.artifactId}</p>;
      }
      registerArtifactEditor('document', { Panel, createState, dispose });
      const answer = async (artifactId: string, allowed: boolean) => {
        const resolve = held.get(artifactId)!.shift()!;
        await act(async () => resolve(allowed));
      };
      return { dispose, createState, asked, allow, answer };
    }

    async function opened(target: string) {
      registerPanelTool(artifactsTool);
      render(<TestHost />);
      let tabId = '';
      act(() => void (tabId = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: A, params: { target } })));
      await screen.findByText(`editing ${target}`);
      return tabId;
    }
    const retarget = (target?: string) => act(() => void panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: A, params: { target } }));

    // The review's three-artifact interleaving (its rendered, cached probe): re-targets to a second and a third artifact
    // (the third's row already in the library store, so it would mount at once) while the first's guard answers.
    it('drops a re-target asked during the close; the close disposes only the artifact its guard was asked about', async () => {
      const editor = guardedEditor();
      const third = row(7, { title: 'Third' });
      rows = [...rows, third];
      const unwatch = watchLibraryRow(third.id);
      await settle();
      unwatch();
      const tabId = await opened(NOTES.id);
      editor.allow.set(SPEC.id, true);
      editor.allow.set(third.id, false);

      let closed!: Promise<boolean>;
      act(() => void (closed = panelHost.closeTab(tabId))); // NOTES's guard is still answering
      retarget(SPEC.id);
      retarget(third.id);
      retarget(); // Back to the list
      await settle();
      expect(screen.getByText(`editing ${NOTES.id}`), 'the record view stayed').toBeTruthy();
      await editor.answer(NOTES.id, true);
      expect(await closed).toBe(true);
      expect(editor.createState.mock.calls.map(([t]) => t.artifactId), 'no other editor was made').toEqual([NOTES.id]);
      expect(editor.dispose.mock.calls.map(([state]) => state.artifactId)).toEqual([NOTES.id]);
      expect(editor.asked, 'the host asked one guard, once').toEqual([NOTES.id]);
      expect(panelOf(A)!.tabs).toEqual([]);
    });

    it('a move already waiting on its guard when the close begins does not land, even once allowed', async () => {
      const editor = guardedEditor();
      const tabId = await opened(NOTES.id);
      editor.allow.set(SPEC.id, false);
      retarget(SPEC.id); // asks NOTES's guard, held
      let closed!: Promise<boolean>;
      act(() => void (closed = panelHost.closeTab(tabId))); // asks it again, held too
      expect(editor.asked).toEqual([NOTES.id, NOTES.id]);
      await editor.answer(NOTES.id, true); // the re-target's answer
      await settle();
      expect(screen.getByText(`editing ${NOTES.id}`), 'the re-target stayed frozen').toBeTruthy();
      await editor.answer(NOTES.id, true); // the close's
      expect(await closed).toBe(true);
      expect(editor.createState.mock.calls.map(([t]) => t.artifactId)).toEqual([NOTES.id]);
      expect(editor.dispose.mock.calls.map(([state]) => state.artifactId)).toEqual([NOTES.id]);
    });

    it('a vetoed close thaws the record view: the next re-target asks its guard and lands; the dropped one is not replayed', async () => {
      const editor = guardedEditor();
      const tabId = await opened(NOTES.id);
      let closed!: Promise<boolean>;
      act(() => void (closed = panelHost.closeTab(tabId)));
      retarget(SPEC.id); // dropped
      await editor.answer(NOTES.id, false);
      expect(await closed).toBe(false);
      await settle();
      expect(screen.getByText(`editing ${NOTES.id}`)).toBeTruthy();
      expect(editor.asked).toEqual([NOTES.id]);

      editor.allow.set(NOTES.id, true);
      retarget(SPEC.id);
      await screen.findByText(`editing ${SPEC.id}`);
      expect(editor.dispose.mock.calls.map(([state]) => state.artifactId)).toEqual([NOTES.id]);
      expect(panelOf(A)!.tabs.map((t) => t.id)).toEqual([tabId]);
    });
  });
});
