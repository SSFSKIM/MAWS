import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { HostEmit } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult, EventName, EventPayload, HostState } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { FIXTURE_DIR } from '../../../test/support/fixtures';
import { tempDir } from '../../../test/support/index-fixture';
import { ReplayHost, type ReplayBindings } from '../../engine-host/fs/replay/host';
import { frameUnknownNormalizer, type SourceReader } from '../../engine-host/fs/replay/journal-source';
import { CommandFailure } from '../ipc/router';
import { Index } from './index';
import { ReplayStarter, type ReplayHostPort } from './replay';

// The router module (CommandFailure) imports Electron; nothing here reaches it.
vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, BrowserWindow: { fromWebContents: () => null } }));

type Listener = (payload: unknown) => void;
const REQUEST_TIMEOUT_MS = 10_000; // C1's supervisor deadline (src/main/hosts/supervisor.ts)
const WORKFLOW = join(FIXTURE_DIR, 'pass2/workflow.jsonl');

// The engine host's replay side wired to main in process, with the supervisor's request semantics: every command and
// event is validated, a request unanswered after REQUEST_TIMEOUT_MS resolves `timeout` and its late answer is dropped
// (the host is never told). `seen` is what the renderer would receive.
function bridged(readSource?: SourceReader) {
  const listeners = new Map<string, Set<Listener>>();
  const stateListeners = new Set<(state: HostState) => void>();
  const seen: { name: EventName; payload: unknown }[] = [];
  const calls: { name: CommandName; input: unknown }[] = [];
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
    seen.push({ name, payload: checked.value });
    listeners.get(name)?.forEach((l) => l(checked.value));
    return true;
  };
  const bound = new Map<AppSessionId, SessionId>();
  const bindings: ReplayBindings = {
    bind: async (pairs) => pairs.forEach(({ sessionId, appSessionId }) => bound.set(appSessionId, sessionId)),
    unbind: async (appSessionId) => void bound.delete(appSessionId),
  };
  const replays = new ReplayHost({ emit, bindings, normalizer: frameUnknownNormalizer, readSource });
  const handlers: Partial<Record<CommandName, (input: never) => Promise<unknown>>> = {
    'session.replay.launch': async (input) => replays.launch(input),
    'session.replay.control': async (input) => replays.control(input),
  };
  const host: ReplayHostPort = {
    dispatch: (_owner, name, input) =>
      new Promise<CommandResult<CommandName>>((resolve) => {
        calls.push({ name, input });
        const checked = validateCommandInput(name, input);
        if (!checked.ok) return resolve(checked);
        const timer = setTimeout(() => resolve({ ok: false, error: ipcError('timeout', `engine-host did not answer ${name} within 10 s`) }), REQUEST_TIMEOUT_MS);
        handlers[name]!(checked.value as never).then(
          (value) => {
            clearTimeout(timer);
            resolve(validateCommandOutput(name, value));
          },
          (error: Error) => {
            clearTimeout(timer);
            resolve({ ok: false, error: ipcError('internal', error.message) });
          },
        );
      }),
    onEvent: ((name: string, listener: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }) as ReplayHostPort['onEvent'],
    onState: (_owner, listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };
  return {
    host,
    seen,
    calls,
    bound,
    // An event as if the host had sent it.
    inject: <N extends EventName>(name: N, payload: EventPayload<N>) => emit(name, payload),
    setState: (state: HostState['state']) => stateListeners.forEach((l) => l({ state, pid: null, restarts: 1, revision: 9 })),
    about: (appSessionId: string) => seen.filter((e) => (e.payload as { appSessionId?: string }).appSessionId === appSessionId),
  };
}

describe('session.replay.start in main', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let changes: { appId: string; cause: string }[];
  let starter: ReplayStarter | null;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    changes = [];
    index.sessions.onChange((record, cause) => void changes.push({ appId: record.appId, cause }));
    starter = null;
  });
  afterEach(() => {
    starter?.dispose();
    index.close();
    dir.dispose();
    vi.useRealTimers();
  });

  const failure = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CommandFailure);
    return (error as CommandFailure).error;
  };
  const replayRows = () => index.sessions.list({ includeArchived: true }).filter((record) => record.engineSessionId?.startsWith('rp_'));

  it('creates a kind: replay record the session list shows, and removes it when the run is stopped', async () => {
    const wire = bridged();
    starter = new ReplayStarter(index, wire.host);
    index.fixtures.add({ name: 'workflow', kind: 'journal', path: WORKFLOW, sessionId: null });
    const started = await starter.start({ source: { kind: 'journal', path: WORKFLOW }, speed: 'instant' });
    expect(started.sessionId).toMatch(/^rp_[0-9a-f-]{36}$/);
    expect(started.totalRows).toBeGreaterThan(0);
    const record = index.sessions.get(started.appSessionId as AppSessionId);
    expect(record).toMatchObject({ engineSessionId: started.sessionId, title: { text: 'replay · workflow', source: 'tool' }, holder: { kind: 'none' } });
    expect(index.sessions.list().map((r) => r.appId)).toContain(started.appSessionId);
    expect(index.sessions.bindings().map((b) => b.appSessionId)).not.toContain(started.appSessionId); // a replay is not an engine session
    expect(changes).toContainEqual({ appId: started.appSessionId, cause: 'replay' });
    expect(index.fixtures.list()[0].lastPlayedAt).not.toBeNull();
    await vi.waitFor(() => expect(wire.about(started.appSessionId).some((e) => e.name === 'session.replay.progress' && (e.payload as { state: string }).state === 'done')).toBe(true));
    expect(index.sessions.get(started.appSessionId as AppSessionId)).not.toBeNull(); // done keeps it

    await wire.host.dispatch('engine-host', 'session.replay.control', { appSessionId: started.appSessionId, action: 'stop' });
    expect(index.sessions.get(started.appSessionId as AppSessionId)).toBeNull();
    expect(changes.at(-1)).toEqual({ appId: started.appSessionId, cause: 'removed' });
  });

  it('a source that does not exist fails internal, and leaves no replay row and no progress or batch for its ids', async () => {
    const wire = bridged();
    starter = new ReplayStarter(index, wire.host);
    const missing = join(dir.path, 'missing.jsonl');
    const error = await failure(starter.start({ source: { kind: 'journal', path: missing }, speed: 5 }));
    expect(error).toEqual({ code: 'internal', message: `replay source not found: ${missing}` });
    expect(replayRows()).toEqual([]);
    const [launch] = wire.calls.filter((c) => c.name === 'session.replay.launch') as { input: { appSessionId: string } }[];
    await new Promise((resolve) => setImmediate(resolve));
    expect(wire.about(launch.input.appSessionId)).toEqual([]);
    // What the renderer sees of it is the record appearing and going.
    expect(changes).toEqual([
      { appId: launch.input.appSessionId, cause: 'replay' },
      { appId: launch.input.appSessionId, cause: 'removed' },
    ]);
  });

  it('a journal whose third line is not a journal row fails with its line', async () => {
    const wire = bridged();
    starter = new ReplayStarter(index, wire.host);
    const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
    const path = join(dir.path, 'bad.jsonl');
    writeFileSync(path, [lines[0], lines[1], '{"type":"user"}', lines[3]].join('\n'));
    expect(await failure(starter.start({ source: { kind: 'journal', path }, speed: 1 }))).toEqual({ code: 'internal', message: `replay source is not a journal: ${path}: line 3` });
    expect(replayRows()).toEqual([]);
  });

  it('a launch held past the ten-second deadline fails timeout, is cancelled on the host, and nothing is ever emitted for its id', async () => {
    vi.useFakeTimers();
    const bytes = readFileSync(WORKFLOW);
    const wire = bridged(() => new Promise((resolve) => setTimeout(() => resolve(bytes), 12_000)));
    starter = new ReplayStarter(index, wire.host);
    const started = starter.start({ source: { kind: 'journal', path: WORKFLOW }, speed: 'instant' });
    const outcome = failure(started);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const error = await outcome;
    expect(error.code).toBe('timeout');
    const [launch] = wire.calls.filter((c) => c.name === 'session.replay.launch') as { input: { appSessionId: string } }[];
    const appSessionId = launch.input.appSessionId;
    expect(wire.calls.filter((c) => c.name === 'session.replay.control')).toEqual([{ name: 'session.replay.control', input: { appSessionId, action: 'stop' } }]);
    expect(replayRows()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000); // the load resolves at 12 s
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wire.about(appSessionId).filter((e) => e.name === 'session.eventBatch' || e.name === 'session.replay.progress')).toEqual([]);
    expect(wire.bound.has(appSessionId as AppSessionId)).toBe(false);
    expect(replayRows()).toEqual([]);
  });

  it('a late run for a cancelled id is stopped again and never recreates its row; a host restart forgets the cancels', async () => {
    vi.useFakeTimers();
    const wire = bridged(() => new Promise(() => {})); // a load that never resolves
    starter = new ReplayStarter(index, wire.host);
    const outcome = failure(starter.start({ source: { kind: 'journal', path: WORKFLOW }, speed: 1 }));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect((await outcome).code).toBe('timeout');
    const appSessionId = (wire.calls[0].input as { appSessionId: AppSessionId }).appSessionId;
    const stops = () => wire.calls.filter((c) => c.name === 'session.replay.control').length;
    expect(stops()).toBe(1);
    const running = { appSessionId, state: 'running', index: 0, total: 3, at: null, speed: 1, message: null } as const;
    wire.inject('session.replay.progress', running);
    expect(stops()).toBe(2);
    expect(replayRows()).toEqual([]);
    wire.inject('session.eventBatch', { appSessionId, events: [] });
    expect(stops()).toBe(2); // one resend per cancelled id
    wire.inject('session.replay.progress', { ...running, state: 'stopped' });
    wire.setState('crashed');
    wire.inject('session.replay.progress', running);
    expect(stops()).toBe(2);
    expect(replayRows()).toEqual([]);
  });

  it('a host that is unavailable fails the start with host_unavailable and leaves no row', async () => {
    const wire = bridged();
    starter = new ReplayStarter(index, { ...wire.host, dispatch: async () => ({ ok: false, error: ipcError('host_unavailable', 'engine-host is crashed') }) });
    expect(await failure(starter.start({ source: { kind: 'journal', path: WORKFLOW }, speed: 1 }))).toEqual({ code: 'host_unavailable', message: 'engine-host is crashed' });
    expect(replayRows()).toEqual([]);
  });
});

describe('the replay fixtures the index lists', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  it('answers session.replay.fixtures from the table', () => {
    const starter = new ReplayStarter(index, bridged().host);
    index.fixtures.add({ name: 'workflow', kind: 'journal', path: WORKFLOW, sessionId: null });
    expect(starter.fixtures()).toEqual({ fixtures: index.fixtures.list() });
    starter.dispose();
  });
});
