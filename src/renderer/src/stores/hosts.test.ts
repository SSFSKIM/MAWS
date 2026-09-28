import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult, HostState, MawsBridge } from '@shared/ipc/schema';
import { createHostsStore } from './hosts';

type SnapshotName = 'engine.hostState' | 'pty.hostState';

// A client whose snapshot replies the test releases by hand, so event/reply orderings can be staged.
function fakeClient() {
  const listeners = new Map<string, Set<(state: HostState) => void>>();
  const pending: Record<SnapshotName, ((result: CommandResult<SnapshotName>) => void)[]> = {
    'engine.hostState': [],
    'pty.hostState': [],
  };
  const calls: string[] = [];
  const client = {
    invoke: vi.fn((name: SnapshotName) => {
      calls.push(`invoke ${name}`);
      return new Promise<CommandResult<SnapshotName>>((resolve) => pending[name].push(resolve));
    }),
    on: vi.fn((name: string, listener: (state: HostState) => void) => {
      calls.push(`on ${name}`);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }),
  };
  return {
    client: client as unknown as MawsBridge,
    calls,
    event: (name: SnapshotName, state: HostState) => listeners.get(name)?.forEach((l) => l(state)),
    reply: async (name: SnapshotName, index: number, state: HostState) => {
      pending[name][index]({ ok: true, value: state });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const state = (s: HostState['state'], pid: number | null, revision: number, restarts = 0): HostState => ({
  state: s,
  pid,
  restarts,
  revision,
});

describe('renderer hosts store', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('subscribes to both host-state events before asking for either snapshot', () => {
    const fake = fakeClient();
    createHostsStore(fake.client).getState().connect();
    expect(fake.calls).toEqual([
      'on engine.hostState',
      'on pty.hostState',
      'invoke engine.hostState',
      'invoke pty.hostState',
    ]);
  });

  it('shows the snapshots of hosts that were ready before the page arrived', async () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    expect(store.getState().hosts).toEqual({ engine: null, pty: null });
    store.getState().connect();
    await fake.reply('engine.hostState', 0, state('ready', 11, 1));
    await fake.reply('pty.hostState', 0, state('ready', 22, 1));
    expect(store.getState().hosts).toEqual({ engine: state('ready', 11, 1), pty: state('ready', 22, 1) });
  });

  it('keeps an event newer than a snapshot that lands after it', async () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    store.getState().connect();
    fake.event('pty.hostState', state('crashed', 22, 2));
    await fake.reply('pty.hostState', 0, state('ready', 22, 1));
    expect(store.getState().hosts.pty).toEqual(state('crashed', 22, 2));
  });

  it('takes a snapshot newer than an event on the other host', async () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    store.getState().connect();
    fake.event('engine.hostState', state('ready', 11, 1));
    await fake.reply('pty.hostState', 0, state('ready', 22, 1));
    expect(store.getState().hosts).toEqual({ engine: state('ready', 11, 1), pty: state('ready', 22, 1) });
  });

  it('follows every later transition', async () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    store.getState().connect();
    await fake.reply('pty.hostState', 0, state('ready', 22, 1));
    fake.event('pty.hostState', state('crashed', 22, 2));
    fake.event('pty.hostState', state('restarting', null, 3, 1));
    fake.event('pty.hostState', state('ready', 33, 4, 1));
    expect(store.getState().hosts.pty).toEqual(state('ready', 33, 4, 1));
  });

  it('ignores the snapshot of a disconnected connection (StrictMode remount)', async () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    store.getState().connect()();
    store.getState().connect();
    await fake.reply('engine.hostState', 0, state('ready', 11, 1));
    expect(store.getState().hosts.engine).toBeNull();
    await fake.reply('engine.hostState', 1, state('ready', 11, 1));
    expect(store.getState().hosts.engine).toEqual(state('ready', 11, 1));
  });

  it('stops listening when disconnected', async () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    const disconnect = store.getState().connect();
    await fake.reply('engine.hostState', 0, state('ready', 11, 1));
    disconnect();
    fake.event('engine.hostState', state('crashed', 11, 2));
    expect(store.getState().hosts.engine).toEqual(state('ready', 11, 1));
  });
});
