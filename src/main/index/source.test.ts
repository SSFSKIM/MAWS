import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
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
import type { FsService } from '../../engine-host/fs/service';
import { Index } from './index';
import { IndexSessionSource, type ReadModelWriter, type SourceHost } from './source';

type Listener = (payload: unknown) => void;

const FS_STATE_EMPTY = { configHome: '/cfg', watching: true, projects: 0, sessions: 0, bound: 0, followed: [], holders: [], lastScanAt: null, lastScan: null };
const SCAN_RESULT = { projects: 0, sessions: 0, changed: 0, durationMs: 1 };

// A host the test scripts: commands answer from `answers` (default: ok with undefined) and are recorded; events are
// fired by hand, validated as the supervisor validates host events.
function scriptedHost(state: HostState['state'] = 'ready') {
  const listeners = new Map<string, Set<Listener>>();
  const stateListeners = new Set<(s: HostState) => void>();
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
    subagentModel: null, modelOverrides: {}, engineVersion: '2.1.283', fileCheckpointing: true,
    fastMode: { state: null, disabledReason: null }, plugins: [], pluginErrors: [], pluginWarnings: [],
    backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0, queue: { length: 0, paused: false }, keepAlive: [],
    memory: { rssKiB: null, treeRssKiB: null, sampledAt: null }, journalPath: '/j', hostHooks: [], lastEventSeq: 0, ...over,
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
  const withHolders = (holders: { sessionId: SessionId; holder: Holder }[]) => ({ ...FS_STATE_EMPTY, holders: holders.map((h) => ({ ...h, appSessionId: null })) });

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
      expect(known).toContainEqual({ sessionId: held.sessionId, appSessionId: heldRecord.appId, size: held.size, mtimeMs: held.mtimeMs });
      expect(index.sessions.get(heldRecord.appId)?.holder).toEqual({ kind: 'terminal', pid: 7 });
      expect(index.sessions.get(staleRecord.appId)?.holder).toEqual({ kind: 'none' });
    } finally {
      tree.dispose();
    }
  });

  it('syncs when the engine host becomes ready, and again after it restarts (its bindings died with it)', async () => {
    const fake = scriptedHost('starting');
    begin(fake.host);
    await settle();
    expect(fake.names()).toEqual([]);
    fake.setState('ready');
    await settle();
    expect(fake.names()).toEqual(['fs.scan', 'fs.state']);
    fake.setState('crashed');
    fake.setState('restarting');
    fake.setState('ready');
    await settle();
    expect(fake.names()).toEqual(['fs.scan', 'fs.state', 'fs.scan', 'fs.state']);
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
    expect(fake.names()).toEqual(['fs.bind']);
    expect(fake.calls[0].input).toEqual({ bindings: batch.map((s, i) => ({ sessionId: s.sessionId, appSessionId: records[i].appId })) });
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
    await settle();
    const revisions = events('session.changed').map((c) => c.revision);
    expect(revisions).toHaveLength(4_000);
    for (let i = 1; i < revisions.length; i++) expect(revisions[i]).toBeGreaterThan(revisions[i - 1]);
    expect(revisions.at(-1)).toBe(index.revision);
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

  it('holders: applied to the record, remembered for a record that does not exist yet, and never over a self-held one', async () => {
    const fake = scriptedHost();
    const recorded = recordingWriter();
    begin(fake.host, recorded.writer);
    await settle();

    const later = summary();
    fake.fire('fs.holderChanged', { sessionId: later.sessionId, appSessionId: null, holder: { kind: 'terminal', pid: 99 }, registry: null, job: null });
    fake.fire('fs.sessionChanged', { summary: later, appSessionId: null });
    const record = index.sessions.getByEngineId(later.sessionId)!;
    expect(record.holder).toEqual({ kind: 'terminal', pid: 99 });
    expect(recorded.of('setDigest').filter((d) => d.appSessionId === record.appId).at(-1)).toMatchObject({ phase: 'foreign' });

    fake.fire('fs.holderChanged', { sessionId: later.sessionId, appSessionId: record.appId, holder: { kind: 'none' }, registry: null, job: null });
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'none' });
    expect(recorded.of('setDigest').filter((d) => d.appSessionId === record.appId).at(-1)).toMatchObject({ phase: 'exited' });

    index.sessions.applyEngineStatus(record.appId, { holder: { kind: 'self' } });
    fake.fire('fs.holderChanged', { sessionId: later.sessionId, appSessionId: record.appId, holder: { kind: 'terminal', pid: 5 }, registry: null, job: null });
    expect(index.sessions.get(record.appId)?.holder).toEqual({ kind: 'self' });
  });

  it('a transcript removed from disk archives its record and keeps it', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    const s = summary();
    fake.fire('fs.sessionChanged', { summary: s, appSessionId: null });
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

  describe('the unread rule', () => {
    const advance = (s: TranscriptSummary, at: string, leaf: string) => ({ ...s, lastRecordAt: at, leafUuid: leaf as MessageUuid, size: s.size + 1 });

    it('a visible session whose lastRecordAt advances stays read and its lastSeen moves; a hidden one turns unread', async () => {
      const fake = scriptedHost();
      begin(fake.host);
      const shown = summary();
      const hidden = summary();
      fake.fire('fs.sessionChanged', { summary: shown, appSessionId: null });
      fake.fire('fs.sessionChanged', { summary: hidden, appSessionId: null });
      const shownId = index.sessions.getByEngineId(shown.sessionId)!.appId;
      const hiddenId = index.sessions.getByEngineId(hidden.sessionId)!.appId;

      source!.onSetVisible(shownId, true);
      expect(index.sessions.get(shownId)?.lastSeen.at).not.toBeNull(); // becoming visible marks it seen at once
      const seenBefore = index.sessions.get(shownId)!.lastSeen;
      await settle();
      emitted.length = 0;

      fake.fire('fs.sessionChanged', { summary: advance(shown, '2026-09-28T11:00:00.000Z', 'leaf-2'), appSessionId: shownId });
      fake.fire('fs.sessionChanged', { summary: advance(hidden, '2026-09-28T11:00:00.000Z', 'leaf-9'), appSessionId: hiddenId });
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
      expect(events('session.projects.changed').at(-1)).toMatchObject({ projects: [] });
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

  it('stop unsubscribes from the host and the index', async () => {
    const fake = scriptedHost();
    begin(fake.host);
    stop!();
    stop = null;
    fake.fire('fs.sessionChanged', { summary: summary(), appSessionId: null });
    expect(index.sessions.list()).toEqual([]);
  });
});

// The real engine-host registration over a StoreFixture, wired in process: commands dispatch to the registered handlers
// with their outputs validated, and events reach the source validated, in the order the host emitted them.
function inProcessHost(configHome: string) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const listeners = new Map<string, Set<Listener>>();
  const calls: { name: CommandName; input: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
    listeners.get(name)?.forEach((l) => l(checked.value));
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
    snapshot: () => ({ state: 'ready', pid: 1, restarts: 0, revision: 1 }),
  };
  return {
    host,
    calls,
    start: () => (service = registerFs(on, emit, { CLAUDE_CONFIG_DIR: configHome })),
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
  const begin = () => {
    const source = new IndexSessionSource(index, wired.host, { emit: () => true, tickMs: 5 });
    stop = source.start(noop);
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
    await expect.poll(() => wired.calls.filter((c) => c.name === 'fs.bind').flatMap((c) => (c.input as { bindings: { appSessionId: string }[] }).bindings.map((b) => b.appSessionId)).sort(), { timeout: 3_000 }).toEqual([...allocated].sort());

    later.length = 0;
    await fixture.appendLines(fixture.transcriptPath(S[1]), [JSON.stringify({ type: 'custom-title', customTitle: 'Named later', sessionId: S[1] })]);
    await expect.poll(() => later.find((e) => e.summary.customTitle === 'Named later')?.appSessionId, { timeout: 3_000 }).toBe(allocated[1]);
    expect(index.sessions.get(allocated[1])?.title).toEqual({ text: 'Named later', source: 'user' });
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
    const fresh = index.sessions.getByEngineId(S[0])!;
    expect(fresh.appId).not.toBe(first.appId);
    expect(fresh.pinned).toBe(false);
  });
});
