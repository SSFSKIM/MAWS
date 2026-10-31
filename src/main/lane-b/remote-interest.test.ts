// The tabs of RL2 machines (P5 O7 M2, "Subscriptions follow the tabs"): every session or agent tab in `main.tabs` whose
// address is another machine's that an RL2 link reaches is held open; one whose last tab closed is let go
// UNSUBSCRIBE_LINGER_MS later, unless a tab holds it again first.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { createRemoteInterest, remoteSessionsInTabs } from './remote-interest';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const MINI = 'MiniMachineRef00000000' as MachineRef;
const SOCKET = 'SocketMachineRef000000' as MachineRef;
const at = (machine: MachineRef, id: string) => addressOf(machine, id as AppSessionId);
const session = (address: string) => ({ id: `session:${address}`, kind: 'session', appSessionId: address, pinned: false });
const agent = (address: string) => ({ id: `agent:${address}:a1`, kind: 'agent', appSessionId: address, agentId: 'a1', pinned: false });
const tabs = (...open: Array<ReturnType<typeof session>>) => ({ version: 3, current: NO_PROJECT, sets: { [NO_PROJECT]: { panes: [{ tabs: open, activeTabId: open[0]?.id ?? '' }], focusedPane: 0, splitRatio: 0.5 } }, closedTabs: [] });

function layout(value: unknown) {
  const listeners = new Set<(key: string) => void>();
  const store = {
    value,
    get: (key: string) => (key === 'main.tabs' ? store.value : null),
    onChange: (listener: (key: string) => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    write(next: unknown) {
      store.value = next;
      for (const listener of listeners) listener('main.tabs');
    },
    listeners,
  };
  return store;
}

describe('remoteSessionsInTabs', () => {
  it('groups every other machine’s session and agent tab by machine, the local machine’s and the closed tabs left out', () => {
    const value = { ...tabs(session(at(MINI, 'a')), agent(at(MINI, 'b')), session(at(LOCAL, 'c')), session(at(SOCKET, 'd'))), closedTabs: [session(at(MINI, 'z'))] };
    const held = remoteSessionsInTabs(value, LOCAL);
    expect([...held.keys()].sort()).toEqual([MINI, SOCKET].sort());
    expect([...held.get(MINI)!].sort()).toEqual(['a', 'b']);
    expect(remoteSessionsInTabs('not a layout', LOCAL).size).toBe(0);
  });
});

describe('createRemoteInterest', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness(value: unknown) {
    const store = layout(value);
    const calls: string[] = [];
    const interest = createRemoteInterest({
      layout: store,
      local: LOCAL,
      isRemote: (machine) => machine === MINI,
      lingerMs: 10_000,
      open: (machine, app) => void calls.push(`open ${machine}/${app}`),
      close: (machine, app) => void calls.push(`close ${machine}/${app}`),
    });
    return { store, calls, interest };
  }

  it('opens an RL2 machine’s tabs at once, never a socket-linked or the local machine’s, and again at each write (opening is idempotent)', () => {
    const { store, calls } = harness(tabs(session(at(MINI, 'a')), session(at(SOCKET, 'd')), session(at(LOCAL, 'c'))));
    expect(calls).toEqual([`open ${MINI}/a`]);
    store.write(tabs(session(at(MINI, 'a')), session(at(MINI, 'b'))));
    expect(calls).toEqual([`open ${MINI}/a`, `open ${MINI}/a`, `open ${MINI}/b`]);
  });

  it('closes a session its last tab let go of only after the linger, and not if a tab holds it again first', () => {
    const { store, calls } = harness(tabs(session(at(MINI, 'a')), session(at(MINI, 'b'))));
    calls.length = 0;
    store.write(tabs(session(at(MINI, 'b'))));
    vi.advanceTimersByTime(9_999);
    expect(calls).toEqual([`open ${MINI}/b`]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([`open ${MINI}/b`, `close ${MINI}/a`]);
    calls.length = 0;
    // Switched away and back within the linger: one stream throughout.
    store.write(tabs());
    vi.advanceTimersByTime(5_000);
    store.write(tabs(session(at(MINI, 'b'))));
    vi.advanceTimersByTime(20_000);
    expect(calls).toEqual([`open ${MINI}/b`]);
  });

  it('reads the tabs again at `refresh` (a link created or closed): a machine that became RL2 opens, one that stopped is let go at once', () => {
    let rl2 = new Set<MachineRef>();
    const store = layout(tabs(session(at(SOCKET, 'd'))));
    const calls: string[] = [];
    const interest = createRemoteInterest({ layout: store, local: LOCAL, isRemote: (m) => rl2.has(m), lingerMs: 10_000, open: (m, app) => void calls.push(`open ${m}/${app}`), close: (m, app) => void calls.push(`close ${m}/${app}`) });
    expect(calls).toEqual([]);
    rl2 = new Set([SOCKET]);
    interest.refresh();
    expect(calls).toEqual([`open ${SOCKET}/d`]);
    rl2 = new Set();
    interest.refresh();
    expect(calls).toEqual([`open ${SOCKET}/d`, `close ${SOCKET}/d`]);
  });

  it('stops: no listener left, no close pending', () => {
    const { store, calls, interest } = harness(tabs(session(at(MINI, 'a'))));
    store.write(tabs());
    interest.stop();
    vi.advanceTimersByTime(20_000);
    expect(store.listeners.size).toBe(0);
    expect(calls).toEqual([`open ${MINI}/a`]);
  });
});
