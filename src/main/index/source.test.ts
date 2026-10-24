import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult, EventName, EventPayload, HostState } from '@shared/ipc/schema';
import { EngineSessionStatusSchema, type EngineSessionStatus } from '@shared/engine/status';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import type { Holder, TranscriptSummary } from '@shared/wire/store';
import { sessionIdFor, summary, tempDir } from '../../../test/support/index-fixture';
import { StoreFixture } from '../../../test/support/store-fixture';
import { registerFs } from '../../engine-host/fs/register';
import { registerEngineIpc } from '../../engine-host/ipc';
import type { FsService } from '../../engine-host/fs/service';
import { Index } from './index';
import { Db } from './db';
import { locate, locatesWithoutGit } from './projects'; // P4 W2-B
import { DISCOVERY_BATCH, IndexSessionSource, type ReadModelWriter, type SourceHost } from './source';
import { SessionReadModel, type ReadModelWriter as ModelWriter } from '../sessions/read-model'; // C12
import { DiscoveryPendingError, InactiveArchive } from '../sessions/inactive-archive'; // l1-sessions-13

type Listener = (payload: unknown) => void;

const FS_STATE_EMPTY = { configHome: '/cfg', watching: true, projects: 0, sessions: 0, bound: 0, followed: [], holders: [], lastScanAt: null, lastScan: null };
const SCAN_RESULT = { projects: 0, sessions: 0, changed: 0, durationMs: 1 };

// A host the test scripts: commands answer from `answers` (default: ok with undefined) and are recorded; events are
// fired by hand, validated as the supervisor validates host events.
function scriptedHost(state: HostState['state'] = 'ready') {
  const listeners = new Map<string, Set<Listener>>();
  const stateListeners = new Set<(s: HostState) => void>();
  const streamingListeners = new Set<() => void>(); // E10
  const calls: { name: CommandName; input: unknown }[] = [];
  // What a host with an empty store answers, unless a test says otherwise.
  const answers = new Map<CommandName, (input: unknown) => unknown>([
    ['fs.scan', () => SCAN_RESULT],
    ['fs.state', () => FS_STATE_EMPTY],
  ]);
  let current: HostState = { state, pid: 1, restarts: 0, revision: 1 };
  const host: SourceHost = {
    dispatch: vi.fn(async (_owner, name, input) => {
      calls.push({ name, input });
      const answer = answers.get(name);
      return { ok: true, value: answer ? answer(input) : undefined } as CommandResult<CommandName>;
    }),
    onEvent: ((name: string, listener: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }) as SourceHost['onEvent'],
    onState: (_owner, listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    // E10 start
    onStreaming: (_owner, listener) => {
      streamingListeners.add(listener);
      return () => streamingListeners.delete(listener);
    },
    // E10 end
    snapshot: () => current,
  };
  return {
    host,
    calls,
    answers,
    names: () => calls.map((c) => c.name),
    fire<N extends EventName>(name: N, payload: EventPayload<N>) {
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      listeners.get(name)?.forEach((l) => l(checked.value));
    },
    setState(next: HostState['state']) {
      current = { ...current, state: next, revision: current.revision + 1 };
      stateListeners.forEach((l) => l(current));
    },
    // E10: the host's ready line has gone (after main's resync): its events reach main from here
    stream() {
      streamingListeners.forEach((l) => l());
    },
  };
}

function recordingWriter() {
  const calls: { method: keyof ReadModelWriter; arg: unknown }[] = [];
  const writer: ReadModelWriter = {
    observeRecord: (r) => void calls.push({ method: 'observeRecord', arg: r }),
    observeRemoved: (id) => void calls.push({ method: 'observeRemoved', arg: id }),
    observeProject: (p) => void calls.push({ method: 'observeProject', arg: p }),
    observeProjectRemoved: (id) => void calls.push({ method: 'observeProjectRemoved', arg: id }),
    setDigest: (d) => void calls.push({ method: 'setDigest', arg: d }),
  };
  const of = <M extends keyof ReadModelWriter>(method: M) => calls.filter((c) => c.method === method).map((c) => c.arg) as Parameters<ReadModelWriter[M]>[0][];
  return { writer, calls, of };
}

type Emitted = { name: EventName; payload: unknown };


// C3's status as its process table reports it (src/shared/engine/status.ts), validated.
const status = (appSessionId: AppSessionId, over: Partial<EngineSessionStatus> = {}): EngineSessionStatus =>
  EngineSessionStatusSchema.parse({
    appSessionId, engineSessionId: null, pid: 42, launchId: 'L1', launchedAt: '2026-09-28T10:00:00.000Z', taskListId: null, cwd: '/x', pendingPlan: null,
    process: 'ready', exit: null, engineState: 'idle', activity: null, turn: null, model: { requested: null, resolved: 'claude-opus-5' }, effort: null,
    permissionMode: { requested: 'default', effective: 'default', refusal: null }, prePlanMode: null,
    gateway: { mode: 'gateway', baseUrl: 'http://127.0.0.1:8641', verified: 'routed', autoModeServer: 'enabled', localLane: null },
    subagentModel: null, modelOverrides: {}, engineVersion: '2.1.283', fileCheckpointing: true, bin: '/b/claude',
    fastMode: { state: null, disabledReason: null }, plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null /* P2-A */,
    backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0, queue: { length: 0, paused: false }, keepAlive: [], busy: false, lastUsedAt: '2026-09-28T10:00:00.000Z', /* C12 */
    memory: { rssKiB: null, treeRssKiB: null, sampledAt: null }, journalPath: '/j', hostHooks: [], lastEventSeq: 0, trust: { attested: false, recorded: null } /* C10 */, ...over,
  });

describe('IndexSessionSource folds the host\'s events into the index and feeds the read model', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let emitted: Emitted[];
  let source: IndexSessionSource | null;
  let stop: (() => void) | null;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    emitted = [];
    source = null;
    stop = null;
  });
  afterEach(() => {
    stop?.();
    index.close();
    dir.dispose();
  });

  const emit = (name: EventName, payload: unknown) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
    emitted.push({ name, payload });
    return true;
  };
  const events = <N extends EventName>(name: N) => emitted.filter((e) => e.name === name).map((e) => e.payload as EventPayload<N>);
  const begin = (host: SourceHost, writer = recordingWriter().writer) => {
    source = new IndexSessionSource(index, host, { emit, tickMs: 5 });
    stop = source.start(writer);
    return source;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const applied = () => new Promise((resolve) => setImmediate(resolve)); // E11: discoveries apply at the end of the burst's turn
  const withHolders = (holders: { sessionId: SessionId; holder: Holder }[]) => ({ ...FS_STATE_EMPTY, holders: holders.map((h) => ({ ...h, appSessionId: null })) });

  it('indexes every continuation page and retries a timed-out read before marking the stamp current', async () => {
    const transcript = summary();
    const fake = scriptedHost('starting');
    const dispatch = fake.host.dispatch;
    let attempts = 0;
    fake.host.dispatch = async (owner, name, input) => {
      if (name === 'fs.sessionText') {
        attempts += 1;
        if (attempts === 1) return { ok: false, error: ipcError('timeout', 'request timed out') };
        const { cursor } = input as { cursor?: string };
        return { ok: true, value: { text: cursor ? 'boundary needle at the tail' : 'cross-', cursor: cursor ? null : 'page-2', size: transcript.size, mtimeMs: transcript.mtimeMs } } as CommandResult<typeof name>;
      }
      return dispatch(owner, name, input);
    };
    begin(fake.host);
    fake.fire('fs.sessionChanged', { summary: transcript, appSessionId: null });
    await vi.waitFor(() => expect(index.sessionSearch.search('cross-boundary')).toHaveLength(1));
    const record = index.sessions.getByEngineId(transcript.sessionId)!;
    expect(index.sessionSearch.current(record.appId, transcript.sessionId, transcript.size, transcript.mtimeMs)).toBe(true);
    expect(attempts).toBe(3);
    expect(index.sessionSearch.indexing()).toBe(false);
  });

  it('does not loop when both indexing and persisting its terminal failure cannot write to SQLite', async () => {
    const transcript = summary();
    const fake = scriptedHost('starting');
    fake.answers.set('fs.sessionText', () => ({ text: 'Unreadable index destination', cursor: null, size: transcript.size, mtimeMs: transcript.mtimeMs }));
    const run = Db.prototype.run;
    const write = vi.spyOn(Db.prototype, 'run').mockImplementation(function (this: Db, sql, ...params) {
      if (sql.includes('INTO session_text_state')) throw new Error('disk full');
      return run.call(this, sql, ...params);
    });
    try {
      begin(fake.host);
      fake.fire('fs.sessionChanged', { summary: transcript, appSessionId: null });
      await vi.waitFor(() => expect(index.sessionSearch.incomplete()).toBe(true), { timeout: 3000 });
      expect(index.sessionSearch.indexing()).toBe(false);
      fake.fire('fs.sessionChanged', { summary: transcript, appSessionId: null });
      await settle();
      expect(fake.names().filter((name) => name === 'fs.sessionText')).toHaveLength(3);
    } finally { write.mockRestore(); }
  });

  it('keeps a job until its text-index write succeeds', async () => {
    const transcript = summary();
    const fake = scriptedHost('starting');
    fake.answers.set('fs.sessionText', () => ({ text: 'Tail after write recovery', cursor: null, size: transcript.size, mtimeMs: transcript.mtimeMs }));
    const replace = vi.spyOn(index.sessionSearch, 'replace').mockImplementationOnce(() => { throw new Error('temporary write failure'); });
    try {
      begin(fake.host);
      fake.fire('fs.sessionChanged', { summary: transcript, appSessionId: null });
      await vi.waitFor(() => expect(index.sessionSearch.search('write recovery')).toHaveLength(1));
      expect(replace).toHaveBeenCalledTimes(2);
      expect(index.sessionSearch.indexing()).toBe(false);
    } finally { replace.mockRestore(); }
  });

  it('discards an in-flight old stamp and indexes a replacement discovery instead', async () => {
    const transcript = summary();
    const changed = { ...transcript, size: transcript.size + 1, mtimeMs: transcript.mtimeMs + 1 };
    const fake = scriptedHost('starting');
    let resolve!: (page: CommandResult<'fs.sessionText'>) => void;
    let reads = 0;
    const dispatch = fake.host.dispatch;
    fake.host.dispatch = async (owner, name, input) => {
      if (name !== 'fs.sessionText') return dispatch(owner, name, input);
      reads += 1;
      if (reads === 1) return await new Promise<CommandResult<'fs.sessionText'>>((done) => { resolve = done; }) as CommandResult<typeof name>;
      return { ok: true, value: { text: 'Newer conversation', cursor: null, size: changed.size, mtimeMs: changed.mtimeMs } } as CommandResult<typeof name>;
    };
    begin(fake.host);
    fake.fire('fs.sessionChanged', { summary: transcript, appSessionId: null });
    await applied();
    fake.fire('fs.sessionChanged', { summary: changed, appSessionId: null });
    await applied();
    resolve({ ok: true, value: { text: 'Obsolete conversation', cursor: null, size: transcript.size, mtimeMs: transcript.mtimeMs } });
    await vi.waitFor(() => expect(index.sessionSearch.search('Newer conversation')).toHaveLength(1));
    expect(index.sessionSearch.search('Obsolete')).toEqual([]);
    expect(reads).toBe(2);
    expect(index.sessionSearch.indexing()).toBe(false);
  });

  it('restarts indexing after host replacement without waiting for or applying an old in-flight response', async () => {
    const transcript = summary();
    const fake = scriptedHost('starting');
    const dispatch = fake.host.dispatch;
    let reads = 0;
    let resolve!: (value: CommandResult<'fs.sessionText'>) => void;
    fake.host.dispatch = async (owner, name, input) => {
      if (name !== 'fs.sessionText') return dispatch(owner, name, input);
      reads += 1;
      if (reads === 1) return await new Promise<CommandResult<'fs.sessionText'>>((done) => { resolve = done; }) as CommandResult<typeof name>;
      return { ok: true, value: { text: 'Fresh host conversation', cursor: null, size: transcript.size, mtimeMs: transcript.mtimeMs } } as CommandResult<typeof name>;
    };
    begin(fake.host);
    fake.fire('fs.sessionChanged', { summary: transcript, appSessionId: null });
    await applied();
    try {
      fake.setState('crashed');
      fake.setState('ready');
      fake.stream();
      await settle();
      fake.fire('fs.sessionChanged', { summary: transcript, appSessionId: null });
      await vi.waitFor(() => expect(index.sessionSearch.search('Fresh host')).toHaveLength(1));
    } finally {
      resolve({ ok: true, value: { text: 'Obsolete host conversation', cursor: null, size: transcript.size, mtimeMs: transcript.mtimeMs } });
      await settle();
    }
    expect(index.sessionSearch.search('Obsolete host')).toEqual([]);
    expect(index.sessionSearch.indexing()).toBe(false);
  });

  it('ends persistent failures honestly, does not retry unchanged discoveries forever, and recovers after change or restart', async () => {
    const transcript = summary();
    const fake = scriptedHost('starting');
    const dispatch = fake.host.dispatch;
    let reads = 0;
    let failing = true;
    fake.host.dispatch = async (owner, name, input) => {
      if (name === 'fs.sessionText') {
        reads += 1;
        return failing ? { ok: false, error: ipcError('timeout', 'request timed out') } : { ok: true, value: { text: 'Recovered tail', cursor: null, size: transcript.size, mtimeMs: transcript.mtimeMs } } as CommandResult<typeof name>;
      }
      return dispatch(owner, name, input);
    };
    begin(fake.host);
    fake.fire('fs.sessionChanged', { summary: transcript, appSessionId: null });
    await applied();
    await vi.waitFor(() => expect(index.sessionSearch.indexing()).toBe(false), { timeout: 3000 });
    expect(index.sessionSearch.incomplete()).toBe(true);
    expect(reads).toBe(3);
    fake.fire('fs.sessionChanged', { summary: transcript, appSessionId: null });
    await applied();
    expect(reads).toBe(3);

    failing = false;
    fake.stream();
    await settle();
    fake.fire('fs.sessionChanged', { summary: transcript, appSessionId: null });
    await vi.waitFor(() => expect(index.sessionSearch.search('Recovered tail')).toHaveLength(1));
    expect(index.sessionSearch.incomplete()).toBe(false);

    failing = true;
    transcript.size += 1;
    fake.fire('fs.sessionChanged', { summary: { ...transcript }, appSessionId: null });
    await vi.waitFor(() => expect(index.sessionSearch.incomplete()).toBe(true), { timeout: 3000 });
    failing = false;
    transcript.size += 1;
    fake.fire('fs.sessionChanged', { summary: { ...transcript }, appSessionId: null });
    await vi.waitFor(() => expect(index.sessionSearch.incomplete()).toBe(false));
    expect(index.sessionSearch.indexing()).toBe(false);
    expect(reads).toBe(8);
  });

  it('starts by pushing every project and record, then scans with what the index knows and folds the holder snapshot', async () => {
    const tree = tempDir('maws-source-');
    try {
      mkdirSync(join(tree.path, 'alpha'));
      const held = summary({ directory: join(tree.path, 'alpha') });
      const stale = summary();
      const fresh = summary();
      const heldRecord = index.sessions.upsertFromSummary(held).record;
      const staleRecord = index.sessions.upsertFromSummary(stale).record;
      index.sessions.upsertFromSummary(fresh);
      index.sessions.setHolder(stale.sessionId, { kind: 'terminal', pid: 4242 }); // persisted from a previous run; that process is gone
      const launched = index.sessions.createForLaunch({ directory: '/x', additionalDirectories: [], worktree: null, model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null } }).record;
      index.sessions.bindEngineId(launched.appId, sessionIdFor(4)); // bound, no transcript yet

      const fake = scriptedHost();
      fake.answers.set('fs.scan', () => SCAN_RESULT);
      fake.answers.set('fs.state', () => withHolders([{ sessionId: held.sessionId, holder: { kind: 'terminal', pid: 7 } }]));
      const recorded = recordingWriter();
      begin(fake.host, recorded.writer);

      expect(recorded.of('observeProject')).toHaveLength(1);
      expect(recorded.of('observeRecord')).toHaveLength(4);
      // Discovered sessions nobody opened get a digest the sidebar can describe them by.
      expect(recorded.of('setDigest').map((d) => d.appSessionId).sort()).toEqual([heldRecord.appId, staleRecord.appId, index.sessions.getByEngineId(fresh.sessionId)!.appId, launched.appId].sort());

      await settle();
      expect(fake.names()).toEqual(['fs.bind', 'fs.scan', 'fs.state']);
      expect(fake.calls[0].input).toEqual({ bindings: [{ sessionId: sessionIdFor(4), appSessionId: launched.appId }] });
      const known = (fake.calls[1].input as { known: unknown[] }).known;
      expect(known).toHaveLength(3);
      expect(known).toContainEqual({ sessionId: held.sessionId, appSessionId: heldRecord.appId, size: -1, mtimeMs: -1 });
      expect(index.sessions.get(heldRecord.appId)?.holder).toEqual({ kind: 'terminal', pid: 7 });
      expect(index.sessions.get(staleRecord.appId)?.holder).toEqual({ kind: 'none' });
    } finally {
      tree.dispose();
    }
  });

  // E10: fs.scan's discoveries come back only as fs.sessionChanged events, which the host emits from its ready line on,
  // so the sync waits for the host to stream rather than for the `ready` state (reached at the welcome, before main's resync)
  it('syncs once the engine host streams, and again after it restarts (its bindings died with it)', async () => {
    const fake = scriptedHost('starting');
    begin(fake.host);
    await settle();
    expect(fake.names()).toEqual([]);
    fake.setState('ready');
    await settle();
    expect(fake.names()).toEqual([]); // ready, but still pulled from: nothing it would announce could reach main yet
    fake.stream();
    await settle();
    expect(fake.names()).toEqual(['fs.scan', 'fs.state']);
    fake.setState('crashed');
    fake.setState('restarting');
    fake.setState('ready');
    fake.stream();
    await settle();
    expect(fake.names()).toEqual(['fs.scan', 'fs.state', 'fs.scan', 'fs.state']);
  });

  // E10: the reset stays at every transition, `ready` included, so a kept session's burst status re-marks it self after it
  it('a kept live session reads self again from the burst status that follows the ready transition', async () => {
    const disk = summary();
    const appId = index.sessions.upsertFromSummary(disk).record.appId;
    const fake = scriptedHost('starting');
    begin(fake.host);
    index.sessions.applyEngineStatus(appId, { holder: { kind: 'self' } }); // what the last app run left
    fake.setState('ready');
    expect(index.sessions.get(appId)?.holder).toEqual({ kind: 'none' });
    fake.stream();
    fake.fire('session.status', { appSessionId: appId, status: status(appId, { engineSessionId: disk.sessionId }) });
    expect(index.sessions.get(appId)?.holder.kind).toBe('self');
  });

  it('releases self ownership on host loss and refreshes from disk after an empty replacement registry', async () => {
    const disk = summary({ lastAssistantText: 'Before crash' });
    const appId = index.sessions.upsertFromSummary(disk).record.appId;
    const fake = scriptedHost();
    const recorded = recordingWriter();
    begin(fake.host, recorded.writer);
    await settle();
    fake.fire('session.status', { appSessionId: appId, status: status(appId, { engineSessionId: disk.sessionId }) });
    expect(index.sessions.get(appId)?.holder.kind).toBe('self');

    fake.setState('crashed'); // no process.exited event: the whole host disappeared
    expect(index.sessions.get(appId)?.holder).toEqual({ kind: 'none' });
    expect(recorded.of('setDigest').at(-1)).toMatchObject({ appSessionId: appId, phase: 'exited' });
    fake.setState('ready');
    await settle();
    fake.fire('fs.sessionChanged', { appSessionId: appId, summary: { ...disk, size: disk.size + 1, lastAssistantText: 'After crash' } });
    await applied();
    expect(index.sessions.get(appId)?.holder).toEqual({ kind: 'none' });
    expect(recorded.of('setDigest').at(-1)?.lastAssistantLine).toBe('After crash');
    // E11 F2b (plan 2.6): a summary cached before the preview (200 raw characters, a mark cut from its pair) reads clean
    fake.fire('fs.sessionChanged', { appSessionId: appId, summary: { ...disk, size: disk.size + 2, lastAssistantText: '<to-human>\n<essential>Decisive: the cache is stale' } });
    await applied();
    expect(recorded.of('setDigest').at(-1)?.lastAssistantLine).toBe('Decisive: the cache is stale');

    fake.fire('session.status', { appSessionId: appId, status: status(appId, { engineSessionId: disk.sessionId }) });
    expect(index.sessions.get(appId)?.holder.kind).toBe('self');
  });

  it('creates a record per discovered summary, binds every allocated id with one fs.bind per batch, and emits session.changed coalesced per tick', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    await settle();
    fake.calls.length = 0;

    const batch = [summary(), summary(), summary()];
    for (const s of batch) fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
    fake.fire('fs.sessionChanged', { summary: { ...batch[0], customTitle: 'renamed' }, appSessionId: null });
    await settle();

    const records = batch.map((s) => index.sessions.getByEngineId(s.sessionId)!);
    expect(fake.names().filter((name) => name !== 'fs.sessionText')).toEqual(['fs.bind']);
    expect(fake.calls.find((call) => call.name === 'fs.bind')!.input).toEqual({ bindings: batch.map((s, i) => ({ sessionId: s.sessionId, appSessionId: records[i].appId })) });
    const changed = events('session.changed');
    expect(changed).toHaveLength(3); // four changes to three records, one message each
    expect(changed.find((c) => c.record.appId === records[0].appId)).toMatchObject({ cause: 'discovered', record: { title: { text: 'renamed', source: 'user' } } });
    expect(Math.max(...changed.map((c) => c.revision))).toBe(index.revision);
  });

  it('4,000 discovered records go out with 4,000 distinct, strictly increasing revisions, in revision order', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    await settle();
    emitted.length = 0;
    for (let i = 1; i <= 4_000; i++) fake.fire('fs.sessionChanged', { summary: summary({ sessionId: sessionIdFor(0x200000 + i) }), appSessionId: null });
    await vi.waitFor(() => expect(events('session.changed')).toHaveLength(4_000), { timeout: 10_000 }); // E11: applied after the burst's turn
    const revisions = events('session.changed').map((c) => c.revision);
    for (let i = 1; i < revisions.length; i++) expect(revisions[i]).toBeGreaterThan(revisions[i - 1]);
    expect(revisions.at(-1)).toBe(index.revision);
  });

  // E11 (tracker row E3 · C4 "first launch after migration 4 re-summarises for ~10 s"): a scan's burst of summaries is
  // applied several to a transaction, not one transaction each
  describe('a burst of discovered summaries', () => {
    // Index.transaction calls that are no other's inner call: the transactions the source commits
    const outermost = () => {
      const original = index.transaction.bind(index);
      let depth = 0;
      const counted = { n: 0 };
      vi.spyOn(index, 'transaction').mockImplementation((fn) => {
        depth += 1;
        if (depth === 1) counted.n += 1;
        try {
          return original(fn);
        } finally {
          depth -= 1;
        }
      });
      return counted;
    };

    it('is applied in batched transactions of up to DISCOVERY_BATCH, every record created, in order', async () => {
      const fake = scriptedHost();
      begin(fake.host);
      await settle();
      const commits = outermost();
      const burst = Array.from({ length: DISCOVERY_BATCH * 2 + 5 }, (_, i) => summary({ sessionId: sessionIdFor(0x300000 + i) }));
      for (const s of burst) fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
      expect(index.sessions.getByEngineId(burst[0].sessionId)).toBeNull(); // queued: nothing applied inside the burst's turn
      await vi.waitFor(() => expect(events('session.changed')).toHaveLength(burst.length), { timeout: 10_000 });
      expect(commits.n).toBe(3);
      expect(burst.every((s) => index.sessions.getByEngineId(s.sessionId) !== null)).toBe(true);
      const revisions = events('session.changed').map((c) => c.revision);
      expect(revisions).toHaveLength(burst.length);
      for (let i = 1; i < revisions.length; i++) expect(revisions[i]).toBeGreaterThan(revisions[i - 1]);
    });

    it('one summary that cannot be applied costs only itself: the batch is applied again one by one', async () => {
      const fake = scriptedHost();
      begin(fake.host);
      await settle();
      const burst = [summary(), summary(), summary()];
      const upsert = index.sessions.upsertFromSummary.bind(index.sessions);
      vi.spyOn(index.sessions, 'upsertFromSummary').mockImplementation((s) => {
        if (s.sessionId === burst[1].sessionId) throw new Error('constraint failed');
        return upsert(s);
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      for (const s of burst) fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
      await settle();
      expect(burst.map((s) => index.sessions.getByEngineId(s.sessionId) !== null)).toEqual([true, false, true]);
      expect(error.mock.calls.map((c) => String(c[0]))).toEqual(['[index] fs.sessionChanged could not be applied:']);
      expect(events('session.changed')).toHaveLength(2);
    });

    it('asks the linked-worktree question of the burst’s directories off main’s thread first, then applies it', async () => {
      const fake = scriptedHost();
      const warmed: string[][] = [];
      let release: () => void = () => {};
      source = new IndexSessionSource(index, fake.host, {
        emit,
        tickMs: 5,
        warmLinkedWorktrees: (directories) => (warmed.push(directories), new Promise<void>((resolve) => (release = resolve))),
      });
      stop = source.start(recordingWriter().writer);
      await settle();
      warmed.length = 0; // the start's own warm-up of the projects
      const burst = [summary({ directory: '/work/a' }), summary({ directory: '/work/b' }), summary({ directory: '/work/a' })];
      for (const s of burst) fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
      await settle();
      expect(warmed).toEqual([['/work/a', '/work/b']]);
      expect(index.sessions.getByEngineId(burst[0].sessionId)).toBeNull(); // waiting for the warm-up
      release();
      await vi.waitFor(() => expect(burst.every((s) => index.sessions.getByEngineId(s.sessionId) !== null)).toBe(true));
    });

    it('applies what is queued before any other event, so a removal right after its discovery still archives the record', async () => {
      const fake = scriptedHost();
      begin(fake.host);
      const s = summary();
      fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
      fake.fire('fs.sessionRemoved', { sessionId: s.sessionId, appSessionId: null });
      expect(index.sessions.getByEngineId(s.sessionId)).toMatchObject({ archived: true });
    });

    // W-B review M3: applying a first launch's burst at the stop runs git synchronously for every directory still cold,
    // stalling the quit; the next launch's fs.scan re-reports those transcripts, since the index never recorded their
    // sizes, so the stop drops the queue.
    it('the stop drops what is still queued rather than applying it, and a later drain applies nothing', async () => {
      const fake = scriptedHost();
      let release: () => void = () => {};
      source = new IndexSessionSource(index, fake.host, {
        emit,
        tickMs: 5,
        warmLinkedWorktrees: () => new Promise<void>((resolve) => (release = resolve)),
      });
      stop = source.start(recordingWriter().writer);
      release(); // the start's own warm-up
      await settle();
      const burst = [summary({ directory: '/work/a' }), summary({ directory: '/work/b' })];
      for (const s of burst) fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
      await settle(); // the drain's warm-up is out
      stop();
      stop = null;
      expect(burst.map((s) => index.sessions.getByEngineId(s.sessionId))).toEqual([null, null]);
      release();
      await settle();
      expect(burst.map((s) => index.sessions.getByEngineId(s.sessionId))).toEqual([null, null]);
      expect(index.sessions.bindings()).toEqual([]);
    });

    // P4 W2-B (tracker 2026-10-07 "The index sync's warm-up queue…"): a write that lands while the drain's warm-up is
    // out applies what `locate` answers without git (the queue's warm prefix) and the queued summaries of the sessions
    // it is about, so their changes keep the host's order; every other directory waits for the warm-up, never located
    // on main's thread (an answer `locate` computed would be in its cache).
    describe('a write that lands while the warm-up is out', () => {
      let tree: ReturnType<typeof tempDir>;
      beforeEach(() => void (tree = tempDir('maws-source-')));
      afterEach(() => tree.dispose());
      const directory = (name: string) => {
        const path = join(tree.path, name);
        mkdirSync(path);
        return path;
      };
      const applied = (s: TranscriptSummary) => index.sessions.getByEngineId(s.sessionId) !== null;
      // A source whose every warm-up is held: the start's first, then each drain round's, in call order.
      const heldWarmUps = (host: SourceHost) => {
        const warmUps: { directories: string[]; release: () => void }[] = [];
        source = new IndexSessionSource(index, host, { emit, tickMs: 5, warmLinkedWorktrees: (directories) => new Promise<void>((release) => void warmUps.push({ directories, release })) });
        stop = source.start(recordingWriter().writer);
        return warmUps;
      };

      it('a write about one session applies that session’s queued summaries and the warm prefix first, and leaves the cold rest to the warm-up', async () => {
        const fake = scriptedHost();
        const warmUps = heldWarmUps(fake.host);
        warmUps[0].release(); // the start's own (no projects): its refold finds the queue empty
        await settle();
        const launch = index.sessions.createForLaunch({ directory: '/x', additionalDirectories: [], worktree: null, model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null } }).record;
        const looked = summary(); // a session the owner is looking at
        const lookedAt = index.sessions.upsertFromSummary(looked).record.appId;
        source!.onSetVisible(lookedAt, true);
        const warm = directory('warm');
        locate(warm); // asked about once already
        const burst = {
          warm: summary({ directory: warm }),
          cold: summary({ directory: directory('cold') }),
          launched: summary({ directory: directory('launched'), customTitle: 'Named in its transcript' }),
          held: summary({ directory: directory('held') }),
          removed: summary({ directory: directory('removed') }),
          advance: { ...looked, directory: directory('advance'), size: looked.size + 1, lastRecordAt: '2026-09-28T11:00:00.000Z', leafUuid: 'leaf-2' as MessageUuid },
        };
        for (const s of Object.values(burst)) fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
        await settle();
        expect(warmUps).toHaveLength(2); // the drain's is out
        const late = summary({ directory: directory('late') });
        fake.fire('fs.sessionChanged', { summary: late, appSessionId: null }); // arrives during it

        // C3's status binding the transcript the launch writes: that transcript's record is seen first, and the launch takes it over
        fake.fire('session.status', { appSessionId: launch.appId, status: status(launch.appId, { engineSessionId: burst.launched.sessionId }) });
        expect(applied(burst.warm)).toBe(true);
        expect(index.sessions.get(launch.appId)).toMatchObject({ engineSessionId: burst.launched.sessionId, title: { text: 'Named in its transcript' } });
        expect(index.sessions.list({ includeArchived: true }).filter((r) => r.engineSessionId === burst.launched.sessionId)).toHaveLength(1);
        // a terminal takes a session whose discovery is queued: the record is there, held
        fake.fire('fs.holderChanged', { sessionId: burst.held.sessionId, appSessionId: null, holder: { kind: 'terminal', pid: 7 }, registry: null, job: null });
        expect(index.sessions.getByEngineId(burst.held.sessionId)?.holder).toEqual({ kind: 'terminal', pid: 7 });
        // a removal right after its discovery archives the record
        fake.fire('fs.sessionRemoved', { sessionId: burst.removed.sessionId, appSessionId: null });
        expect(index.sessions.getByEngineId(burst.removed.sessionId)).toMatchObject({ archived: true });
        // the owner looks away after the advance arrived: it was read while shown
        source!.onSetVisible(lookedAt, false);
        expect(index.sessions.get(lookedAt)).toMatchObject({ unread: false, lastSeen: { messageUuid: 'leaf-2' } });

        expect([burst.cold, late].map(applied)).toEqual([false, false]);
        expect([burst.cold, late].map((s) => locatesWithoutGit(s.directory))).toEqual([false, false]);

        warmUps[1].release();
        await vi.waitFor(() => expect(applied(burst.cold)).toBe(true));
        expect(applied(late)).toBe(false);
        expect(warmUps).toHaveLength(3);
        expect(warmUps[2].directories).toEqual([late.directory]); // the next round: only what arrived during the last
        warmUps[2].release();
        await vi.waitFor(() => expect(applied(late)).toBe(true));
        // what the writes left stands
        expect(index.sessions.getByEngineId(burst.removed.sessionId)).toMatchObject({ archived: true });
        expect(index.sessions.getByEngineId(burst.held.sessionId)?.holder).toEqual({ kind: 'terminal', pid: 7 });
        expect(index.sessions.get(lookedAt)).toMatchObject({ unread: false, lastSeen: { messageUuid: 'leaf-2' } });
      });

      it('the refold, the host’s reset and the holder fold apply the warm prefix and the summaries of sessions whose remembered holder they drop', async () => {
        const fake = scriptedHost();
        const warmUps = heldWarmUps(fake.host);
        await settle(); // the start's sync folds an empty registry; the start's warm-up is still out
        const terminal = (pid: number): Holder => ({ kind: 'terminal', pid });
        const held = { stale: summary({ directory: directory('stale') }), kept: summary({ directory: directory('kept') }) };
        // registry holders reported before the sessions' discovery: remembered for their records
        fake.fire('fs.holderChanged', { sessionId: held.stale.sessionId, appSessionId: null, holder: terminal(8), registry: null, job: null });
        fake.fire('fs.holderChanged', { sessionId: held.kept.sessionId, appSessionId: null, holder: terminal(9), registry: null, job: null });
        const warm = directory('warm');
        locate(warm);
        const first = summary({ directory: warm });
        const cold = summary({ directory: directory('cold') });
        const behind = summary({ directory: warm }); // warm, but behind a cold one: it keeps its place
        const last = summary({ directory: directory('last') });
        for (const s of [first, cold, held.stale, behind, held.kept, last]) fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
        await settle();
        expect(warmUps).toHaveLength(2); // the drain's is out
        const untouched = [cold, behind, last];

        warmUps[0].release(); // the start's warm-up ends: the refold
        await settle();
        expect([first, ...untouched].map(applied)).toEqual([true, false, false, false]);

        // the host goes: what it remembered of the registry goes with it, so the sessions it remembered holders for are seen first
        fake.setState('crashed');
        expect(index.sessions.getByEngineId(held.stale.sessionId)?.holder).toEqual(terminal(8));
        expect(index.sessions.getByEngineId(held.kept.sessionId)?.holder).toEqual(terminal(9));
        fake.setState('ready');
        // back, it reports a holder for a session whose discovery then arrives; its registry no longer lists that one, nor the stale one
        const gone = summary({ directory: directory('gone') });
        fake.fire('fs.holderChanged', { sessionId: gone.sessionId, appSessionId: null, holder: terminal(10), registry: null, job: null });
        fake.fire('fs.sessionChanged', { summary: gone, appSessionId: null });
        fake.answers.set('fs.state', () => withHolders([{ sessionId: held.kept.sessionId, holder: terminal(9) }]));
        fake.stream();
        await settle(); // the sync's fold
        expect(fake.names().filter((n) => n === 'fs.state')).toHaveLength(2);
        expect([held.stale, held.kept, gone].map((s) => index.sessions.getByEngineId(s.sessionId)?.holder)).toEqual([{ kind: 'none' }, terminal(9), { kind: 'none' }]);

        expect(untouched.map(applied)).toEqual([false, false, false]);
        expect([cold, last].map((s) => locatesWithoutGit(s.directory))).toEqual([false, false]);
        warmUps[1].release();
        await vi.waitFor(() => expect(untouched.map(applied)).toEqual([true, true, true]));
        expect([held.stale, held.kept, gone].map((s) => index.sessions.getByEngineId(s.sessionId)?.holder)).toEqual([{ kind: 'none' }, terminal(9), { kind: 'none' }]);
      });
    });
  });

  it('a tick\'s project and record events go out in revision order: the project a new record joins comes first', async () => {
    const tree = tempDir('maws-source-');
    try {
      mkdirSync(join(tree.path, 'alpha'));
      const fake = scriptedHost();
      begin(fake.host);
      await settle();
      emitted.length = 0;
      fake.fire('fs.sessionChanged', { summary: summary({ directory: join(tree.path, 'alpha') }), appSessionId: null });
      await settle();
      expect(emitted.map((e) => e.name)).toEqual(['session.projects.changed', 'session.changed']);
      const [projects, changed] = emitted.map((e) => (e.payload as { revision: number }).revision);
      expect(changed).toBe(projects + 1);
    } finally {
      tree.dispose();
    }
  });

  // l1-sessions-13 review: the renderer closes tabs on the owner's archive (`update`) and not on a transcript gone from
  // disk (`facts`), so an archive goes out under its own cause whatever changed the record earlier in the tick.
  it('an archive coalesced into a tick goes out under its own cause, not an earlier change’s', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    await settle();
    const owner = summary();
    const gone = summary();
    const ownerId = index.sessions.upsertFromSummary(owner).record.appId;
    const goneId = index.sessions.upsertFromSummary(gone).record.appId;
    await settle();
    emitted.length = 0;
    index.sessions.upsertFromSummary({ ...owner, size: owner.size + 1, lastRecordAt: '2026-09-28T11:00:00.000Z' }); // facts
    index.sessions.update(ownerId, { archived: true }); // the project command's archive
    index.sessions.setPinned(goneId, true); // update
    index.sessions.markTranscriptRemoved(gone.sessionId); // facts: its transcript left the disk
    index.sessions.setUnread(goneId, false); // a later update in the tick lends nothing either
    await settle();
    const changed = new Map(events('session.changed').map((e) => [e.record.appId, e]));
    expect(changed.get(ownerId)).toMatchObject({ cause: 'update', record: { archived: true } });
    expect(changed.get(goneId)).toMatchObject({ cause: 'facts', record: { archived: true } });
  });

  it('a summary that changes nothing emits no session.changed', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    const s = summary();
    fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
    await settle();
    const revision = index.revision;
    emitted.length = 0;
    fake.fire('fs.sessionChanged', { summary: s, appSessionId: index.sessions.getByEngineId(s.sessionId)!.appId });
    await settle();
    expect(emitted).toEqual([]);
    expect(index.revision).toBe(revision);
  });

  it('an index of a newer version leaves the source inert: start neither throws nor touches it, and host events are ignored', async () => {
    index.close();
    const path = join(dir.path, 'index.sqlite');
    const raw = new DatabaseSync(path);
    raw.exec('DROP TABLE sessions; CREATE TABLE sessions (id INTEGER PRIMARY KEY, blob BLOB); PRAGMA user_version = 99');
    raw.close();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    index = new Index(path);
    const fake = scriptedHost();
    const recorded = recordingWriter();
    expect(() => begin(fake.host, recorded.writer)).not.toThrow();
    expect(() => fake.fire('fs.sessionChanged', { summary: summary(), appSessionId: null })).not.toThrow();
    expect(() => source!.onSetVisible(randomUUID() as AppSessionId, true)).not.toThrow();
    await settle();
    expect(recorded.calls).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(emitted).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('index unavailable'));
  });

  // C5's rebase: the seed digest is the only activity time the shell has for a session nobody runs (the record's
  // `updatedAt` is when the index wrote it), and the sidebar's age, its recency sort and the Overview's order read it.
  it('seeds a discovered session’s digest with its transcript’s last record time', async () => {
    const fake = scriptedHost();
    const recorded = recordingWriter();
    begin(fake.host, recorded.writer);
    await settle();

    const found = summary({ lastRecordAt: '2026-09-20T08:30:00.000Z' });
    fake.fire('fs.sessionChanged', { summary: found, appSessionId: null });
    await applied();
    const record = index.sessions.getByEngineId(found.sessionId)!;
    expect(recorded.of('setDigest').filter((d) => d.appSessionId === record.appId).at(-1)).toMatchObject({ phase: 'exited', turnStartedAt: null, lastTurnEndedAt: '2026-09-20T08:30:00.000Z' });
  });

  it('holders: applied to the record, remembered for a record that does not exist yet, and over a self-held one only as its contest', async () => {
    const fake = scriptedHost();
    const recorded = recordingWriter();
    begin(fake.host, recorded.writer);
    await settle();

    const later = summary();
    fake.fire('fs.holderChanged', { sessionId: later.sessionId, appSessionId: null, holder: { kind: 'terminal', pid: 99 }, registry: null, job: null });
    fake.fire('fs.sessionChanged', { summary: later, appSessionId: null });
    await applied();
    const record = index.sessions.getByEngineId(later.sessionId)!;
    expect(record.holder).toEqual({ kind: 'terminal', pid: 99 });
    expect(recorded.of('setDigest').filter((d) => d.appSessionId === record.appId).at(-1)).toMatchObject({ phase: 'foreign' });

    fake.fire('fs.holderChanged', { sessionId: later.sessionId, appSessionId: record.appId, holder: { kind: 'none' }, registry: null, job: null });
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'none' });
    expect(recorded.of('setDigest').filter((d) => d.appSessionId === record.appId).at(-1)).toMatchObject({ phase: 'exited' });

    index.sessions.applyEngineStatus(record.appId, { holder: { kind: 'self' } });
    fake.fire('fs.holderChanged', { sessionId: later.sessionId, appSessionId: record.appId, holder: { kind: 'terminal', pid: 5 }, registry: null, job: null });
    // W7: MAWS's own holder stays, contested by the terminal; the terminal's exit makes it plain self again
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'self', contestedBy: { kind: 'terminal', pid: 5 } });
    fake.fire('fs.holderChanged', { sessionId: later.sessionId, appSessionId: record.appId, holder: { kind: 'none' }, registry: null, job: null });
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'self' });
  });

  it('a transcript removed from disk archives its record and keeps it', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    const s = summary();
    fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
    await applied();
    const appId = index.sessions.getByEngineId(s.sessionId)!.appId;
    fake.fire('fs.sessionRemoved', { sessionId: s.sessionId, appSessionId: appId });
    expect(index.sessions.get(appId)).toMatchObject({ archived: true });
    await settle();
    expect(events('session.changed').at(-1)).toMatchObject({ record: { appId, archived: true } });
  });

  it('a session.status event for a bound app id updates the engine id, holder and gateway through applyEngineStatus, and binds the host', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    const { record } = index.sessions.createForLaunch({ directory: '/x', additionalDirectories: [], worktree: null, model: { requested: 'opus', resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    await settle();
    fake.calls.length = 0;
    const engineId = sessionIdFor(31);
    fake.fire('session.status', { appSessionId: record.appId, status: status(record.appId, { engineSessionId: engineId }) });
    expect(index.sessions.get(record.appId)).toMatchObject({
      engineSessionId: engineId,
      holder: { kind: 'self' },
      gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'enabled' },
      model: { requested: null, resolved: 'claude-opus-5' },
    });
    await settle();
    // No fs.unfollow: an id unbound until this status was never followed from disk (liveStatus).
    expect(fake.calls).toEqual([{ name: 'fs.bind', input: { bindings: [{ sessionId: engineId, appSessionId: record.appId }] } }]);
    expect(events('session.changed').at(-1)).toMatchObject({ cause: 'live', record: { appId: record.appId } });

    // C3's patch: a status before verification leaves the gateway, and one before the first frame the engine version,
    // as the record holds them.
    fake.fire('session.status', { appSessionId: record.appId, status: status(record.appId, { engineSessionId: engineId, engineVersion: null, gateway: { mode: 'gateway', baseUrl: null, verified: 'pending', autoModeServer: 'unknown', localLane: null } }) });
    expect(index.sessions.get(record.appId)).toMatchObject({ engineVersion: '2.1.283', gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'enabled' } });
    // C3's patch leaves the holder out once the process has exited ("the index decides"): nothing holds it then, and a
    // foreign holder arrives through fs.holderChanged.
    fake.fire('session.status', { appSessionId: record.appId, status: status(record.appId, { engineSessionId: engineId, process: 'exited' }) });
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'none' });
    // A status for an app session the index has no row for is ignored, not a crash.
    expect(() => fake.fire('session.status', { appSessionId: randomUUID() as AppSessionId, status: status(randomUUID() as AppSessionId) })).not.toThrow();
  });

  // W7 (charter §4.3 as amended 2026-10-01; pass3/w7-collision): a terminal resumes the session MAWS runs, the record
  // reads contested while MAWS's process runs, and when the process exits the terminal, which the registry reported
  // once and never again, holds the record; when the terminal exits too, nothing does.
  it('a foreign holder that joins a session MAWS runs makes it contested, and holds it once the process exits', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    const { record } = index.sessions.createForLaunch({ directory: '/x', additionalDirectories: [], worktree: null, model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    const engineId = sessionIdFor(33);
    fake.fire('session.status', { appSessionId: record.appId, status: status(record.appId, { engineSessionId: engineId }) });
    fake.fire('fs.holderChanged', { sessionId: engineId, appSessionId: record.appId, holder: { kind: 'terminal', pid: 96367 }, registry: null, job: null });
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'self', contestedBy: { kind: 'terminal', pid: 96367 } });
    // a later status of the live process keeps the contest (C3's patch says only `self`)
    fake.fire('session.status', { appSessionId: record.appId, status: status(record.appId, { engineSessionId: engineId }) });
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'self', contestedBy: { kind: 'terminal', pid: 96367 } });
    fake.fire('session.status', { appSessionId: record.appId, status: status(record.appId, { engineSessionId: engineId, process: 'exited' }) });
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'terminal', pid: 96367 });
    fake.fire('fs.holderChanged', { sessionId: engineId, appSessionId: record.appId, holder: { kind: 'none' }, registry: null, job: null });
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'none' });
    // A host restart loses both self ownership and the stale contest.
    index.sessions.applyEngineStatus(record.appId, { holder: { kind: 'self', contestedBy: { kind: 'terminal', pid: 1 } } });
    fake.setState('starting');
    fake.setState('ready');
    await settle();
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'none' });
  });

  it('a host restart forgets which ids were live: a relaunch after it stops the disk follow again, with no exit seen', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    const { record } = index.sessions.createForLaunch({ directory: '/x', additionalDirectories: [], worktree: null, model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    const engineId = sessionIdFor(32);
    index.sessions.bindEngineId(record.appId, engineId);
    const unfollows = () => fake.calls.filter((c) => c.name === 'fs.unfollow').length;
    fake.fire('session.status', { appSessionId: record.appId, status: status(record.appId, { engineSessionId: engineId }) });
    await settle();
    expect(unfollows()).toBe(1);
    fake.fire('session.status', { appSessionId: record.appId, status: status(record.appId, { engineSessionId: engineId }) });
    await settle();
    expect(unfollows()).toBe(1); // the same run
    // The host crashes and comes back; its process went with it and no `exited` status was ever sent.
    fake.setState('crashed');
    fake.setState('ready');
    fake.fire('session.status', { appSessionId: record.appId, status: status(record.appId, { engineSessionId: engineId, process: 'starting' }) });
    await settle();
    expect(unfollows()).toBe(2);
  });

  describe('the unread rule', () => {
    const advance = (s: TranscriptSummary, at: string, leaf: string) => ({ ...s, lastRecordAt: at, leafUuid: leaf as MessageUuid, size: s.size + 1 });

    it('a visible session whose lastRecordAt advances stays read and its lastSeen moves; a hidden one turns unread', async () => {
      const fake = scriptedHost();
      begin(fake.host);
      const shown = summary();
      const hidden = summary();
      fake.fire('fs.sessionChanged', { summary: shown, appSessionId: null });
      fake.fire('fs.sessionChanged', { summary: hidden, appSessionId: null });
      await applied();
      const shownId = index.sessions.getByEngineId(shown.sessionId)!.appId;
      const hiddenId = index.sessions.getByEngineId(hidden.sessionId)!.appId;

      source!.onSetVisible(shownId, true);
      expect(index.sessions.get(shownId)?.lastSeen.at).not.toBeNull(); // becoming visible marks it seen at once
      const seenBefore = index.sessions.get(shownId)!.lastSeen;
      await settle();
      emitted.length = 0;

      fake.fire('fs.sessionChanged', { summary: advance(shown, '2026-09-28T11:00:00.000Z', 'leaf-2'), appSessionId: shownId });
      fake.fire('fs.sessionChanged', { summary: advance(hidden, '2026-09-28T11:00:00.000Z', 'leaf-9'), appSessionId: hiddenId });
      await applied();
      const shownAfter = index.sessions.get(shownId)!;
      expect(shownAfter.unread).toBe(false);
      expect(shownAfter.lastSeen.messageUuid).toBe('leaf-2');
      expect(shownAfter.lastSeen).not.toEqual(seenBefore);
      expect(index.sessions.get(hiddenId)?.unread).toBe(true);
      await settle();
      // The visible record never flickers unread on the wire.
      expect(events('session.changed').filter((c) => c.record.appId === shownId).every((c) => !c.record.unread)).toBe(true);

      // Hiding it again: the next advance turns it unread; showing it marks it seen.
      source!.onSetVisible(shownId, false);
      fake.fire('fs.sessionChanged', { summary: advance(shown, '2026-09-28T12:00:00.000Z', 'leaf-3'), appSessionId: shownId });
      await applied();
      expect(index.sessions.get(shownId)?.unread).toBe(true);
      source!.onSetVisible(shownId, true);
      expect(index.sessions.get(shownId)).toMatchObject({ unread: false, lastSeen: { messageUuid: 'leaf-3' } });
      // Visibility of an app session the index has no row for (an unstarted tab) is kept and harmless.
      expect(() => source!.onSetVisible(randomUUID() as AppSessionId, true)).not.toThrow();
    });
  });

  it('emits session.projects.changed with the whole list on every project change', async () => {
    const tree = tempDir('maws-source-');
    try {
      mkdirSync(join(tree.path, 'alpha'));
      const fake = scriptedHost();
      const recorded = recordingWriter();
      begin(fake.host, recorded.writer);
      fake.fire('fs.sessionChanged', { summary: summary({ directory: join(tree.path, 'alpha') }), appSessionId: null });
      await settle();
      const [project] = index.projects.list();
      expect(events('session.projects.changed').at(-1)).toEqual({ projects: [project], revision: expect.any(Number) });
      expect(recorded.of('observeProject')).toContainEqual(project);
      index.projects.hide(project.id);
      await settle();
      // W11 (I5): the event carries the hidden project, marked, as the list does; the writer stops observing it
      expect(events('session.projects.changed').at(-1)).toMatchObject({ projects: [{ ...project, hidden: true }] });
      expect(recorded.of('observeProjectRemoved')).toEqual([project.id]);
    } finally {
      tree.dispose();
    }
  });

  it('a removed record is unbound in the host (which stops its followers) and reported removed', async () => {
    const fake = scriptedHost();
    const recorded = recordingWriter();
    begin(fake.host, recorded.writer);
    const appId = randomUUID() as AppSessionId;
    index.sessions.createReplay({ appId, sessionId: 'rp_x' as SessionId, title: 'replay' });
    await settle();
    fake.calls.length = 0;
    index.sessions.remove(appId);
    await settle();
    expect(fake.calls).toEqual([{ name: 'fs.unbind', input: { appSessionId: appId } }]);
    expect(events('session.removed').at(-1)).toEqual({ appSessionId: appId, revision: index.revision });
    expect(recorded.of('observeRemoved')).toEqual([appId]);
  });

  it('logs a failed host command instead of throwing', async () => {
    const fake = scriptedHost();
    (fake.host.dispatch as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: false, error: ipcError('host_unavailable', 'engine-host is crashed') }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    begin(fake.host);
    await settle();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('fs.scan'), expect.stringContaining('engine-host is crashed'));
  });

  // C12 start: the memory budget's released mark against C4's seeds (C12 execution document, Edits to landed children,
  // C4 row): the seed leaves `released` out, and main's read model keeps the mark against a seed with phase `exited` and
  // drops it against one with phase `foreign`. The release's own exited status reaches the index as cause `live`, which
  // seeds nothing; the seeds after it come from the transcript the exit writes (`facts`) and from holder changes.
  describe('the released mark against the index seeds', () => {
    const RELEASE = { limitKiB: 8_388_608, totalKiB: 9_100_000 };
    const ENGINE_ID = sessionIdFor(41);
    const released = (appSessionId: AppSessionId) =>
      status(appSessionId, { engineSessionId: ENGINE_ID, process: 'exited', exit: { code: 0, signal: null, reason: 'budget', at: '2026-09-29T14:02:00.000Z', release: RELEASE } });
    // C4's source writing into a real read model, and C3's statuses reaching both, as main wires them
    const wired = async () => {
      const fake = scriptedHost();
      const model = new SessionReadModel('index');
      let writer: ModelWriter | null = null;
      model.register({
        start: (w) => {
          writer = w;
          begin(fake.host, w);
          return () => {};
        },
      });
      const { record } = index.sessions.createForLaunch({ directory: '/x', additionalDirectories: [], worktree: null, model: { requested: 'opus', resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null } });
      await settle();
      const apply = (s: EngineSessionStatus) => {
        writer!.applyEngineStatus(s);
        fake.fire('session.status', { appSessionId: record.appId, status: s });
      };
      apply(status(record.appId, { engineSessionId: ENGINE_ID }));
      apply(released(record.appId));
      await settle();
      const digest = () => model.digests().find((d) => d.appSessionId === record.appId)!;
      const holder = (h: Holder) => fake.fire('fs.holderChanged', { sessionId: ENGINE_ID, appSessionId: record.appId, holder: h, registry: null, job: null });
      const transcriptWritten = () => fake.fire('fs.sessionChanged', { summary: summary({ sessionId: ENGINE_ID, lastRecordAt: '2026-09-29T14:02:01.000Z' }), appSessionId: record.appId });
      return { digest, holder, transcriptWritten };
    };
    const MARK = { at: '2026-09-29T14:02:00.000Z', limitKiB: 8_388_608 };

    it('after a release the seeds with phase exited (the exit’s transcript write, a holder reported none) leave the row idle and marked', async () => {
      const { digest, holder, transcriptWritten } = await wired();
      expect(digest()).toMatchObject({ phase: 'idle', released: MARK });
      transcriptWritten();
      holder({ kind: 'none' });
      await settle();
      expect(digest()).toMatchObject({ phase: 'idle', released: MARK, lastTurnEndedAt: '2026-09-29T14:02:01.000Z' });
    });

    it('a terminal holder after a release reads foreign with no mark, and stays unmarked once it lets go', async () => {
      const { digest, holder } = await wired();
      holder({ kind: 'terminal', pid: 7 });
      expect(digest().phase).toBe('foreign');
      expect(digest().released).toBeUndefined();
      holder({ kind: 'none' });
      expect(digest().phase).toBe('exited');
      expect(digest().released).toBeUndefined();
    });
  });
  // C12 end

  // l1-sessions-13: the inactivity archive reads a session's last activity from the index, which before this run's scan
  // (and the warm-up its discoveries wait for) still holds what an earlier run saw of the store.
  describe('discovery freshness for the inactivity archive', () => {
    const NOW = Date.parse('2026-10-24T00:00:00.000Z');
    const archiverOver = (current: IndexSessionSource) => new InactiveArchive({
      index, status: () => null, waiting: () => false, git: async () => '', now: () => NOW,
      discovered: (engineSessionId) => current.discoveryCurrent(engineSessionId),
      archive: async (id, eligible) => ((await eligible()) ? (index.sessions.update(id, { archived: true }), { archived: true as const }) : { status: 'skipped_ineligible' as const }),
    });

    it('a cached old session the CLI used while the app was closed is not archived before its scan’s summary applies, nor after', async () => {
      const cached = summary({ lastRecordAt: '2026-09-01T00:00:00.000Z' });
      const record = index.sessions.upsertFromSummary(cached).record;
      const fake = scriptedHost('starting');
      fake.answers.set('fs.scan', () => {
        fake.fire('fs.sessionChanged', { appSessionId: record.appId, summary: { ...cached, size: cached.size + 1, mtimeMs: cached.mtimeMs + 1, lastRecordAt: '2026-10-23T12:00:00.000Z' } });
        return SCAN_RESULT;
      });
      // the holder fold after the scan would apply the queue's warm prefix (this directory is cached since the record's
      // making); held, so the queued summary is seen waiting as a cold directory's waits for its warm-up
      const dispatch = fake.host.dispatch as ReturnType<typeof vi.fn>;
      const answer = dispatch.getMockImplementation() as SourceHost['dispatch'];
      dispatch.mockImplementation((...args: Parameters<SourceHost['dispatch']>) => (args[1] === 'fs.state' ? new Promise(() => {}) : answer(...args)));
      const warmUps: (() => void)[] = [];
      source = new IndexSessionSource(index, fake.host, { emit, tickMs: 5, warmLinkedWorktrees: () => new Promise<void>((release) => void warmUps.push(release)) });
      const scanned = vi.fn();
      source.onScanned(scanned);
      stop = source.start(recordingWriter().writer);
      const archiver = archiverOver(source);

      expect(source.discoveryCurrent(null)).toBe(false);
      await expect(archiver.run(7, null)).rejects.toBeInstanceOf(DiscoveryPendingError);
      fake.setState('ready');
      fake.stream();
      await settle();
      expect(scanned).toHaveBeenCalledTimes(1);
      expect(source.discoveryCurrent(null)).toBe(true);
      expect(source.discoveryCurrent(cached.sessionId)).toBe(false); // its summary waits for the warm-up
      expect(await archiver.run(7, null)).toEqual({ archived: 0, skipped: 1 });
      expect(index.sessions.get(record.appId)?.archived).toBe(false);

      warmUps.forEach((release) => release());
      await settle();
      expect(source.discoveryCurrent(cached.sessionId)).toBe(true);
      expect(index.sessions.summaryOf(record.appId)?.lastRecordAt).toBe('2026-10-23T12:00:00.000Z');
      expect(await archiver.run(7, null)).toEqual({ archived: 0, skipped: 1 });
      expect(index.sessions.get(record.appId)?.archived).toBe(false);

      fake.setState('crashed'); // the next host's scan has to answer again
      expect(source.discoveryCurrent(null)).toBe(false);
      await expect(archiver.run(7, null)).rejects.toBeInstanceOf(DiscoveryPendingError);
    });

    it('a scan that fails leaves the index not current, and a stopped source is never current', async () => {
      const fake = scriptedHost('starting');
      const dispatch = fake.host.dispatch as ReturnType<typeof vi.fn>;
      const answer = dispatch.getMockImplementation() as SourceHost['dispatch'];
      dispatch.mockImplementation(async (...args: Parameters<SourceHost['dispatch']>) =>
        args[1] === 'fs.scan' ? { ok: false, error: ipcError('host_unavailable', 'engine-host is crashed') } : answer(...args));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const current = begin(fake.host);
      fake.setState('ready');
      fake.stream();
      await settle();
      expect(dispatch).toHaveBeenCalledWith('engine-host', 'fs.scan', expect.anything());
      expect(current.discoveryCurrent(null)).toBe(false);
      dispatch.mockImplementation(answer);
      fake.stream();
      await settle();
      expect(current.discoveryCurrent(null)).toBe(true);
      stop!();
      stop = null;
      expect(current.discoveryCurrent(null)).toBe(false);
    });
  });

  it('stop unsubscribes from the host and the index', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    stop!();
    stop = null;
    fake.fire('fs.sessionChanged', { summary: summary(), appSessionId: null });
    expect(index.sessions.list()).toEqual([]);
  });
});

// The real engine-host registration over a StoreFixture, wired in process as src/engine-host/index.ts wires it (C4's
// filesystem service, and C3's IPC whose session.events answers a session with no process from it): commands dispatch
// to the registered handlers with their outputs validated, and events reach the source validated, in emitted order.
function inProcessHost(configHome: string) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const listeners = new Map<string, Set<Listener>>();
  const calls: { name: CommandName; input: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
    listeners.get(name)?.forEach((l) => l(checked.value));
    return true;
  };
  let service: FsService | null = null;
  const host: SourceHost = {
    dispatch: async (_owner, name, input) => {
      calls.push({ name, input });
      try {
        return validateCommandOutput(name, await handlers.get(name)!(input));
      } catch (error) {
        return { ok: false, error: ipcError('internal', error instanceof Error ? error.message : String(error)) };
      }
    },
    onEvent: ((name: string, listener: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }) as SourceHost['onEvent'],
    onState: () => () => {},
    onStreaming: () => () => {}, // E10
    snapshot: () => ({ state: 'ready', pid: 1, restarts: 0, revision: 1 }),
  };
  return {
    host,
    calls,
    start: () => {
      const fs = (service = registerFs(on, emit, { CLAUDE_CONFIG_DIR: configHome }));
      registerEngineIpc(on, emit, { userData: join(configHome, 'engine-host-user-data') /* removed with the fixture; nothing is launched */, replayEnabled: false, diskEvents: (id) => fs.eventsSnapshot(id, null) });
    },
    stop: () => service?.stop(),
    listen: (name: EventName, listener: Listener) => host.onEvent(name as 'fs.sessionChanged', listener),
    // An event from elsewhere in the host (C3's `session.status`), through the same validated relay.
    fire: <N extends EventName>(name: N, payload: EventPayload<N>) => emit(name, payload),
  };
}

describe('IndexSessionSource against the real filesystem state service', () => {
  let dir: ReturnType<typeof tempDir>;
  let fixture: StoreFixture;
  let index: Index;
  let wired: ReturnType<typeof inProcessHost>;
  let stop: (() => void) | null;
  beforeEach(async () => {
    dir = tempDir();
    fixture = await StoreFixture.create();
    index = new Index(join(dir.path, 'index.sqlite'));
    wired = inProcessHost(fixture.configHome);
    stop = null;
  });
  afterEach(async () => {
    stop?.();
    wired.stop();
    index.close();
    dir.dispose();
    await fixture.dispose();
  });

  const user = (uuid: string, parentUuid: string | null, cwd: string, content: string) => ({ type: 'user', uuid, parentUuid, cwd, timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content } });
  const S = [sessionIdFor(1), sessionIdFor(2), sessionIdFor(3)];
  const noop = recordingWriter().writer;
  const begin = (writer: ReadModelWriter = noop) => {
    const source = new IndexSessionSource(index, wired.host, { emit: () => true, tickMs: 5 });
    stop = source.start(writer);
    return source;
  };

  it('binds every app id it allocated during a scan of three new sessions, and later fs.sessionChanged events carry those ids', async () => {
    for (const [i, sessionId] of S.entries()) await fixture.addTranscript(`/work/p${i}`, sessionId, [user('u1', null, `/work/p${i}`, `hello ${i}`)]);
    const later: EventPayload<'fs.sessionChanged'>[] = [];
    wired.listen('fs.sessionChanged', (payload) => later.push(payload as EventPayload<'fs.sessionChanged'>));
    wired.start();
    begin();

    await expect.poll(() => index.sessions.list().length, { timeout: 3_000 }).toBe(3);
    const allocated = S.map((sessionId) => index.sessions.getByEngineId(sessionId)!.appId);
    await expect.poll(() => index.sessionSearch.search('hello 1').map((hit) => hit.appSessionId)).toEqual([allocated[1]]);
    await fixture.appendLines(fixture.transcriptPath(S[1]), [JSON.stringify(user('u2', 'u1', '/work/p1', 'content-needle'))]);
    await expect.poll(() => index.sessionSearch.search('content-needle').map((hit) => hit.appSessionId)).toEqual([allocated[1]]);
    await expect.poll(() => wired.calls.filter((c) => c.name === 'fs.bind').flatMap((c) => (c.input as { bindings: { appSessionId: string }[] }).bindings.map((b) => b.appSessionId)).sort(), { timeout: 3_000 }).toEqual([...allocated].sort());

    later.length = 0;
    await fixture.appendLines(fixture.transcriptPath(S[1]), [JSON.stringify({ type: 'custom-title', customTitle: 'Named later', sessionId: S[1] })]);
    await expect.poll(() => later.find((e) => e.summary.customTitle === 'Named later')?.appSessionId, { timeout: 3_000 }).toBe(allocated[1]);
    expect(index.sessions.get(allocated[1])?.title).toEqual({ text: 'Named later', source: 'user' });
  });

  it.each(['cold reconcile', 'watcher delete'] as const)('%s marks missing transcripts gone and drops empty discovered projects, not user projects', async (route) => {
    const discoveredDir = join(dir.path, 'discovered');
    const userDir = join(dir.path, 'user');
    mkdirSync(discoveredDir);
    mkdirSync(userDir);
    const userProject = index.projects.add(userDir);
    await fixture.addTranscript(discoveredDir, S[0], [user('u1', null, discoveredDir, 'discovered transcript')]);
    await fixture.addTranscript(userDir, S[1], [user('u2', null, userDir, 'user project transcript')]);
    const recorded = recordingWriter();
    wired.start();
    begin(recorded.writer);
    await expect.poll(() => index.sessions.list().length, { timeout: 3_000 }).toBe(2);
    await expect.poll(() => wired.calls.some((c) => c.name === 'fs.state'), { timeout: 3_000 }).toBe(true);
    const discoveredProject = index.sessions.getByEngineId(S[0])!.projectId;
    expect(index.projects.list().map((p) => p.id)).toContain(discoveredProject);

    if (route === 'cold reconcile') {
      stop!();
      wired.stop();
    }
    rmSync(fixture.transcriptPath(S[0]));
    rmSync(fixture.transcriptPath(S[1]));
    if (route === 'cold reconcile') {
      wired = inProcessHost(fixture.configHome);
      wired.start();
      begin(recorded.writer);
    }

    await expect.poll(() => index.sessions.list(), { timeout: 3_000 }).toEqual([]);
    for (const sessionId of S.slice(0, 2)) {
      expect(index.sessions.getByEngineId(sessionId)).toMatchObject({ archived: true });
      expect(index.sessions.bindings().find((b) => b.sessionId === sessionId)).toMatchObject({ size: null, mtimeMs: null });
    }
    expect(index.projects.list().map((p) => p.id)).toEqual([userProject.id]);
    expect(index.projects.listWithRemoved().map((p) => p.id)).toEqual([userProject.id]);
    expect(recorded.of('observeProjectRemoved')).toContain(discoveredProject);

    // A moved/restored transcript recovers its archived record and project membership.
    await fixture.addTranscript(discoveredDir, S[0], [user('u1', null, discoveredDir, 'discovered transcript')]);
    await expect.poll(() => index.sessions.getByEngineId(S[0])?.archived, { timeout: 3_000 }).toBe(false);
    expect(index.projects.list().map((p) => p.id)).toContain(discoveredProject);
  });

  it('a cold start scans once: one fs.scan, and each transcript reaches main in one fs.sessionChanged (debt wave 6)', async () => {
    for (const [i, sessionId] of S.entries()) await fixture.addTranscript(`/work/p${i}`, sessionId, [user('u1', null, `/work/p${i}`, `hello ${i}`)]);
    const changed: SessionId[] = [];
    wired.listen('fs.sessionChanged', (payload) => changed.push((payload as EventPayload<'fs.sessionChanged'>).summary.sessionId));
    wired.start(); // the host's start-up pass is listing when main's scan arrives, as at an app start
    begin();

    await expect.poll(() => index.sessions.list().length, { timeout: 3_000 }).toBe(3);
    await expect.poll(() => wired.calls.some((c) => c.name === 'fs.state'), { timeout: 3_000 }).toBe(true); // the sync ended
    expect(wired.calls.filter((c) => c.name === 'fs.scan')).toHaveLength(1);
    expect(changed.sort()).toEqual([...S].sort());
  });

  it('a second engine id in session.status (the engine\'s /clear) rebinds the app session in the index and the host; the old transcript becomes its own record', async () => {
    const [A, B] = S;
    const line = (uuid: string, content: string) => JSON.stringify(user(uuid, null, '/work/c', content));
    await fixture.addTranscript('/work/c', A, [line('a1', 'before the clear'), JSON.stringify({ type: 'custom-title', customTitle: 'Before', sessionId: A })]);
    await fixture.addTranscript('/work/c', B, [line('b1', 'after the clear')]);
    await fixture.addRegistryRecord(process.pid, { sessionId: B, cwd: '/work/c', kind: 'interactive', startedAt: Date.now() });
    wired.start();
    begin();
    // Discovery sees both transcripts before any status names them: the launch's statuses take those records over.
    await expect.poll(() => index.sessions.list().length, { timeout: 3_000 }).toBe(2);
    const { record } = index.sessions.createForLaunch({ directory: '/work/c', additionalDirectories: [], worktree: null, model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null } });
    const app = record.appId;
    const ask = async <T,>(name: CommandName, input: unknown): Promise<T> => {
      const answer = await wired.host.dispatch('engine-host', name, input as never);
      if (!answer.ok) throw new Error(answer.error.message);
      return answer.value as T;
    };
    type Attributed = { holders: { sessionId: string; appSessionId: string | null }[] };
    const attributed = (answer: Attributed, sessionId: SessionId) => answer.holders.filter((h) => h.sessionId === sessionId).map((h) => h.appSessionId);
    const eventsOf = async () => (await ask<{ events: { kind: string; content?: unknown; sessionId: string }[] }>('session.events', { appSessionId: app, afterSeq: null, limit: 1000 })).events;
    const said = async () => (await eventsOf()).filter((e) => e.kind === 'user.message').map((e) => e.content);

    wired.fire('session.status', { appSessionId: app, status: status(app, { engineSessionId: A }) });
    expect(index.sessions.get(app)).toMatchObject({ engineSessionId: A, title: { text: 'Before', source: 'user' } });
    await expect.poll(said, { timeout: 3_000 }).toEqual(['before the clear']);

    wired.fire('session.status', { appSessionId: app, status: status(app, { engineSessionId: B }) });
    expect(index.sessions.get(app)?.engineSessionId).toBe(B);
    expect(index.sessions.list().filter((r) => r.engineSessionId === B).map((r) => r.appId)).toEqual([app]);
    const history = index.sessions.getByEngineId(A)!;
    expect(history.appId).not.toBe(app);
    expect(history.title).toEqual({ text: 'Before', source: 'user' });
    // The host's pairs follow: B's holder is attributed to the app session, A to its own record; the follower moved.
    await expect.poll(async () => attributed(await ask<Attributed>('fs.holders', { sessionIds: [B], directories: null }), B), { timeout: 3_000 }).toEqual([app]);
    expect(attributed(await ask<Attributed>('fs.state', undefined), B)).toEqual([app]);
    await expect.poll(said, { timeout: 3_000 }).toEqual(['after the clear']);
    expect((await eventsOf()).every((e) => e.sessionId === B)).toBe(true);
    await fixture.appendLines(fixture.transcriptPath(A), [JSON.stringify({ type: 'custom-title', customTitle: 'Old, renamed later', sessionId: A })]);
    await expect.poll(() => index.sessions.get(history.appId)?.title.text, { timeout: 3_000 }).toBe('Old, renamed later');
    expect(index.sessions.get(app)?.title.text).not.toBe('Old, renamed later');
  });

  it('read then resume: the disk follow a session.events read started stops when C3 reports the same app id live, once per run', async () => {
    const line = (uuid: string, parent: string | null, content: string) => JSON.stringify(user(uuid, parent, '/work/r', content));
    await fixture.addTranscript('/work/r', S[0], [line('r1', null, 'before the resume')]);
    const batches: EventPayload<'session.eventBatch'>[] = [];
    wired.listen('session.eventBatch', (payload) => batches.push(payload as EventPayload<'session.eventBatch'>));
    wired.start();
    begin();
    await expect.poll(() => index.sessions.getByEngineId(S[0])?.appId ?? null, { timeout: 3_000 }).not.toBeNull();
    const app = index.sessions.getByEngineId(S[0])!.appId;
    await expect.poll(() => wired.calls.some((c) => c.name === 'fs.bind'), { timeout: 3_000 }).toBe(true);
    const ask = async <T,>(name: CommandName, input: unknown): Promise<T> => {
      const answer = await wired.host.dispatch('engine-host', name, input as never);
      if (!answer.ok) throw new Error(answer.error.message);
      return answer.value as T;
    };
    const followed = async () => (await ask<{ followed: { appSessionId: string }[] }>('fs.state', undefined)).followed.filter((f) => f.appSessionId === app);
    const saidOnDisk = () => batches.filter((b) => b.appSessionId === app).flatMap((b) => b.events).filter((e) => e.kind === 'user.message').map((e) => (e as { content: unknown }).content);

    // The read: nothing runs the session, so session.events follows its transcript, and an appended line arrives.
    await ask('session.events', { appSessionId: app, afterSeq: null, limit: 1000 });
    await expect.poll(followed, { timeout: 3_000 }).toEqual([{ appSessionId: app, agentId: null }]);
    await fixture.appendLines(fixture.transcriptPath(S[0]), [line('r2', 'r1', 'still on disk')]);
    await expect.poll(saidOnDisk, { timeout: 3_000 }).toContain('still on disk');

    // The resume: C3 reports the same app id live; the follow stops, and what the process writes comes live only.
    wired.fire('session.status', { appSessionId: app, status: status(app, { engineSessionId: S[0], process: 'starting' }) });
    await expect.poll(followed, { timeout: 3_000 }).toEqual([]);
    await fixture.appendLines(fixture.transcriptPath(S[0]), [line('r3', 'r2', 'written by the live process')]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(saidOnDisk()).not.toContain('written by the live process');

    // Once per run: later statuses of the same process send nothing; an exit and a relaunch stop a follow again.
    const unfollows = () => wired.calls.filter((c) => c.name === 'fs.unfollow').length;
    wired.fire('session.status', { appSessionId: app, status: status(app, { engineSessionId: S[0], process: 'ready' }) });
    wired.fire('session.status', { appSessionId: app, status: status(app, { engineSessionId: S[0], process: 'exited' }) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(unfollows()).toBe(1);
    wired.fire('session.status', { appSessionId: app, status: status(app, { engineSessionId: S[0], process: 'starting' }) });
    await expect.poll(unfollows, { timeout: 3_000 }).toBe(2);
  });

  it('unbindEngineId sends fs.unbind, and a following fs.scan re-attributes that transcript to no app id: the source allocates a fresh record', async () => {
    await fixture.addTranscript('/work/a', S[0], [user('u1', null, '/work/a', 'hello')]);
    wired.start();
    begin();
    await expect.poll(() => index.sessions.getByEngineId(S[0])?.appId ?? null, { timeout: 3_000 }).not.toBeNull();
    const first = index.sessions.getByEngineId(S[0])!;
    index.sessions.setPinned(first.appId, true);
    await expect.poll(() => wired.calls.some((c) => c.name === 'fs.bind'), { timeout: 3_000 }).toBe(true);

    const changed: EventPayload<'fs.sessionChanged'>[] = [];
    wired.listen('fs.sessionChanged', (payload) => changed.push(payload as EventPayload<'fs.sessionChanged'>));
    index.sessions.unbindEngineId(first.appId);
    await expect.poll(() => wired.calls.filter((c) => c.name === 'fs.unbind').map((c) => c.input), { timeout: 3_000 }).toEqual([{ appSessionId: first.appId }]);
    expect(index.sessions.get(first.appId)).toMatchObject({ engineSessionId: null, pinned: true });

    const scan = await wired.host.dispatch('engine-host', 'fs.scan', {});
    expect(scan.ok).toBe(true);
    expect(changed.filter((e) => e.summary.sessionId === S[0]).map((e) => e.appSessionId)).toEqual([null]);
    await new Promise((resolve) => setImmediate(resolve)); // E11: discoveries apply at the end of the burst's turn
    const fresh = index.sessions.getByEngineId(S[0])!;
    expect(fresh.appId).not.toBe(first.appId);
    expect(fresh.pinned).toBe(false);
  });
});
