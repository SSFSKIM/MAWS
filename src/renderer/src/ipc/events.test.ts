import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { digest, item, project, record, status } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerTabRetention } from '../keymap/actions-runtime';
import { createAttentionStore } from '../stores/attention';
import { createLayoutStore } from '../stores/layout';
import { createSessionsStore } from '../stores/sessions';
import { connectShell } from './events';

const A = 'a' as AppSessionId;

function setup(batchMs = 0) {
  const fake = fakeClient({ 'layout.list': { keys: ['main.tabs'] } , 'layout.get': ({ key }: { key: string }) => ({
    value: key === 'main.tabs'
      ? { ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [...LAYOUT_DEFAULTS.main.panes[0].tabs, { id: 'session:a', kind: 'session', appSessionId: 'a', pinned: false }, { id: 'session:gone', kind: 'session', appSessionId: 'gone', pinned: false }], activeTabId: 'overview' }] }
      : null,
  }) });
  const stores = { sessions: createSessionsStore(), attention: createAttentionStore(), layout: createLayoutStore() };
  const disconnect = connectShell(fake.client, stores, { batchMs });
  return { fake, stores, disconnect };
}

async function answerSnapshots(fake: ReturnType<typeof fakeClient>) {
  await fake.reply('session.list', { sessions: [record('a')], revision: 1 });
  await fake.reply('session.projects.list', { projects: [project('p1', 0)], revision: 1 });
  await fake.reply('session.digests', { digests: [digest('a')] });
  await fake.reply('attention.list', [item('a', 'permission', '2026-09-28T10:00:00Z')]);
}

describe('shell event subscription', () => {
  it('subscribes to every event the shell consumes before any snapshot command runs', () => {
    const { fake } = setup();
    const firstInvoke = fake.calls.findIndex((c) => c.startsWith('invoke'));
    const subscriptions = fake.calls.slice(0, firstInvoke);
    expect(subscriptions.sort()).toEqual(
      [
        'attention.changed', 'attention.notified', 'fs.scanProgress', 'session.changed', 'session.digest', 'session.projects.changed', 'session.removed', 'session.status',
      ].map((n) => `on ${n}`),
    );
    expect(fake.calls.slice(firstInvoke).filter((c) => c.startsWith('on'))).toEqual([]);
  });

  it('loads the stores from the snapshots and hydrates the layout against the sessions that exist', async () => {
    const { fake, stores } = setup();
    expect(stores.sessions.getState().loaded).toBe(false);
    await answerSnapshots(fake);
    expect(stores.sessions.getState()).toMatchObject({ loaded: true });
    expect(stores.sessions.getState().records.has(A)).toBe(true);
    expect(stores.attention.getState().loaded).toBe(true);
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:a']);
  });

  it('feeds events to the stores, buffering attention changes until its snapshot lands', async () => {
    const { fake, stores } = setup();
    fake.event('attention.changed', { appSessionId: 'a', items: [] });
    fake.event('session.digest', digest('a', { phase: 'working', revision: 9 }));
    await answerSnapshots(fake);
    expect(stores.attention.getState().bySession.get(A)).toEqual([]);
    expect(stores.sessions.getState().digests.get(A)?.phase).toBe('working');
  });

  it('closes a removed session’s tabs', async () => {
    const { fake, stores } = setup();
    await answerSnapshots(fake);
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    fake.event('session.removed', { appSessionId: 'a', revision: 2 });
    expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview']);
    expect(stores.sessions.getState().records.has(A)).toBe(false);
  });

  it('keeps a session’s tabs when its removal is older than what the store knows', async () => {
    const { fake, stores } = setup();
    await answerSnapshots(fake); // session.list at revision 1
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    fake.event('session.changed', { record: record('a'), cause: 'update', revision: 4 });
    fake.event('session.removed', { appSessionId: 'a', revision: 3 });
    expect(stores.sessions.getState().records.has(A)).toBe(true);
    expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:a']);
  });

  describe('tab retention (C10’s seventh ask)', () => {
    const retentions: (() => void)[] = [];
    afterEach(() => retentions.splice(0).forEach((off) => off()));

    it('with none registered, a record-less tab is dropped on hydrate and a removal closes its tab', async () => {
      const { fake, stores } = setup();
      await answerSnapshots(fake);
      await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
      expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:a']);
      fake.event('session.removed', { appSessionId: 'a', revision: 2 });
      expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview']);
    });

    it('hydration waits for ready, then keeps a record-less tab the retention retains', async () => {
      let ready!: () => void;
      const retains = vi.fn((id: string) => id === 'gone');
      retentions.push(registerTabRetention({ ready: new Promise<void>((resolve) => (ready = resolve)), retains }));
      const { fake, stores } = setup();
      await answerSnapshots(fake);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(stores.layout.getState().hydrated).toBe(false); // still waiting on the intent snapshot
      ready();
      await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
      expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:a', 'session:gone']);
    });

    it('a removal leaves a retained session’s tab open, and closes one it does not retain', async () => {
      retentions.push(registerTabRetention({ ready: Promise.resolve(), retains: (id) => id === 'a' }));
      const { fake, stores } = setup();
      await answerSnapshots(fake);
      await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
      fake.event('session.removed', { appSessionId: 'a', revision: 2 });
      expect(stores.sessions.getState().records.has(A)).toBe(false);
      expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:a']);
      retentions.splice(0).forEach((off) => off());
      retentions.push(registerTabRetention({ ready: Promise.resolve(), retains: () => false }));
      fake.event('session.changed', { record: record('a'), cause: 'update', revision: 3 });
      fake.event('session.removed', { appSessionId: 'a', revision: 4 });
      expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview']);
    });
  });

  it('after a reload, knows a live idle session from the engine table at connect, before any status event', async () => {
    const first = setup();
    first.fake.event('session.status', { appSessionId: 'a', status: status('a') });
    expect(first.stores.sessions.getState().engine.get(A)?.process).toBe('ready');
    first.disconnect();

    // The reload: a fresh page's stores, connected again; the session is idle, so no status event comes.
    const { fake, stores } = setup();
    expect(fake.calls.indexOf('invoke engine.sessions')).toBeGreaterThan(fake.calls.indexOf('on session.status')); // subscribed first
    await answerSnapshots(fake);
    expect(stores.sessions.getState().engine.has(A)).toBe(false);
    await fake.reply('engine.sessions', [status('a'), status('b', { process: 'exited' })]);
    expect(stores.sessions.getState().engine.get(A)).toMatchObject({ process: 'ready', engineState: 'idle' });
    expect(stores.sessions.getState().engine.get('b' as AppSessionId)?.process).toBe('exited');
  });

  it('the engine table overwrites the statuses it lists and keeps the others; a later event wins over it', async () => {
    const { fake, stores } = setup();
    fake.event('session.status', { appSessionId: 'a', status: status('a', { engineState: 'running' }) });
    fake.event('session.status', { appSessionId: 'c', status: status('c') });
    await fake.reply('engine.sessions', [status('a')]); // read after those events, so newer
    expect(stores.sessions.getState().engine.get(A)?.engineState).toBe('idle');
    expect(stores.sessions.getState().engine.has('c' as AppSessionId)).toBe(true);
    fake.event('session.status', { appSessionId: 'a', status: status('a', { process: 'exited' }) });
    expect(stores.sessions.getState().engine.get(A)?.process).toBe('exited');
  });

  it('ignores replies and events after disconnect', async () => {
    const { fake, stores, disconnect } = setup();
    disconnect();
    fake.event('session.digest', digest('a', { revision: 1 }));
    await answerSnapshots(fake);
    expect(stores.sessions.getState().records.size).toBe(0);
    expect(stores.sessions.getState().digests.size).toBe(0);
    expect(stores.attention.getState().loaded).toBe(false);
  });

  // Debt wave 5 (the cold first paint): a cold index announces thousands of records and seed digests within a second;
  // the page takes them a window at a time, so it renders once per window, not once per event.
  describe('the record side, batched per window', () => {
    afterEach(() => vi.useRealTimers());

    it('applies a window’s events together, in arrival order, with one store write per kind; a removal in between still wins over the change before it', async () => {
      const { fake, stores } = setup(16);
      await answerSnapshots(fake);
      await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
      vi.useFakeTimers();
      const writes = vi.fn();
      stores.sessions.subscribe(writes);

      fake.event('fs.scanProgress', { scanned: 0, total: 300 });
      for (let i = 0; i < 200; i++) fake.event('session.changed', { record: record(`s${i}`), cause: 'discovered', revision: 10 + i });
      for (let i = 0; i < 200; i++) fake.event('session.digest', digest(`s${i}`, { phase: 'exited', revision: 1 }));
      fake.event('session.removed', { appSessionId: 's7', revision: 500 });
      fake.event('session.changed', { record: record('s7'), cause: 'facts', revision: 499 }); // older than the removal
      expect(writes).not.toHaveBeenCalled();
      expect(stores.sessions.getState().records.has('s0' as AppSessionId)).toBe(false);

      vi.advanceTimersByTime(16);
      const state = stores.sessions.getState();
      expect(state.records.size).toBe(1 + 200 - 1); // `a`, the 200, less the removed s7
      expect(state.records.has('s7' as AppSessionId)).toBe(false);
      expect(state.digests.get('s199' as AppSessionId)?.phase).toBe('exited');
      expect(state.indexing).toEqual({ scanned: 0, total: 300 });
      expect(writes.mock.calls.length).toBeLessThanOrEqual(5); // progress, changes, digests, the removal (the stale change writes nothing)

      fake.event('fs.scanProgress', { scanned: 300, total: 300 });
      vi.advanceTimersByTime(16);
      expect(stores.sessions.getState().indexing).toBeNull();
    });

    it('until the layout has hydrated, events apply as they arrive: a session the snapshot missed and a newer change restored keeps its saved tab', async () => {
      const { fake, stores } = setup(60_000); // a window that never closes on its own during the test
      fake.event('session.changed', { record: record('a'), cause: 'discovered', revision: 2 });
      await fake.reply('session.list', { sessions: [], revision: 1 });
      await fake.reply('session.projects.list', { projects: [project('p1', 0)], revision: 1 });
      await fake.reply('session.digests', { digests: [] });
      await fake.reply('attention.list', []);
      await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
      expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:a']);
      expect(stores.sessions.getState().records.has(A)).toBe(true);
    });

    it('drops a pending window at disconnect', async () => {
      const { fake, stores, disconnect } = setup(16);
      await answerSnapshots(fake);
      await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
      vi.useFakeTimers();
      fake.event('session.changed', { record: record('late'), cause: 'discovered', revision: 5 });
      disconnect();
      vi.advanceTimersByTime(50);
      expect(stores.sessions.getState().records.has('late' as AppSessionId)).toBe(false);
    });
  });

  it('still loads when a snapshot command has no answerer, warning about it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, stores } = setup();
    await fake.fail('session.list', 'no main handler registered for session.list');
    await fake.reply('session.projects.list', { projects: [], revision: 0 });
    await fake.reply('session.digests', { digests: [] });
    await fake.fail('attention.list');
    expect(stores.sessions.getState().loaded).toBe(true);
    expect(stores.attention.getState().loaded).toBe(true);
    expect(warn.mock.calls.map(([line]) => line)).toEqual(['[shell] session.list unavailable; starting empty', '[shell] attention.list unavailable; starting empty']);
    warn.mockRestore();
  });
});
