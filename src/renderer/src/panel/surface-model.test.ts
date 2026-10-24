import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, type LayoutMain, type PanelSurfaces, type TabRef } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { createLayoutStore, LAYOUT_WRITE_DELAY_MS, persistLayout } from '../stores/layout';
import { surfaceSession, surfaceTabs } from './surface-model';

const A = 'app-a' as AppSessionId;
const files = { id: 'files-1', toolId: 'files', pinned: false };
const terminal = { id: 'terminal-1', toolId: 'terminal', pinned: false };
const browser = { id: 'browser-1', toolId: 'browser', pinned: false };

// Dropping the old refs when a third surface replaces the bottom would lose its tool state.
describe('surface stacks', () => {
  it('appends a second tool and replaces only the bottom surface with a third, retaining every ref and params', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    s().setPanelTabs(A, { tabs: [files], activeTabId: files.id });
    expect(s().panelSurfaces.stacks[A]).toEqual([files.id]);
    s().setPanelParams(files.id, { path: '/repo' });
    s().setPanelTabs(A, { tabs: [files, terminal], activeTabId: terminal.id });
    expect(s().panelSurfaces.stacks[A]).toEqual([files.id, terminal.id]);
    s().setPanelTabs(A, { tabs: [files, terminal, browser], activeTabId: browser.id });
    expect(s().panelSurfaces.stacks[A]).toEqual([files.id, browser.id]);
    expect(s().effectivePanelTabs(A)).toEqual([files, terminal, browser]);
    expect(s().panelParams).toEqual({ [files.id]: { path: '/repo' } });
  });

  it('changes tabs of the same tool in place, removes closed ids and explicitly clears to the summary', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    const another = { ...files, id: 'files-2' };
    const tabs = [files, terminal, another];
    s().setPanelTabs(A, { tabs, activeTabId: files.id });
    s().setPanelTabs(A, { tabs, activeTabId: terminal.id });
    s().setPanelTabs(A, { tabs, activeTabId: another.id });
    expect(surfaceTabs(s(), A)).toEqual([another, terminal]);
    s().setPanelTabs(A, { tabs: [files, another], activeTabId: another.id });
    expect(s().panelSurfaces.stacks[A]).toEqual([another.id]);
    s().setPanelTabs(A, { tabs: [files, another], activeTabId: null });
    expect(surfaceTabs(s(), A)).toEqual([]);
    expect(s().effectivePanelTabs(A)).toEqual([files, another]);
  });

  it('keeps a tool in its slot when closing its selected tab activates another tab of that same tool', () => {
    const store = createLayoutStore();
    const another = { ...files, id: 'files-2' };
    store.getState().setPanelTabs(A, { tabs: [files, another, terminal], activeTabId: files.id });
    store.getState().setPanelTabs(A, { tabs: [files, another, terminal], activeTabId: terminal.id });
    store.getState().setPanelTabs(A, { tabs: [another, terminal], activeTabId: another.id });
    expect(surfaceTabs(store.getState(), A)).toEqual([another, terminal]);
  });

  it('sets a bounded, distinct-tool stack without closing refs and keeps icon preferences separate from tab pins', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    const another = { ...files, id: 'files-2' };
    const tabs = [files, another, terminal, browser];
    s().setPanelTabs(A, { tabs, activeTabId: files.id });
    s().setSurfaceStack(A, ['gone', another.id, files.id, terminal.id, browser.id]);
    expect(surfaceTabs(s(), A)).toEqual([another, terminal]);
    expect(s().panelBySession.get(A)?.activeTabId).toBe(terminal.id);
    s().toggleSurfacePin('files');
    expect(s().panelSurfaces.pinnedTools).toEqual(['files']);
    expect(s().panelPinned).toEqual([]);
    s().setPanelTabPinned(A, another.id, true);
    expect(surfaceTabs(s(), A)).toEqual([{ ...another, pinned: true }, terminal]);
    expect(s().panelSurfaces.pinnedTools).toEqual(['files']);
    s().toggleSurfacePin('files');
    expect(s().panelSurfaces.pinnedTools).toEqual([]);
    s().setSurfaceStack(A, []);
    expect(surfaceTabs(s(), A)).toEqual([]);
    expect(s().panelBySession.get(A)?.activeTabId).toBeNull();
    expect(s().effectivePanelTabs(A)).toHaveLength(4);
  });
});

const B = 'app-b' as AppSessionId;
const X = 'project-x' as ProjectId;
const Y = 'project-y' as ProjectId;
const session = (id: AppSessionId): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
const mainWith = (tabs: TabRef[], activeTabId: string): LayoutMain => ({
  ...LAYOUT_DEFAULTS.main,
  current: X,
  sets: { [X]: { ...EMPTY_TAB_SET, panes: [{ tabs, activeTabId }] } },
});
async function restored(values: Record<string, unknown>, known: (id: AppSessionId) => boolean = () => true) {
  const fake = fakeClient({
    'layout.list': { keys: Object.keys(values) },
    'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }),
    'layout.set': undefined,
  });
  const store = createLayoutStore();
  await store.getState().hydrate(fake.client, known, { projectOf: () => X });
  return { store, fake };
}

describe('surface context and restore', () => {
  it('keeps the active session as project context across a document tab, with independent no-project context', () => {
    const store = createLayoutStore();
    const s = () => store.getState();
    store.setState({ projectOf: () => X });
    s().openSession(A, { how: 'tab' });
    s().openSession(B, { how: 'tab' });
    s().activateTab(session(A).id);
    s().openTab({ kind: 'artifact', artifactId: 'doc' });
    expect(surfaceSession(s())).toBe(A);
    expect(s().panelSurfaces.contexts[X]).toBe(A);
    s().setCurrentProject(null);
    store.setState({ projectOf: () => null });
    s().openSession('unfiled' as AppSessionId);
    s().openTab({ kind: 'diagnostics' });
    expect(surfaceSession(s())).toBe('unfiled');
    expect(s().panelSurfaces.contexts[NO_PROJECT]).toBe('unfiled');
    s().setCurrentProject(X);
    expect(surfaceSession(s())).toBe(A);
    s().closeTab(session(A).id);
    expect(surfaceSession(s())).toBe(B);
    s().setCurrentProject(Y);
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
    const doc: TabRef = { id: 'artifact:doc', kind: 'artifact', artifactId: 'doc', pinned: false };
    const saved: PanelSurfaces = {
      version: 1,
      stacks: { [A]: ['gone', files.id], [B]: [browser.id], '@none': [] },
      pinnedTools: ['files', 'not-registered-yet'],
      contexts: { [X]: 'gone' as AppSessionId, [Y]: B },
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
    // A known session from another project is not this project's context either.
    store.setState({ knownSession: () => true, panelSurfaces: { ...saved, contexts: { ...saved.contexts, [X]: B } } });
    expect(surfaceSession(store.getState())).toBe(A);
  });

  it('deduplicates restored tools without altering their saved ids and follows live known-session changes', async () => {
    const another = { ...files, id: 'files-2' };
    const doc: TabRef = { id: 'artifact:doc', kind: 'artifact', artifactId: 'doc', pinned: false };
    let live = true;
    const saved: PanelSurfaces = { version: 1, stacks: { [A]: [files.id, another.id] }, pinnedTools: [], contexts: { [X]: A } };
    const { store } = await restored({
      'main.tabs': mainWith([session(A), doc], doc.id),
      [`panel.${A}`]: { tabs: [files, another], activeTabId: another.id },
      'panelTools.surfaces': saved,
    }, () => live);
    expect(surfaceTabs(store.getState(), A)).toEqual([files]);
    expect(surfaceSession(store.getState())).toBe(A);
    live = false;
    expect(surfaceSession(store.getState())).toBeNull();
    expect(store.getState().panelSurfaces).toEqual(saved);
  });

  it('replays an early icon preference over saved preferences rather than replacing the saved surface state', async () => {
    const saved: PanelSurfaces = { version: 1, stacks: { [B]: [browser.id] }, pinnedTools: ['terminal'], contexts: { [Y]: B } };
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

  it('writes and restores stack order, summary, tool preferences and project context through the new key', async () => {
    vi.useFakeTimers();
    let stop: (() => void) | undefined;
    try {
      const { store, fake } = await restored({});
      stop = persistLayout(fake.client, store);
      const s = () => store.getState();
      s().openSession(A);
      s().setPanelTabs(A, { tabs: [files, terminal, browser], activeTabId: files.id });
      s().setPanelTabs(A, { tabs: s().effectivePanelTabs(A), activeTabId: terminal.id });
      s().toggleSurfacePin('browser');
      s().setSurfaceStack(null, []);
      await vi.advanceTimersByTimeAsync(LAYOUT_WRITE_DELAY_MS);
      const writes = fake.invoked('layout.set') as { key: string; value: unknown }[];
      const surfaces = writes.filter((write) => write.key === 'panelTools.surfaces');
      expect(surfaces).toEqual([{ key: 'panelTools.surfaces', value: {
        version: 1, stacks: { [A]: [files.id, terminal.id], '@none': [] }, pinnedTools: ['browser'], contexts: { [X]: A },
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
