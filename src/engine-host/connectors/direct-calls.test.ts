// P3-HD M2: route D's direct operation table over the real artifact store and observation cache, with a scripted
// connection pool standing where MAWS's own MCP connection is (./direct-client.ts has its own tests). The pool's lease
// pauses where the transport's actual stdin write or fetch would be, so the store's revoke, delete and replacing grant,
// a contradicting report, a withdrawn credential and main's going all land between the last await and the write. Every
// assertion that nothing was sent reads the pool's wire log, not an outcome alone.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostCommandError } from '@shared/host/runtime';
import type { DirectOperationOutcome } from '@shared/ipc/schema/connectors';
import type { McpStatusResponse } from '@shared/wire/control';
import { readDataset, setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { AppSessionId } from '@shared/graph/ids';
import { registerDashboards } from '../dashboards';
import { connectorDatasetSink } from './dataset-sink';
import { DatasetRefreshRequests } from './dataset-requests';
import { openDocuments, type Documents } from '../documents';
import { ManualClock, SECRET_SERVER_TEXT, ScriptedPool, deferred, tick } from './direct-pool.fixture';
import { DIRECT_CALL_DEADLINE_MS, DIRECT_RESOLVE_BOUND_MS, DIRECT_RESULT_TTL_MS, DirectCalls, type DirectCallsOptions, type DirectStartInput } from './direct-calls';
import { ConnectorStatusCache, connectorLaunchContext, type ConnectorLaunchContext } from './provenance';

const SECRET_ENV = 'omitted-env-literal-9c1e';
const TOKEN = 'access-token-not-to-leak-77aa';

type Server = { name: string; status: string; scope: string; source: string; config: Record<string, unknown>; tools?: { name: string; annotations?: Record<string, unknown> }[] };
const toy = (args = ['toy-server.mjs']): Server => ({ name: 'usertoy', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'toy', args }, tools: [{ name: 'rows', annotations: { readOnly: true } }, { name: 'send', annotations: {} }] });
const report = (...servers: Server[]): McpStatusResponse => ({ mcpServers: servers });

let dir: string;
let project: string;
let config: string;
let documents: Documents;
let cache: ConnectorStatusCache;
let pool: ScriptedPool;
let completed: string[];
let calls: DirectCalls;
let artifactId: string;
let ids = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

const launch = (appSessionId: string, launchId: string, extra: Record<string, string> = {}): ConnectorLaunchContext =>
  connectorLaunchContext({ appSessionId, launchId, cwd: project, environment: { HOME: join(dir, 'home'), CLAUDE_CONFIG_DIR: config, PATH: join(dir, 'bin'), USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TERM: 'dumb', ...extra }, localKey: { kind: 'directory', key: project } });
const observed = (context: ConnectorLaunchContext, answer: McpStatusResponse) => cache.observe(cache.begin(context), answer);

function build(options: Partial<DirectCallsOptions> = {}): DirectCalls {
  completed = [];
  return new DirectCalls({ cache, pool: pool as never, store: () => documents.store, completed: (id) => void completed.push(id), ...options });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-hd-direct-'));
  project = join(dir, 'project');
  config = join(dir, 'config');
  for (const path of [join(dir, 'home'), config, project, join(dir, 'bin'), join(dir, 'data')]) mkdirSync(path);
  writeFileSync(join(dir, 'bin', 'toy'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'bin', 'toy'), 0o755);
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ mcpServers: { usertoy: { type: 'stdio', command: 'toy', args: ['toy-server.mjs'], env: { TOY_SECRET: SECRET_ENV } } } }));
  documents = openDocuments(join(dir, 'data'), () => {})!;
  cache = new ConnectorStatusCache();
  observed(launch('app-1', 'L1'), report(toy()));
  pool = new ScriptedPool();
  calls = build();
  artifactId = (await documents.store.create({ kind: 'html', title: 'Live page', content: { bytes: new TextEncoder().encode('<p>a</p>') } }, { kind: 'human' })).id;
});
afterEach(() => {
  void calls.close();
  documents.close();
  rmSync(dir, { recursive: true, force: true });
});

// main's resolution, as main would take it
async function resolved(tool = 'rows') {
  const operationId = nextId();
  expect(calls.resolve({ operationId, artifactId, directories: [project], server: 'usertoy', tool })).toEqual({ operationId });
  const outcome = await taken(operationId);
  if (outcome.kind !== 'resolve' || !outcome.answer.ready || !outcome.answer.tool) throw new Error(`unresolved: ${JSON.stringify(outcome)}`);
  return { source: outcome.answer.source, fingerprint: outcome.answer.tool.fingerprint };
}
async function granted(mode: 'read' | 'once' = 'read', tool = 'rows') {
  const { source, fingerprint } = await resolved(tool);
  await documents.store.grantConnectorTool(artifactId, { server: 'usertoy', tool, fingerprint, mode });
  const start = (extra: Partial<DirectStartInput> = {}): DirectStartInput => ({ operationId: nextId(), artifactId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: 'usertoy', tool, arguments: {}, fingerprint, mode, ...extra });
  return { source, fingerprint, start };
}
// the operation's end announced, then its outcome taken once
async function taken(operationId: string): Promise<DirectOperationOutcome> {
  await vi.waitFor(() => expect(completed).toContain(operationId), { interval: 1 });
  const outcome = calls.take(operationId);
  expect(calls.take(operationId)).toBeNull();
  return outcome!;
}
const callOutcome = async (operationId: string) => {
  const outcome = await taken(operationId);
  if (outcome.kind !== 'call') throw new Error(outcome.kind);
  return outcome.outcome;
};
const toolCalls = () => pool.wire.filter((entry) => entry.kind === 'tools/call');
const fences = () => (documents.store as unknown as { fences: Map<string, Set<unknown>> }).fences.size;

describe('DirectCalls: honest acknowledgments and typed outcomes for every operation kind', () => {
  it('resolves through main’s candidates: the first that serves the server, its refusal otherwise, nothing of the entry', async () => {
    const elsewhere = join(dir, 'elsewhere');
    const operationId = nextId();
    expect(calls.resolve({ operationId, artifactId, directories: [elsewhere, project], server: 'usertoy', tool: 'rows' })).toEqual({ operationId });
    expect(completed).toEqual([]); // acknowledged before any lookup could end
    const outcome = await taken(operationId);
    expect(outcome).toMatchObject({ kind: 'resolve', answer: { ready: true, source: { directory: project, server: 'usertoy', scope: 'user', transport: 'stdio', path: join(config, '.claude.json'), entryPath: ['mcpServers', 'usertoy'] }, tool: { readOnly: true } } });
    expect(JSON.stringify(outcome)).not.toContain(SECRET_ENV);
    const source = await taken((calls.resolve({ operationId: nextId(), artifactId, directories: [project], server: 'usertoy' }), `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`));
    expect(source).toMatchObject({ kind: 'resolve', answer: { ready: true } });
    expect('tool' in (source as { answer: object }).answer).toBe(false);
    const missing = nextId();
    calls.resolve({ operationId: missing, artifactId, directories: [elsewhere], server: 'usertoy', tool: 'rows' });
    expect(await taken(missing)).toEqual({ kind: 'resolve', answer: { ready: false, why: 'unobserved' } });
    // a refusal at one candidate does not hide a later one that serves; with none serving, the first refusal answers
    const contested = join(dir, 'contested');
    mkdirSync(contested);
    cache.observe(cache.begin(connectorLaunchContext({ appSessionId: 'app-9', launchId: 'L9', cwd: contested, environment: {} })), report(toy()));
    const both = nextId();
    calls.resolve({ operationId: both, artifactId, directories: [contested, project], server: 'usertoy', tool: 'rows' });
    expect(await taken(both)).toMatchObject({ kind: 'resolve', answer: { ready: true, source: { directory: project } } });
    const none = nextId();
    calls.resolve({ operationId: none, artifactId, directories: [elsewhere, contested], server: 'usertoy', tool: 'rows' });
    expect(await taken(none)).toEqual({ kind: 'resolve', answer: { ready: false, why: 'unidentified' } });
    // a named tool no agreeing report listed is not served there (route E passes a session lacking it); the source alone is
    const unlisted = join(dir, 'unlisted');
    mkdirSync(unlisted);
    cache.observe(cache.begin(connectorLaunchContext({ appSessionId: 'app-8', launchId: 'L8', cwd: unlisted, environment: { CLAUDE_CONFIG_DIR: config, PATH: join(dir, 'bin') } })), report({ ...toy(), tools: [] }));
    const skip = nextId();
    calls.resolve({ operationId: skip, artifactId, directories: [unlisted, project], server: 'usertoy', tool: 'rows' });
    expect(await taken(skip)).toMatchObject({ kind: 'resolve', answer: { ready: true, source: { directory: project }, tool: { readOnly: true } } });
    const only = nextId();
    calls.resolve({ operationId: only, artifactId, directories: [unlisted], server: 'usertoy', tool: 'rows' });
    expect(await taken(only)).toEqual({ kind: 'resolve', answer: { ready: false, why: 'toolMissing' } });
    const bare = nextId();
    calls.resolve({ operationId: bare, artifactId, directories: [unlisted], server: 'usertoy' });
    expect(await taken(bare)).toMatchObject({ kind: 'resolve', answer: { ready: true, source: { directory: unlisted } } });
    expect(pool.acquires).toHaveLength(0); // resolution is metadata only: no connection
  });

  it('bounds a resolution at its 8 s budget even when a lookup never settles', async () => {
    const clock = new ManualClock();
    const stuck = { resolve: () => new Promise(() => {}), resolveSource: () => new Promise(() => {}), readEntryForWrite: () => new Promise(() => {}) };
    calls = build({ cache: stuck as never, clock });
    const operationId = nextId();
    calls.resolve({ operationId, artifactId, directories: [project], server: 'usertoy', tool: 'rows' });
    clock.advance(DIRECT_RESOLVE_BOUND_MS - 1);
    await tick();
    expect(completed).not.toContain(operationId);
    clock.advance(1);
    expect(await taken(operationId)).toEqual({ kind: 'resolve', answer: { ready: false, why: 'unavailable' } });
  });

  it('runs a granted call at once, announcing its id alone, its result taken once; the fence goes with the take', async () => {
    const { start } = await granted();
    const input = start();
    expect(calls.start(input)).toEqual({ operationId: input.operationId });
    expect(completed).not.toContain(input.operationId);
    expect(await callOutcome(input.operationId)).toEqual({ ok: true, result: { content: [{ type: 'text', text: 'rows 107' }] } });
    expect(pool.wire).toEqual([{ kind: 'tools/list' }, { kind: 'tools/call', name: 'rows' }]);
    expect(pool.released).toBe(pool.leases);
    expect(fences()).toBe(0);
    expect(calls.cancel(input.operationId)).toBe(false);
  });

  it('discovers the live tools for the owner with no grant, and never calls one', async () => {
    const { source } = await resolved();
    const operationId = nextId();
    expect(calls.discover({ operationId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: 'usertoy' })).toEqual({ operationId });
    expect(await taken(operationId)).toEqual({ kind: 'discover', answer: { ok: true, tools: [{ name: 'rows', readOnly: true }, { name: 'send', readOnly: false }] } });
    expect(toolCalls()).toEqual([]);
    const stale = nextId();
    calls.discover({ operationId: stale, directory: source.directory, sourceId: '00000000-0000-4000-8000-0000000000aa', generation: source.generation, server: 'usertoy' });
    expect(await taken(stale)).toEqual({ kind: 'discover', answer: { ok: false, failure: 'unavailable', reason: 'source', sourceRefusal: 'changed' } });
  });

  it('a discovery whose source is contradicted or whose credential is withdrawn while it connects answers so, typed', async () => {
    const { source } = await resolved();
    const discover = (extra: object = {}) => {
      const operationId = nextId();
      calls.discover({ operationId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: 'usertoy', ...extra });
      return operationId;
    };
    const connectionId = '00000000-0000-4000-8000-00000000c0de';
    pool.startup = deferred();
    const withdrawn = discover({ credential: { connectionId, credentialEpoch: 1, accessToken: TOKEN } });
    await vi.waitFor(() => expect(pool.acquires).toHaveLength(1), { interval: 1 });
    expect(calls.withdraw(connectionId, 1)).toBe(1);
    pool.startup.resolve();
    await tick();
    expect(calls.take(withdrawn)).toBeNull();
    pool.startup = deferred();
    const contradicted = discover();
    await vi.waitFor(() => expect(pool.acquires).toHaveLength(2), { interval: 1 });
    observed(launch('app-2', 'L2'), report());
    pool.startup.resolve();
    expect(await taken(contradicted)).toEqual({ kind: 'discover', answer: { ok: false, failure: 'unavailable', reason: 'source' } });
    expect(pool.wire).toEqual([]);
  });

  // Review fix: a discovery checks its source again after the entry's read settles and after its connection is acquired.
  it('a discovery whose source is contradicted as its entry’s read settles never acquires a connection', async () => {
    const { source } = await resolved();
    const readEntryForWrite = cache.readEntryForWrite.bind(cache);
    calls = build({
      cache: {
        resolve: cache.resolve.bind(cache),
        resolveSource: cache.resolveSource.bind(cache),
        readEntryForWrite: (verified) => {
          const read = readEntryForWrite(verified);
          void read.then(() => observed(launch('app-2', 'L2'), report())); // ahead of the discovery's continuation
          return read;
        },
      },
    });
    const operationId = nextId();
    calls.discover({ operationId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: 'usertoy' });
    expect(await taken(operationId)).toEqual({ kind: 'discover', answer: { ok: false, failure: 'unavailable', reason: 'source' } });
    expect(pool.acquires).toHaveLength(0);
  });

  it('a discovery whose source is contradicted as its connection is acquired never lists tools', async () => {
    const { source } = await resolved();
    const acquire = pool.acquire.bind(pool);
    pool.acquire = (spec, signal) => {
      const acquired = acquire(spec, signal);
      void acquired.then(() => observed(launch('app-2', 'L2'), report()));
      return acquired;
    };
    const operationId = nextId();
    calls.discover({ operationId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: 'usertoy' });
    expect(await taken(operationId)).toEqual({ kind: 'discover', answer: { ok: false, failure: 'unavailable', reason: 'source' } });
    expect(pool.listAttempts).toBe(0);
    expect(pool.released).toBe(pool.leases);
  });

  it('refuses a start past its bound of held operations as a dispatch error, and a known id', async () => {
    calls = build({ maxOperations: 2 });
    const { start } = await granted();
    pool.startup = deferred();
    const first = start();
    calls.start(first);
    calls.start(start());
    expect(() => calls.start(start())).toThrow(HostCommandError);
    expect(() => calls.start(first)).toThrow(/already known/);
    pool.startup.resolve();
  });
});

describe('DirectCalls: the grant at the actual write', () => {
  const changes: [string, (start: { fingerprint: string }) => Promise<unknown>, object][] = [
    ['a revoke', () => documents.store.revokeConnectorTool(artifactId, { server: 'usertoy', tool: 'rows' }), { failure: 'refused', refusal: 'revoked' }],
    ['the artifact’s deletion', () => documents.store.delete(artifactId), { failure: 'refused', refusal: 'revoked' }],
    ['a grant replacing its mode', ({ fingerprint }) => documents.store.grantConnectorTool(artifactId, { server: 'usertoy', tool: 'rows', fingerprint, mode: 'once' }), { failure: 'refused', refusal: 'revoked' }],
    ['a grant replacing its fingerprint', () => documents.store.grantConnectorTool(artifactId, { server: 'usertoy', tool: 'rows', fingerprint: 'another', mode: 'read' }), { failure: 'refused', refusal: 'revoked' }],
  ];
  for (const [label, change, expected] of changes) {
    it(`${label} while the call waits at its write sends nothing`, async () => {
      const grant = await granted();
      pool.atWrite = deferred();
      const input = grant.start();
      calls.start(input);
      await pool.reachedWrite.promise;
      await change(grant);
      pool.atWrite.resolve();
      expect(await callOutcome(input.operationId)).toMatchObject({ ok: false, ...expected });
      expect(toolCalls()).toEqual([]);
      expect(fences()).toBe(0);
    });

    it(`${label} after the call ended, before main took it, turns the untaken result into the revoke’s refusal`, async () => {
      const grant = await granted();
      const input = grant.start();
      calls.start(input);
      await vi.waitFor(() => expect(completed).toContain(input.operationId));
      await change(grant);
      expect(calls.take(input.operationId)).toEqual({ kind: 'call', outcome: { ok: false, failure: 'refused', refusal: 'revoked', reason: 'grant' } });
      expect(toolCalls()).toHaveLength(1); // written before: not reversible, its result suppressed
    });
  }

  it('a revoke while the connection starts aborts the preparation at once: no tools/list, no call, the revoke’s refusal', async () => {
    const grant = await granted();
    pool.startup = deferred();
    const input = grant.start();
    calls.start(input);
    await vi.waitFor(() => expect(pool.acquires).toHaveLength(1), { interval: 1 });
    await documents.store.revokeConnectorTool(artifactId, { server: 'usertoy', tool: 'rows' });
    pool.startup.resolve();
    expect(await callOutcome(input.operationId)).toEqual({ ok: false, failure: 'refused', refusal: 'revoked', reason: 'grant' });
    expect(pool.wire).toEqual([]);
  });

  it('the store closing while the call waits at its write sends nothing, though no fence broke', async () => {
    const grant = await granted();
    pool.atWrite = deferred();
    const input = grant.start();
    calls.start(input);
    await pool.reachedWrite.promise;
    documents.close(); // the fence reads its grant now: a closed store holds none
    pool.atWrite.resolve();
    expect(await callOutcome(input.operationId)).toEqual({ ok: false, failure: 'refused', refusal: 'revoked', reason: 'grant' });
    expect(toolCalls()).toEqual([]);
  });

  // Review fix: a break that lands after the write's answer settled, before the operation publishes it, is the revoke's
  // refusal too: as the answer arrives (its promise fulfilled, the awaiting continuation not yet run) and while it is
  // held after the write.
  const late: [string, 'read' | 'once', string, () => unknown][] = [
    ['a revoke of a read grant', 'read', 'rows', () => documents.store.revokeConnectorTool(artifactId, { server: 'usertoy', tool: 'rows' })],
    ['the deletion of an artifact whose Allow once was consumed', 'once', 'send', () => documents.store.delete(artifactId)],
  ];
  for (const [label, mode, tool, change] of late) {
    it(`${label} as the written call’s answer settles is never published as its result`, async () => {
      const grant = await granted(mode, tool);
      pool.onAnswer = () => void change();
      const input = grant.start();
      calls.start(input);
      expect(await callOutcome(input.operationId)).toEqual({ ok: false, failure: 'refused', refusal: 'revoked', reason: 'grant' });
      expect(toolCalls()).toHaveLength(1); // written: not reversible, its result suppressed
      expect(fences()).toBe(0);
    });

    it(`${label} after the write, while its answer is on the way, is never published as its result`, async () => {
      const grant = await granted(mode, tool);
      pool.afterWrite = deferred();
      const input = grant.start();
      calls.start(input);
      await vi.waitFor(() => expect(toolCalls()).toHaveLength(1), { interval: 1 });
      await change();
      pool.afterWrite.resolve();
      expect(await callOutcome(input.operationId)).toEqual({ ok: false, failure: 'refused', refusal: 'revoked', reason: 'grant' });
    });
  }

  it('a revoke at any microtask between the written call’s answer and its publication is the revoke’s refusal', async () => {
    const grant = await granted();
    for (let depth = 0; depth < 12; depth++) {
      await documents.store.grantConnectorTool(artifactId, { server: 'usertoy', tool: 'rows', fingerprint: grant.fingerprint, mode: 'read' });
      const later = (left: number, run: () => void): void => queueMicrotask(() => (left === 0 ? run() : later(left - 1, run)));
      pool.onAnswer = () => later(depth, () => void documents.store.revokeConnectorTool(artifactId, { server: 'usertoy', tool: 'rows' }));
      const input = grant.start();
      calls.start(input);
      expect(await callOutcome(input.operationId), `depth ${depth}`).toEqual({ ok: false, failure: 'refused', refusal: 'revoked', reason: 'grant' });
    }
  });

  it('a contradicting report after the write, while its answer is on the way, keeps the answer from being published', async () => {
    const grant = await granted();
    pool.afterWrite = deferred();
    const input = grant.start();
    calls.start(input);
    await vi.waitFor(() => expect(toolCalls()).toHaveLength(1), { interval: 1 });
    observed(launch('app-2', 'L2'), report());
    pool.afterWrite.resolve();
    expect(await callOutcome(input.operationId)).toEqual({ ok: false, failure: 'unavailable', reason: 'source' });
  });

  it('a grant re-made the same keeps an untaken result: the fence breaks only for a change that refuses it', async () => {
    const grant = await granted();
    const input = grant.start();
    calls.start(input);
    await vi.waitFor(() => expect(completed).toContain(input.operationId));
    await documents.store.grantConnectorTool(artifactId, { server: 'usertoy', tool: 'rows', fingerprint: grant.fingerprint, mode: 'read' });
    expect(calls.take(input.operationId)).toMatchObject({ kind: 'call', outcome: { ok: true } });
  });

  it('an Allow once admits one of concurrent calls, consumed only after the connection and live tool are ready', async () => {
    const grant = await granted('once', 'send');
    const inputs = [grant.start(), grant.start(), grant.start()];
    for (const input of inputs) calls.start(input);
    const outcomes = await Promise.all(inputs.map((input) => callOutcome(input.operationId)));
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, failure: 'refused', refusal: 'notGranted', reason: 'grant' },
      { ok: false, failure: 'refused', refusal: 'notGranted', reason: 'grant' },
    ]);
    expect(toolCalls()).toEqual([{ kind: 'tools/call', name: 'send' }]);
  });

  const notReady: [string, () => void, object][] = [
    ['the server cannot start', () => (pool.startupFailure = { ok: false, failure: 'unavailable', admitted: false, message: SECRET_SERVER_TEXT }), { failure: 'unavailable', reason: 'connection' }],
    ['the server asks for authorization', () => (pool.startupFailure = { ok: false, failure: 'unauthorized', admitted: false, message: SECRET_SERVER_TEXT }), { failure: 'unavailable', reason: 'unauthorized' }],
    ['the live tools/list lacks the tool', () => (pool.tools = [{ name: 'rows', readOnly: true }]), { failure: 'unavailable', reason: 'toolMissing' }],
    // P3-HD panel correction: the SDK would refuse it before tools/call, after the Allow once was spent
    ['the live tool requires task execution', () => (pool.tools = [{ name: 'rows', readOnly: true }, { name: 'send', readOnly: false, taskRequired: true }]), { failure: 'unavailable', reason: 'taskRequired' }],
  ];
  for (const [label, arrange, expected] of notReady) {
    it(`burns no Allow once when ${label}`, async () => {
      const grant = await granted('once', 'send');
      arrange();
      const input = grant.start();
      calls.start(input);
      const outcome = await callOutcome(input.operationId);
      expect(outcome).toEqual({ ok: false, ...expected });
      expect(JSON.stringify(outcome)).not.toContain(SECRET_SERVER_TEXT);
      expect(await documents.store.connectorGrants(artifactId)).toMatchObject([{ tool: 'send', mode: 'once' }]);
      expect(toolCalls()).toEqual([]);
    });
  }

  // P3-HD M3b (Decision Log 18): the live metadata's mismatch is the private `changed`, the durable grant left untouched
  it('refuses a read grant’s call when the live tools/list says the tool is no longer read-only, before any write', async () => {
    const grant = await granted();
    pool.tools = [{ name: 'rows', readOnly: false }];
    const input = grant.start();
    calls.start(input);
    expect(await callOutcome(input.operationId)).toEqual({ ok: false, failure: 'unavailable', reason: 'changed' });
    expect(await documents.store.connectorGrants(artifactId)).toMatchObject([{ tool: 'rows', mode: 'read' }]);
    expect(toolCalls()).toEqual([]);
  });

  // P3-HD panel correction: a task-required tool is unusable through route D, said at the call and, once a live
  // listing showed it, at the resolution the owner's rows read (a session's alone), the durable grant untouched
  it('refuses a task-required tool before any Allow once is consumed, and resolves it as unusable once listed', async () => {
    const grant = await granted();
    pool.tools = [{ name: 'rows', readOnly: true, taskRequired: true }];
    const input = grant.start();
    calls.start(input);
    expect(await callOutcome(input.operationId)).toEqual({ ok: false, failure: 'unavailable', reason: 'taskRequired' });
    expect(toolCalls()).toEqual([]);
    expect(await documents.store.connectorGrants(artifactId)).toMatchObject([{ tool: 'rows', mode: 'read' }]);
    const operationId = nextId();
    calls.resolve({ operationId, artifactId, directories: [project], server: 'usertoy', tool: 'rows' });
    expect(await taken(operationId)).toEqual({ kind: 'resolve', answer: { ready: false, why: 'taskRequired' } });
    pool.tools = [{ name: 'rows', readOnly: true }]; // listed again without the requirement: usable again
    const again = grant.start();
    calls.start(again);
    expect(await callOutcome(again.operationId)).toMatchObject({ ok: true });
    const later = nextId();
    calls.resolve({ operationId: later, artifactId, directories: [project], server: 'usertoy', tool: 'rows' });
    expect(await taken(later)).toMatchObject({ kind: 'resolve', answer: { ready: true } });
  });

  it('refuses before connecting when main’s fingerprint, source or grant no longer matches', async () => {
    const grant = await granted();
    const stale = grant.start({ fingerprint: 'stale' });
    calls.start(stale);
    expect(await callOutcome(stale.operationId)).toEqual({ ok: false, failure: 'refused', refusal: 'fingerprintChanged', reason: 'source' });
    const other = grant.start({ generation: grant.source.generation + 1 });
    calls.start(other);
    expect(await callOutcome(other.operationId)).toEqual({ ok: false, failure: 'unavailable', reason: 'source', sourceRefusal: 'changed' });
    await documents.store.revokeConnectorTool(artifactId, { server: 'usertoy', tool: 'rows' });
    const ungranted = grant.start();
    calls.start(ungranted);
    expect(await callOutcome(ungranted.operationId)).toEqual({ ok: false, failure: 'refused', refusal: 'notGranted', reason: 'grant' });
    expect(pool.acquires).toHaveLength(0);
  });
});

describe('DirectCalls: the source and the credential at the actual write', () => {
  it('a contradicting report between the entry’s read and the write sends nothing', async () => {
    const grant = await granted();
    pool.atWrite = deferred();
    const input = grant.start();
    calls.start(input);
    await pool.reachedWrite.promise;
    observed(launch('app-2', 'L2'), report()); // another launch of the context: the server absent
    pool.atWrite.resolve();
    expect(await callOutcome(input.operationId)).toMatchObject({ ok: false, failure: 'unavailable', reason: 'source' });
    expect(toolCalls()).toEqual([]);
  });

  it('an engine appearing for the same source does not stop an admitted direct call', async () => {
    const grant = await granted();
    pool.atWrite = deferred();
    const input = grant.start();
    calls.start(input);
    await pool.reachedWrite.promise;
    observed(launch('app-2', 'L2'), report(toy())); // an eligible engine, the same facts
    pool.atWrite.resolve();
    expect(await callOutcome(input.operationId)).toMatchObject({ ok: true });
    expect(toolCalls()).toHaveLength(1);
  });

  it('a credential withdrawn while its call waits at the write sends nothing; its epoch stays refused, a newer one runs', async () => {
    const grant = await granted();
    const connectionId = '00000000-0000-4000-8000-00000000c0de';
    const credential = (credentialEpoch: number) => ({ connectionId, credentialEpoch, accessToken: TOKEN });
    pool.atWrite = deferred();
    const input = grant.start({ credential: credential(1) });
    calls.start(input);
    await pool.reachedWrite.promise;
    expect(calls.withdraw(connectionId, 1)).toBe(1);
    expect(pool.invalidations.at(-1)!({ cwd: project, sourceId: '', generation: 1, server: 'usertoy', entryDigest: '', connectionId, credentialEpoch: 1 })).toBe(true);
    expect(pool.invalidations.at(-1)!({ cwd: project, sourceId: '', generation: 1, server: 'usertoy', entryDigest: '', connectionId, credentialEpoch: 2 })).toBe(false);
    pool.atWrite.resolve();
    await tick();
    expect(toolCalls()).toEqual([]);
    expect(calls.take(input.operationId)).toBeNull(); // ended unannounced
    expect(completed).not.toContain(input.operationId);
    pool.atWrite = null;
    const late = grant.start({ credential: credential(1) });
    calls.start(late);
    expect(await callOutcome(late.operationId)).toEqual({ ok: false, failure: 'unavailable', reason: 'credential' });
    const fresh = grant.start({ credential: credential(2) });
    calls.start(fresh);
    expect(await callOutcome(fresh.operationId)).toMatchObject({ ok: true });
    expect(pool.acquires.at(-1)!.credential).toEqual(credential(2));
  });

  it.each(['epoch', 'global'] as const)('%s withdrawal still drops a generic call’s untaken result', async (scope) => {
    const { start } = await granted();
    const credential = { connectionId: nextId(), credentialEpoch: 1, accessToken: TOKEN };
    const { operationId } = calls.start(start({ credential }));
    await vi.waitFor(() => expect(completed).toContain(operationId));
    expect(fences()).toBe(1);
    expect(scope === 'epoch' ? calls.withdraw(credential.connectionId, credential.credentialEpoch) : calls.withdraw()).toBe(1);
    expect(calls.take(operationId)).toBeNull();
    expect(fences()).toBe(0);
  });

  it('withdrawing all direct work ends every operation and invalidates every connection', async () => {
    const grant = await granted();
    pool.startup = deferred();
    const input = grant.start();
    calls.start(input);
    expect(calls.withdraw()).toBe(1);
    expect(pool.invalidations.at(-1)!({ cwd: '', sourceId: '', generation: 1, server: '', entryDigest: '' })).toBe(true);
    pool.startup.resolve();
    await tick();
    expect(toolCalls()).toEqual([]);
    expect(calls.take(input.operationId)).toBeNull();
  });
});

describe('DirectCalls: lifetimes', () => {
  it('a cancel during startup ends it unannounced; the late connection is released, never used', async () => {
    const grant = await granted();
    pool.startup = deferred();
    const input = grant.start();
    calls.start(input);
    await vi.waitFor(() => expect(pool.acquires).toHaveLength(1));
    expect(calls.cancel(input.operationId)).toBe(true);
    expect(fences()).toBe(0);
    pool.startup.resolve();
    await tick();
    await tick();
    expect(pool.wire).toEqual([]);
    expect(completed).toEqual([expect.any(String)]); // the resolution's alone
    expect(calls.take(input.operationId)).toBeNull();
  });

  it('a cancel after the write aborts the request (the SDK’s cancellation) and is never announced', async () => {
    const grant = await granted();
    pool.afterWrite = deferred();
    const input = grant.start();
    calls.start(input);
    await vi.waitFor(() => expect(toolCalls()).toHaveLength(1), { interval: 1 });
    calls.cancel(input.operationId);
    expect(pool.aborts).toBe(1);
    pool.afterWrite.resolve();
    await tick();
    expect(completed).not.toContain(input.operationId);
  });

  it('times out at its deadline while startup never settles, announced once; the late startup is released, never used', async () => {
    const clock = new ManualClock();
    calls = build({ clock });
    const grant = await granted();
    pool.startup = deferred();
    const input = grant.start();
    calls.start(input);
    await vi.waitFor(() => expect(pool.acquires).toHaveLength(1), { interval: 1 });
    clock.advance(DIRECT_CALL_DEADLINE_MS - 1);
    await tick();
    expect(completed).not.toContain(input.operationId);
    clock.advance(1);
    expect(await callOutcome(input.operationId)).toEqual({ ok: false, failure: 'unavailable', reason: 'timeout' });
    pool.startup.resolve();
    await tick();
    await tick();
    expect(pool.wire).toEqual([]);
    expect(completed.filter((id) => id === input.operationId)).toHaveLength(1);
    expect(fences()).toBe(0);
  });

  it('drops an untaken outcome and its fence after the retention bound, not before', async () => {
    const clock = new ManualClock();
    calls = build({ clock });
    const grant = await granted();
    clock.advance(DIRECT_RESULT_TTL_MS * 2); // the resolution's outcome, taken already, leaves nothing behind
    const input = grant.start();
    calls.start(input);
    await vi.waitFor(() => expect(completed).toContain(input.operationId), { interval: 1 });
    clock.advance(DIRECT_RESULT_TTL_MS - 1);
    expect(fences()).toBe(1);
    clock.advance(1);
    expect(calls.take(input.operationId)).toBeNull();
    expect(fences()).toBe(0);
  });

  it('main’s going ends every operation and outcome synchronously; nothing late is announced or written', async () => {
    const grant = await granted();
    const done = grant.start();
    calls.start(done);
    await vi.waitFor(() => expect(completed).toContain(done.operationId));
    pool.atWrite = deferred();
    pool.reachedWrite = deferred();
    const writing = grant.start();
    calls.start(writing);
    await pool.reachedWrite.promise;
    pool.startup = deferred();
    const starting = grant.start();
    calls.start(starting);
    const before = completed.length;
    void calls.close();
    expect(pool.invalidations.at(-1)!({ cwd: '', sourceId: '', generation: 1, server: '', entryDigest: '' })).toBe(true);
    // every connection of the attachment refuses its own writes too, its source still observed
    expect(pool.acquires.map((spec) => spec.fence())).toEqual(pool.acquires.map(() => false));
    expect(fences()).toBe(0);
    for (const input of [done, writing, starting]) expect(calls.take(input.operationId)).toBeNull();
    pool.atWrite.resolve();
    pool.startup.resolve();
    await tick();
    await tick();
    expect(toolCalls()).toHaveLength(1); // the first's, before main went
    expect(completed).toHaveLength(before);
  });

  it('a new attachment numbers its own credentials: main’s going clears the floors', async () => {
    const grant = await granted();
    const connectionId = '00000000-0000-4000-8000-00000000c0de';
    calls.withdraw(connectionId, 5);
    void calls.close();
    const input = grant.start({ credential: { connectionId, credentialEpoch: 1, accessToken: TOKEN } });
    calls.start(input);
    expect(await callOutcome(input.operationId)).toMatchObject({ ok: true });
  });

  it('shutdown ends everything and awaits the pool’s close', async () => {
    const grant = await granted();
    pool.startup = deferred();
    calls.start(grant.start());
    await calls.shutdown();
    expect(pool.closed).toBe(1);
    pool.startup.resolve();
  });
});

// E3c: direct results stay in the host under the shared dataset sink.
describe('DirectCalls with a dataset sink', () => {
  let dashboards: ReturnType<typeof registerDashboards>;
  let clock: ManualClock;
  let requests: DatasetRefreshRequests;
  let beforePublish: (() => Promise<void> | void) | undefined;
  let published: boolean;
  let onAdmission: (() => void) | undefined;
  let requestId: string;
  const query = { kind: 'query' as const, server: 'usertoy', tool: 'rows', args: {} };
  const prior: DatasetDescriptor = { title: 'Live', source: { ...query, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: 1 } };
  const live = () => readDataset(documents.service.live(artifactId), 'live');
  beforeEach(async () => {
    dashboards = registerDashboards({ documents });
    clock = new ManualClock();
    requests = new DatasetRefreshRequests({ announce: (id) => { requestId = id; }, hasClient: () => true });
    beforePublish = undefined;
    published = false;
    onAdmission = undefined;
    const sink = connectorDatasetSink({ store: () => documents.store, requests });
    await calls.close();
    calls = build({ clock, datasets: { admit: async (start, cancel) => {
      const admission = await sink.admit(start, cancel);
      if (!('publish' in admission)) return admission;
      return { publish: async (raw, guard, admitted) => {
        await beforePublish?.();
        try { return await admission.publish(raw, guard, () => { admitted?.(); onAdmission?.(); }); } finally { published = true; }
      } };
    } } });
    artifactId = (await documents.store.create({ kind: 'dashboard', title: 'Board' }, { kind: 'human' })).id;
    await documents.store.writeWithAssets(artifactId, { kind: 'human' }, [], (doc) => setDataset(doc, 'live', prior));
    pool.result = { content: [{ type: 'text', text: '{"rows":[{"v":107}]}' }], structuredContent: { rows: [{ v: 107 }] }, isError: false };
  });
  afterEach(() => dashboards.close());
  const announced = async (id: string, count: number) => vi.waitFor(() => expect(completed.filter((one) => one === id)).toHaveLength(count));
  const take = (id: string) => calls.takeOperation(id);
  const publish = async (id: string) => {
    await announced(id, 1);
    expect(take(id)).toEqual({ outcome: null, dataset: { status: 'publishing', operationId: id } });
    expect(take(id)).toEqual({ outcome: null, dataset: { status: 'publishing', operationId: id } });
    await announced(id, 2);
    return take(id);
  };

  it('publishes once with human attribution and metadata alone for a sessionless refresh', async () => {
    const { start } = await granted();
    const { operationId } = calls.start(start({ dataset: { id: 'live' } }));
    await announced(operationId, 1);
    expect(live()).toEqual(prior);
    expect(calls.take(operationId)).toBeNull();
    const end = await publish(operationId);
    expect(end).toEqual({ outcome: null, dataset: { status: 'dataset', artifactId, id: 'live', revision: documents.store.revision(artifactId), columns: [{ name: 'v', type: 'number' }], rows: 1 } });
    expect(JSON.stringify(end)).not.toMatch(/107|structuredContent|content/);
    expect(live()).toMatchObject({ rows: 1, updated: { by: { kind: 'human' } }, state: { status: 'ok' } });
    expect(documents.store.listAssets(artifactId)).toHaveLength(1);
    expect(take(operationId)).toEqual({ outcome: null });
    expect(fences()).toBe(0);
  });

  it('binds an agent refresh to its asking session and refuses a mismatched session before any call', async () => {
    const { start } = await granted();
    const answer = requests.ask({ artifactId, datasetId: 'live', baseRevision: documents.store.revision(artifactId), appSessionId: 'app-asker' as AppSessionId, opId: null, server: query.server, tool: query.tool, args: {} }, new AbortController().signal);
    const dataset = { id: 'live', baseRevision: documents.store.revision(artifactId), requestId };
    const wrong = calls.start(start({ dataset, appSessionId: 'app-other' })).operationId;
    await announced(wrong, 1);
    expect(take(wrong)).toMatchObject({ outcome: { kind: 'call', outcome: { ok: false } } });
    expect(toolCalls()).toEqual([]);
    const right = calls.start(start({ dataset, appSessionId: 'app-asker' })).operationId;
    expect(await publish(right)).toMatchObject({ dataset: { status: 'dataset' } });
    expect(live()).toMatchObject({ updated: { by: { kind: 'session', appSessionId: 'app-asker' } } });
    expect(await answer).toMatchObject({ kind: 'published' });
  });

  it.each(['revoke', 'cancel', 'credential', 'directClose', 'source'] as const)('publishes nothing when %s changes between take and commit', async (change) => {
    const { start } = await granted();
    const credential = { connectionId: nextId(), credentialEpoch: 1, accessToken: TOKEN };
    const input = start({ dataset: { id: 'live' }, credential });
    beforePublish = async () => {
      if (change === 'revoke') await documents.store.revokeConnectorTool(artifactId, query);
      if (change === 'cancel') calls.cancel(input.operationId);
      if (change === 'credential') calls.withdraw(credential.connectionId, credential.credentialEpoch);
      if (change === 'directClose') calls.withdraw();
      if (change === 'source') observed(launch('app-2', 'L2'), report(toy(['other.mjs'])));
    };
    calls.start(input);
    await announced(input.operationId, 1);
    expect(take(input.operationId)).toMatchObject({ dataset: { status: 'publishing' } });
    await vi.waitFor(() => expect(published).toBe(true));
    expect(live()).toEqual(prior);
    expect(documents.store.listAssets(artifactId)).toEqual([]);
    if (change === 'credential' || change === 'directClose') {
      expect(take(input.operationId)).toEqual({ outcome: null });
      expect(fences()).toBe(0);
    }
  });

  it('preserves the durable end once publication admission owns cancellation', async () => {
    const { start } = await granted();
    const id = calls.start(start({ dataset: { id: 'live' } })).operationId;
    let cancelled: boolean | undefined;
    onAdmission = () => { cancelled = calls.cancel(id); };
    expect(await publish(id)).toMatchObject({ dataset: { status: 'dataset', rows: 1 } });
    expect(cancelled).toBe(false);
    expect(live()).toMatchObject({ rows: 1 });
  });

  describe.each(['epoch', 'global'] as const)('%s credential withdrawal', (scope) => {
    const withdraw = (credential: NonNullable<DirectStartInput['credential']>) =>
      scope === 'epoch' ? calls.withdraw(credential.connectionId, credential.credentialEpoch) : calls.withdraw();

    it.each([
      ['admission', 'rows'], ['admission', 'error'], ['admission', 'rollback'],
      ['end', 'rows'], ['end', 'error'], ['end', 'rollback'],
    ] as const)('keeps the %s-owned %s publication until its terminal result is taken', async (when, result) => {
      const { start } = await granted();
      const credential = { connectionId: nextId(), credentialEpoch: 1, accessToken: TOKEN };
      if (result === 'error') pool.result = { content: [], structuredContent: { other: 107 }, isError: false };
      if (result === 'rollback') {
        const write = documents.store.writeWithAssets.bind(documents.store);
        vi.spyOn(documents.store, 'writeWithAssets').mockImplementationOnce((id, actor, assets, edit, options) =>
          write(id, actor, assets, edit, { ...options, afterWrite: () => { throw new Error('injected write failure'); } }));
      }
      const id = calls.start(start({ dataset: { id: 'live' }, credential })).operationId;
      let ended: number | undefined;
      if (when === 'admission') onAdmission = () => { ended = withdraw(credential); };
      await announced(id, 1);
      expect(take(id)).toEqual({ outcome: null, dataset: { status: 'publishing', operationId: id } });
      await vi.waitFor(() => expect(published).toBe(true));
      if (when === 'end') {
        await announced(id, 2);
        ended = withdraw(credential);
      }
      expect(ended).toBe(0);
      // The connection loses write authority even though the host still owns the publication's terminal result.
      expect(pool.acquires.at(-1)!.fence()).toBe(false);
      const key = { cwd: project, sourceId: '', generation: 1, server: 'usertoy', entryDigest: '', connectionId: credential.connectionId, credentialEpoch: 1 };
      expect(pool.invalidations.at(-1)!(key)).toBe(true);
      expect(pool.invalidations.at(-1)!({ ...key, credentialEpoch: 2 })).toBe(scope === 'global');
      expect(fences()).toBe(1);
      await announced(id, 2);
      const end = take(id);
      if (result === 'rows') {
        expect(end).toEqual({ outcome: null, dataset: { status: 'dataset', artifactId, id: 'live', revision: documents.store.revision(artifactId), columns: [{ name: 'v', type: 'number' }], rows: 1 } });
        expect(live()).toMatchObject({ rows: 1, state: { status: 'ok' } });
        expect(documents.store.listAssets(artifactId)).toHaveLength(1);
      } else if (result === 'error') {
        expect(end).toEqual({ outcome: null, dataset: { status: 'failed', reason: 'validation' } });
        expect(live()).toMatchObject({ state: { status: 'error' }, source: { snapshot: null } });
        expect(documents.store.listAssets(artifactId)).toEqual([]);
      } else {
        expect(end).toEqual({ outcome: { kind: 'call', outcome: { ok: false, failure: 'failed', reason: 'store' } } });
        expect(live()).toEqual(prior);
        expect(documents.store.listAssets(artifactId)).toEqual([]);
      }
      expect(take(id)).toEqual({ outcome: null });
      expect(fences()).toBe(0);
      const late = calls.start(start({ credential })).operationId;
      expect(await callOutcome(late)).toEqual({ ok: false, failure: 'unavailable', reason: 'credential' });
      expect(toolCalls()).toHaveLength(1);
      const fresh = calls.start(start({ credential: { ...credential, credentialEpoch: 2 } })).operationId;
      expect(await callOutcome(fresh)).toMatchObject({ ok: true });
    });

    it('does not extend the retention of a durable publication when credentials are withdrawn', async () => {
      const { start } = await granted();
      const credential = { connectionId: nextId(), credentialEpoch: 1, accessToken: TOKEN };
      const id = calls.start(start({ dataset: { id: 'live' }, credential })).operationId;
      await announced(id, 1);
      expect(take(id)).toMatchObject({ dataset: { status: 'publishing' } });
      await announced(id, 2);
      clock.advance(DIRECT_RESULT_TTL_MS - 1);
      expect(withdraw(credential)).toBe(0);
      expect(fences()).toBe(1);
      clock.advance(1);
      expect(take(id)).toEqual({ outcome: null });
      expect(fences()).toBe(0);
      expect(live()).toMatchObject({ rows: 1, state: { status: 'ok' } });
    });
  });

  it.each(['admission', 'end'] as const)('main-client loss still drops an %s-owned dataset publication', async (when) => {
    const { start } = await granted();
    const id = calls.start(start({ dataset: { id: 'live' } })).operationId;
    if (when === 'admission') onAdmission = () => { void calls.close(); };
    await announced(id, 1);
    expect(take(id)).toMatchObject({ dataset: { status: 'publishing' } });
    await vi.waitFor(() => expect(published).toBe(true));
    if (when === 'end') {
      await announced(id, 2);
      await calls.close();
    }
    await tick();
    expect(take(id)).toEqual({ outcome: null });
    expect(fences()).toBe(0);
    expect(completed.filter((one) => one === id)).toHaveLength(when === 'admission' ? 1 : 2);
  });

  it('refuses mismatched queries and non-read dataset calls before opening a connection', async () => {
    const { start } = await granted();
    const stale = calls.start(start({ dataset: { id: 'live' }, arguments: { other: true } })).operationId;
    await announced(stale, 1);
    expect(take(stale)).toEqual({ outcome: null, dataset: { status: 'failed', reason: 'stale' } });
    const once = calls.start(start({ dataset: { id: 'live' }, mode: 'once' })).operationId;
    await announced(once, 1);
    expect(take(once)).toMatchObject({ outcome: { kind: 'call', outcome: { ok: false, failure: 'refused', refusal: 'wrongMode' } } });
    expect(pool.acquires).toEqual([]);
    expect(live()).toEqual(prior);
  });

  it('records invalid rows as a dataset error instead of returning the MCP envelope', async () => {
    const { start } = await granted();
    pool.result = { content: [{ type: 'text', text: 'private rows' }], structuredContent: { other: 107 } };
    const id = calls.start(start({ dataset: { id: 'live' } })).operationId;
    const end = await publish(id);
    expect(end).toMatchObject({ outcome: null, dataset: { status: 'failed' } });
    expect(JSON.stringify(end)).not.toMatch(/107|private rows/);
    expect(live()).toMatchObject({ state: { status: 'error' }, source: { snapshot: null } });
  });
});

describe('DirectCalls: results and private answers', () => {
  it('refuses a result over the artifact bound or one that is not JSON, in closed reasons', async () => {
    calls = build({ maxResultBytes: 16 });
    const grant = await granted();
    const large = grant.start();
    calls.start(large);
    expect(await callOutcome(large.operationId)).toEqual({ ok: false, failure: 'tooLarge', reason: 'tooLarge' });
    pool.result = undefined;
    const odd = grant.start();
    calls.start(odd);
    expect(await callOutcome(odd.operationId)).toEqual({ ok: false, failure: 'failed', reason: 'notJson' });
  });

  it('never carries a server’s text, a configured value or a token in any outcome', async () => {
    const grant = await granted();
    pool.callFailure = { ok: false, failure: 'failed', admitted: true, message: SECRET_SERVER_TEXT };
    const input = grant.start({ credential: { connectionId: '00000000-0000-4000-8000-00000000c0de', credentialEpoch: 0, accessToken: TOKEN } });
    calls.start(input);
    const outcome = await callOutcome(input.operationId);
    expect(outcome).toEqual({ ok: false, failure: 'failed', reason: 'transport' });
    for (const secret of [SECRET_SERVER_TEXT, SECRET_ENV, TOKEN]) expect(JSON.stringify(outcome)).not.toContain(secret);
    expect(toolCalls()).toHaveLength(1); // written once, never resent
  });
});
