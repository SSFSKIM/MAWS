// P4-B5: route D's owner delivery in the host (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7; route D's
// final-write rule, docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md "Actual-write authority"): `directLocate`
// over the observation cache, and `directSend` over the real artifact store and cache with the scripted pool standing
// where MAWS's own MCP connection is, paused where the transport's actual stdin write or fetch would be. A delivery has
// no grant: what admits its write is the operation still registered, the artifact not deleted, the source still
// verified and the credential's epoch not withdrawn. Every "nothing was sent" reads the pool's wire log.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectOperationOutcome } from '@shared/ipc/schema/connectors';
import type { McpStatusResponse } from '@shared/wire/control';
import { openDocuments, type Documents } from '../documents';
import { ManualClock, ScriptedPool, deferred } from './direct-pool.fixture';
import { DIRECT_LOCATE_VERIFY_MAX, DirectCalls, type DirectCallsOptions, type DirectSendInput } from './direct-calls';
import { ConnectorStatusCache, connectorLaunchContext, type ConnectorLaunchContext } from './provenance';
import { ConfiguredDeliverySources } from './configured-delivery';
import { SETTINGS_DEFAULTS_V18 } from '@shared/settings/defaults';

type Server = { name: string; status: string; scope: string; source: string; config: Record<string, unknown>; tools?: { name: string; annotations?: Record<string, unknown> }[] };
const notion = (tools: Server['tools'] = [{ name: 'notion-create-pages', annotations: {} }, { name: 'notion-search', annotations: { readOnly: true } }]): Server => ({ name: 'notion', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'toy', args: ['notion.mjs'] }, tools });
const hosted = (status = 'needs-auth'): Server => ({ name: 'notion-hosted', status, scope: 'user', source: 'user', config: { type: 'http', url: 'https://mcp.notion.com/mcp' } });
const other = (): Server => ({ name: 'other', status: 'connected', scope: 'user', source: 'user', config: { type: 'http', url: 'https://example.com/mcp' }, tools: [{ name: 'search' }] });
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

const launch = (appSessionId: string, launchId: string, cwd = project): ConnectorLaunchContext =>
  connectorLaunchContext({ appSessionId, launchId, cwd, environment: { HOME: join(dir, 'home'), CLAUDE_CONFIG_DIR: config, PATH: join(dir, 'bin'), USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TERM: 'dumb' }, localKey: { kind: 'directory', key: cwd } });
const observed = (context: ConnectorLaunchContext, answer: McpStatusResponse) => cache.observe(cache.begin(context), answer);

function build(options: Partial<DirectCallsOptions> = {}): DirectCalls {
  completed = [];
  return new DirectCalls({ cache, pool: pool as never, store: () => documents.store, completed: (id) => void completed.push(id), ...options });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-b5-send-'));
  project = join(dir, 'project');
  config = join(dir, 'config');
  for (const path of [join(dir, 'home'), config, project, join(dir, 'bin'), join(dir, 'data')]) mkdirSync(path);
  writeFileSync(join(dir, 'bin', 'toy'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'bin', 'toy'), 0o755);
  writeFileSync(join(config, '.claude.json'), JSON.stringify({
    mcpServers: {
      notion: { type: 'stdio', command: 'toy', args: ['notion.mjs'] },
      'notion-hosted': { type: 'http', url: 'https://mcp.notion.com/mcp' },
      other: { type: 'http', url: 'https://example.com/mcp' },
    },
  }));
  documents = openDocuments(join(dir, 'data'), () => {})!;
  cache = new ConnectorStatusCache();
  pool = new ScriptedPool();
  pool.tools = [{ name: 'notion-create-pages', readOnly: false }, { name: 'notion-search', readOnly: true }];
  pool.result = { content: [{ type: 'text', text: '{"pages":[{"id":"p1","url":"https://www.notion.so/p1"}]}' }] };
  calls = build();
  artifactId = (await documents.store.create({ kind: 'html', title: 'Quarterly memo', content: { bytes: new TextEncoder().encode('<p>a</p>') } }, { kind: 'human' })).id;
});
afterEach(() => {
  void calls.close();
  documents.close();
  rmSync(dir, { recursive: true, force: true });
});

async function taken(operationId: string): Promise<DirectOperationOutcome> {
  await vi.waitFor(() => expect(completed).toContain(operationId), { interval: 1 });
  const outcome = calls.take(operationId);
  expect(calls.take(operationId)).toBeNull();
  return outcome!;
}
async function located(tool = 'notion-create-pages', urlHosts = ['mcp.notion.com']) {
  const operationId = nextId();
  expect(calls.locate({ operationId, tool, urlHosts })).toEqual({ operationId });
  const outcome = await taken(operationId);
  if (outcome.kind !== 'locate') throw new Error(outcome.kind);
  return outcome.answer.sources;
}
async function sendInput(extra: Partial<DirectSendInput> = {}): Promise<DirectSendInput> {
  const [source] = (await located()).filter((entry) => entry.server === 'notion');
  if (!source) throw new Error('no notion source');
  return { operationId: nextId(), artifactId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: 'notion', tool: 'notion-create-pages', arguments: { pages: [{ content: '# Hi' }] }, ...extra };
}
const sendOutcome = async (operationId: string) => {
  const outcome = await taken(operationId);
  if (outcome.kind !== 'call') throw new Error(outcome.kind);
  return outcome.outcome;
};
const toolCalls = () => pool.wire.filter((entry) => entry.kind === 'tools/call');
const fences = () => (documents.store as unknown as { fences: Map<string, Set<unknown>> }).fences.size;

describe('WR 76/78: cold app-owned delivery', () => {
  const settings = (servers: { name: string; type: 'http'; url: string }[]) => writeFileSync(join(dir, 'data', 'settings.json'), JSON.stringify({ ...SETTINGS_DEFAULTS_V18, engine: { ...SETTINGS_DEFAULTS_V18.engine, mcpServers: servers } }));
  const configured = (captureEnv = async () => ({ CLAUDE_CONFIG_DIR: config, HOME: join(dir, 'home') })) => new ConfiguredDeliverySources({ userData: join(dir, 'data'), captureEnv });
  const inputOf = (source: Awaited<ReturnType<typeof located>>[number]): DirectSendInput => ({ operationId: nextId(), artifactId, directory: source.directory, server: source.server, sourceId: source.sourceId, generation: source.generation, tool: 'notion-create-pages', arguments: { pages: [{ content: '# Cold delivery' }] } });

  it('locates app and user HTTP entries without observations and sends exactly once using the app credential', async () => {
    settings([{ name: 'notion-app', type: 'http', url: 'https://mcp.notion.com/mcp' }]);
    calls = build({ deliverySources: configured() });
    const sources = await located();
    expect(sources.map((s) => [s.server, s.scope])).toEqual([['notion-app', 'app'], ['notion-hosted', 'user']]);
    expect(pool.acquires).toEqual([]);
    const input = { ...inputOf(sources[0]!), credential: { connectionId: nextId(), credentialEpoch: 1, accessToken: 'maws-owned-token' } };
    calls.send(input);
    expect(await sendOutcome(input.operationId)).toEqual({ ok: true, result: pool.result });
    expect(toolCalls()).toEqual([{ kind: 'tools/call', name: 'notion-create-pages' }]);
    expect(pool.acquires[0]?.credential?.accessToken).toBe('maws-owned-token');
    expect(await documents.store.connectorGrants(artifactId)).toEqual([]);
    expect(await cache.resolveSource(input.directory, input.server)).toEqual({ ok: false, why: 'unobserved' });
  });

  it('locates and sends overlapping user HTTP deliveries without treating another reader as a settings change', async () => {
    writeFileSync(join(config, '.claude.json'), JSON.stringify({ mcpServers: {
      one: { type: 'http', url: 'https://mcp.notion.com/mcp' },
      two: { type: 'http', url: 'https://mcp.notion.com/mcp' },
    } }));
    calls = build({ deliverySources: configured() });
    const [first, second] = await Promise.all([located(), located()]);
    expect(first.map((s) => s.server)).toEqual(['one', 'two']);
    expect(second).toEqual(first);
    const inputs = first.map(inputOf);
    for (const input of inputs) calls.send(input);
    expect(await Promise.all(inputs.map((input) => sendOutcome(input.operationId)))).toEqual([
      { ok: true, result: pool.result }, { ok: true, result: pool.result },
    ]);
    expect(toolCalls()).toEqual([
      { kind: 'tools/call', name: 'notion-create-pages' }, { kind: 'tools/call', name: 'notion-create-pages' },
    ]);
  });

  it('rejects a removed app entry before writing and never exposes it through page resolution', async () => {
    settings([{ name: 'notion-app', type: 'http', url: 'https://mcp.notion.com/mcp' }]);
    calls = build({ deliverySources: configured() });
    const source = (await located())[0]!;
    const resolveId = nextId();
    calls.resolve({ operationId: resolveId, artifactId, directories: [source.directory], server: source.server });
    expect(await taken(resolveId)).toEqual({ kind: 'resolve', answer: { ready: false, why: 'unobserved' } });
    settings([]);
    const input = inputOf(source);
    calls.send(input);
    expect(await sendOutcome(input.operationId)).toMatchObject({ ok: false, reason: 'source' });
    expect(pool.acquires).toEqual([]);
    expect(toolCalls()).toEqual([]);
  });

  it('does not send an entry removed while its connection initialized', async () => {
    settings([{ name: 'notion-app', type: 'http', url: 'https://mcp.notion.com/mcp' }]);
    calls = build({ deliverySources: configured() });
    const input = inputOf((await located())[0]!);
    pool.startup = deferred();
    calls.send(input);
    await vi.waitFor(() => expect(pool.acquires).toHaveLength(1));
    settings([]);
    pool.startup.resolve();
    expect(await sendOutcome(input.operationId)).toMatchObject({ ok: false, reason: 'source' });
    expect(toolCalls()).toEqual([]);
  });

  it('does not send from an old config home when the shell capture refreshes during initialization, even at the same URL', async () => {
    const text = JSON.stringify({ mcpServers: { personal: { type: 'http', url: 'https://mcp.notion.com/mcp' } } });
    writeFileSync(join(config, '.claude.json'), text);
    const refreshedHome = join(dir, 'refreshed-config');
    mkdirSync(refreshedHome);
    writeFileSync(join(refreshedHome, '.claude.json'), text);
    let capturedHome = config;
    calls = build({ deliverySources: configured(async () => ({ CLAUDE_CONFIG_DIR: capturedHome, HOME: join(dir, 'home') })) });
    const source = (await located())[0]!;
    const input = inputOf(source);
    pool.startup = deferred();
    calls.send(input);
    await vi.waitFor(() => expect(pool.acquires).toHaveLength(1));
    capturedHome = refreshedHome;
    pool.startup.resolve();
    expect(await sendOutcome(input.operationId)).toMatchObject({ ok: false, reason: 'source' });
    expect(toolCalls()).toEqual([]);
    const refreshed = (await located())[0]!;
    expect(refreshed.sourceId).not.toBe(source.sourceId);
    const retry = inputOf(refreshed);
    calls.send(retry);
    expect(await sendOutcome(retry.operationId)).toEqual({ ok: true, result: pool.result });
    expect(toolCalls()).toEqual([{ kind: 'tools/call', name: 'notion-create-pages' }]);
  });

  it('discovers configured tools with no engine and revokes a pending write when the source authority clears', async () => {
    settings([{ name: 'notion-app', type: 'http', url: 'https://mcp.notion.com/mcp' }]);
    const sources = configured();
    calls = build({ deliverySources: sources });
    const source = (await located())[0]!;
    const discoverId = nextId();
    calls.discover({ operationId: discoverId, directory: source.directory, server: source.server, sourceId: source.sourceId, generation: source.generation });
    expect(await taken(discoverId)).toMatchObject({ kind: 'discover', answer: { ok: true } });
    expect(toolCalls()).toEqual([]);
    const input = inputOf(source);
    pool.atWrite = deferred();
    calls.send(input);
    await pool.reachedWrite.promise;
    sources.clear();
    pool.atWrite.resolve();
    expect(await sendOutcome(input.operationId)).toMatchObject({ ok: false, reason: 'source' });
    expect(toolCalls()).toEqual([]);
  });
});

describe('DirectCalls.locate: the sources an owner’s delivery can use', () => {
  it('names a server whose report lists the tool, and an HTTP server on a named host though it reports no tools; never another', async () => {
    observed(launch('app-1', 'L1'), report(notion(), hosted(), other()));
    const sources = await located();
    expect(sources.map((source) => [source.server, source.transport, source.resourceUrl ?? null])).toEqual([
      ['notion', 'stdio', null],
      ['notion-hosted', 'http', 'https://mcp.notion.com/mcp'],
    ]);
    expect(sources.every((source) => source.directory === project && source.scope === 'user')).toBe(true);
    expect(pool.acquires).toEqual([]); // nothing connected
  });

  it('without hosts, only a listing names a server; an unobserved cache answers nothing', async () => {
    expect(await located()).toEqual([]);
    observed(launch('app-1', 'L1'), report(notion([{ name: 'notion-search' }]), hosted()));
    expect(await located('notion-create-pages', [])).toEqual([]);
  });

  it('finds the same configured entry in each directory an engine reported it from', async () => {
    const second = join(dir, 'second');
    mkdirSync(second);
    observed(launch('app-1', 'L1'), report(notion()));
    observed(launch('app-2', 'L2', second), report(notion()));
    expect((await located()).map((source) => source.directory).sort()).toEqual([project, second].sort());
  });

  it('a server two reports of one context disagree on is never offered', async () => {
    observed(launch('app-1', 'L1'), report(notion()));
    observed(launch('app-2', 'L2'), report());
    expect(await located()).toEqual([]);
  });

  it('verifies at most its bound of candidates, however many the cache names', async () => {
    const servers = Array.from({ length: DIRECT_LOCATE_VERIFY_MAX + 8 }, (_, i) => ({ ...notion(), name: `n${i}` }));
    observed(launch('app-1', 'L1'), report(...servers));
    const resolveSource = vi.spyOn(cache, 'resolveSource');
    await located();
    expect(resolveSource).toHaveBeenCalledTimes(DIRECT_LOCATE_VERIFY_MAX); // none of them is in the file: verified, refused
  });
});

describe('DirectCalls.send: the owner’s delivery with no grant', () => {
  beforeEach(() => observed(launch('app-1', 'L1'), report(notion())));

  it('sends once on a live listing that shows the tool, with no grant, and answers the receipt; the fence goes with the take', async () => {
    const input = await sendInput();
    calls.send(input);
    expect(await sendOutcome(input.operationId)).toEqual({ ok: true, result: pool.result });
    expect(pool.wire).toEqual([{ kind: 'tools/list' }, { kind: 'tools/call', name: 'notion-create-pages' }]);
    expect(await documents.store.connectorGrants(artifactId)).toEqual([]);
    expect(fences()).toBe(0);
  });

  it('a tool the live listing lacks, or one requiring task execution, is never called', async () => {
    pool.tools = [{ name: 'notion-search', readOnly: true }];
    const missing = await sendInput();
    calls.send(missing);
    expect(await sendOutcome(missing.operationId)).toMatchObject({ ok: false, failure: 'unavailable', reason: 'toolMissing' });
    pool.tools = [{ name: 'notion-create-pages', readOnly: false, taskRequired: true }];
    const task = await sendInput();
    calls.send(task);
    expect(await sendOutcome(task.operationId)).toMatchObject({ ok: false, failure: 'unavailable', reason: 'taskRequired' });
    expect(toolCalls()).toEqual([]);
  });

  it('the artifact’s deletion while the send waits at its write sends nothing', async () => {
    const input = await sendInput();
    pool.atWrite = deferred();
    calls.send(input);
    await pool.reachedWrite.promise;
    await documents.store.delete(artifactId);
    pool.atWrite.resolve();
    expect(await sendOutcome(input.operationId)).toMatchObject({ ok: false, failure: 'refused', refusal: 'revoked' });
    expect(toolCalls()).toEqual([]);
    expect(fences()).toBe(0);
  });

  it('the artifact’s deletion after the write keeps the receipt: the remote effect is made', async () => {
    const input = await sendInput();
    pool.afterWrite = deferred();
    calls.send(input);
    await vi.waitFor(() => expect(toolCalls()).toHaveLength(1), { interval: 1 });
    await documents.store.delete(artifactId);
    pool.afterWrite.resolve();
    expect(await sendOutcome(input.operationId)).toEqual({ ok: true, result: pool.result });
    expect(pool.aborts).toBe(0);
  });

  it('a revoke or grant of any tool on the artifact touches no delivery', async () => {
    const input = await sendInput();
    pool.atWrite = deferred();
    calls.send(input);
    await pool.reachedWrite.promise;
    await documents.store.grantConnectorTool(artifactId, { server: 'notion', tool: 'notion-create-pages', fingerprint: 'f', mode: 'once' });
    await documents.store.revokeConnectorTool(artifactId, { server: 'notion', tool: 'notion-create-pages' });
    pool.atWrite.resolve();
    expect(await sendOutcome(input.operationId)).toEqual({ ok: true, result: pool.result });
  });

  it('a cancel while the send waits at its write sends nothing, and is never announced', async () => {
    const input = await sendInput();
    pool.atWrite = deferred();
    calls.send(input);
    await pool.reachedWrite.promise;
    expect(calls.cancel(input.operationId)).toBe(true);
    pool.atWrite.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toolCalls()).toEqual([]);
    expect(completed).not.toContain(input.operationId);
  });

  it('a contradicting report while the send waits at its write sends nothing', async () => {
    const input = await sendInput();
    pool.atWrite = deferred();
    calls.send(input);
    await pool.reachedWrite.promise;
    observed(launch('app-2', 'L2'), report());
    pool.atWrite.resolve();
    expect(await sendOutcome(input.operationId)).toMatchObject({ ok: false, failure: 'unavailable', reason: 'source' });
    expect(toolCalls()).toEqual([]);
  });

  it('a credential withdrawn while the send waits at its write sends nothing; that epoch stays refused', async () => {
    const credential = { connectionId: '11111111-1111-4111-8111-111111111111', credentialEpoch: 3, accessToken: 'token-not-to-leak' };
    const input = await sendInput({ credential });
    pool.atWrite = deferred();
    calls.send(input);
    await pool.reachedWrite.promise;
    calls.withdraw(credential.connectionId, 3);
    pool.atWrite.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toolCalls()).toEqual([]);
    const again = await sendInput({ credential });
    calls.send(again);
    expect(await sendOutcome(again.operationId)).toMatchObject({ ok: false, failure: 'unavailable', reason: 'credential' });
    expect(pool.acquires).toHaveLength(1);
  });

  it('main’s going while the send waits at its write sends nothing', async () => {
    const input = await sendInput();
    pool.atWrite = deferred();
    calls.send(input);
    await pool.reachedWrite.promise;
    void calls.close();
    pool.atWrite.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toolCalls()).toEqual([]);
  });

  it('its deadline while the connection starts ends it, announced once; nothing is written later', async () => {
    const clock = new ManualClock();
    calls = build({ clock });
    const input = await sendInput();
    pool.startup = deferred();
    calls.send(input);
    await vi.waitFor(() => expect(pool.acquires).toHaveLength(1), { interval: 1 });
    clock.advance(180_000);
    expect(await sendOutcome(input.operationId)).toMatchObject({ ok: false, failure: 'unavailable', reason: 'timeout' });
    pool.startup.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pool.wire).toEqual([]);
  });

  it('a source main resolved that the cache no longer stands behind is refused before connecting', async () => {
    const input = await sendInput({ generation: 99 });
    calls.send(input);
    expect(await sendOutcome(input.operationId)).toMatchObject({ ok: false, failure: 'unavailable', reason: 'source', sourceRefusal: 'changed' });
    expect(pool.acquires).toEqual([]);
  });

  // P4-B5 review: a connection lost once the request went out (a reset fetch, a server that died handling it) may have
  // made the page: the exchange broken, never "not reached"
  it('a connection lost after the write is the transport’s, so main says it may have been made', async () => {
    const input = await sendInput();
    pool.callFailure = { ok: false, failure: 'unavailable', admitted: true, message: 'x' };
    calls.send(input);
    expect(await sendOutcome(input.operationId)).toMatchObject({ ok: false, failure: 'failed', reason: 'transport' });
    expect(toolCalls()).toHaveLength(1);
  });

  it('a failure after the write is the transport’s, never resent', async () => {
    const input = await sendInput();
    pool.callFailure = { ok: false, failure: 'failed', admitted: true, message: 'x' };
    calls.send(input);
    expect(await sendOutcome(input.operationId)).toMatchObject({ ok: false, failure: 'failed', reason: 'transport' });
    expect(toolCalls()).toHaveLength(1);
  });
});
