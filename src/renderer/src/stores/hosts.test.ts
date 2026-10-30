import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult, HostState, MawsBridge } from '@shared/ipc/schema';
import type { HostStatus } from '@shared/ipc/schema/host';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { createHostsStore } from './hosts';

type SnapshotName = 'engine.hostState' | 'pty.hostState' | 'host.status'; // E10: the supervisor's status
type Payload<N extends SnapshotName> = N extends 'host.status' ? HostStatus : HostState;

// A client whose snapshot replies the test releases by hand, so event/reply orderings can be staged.
function fakeClient() {
  const listeners = new Map<string, Set<(payload: unknown, from: { machine: MachineRef }) => void>>();
  const pending: Record<SnapshotName, ((result: CommandResult<SnapshotName>) => void)[]> = {
    'engine.hostState': [],
    'pty.hostState': [],
    'host.status': [],
  };
  const calls: string[] = [];
  const client = {
    localMachine: TEST_MACHINE,
    invoke: vi.fn((name: SnapshotName) => {
      calls.push(`invoke ${name}`);
      return new Promise<CommandResult<SnapshotName>>((resolve) => pending[name].push(resolve));
    }),
    on: vi.fn((name: string, listener: (payload: unknown, from: { machine: MachineRef }) => void) => {
      calls.push(`on ${name}`);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }),
  };
  return {
    client: client as unknown as MawsBridge,
    calls,
    event: <N extends SnapshotName>(name: N, payload: Payload<N>, machine: MachineRef = TEST_MACHINE) => listeners.get(name)?.forEach((l) => l(payload, { machine })),
    roster: (machines: MachineState[]) => listeners.get('machines.changed')?.forEach((l) => l({ machines }, { machine: TEST_MACHINE })),
    reply: async <N extends SnapshotName>(name: N, index: number, payload: Payload<N>) => {
      pending[name][index]({ ok: true, value: payload } as CommandResult<SnapshotName>);
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

  it('subscribes to both host-state events and the supervisor’s status before asking for any snapshot', () => {
    const fake = fakeClient();
    createHostsStore(fake.client).getState().connect();
    expect(fake.calls).toEqual([
      'on engine.hostState',
      'on pty.hostState',
      'on host.status',
      'on machines.changed',
      'invoke engine.hostState',
      'invoke pty.hostState',
      'invoke host.status',
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

// E10 Task 3.2 (E10 execution document, Interfaces "Renderer and copy"): main's `host.status`, event and snapshot, with
// no revision: an event is always the newest word, and a snapshot applies only if no event arrived since it was asked.
describe('renderer hosts store: the supervisor’s status', () => {
  const status = (liveSessions: number, state: HostStatus['state'] = 'ready'): HostStatus => ({
    transport: 'detached',
    state,
    supervisor: state === 'ready' ? { mode: 'detached', pid: 48213, startedAt: '2026-10-06T14:02:00.000Z', buildId: 'b', protocol: 1, wire: 'w', liveSessions, rows: liveSessions, idleExitMs: 600_000, idleExitAt: null, exitWhenIdle: false, socketPath: '/s', logPath: '/l', orphansKilled: 0 } : null,
    appBuildId: 'b',
    appWire: 'w',
    mainBuild: { version: '0.0.0', commit: 'ac8724a6', builtAt: '2026-10-08T09:05:53.000Z' },
    matches: state === 'ready' ? 'same' : null,
    reason: null,
    waitingLiveSessions: null,
    lastExit: null,
    daemon: null, // P5 O2 M7
    daemonUnavailable: null,
  });

  it('is null until main answers, then the snapshot', async () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    expect(store.getState().supervisor).toBeNull();
    store.getState().connect();
    await fake.reply('host.status', 0, status(3));
    expect(store.getState().supervisor).toEqual(status(3));
  });

  it('follows every event, and an event wins over a snapshot that lands after it', async () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    store.getState().connect();
    fake.event('host.status', status(0, 'starting'));
    await fake.reply('host.status', 0, status(3));
    expect(store.getState().supervisor).toEqual(status(0, 'starting'));
    fake.event('host.status', status(2));
    expect(store.getState().supervisor).toEqual(status(2));
  });

  it('ignores the snapshot of a disconnected connection and stops listening when disconnected', async () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    store.getState().connect()();
    const disconnect = store.getState().connect();
    await fake.reply('host.status', 0, status(3));
    expect(store.getState().supervisor).toBeNull();
    await fake.reply('host.status', 1, status(1));
    expect(store.getState().supervisor).toEqual(status(1));
    disconnect();
    fake.event('host.status', status(5));
    expect(store.getState().supervisor).toEqual(status(1));
  });
});

// P5 O6 M4: the hosts per machine, each event kept by the machine it came from.
describe('renderer hosts store: another machine’s hosts', () => {
  const machine = (ref: MachineRef, state: MachineState['state'], generation: number): MachineState => ({ ref, name: ref, local: ref === TEST_MACHINE, state, since: '2026-10-27T10:00:00Z', generation });
  const roster = (other: MachineState['state'], generation: number) => [machine(TEST_MACHINE, 'up', 0), machine(OTHER_MACHINE, other, generation)];

  it('keeps another machine’s host events apart from the local machine’s', async () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    store.getState().connect();
    await fake.reply('engine.hostState', 0, state('ready', 11, 1));
    fake.event('engine.hostState', state('crashed', 99, 7), OTHER_MACHINE);
    expect(store.getState().hosts.engine).toEqual(state('ready', 11, 1));
    expect(store.getState().byMachine.get(OTHER_MACHINE)?.engine).toEqual(state('crashed', 99, 7));
    expect(store.getState().byMachine.get(TEST_MACHINE)?.engine).toEqual(state('ready', 11, 1));
  });

  it('forgets another machine’s hosts when its link goes down or comes up as a new generation, and not on the first list', () => {
    const fake = fakeClient();
    const store = createHostsStore(fake.client);
    store.getState().connect();
    fake.event('pty.hostState', state('ready', 5, 9), OTHER_MACHINE);
    fake.roster(roster('up', 3)); // the generation these came from
    expect(store.getState().byMachine.get(OTHER_MACHINE)?.pty).toEqual(state('ready', 5, 9));
    fake.roster(roster('down', 3));
    expect(store.getState().byMachine.has(OTHER_MACHINE)).toBe(false);
    fake.roster(roster('up', 4));
    // The new generation's revisions start afresh: a low one is taken.
    fake.event('pty.hostState', state('ready', 6, 1), OTHER_MACHINE);
    expect(store.getState().byMachine.get(OTHER_MACHINE)?.pty).toEqual(state('ready', 6, 1));
    fake.roster(roster('up', 5));
    expect(store.getState().byMachine.has(OTHER_MACHINE)).toBe(false);
  });
});
