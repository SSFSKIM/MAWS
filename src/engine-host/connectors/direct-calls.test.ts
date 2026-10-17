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
import { openDocuments, type Documents } from '../documents';
import { SECRET_SERVER_TEXT, ScriptedPool, deferred, tick } from './direct-pool.fixture';
import { DirectCalls, type DirectCallsOptions, type DirectStartInput } from './direct-calls';
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
    const stuck = { resolve: () => new Promise(() => {}), resolveSource: () => new Promise(() => {}), readEntryForWrite: () => new Promise(() => {}) };
    calls = build({ cache: stuck as never, resolveBoundMs: 20 });
    const operationId = nextId();
    calls.resolve({ operationId, artifactId, directories: [project], server: 'usertoy', tool: 'rows' });
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

  it('refuses a read grant’s call when the live tools/list says the tool is no longer read-only, before any write', async () => {
    const grant = await granted();
    pool.tools = [{ name: 'rows', readOnly: false }];
    const input = grant.start();
    calls.start(input);
    expect(await callOutcome(input.operationId)).toEqual({ ok: false, failure: 'refused', refusal: 'wrongMode', reason: 'grant' });
    expect(toolCalls()).toEqual([]);
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
    calls = build({ callDeadlineMs: 30 });
    const grant = await granted();
    pool.startup = deferred();
    const input = grant.start();
    calls.start(input);
    expect(await callOutcome(input.operationId)).toEqual({ ok: false, failure: 'unavailable', reason: 'timeout' });
    pool.startup.resolve();
    await tick();
    await tick();
    expect(pool.wire).toEqual([]);
    expect(completed.filter((id) => id === input.operationId)).toHaveLength(1);
    expect(fences()).toBe(0);
  });

  it('drops an untaken outcome and its fence after the retention bound', async () => {
    calls = build({ resultTtlMs: 100 });
    const grant = await granted();
    const input = grant.start();
    calls.start(input);
    await vi.waitFor(() => expect(completed).toContain(input.operationId), { interval: 1 });
    expect(fences()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
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
