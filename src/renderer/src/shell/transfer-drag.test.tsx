// Cross-surface transfer through its handlers (P4-B3 M4; X38; the prior art's Z1 to Z7, C1 to C3, INV-5 and M1 to M5):
// the main area and the panel rendered as the shell places them, the drags driven event by event, since Playwright's
// Electron drag cannot press Escape mid-drag (the prior art's live check 5). Each target accepts exactly the drags the
// shared refusal allows (an accepting `dragover` is prevented with `dropEffect = 'move'`; a refusing target never
// prevents it, so the cursor says no-drop), highlights the place the artifact will take with the outcome's label, and
// moves the artifact on drop; Escape, a release elsewhere or a source unmounting clears every drag state.
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
import { connectLibrary, resetLibrary } from '../library/store';
import { MainArea } from '../main/MainArea';
import { SHOW_IN_PANEL_COPY } from '../main/Tab';
import { instanceOf, panelHost, registerPanelTool } from '../panel/host';
import { PanelHost } from '../panel/PanelHost';
import { PanelRegion } from '../panel/PanelRegion';
import { useLayout } from '../stores/layout';
import { allTabs, currentSet } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { fail, installFakeMain, ok } from '../test-support/code';
import { A, panelOf, resetPanelStores, sessionTab } from '../test-support/panel';
import { ARTIFACTS_TOOL_ID, artifactsTool, type ArtifactsHandle } from '../tools/artifacts/ArtifactsTool';
import { TRANSFER_COPY } from '../tools/artifacts/copy';
import { PANEL_TAB_DRAG_TYPE, TAB_DRAG_TYPE } from './transfer';

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const DOC = '00000000-0000-4000-8000-000000000001';
const row = (id: string, title: string): LibraryRow => ({
  id, kind: 'document', title, createdBy: { kind: 'human' }, createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
  revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0, sessions: [],
});
const DOC_TAB: TabRef = { id: tabId({ kind: 'artifact', artifactId: DOC }), kind: 'artifact', artifactId: DOC, pinned: false };
const NOTES_TAB: TabRef = { id: tabId({ kind: 'artifact', artifactId: 'notes' }), kind: 'artifact', artifactId: 'notes', pinned: false };
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

beforeEach(() => {
  resetPanelStores();
  resetArtifactEditors();
  resetLibrary();
  useNotices.setState({ notices: [] });
  rows = [row(DOC, 'Launch notes'), row('notes', 'Notes')];
  installFakeMain((name, input) => {
    if (name === 'library.list') return ok({ rows, counts: {} });
    if (name === 'library.get') return ok({ row: rows.find((r) => r.id === input.artifactId) ?? null });
    if (name === 'artifacts.get') return ok({ artifact: null });
    if (name === 'layout.get') return ok({ value: null });
    if (name === 'layout.set' || name === 'artifacts.markViewed') return ok();
    return fail(`not answered here: ${name}`);
  });
  offs.push(connectLibrary());
  offs.push(registerPanelTool(artifactsTool));
  offs.push(registerArtifactEditor('document', { Panel: ({ artifactId }) => <p>editing {artifactId}</p> }));
  registerSlot('panelHost', PanelHost);
});
afterEach(() => {
  cleanup();
  resetSlots();
  offs.splice(0).forEach((off) => off());
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
const panelTarget = () => screen.queryByTestId('panel-drop-target');
const paneTarget = (pane: 0 | 1) => document.querySelector<HTMLElement>(`[data-pane-drop-target="${pane}"]`);
const recordOf = (id: string) => (instanceOf(id)?.state as ArtifactsHandle | undefined)?.snapshot().view;
const mainIds = () => allTabs(useLayout.getState().main).map((t) => t.id);
const artifactsTabOfA = () => panelOf(A)?.tabs.find((t) => t.toolId === ARTIFACTS_TOOL_ID)?.id;
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function addArtifacts(target?: string, select = true): string {
  let id = '';
  act(() => void (id = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: A, params: target ? { target } : undefined, activate: select })));
  return id;
}

describe('a main tab dragged onto the panel', () => {
  it('Z1, Z3, Z7: the drag moves only; the panel is one target with one highlight saying “Move to panel”; the drop moves it (T1)', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    renderBoth();
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

  it('T14 and T19: a session tab, or an artifact no panel can take, finds no target on the panel', () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    renderBoth();
    drag('dragStart', mainTab(sessionTab(A).id), transfer());
    expect(panelTarget()).toBeNull();
    drag('dragEnd', mainTab(sessionTab(A).id), transfer());

    cleanup();
    useLayout.setState({ main: panes([DOC_TAB]) }); // no session beside it and no pinned Artifacts tab
    renderBoth();
    const dt = transfer();
    drag('dragStart', mainTab(DOC_TAB.id), dt);
    expect(panelTarget()).toBeNull();
    expect(drag('dragOver', panelRegion(), dt), 'never prevented: the no-drop cursor').toBe(false);
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

describe('the panel’s record dragged into main', () => {
  it('Z1: the Artifacts tab drags only while it shows a record, with its tool and tab as the payload', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    const id = addArtifacts();
    renderBoth();
    await settle();
    expect(panelTab(id).getAttribute('draggable')).not.toBe('true');
    act(() => void (instanceOf(id)!.state as ArtifactsHandle).open({ target: DOC }));
    await settle();
    expect(panelTab(id).getAttribute('draggable')).toBe('true');
    const dt = transfer();
    drag('dragStart', panelTab(id), dt);
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
    drag('dragStart', panelTab(id), dt);
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
    drag('dragStart', panelTab(id), dt);
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
    drag('dragStart', panelTab(id), dt);
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
  it('M3: the panel’s Artifacts tab offers “Move to main area”, enabled only while it shows a record', async () => {
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

  it('M5: “Show in panel” is disabled with the very reason the panel refuses the drag', async () => {
    useLayout.setState({ main: panes([DOC_TAB]) });
    renderBoth();
    fireEvent.contextMenu(mainTab(DOC_TAB.id));
    const item = within(await screen.findByRole('menu')).getByRole('menuitem', { name: SHOW_IN_PANEL_COPY.label });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe(TRANSFER_COPY.noPanel);
  });

  it('M4: “Move to panel” and “Move to tab” are keymap actions with no chord; a refusal says why', async () => {
    offs.push(registerShellActions());
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    renderBoth();
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
