// Cross-surface transfer (P4-B3 M4; X38; the prior art's §4.3): the two moves and their one refusal, row by row (T1 to T20
// less the copy rows T6 and T11, which the owner's move-only ruling removes), with the invariants checked after each:
// a move never adds a view (INV-1), never leaves an artifact nowhere (INV-2), and a refusal leaves both surfaces exactly
// as they were (INV-4). The editor's state travels: the hold the source made is the one the target shows (S3: every edit
// typed is in that replica, exactly once), never disposed on the way and never made again.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, tabId, type LayoutMain, type TabRef, type TabSet } from '@shared/ipc/schema/layout';
import {
  artifactEditorFor, heldArtifactEditorState, holdArtifactEditorState, registerArtifactEditor, releaseArtifactEditorState, resetArtifactEditors, type ArtifactEditorHold, type ArtifactEditorTarget,
} from '../artifacts/registry';
import { registerEditorHost, type EditorHostScope } from '../panel/editor-host';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { library, resetLibrary, rowKey } from '../library/store';
import { instanceIds, instanceOf, panelHost, registerPanelTool, usePanelHost } from '../panel/host';
import { NO_PROJECT_OF, useLayout } from '../stores/layout';
import { activeTab, allTabs, currentSet } from '../stores/layout-model';
import { fail, installFakeMain, ok } from '../test-support/code';
import { A, B, panelOf, resetPanelStores, sessionTab } from '../test-support/panel';
import { ARTIFACTS_TOOL_ID, artifactsTool, type ArtifactsHandle } from '../tools/artifacts/ArtifactsTool';
import { TRANSFER_COPY } from '../tools/artifacts/copy';
import { requestArtifactOpen, resetOpenRequests, useOpenRequest } from '../tools/artifacts/viewers/requests'; // P4-B4 renamed the version request the open request
import { recordTranscriptScroll, takeTranscriptCarry } from '../transcript/view/scroll-carry'; // P4-B3 M5
import { dragAccepted, moveArtifactToPanel, moveArtifactToTab, transferRefusal, useTransferRefusal } from './transfer';

const DOC = 'doc-1';
const OTHER = 'doc-2';
const artifactTab = (artifactId: string, pinned = false): TabRef => ({ id: tabId({ kind: 'artifact', artifactId }), kind: 'artifact', artifactId, pinned });
const DOC_TAB = artifactTab(DOC);
const mainScope = (artifactId = DOC): EditorHostScope => ({ surface: 'main', tabId: tabId({ kind: 'artifact', artifactId }) });
const panelScope = (panelTabId: string): EditorHostScope => ({ surface: 'panel', tabId: panelTabId });

function metadata(artifactId: string, projectId?: ProjectId): void {
  const row: LibraryRow = { id: artifactId, kind: 'document', title: 'Launch notes', createdBy: { kind: 'human' }, createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0, sessions: [], ...(projectId ? { project: { id: projectId, name: projectId } } : {}) };
  library.setState((state) => ({ reads: new Map(state.reads).set(rowKey(artifactId), { status: 'ready', value: row, error: null }) }));
}

// One pane of these tabs (the last active), or two.
const panes = (...pieces: TabRef[][]): LayoutMain => ({
  ...LAYOUT_DEFAULTS.main,
  sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: pieces.map((tabs) => ({ tabs, activeTabId: tabs.at(-1)!.id })) as TabSet['panes'], focusedPane: 0 } },
});

const offs: (() => void)[] = [];
const makeEditor = () => ({ Panel: () => null, createState: vi.fn(({ artifactId }: ArtifactEditorTarget) => ({ artifactId })), dispose: vi.fn<(state: unknown) => void>() });
let editor: ReturnType<typeof makeEditor>;

beforeEach(() => {
  resetPanelStores();
  useLayout.setState({ projectOf: NO_PROJECT_OF });
  resetArtifactEditors();
  resetLibrary();
  metadata(DOC);
  metadata(OTHER);
  resetOpenRequests();
  installFakeMain((name) => {
    if (name === 'layout.get') return ok({ value: null });
    if (name === 'layout.set') return ok();
    return fail(`not answered here: ${name}`);
  });
  offs.push(registerPanelTool(artifactsTool));
  editor = makeEditor();
  offs.push(registerArtifactEditor('document', editor));
});
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  vi.useRealTimers();
});

// A body mounted in a scope made the editor's state there (as `MountedEditor` does).
const mounted = (scope: EditorHostScope, artifactId = DOC): ArtifactEditorHold => holdArtifactEditorState(scope, artifactId, 'document', artifactEditorFor('document')!);
const handleOf = (panelTabId: string) => instanceOf(panelTabId)?.state as ArtifactsHandle | undefined;
const recordOf = (panelTabId: string | undefined) => (panelTabId ? handleOf(panelTabId)?.snapshot().view : undefined);
const artifactsTab = (appSessionId: AppSessionId) => panelOf(appSessionId)?.tabs.find((t) => t.toolId === ARTIFACTS_TOOL_ID)?.id;
const addArtifacts = (appSessionId: AppSessionId | null, target?: string) => {
  let id = '';
  act(() => void (id = panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId, pin: appSessionId === null, params: target ? { target } : undefined, activate: false })));
  return id;
};
const guard = (scope: EditorHostScope, answer: () => boolean | Promise<boolean>) => {
  const asked = vi.fn(async () => answer());
  act(() => void registerEditorHost(scope, { title: 'Doc', closeGuard: asked }));
  return asked;
};

// INV-1 and INV-2's count: an artifact's views, its main tabs and the panel records showing it.
const viewsOf = (artifactId: string) =>
  allTabs(useLayout.getState().main).filter((t) => t.kind === 'artifact' && t.artifactId === artifactId).length +
  instanceIds().filter((id) => {
    const view = recordOf(id);
    return view?.kind === 'record' && view.artifactId === artifactId;
  }).length;
// INV-4's picture of both surfaces.
const surfaces = () => {
  const { main, panelPinned, panelBySession, panelActiveNoSession } = useLayout.getState();
  return { main, panelPinned, panelBySession: [...panelBySession], panelActiveNoSession, records: instanceIds().map((id) => [id, recordOf(id)]) };
};

async function move(run: () => Promise<boolean>): Promise<boolean> {
  let result = false;
  await act(async () => void (result = await run()));
  return result;
}

describe('main → panel', () => {
  it.each([true, false])('uses the artifact metadata project rather than the containing set (target chat open: %s)', async (open) => {
    const containing = 'project-x' as ProjectId;
    const actual = 'project-y' as ProjectId;
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, projectOf: (id) => id === A ? containing : actual });
    useLayout.getState().openSession(A, { how: 'tab' });
    if (open) useLayout.getState().openSession(B, { how: 'tab' });
    useLayout.getState().setCurrentProject(containing);
    useLayout.getState().openTab({ kind: 'artifacts' });
    useLayout.getState().openTab({ kind: 'artifact', artifactId: DOC });
    metadata(DOC, actual);
    const before = surfaces();

    expect(transferRefusal({ to: 'panel', mainTabId: DOC_TAB.id })).toBe(open ? null : TRANSFER_COPY.noProjectSession);
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(open);
    if (open) {
      expect(useLayout.getState().main.current).toBe(actual);
      expect(activeTab(useLayout.getState().main)?.id).toBe(sessionTab(B).id);
      expect(recordOf(artifactsTab(B))).toEqual({ kind: 'record', artifactId: DOC });
      expect(panelOf(A)).toBeUndefined();
    } else expect(surfaces()).toEqual(before);
  });

  it.each(['unread', 'missing'] as const)('waits for %s metadata and updates the menu refusal when only the Library row arrives or changes project', async (status) => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    act(() => library.setState({ reads: status === 'unread' ? new Map() : new Map([[rowKey(DOC), { status: 'ready', value: null, error: null }]]) }));
    const refusal = renderHook(() => useTransferRefusal({ to: 'panel', mainTabId: DOC_TAB.id }));
    expect(refusal.result.current).toBe('Loading…');
    const before = surfaces();
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(false);
    expect(surfaces()).toEqual(before);
    act(() => metadata(DOC)); // loaded unprojected: the containing set supplies its chat
    expect(refusal.result.current).toBeNull();
    act(() => metadata(DOC, 'other-project' as ProjectId));
    expect(refusal.result.current).toBe(TRANSFER_COPY.noProjectSession);
    refusal.unmount();
  });

  it.each([false, true])('Library → artifact → Show in panel targets and activates the remembered session (existing record: %s)', async (existing) => {
    const project = 'project-x' as ProjectId;
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, projectOf: () => project });
    useLayout.getState().openSession(A, { how: 'tab' });
    useLayout.getState().openSession(B, { how: 'tab' });
    useLayout.getState().activateTab(sessionTab(A).id); // most recently active, not the neighbour of Library
    useLayout.getState().openTab({ kind: 'artifacts' });
    useLayout.getState().openTab({ kind: 'artifact', artifactId: DOC });
    const dest = existing ? addArtifacts(A, DOC) : undefined;
    const held = mounted(mainScope());
    if (dest) mounted(panelScope(dest));

    expect(transferRefusal({ to: 'panel', mainTabId: DOC_TAB.id })).toBeNull();
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    expect(useLayout.getState().main.current).toBe(project);
    expect(activeTab(useLayout.getState().main)?.id).toBe(sessionTab(A).id);
    expect(allTabs(useLayout.getState().main).some((tab) => tab.kind === 'artifacts')).toBe(true);
    expect(recordOf(artifactsTab(A))).toEqual({ kind: 'record', artifactId: DOC });
    expect(panelOf(B)).toBeUndefined();
    expect(viewsOf(DOC)).toBe(1);
    if (!existing) expect(heldArtifactEditorState(panelScope(artifactsTab(A)!))).toBe(held);
  });

  it('refuses Show in panel with the project-specific reason when only another project has a session, even with a pin', async () => {
    const otherProject = 'project-y' as ProjectId;
    const project = 'project-x' as ProjectId;
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, projectOf: () => otherProject });
    useLayout.getState().openSession(A, { how: 'tab' });
    useLayout.getState().setCurrentProject(project);
    useLayout.getState().openTab({ kind: 'artifacts' });
    useLayout.getState().openTab({ kind: 'artifact', artifactId: DOC });
    addArtifacts(null);
    mounted(mainScope());
    const before = surfaces();
    expect(transferRefusal({ to: 'panel', mainTabId: DOC_TAB.id })).toBe('Open a session in this project to show it beside the chat');
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(false);
    expect(surfaces()).toEqual(before);
  });

  it('T1: the tab closes (the next activates by the close rule), the session’s Artifacts tab activates on the record, and the editor’s state travels', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    const list = addArtifacts(A);
    const held = mounted(mainScope());
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    expect(allTabs(useLayout.getState().main).map((t) => t.id)).toEqual([sessionTab(A).id]);
    expect(activeTab(useLayout.getState().main)?.id).toBe(sessionTab(A).id);
    expect(panelOf(A)?.activeTabId).toBe(list);
    expect(recordOf(list)).toEqual({ kind: 'record', artifactId: DOC });
    expect(heldArtifactEditorState(panelScope(list)), 'the same state, its edits with it').toBe(held);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(editor.dispose).not.toHaveBeenCalled();
    expect(editor.createState).toHaveBeenCalledTimes(1);
    expect(viewsOf(DOC)).toBe(1);
  });

  it('T2: with no Artifacts tab, one is made after the pins, active, and never a second', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]), panelPinned: [{ id: 'notes:pin', toolId: 'notes', pinned: true }] });
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    const tabs = useLayout.getState().effectivePanelTabs(A);
    expect(tabs.map((t) => t.toolId)).toEqual(['notes', ARTIFACTS_TOOL_ID]);
    expect(panelOf(A)!.activeTabId).toBe(tabs[1].id);
    expect(recordOf(tabs[1].id)).toEqual({ kind: 'record', artifactId: DOC });
    expect(await move(() => moveArtifactToTab(tabs[1].id))).toBe(true);
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    expect(useLayout.getState().effectivePanelTabs(A).filter((t) => t.toolId === ARTIFACTS_TOOL_ID)).toHaveLength(1);
    expect(viewsOf(DOC)).toBe(1);
  });

  it('T3: the panel’s other record goes Back through its guard, once, then the artifact shows', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    const dest = addArtifacts(A, OTHER);
    const other = mounted(panelScope(dest), OTHER);
    const asked = guard(panelScope(dest), () => true);
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(recordOf(dest)).toEqual({ kind: 'record', artifactId: DOC });
    expect(editor.dispose).toHaveBeenCalledExactlyOnceWith(other.state);
    expect(viewsOf(OTHER)).toBe(0); // the owner let it go
    expect(viewsOf(DOC)).toBe(1);
  });

  it('T4: that guard refusing (a cancelled dialog, C4) leaves both surfaces exactly as they were', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    const dest = addArtifacts(A, OTHER);
    mounted(panelScope(dest), OTHER);
    mounted(mainScope());
    guard(panelScope(dest), () => false);
    const before = surfaces();
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(false);
    expect(surfaces()).toEqual(before);
    expect(editor.dispose).not.toHaveBeenCalled();
  });

  it('T5: a panel already showing the artifact is activated, its view kept, and the tab closes through its own guard', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    const dest = addArtifacts(A, DOC);
    act(() => useLayout.getState().setPanelTabs(A, { tabs: panelOf(A)!.tabs, activeTabId: null }));
    const panelHold = mounted(panelScope(dest));
    const mainHold = mounted(mainScope());
    const asked = guard(mainScope(), () => true);
    expect(viewsOf(DOC)).toBe(2);
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(allTabs(useLayout.getState().main).some((t) => t.id === DOC_TAB.id)).toBe(false);
    expect(panelOf(A)?.activeTabId).toBe(dest);
    expect(heldArtifactEditorState(panelScope(dest)), 'no remount').toBe(panelHold);
    expect(editor.dispose).toHaveBeenCalledExactlyOnceWith(mainHold.state);
    expect(viewsOf(DOC), 'one view fewer').toBe(1);
  });

  it('T5 with the tab’s guard refusing (C4) changes nothing', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    addArtifacts(A, DOC);
    guard(mainScope(), () => false);
    const before = surfaces();
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(false);
    expect(surfaces()).toEqual(before);
  });

  // Decision Log 39 (the re-review): the source's guard is asked as a move's, and what its editor hands to the view kept
  // goes only after the re-checks, in the same run as the close, so a refusal has nothing to undo.
  it('T5 asks the tab’s guard as a move’s, then hands its view over to the panel’s and closes it, in that order', async () => {
    const order: string[] = [];
    offs.push(registerArtifactEditor('document', { ...editor, handOver: (from: unknown, to: unknown) => void order.push(`handOver ${JSON.stringify([from, to])}`) }));
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    const dest = addArtifacts(A, DOC);
    mounted(panelScope(dest));
    mounted(mainScope());
    const asked = guard(mainScope(), () => {
      order.push('guard');
      return true;
    });
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    expect(asked).toHaveBeenCalledExactlyOnceWith({ moving: true });
    expect(order).toEqual(['guard', `handOver ${JSON.stringify([{ artifactId: DOC }, { artifactId: DOC }])}`]);
  });

  it.each([
    ['refuses', false],
    ['allows', true],
  ])('T5 with the panel retargeted while the tab’s guard asks (the guard %s): refused, the tab’s state untouched, nothing handed over', async (_, allowed) => {
    const handOver = vi.fn();
    offs.push(registerArtifactEditor('document', { ...editor, handOver }));
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    const dest = addArtifacts(A, DOC);
    const source = mounted(mainScope());
    mounted(panelScope(dest));
    let answer!: (allowed: boolean) => void;
    guard(mainScope(), () => new Promise<boolean>((resolve) => (answer = resolve)));
    const moving = moveArtifactToPanel(DOC_TAB.id);
    act(() => handleOf(dest)!.open({ target: OTHER }));
    mounted(panelScope(dest), OTHER);
    answer(allowed);
    expect(await move(() => moving)).toBe(false);
    expect(heldArtifactEditorState(mainScope()), 'the tab keeps its own state').toBe(source);
    expect(editor.dispose.mock.calls.some(([state]) => state === source.state), 'never disposed').toBe(false);
    expect(handOver).not.toHaveBeenCalled();
    expect(allTabs(useLayout.getState().main).some((t) => t.id === DOC_TAB.id)).toBe(true);
  });

  it('T14: a session tab is never taken by the panel', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    expect(transferRefusal({ to: 'panel', mainTabId: sessionTab(A).id })).toBe(TRANSFER_COPY.notArtifact);
    const before = surfaces();
    expect(await move(() => moveArtifactToPanel(sessionTab(A).id))).toBe(false);
    expect(surfaces()).toEqual(before);
  });

  it('requires an open chat even when a pinned Artifacts tab could take the only main tab', async () => {
    useLayout.setState({ main: panes([DOC_TAB]) });
    addArtifacts(null);
    const before = surfaces();
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(false);
    expect(surfaces()).toEqual(before);
  });

  it('T17: pane 1’s last tab moving closes the split, as closing it would', async () => {
    useLayout.setState({ main: panes([sessionTab(A)], [DOC_TAB]) });
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    expect(currentSet(useLayout.getState().main).panes).toHaveLength(1);
    expect(recordOf(artifactsTab(A))).toEqual({ kind: 'record', artifactId: DOC });
  });

  it('lands beside the most recently active chat, activating that chat when the artifact leaves', async () => {
    useLayout.setState({ main: panes([sessionTab(A), sessionTab(B)]) });
    useLayout.getState().activateTab(sessionTab(B).id);
    useLayout.getState().openTab({ kind: 'artifact', artifactId: DOC });
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    expect(recordOf(artifactsTab(B))).toEqual({ kind: 'record', artifactId: DOC });
    expect(panelOf(A)).toBeUndefined();
  });

  it('T18 and T19: when that panel cannot take it, it stays in main and nothing changes', async () => {
    useLayout.setState({ main: panes([DOC_TAB]) }); // no session next, and no pinned Artifacts tab
    expect(transferRefusal({ to: 'panel', mainTabId: DOC_TAB.id })).toBe(TRANSFER_COPY.noProjectSession);
    mounted(mainScope());
    const before = surfaces();
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(false);
    expect(surfaces()).toEqual(before);
    expect(viewsOf(DOC)).toBe(1);
  });

  it('a target Artifacts tab that is closing refuses the move', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    const dest = addArtifacts(A);
    act(() => usePanelHost.setState({ closing: new Set([dest]) }));
    expect(transferRefusal({ to: 'panel', mainTabId: DOC_TAB.id })).toBe(TRANSFER_COPY.closing);
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(false);
  });

  it('a panel that came to show another record while the guard asked takes nothing (INV-2)', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    const dest = addArtifacts(A, OTHER);
    const third = addArtifacts(B, 'doc-3');
    let answer!: (allowed: boolean) => void;
    guard(panelScope(dest), () => new Promise<boolean>((resolve) => (answer = resolve)));
    let moved: Promise<boolean> = Promise.resolve(false);
    act(() => void (moved = moveArtifactToPanel(DOC_TAB.id)));
    await act(async () => {});
    act(() => useLayout.getState().openSession(B, { how: 'tab' })); // meanwhile B is in front: the panel shown is B's
    await act(async () => answer(true));
    expect(await moved).toBe(false);
    expect(viewsOf(DOC)).toBe(1);
    expect(recordOf(third)).toEqual({ kind: 'record', artifactId: 'doc-3' });
  });
});

// P4-B3 (its Decision Log 32): a move is not a close. Neither move leaves a ⌘⇧T entry, so reopening never makes a second
// view of the artifact the owner moved.
describe('the closed-tab history', () => {
  it('is unchanged by a hand-off into the panel (T1) and by an activate-existing move (T5)', async () => {
    useLayout.setState({ main: { ...panes([DOC_TAB, sessionTab(A), artifactTab(OTHER)]), closedTabs: [artifactTab('old')] } }); // each move shows A's panel next
    const closed = useLayout.getState().main.closedTabs;
    expect(await move(() => moveArtifactToPanel(artifactTab(OTHER).id))).toBe(true); // T1: the hand-off
    expect(useLayout.getState().main.closedTabs).toBe(closed);
    const dest = artifactsTab(A)!;
    act(() => void handleOf(dest)!.open({ target: DOC })); // the panel shows DOC too
    act(() => useLayout.getState().activateTab(DOC_TAB.id));
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true); // T5: activate-existing
    expect(allTabs(useLayout.getState().main).some((t) => t.id === DOC_TAB.id)).toBe(false);
    expect(useLayout.getState().main.closedTabs).toBe(closed);
    act(() => useLayout.getState().reopenClosed());
    expect(viewsOf(DOC), '⌘⇧T reopens what was closed, never what moved').toBe(1);
  });
});

// P4-B3 fix wave (the M4 review's P2): a byte viewer's state holds the version its switcher shows, and the panel's open
// of a moved record must not ask its viewer for another (an ask the moved state's viewer takes, resetting it to latest).
describe('the version a moved viewer shows', () => {
  it('main → panel asks the panel’s viewer for no version, and withdraws an ask left for that artifact there', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    addArtifacts(A); // a list tab, which the move re-targets
    mounted(mainScope());
    requestArtifactOpen(DOC, 'latest', 'panel'); // a stale ask for the panel's viewer of DOC
    const asked = renderHook(() => useOpenRequest(DOC, 'panel'));
    expect(asked.result.current).not.toBeNull();
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    expect(asked.result.current).toBeNull();
  });

  it('a new Artifacts tab made for the move asks for none either', async () => {
    useLayout.setState({ main: panes([sessionTab(A), DOC_TAB]) });
    mounted(mainScope());
    const asked = renderHook(() => useOpenRequest(DOC, 'panel'));
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    expect(recordOf(artifactsTab(A))).toEqual({ kind: 'record', artifactId: DOC });
    expect(asked.result.current).toBeNull();
  });

  // P4-B4 (the B3 merge's review): a link's open of a main tab left before its editor took it is stale for the main
  // viewer a move lands in, on both paths (the carried state adopted by a new tab, an existing tab activated)
  it('panel → main into a new main tab withdraws an ask left for that artifact’s main viewer', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    const src = addArtifacts(A, DOC);
    mounted(panelScope(src));
    requestArtifactOpen(DOC, 'latest', 'main', { version: 2 }); // a link's ask whose main tab was closed first
    const asked = renderHook(() => useOpenRequest(DOC, 'main'));
    expect(asked.result.current).not.toBeNull();
    expect(await move(() => moveArtifactToTab(src))).toBe(true);
    expect(asked.result.current, 'the carried state adopted by a new main tab').toBeNull();
  });

  it('panel → main onto a main tab already showing it withdraws the ask left for that tab’s viewer', async () => {
    useLayout.setState({ main: panes([DOC_TAB, sessionTab(A)]) });
    const again = addArtifacts(A, DOC);
    mounted(panelScope(again));
    mounted(mainScope());
    guard(panelScope(again), () => true);
    requestArtifactOpen(DOC, 'latest', 'main', { block: 'b7' });
    const left = renderHook(() => useOpenRequest(DOC, 'main'));
    expect(left.result.current).not.toBeNull();
    expect(await move(() => moveArtifactToTab(again))).toBe(true);
    expect(left.result.current, 'an existing main tab activated').toBeNull();
  });

  it('an ordinary open in the panel still asks for its version', () => {
    const id = addArtifacts(A);
    const asked = renderHook(() => useOpenRequest(DOC, 'panel'));
    act(() => void handleOf(id)!.open({ target: DOC, at: { version: 1 } }));
    expect(asked.result.current?.at).toEqual({ version: 1 });
  });
});

describe('the right edge’s offer (P4-B3 fix wave)', () => {
  it('a panel record is offered the edge only when main has a tab to split beside', () => {
    const src = addArtifacts(A, DOC);
    const dragging = { source: 'panel' as const, tabId: src, toolId: ARTIFACTS_TOOL_ID, artifactId: DOC };
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    expect(dragAccepted('edge', dragging), 'an empty main: no split to promise').toBe(false);
    expect(dragAccepted('main', dragging), 'its body still takes it').toBe(true);
    useLayout.setState({ main: panes([sessionTab(A)]) });
    expect(dragAccepted('edge', dragging)).toBe(true);
  });
});

describe('panel → main', () => {
  it('T8 with main losing its tab while the record’s guard asks: the record moves after all, with its state', async () => {
    useLayout.setState({ main: panes([DOC_TAB, sessionTab(A)]) });
    const src = addArtifacts(A, DOC);
    const panelHold = mounted(panelScope(src));
    let answer!: (allowed: boolean) => void;
    const asked = guard(panelScope(src), () => new Promise<boolean>((resolve) => (answer = resolve)));
    let moved: Promise<boolean> = Promise.resolve(false);
    act(() => void (moved = moveArtifactToTab(src, { pane: 0, index: 0 })));
    await act(async () => {});
    expect(asked).toHaveBeenCalledTimes(1);
    act(() => useLayout.getState().closeTab(DOC_TAB.id)); // meanwhile the owner closes main's tab of it
    expect(viewsOf(DOC)).toBe(1);
    await act(async () => answer(true));
    expect(await moved).toBe(true);
    expect(currentSet(useLayout.getState().main).panes[0].tabs.map((t) => t.id)).toEqual([DOC_TAB.id, sessionTab(A).id]);
    expect(recordOf(src)).toEqual({ kind: 'list' });
    expect(heldArtifactEditorState(mainScope()), 'the record’s state, carried').toBe(panelHold);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(editor.dispose).not.toHaveBeenCalledWith(panelHold.state);
    expect(viewsOf(DOC)).toBe(1);
  });

  it('T7: inserted at the drop point, active, its pane focused; the panel back on its list; the state travels', async () => {
    const t1 = artifactTab('t-1');
    const t2 = artifactTab('t-2');
    useLayout.setState({ main: panes([sessionTab(A)], [t1, t2]) });
    const src = addArtifacts(A, DOC);
    const held = mounted(panelScope(src));
    expect(await move(() => moveArtifactToTab(src, { pane: 1, index: 1 }))).toBe(true);
    const set = currentSet(useLayout.getState().main);
    expect(set.panes[1]!.tabs.map((t) => t.id)).toEqual([t1.id, DOC_TAB.id, t2.id]);
    expect(set.panes[1]!.activeTabId).toBe(DOC_TAB.id);
    expect(set.focusedPane).toBe(1);
    expect(recordOf(src)).toEqual({ kind: 'list' });
    expect(heldArtifactEditorState(mainScope())).toBe(held);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(editor.dispose).not.toHaveBeenCalled();
    expect(editor.createState).toHaveBeenCalledTimes(1);
    expect(viewsOf(DOC)).toBe(1);
  });

  it('asks no guard for the artifact it moves (nothing can be lost)', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    const src = addArtifacts(A, DOC);
    mounted(panelScope(src));
    const asked = guard(panelScope(src), () => false);
    expect(await move(() => moveArtifactToTab(src))).toBe(true);
    expect(asked).not.toHaveBeenCalled();
    expect(recordOf(src)).toEqual({ kind: 'list' });
  });

  it('T8: a main tab already showing it moves to the drop point and activates, never a second; the record goes Back through its guard', async () => {
    const t1 = artifactTab('t-1');
    useLayout.setState({ main: panes([DOC_TAB, sessionTab(A)], [t1]) });
    const src = addArtifacts(A, DOC);
    const panelHold = mounted(panelScope(src));
    const mainHold = mounted(mainScope());
    const asked = guard(panelScope(src), () => true);
    expect(await move(() => moveArtifactToTab(src, { pane: 1, index: 1 }))).toBe(true);
    expect(asked).toHaveBeenCalledTimes(1);
    const set = currentSet(useLayout.getState().main);
    expect(set.panes[1]!.tabs.map((t) => t.id)).toEqual([t1.id, DOC_TAB.id]);
    expect(set.panes[0].tabs.map((t) => t.id)).toEqual([sessionTab(A).id]);
    expect(set.panes[1]!.activeTabId).toBe(DOC_TAB.id);
    expect(recordOf(src)).toEqual({ kind: 'list' });
    expect(heldArtifactEditorState(mainScope()), 'the main tab keeps its own').toBe(mainHold);
    expect(editor.dispose).toHaveBeenCalledExactlyOnceWith(panelHold.state);
    expect(viewsOf(DOC)).toBe(1);
  });

  it('T8 in the same pane counts the index as the strip showed it, the tab still in it', async () => {
    const [t1, t2] = [artifactTab('t-1'), artifactTab('t-2')];
    useLayout.setState({ main: panes([DOC_TAB, t1, t2]) });
    const src = addArtifacts(A, DOC);
    expect(await move(() => moveArtifactToTab(src, { pane: 0, index: 2 }))).toBe(true); // between t-1 and t-2
    expect(currentSet(useLayout.getState().main).panes[0].tabs.map((t) => t.id)).toEqual([t1.id, DOC_TAB.id, t2.id]);
  });

  it('T8 with the record’s guard refusing (C4) changes nothing', async () => {
    useLayout.setState({ main: panes([DOC_TAB, sessionTab(A)]) });
    const src = addArtifacts(A, DOC);
    mounted(panelScope(src));
    guard(panelScope(src), () => false);
    const before = surfaces();
    expect(await move(() => moveArtifactToTab(src, { pane: 0, index: 0 }))).toBe(false);
    expect(surfaces()).toEqual(before);
    expect(editor.dispose).not.toHaveBeenCalled();
  });

  // Decision Log 39 (the re-review), the mirror of T5's: the record's guard asked as a move's; a state the record made
  // anew while it asked is not the one it was asked for, so the move is refused and hands nothing over.
  it('T8 asks the record’s guard as a move’s, and is refused, handing nothing over, when the record’s state changed meanwhile', async () => {
    const handOver = vi.fn();
    offs.push(registerArtifactEditor('document', { ...editor, handOver }));
    useLayout.setState({ main: panes([DOC_TAB, sessionTab(A)]) });
    const src = addArtifacts(A, DOC);
    mounted(panelScope(src));
    let answer!: (allowed: boolean) => void;
    const asked = guard(panelScope(src), () => new Promise<boolean>((resolve) => (answer = resolve)));
    const moving = moveArtifactToTab(src);
    expect(asked).toHaveBeenCalledExactlyOnceWith({ moving: true });
    act(() => releaseArtifactEditorState(panelScope(src)));
    const remade = mounted(panelScope(src));
    answer(true);
    expect(await move(() => moving)).toBe(false);
    expect(handOver).not.toHaveBeenCalled();
    expect(heldArtifactEditorState(panelScope(src))).toBe(remade);
    expect(recordOf(src)).toEqual({ kind: 'record', artifactId: DOC });
  });

  it('T8 from a menu activates the open tab where it is', async () => {
    const t1 = artifactTab('t-1');
    useLayout.setState({ main: panes([DOC_TAB, sessionTab(A)], [t1]) });
    const src = addArtifacts(A, DOC);
    expect(await move(() => moveArtifactToTab(src))).toBe(true);
    const set = currentSet(useLayout.getState().main);
    expect(set.panes[0].tabs.map((t) => t.id)).toEqual([DOC_TAB.id, sessionTab(A).id]);
    expect(set.panes[0].activeTabId).toBe(DOC_TAB.id);
    expect(set.focusedPane).toBe(0);
  });

  it('T9: dropped on the right edge with no split, pane 1 is made with it, active and focused', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    const src = addArtifacts(A, DOC);
    expect(await move(() => moveArtifactToTab(src, { pane: 1, index: 0 }))).toBe(true);
    const set = currentSet(useLayout.getState().main);
    expect(set.panes.map((p) => p.tabs.map((t) => t.id))).toEqual([[sessionTab(A).id], [DOC_TAB.id]]);
    expect(set.focusedPane).toBe(1);
  });

  it('T8 on the right edge: the open tab moves into a new pane 1', async () => {
    const t1 = artifactTab('t-1');
    useLayout.setState({ main: panes([DOC_TAB, t1]) });
    const src = addArtifacts(A, DOC);
    expect(await move(() => moveArtifactToTab(src, { pane: 1, index: 0 }))).toBe(true);
    expect(currentSet(useLayout.getState().main).panes.map((p) => p.tabs.map((t) => t.id))).toEqual([[t1.id], [DOC_TAB.id]]);
    expect(viewsOf(DOC)).toBe(1);
  });

  it('T10: dropped on a pane’s body, appended to that pane and active; a menu appends to the focused pane (INV-6)', async () => {
    const t1 = artifactTab('t-1');
    useLayout.setState({ main: panes([sessionTab(A), t1]) });
    act(() => useLayout.getState().activateTab(sessionTab(A).id));
    const src = addArtifacts(A, DOC);
    expect(await move(() => moveArtifactToTab(src, { pane: 0 }))).toBe(true);
    expect(currentSet(useLayout.getState().main).panes[0].tabs.map((t) => t.id)).toEqual([sessionTab(A).id, t1.id, DOC_TAB.id]);
    expect(currentSet(useLayout.getState().main).panes[0].activeTabId).toBe(DOC_TAB.id);

    act(() => useLayout.getState().activateTab(sessionTab(A).id));
    const src2 = addArtifacts(null, OTHER);
    expect(await move(() => moveArtifactToTab(src2))).toBe(true);
    expect(currentSet(useLayout.getState().main).panes[0].tabs.at(-1)?.id).toBe(artifactTab(OTHER).id);
  });

  it('brings the main area back when the panel stands in it', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    act(() => useLayout.getState().setPanel({ maximized: true }));
    const src = addArtifacts(A, DOC);
    expect(await move(() => moveArtifactToTab(src))).toBe(true);
    expect(useLayout.getState().regions.panel.maximized).toBe(false);
  });

  it('T12 and T13: a panel tab showing no record (the list, another tool) refuses', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    const list = addArtifacts(A);
    expect(transferRefusal({ to: 'tab', panelTabId: list })).toBe(TRANSFER_COPY.noRecord);
    expect(transferRefusal({ to: 'tab', panelTabId: 'terminal:x' })).toBe(TRANSFER_COPY.noRecord);
    const before = surfaces();
    expect(await move(() => moveArtifactToTab(list))).toBe(false);
    expect(surfaces()).toEqual(before);
  });

  it('a panel tab that is closing refuses', async () => {
    useLayout.setState({ main: panes([sessionTab(A)]) });
    const src = addArtifacts(A, DOC);
    act(() => usePanelHost.setState({ closing: new Set([src]) }));
    expect(transferRefusal({ to: 'tab', panelTabId: src })).toBe(TRANSFER_COPY.closing);
    expect(await move(() => moveArtifactToTab(src))).toBe(false);
    expect(recordOf(src)).toEqual({ kind: 'record', artifactId: DOC });
  });
});

describe('round trips', () => {
  it('T20: a pinned main tab moved to the panel and back returns unpinned; the panel’s pins are unchanged', async () => {
    useLayout.setState({ main: panes([sessionTab(A), artifactTab(DOC, true)]) });
    const pins = useLayout.getState().panelPinned;
    const held = mounted(mainScope());
    expect(await move(() => moveArtifactToPanel(DOC_TAB.id))).toBe(true);
    const dest = artifactsTab(A)!;
    expect(await move(() => moveArtifactToTab(dest))).toBe(true);
    expect(allTabs(useLayout.getState().main).find((t) => t.id === DOC_TAB.id)?.pinned).toBe(false);
    expect(useLayout.getState().panelPinned).toBe(pins);
    expect(heldArtifactEditorState(mainScope()), 'the same state there and back').toBe(held);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(editor.dispose).not.toHaveBeenCalled();
    expect(editor.createState).toHaveBeenCalledTimes(1);
  });
});

// P4-B3 M5 (S6): a session tab moved between panes is the same session (its process untouched: nothing but the layout
// changes) and remounts its transcript in the other pane, so the transcript comes back where the reader was, as a card's
// float or dock does (Decision Log 14's carry); the draft is the session's (main's drafts table) and comes back by itself.
describe('a session tab moved between panes (S6)', () => {
  const place = { following: false, offset: 410, signature: '3:m2', anchor: 'm1' };
  const other = artifactTab(OTHER);

  it('carries its transcript’s place to the pane it lands in, by a drag or ⌘\\', () => {
    useLayout.setState({ main: panes([other, sessionTab(A)], [artifactTab(DOC)]) });
    recordTranscriptScroll(A, place);
    act(() => useLayout.getState().moveTab(sessionTab(A).id, 1, 0));
    expect(takeTranscriptCarry(A)).toEqual(place);

    recordTranscriptScroll(A, place);
    act(() => useLayout.getState().focusPane(1));
    act(() => useLayout.getState().splitWithActive());
    expect(currentSet(useLayout.getState().main).panes[0]!.activeTabId).toBe(sessionTab(A).id);
    expect(takeTranscriptCarry(A)).toEqual(place);
  });

  it('a tab switch, a session tab moved while not shown, or one reordered in its pane carries nothing', () => {
    useLayout.setState({ main: panes([sessionTab(A), other], [artifactTab(DOC)]) });
    recordTranscriptScroll(A, place);
    act(() => useLayout.getState().activateTab(sessionTab(A).id)); // shown in pane 0
    act(() => useLayout.getState().activateTab(other.id));
    act(() => useLayout.getState().activateTab(sessionTab(A).id));
    expect(takeTranscriptCarry(A), 'a tab switch').toBeNull();
    act(() => useLayout.getState().moveTab(sessionTab(A).id, 0, 1));
    expect(takeTranscriptCarry(A), 'a reorder').toBeNull();
    act(() => useLayout.getState().activateTab(other.id));
    act(() => useLayout.getState().moveTab(sessionTab(A).id, 1, 0));
    expect(currentSet(useLayout.getState().main).panes[1]!.activeTabId).toBe(sessionTab(A).id);
    expect(takeTranscriptCarry(A), 'not shown before the move').toBeNull();
  });
});
