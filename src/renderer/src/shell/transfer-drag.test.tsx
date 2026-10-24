// Cross-surface transfer through its handlers (P4-B3 M4; X38; the prior art's Z1 to Z7, C1 to C3, INV-5 and M1 to M5):
// the main area and the panel rendered as the shell places them, the drags driven event by event, since Playwright's
// Electron drag cannot press Escape mid-drag (the prior art's live check 5). Each target accepts exactly the drags the
// shared refusal allows (an accepting `dragover` is prevented with `dropEffect = 'move'`; a refusing target never
// prevents it, so the cursor says no-drop), highlights the place the artifact will take with the outcome's label, and
// moves the artifact on drop; Escape, a release elsewhere or a source unmounting clears every drag state. Every drag
// holds the browser cover while it is on (P4-B3 Decision Log 39), so no page's native view lies over a target.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, tabId, type LayoutMain, type TabRef, type TabSet } from '@shared/ipc/schema/layout';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { registerShellActions } from '../app/shell-actions';
import { registerSlot, resetSlots } from '../app/slots';
import { registerArtifactEditor, resetArtifactEditors } from '../artifacts/registry';
import { queryClient } from '../ipc/query';
import { runAction } from '../keymap/actions-runtime';
import { connectLibrary, library, libraryRow, resetLibrary } from '../library/store';
import { MainArea } from '../main/MainArea';
import { SHOW_IN_PANEL_COPY } from '../main/Tab';
import { instanceOf, panelHost, registerPanelTool, usePanelHost } from '../panel/host';
import { PanelHost } from '../panel/PanelHost';
import { PanelRegion } from '../panel/PanelRegion';
import { useLayout } from '../stores/layout';
import { allTabs, currentSet } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { fail, installFakeMain, ok } from '../test-support/code';
import { A, panelOf, resetPanelStores, sessionTab } from '../test-support/panel';
import { ARTIFACTS_TOOL_ID, artifactsTool, type ArtifactsHandle } from '../tools/artifacts/ArtifactsTool';
import { TRANSFER_COPY } from '../tools/artifacts/copy';
import { coverPane, resetCovering } from '../tools/browser/covering';
import { PANEL_TAB_DRAG_TYPE, TAB_DRAG_TYPE } from './transfer';

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const DOC = '00000000-0000-4000-8000-000000000001';
const row = (id: string, title: string): LibraryRow => ({
  id, kind: 'document', title, createdBy: { kind: 'human' }, createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
  revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0, sessions: [],
});
const DOC_TAB: TabRef = { id: tabId({ kind: 'artifact', artifactId: DOC }), kind: 'artifact', artifactId: DOC, pinned: false };
const NOTES = '00000000-0000-4000-8000-000000000002';
const NOTES_TAB: TabRef = { id: tabId({ kind: 'artifact', artifactId: NOTES }), kind: 'artifact', artifactId: NOTES, pinned: false };
const panes = (...pieces: TabRef[][]): LayoutMain => ({
  ...LAYOUT_DEFAULTS.main,
  sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: pieces.map((tabs) => ({ tabs, activeTabId: tabs.at(-1)!.id })) as TabSet['panes'], focusedPane: 0 } },
});

// A DataTransfer as a drag carries it; happy-dom's own cannot be filled from a test.
function transfer() {
  const data = new Map<string, string>();
  const types: string[] = [];
  return {
    types,
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: (type: string, value: string) => {
      data.set(type, value);
      if (!types.includes(type)) types.push(type);
    },
    getData: (type: string) => data.get(type) ?? '',
    setDragImage: () => {},
  };
}
type Transfer = ReturnType<typeof transfer>;

// Fires a drag event carrying this very transfer (testing-library would copy it into a read-only one, losing what a
// handler sets on it) and its x (which happy-dom's DragEvent lacks); answers whether a handler accepted it.
function drag(kind: 'dragStart' | 'dragEnter' | 'dragOver' | 'dragLeave' | 'drop' | 'dragEnd', target: Element, dataTransfer: Transfer = transfer(), clientX = 0): boolean {
  const event = createEvent[kind](target);
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'clientX', { value: clientX });
  act(() => void fireEvent(target, event));
  return event.defaultPrevented;
}

const offs: (() => void)[] = [];
let rows: LibraryRow[];
let fakeMain: ReturnType<typeof installFakeMain>;

beforeEach(() => {
  resetPanelStores();
  // Transfer targets need a visible surface; an empty panel no longer reserves a column.
  const surface = { id: 'background:probe', toolId: 'background', pinned: true };
  useLayout.setState({ panelPinned: [surface], panelSurfaces: { version: 1, stacks: { [A]: [surface.id], '@none': [surface.id] }, pinnedTools: [], contexts: {} } });
  resetArtifactEditors();
  resetLibrary();
  resetCovering();
  useNotices.setState({ notices: [] });
  rows = [row(DOC, 'Launch notes'), row(NOTES, 'Notes')];
  fakeMain = installFakeMain((name, input) => {
    if (name === 'library.list') return ok({ rows, counts: {} });
    if (name === 'library.get') return ok({ row: rows.find((r) => r.id === input.artifactId) ?? null });
    if (name === 'artifacts.get') return ok({ artifact: null });
    if (name === 'layout.get') return ok({ value: null });
    if (name === 'layout.set' || name === 'artifacts.markViewed' || name === 'browser.view.cover') return ok();
    return fail(`not answered here: ${name}`);
  });
  offs.push(connectLibrary());
  offs.push(registerPanelTool(artifactsTool));
  // An editable document's view takes every drag it is shown (ProseMirror prevents each dragover and dragenter), so a
  // refused drag that reached it would show a drop cursor.
  const take = (event: { preventDefault(): void }) => event.preventDefault();
  offs.push(registerArtifactEditor('document', { Panel: ({ artifactId }) => <p data-editable onDragEnter={take} onDragOver={take}>editing {artifactId}</p> }));
  registerSlot('panelHost', PanelHost);
});
afterEach(() => {
  cleanup();
  resetSlots();
  offs.splice(0).forEach((off) => off());
  resetCovering();
});

function renderBoth() {
  return render(
    <QueryClientProvider client={queryClient}>
      <div data-region="main" className="flex">
        <MainArea />
      </div>
      <PanelRegion />
    </QueryClientProvider>,
  );
}

const mainTab = (id: string) => document.querySelector<HTMLElement>(`[data-region="main"] [data-tab-id="${id}"]`)!;
const panelRegion = () => document.querySelector<HTMLElement>('[data-region="panel"]')!;
const panelTab = (id: string) => panelRegion().querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!;
const panelGrip = () => within(panelRegion()).getByTitle(TRANSFER_COPY.grip);
const panelDragSource = (id: string) => panelTab(id) ?? panelGrip();
const panelTarget = () => screen.queryByTestId('panel-drop-target');
const paneTarget = (pane: 0 | 1) => document.querySelector<HTMLElement>(`[data-pane-drop-target="${pane}"]`);
const recordOf = (id: string) => (instanceOf(id)?.state as ArtifactsHandle | undefined)?.snapshot().view;
const mainIds = () => allTabs(useLayout.getState().main).map((t) => t.id);
const artifactsTabOfA = () => panelOf(A)?.tabs.find((t) => t.toolId === ARTIFACTS_TOOL_ID)?.id;
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const readyForTransfer = () => waitFor(() => expect(libraryRow(library.getState(), DOC).value).toBeDefined());
// What a pointer over `region`'s editable content hits: a drop layer covering the content when one is mounted, else the
// content itself (happy-dom does no hit-testing).
const hitIn = (region: Element) => region.querySelector('[data-drop-overlay]') ?? region.querySelector('[data-editable]')!;

function addArtifacts(target?: string, select = true): string {
  let id = '';
  act(() => void (id = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: A, params: target ? { target } : undefined, activate: select })));
  return id;
}

describe('a main tab dragged onto the panel', () => {
  it('Z1, Z3, Z7: the drag moves only; the panel is one target with one highlight saying “Move to side surface”; the drop moves it (T1)', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    renderBoth();
    await readyForTransfer();
    expect(panelTarget(), 'no target before a drag').toBeNull();
    const dt = transfer();
    drag('dragStart', mainTab(DOC_TAB.id), dt);
    expect(dt.getData(TAB_DRAG_TYPE)).toBe(DOC_TAB.id);
    expect(dt.effectAllowed).toBe('move');
    expect(useLayout.getState().dragging).toEqual({ source: 'main', tabId: DOC_TAB.id, fromPane: 0 });
    const target = panelTarget()!;
    expect(target).toBeTruthy();
    expect(within(target).queryByText(TRANSFER_COPY.moveToPanel), 'labelled only while hovered').toBeNull();
    expect(drag('dragEnter', target, dt)).toBe(true);
    expect(drag('dragOver', target, dt)).toBe(true);
    expect(dt.dropEffect).toBe('move');
    expect(within(target).getByText(TRANSFER_COPY.moveToPanel)).toBeTruthy();
    drag('drop', target, dt);
    await settle();
    expect(mainIds()).toEqual([sessionTab(A).id]);
    expect(recordOf(artifactsTabOfA()!)).toEqual({ kind: 'record', artifactId: DOC });
    expect(useLayout.getState().dragging, 'INV-5').toBeNull();
    expect(panelTarget()).toBeNull();
  });

  // Z2 and M5 (the M4 review's P3): a refused drag over the panel never shows a drop cursor, even where the panel shows
  // content that takes every drag (an editable document): the panel's layer covers it for every main tab's drag and
  // accepts only what the transfer allows.
  it('T14 and T19: a session tab, or an artifact no panel can take, is refused over the panel, editable content included', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    addArtifacts(DOC);
    renderBoth();
    await settle();
    expect(panelRegion().querySelector('[data-editable]'), 'the panel shows an editable record').not.toBeNull();
    let dt = transfer();
    drag('dragStart', mainTab(sessionTab(A).id), dt);
    expect(drag('dragEnter', hitIn(panelRegion()), dt)).toBe(false);
    expect(drag('dragOver', hitIn(panelRegion()), dt), 'never prevented: the no-drop cursor').toBe(false);
    expect(dt.dropEffect).toBe('none');
    expect(within(panelRegion()).queryByText(TRANSFER_COPY.moveToPanel), 'no highlight').toBeNull();
    drag('drop', hitIn(panelRegion()), dt);
    await settle();
    expect(mainIds()).toEqual([sessionTab(A).id, DOC_TAB.id]);
    drag('dragEnd', mainTab(sessionTab(A).id), dt);
    expect(panelTarget(), 'gone with the drag').toBeNull();

    cleanup();
    useLayout.setState({ main: panes([DOC_TAB]) }); // no session beside it and no pinned Artifacts tab
    renderBoth();
    dt = transfer();
    drag('dragStart', mainTab(DOC_TAB.id), dt);
    expect(drag('dragOver', hitIn(panelRegion()) ?? panelRegion(), dt), 'never prevented: the no-drop cursor').toBe(false);
  });

  it('a panel record the transfer refuses mid-drag finds no target over a pane’s editable body', async () => {
    useLayout.setState({ main: panes([NOTES_TAB]) }); // an editable document in main, no session: the pins show
    let id = '';
    act(() => void (id = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: null, pin: true, params: { target: DOC } })));
    renderBoth();
    await settle();
    const body = document.querySelector<HTMLElement>('[data-region="main"] [role="tabpanel"]')!;
    await waitFor(() => expect(body.querySelector('[data-editable]')).not.toBeNull());
    const dt = transfer();
    drag('dragStart', panelDragSource(id), dt);
    expect(drag('dragOver', hitIn(body), dt), 'accepted while the transfer allows it').toBe(true);
    act(() => usePanelHost.setState({ closing: new Set([id]) })); // the record's tab starts closing
    const refused = transfer();
    expect(drag('dragEnter', hitIn(body), refused)).toBe(false);
    expect(drag('dragOver', hitIn(body), refused)).toBe(false);
    expect(refused.dropEffect).toBe('none');
    expect(within(body).queryByText(TRANSFER_COPY.moveToTab)).toBeNull();
  });

  it('the right edge promises no split over an empty main area: a record dropped there fills its one pane', async () => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    act(() => useLayout.getState().setPanelTabs(null, { tabs: [], activeTabId: null }));
    const pin = (() => {
      let pinId = '';
      act(() => void (pinId = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: null, pin: true, params: { target: DOC } })));
      return pinId;
    })();
    renderBoth();
    await settle();
    const dt = transfer();
    drag('dragStart', panelDragSource(pin), dt);
    expect(screen.queryByTestId('drop-edge')).toBeNull();
    const body = document.querySelector<HTMLElement>('[data-region="main"] [role="tabpanel"]')!;
    expect(drag('dragOver', hitIn(body), dt)).toBe(true);
    drag('drop', hitIn(body), dt);
    await settle();
    expect(currentSet(useLayout.getState().main).panes.map((p) => p.tabs.map((t) => t.id))).toEqual([[DOC_TAB.id]]);
  });

  it('C1: Escape (the drag ends with no drop) changes nothing and clears every drag state', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    renderBoth();
    const before = useLayout.getState().main;
    const dt = transfer();
    drag('dragStart', mainTab(DOC_TAB.id), dt);
    drag('dragEnter', panelTarget()!, dt);
    drag('dragEnd', mainTab(DOC_TAB.id), dt);
    await settle();
    expect(useLayout.getState().main).toBe(before);
    expect(useLayout.getState().dragging).toBeNull();
    expect(panelTarget()).toBeNull();
    expect(panelOf(A)).toBeUndefined();
  });

  it('C2 and C3: leaving the window keeps the drag; a release elsewhere ends it, changing nothing', () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    renderBoth();
    const before = useLayout.getState().main;
    const dt = transfer();
    drag('dragStart', mainTab(DOC_TAB.id), dt);
    drag('dragLeave', document.body, dt);
    expect(useLayout.getState().dragging).not.toBeNull();
    drag('drop', document.body, dt); // not a target: heard on the window
    expect(useLayout.getState().dragging).toBeNull();
    expect(useLayout.getState().main).toBe(before);
  });

  it('INV-5: the source unmounting mid-drag ends the drag', () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    renderBoth();
    drag('dragStart', mainTab(DOC_TAB.id), transfer());
    act(() => useLayout.getState().closeTab(DOC_TAB.id));
    expect(useLayout.getState().dragging).toBeNull();
  });
});

// P4-B3 Decision Log 39: a Browser page is a native view above the renderer, so a target over a pane or the panel
// showing one would be out of reach under it. A placed page stands in for the Browser pane here (`coverPane`); the
// window's cover is asked as a drag starts and lifted however it ends.
describe('the browser cover while a drag is on', () => {
  const covers = () => fakeMain.callsOf('browser.view.cover').map((input) => input.covered);
  const PAGE = { x: 0, y: 0, width: 400, height: 300 };

  it('asked at a main tab’s dragstart, lifted by its drop on a target (the move made)', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    const page = coverPane(() => PAGE);
    renderBoth();
    await readyForTransfer();
    expect(covers()).toEqual([]);
    const dt = transfer();
    drag('dragStart', mainTab(DOC_TAB.id), dt);
    expect(covers(), 'the pages show their pictures for the drag').toEqual([true]);
    drag('dragOver', panelTarget()!, dt);
    drag('drop', panelTarget()!, dt);
    await settle();
    expect(recordOf(artifactsTabOfA()!)).toEqual({ kind: 'record', artifactId: DOC });
    expect(covers()).toEqual([true, false]);
    page.release();
  });

  it('lifted by Escape (the drag ends with no drop), a release elsewhere and the source unmounting, for either surface’s drag', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB, NOTES_TAB]) });
    const page = coverPane(() => PAGE);
    const id = addArtifacts(DOC);
    renderBoth();
    await settle();
    drag('dragStart', mainTab(NOTES_TAB.id), transfer());
    drag('dragEnd', mainTab(NOTES_TAB.id));
    expect(covers(), 'Escape').toEqual([true, false]);
    drag('dragStart', panelDragSource(id), transfer());
    drag('drop', document.body); // not a target: heard on the window
    expect(covers(), 'a release elsewhere').toEqual([true, false, true, false]);
    drag('dragStart', mainTab(NOTES_TAB.id), transfer());
    act(() => useLayout.getState().closeTab(NOTES_TAB.id));
    expect(covers(), 'the source unmounting').toEqual([true, false, true, false, true, false]);
    expect(useLayout.getState().dragging).toBeNull();
    page.release();
  });
});

describe('the panel’s record dragged into main', () => {
  it('Z1: the singleton Artifacts surface offers a drag grip only for a record, with its tool and tab as the payload', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    const id = addArtifacts();
    renderBoth();
    await settle();
    expect(within(panelRegion()).queryByTitle(TRANSFER_COPY.grip)).toBeNull();
    act(() => void (instanceOf(id)!.state as ArtifactsHandle).open({ target: DOC }));
    await settle();
    expect(panelGrip().getAttribute('draggable')).toBe('true');
    const dt = transfer();
    drag('dragStart', panelDragSource(id), dt);
    expect(JSON.parse(dt.getData(PANEL_TAB_DRAG_TYPE))).toEqual({ toolId: ARTIFACTS_TOOL_ID, tabId: id });
    expect(dt.effectAllowed).toBe('move');
    expect(useLayout.getState().dragging).toEqual({ source: 'panel', tabId: id, toolId: ARTIFACTS_TOOL_ID, artifactId: DOC });
  });

  it('the record bar’s grip drags the same', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    const id = addArtifacts(DOC);
    renderBoth();
    await settle();
    const grip = within(panelRegion()).getByTitle(TRANSFER_COPY.grip);
    expect(grip.getAttribute('draggable')).toBe('true');
    const dt = transfer();
    drag('dragStart', grip, dt);
    expect(JSON.parse(dt.getData(PANEL_TAB_DRAG_TYPE))).toEqual({ toolId: ARTIFACTS_TOOL_ID, tabId: id });
  });

  it('Z4: a main strip shows the insertion line labelled “Move to tab”, and the drop inserts it there (T7)', async () => {
    useLayout.setState({ main: panes([sessionTab(A), NOTES_TAB]) });
    const id = addArtifacts(DOC);
    renderBoth();
    await settle();
    const strip = within(document.querySelector<HTMLElement>('[data-region="main"]')!).getByRole('tablist');
    within(strip).getAllByRole('tab').forEach((t, i) => {
      t.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 100, width: 100, top: 0, bottom: 30, height: 30, x: i * 100, y: 0, toJSON: () => ({}) });
    });
    const dt = transfer();
    drag('dragStart', panelDragSource(id), dt);
    expect(drag('dragOver', strip, dt, 120)).toBe(true);
    expect(dt.dropEffect).toBe('move');
    expect(within(strip.parentElement!).getByText(TRANSFER_COPY.moveToTab)).toBeTruthy();
    drag('drop', strip, dt, 120);
    await settle();
    expect(mainIds()).toEqual([sessionTab(A).id, DOC_TAB.id, NOTES_TAB.id]);
    expect(recordOf(id)).toEqual({ kind: 'list' });
    expect(useLayout.getState().dragging).toBeNull();
  });

  it('Z5: a pane’s body highlights the whole pane, labelled “Move to tab”, and the drop appends it there (T10)', async () => {
    useLayout.setState({ main: panes([sessionTab(A), NOTES_TAB]) });
    act(() => useLayout.getState().activateTab(sessionTab(A).id));
    const id = addArtifacts(DOC);
    renderBoth();
    await settle();
    expect(paneTarget(0)).toBeNull();
    const dt = transfer();
    drag('dragStart', panelDragSource(id), dt);
    const target = paneTarget(0)!;
    expect(drag('dragEnter', target, dt)).toBe(true);
    expect(drag('dragOver', target, dt)).toBe(true);
    expect(within(target).getByText(TRANSFER_COPY.moveToTab)).toBeTruthy();
    drag('drop', target, dt);
    await settle();
    expect(mainIds()).toEqual([sessionTab(A).id, NOTES_TAB.id, DOC_TAB.id]);
    expect(currentSet(useLayout.getState().main).panes[0].activeTabId).toBe(DOC_TAB.id);
  });

  it('Z6: the right edge, with no split, highlights the right half “Open in split” and makes pane 1 with it (T9)', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    const id = addArtifacts(DOC);
    renderBoth();
    await settle();
    const dt = transfer();
    drag('dragStart', panelDragSource(id), dt);
    const edge = screen.getByTestId('drop-edge');
    expect(drag('dragEnter', edge, dt)).toBe(true);
    expect(drag('dragOver', edge, dt)).toBe(true);
    expect(within(screen.getByTestId('drop-edge-highlight')).getByText(TRANSFER_COPY.openInSplit)).toBeTruthy();
    drag('drop', edge, dt);
    await settle();
    expect(currentSet(useLayout.getState().main).panes.map((p) => p.tabs.map((t) => t.id))).toEqual([[sessionTab(A).id], [DOC_TAB.id]]);
  });

  it('a panel tab showing the list, or a main tab, finds no pane-body target', async () => {
    useLayout.setState({ main: panes([sessionTab(A), NOTES_TAB]) });
    renderBoth();
    drag('dragStart', mainTab(NOTES_TAB.id), transfer());
    expect(paneTarget(0)).toBeNull();
  });
});

describe('the right edge (Z6)', () => {
  it('T16: never offered for the only tab of the only pane; offered for a tab whose pane keeps another', () => {
    useLayout.setState({ main: panes([DOC_TAB]) });
    renderBoth();
    drag('dragStart', mainTab(DOC_TAB.id), transfer());
    expect(screen.queryByTestId('drop-edge')).toBeNull();
    drag('dragEnd', mainTab(DOC_TAB.id), transfer());

    cleanup();
    useLayout.setState({ main: panes([NOTES_TAB, DOC_TAB]) });
    renderBoth();
    drag('dragStart', mainTab(DOC_TAB.id), transfer());
    expect(screen.getByTestId('drop-edge')).toBeTruthy();
  });
});

describe('the menus and actions share the drop’s refusal (M1 to M5)', () => {
  it('M3: a transferable tool’s tab menu offers “Move to main area”, enabled only while it shows a record', async () => {
    // The shipping singleton uses its record bar; explicitly enable tabs to exercise the shared tab-menu handler.
    offs.push(registerPanelTool({ ...artifactsTool, multiInstance: true }));
    useLayout.setState({ main: panes([sessionTab(A)]) });
    const id = addArtifacts();
    renderBoth();
    await settle();
    fireEvent.contextMenu(panelTab(id));
    let item = within(await screen.findByRole('menu')).getByRole('menuitem', { name: TRANSFER_COPY.moveToMain });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe(TRANSFER_COPY.noRecord);
    fireEvent.keyDown(item, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    act(() => void (instanceOf(id)!.state as ArtifactsHandle).open({ target: DOC }));
    await settle();
    fireEvent.contextMenu(panelTab(id));
    item = within(await screen.findByRole('menu')).getByRole('menuitem', { name: TRANSFER_COPY.moveToMain });
    expect(item.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(item);
    await settle();
    expect(mainIds()).toEqual([sessionTab(A).id, DOC_TAB.id]);
    expect(recordOf(id)).toEqual({ kind: 'list' });
  });

  it('M2: the record bar’s “Move to tab” appends it to the focused pane (INV-6)', async () => {
    useLayout.setState({ main: panes([NOTES_TAB, sessionTab(A)]) });
    const id = addArtifacts(DOC);
    renderBoth();
    await settle();
    fireEvent.click(within(panelRegion()).getByRole('button', { name: TRANSFER_COPY.moveToTab }));
    await settle();
    expect(mainIds()).toEqual([NOTES_TAB.id, sessionTab(A).id, DOC_TAB.id]);
    expect(recordOf(id)).toEqual({ kind: 'list' });
  });

  it('M5: without a project session, “Show in panel” stays disabled with the drag refusal even with a pinned Artifacts tab', async () => {
    useLayout.setState({ main: panes([DOC_TAB]) });
    panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: null, pin: true, activate: false });
    renderBoth();
    await readyForTransfer();
    fireEvent.contextMenu(mainTab(DOC_TAB.id));
    const item = within(await screen.findByRole('menu')).getByRole('menuitem', { name: SHOW_IN_PANEL_COPY.label });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe(TRANSFER_COPY.noProjectSession);
  });

  it('M4: “Move to side surface” and “Move to tab” are keymap actions with no chord; a refusal says why', async () => {
    offs.push(registerShellActions());
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    renderBoth();
    await readyForTransfer();
    await act(async () => runAction('artifact.moveToPanel'));
    await settle();
    expect(mainIds()).toEqual([sessionTab(A).id]);
    const id = artifactsTabOfA()!;
    expect(recordOf(id)).toEqual({ kind: 'record', artifactId: DOC });

    await act(async () => runAction('artifact.moveToTab'));
    await settle();
    expect(mainIds()).toEqual([sessionTab(A).id, DOC_TAB.id]);
    expect(recordOf(id)).toEqual({ kind: 'list' });

    act(() => useLayout.getState().activateTab(sessionTab(A).id));
    await act(async () => runAction('artifact.moveToPanel'));
    expect(useNotices.getState().notices.map((n) => n.text)).toContain(TRANSFER_COPY.notArtifact);
    await act(async () => runAction('artifact.moveToTab'));
    expect(useNotices.getState().notices.map((n) => n.text)).toContain(TRANSFER_COPY.noRecord);
  });
});
