import { describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { digest, humanTurn, project, record, status } from '../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { createSessionsStore, selectProjectOrder, selectSessionsOf, selectSortedSessions } from './sessions';

// The store does not read machines from ids (membership is recorded from the call that wrote it), so the one-machine
// cases keep bare ids; the two-machine cases use addresses, as the shell writes them.
const M = TEST_MACHINE;
const A = 'a' as AppSessionId;
const B = 'b' as AppSessionId;
const titled = (id: string, text: string) => record(id, { title: { text, source: 'user' } });

describe('sessions store reconciles snapshots with events by revision', () => {
  it('keeps an event newer than a snapshot that answers late', () => {
    const store = createSessionsStore();
    store.getState().applyChanged({ record: titled('a', 'from event'), cause: 'update', revision: 5 }, M);
    store.getState().applyList({ sessions: [titled('a', 'from snapshot'), titled('b', 'only in snapshot')], revision: 4 }, M);
    expect(store.getState().records.get(A)?.title.text).toBe('from event');
    expect(store.getState().records.get(B)?.title.text).toBe('only in snapshot');
    expect(store.getState().revision).toBe(5);
  });

  it('takes a snapshot newer than the events that raced it', () => {
    const store = createSessionsStore();
    store.getState().applyChanged({ record: titled('a', 'old event'), cause: 'update', revision: 2 }, M);
    store.getState().applyList({ sessions: [titled('a', 'snapshot')], revision: 3 }, M);
    expect(store.getState().records.get(A)?.title.text).toBe('snapshot');
  });

  it('does not resurrect a session removed after the snapshot was taken, and drops one the snapshot no longer has', () => {
    const store = createSessionsStore();
    store.getState().applyChanged({ record: titled('b', 'b'), cause: 'discovered', revision: 1 }, M);
    store.getState().applyRemoved({ appSessionId: A, revision: 6 }, M);
    store.getState().applyList({ sessions: [titled('a', 'a')], revision: 5 }, M);
    expect([...store.getState().records.keys()]).toEqual([]);
  });

  it('does not resurrect a record a newer snapshot left out when its older change arrives late', () => {
    const store = createSessionsStore();
    store.getState().applyChanged({ record: titled('a', 'a'), cause: 'discovered', revision: 1 }, M);
    store.getState().applyList({ sessions: [], revision: 5 }, M);
    expect(store.getState().records.has(A)).toBe(false);
    expect(store.getState().applyChanged({ record: titled('a', 'late'), cause: 'facts', revision: 2 }, M)).toBe(false);
    expect(store.getState().records.has(A)).toBe(false);
  });

  it('still takes per-record events newer than the snapshot, for held and new sessions alike', () => {
    const store = createSessionsStore();
    store.getState().applyList({ sessions: [titled('a', 'a')], revision: 5 }, M);
    expect(store.getState().applyChanged({ record: titled('a', 'renamed'), cause: 'update', revision: 6 }, M)).toBe(true);
    expect(store.getState().applyChanged({ record: titled('b', 'new'), cause: 'discovered', revision: 7 }, M)).toBe(true);
    expect(store.getState().applyChanged({ record: titled('a', 'older'), cause: 'update', revision: 6 }, M)).toBe(false);
    expect([...store.getState().records.values()].map((r) => r.title.text)).toEqual(['renamed', 'new']);
  });

  it('reports whether a removal was accepted, refusing one older than what it knows', () => {
    const store = createSessionsStore();
    store.getState().applyList({ sessions: [titled('a', 'a')], revision: 5 }, M);
    expect(store.getState().applyRemoved({ appSessionId: A, revision: 3 }, M)).toBe(false);
    expect(store.getState().records.has(A)).toBe(true);
    expect(store.getState().applyRemoved({ appSessionId: B, revision: 4 }, M)).toBe(false); // unknown and not newer than the snapshot
    expect(store.getState().applyRemoved({ appSessionId: A, revision: 6 }, M)).toBe(true);
    expect(store.getState().records.has(A)).toBe(false);
  });

  it('replaces the project list when the newer of snapshot and event says so', () => {
    const store = createSessionsStore();
    store.getState().applyProjects({ projects: [project('p2', 0)], revision: 7 }, M);
    store.getState().applyProjects({ projects: [project('p1', 0)], revision: 6 }, M);
    expect([...store.getState().projects.keys()]).toEqual(['p2']);
  });

  it('keeps the higher revision of each digest, snapshot or event', () => {
    const store = createSessionsStore();
    store.getState().applyDigest(digest('a', { phase: 'working', revision: 3 }), M);
    store.getState().applyDigests([digest('a', { phase: 'idle', revision: 2 }), digest('b', { revision: 1 })], M);
    expect(store.getState().digests.get(A)?.phase).toBe('working');
    expect(store.getState().digests.get(B)).toBeDefined();
  });

  it('keeps C3’s engine statuses by session', () => {
    const store = createSessionsStore();
    store.getState().applyStatus({ appSessionId: A, status: status('a', { engineState: 'running', turn: humanTurn }) }, M);
    expect(store.getState().engine.get(A)?.engineState).toBe('running');
  });

  it('forgets a removed session’s digest and engine status, and takes the recreated session’s digests', () => {
    const store = createSessionsStore();
    store.getState().applyChanged({ record: record('a'), cause: 'discovered', revision: 1 }, M);
    store.getState().applyDigest(digest('a', { phase: 'working', revision: 2 }), M);
    store.getState().applyStatus({ appSessionId: A, status: status('a', { engineState: 'running', turn: humanTurn }) }, M);
    expect(store.getState().applyRemoved({ appSessionId: A, revision: 2 }, M)).toBe(true);
    expect(store.getState().digests.has(A)).toBe(false);
    expect(store.getState().engine.has(A)).toBe(false);
    // A digest from before the removal that arrives late stays out; main's counter continues for the recreated session.
    store.getState().applyDigest(digest('a', { phase: 'working', revision: 2 }), M);
    expect(store.getState().digests.has(A)).toBe(false);
    store.getState().applyChanged({ record: record('a'), cause: 'discovered', revision: 3 }, M);
    store.getState().applyDigest(digest('a', { phase: 'idle', revision: 3 }), M);
    expect(store.getState().digests.get(A)).toMatchObject({ phase: 'idle', revision: 3 });
  });

  it('forgets the digest and engine status of a session a newer snapshot no longer lists', () => {
    const store = createSessionsStore();
    store.getState().applyChanged({ record: record('a'), cause: 'discovered', revision: 1 }, M);
    store.getState().applyDigest(digest('a', { revision: 4 }), M);
    store.getState().applyStatus({ appSessionId: A, status: status('a') }, M);
    store.getState().applyList({ sessions: [], revision: 2 }, M);
    expect(store.getState().digests.has(A)).toBe(false);
    expect(store.getState().engine.has(A)).toBe(false);
  });

  it('bumps recordsVersion on every record write and not otherwise', () => {
    const store = createSessionsStore();
    const v0 = store.getState().recordsVersion;
    store.getState().applyChanged({ record: record('a'), cause: 'update', revision: 1 }, M);
    store.getState().applyDigest(digest('a'), M);
    expect(store.getState().recordsVersion).toBe(v0 + 1);
  });
});

describe('sessions selectors', () => {
  const store = createSessionsStore();
  store.getState().applyProjects({ projects: [project('p2', 1), project('p1', 0)], revision: 1 }, M);
  store.getState().applyList({
    sessions: [
      record('x', { projectId: 'p1' as ProjectId }),
      record('y', { projectId: 'p1' as ProjectId, archived: true }),
      record('z', { projectId: null, unread: true }),
    ],
    revision: 1,
  }, M);

  it('orders projects and lists a project’s unarchived sessions, memoised', () => {
    expect(selectProjectOrder(store.getState()).map((p) => p.id)).toEqual(['p1', 'p2']);
    const inP1 = selectSessionsOf(store.getState(), 'p1' as ProjectId);
    expect(inP1.map((r) => r.appId)).toEqual(['x']);
    expect(selectSessionsOf(store.getState(), 'p1' as ProjectId)).toBe(inP1);
    expect(selectSessionsOf(store.getState(), null).map((r) => r.appId)).toEqual(['z']);
  });

  it('sorts a project’s sessions for the sidebar', () => {
    expect(selectSortedSessions(store.getState(), null, 'priority', []).map((r) => r.appId)).toEqual(['z']);
  });
});

describe('unstarted sessions', () => {
  const P = 'p' as ProjectId;

  it('holds an unstarted session until its record arrives through an event', () => {
    const store = createSessionsStore();
    store.getState().addUnstarted(A, { projectId: P, createdAt: '2026-09-28T10:00:00Z' });
    expect(store.getState().unstarted.get(A)).toEqual({ projectId: P, createdAt: '2026-09-28T10:00:00Z' });
    store.getState().applyChanged({ record: titled('b', 'another'), cause: 'discovered', revision: 1 }, M);
    expect(store.getState().unstarted.has(A)).toBe(true);
    store.getState().applyChanged({ record: titled('a', 'started'), cause: 'live', revision: 2 }, M);
    expect(store.getState().unstarted.has(A)).toBe(false);
  });

  it('drops an unstarted session a snapshot lists, and on request', () => {
    const store = createSessionsStore();
    store.getState().addUnstarted(A, { projectId: null, createdAt: '2026-09-28T10:00:00Z' });
    store.getState().addUnstarted(B, { projectId: null, createdAt: '2026-09-28T10:00:00Z' });
    store.getState().applyList({ sessions: [titled('a', 'started')], revision: 1 }, M);
    expect([...store.getState().unstarted.keys()]).toEqual([B]);
    store.getState().dropUnstarted(B);
    expect(store.getState().unstarted.size).toBe(0);
  });
});

// P5 O6 M4 (OX2): each machine's index has its own revision counter, so every reconciliation rule holds per machine.
describe('sessions store partitions its reconciliation by machine', () => {
  const onA = (id: string) => addressOf(TEST_MACHINE, id as AppSessionId);
  const onB = (id: string) => addressOf(OTHER_MACHINE, id as AppSessionId);
  const held = (store: ReturnType<typeof createSessionsStore>) => [...store.getState().records.keys()].sort();

  it('takes B’s events at revision 5 while A’s index is at 900', () => {
    const store = createSessionsStore();
    store.getState().applyList({ sessions: [record(onA('a'))], revision: 900 }, TEST_MACHINE);
    store.getState().applyList({ sessions: [record(onB('b'))], revision: 4 }, OTHER_MACHINE);
    expect(store.getState().applyChanged({ record: titled(onB('b'), 'renamed'), cause: 'update', revision: 5 }, OTHER_MACHINE)).toBe(true);
    expect(store.getState().applyChanged({ record: record(onB('c')), cause: 'discovered', revision: 6 }, OTHER_MACHINE)).toBe(true);
    expect(store.getState().records.get(onB('b'))?.title.text).toBe('renamed');
    expect(held(store)).toEqual([onA('a'), onB('b'), onB('c')].sort());
  });

  it('removes none of A’s records with B’s list, and replaces none of A’s projects with B’s', () => {
    const store = createSessionsStore();
    store.getState().applyList({ sessions: [record(onA('a')), record(onA('a2'))], revision: 3 }, TEST_MACHINE);
    store.getState().applyProjects({ projects: [project(onA('p'), 0)], revision: 3 }, TEST_MACHINE);
    store.getState().applyList({ sessions: [record(onB('b'))], revision: 50 }, OTHER_MACHINE);
    store.getState().applyProjects({ projects: [project(onB('q'), 0)], revision: 50 }, OTHER_MACHINE);
    expect(held(store)).toEqual([onA('a'), onA('a2'), onB('b')].sort());
    expect([...store.getState().projects.keys()].sort()).toEqual([onA('p'), onB('q')].sort());
    store.getState().applyList({ sessions: [], revision: 51 }, OTHER_MACHINE);
    store.getState().applyProjects({ projects: [], revision: 51 }, OTHER_MACHINE);
    expect(held(store)).toEqual([onA('a'), onA('a2')].sort());
    expect([...store.getState().projects.keys()]).toEqual([onA('p')]);
  });

  it('refuses a stale B event after B’s snapshot, whatever A’s revisions', () => {
    const store = createSessionsStore();
    store.getState().applyList({ sessions: [record(onB('b'))], revision: 8 }, OTHER_MACHINE);
    expect(store.getState().applyChanged({ record: titled(onB('b'), 'stale'), cause: 'update', revision: 7 }, OTHER_MACHINE)).toBe(false);
    expect(store.getState().applyChanged({ record: record(onB('gone')), cause: 'discovered', revision: 6 }, OTHER_MACHINE)).toBe(false);
    // The same revision is news on A, whose counter is its own.
    expect(store.getState().applyChanged({ record: record(onA('a')), cause: 'discovered', revision: 6 }, TEST_MACHINE)).toBe(true);
    expect(held(store)).toEqual([onA('a'), onB('b')].sort());
  });

  it('forgets B’s engine statuses and keeps A’s', () => {
    const store = createSessionsStore();
    store.getState().applyStatus({ appSessionId: onA('a'), status: status(onA('a'), { engineState: 'running', turn: humanTurn }) }, TEST_MACHINE);
    store.getState().applyStatuses([status(onB('b'), { engineState: 'running', turn: humanTurn })], OTHER_MACHINE);
    store.getState().forgetStatuses(OTHER_MACHINE);
    expect([...store.getState().engine.keys()]).toEqual([onA('a')]);
  });

  it('takes B’s restarted counter after a reset, keeping B’s records shown until its snapshot replaces them', () => {
    const store = createSessionsStore();
    store.getState().applyList({ sessions: [record(onA('a'))], revision: 900 }, TEST_MACHINE);
    store.getState().applyList({ sessions: [record(onB('b')), record(onB('old'))], revision: 40 }, OTHER_MACHINE);
    store.getState().applyDigest(digest(onB('b'), { phase: 'working', revision: 30 }), OTHER_MACHINE);
    store.getState().resetMachine(OTHER_MACHINE);
    expect(held(store)).toEqual([onA('a'), onB('b'), onB('old')].sort()); // shown until the new generation's snapshot
    store.getState().applyList({ sessions: [titled(onB('b'), 'after restart')], revision: 2 }, OTHER_MACHINE);
    store.getState().applyDigests([digest(onB('b'), { phase: 'idle', revision: 1 })], OTHER_MACHINE);
    expect(held(store)).toEqual([onA('a'), onB('b')].sort());
    expect(store.getState().records.get(onB('b'))?.title.text).toBe('after restart');
    expect(store.getState().digests.get(onB('b'))).toMatchObject({ phase: 'idle', revision: 1 });
    expect(store.getState().applyChanged({ record: record(onB('c')), cause: 'discovered', revision: 3 }, OTHER_MACHINE)).toBe(true);
    // A's guards were not reset: its older events stay refused.
    expect(store.getState().applyChanged({ record: record(onA('late')), cause: 'discovered', revision: 899 }, TEST_MACHINE)).toBe(false);
  });
});
