import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { EMPTY_STRIP, LAYOUT_DEFAULTS, NO_PROJECT, storedMain, type LayoutMain, type PanelSurfaces, type TabRef } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { createLayoutStore, LAYOUT_WRITE_DELAY_MS, persistLayout } from '../stores/layout';
import { sideGroups, surfaceSession, surfaceTabs } from './surface-model';

const A = at('app-a' as AppSessionId);
const files = { id: 'files-1', toolId: 'files', pinned: false };
const terminal = { id: 'terminal-1', toolId: 'terminal', pinned: false };
const browser = { id: 'browser-1', toolId: 'browser', pinned: false };

// UX wave U8b (M2): what is in view changes by the store's acts alone, one tab per group; a write of refs maintains them.
// Dropping the refs of a tool taken out of view would lose its state.
describe('the tabs in view', () => {
  it('a second and a third tool shown take the place of the one in view, retaining every ref and params', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().setPanelTabs(A, { tabs: [files], activeTabId: files.id });
    s().showSurfaceTab(A, files.id);
    expect(s().panelSurfaces.stacks[A]).toEqual([files.id]);
    s().setPanelParams(files.id, { path: '/repo' });
    s().setPanelTabs(A, { tabs: [files, terminal], activeTabId: terminal.id });
    expect(s().panelSurfaces.stacks[A]).toEqual([files.id]); // a write of refs chooses nothing
    s().showSurfaceTab(A, terminal.id);
    expect(s().panelSurfaces.stacks[A]).toEqual([terminal.id]);
    s().setPanelTabs(A, { tabs: [files, terminal, browser], activeTabId: browser.id });
    s().showSurfaceTab(A, browser.id);
    expect(s().panelSurfaces.stacks[A]).toEqual([browser.id]);
    expect(s().effectivePanelTabs(A)).toEqual([files, terminal, browser]);
    expect(s().panelParams).toEqual({ [files.id]: { path: '/repo' } });
  });

  it('a tab in view that closes gives way to its right-hand neighbour, else the last; hiding keeps every ref', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    const another = { ...files, id: 'files-2' };
    s().setPanelTabs(A, { tabs: [files, terminal, another], activeTabId: null });
    s().showSurfaceTab(A, terminal.id);
    s().setPanelTabs(A, { tabs: [files, another], activeTabId: terminal.id });
    expect(surfaceTabs(s(), A)).toEqual([another]);
    s().setPanelTabs(A, { tabs: [files], activeTabId: another.id });
    expect(surfaceTabs(s(), A)).toEqual([files]);
    s().hideSurfaces(A);
    expect(surfaceTabs(s(), A)).toEqual([]);
    expect(s().panelBySession.get(A)?.activeTabId).toBe(files.id); // shown again with the column
    expect(s().effectivePanelTabs(A)).toEqual([files]);
  });

  it('closing the tab in view in the lower group shows the lower group’s next tab, another of its tool', () => {
    const store = createLayoutStore();
    const another = { ...files, id: 'files-2' };
    store.getState().setPanelTabs(A, { tabs: [terminal, files, another], activeTabId: null });
    store.getState().showSurfaceTab(A, terminal.id);
    store.getState().moveSurfaceTab(A, another.id, 'lower');
    store.getState().moveSurfaceTab(A, files.id, 'lower');
    expect(surfaceTabs(store.getState(), A)).toEqual([terminal, files]);
    store.getState().setPanelTabs(A, { tabs: [terminal, another], activeTabId: terminal.id });
    expect(surfaceTabs(store.getState(), A)).toEqual([terminal, another]);
  });

  it('two groups in view at most, a pin keeping its place, icon preferences apart from tab pins, and a hide that keeps both', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    const another = { ...files, id: 'files-2' };
    s().setPanelTabs(A, { tabs: [files, another, terminal, browser], activeTabId: null });
    s().showSurfaceTab(A, another.id);
    s().moveSurfaceTab(A, terminal.id, 'lower');
    expect(surfaceTabs(s(), A)).toEqual([another, terminal]);
    expect(s().panelBySession.get(A)?.activeTabId).toBe(another.id);
    s().toggleSurfacePin('files');
    expect(s().panelSurfaces.pinnedTools).toEqual(['files']);
    expect(s().panelPinned).toEqual([]);
    s().setPanelTabPinned(A, another.id, true);
    expect(surfaceTabs(s(), A)).toEqual([{ ...another, pinned: true }, terminal]);
    expect(s().panelSurfaces.pinnedTools).toEqual(['files']);
    s().toggleSurfacePin('files');
    expect(s().panelSurfaces.pinnedTools).toEqual([]);
    s().hideSurfaces(A);
    expect(surfaceTabs(s(), A)).toEqual([]);
    expect(sideGroups(s(), A)).toMatchObject({ hidden: true, upper: { shown: { id: another.id } }, lower: { shown: { id: terminal.id } } });
    expect(s().effectivePanelTabs(A)).toHaveLength(4);
  });
});

const B = at('app-b' as AppSessionId);
const doc: TabRef = { id: `artifact:${TEST_MACHINE}:doc`, kind: 'artifact', artifactId: 'doc', machine: TEST_MACHINE, pinned: false };
const session = (id: AppSessionId): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
const mainWith = (tabs: TabRef[], activeTabId: string): LayoutMain => storedMain({ ...EMPTY_STRIP, panes: [{ tabs, activeTabId }] });
async function restored(values: Record<string, unknown>, known: (id: AppSessionId) => boolean = () => true) {
  const fake = fakeClient({
    'layout.list': { keys: Object.keys(values) },
    'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }),
    'layout.set': undefined,
  });
  const store = createLayoutStore();
  await store.getState().hydrate(fake.client, known);
  return { store, fake };
}

describe('surface context and restore', () => {
  it('keeps the active session as the strip’s context across a document tab', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().openSession(A, { how: 'tab' });
    s().openSession(B, { how: 'tab' });
    s().activateTab(session(A).id);
    s().openTab({ kind: 'artifact', artifactId: 'doc', machine: TEST_MACHINE });
    expect(surfaceSession(s())).toBe(A);
    expect(s().panelSurfaces.contexts).toEqual({ [NO_PROJECT]: A });
    s().openTab({ kind: 'diagnostics' });
    expect(surfaceSession(s())).toBe(A);
    s().closeTab(session(A).id);
    expect(surfaceSession(s())).toBe(B);
    s().closeTab(session(B).id);
    expect(surfaceSession(s())).toBeNull();
  });

  it('upgrades a saved single-tool layout by deriving its active id, preserving refs, pins, params and saved width', async () => {
    const pin = { ...terminal, pinned: true };
    const values = {
      'main.tabs': mainWith([session(A)], session(A).id),
      regions: { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 317 } },
      'panel.pinned': [pin],
      [`panel.${A}`]: { tabs: [files, browser], activeTabId: browser.id },
      'panelTools.params': { version: 1, params: { [browser.id]: { url: 'https://example.test' } } },
      'panelTools.activeNoSession': { version: 1, activeTabId: terminal.id },
    };
    const { store } = await restored(values);
    const state = store.getState();
    expect(surfaceTabs(state, A)).toEqual([browser]);
    expect(surfaceTabs(state, null)).toEqual([pin]);
    expect(state.panelSurfaces.stacks).toEqual({});
    expect(state.effectivePanelTabs(A)).toEqual([pin, files, browser]);
    expect(state.panelParams).toEqual({ [browser.id]: { url: 'https://example.test' } });
    expect(state.regions.sidebar.width).toBe(317);
  });

  it('ignores stale contexts and stack ids only when deriving, without resetting other stored scopes', async () => {
    const saved: PanelSurfaces = {
      version: 2,
      stacks: { [A]: ['gone', files.id], [B]: [browser.id], '@none': [] },
      pinnedTools: ['files', 'not-registered-yet'],
      contexts: { [NO_PROJECT]: 'gone' as AppSessionId },
    };
    const { store } = await restored({
      'main.tabs': mainWith([session(A), doc], doc.id),
      [`panel.${A}`]: { tabs: [files], activeTabId: files.id },
      'panelTools.surfaces': saved,
    }, (id) => id === A);
    expect(surfaceSession(store.getState())).toBe(A);
    expect(surfaceTabs(store.getState(), A)).toEqual([files]);
    expect(surfaceTabs(store.getState(), null)).toEqual([]);
    expect(store.getState().panelSurfaces).toEqual(saved);
    // A known session with no tab in the strip is not its context either.
    store.setState({ knownSession: () => true, panelSurfaces: { ...saved, contexts: { [NO_PROJECT]: B } } });
    expect(surfaceSession(store.getState())).toBe(A);
  });

  it('two tabs of one tool stored in view read as two groups without altering their saved ids, and follow live known-session changes', async () => {
    const another = { ...files, id: 'files-2' };
    let live = true;
    const saved: PanelSurfaces = { version: 2, stacks: { [A]: [files.id, another.id] }, pinnedTools: [], contexts: { [NO_PROJECT]: A } };
    const { store } = await restored({
      'main.tabs': mainWith([session(A), doc], doc.id),
      [`panel.${A}`]: { tabs: [files, another], activeTabId: another.id },
      'panelTools.surfaces': saved,
    }, () => live);
    expect(surfaceTabs(store.getState(), A)).toEqual([files, another]);
    expect(sideGroups(store.getState(), A).lower?.tabs).toEqual([another]);
    expect(surfaceSession(store.getState())).toBe(A);
    live = false;
    expect(surfaceSession(store.getState())).toBeNull();
    expect(store.getState().panelSurfaces).toEqual(saved);
  });

  it('replays an early icon preference over saved preferences rather than replacing the saved surface state', async () => {
    const saved: PanelSurfaces = { version: 2, stacks: { [B]: [browser.id] }, pinnedTools: ['terminal'], contexts: { [NO_PROJECT]: B } };
    const fake = fakeClient({
      'layout.list': { keys: ['panelTools.surfaces'] },
      'layout.get': ({ key }: { key: string }) => ({ value: key === 'panelTools.surfaces' ? saved : null }),
      'layout.set': undefined,
    });
    const store = createLayoutStore();
    const pending = store.getState().hydrate(fake.client, () => true);
    store.getState().toggleSurfacePin('files');
    await pending;
    const replayed = { ...saved, pinnedTools: ['terminal', 'files'] };
    expect(store.getState().panelSurfaces).toEqual(replayed);
    expect(fake.invoked('layout.set')).toContainEqual({ key: 'panelTools.surfaces', value: replayed });
  });

  it('writes and restores two groups in view, a hidden column, tool preferences and project context', async () => {
    vi.useFakeTimers();
    let stop: (() => void) | undefined;
    try {
      const { store, fake } = await restored({});
      stop = persistLayout(fake.client, store);
      const s = () => store.getState();
      s().openSession(A);
      s().setPanelTabs(A, { tabs: [files, terminal, browser], activeTabId: files.id });
      s().showSurfaceTab(A, files.id);
      s().moveSurfaceTab(A, terminal.id, 'lower');
      s().toggleSurfacePin('browser');
      s().hideSurfaces(null);
      await vi.advanceTimersByTimeAsync(LAYOUT_WRITE_DELAY_MS);
      const writes = fake.invoked('layout.set') as { key: string; value: unknown }[];
      const surfaces = writes.filter((write) => write.key === 'panelTools.surfaces');
      expect(surfaces).toEqual([{ key: 'panelTools.surfaces', value: {
        version: 2, stacks: { [A]: [files.id, terminal.id], '@none': [] }, pinnedTools: ['browser'], contexts: { [NO_PROJECT]: A },
      } }]);
      const { store: again } = await restored(Object.fromEntries(writes.map(({ key, value }) => [key, value])));
      expect(surfaceSession(again.getState())).toBe(A);
      expect(surfaceTabs(again.getState(), A)).toEqual([files, terminal]);
      expect(again.getState().panelSurfaces).toEqual(s().panelSurfaces);
    } finally {
      stop?.();
      vi.useRealTimers();
    }
  });
});
