import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult, MawsBridge, SettingsState } from '@shared/ipc/schema';
import { createSettingsStore } from './settings';

const LIGHT: SettingsState = { settings: { version: 1, theme: 'light' }, resolvedTheme: 'light' };
const DARK: SettingsState = { settings: { version: 1, theme: 'dark' }, resolvedTheme: 'dark' };

// A client whose `settings.get` answer the test releases by hand, so event/snapshot ordering can be staged.
function fakeClient() {
  let changed: ((state: SettingsState) => void) | null = null;
  let releaseGet: (result: CommandResult<'settings.get'>) => void = () => {};
  const client = {
    invoke: vi.fn((name: string, input: unknown) => {
      if (name === 'settings.get') return new Promise((resolve) => (releaseGet = resolve));
      if (name === 'settings.set') {
        const theme = (input as { theme: 'dark' }).theme;
        return Promise.resolve({ ok: true, value: { settings: { version: 1, theme }, resolvedTheme: theme } });
      }
      throw new Error(name);
    }),
    on: vi.fn((_name: string, listener: (state: SettingsState) => void) => {
      changed = listener;
      return () => (changed = null);
    }),
  };
  return {
    client: client as unknown as MawsBridge,
    raw: client,
    emitChanged: (state: SettingsState) => changed?.(state),
    releaseGet: (result: CommandResult<'settings.get'>) => releaseGet(result),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('renderer settings store', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('subscribes to settings.changed before asking for the snapshot, then takes the snapshot', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    expect(store.getState().state).toBeNull();
    store.getState().connect();
    expect(fake.raw.on).toHaveBeenCalledBefore(fake.raw.invoke);
    fake.releaseGet({ ok: true, value: LIGHT });
    await flush();
    expect(store.getState().state).toEqual(LIGHT);
  });

  it('keeps an event that arrived while the snapshot was in flight', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    store.getState().connect();
    fake.emitChanged(DARK);
    fake.releaseGet({ ok: true, value: LIGHT });
    await flush();
    expect(store.getState().state).toEqual(DARK);
  });

  it('follows every later settings.changed', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    store.getState().connect();
    fake.releaseGet({ ok: true, value: LIGHT });
    await flush();
    fake.emitChanged(DARK);
    expect(store.getState().state).toEqual(DARK);
  });

  it('stops listening when disconnected', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    const disconnect = store.getState().connect();
    fake.releaseGet({ ok: true, value: LIGHT });
    await flush();
    disconnect();
    fake.emitChanged(DARK);
    expect(store.getState().state).toEqual(LIGHT);
  });

  it('setTheme asks main and applies main’s answer', async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    await store.getState().setTheme('dark');
    expect(fake.raw.invoke).toHaveBeenCalledWith('settings.set', { theme: 'dark' });
    expect(store.getState().state).toEqual(DARK);
  });

  it('logs a failed snapshot and leaves the state unknown', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    store.getState().connect();
    fake.releaseGet({ ok: false, error: { code: 'internal', message: 'boom' } });
    await flush();
    expect(store.getState().state).toBeNull();
    expect(log).toHaveBeenCalledOnce();
  });
});
