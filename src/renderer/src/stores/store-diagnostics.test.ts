import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { FsState } from '@shared/ipc/schema/fs';
import type { Holder, TranscriptSummary } from '@shared/wire/store';
import { createStoreDiagnosticsStore, describeHolder, rowsOf, titleOf } from './store-diagnostics';

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
