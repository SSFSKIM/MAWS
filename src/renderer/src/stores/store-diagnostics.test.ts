import { describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, ProjectId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandName, CommandResult, EventName, EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { FsState } from '@shared/ipc/schema/fs';
import type { Holder } from '@shared/wire/store';
import { createStoreDiagnosticsStore, describeEvent, describeFollow, describeHolder, FOLLOW_LOG, rowsOf, titleOf } from './store-diagnostics';

const A1 = 'app-1' as AppSessionId;
const A2 = 'app-2' as AppSessionId;

const record = (appId: AppSessionId, over: Partial<SessionRecord> = {}): SessionRecord => ({
  appId,
  engineSessionId: `${appId}-engine` as SessionId,
  projectId: null,
  directory: '/w',
  additionalDirectories: [],
  worktree: null,
  branch: null,
  title: { text: 'hello', source: 'none' },
  pinned: false,
  archived: false,
  holder: { kind: 'none' },
  lastSeen: { messageUuid: null, at: null },
  unread: false,
  engineVersion: null,
  gateway: { routed: true, baseUrl: null, autoModeServer: 'unknown' },
  model: { requested: null, resolved: null },
  effort: null,
  permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
  ...over,
});

const fsState = (lastScan: FsState['lastScan'] = null): FsState => ({ configHome: '/cfg', watching: true, projects: 1, sessions: 2, bound: 0, followed: [], holders: [], lastScanAt: lastScan ? '2026-09-28T10:00:01.000Z' : null, lastScan });
const project = (id: string, directory: string) => ({ id: id as ProjectId, name: directory.split('/').at(-1)!, directory, order: 0, createdAt: '2026-09-28T10:00:00.000Z' });

// A client whose replies the test releases by hand, so event/reply orderings can be staged.
function fakeClient() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const pending: { name: CommandName; input: unknown; resolve: (result: CommandResult<CommandName>) => void }[] = [];
  const client = {
    invoke: vi.fn((name: CommandName, input: unknown) => new Promise((resolve) => pending.push({ name, input, resolve }))),
    on: vi.fn((name: string, listener: (payload: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }),
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    client: client as unknown as MawsBridge,
    pending,
    event: <N extends EventName>(name: N, payload: EventPayload<N>) => listeners.get(name)?.forEach((l) => l(payload)),
    reply: async (name: CommandName, value: unknown) => {
      const index = pending.findIndex((p) => p.name === name);
      const [call] = pending.splice(index, 1);
      call.resolve({ ok: true, value } as CommandResult<CommandName>);
      await tick();
    },
    tick,
    listening: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

// Connects and answers the snapshots with the given records, projects and revision.
async function connected(records: SessionRecord[] = [], revision = 1) {
  const fake = fakeClient();
  const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
  store.getState().connect();
  await fake.reply('session.list', { sessions: records, revision });
  await fake.reply('session.projects.list', { projects: [], revision });
  return { fake, store };
}

describe('store diagnostics', () => {
  it('subscribes first, then asks for the fs.state snapshot and the index\'s records and projects, and runs no scan of its own', () => {
    const fake = fakeClient();
    createStoreDiagnosticsStore(fake.client, { flushMs: 0 }).getState().connect();
    expect(fake.client.on).toHaveBeenCalledWith('session.changed', expect.any(Function));
    expect(fake.client.on).toHaveBeenCalledWith('session.removed', expect.any(Function));
    expect(fake.client.on).toHaveBeenCalledWith('session.projects.changed', expect.any(Function));
    expect(fake.pending.map((p) => [p.name, p.input])).toEqual([
      ['fs.state', undefined],
      ['session.list', { includeArchived: true }],
      ['session.projects.list', undefined],
    ]);
  });

  it('lists the index\'s records, applies changes and removals, and reports the last scan fs.state holds once a pass ends', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    store.getState().connect();
    await fake.reply('fs.state', fsState()); // main's scan has not finished yet
    await fake.reply('session.list', { sessions: [record(A1)], revision: 3 });
    await fake.reply('session.projects.list', { projects: [project('p1', '/w'), project('p2', '/v')], revision: 3 });
    expect(store.getState().scan).toEqual({ status: 'running', progress: null });
    fake.event('fs.scanProgress', { scanned: 100, total: 200 });
    expect(store.getState().scan).toEqual({ status: 'running', progress: { scanned: 100, total: 200 } });

    fake.event('session.changed', { record: record(A2), cause: 'discovered', revision: 4 });
    fake.event('session.changed', { record: record(A1, { title: { text: 'renamed', source: 'user' } }), cause: 'facts', revision: 5 });
    await fake.tick();
    expect(Object.keys(store.getState().records).sort()).toEqual([A1, A2]);
    expect(store.getState().records[A1].title.text).toBe('renamed');
    fake.event('session.removed', { appSessionId: A2, revision: 6 });
    await fake.tick();
    expect(Object.keys(store.getState().records)).toEqual([A1]);

    fake.event('session.projects.changed', { projects: [project('p1', '/w')], revision: 7 });
    fake.event('session.projects.changed', { projects: [], revision: 2 }); // older than what is held: ignored
    expect(store.getState().projects?.map((p) => p.id)).toEqual(['p1']);

    fake.event('fs.scanProgress', { scanned: 200, total: 200 }); // the pass ended: read its result
    expect(fake.pending.map((p) => p.name)).toEqual(['fs.state']);
    await fake.reply('fs.state', fsState({ projects: 9, sessions: 2, changed: 2, durationMs: 1234 }));
    expect(store.getState().scan).toEqual({ status: 'done', result: { projects: 9, sessions: 2, changed: 2, durationMs: 1234 } });
  });

  it('applies record events that land while session.list is in flight over the snapshot only when newer than it', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    store.getState().connect();
    fake.event('session.changed', { record: record(A1, { pinned: true }), cause: 'update', revision: 9 }); // newer than the snapshot
    fake.event('session.changed', { record: record(A2, { title: { text: 'stale', source: 'none' } }), cause: 'facts', revision: 4 }); // the snapshot holds it
    fake.event('session.removed', { appSessionId: 'app-3' as AppSessionId, revision: 8 });
    await fake.reply('session.list', { sessions: [record(A1), record(A2), record('app-3' as AppSessionId)], revision: 5 });
    expect(store.getState().records[A1].pinned).toBe(true);
    expect(store.getState().records[A2].title.text).toBe('hello');
    expect(store.getState().records['app-3']).toBeUndefined();
  });

  it('stops listening and ignores late replies once disconnected (StrictMode remount)', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    const disconnect = store.getState().connect();
    disconnect();
    expect(fake.listening()).toBe(0);
    await fake.reply('fs.state', fsState());
    await fake.reply('session.list', { sessions: [record(A1)], revision: 1 });
    expect(store.getState().fs).toBeNull();
    expect(store.getState().records).toEqual({});
  });

  it('reports a failed fs.state without throwing', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.getState().connect();
    const state = fake.pending.find((p) => p.name === 'fs.state')!;
    state.resolve({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is crashed' } } as CommandResult<CommandName>);
    await fake.tick();
    expect(store.getState().scan).toEqual({ status: 'failed', error: 'engine-host is crashed' });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('store rows', () => {
  const ev = (id: string): SessionEvent => ({ id, sessionId: 's', at: 'now', seq: null, agentId: null, parentToolUseId: null, kind: 'notice.posted', level: 'info', text: id, key: null }) as unknown as SessionEvent;

  it('follows a record by its app id, keeps the chain state and the last events, deduplicated by id', async () => {
    const { fake, store } = await connected([record(A1)]);
    fake.pending.splice(0);

    const following = store.getState().follow(A1);
    expect(store.getState().followed).toMatchObject({ appSessionId: A1, state: null, events: [] });
    expect(fake.pending.map((p) => [p.name, p.input])).toEqual([['session.events', { appSessionId: A1, afterSeq: null, limit: null }]]);

    // Batches that land before the snapshot are buffered (they are newer than it), and one for another session is not
    // this view's: C6's hydration protocol — apply the snapshot, drain the buffer with dedup by id, then live.
    fake.event('session.eventBatch', { appSessionId: A1, events: [ev('e2'), ev('e3')] });
    fake.event('session.eventBatch', { appSessionId: 'other' as AppSessionId, events: [ev('x')] });
    expect(store.getState().followed?.events).toEqual([]);
    await fake.reply('session.events', { events: [ev('e1'), ev('e2')], lastSeq: 0, complete: true });
    await following;
    expect(store.getState().followed?.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    fake.event('session.eventBatch', { appSessionId: A1, events: [ev('e3'), ev('e4')] }); // live, deduplicated
    expect(store.getState().followed?.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    fake.event('fs.followState', { appSessionId: A1, agentId: null, state: 'following', chainLength: 12, leafUuid: '7c05f769-aaaa' as never, gap: null, skippedLines: 0, message: null });
    fake.event('fs.followState', { appSessionId: A1, agentId: 'agent-1' as never, state: 'backfilling', chainLength: 1, leafUuid: null, gap: null, skippedLines: 0, message: null });
    expect(describeFollow(store.getState().followed!.state)).toBe('chain 12 · leaf 7c05f769 · following');

    fake.event('session.eventBatch', { appSessionId: A1, events: Array.from({ length: 30 }, (_, i) => ev(`n${i}`)) });
    expect(store.getState().followed?.events).toHaveLength(FOLLOW_LOG);
    expect(store.getState().followed?.events.at(-1)?.id).toBe('n29');

    // Unfollow stops the host's follower and forgets the view.
    const stop = store.getState().unfollow();
    expect(store.getState().followed).toBeNull();
    expect(fake.pending.map((p) => [p.name, p.input])).toEqual([['fs.unfollow', { appSessionId: A1, agentId: null }]]);
    await fake.reply('fs.unfollow', undefined);
    await stop;
  });

  it('keeps the latest events when a large snapshot lands after newer batches', async () => {
    const { fake, store } = await connected([record(A1)]);
    fake.pending.splice(0);
    const following = store.getState().follow(A1);
    fake.event('session.eventBatch', { appSessionId: A1, events: [ev('latest-1'), ev('latest-2')] });
    await fake.reply('session.events', { events: Array.from({ length: 40 }, (_, i) => ev(`old-${i}`)), lastSeq: 0, complete: false });
    await following;
    const ids = store.getState().followed!.events.map((e) => e.id);
    expect(ids).toHaveLength(FOLLOW_LOG);
    expect(ids.slice(-2)).toEqual(['latest-1', 'latest-2']);
  });

  it('ignores a snapshot from an earlier follow of the same row that resolves after a re-follow started', async () => {
    const { fake, store } = await connected([record(A1)]);
    fake.pending.splice(0);

    const first = store.getState().follow(A1); // its session.events stays in flight
    await fake.tick();
    const stop = store.getState().unfollow();
    await fake.reply('fs.unfollow', undefined);
    await stop;
    const second = store.getState().follow(A1); // the same app id, a new follow
    await fake.tick();
    expect(fake.pending.map((p) => p.name)).toEqual(['session.events', 'session.events']);
    fake.event('session.eventBatch', { appSessionId: A1, events: [ev('new-live')] }); // buffered for the new follow

    await fake.reply('session.events', { events: [ev('stale-1'), ev('stale-2')], lastSeq: 0, complete: true }); // the old request
    await first;
    expect(store.getState().followed?.events).toEqual([]); // not applied, and the new follow's buffer not drained

    await fake.reply('session.events', { events: [ev('fresh-1')], lastSeq: 0, complete: true });
    await second;
    expect(store.getState().followed?.events.map((e) => e.id)).toEqual(['fresh-1', 'new-live']);
  });

  it('describes a follow state and an event for the log', () => {
    expect(describeFollow(null)).toBe('…');
    expect(describeFollow({ appSessionId: 'a' as AppSessionId, agentId: null, state: 'error', chainLength: 0, leafUuid: null, gap: null, skippedLines: 2, message: 'EACCES' })).toBe('chain 0 · leaf — · error · skipped 2 · EACCES');
    const rewind = { id: 'anchor:1', kind: 'boundary.rewind', targetMessageUuid: '36a2aa44-x', precedingAssistantUuid: 'edf0f954-x', prefillText: 'B' } as unknown as SessionEvent;
    expect(describeEvent(rewind)).toBe('boundary.rewind · edf0f954');
    expect(describeEvent({ id: 'u', kind: 'user.message', content: 'Remember APPLE. And more text that goes on for a while past the cut' } as unknown as SessionEvent)).toBe('user.message · Remember APPLE. And more text that goes on for a w…');
  });

  it('lists records not archived, held sessions first, then the most recently changed', () => {
    const rows = rowsOf({
      [A1]: record(A1, { updatedAt: '2026-09-28T10:05:00.000Z' }),
      [A2]: record(A2, { updatedAt: '2026-09-28T10:01:00.000Z', holder: { kind: 'terminal', pid: 1 } }),
      a: record('a' as AppSessionId, { updatedAt: '2026-09-28T10:09:00.000Z' }),
      gone: record('gone' as AppSessionId, { archived: true }),
    });
    expect(rows.map((r) => r.appId)).toEqual([A2, 'a', A1]);
  });

  it('titles a row by the record\'s projected title, or untitled', () => {
    expect(titleOf(record(A1, { title: { text: 'C', source: 'user' } }))).toBe('C');
    expect(titleOf(record(A1, { title: { text: '', source: 'none' } }))).toBe('New chat');
  });

  it.each<[Holder, string | null]>([
    [{ kind: 'terminal', pid: 78212 }, 'terminal · 78212'],
    [{ kind: 'background_job', pid: 4242, jobId: 'bdb23713' }, 'bg · bdb23713 · 4242'],
    [{ kind: 'background_job', pid: 4242, jobId: null }, 'bg · 4242'],
    [{ kind: 'self' }, 'MAWS'],
    [{ kind: 'none' }, null],
  ])('badges %j as %s', (holder, badge) => {
    expect(describeHolder(holder)).toBe(badge);
  });
});
