// The library's actions (the P3-L execution document, M3): each a write through A's `artifacts.*` and `spaces.*`, whose
// answer carries the store's refusal read by `artifactRefusalOf`; the library changes only when main's index does (no
// optimistic edit); opening an artifact reveals the main area and opens, or activates, its one tab.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import { ARTIFACTS_TOOL_ID } from '@shared/maws/panes';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { artifactMachineOf, resetArtifactMachines } from '../artifacts/machines';
import { ipc } from '../ipc/client';
import { surfaceTabs } from '../panel/surface-model';
import { useLayout } from '../stores/layout';
import { activeTab, allTabs } from '../stores/layout-model';
import { fail, installFakeMain, ok } from '../test-support/code';
import { resetShellStores } from '../test-support/shell-stores';
import { resetOpenRequests, takeOpenRequest, useOpenRequest } from '../tools/artifacts/viewers/requests';
import {
  createArtifact, createSpace, deleteArtifact, deleteSpace, duplicateArtifact, linkSpaceDirectory, markArtifactViewed, moveArtifactToSpace, openArtifactTab,
  renameArtifact, renameSpace, setArtifactPinned, showOpenArtifactTab,
} from './actions';

const A = '00000000-0000-4000-8000-000000000001';
const S = '00000000-0000-4000-8000-000000000101';
const artifact = { id: A, kind: 'document', title: 'Notes', createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 0 };
const space = { id: S, name: 'Research', createdAt: 1 };

beforeEach(() => resetShellStores());

describe('the library’s writes', () => {
  it('each asks its command and answers its value', async () => {
    const main = installFakeMain((name) => (name.startsWith('spaces.') && name !== 'spaces.delete' ? ok({ space }) : name === 'artifacts.delete' || name === 'artifacts.markViewed' || name === 'spaces.delete' ? ok() : ok({ artifact })));
    expect(await createArtifact({ kind: 'document', title: 'Untitled document', spaceId: S })).toEqual({ ok: true, value: artifact });
    await renameArtifact(A, TEST_MACHINE, 'Notes');
    await setArtifactPinned(A, TEST_MACHINE, true);
    await moveArtifactToSpace(A, TEST_MACHINE, null);
    await duplicateArtifact(A, TEST_MACHINE);
    await deleteArtifact(A, TEST_MACHINE);
    await markArtifactViewed(A, TEST_MACHINE);
    expect(await createSpace('Research', '/repo')).toEqual({ ok: true, value: space });
    await renameSpace(S, 'Reading');
    await linkSpaceDirectory(S, null);
    await deleteSpace(S);
    expect(main.calls).toEqual([
      { name: 'artifacts.create', input: { kind: 'document', title: 'Untitled document', spaceId: S } },
      { name: 'artifacts.update', input: { artifactId: A, title: 'Notes' } },
      { name: 'artifacts.update', input: { artifactId: A, pinned: true } },
      { name: 'artifacts.update', input: { artifactId: A, spaceId: null } },
      { name: 'artifacts.duplicate', input: { artifactId: A } },
      { name: 'artifacts.delete', input: { artifactId: A } },
      { name: 'artifacts.markViewed', input: { artifactId: A } },
      { name: 'spaces.create', input: { name: 'Research', linkedDir: '/repo' } },
      { name: 'spaces.update', input: { spaceId: S, name: 'Reading' } },
      { name: 'spaces.update', input: { spaceId: S, linkedDir: null } },
      { name: 'spaces.delete', input: { spaceId: S } },
    ]);
  });

  it('a refusal the store names comes back read; any other failure comes back with no refusal', async () => {
    installFakeMain((name) =>
      name === 'artifacts.delete'
        ? { ok: false, error: { code: 'invalid_input', message: 'in use', issues: { reason: 'designSystemInUse', data: { artifactIds: [A] } } } }
        : fail('host unavailable'),
    );
    const refused = await deleteArtifact(A, TEST_MACHINE);
    expect(refused).toMatchObject({ ok: false, refusal: { reason: 'designSystemInUse', data: { artifactIds: [A] } }, error: { message: 'in use' } });
    expect(await renameArtifact(A, TEST_MACHINE, 'x')).toMatchObject({ ok: false, refusal: null, error: { message: 'host unavailable' } });
  });
});

describe('opening an artifact', () => {
  it('opens its one tab in the current set, docking a maximized panel first; opening it again activates it', () => {
    useLayout.setState({ regions: { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, maximized: true } } });
    openArtifactTab(A);
    expect(useLayout.getState().regions.panel.maximized).toBe(false);
    expect(activeTab(useLayout.getState().main)).toEqual({ id: `artifact:${TEST_MACHINE}:${A}`, kind: 'artifact', artifactId: A, machine: TEST_MACHINE, pinned: false });
    useLayout.getState().openTab({ kind: 'diagnostics' });
    openArtifactTab(A);
    expect(activeTab(useLayout.getState().main)?.id).toBe(`artifact:${TEST_MACHINE}:${A}`);
    expect(allTabs(useLayout.getState().main).filter((t) => t.kind === 'artifact')).toHaveLength(1);
  });

  // P4-B4: a place (a link's fragment) is asked of the main tab's editor, the latest version shown unless it names one; a
  // plain open asks nothing of it (the tab keeps the version it shows)
  it('asks the main tab’s editor for the place it names, at the latest; a plain open asks nothing', () => {
    resetOpenRequests();
    const asked = renderHook(() => useOpenRequest(A, TEST_MACHINE, 'main'));
    act(() => openArtifactTab(A));
    expect(asked.result.current).toBeNull();
    act(() => openArtifactTab(A, { block: 'b7' }));
    expect(asked.result.current).toMatchObject({ artifactId: A, at: 'latest', location: { block: 'b7' }, surface: 'main' });
    expect(takeOpenRequest(asked.result.current!.serial)).toBe(true);
    expect(activeTab(useLayout.getState().main)?.id).toBe(`artifact:${TEST_MACHINE}:${A}`);
  });
});

// UX wave U6d (card C5, "Show that tab"; decisions 1 to 3): a mention's click shows the main tab that already shows the
// artifact, looked for on the machine the side column would read it on, and else does nothing and answers false
describe('showing the main tab that already shows an artifact', () => {
  const LOCAL_SESSION = addressOf(TEST_MACHINE, 'app-local') as AppSessionId;
  const REMOTE_SESSION = addressOf(OTHER_MACHINE, 'app-remote') as AppSessionId;
  const artifactTabOn = (machine: string) => `artifact:${machine}:${A}`;
  afterEach(() => resetArtifactMachines());

  it('with no such tab does nothing and answers false', () => {
    useLayout.getState().openTab({ kind: 'diagnostics' });
    const before = useLayout.getState().main;
    expect(showOpenArtifactTab(LOCAL_SESSION, A)).toBe(false);
    expect(useLayout.getState().main).toBe(before);
  });

  it('brings a tab that is not in front forward, where it is', () => {
    openArtifactTab(A);
    useLayout.getState().openTab({ kind: 'diagnostics' });
    expect(showOpenArtifactTab(LOCAL_SESSION, A)).toBe(true);
    expect(activeTab(useLayout.getState().main)?.id).toBe(artifactTabOn(TEST_MACHINE));
    expect(allTabs(useLayout.getState().main).filter((t) => t.kind === 'artifact')).toHaveLength(1);
  });

  it('brings forward a tab in the other pane of a split, in that pane', () => {
    openArtifactTab(A);
    useLayout.getState().openTab({ kind: 'diagnostics' });
    useLayout.getState().splitWithActive(); // the diagnostics tab moves to the second pane
    useLayout.getState().focusPane(1);
    expect(useLayout.getState().main.panes[0]!.tabs.map((t) => t.id)).toEqual([artifactTabOn(TEST_MACHINE)]);
    expect(showOpenArtifactTab(LOCAL_SESSION, A)).toBe(true);
    const main = useLayout.getState().main;
    expect([main.focusedPane, main.panes[0]!.activeTabId, main.panes[1]!.tabs.map((t) => t.kind)]).toEqual([0, artifactTabOn(TEST_MACHINE), ['diagnostics']]);
  });

  it('shows the tab over a page open in place of the tabs, closing the page', () => {
    openArtifactTab(A);
    useLayout.getState().openDestination({ kind: 'library' });
    expect(useLayout.getState().destination).not.toBeNull();
    expect(showOpenArtifactTab(LOCAL_SESSION, A)).toBe(true);
    expect(useLayout.getState().destination).toBeNull();
    expect(activeTab(useLayout.getState().main)?.id).toBe(artifactTabOn(TEST_MACHINE));
  });

  // The architect's ruling (Decision Log 9; decision 5 and A14.4 as revised): with the side column maximized or floating,
  // showing the main tab docks the column so the tab can be seen, and nothing it shows changes: the same tool tab in
  // front, on the same artifact's record, with the same pins and surfaces
  it.each(['maximized', 'floating'] as const)('with the side column %s, shows the main tab, docks the column, and leaves what it shows as it was', (mode) => {
    const SIDE_TAB = `${ARTIFACTS_TOOL_ID}:probe`;
    const SHOWN = '00000000-0000-4000-8000-000000000002';
    openArtifactTab(A);
    // the session in front, whose transcript holds the mention, with its side column on another artifact's record: a
    // column with nothing to show cannot stay maximized or floating (the store's surfaceRegions)
    useLayout.getState().openTab({ kind: 'session', appSessionId: LOCAL_SESSION });
    useLayout.getState().setPanelTabs(LOCAL_SESSION, { tabs: [{ id: SIDE_TAB, toolId: ARTIFACTS_TOOL_ID, pinned: false }], activeTabId: SIDE_TAB });
    useLayout.getState().showSurfaceTab(LOCAL_SESSION, SIDE_TAB);
    useLayout.getState().setPanelParams(SIDE_TAB, { target: SHOWN, machine: TEST_MACHINE });
    useLayout.getState().setPanel({ [mode]: true });
    expect(surfaceTabs(useLayout.getState(), LOCAL_SESSION).map((tab) => tab.id), 'the record is in view').toEqual([SIDE_TAB]);
    const before = useLayout.getState();
    expect(before.regions.panel[mode]).toBe(true);

    expect(showOpenArtifactTab(LOCAL_SESSION, A)).toBe(true);
    const after = useLayout.getState();
    expect(activeTab(after.main)?.id, 'the main tab is selected').toBe(artifactTabOn(TEST_MACHINE));
    expect(after.regions.panel, 'the column docks, its width and fold as they were').toEqual({ ...before.regions.panel, maximized: false, floating: false });
    // what the column shows: the same objects, not only equal ones
    expect(after.panelBySession).toBe(before.panelBySession);
    expect(after.panelBySession.get(LOCAL_SESSION)?.tabs).toEqual([{ id: SIDE_TAB, toolId: ARTIFACTS_TOOL_ID, pinned: false }]);
    expect(surfaceTabs(after, LOCAL_SESSION).map((tab) => tab.id), 'the record still in view').toEqual([SIDE_TAB]);
    expect(after.panelParams).toBe(before.panelParams);
    expect(after.panelParams[SIDE_TAB]).toEqual({ target: SHOWN, machine: TEST_MACHINE });
    expect([after.panelPinned, after.panelActiveNoSession, after.panelSurfaces, after.panelGroups]).toEqual([before.panelPinned, before.panelActiveNoSession, before.panelSurfaces, before.panelGroups]);
    expect(after.panelSurfaces).toBe(before.panelSurfaces);
    expect(after.panelGroups).toBe(before.panelGroups);
  });

  it('asks the tab’s editor for the place the link names; with none, asks nothing', () => {
    resetOpenRequests();
    openArtifactTab(A);
    const asked = renderHook(() => useOpenRequest(A, TEST_MACHINE, 'main'));
    const other = renderHook(() => useOpenRequest(A, OTHER_MACHINE, 'main'));
    act(() => void showOpenArtifactTab(LOCAL_SESSION, A));
    expect(asked.result.current).toBeNull();
    act(() => void showOpenArtifactTab(LOCAL_SESSION, A, { block: 'b7' }));
    expect(asked.result.current).toMatchObject({ artifactId: A, at: 'latest', location: { block: 'b7' }, surface: 'main' });
    expect(other.result.current, 'the other machine’s copy does not take the place').toBeNull();
  });

  it('for a session on another machine looks for that machine’s tab, and takes no tab of the same id on another machine', () => {
    openArtifactTab(A); // this Mac's
    expect(showOpenArtifactTab(REMOTE_SESSION, A)).toBe(false);
    openArtifactTab(A, undefined, OTHER_MACHINE);
    useLayout.getState().openTab({ kind: 'diagnostics' });
    expect(showOpenArtifactTab(REMOTE_SESSION, A)).toBe(true);
    expect(activeTab(useLayout.getState().main)?.id).toBe(artifactTabOn(OTHER_MACHINE));
  });

  it('for this Mac’s session uses the unique confirmed peer, else looks on this Mac', async () => {
    installFakeMain((name) => name === 'artifacts.get' ? ok({ artifact }) : ok());
    await ipc.invoke('artifacts.get', { artifactId: A }, { machine: OTHER_MACHINE });
    openArtifactTab(A, undefined, OTHER_MACHINE);
    openArtifactTab(A, undefined, TEST_MACHINE);
    expect(showOpenArtifactTab(LOCAL_SESSION, A), 'only a remote copy is known').toBe(true);
    expect(activeTab(useLayout.getState().main)?.id).toBe(artifactTabOn(OTHER_MACHINE));
    await ipc.invoke('artifacts.get', { artifactId: A }, { machine: TEST_MACHINE });
    expect(showOpenArtifactTab('app-bare' as AppSessionId, A)).toBe(true);
    expect(activeTab(useLayout.getState().main)?.id).toBe(artifactTabOn(TEST_MACHINE));
  });
});


it('a bare open that guesses local does not mask a later confirmed peer copy', async () => {
  installFakeMain((name) => name === 'artifacts.get' ? ok({ artifact }) : ok());
  openArtifactTab(A);
  await ipc.invoke('artifacts.get', { artifactId: A }, { machine: OTHER_MACHINE });
  openArtifactTab(A);
  expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'artifact', artifactId: A, machine: OTHER_MACHINE });
});

// The branch's third review: a bare link (no source machine) for an id the window has no copy of on record reuses the one
// machine's tab the strip already holds for it (a tab restored at launch), without taking that tab as a confirmed copy.
describe('a bare link with no route hint', () => {
  afterEach(() => resetArtifactMachines());

  it('reuses the strip’s one restored tab of the id on another machine, and records no route', () => {
    useLayout.getState().openTab({ kind: 'artifact', artifactId: A, machine: OTHER_MACHINE });
    useLayout.getState().openTab({ kind: 'diagnostics' });
    openArtifactTab(A);
    expect(activeTab(useLayout.getState().main)?.id).toBe(`artifact:${OTHER_MACHINE}:${A}`);
    expect(allTabs(useLayout.getState().main).filter((t) => t.kind === 'artifact')).toHaveLength(1);
    expect(artifactMachineOf(A)).toBeNull();
  });

  it('opens this Mac’s copy when the strip holds tabs of the id on more than one machine', () => {
    useLayout.getState().openTab({ kind: 'artifact', artifactId: A, machine: OTHER_MACHINE });
    useLayout.getState().openTab({ kind: 'artifact', artifactId: A, machine: TEST_MACHINE });
    useLayout.getState().openTab({ kind: 'diagnostics' });
    openArtifactTab(A);
    expect(activeTab(useLayout.getState().main)?.id).toBe(`artifact:${TEST_MACHINE}:${A}`);
  });
});
