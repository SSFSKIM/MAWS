// P3-HD M2: route D's host commands as the runtime calls them (input validated, output checked against the registry),
// over the real store and observation cache, with a scripted connection pool (./direct-pool.fixture.ts). H's own
// surface test (./register.test.ts) stays as it was: these commands are all immediate, their work an operation's.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import { MAIN_ONLY_COMMANDS, NAMES } from '@shared/ipc/names';
import { HOST_EVENTS, type CommandName, type CommandOutput, type EventName } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { openDocuments, type Documents } from '../documents';
import { DirectCalls } from './direct-calls';
import { SECRET_SERVER_TEXT, ScriptedPool, deferred, tick } from './direct-pool.fixture';
import { ConnectorStatusCache, connectorLaunchContext } from './provenance';
import { CONNECTORS_DEADLINE_SHAPES, registerConnectors } from './register';

const DIRECT = ['connectors.directResolve', 'connectors.directStart', 'connectors.directDiscover', 'connectors.directTake', 'connectors.directCancel', 'connectors.directClose'] as const;
const TOKEN = 'access-token-not-to-leak-77aa';
const SECRET_ENV = 'omitted-env-literal-9c1e';

let dir: string;
let project: string;
let config: string;
let documents: Documents;
let cache: ConnectorStatusCache;
let pool: ScriptedPool;
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
let emitted: { name: EventName; payload: unknown }[];
let gone: (() => void)[];
let surface: ReturnType<typeof registerConnectors>;
let ids = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

function observe(appSessionId: string, launchId: string): void {
  const context = connectorLaunchContext({ appSessionId, launchId, cwd: project, environment: { HOME: join(dir, 'home'), CLAUDE_CONFIG_DIR: config, PATH: join(dir, 'bin'), USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TERM: 'dumb' }, localKey: { kind: 'directory', key: project } });
  cache.observe(cache.begin(context), { mcpServers: [{ name: 'usertoy', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'toy', args: ['toy-server.mjs'] }, tools: [{ name: 'rows', annotations: { readOnly: true } }] }] } as never);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-hd-register-'));
  project = join(dir, 'project');
  config = join(dir, 'config');
  for (const path of [join(dir, 'home'), config, project, join(dir, 'bin'), join(dir, 'data')]) mkdirSync(path);
  writeFileSync(join(dir, 'bin', 'toy'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'bin', 'toy'), 0o755);
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ mcpServers: { usertoy: { type: 'stdio', command: 'toy', args: ['toy-server.mjs'], env: { TOY_SECRET: SECRET_ENV } } } }));
  documents = openDocuments(join(dir, 'data'), () => {})!;
  cache = new ConnectorStatusCache();
  pool = new ScriptedPool();
  handlers = new Map();
  emitted = [];
  gone = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    expect(validateEventPayload(name, payload).ok, name).toBe(true);
    emitted.push({ name, payload });
    return true;
  };
  const direct = new DirectCalls({ cache, pool: pool as never, store: () => documents.store, completed: (operationId) => void emit('connectors.directOperation', { operationId }) });
  surface = registerConnectors(on, emit, { onClientGone: (hook) => (gone.push(hook), () => {}) }, { sessions: { get: () => undefined }, store: documents.store, statusCache: cache, direct });
});
afterEach(() => {
  surface.close();
  documents.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call<N extends CommandName>(name: N, input: unknown): Promise<CommandOutput<N>> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}: ${JSON.stringify(checked.error)}`);
  const value = await handlers.get(name)!(checked.value);
  const output = validateCommandOutput(name, value);
  if (!output.ok) throw new Error(`invalid output of ${name}: ${JSON.stringify(output.error.issues).slice(0, 400)}`);
  return output.value as CommandOutput<N>;
}
const ended = (operationId: string) => vi.waitFor(() => expect(emitted).toContainEqual({ name: 'connectors.directOperation', payload: { operationId } }), { interval: 1 });

// main's resolution, grant and start of one read call
async function readCall(artifactId: string, credential?: object) {
  const resolution = nextId();
  expect(await call('connectors.directResolve', { operationId: resolution, artifactId, directories: [project], server: 'usertoy', tool: 'rows' })).toEqual({ operationId: resolution });
  await ended(resolution);
  const { outcome } = await call('connectors.directTake', { operationId: resolution });
  if (outcome?.kind !== 'resolve' || !outcome.answer.ready || !outcome.answer.tool) throw new Error(JSON.stringify(outcome));
  const { source, tool } = outcome.answer;
  await documents.store.grantConnectorTool(artifactId, { server: 'usertoy', tool: 'rows', fingerprint: tool.fingerprint, mode: 'read' });
  const operationId = nextId();
  const start = { operationId, artifactId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: 'usertoy', tool: 'rows', arguments: {}, fingerprint: tool.fingerprint, mode: 'read', ...(credential && { credential }) };
  expect(await call('connectors.directStart', start)).toEqual({ operationId });
  return { operationId, source };
}
const artifact = async () => (await documents.store.create({ kind: 'html', title: 'Live page', content: { bytes: new TextEncoder().encode('<p>a</p>') } }, { kind: 'human' })).id;

describe('route D’s host commands (P3-HD M2)', () => {
  it('are main’s alone, never bridged, each immediate; their end event carries the id alone', () => {
    for (const name of DIRECT) {
      expect(MAIN_ONLY_COMMANDS, name).toContain(name);
      expect([...NAMES.connectors.commands], name).not.toContain(name);
      expect(CONNECTORS_DEADLINE_SHAPES[name], name).toBe('immediate');
      expect(handlers.has(name), name).toBe(true);
    }
    expect(HOST_EVENTS).toContain('connectors.directOperation');
    expect(validateEventPayload('connectors.directOperation', { operationId: nextId(), outcome: {} }).ok).toBe(false);
    // closed reasons only: an outcome carrying a message is not one
    expect(validateCommandOutput('connectors.directTake', { outcome: { kind: 'call', outcome: { ok: false, failure: 'failed', reason: 'transport' } } }).ok).toBe(true);
    expect(validateCommandOutput('connectors.directTake', { outcome: { kind: 'call', outcome: { ok: false, failure: 'failed', reason: 'transport', message: SECRET_SERVER_TEXT } } }).ok).toBe(false);
    expect(validateCommandOutput('connectors.directTake', { outcome: { kind: 'call', outcome: { ok: false, failure: 'failed', reason: 'said so' } } }).ok).toBe(false);
  });

  it('resolve, start, end and take through the registry, with nothing configured or secret in any answer or event', async () => {
    observe('app-1', 'L1');
    const { operationId } = await readCall(await artifact(), { connectionId: nextId(), credentialEpoch: 1, accessToken: TOKEN });
    await ended(operationId);
    expect(await call('connectors.directTake', { operationId })).toEqual({ outcome: { kind: 'call', outcome: { ok: true, result: { content: [{ type: 'text', text: 'rows 107' }] } } } });
    expect(await call('connectors.directTake', { operationId })).toEqual({ outcome: null });
    expect(await call('connectors.directCancel', { operationId })).toEqual({ cancelled: false });
    const said = JSON.stringify(emitted);
    for (const secret of [TOKEN, SECRET_ENV, SECRET_SERVER_TEXT]) expect(said).not.toContain(secret);
  });

  it('directClose withdraws a credential’s epoch before it answers: the waiting call writes nothing, a later start at it is refused', async () => {
    observe('app-1', 'L1');
    const connectionId = nextId();
    pool.atWrite = deferred();
    const id = await artifact();
    const { operationId } = await readCall(id, { connectionId, credentialEpoch: 3, accessToken: TOKEN });
    await pool.reachedWrite.promise;
    expect(await call('connectors.directClose', { connectionId, credentialEpoch: 3 })).toEqual({ cancelled: 1 });
    pool.atWrite.resolve();
    await tick();
    expect(pool.wire.filter((entry) => entry.kind === 'tools/call')).toEqual([]);
    expect(await call('connectors.directTake', { operationId })).toEqual({ outcome: null });
  });

  it('main’s going ends its attachment, not the host: old work goes for good, a fresh observation serves the next main', async () => {
    observe('app-1', 'L1');
    const id = await artifact();
    pool.startup = deferred();
    const old = await readCall(id);
    await vi.waitFor(() => expect(pool.acquires).toHaveLength(1), { interval: 1 });
    for (const hook of gone) hook();
    expect(pool.invalidations).toHaveLength(1); // every connection of the attachment
    expect(pool.closed).toBe(0); // the pool stays for the next one
    expect(await call('connectors.directTake', { operationId: old.operationId })).toEqual({ outcome: null });
    // the old startup completing late attaches to nothing: its connection's fence belongs to the gone attachment
    pool.startup.resolve();
    await tick();
    expect(pool.acquires[0]!.fence()).toBe(false);
    expect(pool.wire).toEqual([]);
    // the cache went with main: nothing resolves until a live observation in the new attachment
    const cold = nextId();
    await call('connectors.directResolve', { operationId: cold, artifactId: id, directories: [project], server: 'usertoy', tool: 'rows' });
    await ended(cold);
    expect(await call('connectors.directTake', { operationId: cold })).toEqual({ outcome: { kind: 'resolve', answer: { ready: false, why: 'unobserved' } } });
    observe('app-2', 'L2');
    const fresh = await readCall(id);
    expect(fresh.source.sourceId).not.toBe(old.source.sourceId);
    await ended(fresh.operationId);
    expect(await call('connectors.directTake', { operationId: fresh.operationId })).toMatchObject({ outcome: { kind: 'call', outcome: { ok: true } } });
    expect(emitted.filter((event) => event.name === 'connectors.directOperation').map((event) => (event.payload as { operationId: string }).operationId)).not.toContain(old.operationId);
  });

  it('the host’s shutdown closes the pool for good and its promise is the pool’s close', async () => {
    await surface.closeDirect();
    expect(pool.closed).toBe(1);
  });
});
