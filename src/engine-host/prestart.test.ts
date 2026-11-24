// Ticket 851, M2 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, D1 to D4, R4-1 to R4-9): the engine host's
// prestarts through its handlers, over the scripted engine transport (a direct spawn, or one standing in for a session
// host: `holder`, `promote`). What a hidden row emits, lists and writes; what cancels an admission before it spawns;
// adopt and its refusals; the kill and its files. The session host's own promotion and a successor's reading of a
// promoted launch are holder/prestart-hosted.test.ts's.
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import type { ClientRef, HandlerContext } from '@shared/ipc/client';
import type { CommandInput, CommandName, CommandOutput, EventName } from '@shared/ipc/schema';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import type { BinaryCheck } from './binary-info';
import { autoResponder, scriptedTransport, type Responder, type ScriptedTransport } from './conformance/scripted-transport';
import { handshakeResponder, INIT_RESPONSE } from './conformance/session-harness';
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { registerEngineIpc, type EngineIpcDeps } from './ipc';
import { RELAY_URL } from './launch';
import type { Promotion } from './transport';
import { Normalizer } from './normalizer'; // M2's review, finding 11
import { launchRows } from './holder/restore';
import { prestartIo, Stage, StagedJournal } from './prestart'; // M2's review, finding 4; the panel's scalpel-2#7
import { FileSessionStateStore } from './store/file-session-state-store';
import { MemorySessionStateStore } from './store/memory-session-state-store';
import type { SessionStateStore } from '@shared/engine/session-state-store';
import { parseJournalRow } from '@shared/wire/journal';

const OK_RELAY = { url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: '2026-11-24T10:00:00.000Z', error: null };
const BIN = '/opt/engine/claude';
const OK_BINARY: BinaryCheck = { path: BIN, testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null };
const OWNER = 'spine-root-1';
const MODELS = [{ value: 'sonnet', displayName: 'Sonnet', description: 'invented' }];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let userData: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-prestart-'));
});
afterEach(() => rmSync(userData, { recursive: true, force: true, maxRetries: 10 }));

function spec(appSessionId: string, overrides: Partial<LaunchSpec> = {}): LaunchSpec {
  return LaunchSpecSchema.parse({
    appSessionId, cwd: '/tmp/maws-prestart', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'direct', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null, ...overrides,
  });
}

// A connection's ClientRef the test ends
function client(id = 'conn-1'): ClientRef & { end(): void } {
  const listeners = new Set<() => void>();
  let gone = false;
  return {
    id: id as ClientRef['id'],
    onGone(listener) {
      if (gone) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    end() {
      gone = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

interface HostOpts {
  responder?: Responder;
  hosted?: boolean; // the scripted transport stands in for a session host's (a host map, `promote`)
  promote?: () => Promise<Promotion>;
  binaryProbe?: () => Promise<BinaryCheck>;
  deps?: Partial<EngineIpcDeps>;
}

// The engine host's handlers over the scripted engine; every event validated as the runtime would, every name kept
function engineHost(opts: HostOpts = {}) {
  const handlers = new Map<string, (input: unknown, ctx: HandlerContext) => Promise<unknown>>();
  const emitted: { name: EventName; payload: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown, ctx: HandlerContext) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues).slice(0, 400)}`);
    emitted.push({ name, payload });
    return true;
  };
  const transports: ScriptedTransport[] = [];
  const promotions: number[] = [];
  const exitHeld = new Set<ScriptedTransport>(); // engines whose exit the test holds (`holdExit`)
  const respond = autoResponder(opts.responder ?? handshakeResponder({ initialize: () => ({ response: { ...INIT_RESPONSE, models: MODELS } }) }));
  const spawn = () => {
    const t = scriptedTransport({
      onWrite: (frame, transport) => {
        respond(frame, transport);
        // the engine exits on end_session, as the real one does (pass3/end-session-archive)
        if (frame.type === 'control_request' && frame.request.subtype === 'end_session' && !exitHeld.has(transport)) queueMicrotask(() => transport.exit(0));
      },
      pid: 5000 + transports.length,
      ...(opts.hosted && { holder: { pid: 6000 + transports.length, holderId: `holder-${transports.length}`, fence: 1 } }),
    });
    if (opts.hosted) {
      t.promote = async () => {
        promotions.push(transports.indexOf(t));
        return opts.promote ? opts.promote() : { ok: true };
      };
    }
    // the ladder's signals end the scripted process
    const kill = t.kill.bind(t);
    t.kill = (signal) => {
      kill(signal);
      if (!exitHeld.has(t)) t.exit(null, signal);
    };
    transports.push(t);
    return t;
  };
  // The engine at `index` ignores end_session and the ladder's signals until the release, which exits it
  const holdExit = (index: number): (() => void) => {
    const t = transports[index]!;
    exitHeld.add(t);
    return () => {
      exitHeld.delete(t);
      t.exit(null, 'SIGTERM');
    };
  };
  const ipc = registerEngineIpc(on, emit, {
    userData, replayEnabled: false, log: () => {}, spawn, captureEnv: async () => ({ PATH: '/usr/bin:/bin' }), checkRelay: async () => OK_RELAY,
    binaryProbe: opts.binaryProbe ?? (async () => OK_BINARY), ...opts.deps,
  });
  const conn = client();
  const hiddenReserved: string[] = []; // every row reserved hidden, by id
  ipc.table.onReserved((session) => void (session.prestartHidden && hiddenReserved.push(session.status().appSessionId)));
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>, ctx: HandlerContext = { client: conn }): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input, ctx);
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  const named = (name: EventName) => emitted.filter((e) => e.name === name);
  const of = (id: string) => emitted.filter((e) => (e.payload as { appSessionId?: string } | null)?.appSessionId === id);
  const events = (id: string): SessionEvent[] => of(id).filter((e) => e.name === 'session.eventBatch').flatMap((e) => (e.payload as { events: SessionEvent[] }).events);
  const prestart = (id: string, over: { spec?: Partial<LaunchSpec>; key?: string; owner?: string } = {}, ctx?: HandlerContext) =>
    call('session.prestart', { spec: spec(id, over.spec), key: over.key ?? 'key-1', owner: over.owner ?? OWNER }, ctx);
  return { ipc, call, emitted, named, of, events, transports, promotions, conn, prestart, handlers, hiddenReserved, holdExit };
}

async function until(check: () => boolean, what: string, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

const hiddenReady = (host: ReturnType<typeof engineHost>, id: string) => until(() => host.ipc.table.getAny(id as AppSessionId)?.lifecycle === 'ready', 'the hidden row ready');
const filesOf = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);
const journalFiles = (id: string) => filesOf(join(userData, 'engine-host', 'journal', id));
const stateFiles = () => filesOf(join(userData, 'engine-host', 'state'));

// A probe the test releases: the launch waits in it, before its row
function heldProbe() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  return { probe: async () => (calls++ === 0 ? (await held, OK_BINARY) : OK_BINARY), release };
}

describe('the admission', () => {
  const cancellers: [string, (host: ReturnType<typeof engineHost>, generation: number) => Promise<unknown> | void][] = [
    ['a newer prestart for another id', (host) => host.prestart('app-other')],
    ['a launch of the id', (host) => host.call('session.launch', { spec: spec('app-p') })],
    ['its withdraw', (host, generation) => host.call('session.prestart.withdraw', { appSessionId: 'app-p' as AppSessionId, generation })],
    ['a forget of the id', (host) => host.call('session.forget', { appSessionId: 'app-p' as AppSessionId })],
    ['a stop of the id', (host) => host.call('session.stop', { appSessionId: 'app-p' as AppSessionId, reason: 'stop' }).catch(() => null)],
    ['the end of its connection', (host) => host.conn.end()],
    ['its owner’s release', (host) => host.call('session.prestart.release', { owner: OWNER })],
  ];
  for (const [what, cancel] of cancellers) {
    it(`is cancelled before it spawns by ${what}`, async () => {
      const held = heldProbe();
      const host = engineHost({ binaryProbe: held.probe });
      const answer = await host.prestart('app-p');
      expect(answer).toEqual({ status: 'started', generation: 1 });
      const cancelling = cancel(host, answer.generation); // registered while the launch waits in its probes
      held.release();
      await cancelling;
      await sleep(30);
      expect(host.hiddenReserved.filter((id) => id === 'app-p')).toEqual([]);
      expect(host.ipc.table.isHidden('app-p' as AppSessionId)).toBe(false);
      expect(host.named('engine.prestart').filter((e) => (e.payload as { appSessionId: string }).appSessionId === 'app-p')).toEqual([]);
    });
  }

  it('ends with its connection while the launch is held before its row: the session host started for it is abandoned, nothing spawns', async () => {
    let releaseStart!: () => void;
    const started = new Promise<void>((resolve) => (releaseStart = resolve));
    const abandoned: string[] = [];
    const host = engineHost({
      deps: {
        holder: {
          gateSocket: join(userData, 'gate.sock'),
          start: async (launchId) => {
            await started;
            return { pid: 7777, holderId: launchId, binary: '/bin/host', paths: { roster: '', token: '', socket: '', log: '' }, hello: {} as never, transport: () => { throw new Error('never spawned'); }, abandon: () => void abandoned.push(launchId) };
          },
        },
      },
    });
    await host.prestart('app-p');
    await sleep(10); // past the probes, in the session host's start
    host.conn.end();
    releaseStart();
    await sleep(30);
    expect(abandoned).toHaveLength(1);
    expect(host.ipc.table.getAny('app-p' as AppSessionId)).toBeUndefined();
  });

  it('answers running for the same spec and key of the same id, and replaces one whose spec differs', async () => {
    const host = engineHost();
    expect(await host.prestart('app-p')).toEqual({ status: 'started', generation: 1 });
    await hiddenReady(host, 'app-p');
    expect(await host.prestart('app-p', { spec: { sessionId: 'pin-2' as never } })).toEqual({ status: 'running', generation: 1 });
    expect(await host.prestart('app-p', { spec: { model: 'opus' } })).toEqual({ status: 'started', generation: 2 });
    await until(() => host.transports[0]!.calls.includes('kill:SIGTERM') || host.transports[0]!.requestsOf('end_session').length > 0, 'the first engine stopped');
    await hiddenReady(host, 'app-p');
    expect(host.transports).toHaveLength(2);
  });

  it('a prestart for a second id ends the first: one hidden row per host', async () => {
    const host = engineHost();
    await host.prestart('app-a');
    await hiddenReady(host, 'app-a');
    await host.prestart('app-b');
    await hiddenReady(host, 'app-b');
    expect(host.ipc.table.getAny('app-a' as AppSessionId)).toBeUndefined();
    expect(host.named('engine.prestart').map((e) => [(e.payload as { appSessionId: string }).appSessionId, (e.payload as { state: string }).state])).toEqual([['app-a', 'hidden'], ['app-a', 'ended'], ['app-b', 'hidden']]);
  });
});

describe('the hidden row', () => {
  it('emits, lists and counts nothing through a real handshake; at commit each per-row emission goes out exactly once', async () => {
    const host = engineHost({ hosted: true });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const t = host.transports[0]!;
    t.pushStderr('a hook said hello', 1);
    await sleep(30);
    expect(host.of('app-p').map((e) => e.name)).toEqual(['engine.prestart']);
    expect(await host.call('engine.sessions', undefined)).toEqual([]);
    expect(await host.call('engine.pendingItems', undefined)).toEqual({ sessions: [] });
    expect(host.ipc.table.list()).toEqual([]);
    expect((await host.call('engine.budget', undefined)).blocked).toEqual([]);
    expect(host.ipc.table.gateCounts()).toEqual({ armed: 0, observed: 0, unhealthy: 0, absent: 0 });
    await expect(host.call('session.status', { appSessionId: 'app-p' as AppSessionId })).rejects.toThrow(/unknown session/);
    await expect(host.call('session.catalog', { appSessionId: 'app-p' as AppSessionId })).rejects.toThrow(/unknown session/);
    await expect(host.call('session.events', { appSessionId: 'app-p' as AppSessionId, afterSeq: null, limit: null })).rejects.toThrow(/unknown session/);
    expect(existsSync(join(userData, 'engine-host', 'models-cache.json')) || filesOf(join(userData, 'engine-host')).some((name) => name.startsWith('models'))).toBe(false);
    expect(host.ipc.table.all().map((row) => row.status().appSessionId)).toEqual(['app-p']); // the internal view keeps it

    const answer = await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    expect(answer).toMatchObject({ status: 'launching', session: { appSessionId: 'app-p', process: 'ready', engineSessionId: expect.any(String) } });
    const once = host.of('app-p').map((e) => e.name);
    expect(once.filter((name) => name === 'session.status')).toHaveLength(1);
    expect(once.filter((name) => name === 'session.brokerItems')).toHaveLength(1);
    expect(once.filter((name) => name === 'session.queue')).toHaveLength(1);
    expect(once.filter((name) => name === 'engine.prestart')).toHaveLength(2);
    await sleep(40); // the batch's window
    expect(host.of('app-p').filter((e) => e.name === 'session.eventBatch').length).toBe(1);
    expect(host.events('app-p').length).toBeGreaterThan(0); // the kept events, in that one batch
    expect((await host.call('engine.sessions', undefined)).map((s) => s.appSessionId)).toEqual(['app-p']);
    expect(host.transports).toHaveLength(1);
    expect(host.promotions).toEqual([0]);
  });

  it('answers the engine’s surface requests itself and forwards nothing; a toast is dropped', async () => {
    const responder = handshakeResponder({ initialize: () => ({ response: { ...INIT_RESPONSE, capabilities: ['ui_surface_v1'] } }), ui_attach: () => ({ response: {} }), ui_panes: () => ({ response: { panes: [] } }) });
    const host = engineHost({ responder });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const t = host.transports[0]!;
    expect(t.requestsOf('ui_attach')).toEqual([]);
    const asks = [['c1', { subtype: 'ui_copy', text: 'secret', surface: 'desktop', client_id: 'maws-desktop' }], ['r1', { subtype: 'ui_prompt_read', surface: 'desktop', client_id: 'maws-desktop' }], ['f1', { subtype: 'ui_prompt_fill', text: 'x', surface: 'desktop', client_id: 'maws-desktop' }], ['s1', { subtype: 'ui_prompt_suggest', text: 'y', surface: 'desktop', client_id: 'maws-desktop' }]] as const;
    for (const [request_id, request] of asks) t.push({ type: 'control_request', request_id, request });
    t.push({ type: 'system', subtype: 'ui_toast', plugin: 'p', text: 'hi', session_id: 's' });
    await sleep(30);
    const answers = t.writes.filter((w) => w.type === 'control_response').map((w) => (w as { response: { request_id: string; response: unknown } }).response);
    expect(answers).toEqual([
      { subtype: 'success', request_id: 'c1', response: { copied: false } },
      { subtype: 'success', request_id: 'r1', response: { text: '', cursor: 0 } },
      { subtype: 'success', request_id: 'f1', response: { filled: false } },
      { subtype: 'success', request_id: 's1', response: { shown: false } },
    ]);
    await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    await sleep(40);
    expect(host.events('app-p').filter((e) => e.kind === 'plugin.ask' || e.kind === 'plugin.toast')).toEqual([]);
    await until(() => t.requestsOf('ui_attach').length === 1, 'the surface attached at the reveal');
  });

  it('writes no journal, map or state file while hidden, and leaves none after a kill', async () => {
    const host = engineHost({ hosted: true });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    host.transports[0]!.pushStderr('line', 1);
    await sleep(30);
    expect(journalFiles('app-p')).toEqual([]);
    expect(stateFiles()).toEqual([]);
    await host.call('session.forget', { appSessionId: 'app-p' as AppSessionId });
    await until(() => host.ipc.table.all().length === 0, 'the killed row gone');
    await sleep(30);
    expect(journalFiles('app-p')).toEqual([]);
    expect(stateFiles()).toEqual([]);
    expect(host.ipc.table.takeReleased('app-p' as AppSessionId)).toBe(false);
    expect(host.named('engine.prestart').map((e) => (e.payload as { state: string }).state)).toEqual(['hidden', 'ended']);
  });

  it('ends when its stage passes the ceiling; the next launch is fresh', async () => {
    const host = engineHost({ hosted: true });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const line = 'x'.repeat(4_000);
    for (let i = 0; i < 300; i += 1) host.transports[0]!.pushStderr(line, i + 1);
    await until(() => host.ipc.table.getAny('app-p' as AppSessionId) === undefined, 'the prestart ended');
    expect(await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } })).toMatchObject({ status: 'launching' });
    await until(() => host.transports.length === 2, 'a fresh engine');
    expect(host.promotions).toEqual([]);
  });

  it('the memory budget ends a hidden row before any other and keeps it out of its lists', async () => {
    const host = engineHost({ deps: { table: undefined } });
    await host.call('session.launch', { spec: spec('app-live') });
    await until(() => host.ipc.table.get('app-live' as AppSessionId)?.lifecycle === 'ready', 'the live row ready');
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    for (const row of host.ipc.table.all()) row.recordMemory({ rssKiB: 900_000, treeRssKiB: 900_000, sampledAt: new Date().toISOString() });
    host.ipc.table.configure({ enabled: true, limitKiB: 1_000, statefulMcpServers: [] });
    await until(() => host.ipc.table.getAny('app-p' as AppSessionId) === undefined, 'the hidden row ended');
    expect(host.ipc.table.get('app-live' as AppSessionId)?.lifecycle).toBe('ready');
    expect(host.ipc.table.budgetState().releasing).toBeNull();
  });
});

describe('the internal readers', () => {
  it('the idle release ends a hidden row nobody holds interest in: no released id, nothing kept', async () => {
    const host = engineHost();
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    host.ipc.table.setIdleRelease({ idleMs: 1, active: true, ignoreInterest: false });
    await until(() => host.ipc.table.getAny('app-p' as AppSessionId) === undefined, 'the idle release ended it');
    expect(host.ipc.table.takeReleased('app-p' as AppSessionId)).toBe(false);
    expect(host.named('engine.prestart').map((e) => (e.payload as { state: string }).state)).toEqual(['hidden', 'ended']);
  });

  it('a handover ends a hidden row, never freezes it for a successor', async () => {
    const host = engineHost({ hosted: true });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    expect(host.ipc.table.freezeForHandover()).toEqual([]);
    await until(() => host.ipc.table.all().length === 0, 'the hidden row ended');
    expect(host.transports[0]!.calls.some((call) => call.startsWith('kill') || call === 'endInput') || host.transports[0]!.requestsOf('end_session').length > 0).toBe(true);
  });

  it('the orphan ledger and the own-pid set keep a hidden row and one ending', async () => {
    const written: { appSessionId: string }[][] = [];
    const host = engineHost();
    host.ipc.table.recordLive((rows) => void written.push(rows));
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    expect(written.at(-1)!.map((row) => row.appSessionId)).toEqual(['app-p']);
    expect(host.ipc.table.all().map((row) => row.pid)).toEqual([5000]);
  });
});

describe('adopt', () => {
  it('takes the hidden row while its handshake still runs; the answer does not wait for the surface, and ready is published once', async () => {
    let answerInit!: () => void;
    const initialized = new Promise<void>((resolve) => (answerInit = resolve));
    const responder = handshakeResponder({
      initialize: () => null, // answered by the test
      ui_attach: () => null, // held: never answered here (more than the 7 s a slow attach takes)
      ui_panes: () => null,
    });
    const host = engineHost({ responder });
    await host.prestart('app-p');
    await until(() => host.transports[0]?.requestsOf('initialize').length === 1, 'initialize written');
    const started = Date.now();
    const answer = await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(answer).toMatchObject({ status: 'launching', session: { process: 'initializing' } });
    void initialized.then(() => host.transports[0]!.answer('initialize', { ...INIT_RESPONSE, capabilities: ['ui_surface_v1'] }));
    answerInit();
    await until(() => host.transports[0]!.requestsOf('ui_attach').length === 1, 'the attach asked');
    // the handshake attaches the surface as any launch's (now revealed); held, it holds the handshake, not the answer
    const ready = () => host.of('app-p').filter((e) => e.name === 'session.status' && (e.payload as { status: { process: string } }).status.process === 'ready');
    expect(ready()).toEqual([]);
    host.transports[0]!.answer('ui_attach', {});
    await until(() => host.transports[0]!.requestsOf('ui_panes').length === 1, 'the panes asked');
    host.transports[0]!.answer('ui_panes', { panes: [] });
    await until(() => ready().length > 0, 'ready');
    await sleep(30);
    // one move to ready (the statuses after it are the same ready, with the session's reads in flight)
    const processes = host.of('app-p').filter((e) => e.name === 'session.status').map((e) => (e.payload as { status: { process: string } }).status.process);
    expect(processes.filter((process, i) => process === 'ready' && processes[i - 1] !== 'ready')).toHaveLength(1);
    expect(processes.slice(processes.indexOf('ready'))).not.toContain('initializing');
  });

  it('answers at once with the surface attach held once the handshake is done, and publishes one ready status', async () => {
    const responder = handshakeResponder({ initialize: () => ({ response: { ...INIT_RESPONSE, capabilities: ['ui_surface_v1'] } }), ui_attach: () => null, ui_panes: () => null });
    const host = engineHost({ responder });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const started = Date.now();
    const answer = await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(answer).toMatchObject({ status: 'launching', session: { process: 'ready' } });
    await until(() => host.transports[0]!.requestsOf('ui_attach').length === 1, 'the attach asked behind the answer');
    await sleep(30);
    // the snapshot's status is ready, and nothing after it moves the process (later statuses are the attach in flight)
    const statuses = host.of('app-p').filter((e) => e.name === 'session.status').map((e) => (e.payload as { status: { process: string } }).status.process);
    expect(statuses[0]).toBe('ready');
    expect(statuses.filter((process, i) => process === 'ready' && statuses[i - 1] !== 'ready')).toHaveLength(1);
    expect(new Set(statuses)).toEqual(new Set(['ready']));
  });

  const misses: [string, (host: ReturnType<typeof engineHost>) => Promise<CommandOutput<'session.launch'>>, HostOpts?][] = [
    ['a different spec', (host) => host.call('session.launch', { spec: spec('app-p', { model: 'opus' }), adopt: { key: 'key-1' } })],
    ['a different key', (host) => host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-2' } })],
    ['a plain launch', (host) => host.call('session.launch', { spec: spec('app-p') })],
  ];
  for (const [what, launch] of misses) {
    it(`launches fresh for ${what}, ending the hidden row`, async () => {
      const host = engineHost();
      await host.prestart('app-p');
      await hiddenReady(host, 'app-p');
      const first = host.ipc.table.getAny('app-p' as AppSessionId)!.status().launchId;
      const answer = await launch(host);
      expect(answer).toMatchObject({ status: 'launching' });
      expect(answer.status === 'launching' && answer.session.launchId).not.toBe(first);
      await until(() => host.transports.length === 2, 'a fresh engine');
      await until(() => host.transports[0]!.calls.some((c) => c.startsWith('kill')) || host.transports[0]!.requestsOf('end_session').length > 0, 'the hidden engine stopped');
      expect(host.named('engine.prestart').map((e) => (e.payload as { state: string }).state)).toEqual(['hidden', 'ended']);
    });
  }

  it('launches fresh when the configured engine binary is another than the one the row was spawned with', async () => {
    let binary = OK_BINARY;
    const host = engineHost({ binaryProbe: async () => binary });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    binary = { ...OK_BINARY, path: '/opt/engine-2/claude' };
    expect(await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } })).toMatchObject({ status: 'launching', session: { bin: '/opt/engine-2/claude' } });
    await until(() => host.transports.length === 2, 'a fresh engine');
  });

  it('launches fresh for a row whose engine exited', async () => {
    const host = engineHost();
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    host.transports[0]!.exit(1);
    await until(() => host.ipc.table.getAny('app-p' as AppSessionId) === undefined, 'the exited prestart dropped');
    expect(await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } })).toMatchObject({ status: 'launching' });
    await until(() => host.transports.length === 2, 'a fresh engine');
    expect(host.named('engine.prestart').map((e) => (e.payload as { state: string }).state)).toEqual(['hidden', 'ended']);
  });

  it('launches fresh for a row held in its exit ladder', async () => {
    const host = engineHost();
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const row = host.ipc.table.getAny('app-p' as AppSessionId)!;
    const release = host.holdExit(0); // the ladder waits: no exit comes
    void row.stop('stop', { graceMs: 2_000 });
    await until(() => row.lifecycle === 'exiting', 'in its ladder');
    expect(await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } })).toMatchObject({ status: 'launching' });
    await until(() => host.transports.length === 2, 'a fresh engine');
    release();
  });

  it('a refused promotion ends the prestart, removes the files it wrote and launches fresh', async () => {
    const host = engineHost({ hosted: true, promote: async () => ({ ok: false, message: 'the roster write failed' }) });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const first = host.ipc.table.getAny('app-p' as AppSessionId)!.status().launchId;
    const answer = await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    expect(answer.status === 'launching' && answer.session.launchId).not.toBe(first);
    await until(() => !journalFiles('app-p').some((name) => name.startsWith(first)), 'the staged files removed');
    expect(journalFiles('app-p').some((name) => name.startsWith(answer.status === 'launching' ? answer.session.launchId : '?'))).toBe(true);
  });

  it('a withdraw of a committed generation, or of one a newer generation replaced, does nothing', async () => {
    const host = engineHost();
    const first = await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const second = await host.prestart('app-p', { spec: { model: 'opus' } });
    await hiddenReady(host, 'app-p');
    await host.call('session.prestart.withdraw', { appSessionId: 'app-p' as AppSessionId, generation: first.generation });
    expect(host.ipc.table.isHidden('app-p' as AppSessionId)).toBe(true);
    await host.call('session.launch', { spec: spec('app-p', { model: 'opus' }), adopt: { key: 'key-1' } });
    await host.call('session.prestart.withdraw', { appSessionId: 'app-p' as AppSessionId, generation: second.generation });
    expect(host.ipc.table.get('app-p' as AppSessionId)?.lifecycle).toBe('ready');
    expect(host.transports).toHaveLength(2); // the two prestarts; the commit spawned none
  });

  it('the welcome restates the hidden set, as the internal query does', async () => {
    const host = engineHost();
    let burst: (() => void) | null = null;
    const withBurst = engineHost({ deps: { onConnect: (hook) => void (burst = hook) } });
    await withBurst.prestart('app-p');
    await hiddenReady(withBurst, 'app-p');
    const before = withBurst.named('engine.prestart').length;
    burst!();
    expect(withBurst.named('engine.prestart').slice(before).map((e) => e.payload)).toEqual([{ appSessionId: 'app-p', engineSessionId: expect.any(String), state: 'hidden' }]);
    expect(await withBurst.call('engine.prestarts', undefined)).toEqual({ hidden: [{ appSessionId: 'app-p', engineSessionId: expect.any(String) }] });
    expect(await host.call('engine.prestarts', undefined)).toEqual({ hidden: [] });
  });
});

// M2's medium review (range ef3d845b7..d2ada3e07): one test per finding, each written before its fix
// A promotion the test answers
function heldPromotion() {
  let answer!: (promotion: Promotion) => void;
  const promotion = new Promise<Promotion>((resolve) => (answer = resolve));
  return { promote: () => promotion, answer };
}

describe('the review’s findings', () => {
  const assistant = (i: number, text: string) => ({ type: 'assistant', message: { id: `msg_${i}`, role: 'assistant', model: 'm', content: [{ type: 'text', text }] }, session_id: 's', parent_tool_use_id: null, uuid: `a-${i}` });

  it('1: the state file is on disk before the promotion, also when adopt takes a starting row', async () => {
    let releaseKeep!: () => void;
    const keepHeld = new Promise<void>((resolve) => (releaseKeep = resolve));
    const memory = new MemorySessionStateStore();
    const store: SessionStateStore = Object.assign(Object.create(memory) as SessionStateStore, {
      loadKeep: async (id: AppSessionId) => (await keepHeld, memory.loadKeep(id)),
      saveLaunchSpec: async (id: AppSessionId, saved: LaunchSpec) => (await sleep(80), memory.saveLaunchSpec(id, saved)),
    });
    let specAtPromotion: LaunchSpec | null | undefined;
    const host = engineHost({ hosted: true, promote: async () => ((specAtPromotion = await memory.loadLaunchSpec('app-p' as AppSessionId)), { ok: true }), deps: { store } });
    await host.prestart('app-p');
    await until(() => host.ipc.table.getAny('app-p' as AppSessionId)?.lifecycle === 'starting', 'the hidden row starting');
    const adopting = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    await sleep(20);
    releaseKeep();
    expect(await adopting).toMatchObject({ status: 'launching' });
    expect(specAtPromotion).toMatchObject({ appSessionId: 'app-p' });
  });

  it('2: a refused promotion leaves no state behind: the earlier state file restored, and the fallback reads no discarded lineage', async () => {
    const store = new FileSessionStateStore(userData);
    await store.saveEngineSessionIds('app-p' as AppSessionId, ['engine-before']);
    const host = engineHost({ hosted: true, promote: async () => ({ ok: false, message: 'refused' }), deps: { store } });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const hidden = host.ipc.table.getAny('app-p' as AppSessionId)!.status().engineSessionId!;
    const answer = await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    expect(answer).toMatchObject({ status: 'launching' });
    await until(() => host.ipc.table.get('app-p' as AppSessionId)?.lifecycle === 'ready', 'the fallback ready');
    await sleep(50);
    const lineage = await store.loadEngineSessionIds('app-p' as AppSessionId);
    expect(lineage).toContain('engine-before');
    expect(lineage).not.toContain(hidden);
    expect(stateFiles().filter((name) => name.includes('.prestart-'))).toEqual([]); // no backup left
  });

  it('2: a refused promotion of an id with no earlier state removes the state file it wrote, before the fallback starts', async () => {
    let releaseFallback!: () => void;
    const fallbackHeld = new Promise<void>((resolve) => (releaseFallback = resolve));
    let probes = 0;
    // the probes: the prestart's, the adopt's binary check, then the fallback's, held
    const host = engineHost({ hosted: true, promote: async () => ({ ok: false, message: 'refused' }), binaryProbe: async () => (++probes === 3 ? (await fallbackHeld, OK_BINARY) : OK_BINARY) });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const answer = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    await until(() => probes === 3, 'the fallback in its probes');
    await sleep(30);
    expect(stateFiles()).toEqual([]);
    releaseFallback();
    expect(await answer).toMatchObject({ status: 'launching' });
  });

  it('3: while an id is hidden or committing, no disk fallback answers or writes for it', async () => {
    const promotion = heldPromotion();
    let diskReads = 0;
    const host = engineHost({ hosted: true, promote: promotion.promote, deps: { diskEvents: async () => ((diskReads += 1), { events: [], complete: true, lastSeq: 0 } as never) } });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const id = 'app-p' as AppSessionId;
    await expect(host.call('session.events', { appSessionId: id, afterSeq: null, limit: null })).rejects.toThrow(/unknown session/);
    expect(diskReads).toBe(0);
    const adopting = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    await until(() => journalFiles('app-p').length > 0, 'the stage written');
    await expect(host.call('session.queue.list', { appSessionId: id })).rejects.toThrow(/unknown session/);
    await expect(host.call('session.setKeep', { appSessionId: id, keep: true })).rejects.toThrow(/unknown session/);
    await expect(host.call('session.promptHistory', { appSessionId: id, since: null } as never)).rejects.toThrow(/unknown session/);
    expect(await host.call('engine.observedFacts', { appSessionId: id })).toBeNull();
    expect(existsSync(join(userData, 'engine-host', 'state', 'app-p.facts.json')) || stateFiles().some((name) => name.includes('fact'))).toBe(false);
    expect(diskReads).toBe(0);
    promotion.answer({ ok: true });
    await adopting;
  });

  it('4: a short write of the stage fails the adopt: the prestart ends, its files go, and the launch is fresh', async () => {
    const host = engineHost({ hosted: true });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const launchId = host.ipc.table.getAny('app-p' as AppSessionId)!.status().launchId;
    const write = prestartIo.writeSync;
    let first = true; // half of the first write lands, then nothing more does
    prestartIo.writeSync = ((fd: number, buffer: Buffer, offset: number, length: number) => (first ? ((first = false), write(fd, buffer, offset, Math.max(1, Math.floor(length / 2)))) : 0)) as typeof prestartIo.writeSync;
    try {
      const answer = await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
      expect(answer.status === 'launching' && answer.session.launchId).not.toBe(launchId);
    } finally {
      prestartIo.writeSync = write;
    }
    expect(host.promotions).toEqual([]);
    await until(() => !journalFiles('app-p').some((name) => name.startsWith(launchId)), 'the staged files removed');
  });

  it('5: an adopt cancels an admission still in its probes and launches fresh at once', async () => {
    const held = heldProbe();
    const host = engineHost({ binaryProbe: held.probe });
    await host.prestart('app-p');
    const answer = await Promise.race([host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } }), sleep(2_000).then(() => 'waited' as const)]);
    expect(answer).toMatchObject({ status: 'launching' });
    held.release();
    await sleep(30);
    expect(host.hiddenReserved).toEqual([]);
  });

  it('6: a launch fences the id’s prestarts from the start of its preparation', async () => {
    const held = heldProbe();
    const host = engineHost({ binaryProbe: held.probe });
    const launching = host.call('session.launch', { spec: spec('app-p') });
    await sleep(10);
    expect(await host.prestart('app-p')).toMatchObject({ status: 'refused' });
    held.release();
    expect(await launching).toMatchObject({ status: 'launching' });
    expect(host.hiddenReserved).toEqual([]);
    expect(await host.prestart('app-q')).toMatchObject({ status: 'started' }); // another id is not fenced
  });

  it('7: a committing row keeps the hidden slot and stays in engine.prestarts until its committed event', async () => {
    const promotion = heldPromotion();
    const host = engineHost({ hosted: true, promote: promotion.promote });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const adopting = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    await until(() => host.promotions.length === 1, 'the promotion asked');
    expect((await host.call('engine.prestarts', undefined)).hidden.map((h) => h.appSessionId)).toEqual(['app-p']);
    expect(await host.prestart('app-q')).toMatchObject({ status: 'refused' });
    promotion.answer({ ok: true });
    await adopting;
    expect(await host.call('engine.prestarts', undefined)).toEqual({ hidden: [] });
    expect(await host.prestart('app-q')).toMatchObject({ status: 'started' });
  });

  it('8: a handover while a promotion is out never reveals the row after the freeze; it ends once the answer comes', async () => {
    const promotion = heldPromotion();
    const host = engineHost({ hosted: true, promote: promotion.promote });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const adopting = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } }).catch((error: unknown) => error);
    await until(() => host.promotions.length === 1, 'the promotion asked');
    const row = host.ipc.table.getAny('app-p' as AppSessionId)!;
    host.ipc.table.freezeForHandover();
    await sleep(20);
    expect(row.lifecycle).not.toBe('exited'); // not stopped as hidden while the promotion is out
    promotion.answer({ ok: true });
    await adopting;
    expect(host.ipc.table.get('app-p' as AppSessionId)).toBeUndefined();
    await until(() => row.lifecycle === 'exited', 'the row ended');
    expect(host.named('engine.prestart').map((e) => (e.payload as { state: string }).state)).toEqual(['hidden', 'ended']);
  });

  it('9: the stage’s ceiling holds while the promotion is out; reaching it fails the adopt', async () => {
    const promotion = heldPromotion();
    const host = engineHost({ hosted: true, promote: promotion.promote });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const launchId = host.ipc.table.getAny('app-p' as AppSessionId)!.status().launchId;
    const adopting = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    await until(() => host.promotions.length === 1, 'the promotion asked');
    for (let i = 0; i < 300; i += 1) host.transports[0]!.push(assistant(i, 'y'.repeat(4_000)), 100 + i);
    await sleep(100);
    promotion.answer({ ok: true });
    const answer = await adopting;
    expect(answer.status === 'launching' && answer.session.launchId).not.toBe(launchId);
  });

  it('10: a hidden row is told to browser work only at its reveal', async () => {
    const host = engineHost({ hosted: true });
    const told: { id: string; hidden: boolean }[] = [];
    host.ipc.table.onReserved((session) => void told.push({ id: session.status().appSessionId, hidden: host.ipc.table.isHidden(session.status().appSessionId) }));
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    expect(told).toEqual([]);
    await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    expect(told).toEqual([{ id: 'app-p', hidden: false }]);
  });

  it('11: a toast and a surface ask of the hidden period stay out of a rebuild from the journal; one after the reveal is kept', async () => {
    const host = engineHost({ hosted: true });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const t = host.transports[0]!;
    t.push({ type: 'system', subtype: 'ui_toast', plugin: 'p', text: 'hidden toast', session_id: 's' }, 50);
    t.push({ type: 'control_request', request_id: 'c1', request: { subtype: 'ui_copy', text: 'x', surface: 'desktop', client_id: 'maws-desktop' } }, 51);
    await sleep(30);
    const answer = await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    t.push({ type: 'system', subtype: 'ui_toast', plugin: 'p', text: 'shown toast', session_id: 's' }, 52);
    await sleep(30);
    const launchId = answer.status === 'launching' ? answer.session.launchId : '';
    const normalizer = new Normalizer({ appSessionId: 'app-p' as AppSessionId, launchId, sessionId: null });
    const rebuilt = [...launchRows(join(userData, 'engine-host', 'journal', 'app-p'), launchId)].flatMap((row) => normalizer.push(parseJournalRow(JSON.parse(JSON.stringify(row)))));
    const kinds = rebuilt.filter((e) => e.kind === 'plugin.toast' || e.kind === 'plugin.ask').map((e) => (e.kind === 'plugin.toast' ? e.text : e.kind));
    expect(kinds).toEqual(['shown toast']);
    expect(readFileSync(join(userData, 'engine-host', 'journal', 'app-p', `${launchId}.jsonl`), 'utf8')).toContain('hidden toast'); // the rows themselves stay
  });

  it('12: a stop-all stops a hidden row and counts it in neither total', async () => {
    const host = engineHost();
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const row = host.ipc.table.getAny('app-p' as AppSessionId)!;
    expect(await host.ipc.shutdown(500)).toEqual({ stopped: 0, forced: 0 });
    expect(row.lifecycle).toBe('exited');
  });
});

// Ticket 851's xhigh panel, group A (promotion and rollback). The rule its four P1s share: a launch whose outcome is
// unknown stays recoverable by its successor, so nothing of a commit that is not revealed (its stored spec, journal,
// state backup or roster entry) is restored or deleted until its holder is confirmed gone.
describe('the panel’s findings: promotion and rollback', () => {
  const id = 'app-p' as AppSessionId;
  const stored = () => existsSync(join(userData, 'engine-host', 'state', 'app-p.json'));
  const staged = (launchId: string) => journalFiles('app-p').filter((name) => name.startsWith(launchId));
  const backups = () => stateFiles().filter((name) => name.includes('.prestart-'));
  const stopAsked = (host: ReturnType<typeof engineHost>) => until(() => host.transports[0]!.requestsOf('end_session').length > 0, 'the engine asked to stop');

  it('scalpel-1#1: a promotion whose answer was lost rolls nothing back, and launches nothing beside it, until its engine has exited', async () => {
    const host = engineHost({ hosted: true, promote: async () => ({ ok: false, message: 'the connection to the session host closed before its answer (writer lost)' }) });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const launchId = host.ipc.table.getAny(id)!.status().launchId;
    const release = host.holdExit(0);
    const answer = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    await stopAsked(host);
    await sleep(30);
    // the holder may have been promoted: its stored spec, journal and backup stay for a successor while it runs
    expect({ stored: stored(), staged: staged(launchId).length > 0, backup: backups().length > 0, engines: host.transports.length }).toEqual({ stored: true, staged: true, backup: true, engines: 1 });
    release();
    const fresh = await answer;
    expect(fresh.status === 'launching' && fresh.session.launchId).not.toBe(launchId);
    expect(staged(launchId)).toEqual([]);
    expect(backups()).toEqual([]);
  });

  it('scalpel-2#1: a promotion acknowledged and then declined (a handover) keeps the promoted state until its engine has exited', async () => {
    const promotion = heldPromotion();
    const host = engineHost({ hosted: true, promote: promotion.promote });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const launchId = host.ipc.table.getAny(id)!.status().launchId;
    const adopting = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } }).catch((error: unknown) => error);
    await until(() => host.promotions.length === 1, 'the promotion asked');
    const release = host.holdExit(0);
    host.ipc.table.freezeForHandover();
    promotion.answer({ ok: true });
    await stopAsked(host);
    await sleep(30);
    expect({ stored: stored(), staged: staged(launchId).length > 0, backup: backups().length > 0 }).toEqual({ stored: true, staged: true, backup: true });
    release();
    await adopting;
    await until(() => staged(launchId).length === 0, 'rolled back once its engine is gone');
    expect(stateFiles()).toEqual([]); // no earlier state: the commit's is removed, and its backup
  });

  it('scalpel-1#3: a forget while the promotion is out waits for its outcome; promoted, the session is live and keeps its files', async () => {
    const promotion = heldPromotion();
    const host = engineHost({ hosted: true, promote: promotion.promote });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const launchId = host.ipc.table.getAny(id)!.status().launchId;
    const adopting = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    await until(() => host.promotions.length === 1, 'the promotion asked');
    let settled = false;
    const forgetting = host.call('session.forget', { appSessionId: id }).then(() => 'forgotten', (error: unknown) => String(error)).finally(() => void (settled = true));
    await sleep(50);
    expect(settled).toBe(false);
    promotion.answer({ ok: true });
    expect(await adopting).toMatchObject({ status: 'launching' });
    expect(await forgetting).toMatch(/already_live/);
    expect({ stored: stored(), staged: staged(launchId).length > 0 }).toEqual({ stored: true, staged: true });
  });

  it('scalpel-1#3: a stop while the promotion is out waits for its outcome, then stops the session it made', async () => {
    const promotion = heldPromotion();
    const host = engineHost({ hosted: true, promote: promotion.promote });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    const adopting = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    await until(() => host.promotions.length === 1, 'the promotion asked');
    let settled = false;
    const stopping = host.call('session.stop', { appSessionId: id, reason: 'stop' }).finally(() => void (settled = true));
    await sleep(50);
    expect(settled).toBe(false);
    promotion.answer({ ok: true });
    expect(await adopting).toMatchObject({ status: 'launching' });
    expect(await stopping).toMatchObject({ exited: true });
    expect(host.ipc.table.get(id)?.lifecycle).toBe('exited');
  });

  it('scalpel-4#3: a failed commit stays hidden until its engine has exited and its journal is gone; the fallback starts only then', async () => {
    let probes = 0;
    let launchId = '';
    let stagedAtFallback: string[] | null = null;
    // the probes: the prestart's, the adopt's binary check, then the fallback's
    const host = engineHost({ hosted: true, promote: async () => ({ ok: false, message: 'refused' }), binaryProbe: async () => ((++probes === 3 && (stagedAtFallback = staged(launchId))), OK_BINARY) });
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    launchId = host.ipc.table.getAny(id)!.status().launchId;
    const release = host.holdExit(0);
    const answer = host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } });
    await stopAsked(host);
    await sleep(30);
    expect({ hidden: host.ipc.table.isHidden(id), facts: await host.call('engine.observedFacts', { appSessionId: id }) }).toEqual({ hidden: true, facts: null });
    release();
    expect(await answer).toMatchObject({ status: 'launching' });
    expect(stagedAtFallback).toEqual([]);
  });

  it('scalpel-1#6: a backup that cannot be removed does not keep a committed launch from its reveal', async () => {
    const stateDir = join(userData, 'engine-host', 'state');
    const host = engineHost({ hosted: true, promote: async () => (chmodSync(stateDir, 0o500), { ok: true }) }); // removals there now fail
    await host.prestart('app-p');
    await hiddenReady(host, 'app-p');
    try {
      expect(await host.call('session.launch', { spec: spec('app-p'), adopt: { key: 'key-1' } })).toMatchObject({ status: 'launching' });
      expect(host.ipc.table.get(id)?.lifecycle).toBe('ready');
      expect(host.ipc.table.isHidden(id)).toBe(false);
    } finally {
      chmodSync(stateDir, 0o700);
    }
  });

  it('scalpel-2#8: a replaced prestart’s engine has exited before the next one spawns', async () => {
    const host = engineHost();
    await host.prestart('app-a');
    await hiddenReady(host, 'app-a');
    const release = host.holdExit(0);
    expect(await host.prestart('app-b')).toMatchObject({ status: 'started' });
    await sleep(50);
    expect(host.transports).toHaveLength(1);
    release();
    await hiddenReady(host, 'app-b');
    expect(host.transports).toHaveLength(2);
  });

  it('scalpel-2#7: the stage keeps nothing more past its ceiling, or once closed; one past its ceiling cannot be committed', () => {
    const dir = join(userData, 'engine-host', 'journal', 'app-s');
    const stage = new Stage({ maxBytes: 2_000, overflow: () => {} });
    const journal = new StagedJournal(dir, 'Lstage01', stage);
    for (let i = 0; i < 200; i += 1) {
      journal.row('in', { type: 'system', subtype: 'status', pad: 'x'.repeat(100) });
      stage.mapLine(`${i + 1} ${i + 1}\n`);
    }
    expect(stage.over).toBe(true);
    expect(journal.lastSeq).toBe(200); // numbered still
    expect(stage.bytes).toBeLessThan(2_000 + 200); // what it retains: the ceiling and the line that crossed it
    expect(stage.mapLines.length).toBeLessThan(40);
    expect(() => journal.commit()).toThrow(/ceiling/);
    expect(filesOf(dir)).toEqual([]);

    const closed = new Stage({ overflow: () => {} });
    const dropped = new StagedJournal(dir, 'Lstage02', closed);
    closed.close();
    for (let i = 0; i < 10; i += 1) {
      dropped.row('in', { type: 'system', subtype: 'status' });
      closed.mapLine(`${i + 1} ${i + 1}\n`);
    }
    expect({ bytes: closed.bytes, mapLines: closed.mapLines.length }).toEqual({ bytes: 0, mapLines: 0 });
  });
});
