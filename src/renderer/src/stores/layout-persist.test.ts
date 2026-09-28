import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { createLayoutStore, LAYOUT_WRITE_DELAY_MS, persistLayout } from './layout';

const A = 'app-a' as AppSessionId;

// A store persisting through a fake main whose layout.json holds the three fixed keys at their defaults, then `values`
// (an `undefined` value leaves that key out).
function setup(given: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { regions: LAYOUT_DEFAULTS.regions, 'main.tabs': LAYOUT_DEFAULTS.main, 'panel.pinned': [], ...given };
  const fake = fakeClient({
    'layout.list': { keys: Object.keys(values) },
    'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }),
    'layout.set': undefined,
  });
  const store = createLayoutStore();
  const stop = persistLayout(fake.client, store);
  const hydrate = async (known: (id: AppSessionId) => boolean = () => true) => {
    const hydrating = store.getState().hydrate(fake.client, known);
    await vi.runAllTimersAsync();
    await hydrating;
  };
  return { store, stop, hydrate, sets: () => fake.invoked('layout.set') as { key: string; value: unknown }[] };
}

describe('layout persistence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes nothing before hydration, and hydration writes only the keys layout.json lacks', async () => {
    const regions = { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 410 } };
    const { store, hydrate, sets } = setup({ regions, 'main.tabs': undefined });
    store.getState().setSidebar({ width: 260 }); // the persisted value is not known yet: writing now would clobber it
    vi.advanceTimersByTime(1000);
    expect(sets()).toEqual([]);
    await hydrate();
    vi.advanceTimersByTime(1000);
    expect(sets()).toEqual([{ key: 'main.tabs', value: LAYOUT_DEFAULTS.main }]); // a first launch materialises the default
    expect(store.getState().regions.sidebar.width).toBe(410);
  });

  it('a key that failed to read is not overwritten with its default', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeClient({ 'layout.list': { keys: [] }, 'layout.get': ({ key }: { key: string }) => ({ value: key === 'regions' ? LAYOUT_DEFAULTS.regions : [] }), 'layout.set': undefined });
    const failing = { ...fake.client, invoke: (name: never, input: never) => (name === 'layout.get' && (input as { key: string }).key === 'main.tabs' ? Promise.resolve({ ok: false, error: { code: 'internal', message: 'x' } }) : fake.client.invoke(name, input)) } as typeof fake.client;
    const store = createLayoutStore();
    await store.getState().hydrate(failing, () => true);
    expect(fake.invoked('layout.set')).toEqual([]);
    error.mockRestore();
  });

  it('sends only the changed key, 250 ms after its last change', async () => {
    const { store, hydrate, sets } = setup();
    await hydrate();
    store.getState().setSidebar({ width: 260 });
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS - 50);
    store.getState().setSidebar({ width: 240 });
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS - 1);
    expect(sets()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sets()).toEqual([{ key: 'regions', value: { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 240 } } }]);
  });

  it('debounces each key on its own', async () => {
    const { store, hydrate, sets } = setup();
    await hydrate();
    store.getState().setPanel({ collapsed: true });
    vi.advanceTimersByTime(200);
    store.getState().openTab({ kind: 'diagnostics' });
    vi.advanceTimersByTime(50);
    expect(sets().map((s) => s.key)).toEqual(['regions']);
    vi.advanceTimersByTime(200);
    expect(sets().map((s) => s.key)).toEqual(['regions', 'main.tabs']);
  });

  it('writes the global pins and a session’s own panel tabs to their keys', async () => {
    const { store, hydrate, sets } = setup({ 'panel.app-a': { tabs: [{ id: 't1', toolId: 'files', pinned: false }], activeTabId: 't1' } });
    await hydrate((id) => id === A);
    store.getState().setPanelTabPinned(A, 't1', true);
    vi.advanceTimersByTime(LAYOUT_WRITE_DELAY_MS);
    expect(sets()).toEqual([
      { key: 'panel.pinned', value: [{ id: 't1', toolId: 'files', pinned: true }] },
      { key: 'panel.app-a', value: { tabs: [], activeTabId: 't1' } },
    ]);
  });

  it('flushes a pending write on beforeunload', async () => {
    const { store, hydrate, sets } = setup();
    await hydrate();
    store.getState().setSidebar({ collapsed: true });
    window.dispatchEvent(new Event('beforeunload'));
    expect(sets().map((s) => s.key)).toEqual(['regions']);
    vi.advanceTimersByTime(1000);
    expect(sets()).toHaveLength(1); // flushed, not written twice
  });

  it('flushes on stop and then stops listening', async () => {
    const { store, hydrate, sets, stop } = setup();
    await hydrate();
    store.getState().setSidebar({ width: 222 });
    stop();
    expect(sets()).toHaveLength(1);
    store.getState().setSidebar({ width: 333 });
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('beforeunload'));
    expect(sets()).toHaveLength(1);
  });
});

describe('panel tabs from the host', () => {
  it('splits the pinned refs into panel.pinned and the rest into the session’s own key', () => {
    const store = createLayoutStore();
    store.getState().setPanelTabs(A, {
      tabs: [
        { id: 'p', toolId: 'terminal', pinned: true },
        { id: 'o', toolId: 'files', pinned: false },
      ],
      activeTabId: 'o',
    });
    expect(store.getState().panelPinned).toEqual([{ id: 'p', toolId: 'terminal', pinned: true }]);
    expect(store.getState().panelBySession.get(A)).toEqual({ tabs: [{ id: 'o', toolId: 'files', pinned: false }], activeTabId: 'o' });
    expect(store.getState().effectivePanelTabs(A).map((t) => t.id)).toEqual(['p', 'o']);
  });

  it('with no session keeps only the pins', () => {
    const store = createLayoutStore();
    store.getState().setPanelTabs(null, { tabs: [{ id: 'p', toolId: 'terminal', pinned: true }, { id: 'o', toolId: 'files', pinned: false }], activeTabId: 'p' });
    expect(store.getState().panelPinned.map((t) => t.id)).toEqual(['p']);
    expect(store.getState().panelBySession.size).toBe(0);
  });
});
