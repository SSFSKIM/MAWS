import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { EMPTY_TAB_SET, NO_PROJECT } from '@shared/ipc/schema/layout';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { OrgKey } from '@shared/machine/org-key';
import { digest, humanTurn, item, project, record, remoteRow, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { preloadOf } from '../test-support/preload-of';
import { createClient } from './client';
import { registerTabRetention } from '../keymap/actions-runtime';
import { createAttentionStore } from '../stores/attention';
import { createLayoutStore } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { createMachinesStore, selectOffline } from '../stores/machines';
import { createSessionsStore } from '../stores/sessions';
import { connectShell } from './events';
import { ownersLabel } from '../sidebar/owners'; // P5 O8 M5
import { resetRemoteLaneBStore } from '../lane-b/remote-session'; // P5 O7 M2
import { remoteSessionState } from '../lane-b/test-support/remote-session';

// P5 O6 M2: `fake` stands for main (its answers, events and the saved layout hold bare ids); the shell connects through
// the page's client over it, so the stores hold addresses (`A`, `at(id)`), and a saved layout from before O6 reads lifted.
const A = at('a' as AppSessionId);
// P5 O6 M4: events reach the page from the machine the fake names (`TEST_MACHINE` unless a test names another).
const pageClient = (fake: FakeClient) => createClient((): PreloadBridge => preloadOf(fake));

// The roster (`machines.list`): this machine only, unless a test adds another; null leaves it unanswered.
const SINCE = '2026-10-27T10:00:00.000Z';
const LOCAL_ENTRY: MachineState = { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: SINCE, generation: 0 };
const other = (state: MachineState['state'], generation: number): MachineState => ({ ref: OTHER_MACHINE, name: 'Studio', local: false, state, since: SINCE, generation });
const SAVED_TABS = { version: 1, ...EMPTY_TAB_SET, panes: [{ tabs: [{ id: 'session:a', kind: 'session', appSessionId: 'a', pinned: false }, { id: 'session:gone', kind: 'session', appSessionId: 'gone', pinned: false }], activeTabId: 'session:a' }], closedTabs: [] };

const newStores = () => ({ sessions: createSessionsStore(), attention: createAttentionStore(), layout: createLayoutStore(), machines: createMachinesStore() });

function setup(batchMs = 0, { machines = [LOCAL_ENTRY], tabs = SAVED_TABS }: { machines?: MachineState[] | null; tabs?: unknown } = {}) {
  const fake = fakeClient({
    'layout.list': { keys: ['main.tabs'] },
    'layout.get': ({ key }: { key: string }) => ({ value: key === 'main.tabs' ? tabs : null }),
    ...(machines === null ? {} : { 'machines.list': { machines } }),
  });
  const stores = newStores();
  const disconnect = connectShell(pageClient(fake), stores, { batchMs });
  return { fake, stores, disconnect };
}

// The ids of every open tab, the strip's set first (W12: one tab set per project).
const tabIds = (stores: ReturnType<typeof setup>['stores']) => allTabs(stores.layout.getState().main).map((t) => t.id);

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
        'attention.changed', 'attention.notified', 'engine.hostState', 'fs.scanProgress', 'machines.changed', 'org.rows.changed', 'remote.session', 'session.changed', 'session.digest', 'session.projects.changed', 'session.removed', 'session.status',
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
    expect(tabIds(stores)).toEqual([`session:${A}`]);
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
    expect(tabIds(stores)).toEqual([]);
    expect(stores.sessions.getState().records.has(A)).toBe(false);
  });

  // W12: a session's tab lives in its project's set; a record moved to another project (a refold) moves its tab, and
  // the strip follows the tab it shows.
  it('files the tabs by project at hydration and moves a tab whose record changes project', async () => {
    const { fake, stores } = setup();
    await fake.reply('session.list', { sessions: [record('a', { projectId: 'p1' as ProjectId })], revision: 1 });
    await fake.reply('session.projects.list', { projects: [project('p1', 0), project('p2', 1)], revision: 1 });
    await fake.reply('session.digests', { digests: [digest('a')] });
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    expect(stores.layout.getState().main.current).toBe(at('p1'));
    expect(Object.keys(stores.layout.getState().main.sets)).toEqual([at('p1')]);
    fake.event('session.changed', { record: record('a', { projectId: 'p2' as ProjectId }), cause: 'update', revision: 2 });
    expect(stores.layout.getState().main.current).toBe(at('p2'));
    expect(Object.keys(stores.layout.getState().main.sets)).toEqual([at('p2')]);
    expect(tabIds(stores)).toEqual([`session:${A}`]);
  });

  // P5 O6 M5: a set saved under a project's address waits whole while that project is not derived and its sessions file
  // elsewhere meanwhile (a folder nobody opened, under its machine's row); derived, it moves whole, panes and ratio kept.
  it('keeps a saved set of a folder not yet derived whole, and moves it whole once the folder is derived', async () => {
    const session = (id: string) => ({ id: `session:${at(id)}`, kind: 'session', appSessionId: at(id), pinned: false }); // a v3 layout holds addresses
    const split = { panes: [{ tabs: [session('a')], activeTabId: `session:${A}` }, { tabs: [session('c')], activeTabId: `session:${at('c')}` }], focusedPane: 1, splitRatio: 0.3 };
    const { fake, stores } = setup(0, { tabs: { version: 3, current: at('pd'), sets: { [at('pd')]: split }, closedTabs: [] } });
    const folder = project('pd', 0, { discovered: true });
    await fake.reply('session.list', { sessions: [record('a', { projectId: 'pd' as ProjectId }), record('c', { projectId: 'pd' as ProjectId })], revision: 1 });
    await fake.reply('session.projects.list', { projects: [folder], revision: 1 });
    await fake.reply('session.digests', { digests: [] });
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    await vi.waitFor(() => expect(stores.machines.getState().loaded.has(TEST_MACHINE)).toBe(true));
    const PD = at('pd');
    const shape = () => Object.fromEntries(Object.entries(stores.layout.getState().main.sets).map(([key, set]) => [key, { panes: set!.panes.map((p) => p.tabs.map((t) => t.id)), splitRatio: set!.splitRatio }]));
    const whole = { panes: [[`session:${A}`], [`session:${at('c')}`]], splitRatio: 0.3 };
    expect(stores.layout.getState().main.current).toBe(PD);
    expect(shape()).toEqual({ [PD]: whole });
    const org = { key: `folder:${TEST_MACHINE}:pd`, name: 'pd', source: 'folder', smnsId: null };
    fake.event('session.projects.changed', { projects: [{ ...folder, org }], revision: 2 });
    await vi.waitFor(() => expect(stores.layout.getState().main.current).toBe(`machine:${TEST_MACHINE}`));
    expect(shape()).toEqual({ [`machine:${TEST_MACHINE}`]: whole });
  });

  // The review's F3: the records change of a removal reaches the layout before the removal closes the tab; a session no
  // longer known is not refiled, so its tab closes in its own set and the strip keeps showing that project.
  it('removing the shown session of a project closes its tab there and shows the project’s next tab', async () => {
    const { fake, stores } = setup();
    await fake.reply('session.list', { sessions: [record('a', { projectId: 'p1' as ProjectId }), record('c', { projectId: 'p1' as ProjectId })], revision: 1 });
    await fake.reply('session.projects.list', { projects: [project('p1', 0)], revision: 1 });
    await fake.reply('session.digests', { digests: [] });
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    stores.layout.getState().openSession(at('c' as AppSessionId), { how: 'tab' });
    stores.layout.getState().activateTab(`session:${A}`);
    fake.event('session.removed', { appSessionId: 'a', revision: 2 });
    expect(stores.layout.getState().main.current).toBe(at('p1'));
    expect(Object.keys(stores.layout.getState().main.sets)).toEqual([at('p1')]);
    expect(tabIds(stores)).toEqual([`session:${at('c')}`]);
  });

  it('keeps a session’s tabs when its removal is older than what the store knows', async () => {
    const { fake, stores } = setup();
    await answerSnapshots(fake); // session.list at revision 1
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    fake.event('session.changed', { record: record('a'), cause: 'update', revision: 4 });
    fake.event('session.removed', { appSessionId: 'a', revision: 3 });
    expect(stores.sessions.getState().records.has(A)).toBe(true);
    expect(tabIds(stores)).toEqual([`session:${A}`]);
  });

  // l1-sessions-13 review: the project command and the inactivity sweep archive in main, past the renderer's own archive
  // that drops the tabs; the change event closes them instead, by the store's revision rule.
  it.each([0, 16])('closes the tabs of a session main archived, and only on news of the owner’s archive (batch %i ms)', async (batchMs) => {
    const { fake, stores } = setup(batchMs);
    await answerSnapshots(fake); // session.list at revision 1
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    const archived = { ...record('a'), archived: true };
    fake.event('session.changed', { record: archived, cause: 'facts', revision: 2 }); // its transcript went from disk
    await vi.waitFor(() => expect(stores.sessions.getState().records.get(A)?.archived).toBe(true));
    expect(tabIds(stores)).toEqual([`session:${A}`]);
    fake.event('session.changed', { record: record('a'), cause: 'facts', revision: 3 }); // and came back
    fake.event('session.changed', { record: archived, cause: 'update', revision: 2 }); // stale: the store knows newer
    await new Promise((resolve) => setTimeout(resolve, batchMs + 5));
    expect(stores.sessions.getState().records.get(A)?.archived).toBe(false);
    expect(tabIds(stores)).toEqual([`session:${A}`]);
    fake.event('session.changed', { record: archived, cause: 'update', revision: 4 });
    await vi.waitFor(() => expect(tabIds(stores)).toEqual([]));
    expect(stores.sessions.getState().records.get(A)?.archived).toBe(true); // the record stays, archived
  });

  it('an archive heard before the layout hydrates closes the persisted tab once it does', async () => {
    const { fake, stores } = setup();
    await fake.reply('session.list', { sessions: [record('a')], revision: 1 });
    fake.event('session.changed', { record: { ...record('a'), archived: true }, cause: 'update', revision: 2 });
    await fake.reply('session.projects.list', { projects: [project('p1', 0)], revision: 1 });
    await fake.reply('session.digests', { digests: [digest('a')] });
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    expect(tabIds(stores)).toEqual([]);
  });

  describe('tab retention (C10’s seventh ask)', () => {
    const retentions: (() => void)[] = [];
    afterEach(() => retentions.splice(0).forEach((off) => off()));

    it('with none registered, a record-less tab is dropped on hydrate and a removal closes its tab', async () => {
      const { fake, stores } = setup();
      await answerSnapshots(fake);
      await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
      expect(tabIds(stores)).toEqual([`session:${A}`]);
      fake.event('session.removed', { appSessionId: 'a', revision: 2 });
      expect(tabIds(stores)).toEqual([]);
    });

    it('hydration waits for ready, then keeps a record-less tab the retention retains', async () => {
      let ready!: () => void;
      const retains = vi.fn((id: string) => id === at('gone'));
      retentions.push(registerTabRetention({ ready: new Promise<void>((resolve) => (ready = resolve)), retains }));
      const { fake, stores } = setup();
      await answerSnapshots(fake);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(stores.layout.getState().hydrated).toBe(false); // still waiting on the intent snapshot
      ready();
      await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
      expect(tabIds(stores)).toEqual([`session:${A}`, `session:${at('gone')}`]);
    });

    it('a removal leaves a retained session’s tab open, and closes one it does not retain', async () => {
      retentions.push(registerTabRetention({ ready: Promise.resolve(), retains: (id) => id === A }));
      const { fake, stores } = setup();
      await answerSnapshots(fake);
      await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
      fake.event('session.removed', { appSessionId: 'a', revision: 2 });
      expect(stores.sessions.getState().records.has(A)).toBe(false);
      expect(tabIds(stores)).toEqual([`session:${A}`]);
      retentions.splice(0).forEach((off) => off());
      retentions.push(registerTabRetention({ ready: Promise.resolve(), retains: () => false }));
      fake.event('session.changed', { record: record('a'), cause: 'update', revision: 3 });
      fake.event('session.removed', { appSessionId: 'a', revision: 4 });
      expect(tabIds(stores)).toEqual([]);
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
    expect(stores.sessions.getState().engine.get(at('b' as AppSessionId))?.process).toBe('exited');
  });

  it('the engine table overwrites the statuses it lists and keeps the others; a later event wins over it', async () => {
    const { fake, stores } = setup();
    fake.event('session.status', { appSessionId: 'a', status: status('a', { engineState: 'running' }) });
    fake.event('session.status', { appSessionId: 'c', status: status('c') });
    await fake.reply('engine.sessions', [status('a')]); // read after those events, so newer
    expect(stores.sessions.getState().engine.get(A)?.engineState).toBe('idle');
    expect(stores.sessions.getState().engine.has(at('c' as AppSessionId))).toBe(true);
    fake.event('session.status', { appSessionId: 'a', status: status('a', { process: 'exited' }) });
    expect(stores.sessions.getState().engine.get(A)?.process).toBe('exited');
  });

  // E10 (X13 "Main's resync"): after a supervisor crash and restart, Stop all or Restart now, the windows stay open and
  // the page reads the process table again when the engine host is back, once per transition into ready.
  it('reads the engine table again when the engine host regains ready, once per transition', async () => {
    const { fake, stores } = setup();
    await fake.reply('engine.sessions', [status('a')]);
    const reads = () => fake.calls.filter((c) => c === 'invoke engine.sessions').length;
    expect(reads()).toBe(1);
    fake.event('engine.hostState', { state: 'restarting', pid: null, restarts: 0, revision: 2 });
    expect(reads()).toBe(1);
    fake.event('engine.hostState', { state: 'ready', pid: 4242, restarts: 0, revision: 3 });
    expect(reads()).toBe(2);
    fake.event('engine.hostState', { state: 'ready', pid: 4242, restarts: 0, revision: 4 }); // no transition
    expect(reads()).toBe(2);
    await fake.reply('engine.sessions', [status('b')]);
    expect(stores.sessions.getState().engine.get(at('b' as AppSessionId))?.process).toBe('ready');
    fake.event('engine.hostState', { state: 'crashed', pid: null, restarts: 1, revision: 5 });
    fake.event('engine.hostState', { state: 'ready', pid: 4343, restarts: 1, revision: 6 });
    expect(reads()).toBe(3);
  });

  // E10: as main does (C12, `hostEventSource`), the page forgets the statuses a host generation sent when the host leaves
  // ready, so a session the crashed supervisor ran reads not live even when the successor no longer lists it.
  const RESTARTING = { state: 'restarting', pid: null, restarts: 0, revision: 2 } as const;
  const READY = { state: 'ready', pid: 4242, restarts: 0, revision: 3 } as const;
  it('a session the crashed supervisor ran reads not live once the host left ready, and stays so when the successor lists nothing', async () => {
    const { fake, stores } = setup();
    await fake.reply('engine.sessions', [status('a', { engineState: 'running' })]);
    expect(stores.sessions.getState().engine.get(A)?.process).toBe('ready');
    fake.event('engine.hostState', RESTARTING);
    expect(stores.sessions.getState().engine.has(A)).toBe(false);
    fake.event('engine.hostState', READY);
    await fake.reply('engine.sessions', []);
    expect(stores.sessions.getState().engine.has(A)).toBe(false);
  });

  it('a reconnect to the same supervisor: the burst’s status keeps the session live whichever side of the re-read it lands', async () => {
    for (const burstFirst of [true, false]) {
      const { fake, stores, disconnect } = setup();
      await fake.reply('engine.sessions', [status('a')]);
      fake.event('engine.hostState', RESTARTING);
      fake.event('engine.hostState', READY);
      const burst = () => fake.event('session.status', { appSessionId: 'a', status: status('a', { engineState: 'running' }) });
      if (burstFirst) burst();
      await fake.reply('engine.sessions', [status('a', { engineState: 'running' })]);
      if (!burstFirst) burst();
      expect(stores.sessions.getState().engine.get(A)).toMatchObject({ process: 'ready', engineState: 'running' });
      disconnect();
    }
  });

  it('applies no engine table read before the host last left ready (the departed host’s answer)', async () => {
    const { fake, stores } = setup(); // the connect-time read, still unanswered
    fake.event('engine.hostState', RESTARTING);
    await fake.reply('engine.sessions', [status('a')]);
    expect(stores.sessions.getState().engine.has(A)).toBe(false);
    fake.event('engine.hostState', READY);
    await fake.reply('engine.sessions', [status('b')]);
    expect([...stores.sessions.getState().engine.keys()]).toEqual([at('b')]);
  });

  it('applies no re-read answer that lands after disconnect', async () => {
    const { fake, stores, disconnect } = setup();
    await fake.reply('engine.sessions', []);
    fake.event('engine.hostState', { state: 'restarting', pid: null, restarts: 0, revision: 2 });
    fake.event('engine.hostState', { state: 'ready', pid: 4242, restarts: 0, revision: 3 });
    disconnect();
    await fake.reply('engine.sessions', [status('a')]);
    expect(stores.sessions.getState().engine.has(A)).toBe(false);
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
      expect(stores.sessions.getState().records.has(at('s0' as AppSessionId))).toBe(false);

      vi.advanceTimersByTime(16);
      const state = stores.sessions.getState();
      expect(state.records.size).toBe(1 + 200 - 1); // `a`, the 200, less the removed s7
      expect(state.records.has(at('s7' as AppSessionId))).toBe(false);
      expect(state.digests.get(at('s199' as AppSessionId))?.phase).toBe('exited');
      expect(state.indexing).toEqual({ scanned: 0, total: 300 });
      expect(writes.mock.calls.length).toBeLessThanOrEqual(5); // progress, changes, digests, the removal (the stale change writes nothing)

      fake.event('fs.scanProgress', { scanned: 300, total: 300 });
      vi.advanceTimersByTime(16);
      expect(stores.sessions.getState().indexing).toBeNull();
    });

    // The layout's reads held open, so events can land while hydration waits for them.
    async function heldLayout(sessions: string[]) {
      const fake = fakeClient({ 'machines.list': { machines: [LOCAL_ENTRY] } });
      const stores = newStores();
      stores.layout.setState({ hydrated: false });
      connectShell(pageClient(fake), stores, { batchMs: 60_000 }); // a window that never closes by itself in the test
      await fake.reply('session.list', { sessions: sessions.map((id) => record(id)), revision: 1 });
      await fake.reply('session.projects.list', { projects: [project('p1', 0)], revision: 1 });
      await fake.reply('session.digests', { digests: [] });
      await fake.reply('attention.list', []);
      const answerLayout = async (tabs: string[]) => {
        await fake.reply('layout.list', { keys: ['main.tabs'] });
        const main = { version: 1, ...EMPTY_TAB_SET, closedTabs: [], panes: [{ tabs: tabs.map((id) => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false })), activeTabId: tabs[0] ? `session:${tabs[0]}` : '' }] };
        for (const value of [null, main, null]) await fake.reply('layout.get', { value }); // regions, main.tabs, panel.pinned
      };
      return { fake, stores, answerLayout };
    }

    it('hydration judges saved tabs against the events still in their window: a session the snapshot missed and a newer change restored keeps its tab', async () => {
      const { fake, stores, answerLayout } = await heldLayout([]);
      fake.event('session.changed', { record: record('a'), cause: 'discovered', revision: 2 });
      await answerLayout(['a']);
      expect(stores.layout.getState().hydrated).toBe(true);
      expect(tabIds(stores)).toEqual([`session:${A}`]);
    });

    it('a removal drained by hydration is replayed with the early changes: a session opened during hydration and then removed has no tab', async () => {
      const { fake, stores, answerLayout } = await heldLayout(['a']);
      stores.layout.getState().openSession(A);
      fake.event('session.removed', { appSessionId: 'a', revision: 2 });
      await answerLayout([]);
      expect(stores.layout.getState().hydrated).toBe(true);
      expect(stores.sessions.getState().records.has(A)).toBe(false);
      expect(tabIds(stores)).toEqual([]);
    });

    it('a snapshot reply applies after the window’s events that preceded it', async () => {
      const { fake, stores } = setup(60_000); // a window that never closes on its own during the test
      fake.event('session.changed', { record: record('a'), cause: 'discovered', revision: 2 });
      await fake.reply('session.list', { sessions: [], revision: 1 });
      await fake.reply('session.projects.list', { projects: [project('p1', 0)], revision: 1 });
      await fake.reply('session.digests', { digests: [] });
      await fake.reply('attention.list', []);
      await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
      expect(tabIds(stores)).toEqual([`session:${A}`]);
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
      expect(stores.sessions.getState().records.has(at('late' as AppSessionId))).toBe(false);
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

// P5 O6 M4 (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "`connectShell` per machine"; OX2): one
// subscription per event, each event applied to the partition of the machine it came from, and each machine's snapshots
// taken when its link comes up and again for each new generation of it.
describe('the shell per machine', () => {
  const onB = (id: string) => addressOf(OTHER_MACHINE, id as AppSessionId);
  const titledB = (id: string, text: string) => record(id, { title: { text, source: 'user' } });
  const recordIds = (stores: ReturnType<typeof setup>['stores']) => [...stores.sessions.getState().records.keys()].sort();
  const sessionTabs = (...ids: string[]) => ({
    version: 3,
    current: NO_PROJECT,
    sets: { [NO_PROJECT]: { panes: [{ tabs: ids.map((id) => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false })), activeTabId: `session:${ids[0]}` }], focusedPane: 0, splitRatio: 0.5 } },
    closedTabs: [],
  });
  // B's snapshots, answered after this machine's (the fake answers the oldest invocation of each command first).
  async function answerOther(fake: FakeClient, sessions: ReturnType<typeof record>[], revision: number, items: ReturnType<typeof item>[] = []) {
    await fake.reply('session.list', { sessions, revision });
    await fake.reply('session.projects.list', { projects: [], revision });
    await fake.reply('session.digests', { digests: [] });
    await fake.reply('attention.list', items);
  }

  it('takes another machine’s snapshots on that machine when its link comes up, and keeps each machine’s events in its partition', async () => {
    const { fake, stores } = setup(0, { machines: [LOCAL_ENTRY, other('connecting', 0)] });
    await answerSnapshots(fake);
    expect(fake.machines('session.list')).toEqual([TEST_MACHINE]);
    expect(selectOffline(stores.machines.getState(), OTHER_MACHINE)).toBe(true);
    fake.event('machines.changed', { machines: [LOCAL_ENTRY, other('up', 1)] });
    for (const name of ['session.list', 'session.projects.list', 'session.digests', 'attention.list', 'engine.sessions'] as const) expect(fake.machines(name)).toEqual([TEST_MACHINE, OTHER_MACHINE]);
    expect(stores.machines.getState().loaded.has(OTHER_MACHINE)).toBe(false);
    await answerOther(fake, [record('b1')], 5);
    expect(stores.machines.getState().loaded.has(OTHER_MACHINE)).toBe(true);
    expect(recordIds(stores)).toEqual([A, onB('b1')].sort());
    fake.event('session.changed', { record: record('b2'), cause: 'discovered', revision: 6 }, OTHER_MACHINE);
    fake.event('session.changed', { record: record('b3'), cause: 'discovered', revision: 2 }, OTHER_MACHINE); // older than B's list
    fake.event('session.changed', { record: record('a3'), cause: 'discovered', revision: 2 }); // newer than this machine's
    expect(recordIds(stores)).toEqual([A, at('a3'), onB('b1'), onB('b2')].sort());
  });

  it('a machine going down keeps its records and attention and forgets its statuses; up again, it is read again into the same records', async () => {
    const { fake, stores } = setup(0, { machines: [LOCAL_ENTRY, other('up', 1)] });
    await answerSnapshots(fake);
    await answerOther(fake, [record('b1'), record('b2')], 5, [item('b1', 'permission', '2026-09-28T10:00:00Z')]);
    fake.event('session.status', { appSessionId: 'a', status: status('a') });
    fake.event('session.status', { appSessionId: 'b1', status: status('b1') }, OTHER_MACHINE);
    expect(stores.sessions.getState().engine.has(onB('b1'))).toBe(true);

    fake.event('machines.changed', { machines: [LOCAL_ENTRY, other('down', 1)] });
    expect(stores.sessions.getState().engine.has(onB('b1'))).toBe(false);
    expect(stores.sessions.getState().engine.has(A)).toBe(true);
    expect(recordIds(stores)).toEqual([A, onB('b1'), onB('b2')].sort());
    expect(stores.attention.getState().bySession.get(onB('b1'))).toHaveLength(1);
    expect(selectOffline(stores.machines.getState(), OTHER_MACHINE)).toBe(true);

    fake.event('machines.changed', { machines: [LOCAL_ENTRY, other('up', 2)] }); // a restarted machine: its counters start afresh
    expect(fake.machines('session.list')).toEqual([TEST_MACHINE, OTHER_MACHINE, OTHER_MACHINE]);
    await answerOther(fake, [titledB('b1', 'read again')], 1); // b1 changed and b2 deleted meanwhile
    expect(recordIds(stores)).toEqual([A, onB('b1')].sort());
    expect(stores.sessions.getState().records.get(onB('b1'))?.title.text).toBe('read again');
    fake.event('session.changed', { record: titledB('b1', 'renamed'), cause: 'update', revision: 2 }, OTHER_MACHINE);
    expect(stores.sessions.getState().records.get(onB('b1'))?.title.text).toBe('renamed');
  });

  // P5 O7 M2 (the overlay rule): a lane B session main holds on B keeps the status this page last heard through B's link
  // going down, so Stop and Esc still reach its turn under the link's hold (A4); main forgetting it (the stream idle or
  // ended) forgets it here too
  it('keeps the status of a lane B session main holds on a machine that went down, until main says its stream is idle', async () => {
    resetRemoteLaneBStore();
    const { fake, stores } = setup(0, { machines: [LOCAL_ENTRY, other('up', 1)] });
    await answerSnapshots(fake);
    await answerOther(fake, [record('b1'), record('b2')], 5);
    fake.event('session.status', { appSessionId: 'b1', status: status('b1', { engineState: 'running', turn: humanTurn }) }, OTHER_MACHINE);
    fake.event('session.status', { appSessionId: 'b2', status: status('b2') }, OTHER_MACHINE);
    fake.event('remote.session', remoteSessionState('b1' as AppSessionId), OTHER_MACHINE); // main says it from the session's machine
    fake.event('machines.changed', { machines: [LOCAL_ENTRY, other('down', 1)] });
    fake.event('remote.session', remoteSessionState('b1' as AppSessionId, { stream: 'paused', link: { state: 'down', carrier: null, refusal: null, member: 'member-1', rights: [] } }), OTHER_MACHINE);
    expect(stores.sessions.getState().engine.get(onB('b1'))?.turn).not.toBeNull();
    expect(stores.sessions.getState().engine.has(onB('b1'))).toBe(true);
    expect(stores.sessions.getState().engine.has(onB('b2'))).toBe(false);
    fake.event('remote.session', remoteSessionState('b1' as AppSessionId, { stream: 'idle' }), OTHER_MACHINE);
    expect(stores.sessions.getState().engine.has(onB('b1'))).toBe(false);
    resetRemoteLaneBStore();
  });

  // M4's review: events heard before the first roster belong to no generation the page has reconciled.
  it('takes the first generation it learns as new: B’s events heard before the roster do not outrank B’s restarted counter', async () => {
    const { fake, stores } = setup(0, { machines: null });
    fake.event('session.changed', { record: titledB('b', 'before the restart'), cause: 'update', revision: 900 }, OTHER_MACHINE);
    fake.event('machines.changed', { machines: [LOCAL_ENTRY, other('down', 1)] });
    fake.event('machines.changed', { machines: [LOCAL_ENTRY, other('up', 2)] });
    await answerSnapshots(fake);
    await answerOther(fake, [titledB('b', 'after the restart')], 1);
    expect(stores.sessions.getState().records.get(onB('b'))?.title.text).toBe('after the restart');
  });

  it('forgets B’s statuses heard before the first roster when that roster reports B down', async () => {
    const { fake, stores } = setup(0, { machines: null });
    fake.event('session.status', { appSessionId: 'b', status: status('b') }, OTHER_MACHINE);
    expect(stores.sessions.getState().engine.has(onB('b'))).toBe(true);
    await fake.reply('machines.list', { machines: [LOCAL_ENTRY, other('down', 1)] });
    expect(stores.sessions.getState().engine.has(onB('b'))).toBe(false);
  });

  it('a new generation drops the events still queued from the generation before', async () => {
    const { fake, stores } = setup(60_000, { machines: [LOCAL_ENTRY, other('up', 1)] }); // a window that never closes by itself
    await answerSnapshots(fake);
    await answerOther(fake, [record('b1')], 5);
    fake.event('session.changed', { record: titledB('b1', 'from the generation before'), cause: 'update', revision: 50 }, OTHER_MACHINE);
    fake.event('session.changed', { record: record('a4'), cause: 'discovered', revision: 9 }); // this machine's stays queued
    fake.event('machines.changed', { machines: [LOCAL_ENTRY, other('up', 2)] });
    await answerOther(fake, [titledB('b1', 'after the restart')], 1); // its reply applies the window first
    expect(stores.sessions.getState().records.get(onB('b1'))?.title.text).toBe('after the restart');
    expect(stores.sessions.getState().records.has(at('a4' as AppSessionId))).toBe(true);
  });

  // The branch review: B's session.list lands before its session.projects.list, so for a moment B's records name projects
  // the page does not hold yet. A restored org set holding B's sessions stays whole, panes and ratio, through it.
  it('keeps a restored org set whole while another machine’s records arrive before its projects', async () => {
    const ORG = 'remote:github.com/example/shared' as OrgKey;
    const org = { key: ORG, name: 'shared', source: 'remote' as const, smnsId: null };
    const session = (id: string) => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
    const split = { panes: [{ tabs: [session(A)], activeTabId: `session:${A}` }, { tabs: [session(onB('b1'))], activeTabId: `session:${onB('b1')}` }], focusedPane: 1, splitRatio: 0.3 };
    const { fake, stores } = setup(0, { machines: [LOCAL_ENTRY, other('up', 1)], tabs: { version: 3, current: ORG, sets: { [ORG]: split }, closedTabs: [] } });
    await fake.reply('session.list', { sessions: [record('a', { projectId: 'p1' as ProjectId })], revision: 1 });
    await fake.reply('session.projects.list', { projects: [project('p1', 0, { org })], revision: 1 });
    await fake.reply('session.digests', { digests: [] });
    await fake.reply('attention.list', []);
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    const shape = () => Object.fromEntries(Object.entries(stores.layout.getState().main.sets).map(([key, set]) => [key, { panes: set!.panes.map((p) => p.tabs.map((t) => t.id)), splitRatio: set!.splitRatio }]));
    const whole = { [ORG]: { panes: [[`session:${A}`], [`session:${onB('b1')}`]], splitRatio: 0.3 } };
    expect(shape()).toEqual(whole);
    await fake.reply('session.list', { sessions: [record('b1', { projectId: 'pb' as ProjectId })], revision: 4 }); // B's records first
    expect(shape(), 'nothing moves while B’s projects are unknown').toEqual(whole);
    await fake.reply('session.projects.list', { projects: [project('pb', 0, { org })], revision: 4 });
    await fake.reply('session.digests', { digests: [] });
    await fake.reply('attention.list', []);
    await vi.waitFor(() => expect(stores.machines.getState().loaded.has(OTHER_MACHINE)).toBe(true));
    expect(shape()).toEqual(whole);
    expect(stores.layout.getState().main.current).toBe(ORG);
  });

  it('keeps another machine’s tabs until that machine has loaded, then drops the ones it does not list', async () => {
    const { fake, stores } = setup(0, { machines: [LOCAL_ENTRY, other('connecting', 0)], tabs: sessionTabs(A, onB('b1'), onB('b9')) });
    await answerSnapshots(fake);
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    expect(tabIds(stores).sort()).toEqual([`session:${A}`, `session:${onB('b1')}`, `session:${onB('b9')}`].sort()); // each machine's tabs in their sets (P5 O6 M5)
    fake.event('machines.changed', { machines: [LOCAL_ENTRY, other('up', 1)] });
    await answerOther(fake, [record('b1')], 5);
    expect(tabIds(stores).sort()).toEqual([`session:${A}`, `session:${onB('b1')}`].sort()); // each machine's tabs in their sets (P5 O6 M5)
  });

  it('hydrates once the roster has answered or failed: a down machine’s tab and a failed roster’s are kept, a machine no longer listed loses its tabs', async () => {
    const down = setup(0, { machines: null, tabs: sessionTabs(A, onB('b9')) });
    await answerSnapshots(down.fake);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(down.stores.layout.getState().hydrated).toBe(false); // the roster answers after the local snapshot and the layout reads
    await down.fake.reply('machines.list', { machines: [LOCAL_ENTRY, other('down', 3)] });
    await vi.waitFor(() => expect(down.stores.layout.getState().hydrated).toBe(true));
    expect(tabIds(down.stores).sort()).toEqual([`session:${A}`, `session:${onB('b9')}`].sort()); // each machine's tabs in their sets (P5 O6 M5)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = setup(0, { machines: null, tabs: sessionTabs(A, onB('b9')) });
    await answerSnapshots(failed.fake);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failed.stores.layout.getState().hydrated).toBe(false); // the roster is still unread
    await failed.fake.fail('machines.list', 'no main handler registered for machines.list');
    await vi.waitFor(() => expect(failed.stores.layout.getState().hydrated).toBe(true));
    expect(tabIds(failed.stores).sort()).toEqual([`session:${A}`, `session:${onB('b9')}`].sort()); // each machine's tabs in their sets (P5 O6 M5)
    expect(warn.mock.calls.map(([line]) => line)).toEqual(['[shell] machines.list unavailable; keeping every other machine’s tabs']);
    warn.mockRestore();

    const answered = setup(0, { machines: [LOCAL_ENTRY], tabs: sessionTabs(A, onB('b9')) });
    await answerSnapshots(answered.fake);
    await vi.waitFor(() => expect(answered.stores.layout.getState().hydrated).toBe(true));
    expect(tabIds(answered.stores)).toEqual([`session:${A}`]);
  });
});

// P5 O8 M2 (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The snapshot rule"): the org's rows fill the listed
// partition; a machine they name takes no record snapshot, and loads only once they are complete without it pending.
describe('the org rows', () => {
  const onB = (id: string) => addressOf(OTHER_MACHINE, id as AppSessionId);
  const sessionTabs = (...ids: string[]) => ({
    version: 3,
    current: NO_PROJECT,
    sets: { [NO_PROJECT]: { panes: [{ tabs: ids.map((id) => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false })), activeTabId: `session:${ids[0]}` }], focusedPane: 0, splitRatio: 0.5 } },
    closedTabs: [],
  });
  const rowsOf = (over: { complete?: boolean; pending?: string[]; sessions?: string[] } = {}) => ({
    machines: [OTHER_MACHINE],
    rows: (over.sessions ?? ['b1']).map((id) => remoteRow(OTHER_MACHINE, id, { title: `Studio ${id}` })),
    complete: over.complete ?? true,
    pending: over.pending ?? [],
    members: [{ id: 'member-1', email: 'sam@example.com', name: 'Sam' }],
    member: 'member-1',
  });
  const SNAPSHOT_READS = ['session.list', 'session.projects.list', 'session.digests', 'attention.list', 'engine.sessions'] as const;

  it('applies org.rows to the listed partition by address, and each org.rows.changed whole', async () => {
    const { fake, stores } = setup();
    expect(fake.invoked('org.rows')).toHaveLength(1);
    await fake.reply('org.rows', rowsOf({ sessions: ['b1', 'b2'] }));
    expect([...stores.sessions.getState().listed.keys()]).toEqual([onB('b1'), onB('b2')]);
    expect(stores.sessions.getState().listed.get(onB('b1'))).toMatchObject({ appId: onB('b1'), machine: OTHER_MACHINE, session: 'b1', title: 'Studio b1' });
    expect([...stores.sessions.getState().listedMachines]).toEqual([OTHER_MACHINE]);
    fake.event('org.rows.changed', rowsOf({ sessions: ['b3'] }));
    expect([...stores.sessions.getState().listed.keys()]).toEqual([onB('b3')]);
  });

  // P5 O8 M5 (Interfaces §L): the owners' names and "you" come with the rows, so a change of member relabels every row
  it('applies members and member with the rows, a change of signed-in member relabelling every row from the new payload', async () => {
    const { fake, stores } = setup();
    const ana = { id: 'ana', email: 'ana.lopez@example.com', name: 'Ana' };
    const sam = { id: 'member-1', email: 'sam@example.com', name: 'Sam' };
    const coOwned = ['b1', 'b2'].map((id) => remoteRow(OTHER_MACHINE, id, { owners: ['member-1', 'ana'] }));
    await fake.reply('org.rows', { ...rowsOf(), rows: coOwned, members: [sam, ana], member: 'member-1' });
    const labels = () => [...stores.sessions.getState().listed.values()].map((l) => ownersLabel(l.owners, stores.sessions.getState().member, stores.sessions.getState().members));
    expect(stores.sessions.getState().members.get('ana')).toEqual(ana);
    expect(labels()).toEqual(['you, Ana', 'you, Ana']);
    fake.event('org.rows.changed', { ...rowsOf(), rows: coOwned.map((r) => ({ ...r, mine: true })), members: [sam, ana], member: 'ana' });
    expect(stores.sessions.getState().member).toBe('ana');
    expect(labels()).toEqual(['you, Sam', 'you, Sam']);
  });

  it('applies no org.rows answer older than an org.rows.changed', async () => {
    const { fake, stores } = setup();
    fake.event('org.rows.changed', rowsOf({ sessions: ['newer'] }));
    await fake.reply('org.rows', rowsOf({ sessions: ['older'] }));
    expect([...stores.sessions.getState().listed.keys()]).toEqual([onB('newer')]);
  });

  it('a machine the rows name takes none of the five snapshot reads when its link comes up, nor a table read when its host regains ready', async () => {
    const { fake, stores } = setup(0, { machines: [LOCAL_ENTRY, other('connecting', 0)] });
    await answerSnapshots(fake);
    await fake.reply('org.rows', rowsOf({ complete: false }));
    fake.event('machines.changed', { machines: [LOCAL_ENTRY, other('up', 1)] });
    fake.event('engine.hostState', { state: 'ready' }, OTHER_MACHINE);
    for (const name of SNAPSHOT_READS) expect(fake.machines(name), name).toEqual([TEST_MACHINE]);
    expect(stores.machines.getState().loaded.has(OTHER_MACHINE)).toBe(false);
  });

  it('a machine the rows do not name yet is read as before', async () => {
    const { fake } = setup(0, { machines: [LOCAL_ENTRY, other('up', 1)] });
    await answerSnapshots(fake);
    for (const name of SNAPSHOT_READS) expect(fake.machines(name), name).toEqual([TEST_MACHINE, OTHER_MACHINE]);
  });

  it('keeps the named machine’s restored tabs while the rows are incomplete or it is pending, and loads it only at complete rows without it pending, keeping a listed tab', async () => {
    const { fake, stores } = setup(0, { machines: [LOCAL_ENTRY, other('connecting', 0)], tabs: sessionTabs(A, onB('b1'), onB('b9')) });
    const every = [`session:${A}`, `session:${onB('b1')}`, `session:${onB('b9')}`].sort();
    await fake.reply('org.rows', rowsOf({ complete: false, sessions: [] })); // the cache alone, before the hub's snapshot
    await answerSnapshots(fake);
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    fake.event('machines.changed', { machines: [LOCAL_ENTRY, other('up', 1)] });
    expect(tabIds(stores).sort()).toEqual(every);
    fake.event('org.rows.changed', rowsOf({ complete: false })); // a multi-page snapshot still arriving
    expect(tabIds(stores).sort()).toEqual(every);
    expect(stores.machines.getState().loaded.has(OTHER_MACHINE)).toBe(false);
    fake.event('org.rows.changed', rowsOf({ pending: [OTHER_MACHINE] })); // the last page in before a delayed key rotation
    expect(tabIds(stores).sort()).toEqual(every);
    expect(stores.machines.getState().loaded.has(OTHER_MACHINE)).toBe(false);
    fake.event('org.rows.changed', rowsOf());
    expect(stores.machines.getState().loaded.has(OTHER_MACHINE)).toBe(true);
    expect(tabIds(stores).sort()).toEqual([`session:${A}`, `session:${onB('b1')}`].sort()); // b1 listed, b9 known to nobody
  });

  it('hydrates against the rows: a listed tab of a machine already loaded is kept, an unknown one dropped', async () => {
    const { fake, stores } = setup(0, { machines: [LOCAL_ENTRY, other('up', 1)], tabs: sessionTabs(A, onB('b1'), onB('b9')) });
    await fake.reply('org.rows', rowsOf());
    expect(stores.machines.getState().loaded.has(OTHER_MACHINE)).toBe(true);
    await answerSnapshots(fake);
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    expect(tabIds(stores).sort()).toEqual([`session:${A}`, `session:${onB('b1')}`].sort());
  });
});
