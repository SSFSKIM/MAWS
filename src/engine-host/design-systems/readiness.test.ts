// Readiness at the product boundaries, over a fresh real store: host readiness must not expose a partially seeded
// design-system library, and an asset read must not hold sessions or other host operations behind it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SYSTEMS } from '@artifacts/types/design_system/defaults';
import type { DefaultAsset } from '@artifacts/types/design_system/default-assets';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { hostPing, type HostOn } from '@shared/host/runtime';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { openDocuments, type Documents } from '../documents';
import { registerDocumentKind } from '../documents/kinds/document';
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
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const FONT: DefaultAsset = { name: 'face.woff2', mime: 'font/woff2', bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32]) };
const titles = DEFAULT_SYSTEMS.map((source) => source.name).sort();
let dir: string;
let documents: Documents;
let systems: DesignSystems | undefined;
let engine: EngineIpc | undefined;
let cleanups: (() => void)[];
let logs: string[];
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-seed-readiness-'));
  documents = openDocuments(dir, () => {})!;
  systems = undefined;
  engine = undefined;
  cleanups = [];
  logs = [];
  handlers = new Map();
  const kind = registerDocumentKind(documents.store);
  const artifacts = registerArtifacts(on, () => true, { onDocPort: () => {} }, { documents, env: {} });
  cleanups.push(() => kind.close(), () => artifacts.close());
  registerLibraryReads(on, documents);
});
afterEach(async () => {
  await engine?.shutdown(0);
  systems?.close();
  cleanups.forEach((close) => close());
  documents.close();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

function start(loadAssets: (key: string) => Promise<DefaultAsset[]> = async () => []) {
  systems = registerDesignSystems({ on, documents, loadAssets, log: (line) => { logs.push(line); } });
  return systems;
}
async function call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid ${name} input`);
  const output = validateCommandOutput(name, await handlers.get(name)!(checked.value));
  if (!output.ok) throw new Error(`invalid ${name} output: ${JSON.stringify(output.error.issues)}`);
  return output.value as CommandOutput<N>;
}
let calls = 0;
function toolCall(name: string, args: Record<string, unknown>) {
  const tools = mawsTools({ artifacts: () => documents.store, bridge: {} as never, capture: {} as never, asks: {} as never, askCancelled: () => {} });
  const ctx: McpToolContext = { appSessionId: 'app-seed' as AppSessionId, cwd: dir, toolUseId: `toolu_${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false };
  return tools.find((tool) => tool.name === name)!.call(args, ctx);
}

// Removing any boundary's seed wait makes its answer appear while the bundled asset read is still held.
describe('design-system seed readiness', () => {
  it('holds early IPC reads, creates and agent artifact calls through defaults and assets, but not unrelated host work', async () => {
    const assets = deferred<DefaultAsset[]>();
    const loading = deferred<void>();
    start(async (key) => {
      if (key !== 'official') return [];
      loading.resolve();
      return assets.promise;
    });
    const answered: string[] = [];
    const tracked = <T>(name: string, promise: Promise<T>) => promise.then((value) => { answered.push(name); return value; });
    const listing = tracked('list', call('artifacts.list', { filter: { kind: 'design_system' } }));
    const house = tracked('house', call('designSystems.house', undefined));
    const creating = tracked('create', call('artifacts.create', { kind: 'document', title: 'Early' }));
    const snapshot = tracked('snapshot', call('library.snapshot', undefined));
    const agentList = tracked('agent list', toolCall('artifact_list', { kind: 'design_system', scope: 'all' }));
    const describe = tracked('agent describe', toolCall('artifact_describe_type', { kind: 'document' }));
    const agentCreate = tracked('agent create', toolCall('artifact_create', { kind: 'document', handle: 'agent-note', title: 'Agent', content: '# Agent' }));
    await loading.promise;
    const official = documents.store.list({ kind: 'design_system' }).find((a) => a.title === 'Official')!;
    const entry = tracked('entry', call('library.entry', { artifactId: official.id }));
    const text = tracked('text', call('library.text', { artifactId: official.id }));
    const governing = tracked('governing', call('designSystems.governing', { artifactId: official.id }));
    const binding = tracked('binding', call('artifacts.create', { kind: 'document', title: 'Official letter', designSystemId: official.id }));
    const agentAssets = tracked('agent assets', toolCall('artifact_list_assets', { artifact: official.id }));
    try {
      // These are the real session handlers. No process is launched and no engine/network probe is needed.
      engine = registerEngineIpc(on, () => true, { userData: dir, replayEnabled: false, artifacts: () => documents.store, log: () => {} });
      on('engine.ping', async () => hostPing('test'));
      expect(await call('engine.ping', undefined)).toMatchObject({ hostVersion: 'test' });
      expect(await call('engine.sessions', undefined)).toEqual([]);
      await expect(call('session.status', { appSessionId: 'app-absent' as AppSessionId })).rejects.toThrow('unknown session');
      expect(await call('spaces.list', undefined)).toEqual({ spaces: [] });
      expect(await call('artifacts.status', undefined)).toEqual({ status: 'ok', reason: null });
      await turn();
      expect(answered).toEqual([]);
    } finally {
      assets.resolve([FONT]);
      await systems!.seeded;
    }
    expect((await listing).artifacts.map((a) => a.title).sort()).toEqual(titles);
    const houseId = (await house).houseId!;
    expect(houseId).toBeTruthy();
    expect((await snapshot).artifacts.filter((a) => a.kind === 'design_system').map((a) => a.title).sort()).toEqual(titles);
    expect(await entry).toMatchObject({ artifact: { id: official.id, builtIn: true, seedOnly: true } });
    expect((await text).text.length).toBeGreaterThan(0);
    expect(await governing).toEqual({ system: { id: houseId } });
    expect((await binding).artifact.designSystemId).toBe(official.id);
    expect(await call('designSystems.governing', { artifactId: (await creating).artifact.id })).toEqual({ system: { id: houseId } });
    expect(jsonOf<{ artifacts: { title: string }[] }>(await agentList).artifacts.map((a) => a.title).sort()).toEqual(titles);
    expect(jsonOf<{ designSystem: string }>(await describe).designSystem).toContain(houseId);
    expect(jsonOf<{ designSystem: string }>(await agentCreate).designSystem).toContain(houseId);
    expect(jsonOf(await agentAssets)).toMatchObject({ assets: [expect.objectContaining({ name: FONT.name })] });
    expect(logs.filter((line) => /failed|timed out/.test(line))).toEqual([]);
  });

  it('opens on a failed seed, logs it once and answers later calls without retrying or delaying them', async () => {
    documents.storage.setMeta(SEEDING_KEY, 'invalid JSON');
    start();
    const listing = call('artifacts.list', {});
    const house = call('designSystems.house', undefined);
    const agent = toolCall('artifact_list', { scope: 'all' });
    expect(await listing).toEqual({ artifacts: [] });
    expect(await house).toEqual({ houseId: null });
    expect(jsonOf(await agent)).toMatchObject({ artifacts: [] });
    await expect(systems!.seeded).resolves.toBeUndefined();
    expect(logs).toEqual([expect.stringContaining('seeding the built-in design systems failed')]);
    expect(await call('artifacts.create', { kind: 'document', title: 'Still usable' })).toMatchObject({ artifact: { title: 'Still usable' } });
    await call('designSystems.house', undefined);
    await toolCall('artifact_describe_type', { kind: 'document' });
    expect(logs).toHaveLength(1);
  });

  it('shares one timeout across callers, composes the import wait in parallel and never restarts the seed wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const assets = deferred<DefaultAsset[]>();
    const loading = deferred<void>();
    start(async (key) => {
      if (key !== 'official') return [];
      loading.resolve();
      return assets.promise;
    });
    await loading.promise;
    const imported = deferred<void>();
    holdForImport(documents.store, imported.promise);
    registerLibraryReads(on, documents, { afterImport: (store) => importSettledWithin(store, 8_000) });
    let listed = false;
    let reconciled = false;
    const listing = call('artifacts.list', {}).then((result) => { listed = true; return result; });
    const snapshot = call('library.snapshot', undefined).then((result) => { reconciled = true; return result; });
    const agent = toolCall('artifact_list', { kind: 'design_system', scope: 'all' });
    try {
      await vi.advanceTimersByTimeAsync(4_000);
      expect(listed).toBe(false);
      expect(reconciled).toBe(false);
      const late = call('designSystems.house', undefined);
      await vi.advanceTimersByTimeAsync(4_000);
      await turn();
      expect(listed).toBe(true);
      expect(reconciled).toBe(true); // sequential waits would take 16 s and overrun IPC
      expect((await listing).artifacts.map((a) => a.title).sort()).toEqual(titles);
      expect((await snapshot).artifacts.map((a) => a.title).sort()).toEqual(titles);
      expect((await late).houseId).toBeTruthy();
      expect(logs.filter((line) => line.includes('timed out'))).toHaveLength(1);
      // With the seed still stuck, later callers answer without advancing time again.
      expect((await call('artifacts.list', {})).artifacts).toHaveLength(DEFAULT_SYSTEMS.length);
      expect((await call('artifacts.create', { kind: 'document', title: 'After timeout' })).artifact.title).toBe('After timeout');
      imported.resolve();
      expect(jsonOf<{ artifacts: unknown[] }>(await agent).artifacts).toHaveLength(DEFAULT_SYSTEMS.length);
      await toolCall('artifact_describe_type', { kind: 'document' });
      expect(logs.filter((line) => line.includes('timed out'))).toHaveLength(1);
      // Force a real late seed rejection when it next updates its record: the timeout already logged this run.
      documents.storage.setMeta(SEEDING_KEY, 'invalid JSON');
    } finally {
      imported.resolve();
      assets.resolve([]);
      await systems!.seeded;
    }
    expect(logs.filter((line) => /failed|timed out/.test(line))).toHaveLength(1);
  });

  it('adds no fixed delay or asset reads on a fully seeded reopen, and no timers per subsequent read', async () => {
    start();
    await systems!.seeded;
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
    const timers = vi.getTimerCount();
    expect(timers).toBe(0);
    expect(await call('designSystems.house', undefined)).toEqual(first);
    expect(await call('designSystems.house', undefined)).toEqual(first);
    expect(vi.getTimerCount()).toBe(timers);
    console.info(`Ready-store registration + first house read: ${firstReadMs.toFixed(3)} ms; fixed delay 0 ms; asset loads ${assetLoads}`);
  });
});
