import { describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { digest, humanTurn, project, record, status } from '../../../../test/support/builders';
import { createSessionsStore, selectProjectOrder, selectSessionsOf, selectSortedSessions } from './sessions';

const A = 'a' as AppSessionId;
const B = 'b' as AppSessionId;
const titled = (id: string, text: string) => record(id, { title: { text, source: 'user' } });

describe('sessions store reconciles snapshots with events by revision', () => {
  it('keeps an event newer than a snapshot that answers late', () => {
    const store = createSessionsStore();
    store.getState().applyChanged({ record: titled('a', 'from event'), cause: 'update', revision: 5 });
    store.getState().applyList({ sessions: [titled('a', 'from snapshot'), titled('b', 'only in snapshot')], revision: 4 });
    expect(store.getState().records.get(A)?.title.text).toBe('from event');
    expect(store.getState().records.get(B)?.title.text).toBe('only in snapshot');
    expect(store.getState().revision).toBe(5);
  });

  it('takes a snapshot newer than the events that raced it', () => {
    const store = createSessionsStore();
    store.getState().applyChanged({ record: titled('a', 'old event'), cause: 'update', revision: 2 });
    store.getState().applyList({ sessions: [titled('a', 'snapshot')], revision: 3 });
    expect(store.getState().records.get(A)?.title.text).toBe('snapshot');
  });

  it('does not resurrect a session removed after the snapshot was taken, and drops one the snapshot no longer has', () => {
    const store = createSessionsStore();
    store.getState().applyChanged({ record: titled('b', 'b'), cause: 'discovered', revision: 1 });
    store.getState().applyRemoved({ appSessionId: A, revision: 6 });
    store.getState().applyList({ sessions: [titled('a', 'a')], revision: 5 });
    expect([...store.getState().records.keys()]).toEqual([]);
  });

  it('replaces the project list when the newer of snapshot and event says so', () => {
    const store = createSessionsStore();
    store.getState().applyProjects({ projects: [project('p2', 0)], revision: 7 });
    store.getState().applyProjects({ projects: [project('p1', 0)], revision: 6 });
    expect([...store.getState().projects.keys()]).toEqual(['p2']);
  });

  it('keeps the higher revision of each digest, snapshot or event', () => {
    const store = createSessionsStore();
    store.getState().applyDigest(digest('a', { phase: 'working', revision: 3 }));
    store.getState().applyDigests([digest('a', { phase: 'idle', revision: 2 }), digest('b', { revision: 1 })]);
    expect(store.getState().digests.get(A)?.phase).toBe('working');
    expect(store.getState().digests.get(B)).toBeDefined();
  });

  it('keeps C3’s engine statuses by session', () => {
    const store = createSessionsStore();
    store.getState().applyStatus({ appSessionId: A, status: status('a', { engineState: 'running', turn: humanTurn }) });
    expect(store.getState().engine.get(A)?.engineState).toBe('running');
  });

  it('bumps recordsVersion on every record write and not otherwise', () => {
    const store = createSessionsStore();
    const v0 = store.getState().recordsVersion;
    store.getState().applyChanged({ record: record('a'), cause: 'update', revision: 1 });
    store.getState().applyDigest(digest('a'));
    expect(store.getState().recordsVersion).toBe(v0 + 1);
  });
});

describe('sessions selectors', () => {
  const store = createSessionsStore();
  store.getState().applyProjects({ projects: [project('p2', 1), project('p1', 0)], revision: 1 });
  store.getState().applyList({
    sessions: [
      record('x', { projectId: 'p1' as ProjectId }),
      record('y', { projectId: 'p1' as ProjectId, archived: true }),
      record('z', { projectId: null, unread: true }),
    ],
    revision: 1,
  });

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
