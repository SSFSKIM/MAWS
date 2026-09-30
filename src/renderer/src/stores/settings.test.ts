import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult, MawsBridge, SettingsState } from '@shared/ipc/schema';
import { createSettingsStore } from './settings';
import { SETTINGS_DEFAULTS_V4 } from '@shared/settings/defaults';

const LIGHT: SettingsState = { settings: { ...SETTINGS_DEFAULTS_V4, theme: 'light' }, resolvedTheme: 'light' };
const DARK: SettingsState = { settings: { ...SETTINGS_DEFAULTS_V4, theme: 'dark' }, resolvedTheme: 'dark' };
const SYSTEM_DARK: SettingsState = { settings: { ...SETTINGS_DEFAULTS_V4, theme: 'system' }, resolvedTheme: 'dark' };

// A client whose replies the test releases by hand, in any order, so event/reply orderings can be staged.
function fakeClient() {
  const listeners = new Set<(state: SettingsState) => void>();
  const pending: Record<'settings.get' | 'settings.set', ((result: CommandResult<'settings.get'>) => void)[]> = {
    'settings.get': [],
    'settings.set': [],
  };
  const client = {
    invoke: vi.fn(
      (name: 'settings.get' | 'settings.set') =>
        new Promise<CommandResult<'settings.get'>>((resolve) => pending[name].push(resolve)),
    ),
    on: vi.fn((_name: string, listener: (state: SettingsState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  return {
    client: client as unknown as MawsBridge,
    raw: client,
    emitChanged: (state: SettingsState) => listeners.forEach((l) => l(state)),
    // Resolves the index-th request of that name (in issue order) with `state`.
    reply: async (name: 'settings.get' | 'settings.set', index: number, result: CommandResult<'settings.get'>) => {
      pending[name][index](result);
      await flush();
    },
  };
}

const ok = (value: SettingsState) => ({ ok: true as const, value });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('renderer settings store', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('subscribes to settings.changed before asking for the snapshot, then takes the snapshot', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    expect(store.getState().state).toBeNull();
    store.getState().connect();
    expect(fake.raw.on).toHaveBeenCalledBefore(fake.raw.invoke);
    await fake.reply('settings.get', 0, ok(LIGHT));
    expect(store.getState().state).toEqual(LIGHT);
  });

  it('keeps an event that arrived while the snapshot was in flight', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    store.getState().connect();
    fake.emitChanged(DARK);
    await fake.reply('settings.get', 0, ok(LIGHT));
    expect(store.getState().state).toEqual(DARK);
  });

  it('follows every later settings.changed', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    store.getState().connect();
    await fake.reply('settings.get', 0, ok(LIGHT));
    fake.emitChanged(DARK);
    expect(store.getState().state).toEqual(DARK);
  });

  it('stops listening when disconnected', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    const disconnect = store.getState().connect();
    await fake.reply('settings.get', 0, ok(LIGHT));
    disconnect();
    fake.emitChanged(DARK);
    expect(store.getState().state).toEqual(LIGHT);
  });

  it('ignores the snapshot of a disconnected connection that lands after a newer event (StrictMode remount)', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    const disconnectFirst = store.getState().connect(); // StrictMode: mount,
    disconnectFirst(); //                                  unmount,
    store.getState().connect(); //                         mount again
    fake.emitChanged(DARK);
    await fake.reply('settings.get', 0, ok(LIGHT)); // the first connection's snapshot, older than the event
    expect(store.getState().state).toEqual(DARK);
    await fake.reply('settings.get', 1, ok(LIGHT)); // the live connection's snapshot, also older than the event
    expect(store.getState().state).toEqual(DARK);
  });

  it('ignores the snapshot of a disconnected connection even when no event arrived', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    store.getState().connect()();
    store.getState().connect();
    await fake.reply('settings.get', 1, ok(DARK));
    await fake.reply('settings.get', 0, ok(LIGHT)); // stale: its connection is gone
    expect(store.getState().state).toEqual(DARK);
  });

  it('setTheme asks main and applies main’s answer', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    const done = store.getState().setTheme('dark');
    expect(fake.raw.invoke).toHaveBeenCalledWith('settings.set', { theme: 'dark' });
    await fake.reply('settings.set', 0, ok(DARK));
    await done;
    expect(store.getState().state).toEqual(DARK);
  });

  it('does not let a delayed settings.set reply replace a newer settings.changed', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    store.getState().connect();
    await fake.reply('settings.get', 0, ok(LIGHT));
    const done = store.getState().setTheme('dark');
    fake.emitChanged(DARK); // main's event for this set
    fake.emitChanged(SYSTEM_DARK); // then another change (a later set from elsewhere)
    await fake.reply('settings.set', 0, ok(DARK)); // the reply arrives last
    await done;
    expect(store.getState().state).toEqual(SYSTEM_DARK);
  });

  it('logs a failed snapshot and leaves the state unknown', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    store.getState().connect();
    await fake.reply('settings.get', 0, { ok: false, error: { code: 'internal', message: 'boom' } });
    expect(store.getState().state).toBeNull();
    expect(log).toHaveBeenCalledOnce();
  });
});
