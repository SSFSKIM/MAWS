import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { FsState } from '@shared/ipc/schema/fs';
import type { Holder, TranscriptSummary } from '@shared/wire/store';
import type { SessionEvent } from '@shared/graph/events';
import { createStoreDiagnosticsStore, describeEvent, describeFollow, describeHolder, FOLLOW_LOG, rowsOf, titleOf } from './store-diagnostics';

const S1 = '11111111-1111-4111-8111-111111111111' as SessionId;
const S2 = '22222222-2222-4222-8222-222222222222' as SessionId;

const summary = (sessionId: SessionId, over: Partial<TranscriptSummary> = {}): TranscriptSummary => ({
  sessionId,
  transcriptPath: `/cfg/projects/-w/${sessionId}.jsonl`,
  slug: '-w',
  directory: '/w',
  relocatedCwd: null,
  size: 10,
  mtimeMs: 1,
  firstRecordAt: null,
  lastRecordAt: null,
  customTitle: null,
  aiTitle: null,
  firstPrompt: null,
  lastAssistantText: null,
  gitBranch: null,
  engineVersion: null,
  entrypoint: null,
  sessionKind: null,
  hasMessages: true,
  leafUuid: null,
  ...over,
});

const fsState = (holders: FsState['holders'] = []): FsState => ({
  configHome: '/cfg',
  watching: true,
  projects: 1,
  sessions: 2,
  bound: 0,
  followed: [],
  holders,
  lastScanAt: null,
});

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

describe('store diagnostics', () => {
  it('subscribes first, then asks for the fs.state snapshot and a scan', () => {
    const fake = fakeClient();
    createStoreDiagnosticsStore(fake.client, { flushMs: 0 }).getState().connect();
    expect(fake.client.on).toHaveBeenCalledWith('fs.sessionChanged', expect.any(Function));
    expect(fake.client.on).toHaveBeenCalledWith('fs.holderChanged', expect.any(Function));
    expect(fake.pending.map((p) => [p.name, p.input])).toEqual([
      ['fs.state', undefined],
      ['fs.scan', {}],
    ]);
  });

  it('lists every discovered session, applies removals, and reports the scan result', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    store.getState().connect();
    await fake.reply('fs.state', fsState());
    expect(store.getState().scan).toEqual({ status: 'running', progress: null });
    fake.event('fs.scanProgress', { scanned: 100, total: 200 });
    expect(store.getState().scan).toEqual({ status: 'running', progress: { scanned: 100, total: 200 } });
    fake.event('fs.sessionChanged', { summary: summary(S1, { customTitle: 'One' }), appSessionId: null });
    fake.event('fs.sessionChanged', { summary: summary(S2), appSessionId: 'app-2' as AppSessionId });
    fake.event('fs.sessionChanged', { summary: summary(S1, { customTitle: 'One again' }), appSessionId: null });
    await fake.tick();
    expect(Object.keys(store.getState().sessions).sort()).toEqual([S1, S2]);
    expect(store.getState().sessions[S1].summary.customTitle).toBe('One again');

    fake.event('fs.sessionRemoved', { sessionId: S2, appSessionId: 'app-2' as AppSessionId });
    await fake.tick();
    expect(Object.keys(store.getState().sessions)).toEqual([S1]);

    await fake.reply('fs.scan', { projects: 1, sessions: 1, changed: 1, durationMs: 1234 });
    expect(store.getState().scan).toEqual({ status: 'done', result: { projects: 1, sessions: 1, changed: 1, durationMs: 1234 } });
    expect(fake.pending.map((p) => p.name)).toEqual(['fs.state']); // the counts are read again after the scan
  });

  it('keeps a holder event newer than the snapshot that lands after it, and takes the snapshot for the rest', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    store.getState().connect();
    fake.event('fs.holderChanged', { sessionId: S1, appSessionId: null, holder: { kind: 'none' }, registry: null, job: null });
    await fake.reply(
      'fs.state',
      fsState([
        { sessionId: S1, appSessionId: null, holder: { kind: 'terminal', pid: 7 } },
        { sessionId: S2, appSessionId: null, holder: { kind: 'background_job', pid: 8, jobId: 'abcd1234' } },
      ]),
    );
    expect(store.getState().holders).toEqual({ [S2]: { kind: 'background_job', pid: 8, jobId: 'abcd1234' } });
    expect(store.getState().fs?.configHome).toBe('/cfg');

    fake.event('fs.holderChanged', { sessionId: S1, appSessionId: null, holder: { kind: 'terminal', pid: 9 }, registry: null, job: null });
    expect(store.getState().holders[S1]).toEqual({ kind: 'terminal', pid: 9 });
  });

  it('stops listening and ignores late replies once disconnected (StrictMode remount)', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    const disconnect = store.getState().connect();
    disconnect();
    expect(fake.listening()).toBe(0);
    await fake.reply('fs.state', fsState());
    expect(store.getState().fs).toBeNull();
  });

  it('reports a failed scan without throwing', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.getState().connect();
    const scan = fake.pending.find((p) => p.name === 'fs.scan')!;
    scan.resolve({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is crashed' } } as CommandResult<CommandName>);
    await fake.tick();
    expect(store.getState().scan).toEqual({ status: 'failed', error: 'engine-host is crashed' });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('store rows', () => {
  it('follows a row: binds an app id when the row has none, keeps the chain state and the last events, deduplicated by id', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    store.getState().connect();
    fake.event('fs.sessionChanged', { summary: summary(S1), appSessionId: null });
    await fake.tick();
    fake.pending.splice(0);

    const following = store.getState().follow(S1);
    await fake.tick();
    const bind = fake.pending.find((p) => p.name === 'fs.bind')!;
    const [{ appSessionId }] = (bind.input as { bindings: { sessionId: string; appSessionId: AppSessionId }[] }).bindings;
    expect(bind.input).toEqual({ bindings: [{ sessionId: S1, appSessionId }] });
    await fake.reply('fs.bind', undefined);
    expect(store.getState().followed).toMatchObject({ sessionId: S1, appSessionId, state: null, events: [] });
    expect(fake.pending.map((p) => [p.name, p.input])).toEqual([['session.events', { appSessionId, afterSeq: null, limit: null }]]);

    // Batches that land before the snapshot are buffered (they are newer than it), and one for another session is not
    // this view's: C6's hydration protocol — apply the snapshot, drain the buffer with dedup by id, then live.
    const ev = (id: string): SessionEvent => ({ id, sessionId: S1, at: 'now', seq: null, agentId: null, parentToolUseId: null, kind: 'notice.posted', level: 'info', text: id, key: null }) as unknown as SessionEvent;
    fake.event('session.eventBatch', { appSessionId, events: [ev('e2'), ev('e3')] });
    fake.event('session.eventBatch', { appSessionId: 'other' as AppSessionId, events: [ev('x')] });
    expect(store.getState().followed?.events).toEqual([]);
    await fake.reply('session.events', { events: [ev('e1'), ev('e2')], lastSeq: 0, complete: true });
    await following;
    expect(store.getState().followed?.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    fake.event('session.eventBatch', { appSessionId, events: [ev('e3'), ev('e4')] }); // live, deduplicated
    expect(store.getState().followed?.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    fake.event('fs.followState', { appSessionId, agentId: null, state: 'following', chainLength: 12, leafUuid: '7c05f769-aaaa' as never, gap: null, skippedLines: 0, message: null });
    fake.event('fs.followState', { appSessionId, agentId: 'agent-1' as never, state: 'backfilling', chainLength: 1, leafUuid: null, gap: null, skippedLines: 0, message: null });
    expect(describeFollow(store.getState().followed!.state)).toBe('chain 12 · leaf 7c05f769 · following');

    fake.event('session.eventBatch', { appSessionId, events: Array.from({ length: 30 }, (_, i) => ev(`n${i}`)) });
    expect(store.getState().followed?.events).toHaveLength(FOLLOW_LOG);
    expect(store.getState().followed?.events.at(-1)?.id).toBe('n29');

    // Unfollow stops the host's follower and forgets the view; the row keeps its binding.
    const stop = store.getState().unfollow();
    expect(store.getState().followed).toBeNull();
    expect(fake.pending.map((p) => [p.name, p.input])).toEqual([['fs.unfollow', { appSessionId, agentId: null }]]);
    await fake.reply('fs.unfollow', undefined);
    await stop;
    expect(store.getState().sessions[S1].appSessionId).toBe(appSessionId);
  });

  it('keeps the latest events when a large snapshot lands after newer batches', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    store.getState().connect();
    fake.event('fs.sessionChanged', { summary: summary(S1), appSessionId: 'app-1' as AppSessionId });
    await fake.tick();
    fake.pending.splice(0);
    const following = store.getState().follow(S1);
    const ev = (id: string): SessionEvent => ({ id, kind: 'notice.posted', text: id }) as unknown as SessionEvent;
    fake.event('session.eventBatch', { appSessionId: 'app-1' as AppSessionId, events: [ev('latest-1'), ev('latest-2')] });
    await fake.reply('session.events', { events: Array.from({ length: 40 }, (_, i) => ev(`old-${i}`)), lastSeq: 0, complete: false });
    await following;
    const ids = store.getState().followed!.events.map((e) => e.id);
    expect(ids).toHaveLength(FOLLOW_LOG);
    expect(ids.slice(-2)).toEqual(['latest-1', 'latest-2']);
  });

  it('ignores a snapshot from an earlier follow of the same row that resolves after a re-follow started', async () => {
    const fake = fakeClient();
    const store = createStoreDiagnosticsStore(fake.client, { flushMs: 0 });
    store.getState().connect();
    const app = 'app-1' as AppSessionId;
    fake.event('fs.sessionChanged', { summary: summary(S1), appSessionId: app });
    await fake.tick();
    fake.pending.splice(0);
    const ev = (id: string): SessionEvent => ({ id, kind: 'notice.posted', text: id }) as unknown as SessionEvent;

    const first = store.getState().follow(S1); // its session.events stays in flight
    await fake.tick();
    const stop = store.getState().unfollow();
    await fake.reply('fs.unfollow', undefined);
    await stop;
    const second = store.getState().follow(S1); // the same app id, a new follow
    await fake.tick();
    expect(fake.pending.map((p) => p.name)).toEqual(['session.events', 'session.events']);
    fake.event('session.eventBatch', { appSessionId: app, events: [ev('new-live')] }); // buffered for the new follow

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

  it('orders held sessions first, then the most recently written', () => {
    const rows = rowsOf(
      {
        [S1]: { summary: summary(S1, { mtimeMs: 5 }), appSessionId: null },
        [S2]: { summary: summary(S2, { mtimeMs: 1 }), appSessionId: null },
        a: { summary: summary('a' as SessionId, { mtimeMs: 9 }), appSessionId: null },
      },
      { [S2]: { kind: 'terminal', pid: 1 } },
    );
    expect(rows.map((r) => r.summary.sessionId)).toEqual([S2, 'a', S1]);
    expect(rows[0].holder).toEqual({ kind: 'terminal', pid: 1 });
    expect(rows[1].holder).toEqual({ kind: 'none' });
  });

  it('titles a row by custom title, else AI title, else first prompt', () => {
    expect(titleOf(summary(S1, { customTitle: 'C', aiTitle: 'A', firstPrompt: 'P' }))).toBe('C');
    expect(titleOf(summary(S1, { aiTitle: 'A', firstPrompt: 'P' }))).toBe('A');
    expect(titleOf(summary(S1, { firstPrompt: 'P' }))).toBe('P');
    expect(titleOf(summary(S1))).toBe('(untitled)');
  });

  it.each<[Holder, string | null]>([
    [{ kind: 'terminal', pid: 78212 }, 'terminal · 78212'],
    [{ kind: 'background_job', pid: 4242, jobId: 'bdb23713' }, 'bg · bdb23713 · 4242'],
    [{ kind: 'background_job', pid: 4242, jobId: null }, 'bg · 4242'],
    [{ kind: 'none' }, null],
  ])('badges %j as %s', (holder, badge) => {
    expect(describeHolder(holder)).toBe(badge);
  });
});
