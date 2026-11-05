// C10's engine-host commands (C10 execution document, X2 additions): `engine.models` over the catalogue cache and
// `session.forget`, the whole erase behind delete conversation.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import { HostCommandError, type HostEmit, type HostOn } from '@shared/host/runtime';
import { type CommandInput, type CommandName, type CommandOutput, type EventName } from '@shared/ipc/schema';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { registerEngineIpc, type EngineIpcDeps } from './ipc';
import { TESTED_ENGINE_VERSION } from './engine-compat'; // W13
import { RELAY_URL } from './launch'; // P5 O7 M9
import { FileSessionStateStore } from './store/file-session-state-store';
import { ProcessTable } from './process-table'; // P5 O16 panel fix wave 1 follow-up

const REPO_ROOT = resolve(__dirname, '../..');

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-ipc-c10-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true, maxRetries: 10 });
});

const spec = (appSessionId: string, replay: string, gateway: 'gateway' | 'direct' = 'gateway'): LaunchSpec =>
  LaunchSpecSchema.parse({
    appSessionId, cwd: '/tmp/maws-ipc-c10', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway, subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay, inheritGrantsFrom: null,
  });

function engineHost(deps: Partial<EngineIpcDeps> = {}) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const emitted: { name: EventName; payload: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}`);
    emitted.push({ name, payload });
    return true;
  };
  // W13: the binary the catalogue is keyed by answers the tested version, as the replays were recorded on it
  const binaryProbe = async () => ({ path: '/x/claude', testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null });
  const ipc = registerEngineIpc(on, emit, { userData, replayEnabled: true, cwd: REPO_ROOT, binaryProbe, ...deps });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input);
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  return { handlers, emitted, ipc, call };
}

async function until(check: () => boolean, what: string, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('engine.models', () => {
  it('answers builtin with no cache, cached after an initialize response was observed, live after refresh against a ready session', async () => {
    const host = engineHost();
    expect(await host.call('engine.models', { refresh: false })).toMatchObject({ source: 'builtin', at: null });
    expect(await host.call('engine.models', { refresh: true })).toMatchObject({ source: 'builtin' }); // nothing ready to ask

    const reads = 'app-models-reads' as AppSessionId;
    await host.call('session.launch', { spec: spec(reads, 'spikes/protocol-probe/fixtures/reads.jsonl') });
    await until(() => host.ipc.table.get(reads)?.lifecycle === 'ready', 'ready');
    const cached = await host.call('engine.models', { refresh: false });
    expect(cached.source).toBe('cached');
    expect(cached.models.map((m) => m.value)).toContain('claude/astra'); // the routed launch's aliases arrive with its initialize
    await host.call('session.stop', { appSessionId: reads, reason: 'stop' });

    const live = 'app-models-live' as AppSessionId;
    await host.call('session.launch', { spec: spec(live, 'test/fixtures/engine/list-models.jsonl') });
    await until(() => host.ipc.table.get(live)?.lifecycle === 'ready', 'ready');
    const answered = await host.call('engine.models', { refresh: true });
    expect(answered.source).toBe('live');
    expect(answered.models.map((m) => m.value)).toContain('claude/sol');
    expect((await host.call('engine.models', { refresh: false })).source).toBe('cached'); // the live answer is the cache now
    await host.ipc.table.shutdown({ graceMs: 0 });
  });

  it('keys the catalogue by route: a Direct launch and a relay launch do not overwrite each other, and a restart keeps both (debt wave 3)', async () => {
    const host = engineHost();
    const direct = 'app-models-direct' as AppSessionId;
    await host.call('session.launch', { spec: spec(direct, 'spikes/protocol-probe/fixtures/pass2/auto-unrouted.jsonl', 'direct') });
    await until(() => host.ipc.table.get(direct)?.lifecycle === 'ready', 'ready');
    const relay = 'app-models-relay' as AppSessionId;
    await host.call('session.launch', { spec: spec(relay, 'spikes/protocol-probe/fixtures/reads.jsonl') });
    await until(() => host.ipc.table.get(relay)?.lifecycle === 'ready', 'ready');
    const values = async (input: { refresh: boolean; gateway?: 'gateway' | 'direct' }) => (await host.call('engine.models', input)).models.map((m) => m.value);
    for (let i = 0; i < 100 && !(await values({ refresh: false, gateway: 'direct' })).includes('claude-fable-5-1[1m]'); i++) await new Promise((r) => setTimeout(r, 5));
    expect(await values({ refresh: false, gateway: 'direct' })).toContain('claude-fable-5-1[1m]');
    expect(await values({ refresh: false, gateway: 'direct' })).not.toContain('claude/astra');
    expect(await values({ refresh: false, gateway: 'gateway' })).toContain('claude/astra');
    expect(await values({ refresh: false })).toContain('claude/astra'); // no route named: the newest, the relay launch's
    await host.ipc.table.shutdown({ graceMs: 0 });

    const restarted = engineHost();
    expect(await restarted.call('engine.models', { refresh: false, gateway: 'direct' })).toMatchObject({ source: 'cached', models: expect.arrayContaining([expect.objectContaining({ value: 'claude-fable-5-1[1m]' })]) as unknown });
  });

  it("keys a launch whose project settings set model env apart from its route, and answers it to a reader naming that directory (debt wave 5)", async () => {
    const host = engineHost({ captureEnv: () => Promise.resolve({}) });
    const plain = join(userData, 'plain');
    const home = join(userData, 'home');
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1m]' } }));
    const values = async (input: { refresh: boolean; gateway?: 'gateway' | 'direct'; cwd?: string }) => (await host.call('engine.models', input)).models.map((m) => m.value);

    const routed = 'app-models-routed' as AppSessionId;
    await host.call('session.launch', { spec: { ...spec(routed, 'spikes/protocol-probe/fixtures/reads.jsonl'), cwd: plain } });
    await until(() => host.ipc.table.get(routed)?.lifecycle === 'ready', 'ready');
    for (let i = 0; i < 100 && !(await values({ refresh: false, gateway: 'gateway' })).includes('claude/astra'); i++) await new Promise((r) => setTimeout(r, 5));
    expect(await values({ refresh: false, gateway: 'gateway', cwd: home })).toContain('claude/astra'); // before the home's own list: its route's

    const atHome = 'app-models-home' as AppSessionId;
    await host.call('session.launch', { spec: { ...spec(atHome, 'spikes/protocol-probe/fixtures/pass2/auto-unrouted.jsonl'), cwd: home } });
    await until(() => host.ipc.table.get(atHome)?.lifecycle === 'ready', 'ready');
    for (let i = 0; i < 100 && (await values({ refresh: false, gateway: 'gateway', cwd: home })).includes('claude/astra'); i++) await new Promise((r) => setTimeout(r, 5));
    expect(await values({ refresh: false, gateway: 'gateway', cwd: home })).toEqual(['default', 'opus', 'claude-fable-5-1[1m]', 'sonnet', 'haiku']);
    expect(await values({ refresh: false, gateway: 'gateway' })).toContain('claude/astra'); // the route's list was not overwritten
    expect(await values({ refresh: false, gateway: 'gateway', cwd: plain })).toContain('claude/astra');
    await host.ipc.table.shutdown({ graceMs: 0 });
  });
});

// P5 O7 M9 (reviewer-high fix wave): the machine route's catalogue is the one its resolved base URL reaches: the
// relay's for the relay, the direct one for a login or another host; and no gateway model while it cannot be resolved,
// as the start guard refuses one anywhere but at the relay
describe('engine.models on the machine route', () => {
  it('answers the catalogue the machine reaches, and no gateway list while that is unknown', async () => {
    const home = join(userData, 'home');
    const work = join(userData, 'work');
    await mkdir(join(home, '.claude'), { recursive: true });
    await mkdir(join(work, '.claude'), { recursive: true });
    const host = engineHost({ captureEnv: () => Promise.resolve({ HOME: home }), systemRoot: join(userData, 'system') });
    const values = async () => (await host.call('engine.models', { refresh: false, route: 'machine', cwd: work })).models.map((m) => m.value);
    const userBaseUrl = (value: string) => writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: value } }));

    const relay = 'app-models-machine-relay' as AppSessionId;
    await host.call('session.launch', { spec: { ...spec(relay, 'spikes/protocol-probe/fixtures/reads.jsonl'), cwd: work } });
    await until(() => host.ipc.table.get(relay)?.lifecycle === 'ready', 'ready');
    await userBaseUrl(RELAY_URL);
    for (let i = 0; i < 100 && !(await values()).includes('claude/astra'); i++) await new Promise((r) => setTimeout(r, 5));
    expect(await values()).toContain('claude/astra'); // the relay: the gateway catalogue
    await userBaseUrl('https://inference.example.invalid');
    expect((await values()).filter((value) => value.startsWith('claude/'))).toEqual([]); // another host: none of the gateway's
    await writeFile(join(home, '.claude', 'settings.json'), '{}');
    expect((await values()).filter((value) => value.startsWith('claude/'))).toEqual([]); // the login
    await userBaseUrl(RELAY_URL);
    await writeFile(join(work, '.claude', 'settings.json'), '{ not json'); // what the engine makes of it is unknown
    expect((await values()).filter((value) => value.startsWith('claude/'))).toEqual([]);
    await host.ipc.table.shutdown({ graceMs: 0 });
  });
});

describe('session.forget', () => {
  it('removes the state file and the journal directory, emits session.forgotten, and refuses already_live', async () => {
    const host = engineHost();
    const id = 'app-forget' as AppSessionId;
    await host.call('session.launch', { spec: spec(id, 'spikes/protocol-probe/fixtures/reads.jsonl') });
    await until(() => host.ipc.table.get(id)?.lifecycle === 'ready', 'ready');
    await expect(host.handlers.get('session.forget')!({ appSessionId: id })).rejects.toEqual(new HostCommandError({ code: 'internal', message: 'already_live: process is ready' }));

    await host.call('session.stop', { appSessionId: id, reason: 'stop' });
    const state = join(userData, 'engine-host', 'state', `${id}.json`);
    const journal = join(userData, 'engine-host', 'journal', id);
    await until(() => existsSync(state), 'the state file');
    expect(existsSync(journal)).toBe(true);
    await host.call('session.forget', { appSessionId: id });
    expect(existsSync(state)).toBe(false);
    expect(existsSync(journal)).toBe(false);
    expect(host.emitted.filter((e) => e.name === 'session.forgotten').map((e) => e.payload)).toEqual([{ appSessionId: id }]);
    expect(host.ipc.table.get(id)).toBeUndefined(); // the host keeps nothing of a forgotten session
    await expect(host.handlers.get('session.status')!({ appSessionId: id })).rejects.toEqual(new HostCommandError({ code: 'internal', message: `unknown session ${id}` }));

    await host.call('session.forget', { appSessionId: 'app-never-launched' }); // nothing to erase is not an error
    await expect(host.handlers.get('session.forget')!({ appSessionId: '../escape' })).rejects.toBeInstanceOf(HostCommandError);
  });

  // P5 O16 panel fix wave 1 follow-up (the architect's ruling): an unattached session host (its adoption failed, or a
  // newer host of its session was adopted) runs its engine with no row. A launch of its id stops it first, so no second
  // engine ever runs the session; a forget stops it, then forgets, and tells `session.forgotten`.
  function unattached(id: AppSessionId, seen: () => string | null = () => null) {
    const alive = { now: true };
    const order: string[] = [];
    const table = new ProcessTable({ ps: async () => '', log: () => {}, isAlive: (pid) => pid === 4242 && alive.now, procStartOf: () => 'then' });
    table.onRowsChanged(() => void (table.get(id) && order.push('reserved')));
    table.unattach(id, { holderId: 'Lunattached', host: { pid: 4242, procStart: 'then' }, child: () => null, stop: async () => {
      order.push(`stopping (row ${table.get(id) ? 'present' : 'absent'})`);
      const what = seen();
      if (what !== null) order.push(what);
      await new Promise((r) => setTimeout(r, 20));
      alive.now = false;
      order.push('stopped');
      return 'stopped';
    } });
    return { table, order };
  }

  // wave 1 verification: a stop not done (the old host still waits for its spawn; its process cannot be verified) keeps
  // the record and its guard: the launch and the forget are refused `already_live`, saying why, and nothing is erased
  for (const [outcome, why] of [['incomplete', 'still starting'], ['unverified', 'could not be verified']] as const) {
    it(`a launch and a forget of an unattached session whose stop is ${outcome} are refused already_live, nothing launched or erased`, async () => {
      const id = `app-unattached-${outcome}` as AppSessionId;
      const table = new ProcessTable({ ps: async () => '', log: () => {}, isAlive: (pid) => pid === 4242, procStartOf: () => 'then' });
      table.unattach(id, { holderId: 'Lunattached', host: { pid: 4242, procStart: 'then' }, child: () => null, stop: async () => outcome });
      const host = engineHost({ table });
      const launched = await host.call('session.launch', { spec: spec(id, 'spikes/protocol-probe/fixtures/reads.jsonl') });
      expect(launched).toMatchObject({ status: 'refused', reason: 'already_live', message: expect.stringContaining(why) });
      expect(table.get(id)).toBeUndefined();
      const journal = join(userData, 'engine-host', 'journal', id);
      await mkdir(journal, { recursive: true });
      await expect(host.handlers.get('session.forget')!({ appSessionId: id })).rejects.toThrow(new RegExp(`^already_live: .*${why}`));
      expect(existsSync(journal)).toBe(true);
      expect(host.emitted.filter((e) => e.name === 'session.forgotten')).toEqual([]);
    });
  }

  it('a launch of an unattached session stops its host first, then launches', async () => {
    const id = 'app-unattached-launch' as AppSessionId;
    const { table, order } = unattached(id);
    const host = engineHost({ table });
    await host.call('session.launch', { spec: spec(id, 'spikes/protocol-probe/fixtures/reads.jsonl') });
    expect(order).toEqual(['stopping (row absent)', 'stopped', 'reserved']);
    await until(() => table.get(id)?.lifecycle === 'ready', 'ready');
    await table.shutdown({ graceMs: 0 });
  });

  it('a forget of an unattached session stops its host, then erases it and tells session.forgotten', async () => {
    const id = 'app-unattached-forget' as AppSessionId;
    const state = join(userData, 'engine-host', 'state', `${id}.json`);
    const journal = join(userData, 'engine-host', 'journal', id);
    const { table, order } = unattached(id, () => `files ${existsSync(state) && existsSync(journal) ? 'kept' : 'erased'}`);
    const host = engineHost({ table });
    await new FileSessionStateStore(userData).saveLaunchSpec(id, spec(id, 'spikes/protocol-probe/fixtures/reads.jsonl'));
    await mkdir(journal, { recursive: true });
    await host.call('session.forget', { appSessionId: id });
    expect(order).toEqual(['stopping (row absent)', 'files kept', 'stopped']);
    expect([existsSync(state), existsSync(journal)]).toEqual([false, false]);
    expect(host.emitted.filter((e) => e.name === 'session.forgotten').map((e) => e.payload)).toEqual([{ appSessionId: id }]);
    expect(table.unattachedHosts(id)).toEqual([]);
  });

  // P5 O16 panel fix wave 1 (scalpel-1#3): a session held for adoption has no row until its adoption reserves one, while
  // the adopter reads its stored spec and resumes its journal; its forget is refused as a live process's is, erasing nothing
  it('refuses already_live for a session held for adoption, its state file and journal kept', async () => {
    const host = engineHost();
    const id = 'app-forget-held' as AppSessionId;
    const state = join(userData, 'engine-host', 'state', `${id}.json`);
    const journal = join(userData, 'engine-host', 'journal', id);
    await new FileSessionStateStore(userData).saveLaunchSpec(id, spec(id, 'spikes/protocol-probe/fixtures/reads.jsonl'));
    await mkdir(journal, { recursive: true });
    await writeFile(join(journal, 'launch-1.jsonl'), '');
    host.ipc.table.holdForAdoption([id]);
    await expect(host.handlers.get('session.forget')!({ appSessionId: id })).rejects.toEqual(new HostCommandError({ code: 'internal', message: 'already_live: process is being adopted' }));
    expect([existsSync(state), existsSync(journal)]).toEqual([true, true]);
    expect(host.emitted.filter((e) => e.name === 'session.forgotten')).toEqual([]);
    host.ipc.table.adoptionEnded(id); // a failed adoption's hold released: the forget goes ahead
    await host.call('session.forget', { appSessionId: id });
    expect([existsSync(state), existsSync(journal)]).toEqual([false, false]);
  });

  it("forgotten as soon as the process reads exited (the bootstrap's release on process.exited), the exit's queue save still lands first: no state file comes back", async () => {
    const inner = new FileSessionStateStore(userData);
    let release!: () => void;
    let held: Promise<void> | null = null;
    const saves: string[] = [];
    // the exit's queue save is held, as a slow disk would hold it; everything else goes straight through
    const store: EngineIpcDeps['store'] = Object.assign(Object.create(inner) as FileSessionStateStore, {
      saveQueue: async (id: AppSessionId, queue: Parameters<FileSessionStateStore['saveQueue']>[1]) => {
        if (held) await held;
        saves.push(id);
        return inner.saveQueue(id, queue);
      },
    });
    const host = engineHost({ store });
    const id = 'app-forget-race' as AppSessionId;
    await host.call('session.launch', { spec: spec(id, 'spikes/protocol-probe/fixtures/reads.jsonl') });
    await until(() => host.ipc.table.get(id)?.lifecycle === 'ready', 'ready');
    held = new Promise((resolve) => (release = resolve));
    const stopping = host.handlers.get('session.stop')!({ appSessionId: id, reason: 'stop' });
    await until(() => host.ipc.table.get(id)?.status().process === 'exited', 'the exit'); // set synchronously at the exit row
    const forgetting = host.handlers.get('session.forget')!({ appSessionId: id });
    await new Promise((r) => setTimeout(r, 20));
    release();
    await Promise.all([forgetting, stopping]);
    await inner.loadGrants(id); // the store's chain for the id has drained
    expect(saves).toContain(id); // the exit did save the queue
    expect(existsSync(join(userData, 'engine-host', 'state', `${id}.json`))).toBe(false);
    expect(host.emitted.filter((e) => e.name === 'session.forgotten').map((e) => e.payload)).toEqual([{ appSessionId: id }]);
  });

  // After the exit's wait: a row released meanwhile (a second forget, C3's archive release) is not a relaunch; only a
  // different row under the id is.
  async function heldAtExit(id: AppSessionId) {
    const inner = new FileSessionStateStore(userData);
    let release!: () => void;
    let held: Promise<void> | null = null;
    const store: EngineIpcDeps['store'] = Object.assign(Object.create(inner) as FileSessionStateStore, {
      saveQueue: async (appId: AppSessionId, queue: Parameters<FileSessionStateStore['saveQueue']>[1]) => {
        if (held) await held;
        return inner.saveQueue(appId, queue);
      },
    });
    const host = engineHost({ store });
    await host.call('session.launch', { spec: spec(id, 'spikes/protocol-probe/fixtures/reads.jsonl') });
    await until(() => host.ipc.table.get(id)?.lifecycle === 'ready', 'ready');
    held = new Promise((resolve) => (release = resolve));
    const stopping = host.handlers.get('session.stop')!({ appSessionId: id, reason: 'stop' });
    await until(() => host.ipc.table.get(id)?.status().process === 'exited', 'the exit');
    return { host, stopping, release: () => release() };
  }

  it('succeeds for a row released while it waited on the exit (two concurrent forgets)', async () => {
    const id = 'app-forget-twice' as AppSessionId;
    const { host, stopping, release } = await heldAtExit(id);
    const first = host.handlers.get('session.forget')!({ appSessionId: id });
    const second = host.handlers.get('session.forget')!({ appSessionId: id });
    await new Promise((r) => setTimeout(r, 20));
    release();
    await expect(Promise.all([first, second, stopping])).resolves.toBeDefined();
    expect(host.ipc.table.get(id)).toBeUndefined();
    expect(existsSync(join(userData, 'engine-host', 'state', `${id}.json`))).toBe(false);
  });

  it('refuses already_live when another process took the id while it waited on the exit', async () => {
    const id = 'app-forget-relaunched' as AppSessionId;
    const { host, stopping, release } = await heldAtExit(id);
    const forgetting = host.handlers.get('session.forget')!({ appSessionId: id });
    const refused = expect(forgetting).rejects.toEqual(new HostCommandError({ code: 'internal', message: `already_live: ${id} was relaunched` }));
    host.ipc.table.release(id);
    await host.call('session.launch', { spec: spec(id, 'spikes/protocol-probe/fixtures/reads.jsonl') });
    release();
    await refused;
    await stopping;
    expect(host.ipc.table.get(id)).toBeDefined(); // the relaunched row is untouched
    await host.ipc.table.shutdown({ graceMs: 0 });
  });
});
