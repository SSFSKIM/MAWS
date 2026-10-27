// Startup readiness through the actual host ingress, over a real store. Main multiplexes renderer windows on one
// served port; queued requests must keep that order and cannot outlive the connection that submitted them.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDataset } from '@artifacts/dashboard/datasets';
import { DEFAULT_SYSTEMS } from '@artifacts/types/design_system/defaults';
import type { DefaultAsset } from '@artifacts/types/design_system/default-assets';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { createHostRuntime, hostPing, HostCommandError, type HostOn, type HostPort, type HostRuntime } from '@shared/host/runtime';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { registerDashboards } from '../dashboards';
import { openDocuments, type Documents } from '../documents';
import { registerDocumentKind } from '../documents/kinds/document';
import { ASSET_HOLD_LIMITS } from '../documents/retention';
import { registerArtifacts } from '../documents/register';
import { registerEngineIpc, type EngineIpc } from '../ipc';
import { holdForImport, importSettledWithin } from '../library/import-gate';
import { registerLibraryReads } from '../library/register';
import { jsonOf } from '../tool-server/artifact-world.fixture';
import type { McpToolContext } from '../tool-server/server';
import { mawsTools } from '../tool-server/tools';
import { registerDesignSystems, type DesignSystems } from '.';
import { SEEDING_KEY } from './seed';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const FONT: DefaultAsset = { name: 'face.woff2', mime: 'font/woff2', bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32]) };
const titles = DEFAULT_SYSTEMS.map((source) => source.name).sort();
let dir: string;
let documents: Documents;
let systems: DesignSystems | undefined;
let engine: EngineIpc | undefined;
let runtime: HostRuntime | undefined;
let cleanups: (() => void)[];
let logs: string[];
let launches: number;
let serial = 0;

// A main connection: every request traverses runtime input/output validation and the real registered handler.
function connection(host: HostRuntime) {
  let deliver!: (event: { data: unknown }) => void;
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>();
  const responses: unknown[] = [];
  const port: HostPort = {
    start: () => {},
    on: (_, listener) => { deliver = listener; },
    postMessage: (message) => {
      const res = message as { t: string; id: string; ok: boolean; value: unknown; error: ConstructorParameters<typeof HostCommandError>[0] };
      if (res.t !== 'res') return;
      responses.push(res);
      const waiter = pending.get(res.id)!;
      pending.delete(res.id);
      if (res.ok) waiter.resolve(res.value);
      else waiter.reject(new HostCommandError(res.error));
    },
  };
  host.serve(port);
  host.setReady();
  return {
    responses,
    call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
      const id = `seed-${++serial}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        deliver({ data: { t: 'req', id, name, input } });
      });
    },
  };
}
let client: ReturnType<typeof connection>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-seed-readiness-'));
  documents = openDocuments(dir, () => {})!;
  systems = undefined;
  engine = undefined;
  runtime = undefined;
  cleanups = [];
  logs = [];
  launches = 0;
  const kind = registerDocumentKind(documents.store);
  const dashboards = registerDashboards({ documents });
  cleanups.push(() => kind.close(), () => dashboards.close());
});
afterEach(async () => {
  runtime?.detach();
  await engine?.shutdown(0);
  systems?.close();
  cleanups.forEach((close) => close());
  documents.close();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

function start(loadAssets: (key: string) => Promise<DefaultAsset[]> = async () => [], imported?: Promise<void>) {
  if (imported) holdForImport(documents.store, imported);
  runtime = createHostRuntime((on, emit, hooks) => {
    const artifacts = registerArtifacts(on, emit, hooks, { documents, env: {} });
    cleanups.push(() => artifacts.close());
    registerLibraryReads(on, documents, { afterImport: (store) => importSettledWithin(store, 8_000) });
    systems = registerDesignSystems({ on, documents, loadAssets, log: (line) => { logs.push(line); } });
    const observed: HostOn = (name, handler) => on(name, async (input, ctx) => {
      if (name === 'session.launch') launches++;
      return handler(input, ctx);
    });
    engine = registerEngineIpc(observed, emit, { userData: dir, replayEnabled: false, artifacts: () => documents.store, log: () => {} });
    on('engine.ping', async () => hostPing('test'));
    return systems.ready;
  });
  client = connection(runtime);
}
const call = <N extends CommandName>(name: N, input: CommandInput<N>) => client.call(name, input);
function toolCall(name: string, args: Record<string, unknown>) {
  const tools = mawsTools({ artifacts: () => documents.store, bridge: {} as never, capture: {} as never, asks: {} as never, askCancelled: () => {} });
  const ctx: McpToolContext = { appSessionId: 'app-seed' as AppSessionId, cwd: dir, toolUseId: `toolu_${++serial}` as ToolUseId, requestId: `r${serial}` as RequestId, signal: new AbortController().signal, fromSubagent: false };
  return tools.find((tool) => tool.name === name)!.call(args, ctx);
}
function delayedSeed(imported?: Promise<void>) {
  const assets = deferred<DefaultAsset[]>();
  const loading = deferred<void>();
  start(async (key) => {
    if (key !== 'official') return [];
    loading.resolve();
    return assets.promise;
  }, imported);
  return { assets, loading };
}

async function snapshot(artifactId: string): Promise<string> {
  const at = Date.now();
  const source = ++serial;
  let ref = '';
  await documents.store.writeWithAssets(artifactId, { kind: 'human' }, [{ bytes: new TextEncoder().encode(`[{"v":${source}}]`), name: `query-00000000-0000-4000-8000-${String(source).padStart(12, '0')}.json`, mime: 'application/json', querySnapshot: true }], (doc, refs) => {
    ref = refs[0]!.ref;
    setDataset(doc, 'live', { title: 'live', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at, by: { kind: 'human' } }, state: { status: 'ok', at } });
  }, { inFrame: (revision) => documents.store.retainQuerySnapshots(artifactId, 'live', ref, revision) });
  return ref;
}

describe('design-system startup admission', () => {
  it('holds early reads, creates, ping and real session launch until defaults and bundled assets finish', async () => {
    const { assets, loading } = delayedSeed();
    const answered: string[] = [];
    const tracked = <T>(name: string, promise: Promise<T>) => promise.then((value) => { answered.push(name); return value; });
    const listing = tracked('list', call('artifacts.list', { filter: { kind: 'design_system' } }));
    const house = tracked('house', call('designSystems.house', undefined));
    const creating = tracked('create', call('artifacts.create', { kind: 'document', title: 'Early' }));
    const library = tracked('library', call('library.snapshot', undefined));
    const ping = tracked('ping', call('engine.ping', undefined));
    const launch = tracked('launch', call('session.launch', { spec: LaunchSpecSchema.parse({ appSessionId: 'app-seed', cwd: dir, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'direct', subagentModel: null, resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: 'unused-fixture' }) }));
    await loading.promise;
    const official = documents.store.list({ kind: 'design_system' }).find((a) => a.title === 'Official')!;
    const entry = tracked('entry', call('library.entry', { artifactId: official.id }));
    const text = tracked('text', call('library.text', { artifactId: official.id }));
    const governing = tracked('governing', call('designSystems.governing', { artifactId: official.id }));
    try {
      await turn();
      expect(answered).toEqual([]);
      expect(launches).toBe(0);
    } finally {
      assets.resolve([FONT]);
      await systems!.seeded;
    }
    expect((await listing).artifacts.map((a) => a.title).sort()).toEqual(titles);
    const houseId = (await house).houseId!;
    expect((await library).artifacts.filter((a) => a.kind === 'design_system').map((a) => a.title).sort()).toEqual(titles);
    expect(await entry).toMatchObject({ artifact: { id: official.id, builtIn: true, seedOnly: true } });
    expect((await text).text.length).toBeGreaterThan(0);
    expect(await governing).toEqual({ system: { id: houseId } });
    expect((await creating).artifact.title).toBe('Early');
    expect(await ping).toMatchObject({ hostVersion: 'test' });
    expect(await launch).toMatchObject({ status: 'refused', reason: 'replay_disabled' }); // real launch handler, no process
    expect(launches).toBe(1);
    expect(jsonOf<{ designSystem: string }>(await toolCall('artifact_describe_type', { kind: 'document' })).designSystem).toContain(houseId);
    expect(jsonOf<{ artifacts: { title: string }[] }>(await toolCall('artifact_list', { kind: 'design_system', scope: 'all' })).artifacts.map((a) => a.title).sort()).toEqual(titles);
    expect(jsonOf<{ designSystem: string }>(await toolCall('artifact_create', { kind: 'document', handle: 'agent-note', title: 'Agent', content: '# Agent' })).designSystem).toContain(houseId);
    expect(jsonOf(await toolCall('artifact_list_assets', { artifact: official.id }))).toMatchObject({ assets: [expect.objectContaining({ name: FONT.name })] });
  });

  it('admits multiplexed windows’ pending create then delete in arrival order, preserving the dependency refusal', async () => {
    const { assets, loading } = delayedSeed();
    await loading.promise;
    const system = documents.store.list({ kind: 'design_system' }).find((a) => a.title === 'Official')!;
    const creating = call('artifacts.create', { kind: 'document', title: 'Governed', designSystemId: system.id });
    const dropping = call('artifacts.delete', { artifactId: system.id });
    const outcomes = Promise.allSettled([creating, dropping]);
    try {
      await turn();
      expect(documents.store.list({ kind: 'document' })).toEqual([]);
      expect(documents.store.get(system.id)).not.toBeNull();
    } finally { assets.resolve([]); await systems!.seeded; await outcomes; }
    const [created, dropped] = await outcomes;
    expect(created).toMatchObject({ status: 'fulfilled', value: { artifact: { designSystemId: system.id } } });
    expect(dropped).toMatchObject({ status: 'rejected', reason: { ipcError: { issues: { reason: 'designSystemInUse' } } } });
    // Once the hold is gone, ingress must not introduce even one microtask before a create's write admission.
    const again = call('artifacts.create', { kind: 'document', title: 'Next', designSystemId: system.id });
    const synchronous = documents.storage.batchOpen;
    const deleted = call('artifacts.delete', { artifactId: system.id });
    const settled = await Promise.allSettled([again, deleted]);
    expect(synchronous).toBe(true);
    expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  });

  it('drops disconnected queued hold/capture requests without spending snapshot budget; a new connection holds and releases normally', async () => {
    const board = await documents.store.create({ kind: 'dashboard', title: 'Board' }, { kind: 'human' });
    const old = await snapshot(board.id);
    const { assets, loading } = delayedSeed();
    await loading.promise;
    const vanished = client;
    void vanished.call('artifacts.holdAssets', { artifactId: board.id, refs: [old] }).catch(() => {});
    void vanished.call('artifacts.captureDatasetState', { artifactId: board.id }).catch(() => {});
    runtime!.detach();
    client = connection(runtime!);
    const fresh = Array.from({ length: ASSET_HOLD_LIMITS.groups }, (_, index) => index === 0
      ? call('artifacts.captureDatasetState', { artifactId: board.id })
      : call('artifacts.holdAssets', { artifactId: board.id, refs: [old] }));
    try {
      await turn();
      expect(vanished.responses).toEqual([]);
    } finally { assets.resolve([]); await systems!.seeded; }
    const held = await Promise.all(fresh);
    expect(vanished.responses).toEqual([]);
    expect(held).toHaveLength(ASSET_HOLD_LIMITS.groups); // all capacity belongs to the surviving caller
    await snapshot(board.id);
    await snapshot(board.id);
    documents.store.collectRetiredAssets(board.id);
    expect(documents.store.listAssets(board.id).some((a) => a.ref === old)).toBe(true);
    for (const { assetHoldId } of held) expect(await call('artifacts.releaseAssets', { assetHoldId })).toEqual({ released: true });
    expect(documents.store.listAssets(board.id).some((a) => a.ref === old)).toBe(false);
  });

  it('opens on failure, logs once and does not retry or delay subsequent requests', async () => {
    documents.storage.setMeta(SEEDING_KEY, 'invalid JSON');
    start();
    expect(await call('artifacts.list', {})).toEqual({ artifacts: [] });
    expect(await call('designSystems.house', undefined)).toEqual({ houseId: null });
    await expect(systems!.seeded).resolves.toBeUndefined();
    expect(logs).toEqual([expect.stringContaining('seeding the built-in design systems failed')]);
    expect(await call('artifacts.create', { kind: 'document', title: 'Usable' })).toMatchObject({ artifact: { title: 'Usable' } });
    await call('engine.ping', undefined);
    expect(logs).toHaveLength(1);
  });

  it('shares one 8s timeout without stacking an import wait, restarting for late callers or logging a late failure again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const imported = deferred<void>();
    const { assets, loading } = delayedSeed(imported.promise);
    await loading.promise;
    let listed = false;
    let reconciled = false;
    const listing = call('artifacts.list', {}).then((value) => { listed = true; return value; });
    const library = call('library.snapshot', undefined).then((value) => { reconciled = true; return value; });
    try {
      await vi.advanceTimersByTimeAsync(4_000);
      expect(listed).toBe(false);
      expect(reconciled).toBe(false);
      const late = call('engine.ping', undefined);
      await vi.advanceTimersByTimeAsync(4_000);
      await turn();
      expect(listed).toBe(true);
      expect(reconciled).toBe(true);
      expect((await listing).artifacts).toHaveLength(DEFAULT_SYSTEMS.length);
      expect((await library).artifacts).toHaveLength(DEFAULT_SYSTEMS.length);
      expect(await late).toMatchObject({ hostVersion: 'test' });
      expect((await call('artifacts.create', { kind: 'document', title: 'After timeout' })).artifact.title).toBe('After timeout');
      expect(logs.filter((line) => line.includes('timed out'))).toHaveLength(1);
      documents.storage.setMeta(SEEDING_KEY, 'invalid JSON'); // the eventual seed rejection must not log again
    } finally { imported.resolve(); assets.resolve([]); await systems!.seeded; }
    expect(logs.filter((line) => /failed|timed out/.test(line))).toHaveLength(1);
  });

  it('adds no fixed delay or asset reads on a ready-store reopen and no timers per subsequent request', async () => {
    start();
    await systems!.seeded;
    runtime!.detach();
    await engine!.shutdown(0);
    systems!.close();
    cleanups.forEach((close) => close());
    cleanups = [];
    documents.close();
    documents = openDocuments(dir, () => {})!;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let assetLoads = 0;
    const began = performance.now();
    start(async () => { assetLoads++; return []; });
    const first = await call('designSystems.house', undefined); // no fake clock advance
    const firstReadMs = performance.now() - began;
    expect(first.houseId).toBeTruthy();
    expect(assetLoads).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(await call('designSystems.house', undefined)).toEqual(first);
    expect(await call('engine.ping', undefined)).toMatchObject({ hostVersion: 'test' });
    expect(vi.getTimerCount()).toBe(0);
    console.info(`Ready-store registration + first ingress house read: ${firstReadMs.toFixed(3)} ms; fixed delay 0 ms; asset loads ${assetLoads}`);
  });
});
