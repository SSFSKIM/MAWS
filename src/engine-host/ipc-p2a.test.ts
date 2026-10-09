// P2-A's engine-host read (X17, the P2 interface ledger §1): `engine.observedFacts` answers a row's recorder while the
// host holds it and the file once it does not, so the facts survive the exited row's eviction and a host restart;
// `session.forget` removes the file and an archive keeps it; the read is bounded.
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import { commands, type CommandInput, type CommandName, type CommandOutput } from '@shared/ipc/schema';
import { MAIN_ONLY_COMMANDS } from '@shared/ipc/names';
import { validateCommandOutput } from '@shared/ipc/validate';
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { P2A_DEADLINE_SHAPES, registerEngineIpc, type EngineIpcDeps } from './ipc';
import { ProcessTable } from './process-table';
import { observedFactsPath } from './store/observed-facts-store';

const REPO_ROOT = resolve(__dirname, '../..');
const READS = 'spikes/protocol-probe/fixtures/reads.jsonl'; // a turn with its system/init, then get_usage and get_context_usage

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-ipc-p2a-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true, maxRetries: 10 });
});

const spec = (appSessionId: string, replay: string): LaunchSpec =>
  LaunchSpecSchema.parse({
    appSessionId, cwd: '/tmp/maws-ipc-p2a', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay, inheritGrantsFrom: null,
  });

function engineHost(deps: Partial<EngineIpcDeps> = {}) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = () => true;
  const binaryProbe = async () => ({ path: '/x/claude', testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null });
  const ipc = registerEngineIpc(on, emit, { userData, replayEnabled: true, cwd: REPO_ROOT, binaryProbe, ...deps });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input);
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  return { handlers, ipc, call };
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

// The reads fixture's turn, then its two reads in the recorded order: the turn's system/init and the context answer.
async function runOnce(host: ReturnType<typeof engineHost>, id: AppSessionId, reason: 'stop' | 'archive' = 'stop'): Promise<void> {
  await host.call('session.launch', { spec: spec(id, READS) });
  await until(() => host.ipc.table.get(id)?.lifecycle === 'ready', 'ready');
  await host.call('session.send', { appSessionId: id, content: 'Reply with exactly OK' });
  await until(() => host.ipc.table.get(id)!.status().turn === null && host.ipc.table.get(id)!.status().pluginsObservedAt !== null, 'the turn');
  await host.call('session.getUsage', { appSessionId: id });
  await host.call('session.getContextUsage', { appSessionId: id, detail: 'summary' });
  const session = host.ipc.table.get(id)!;
  await host.call('session.stop', { appSessionId: id, reason });
  await session.exited;
}

describe('engine.observedFacts', () => {
  it('is an engine-host command main alone calls, bounded', () => {
    expect(commands['engine.observedFacts'].owner).toBe('engine-host');
    expect(MAIN_ONLY_COMMANDS).toContain('engine.observedFacts');
    expect(P2A_DEADLINE_SHAPES).toEqual({ 'engine.observedFacts': 'bounded' });
    expect(engineHost().handlers.has('engine.observedFacts')).toBe(true);
  });

  it('answers null for a session MAWS never ran, writing nothing', async () => {
    const host = engineHost();
    expect(await host.call('engine.observedFacts', { appSessionId: 'app-never' })).toBeNull();
    expect(existsSync(observedFactsPath(userData, 'app-never' as AppSessionId))).toBe(false);
  });

  it('answers a live session from its recorder, and the facts survive the exited row’s eviction and a host restart', async () => {
    const host = engineHost({ table: new ProcessTable({ exitedRowsMax: 1 }) });
    const first = 'app-facts-a' as AppSessionId;
    await runOnce(host, first);
    const live = (await host.call('engine.observedFacts', { appSessionId: first }))!;
    expect(live).toMatchObject({ model: { value: 'claude-haiku-4-5-20251001' }, engineVersion: { value: '2.1.283' }, mode: { value: 'default' }, outputStyle: { value: 'default' }, complete: true });
    expect(live.contextUsage?.value.maxTokens).toBeGreaterThan(0);
    expect(live.launches).toEqual([host.ipc.table.get(first)!.status().launchId]); // listed at the exit
    expect(live.plugins?.value.plugins.length).toBeGreaterThan(0);

    await runOnce(host, 'app-facts-b' as AppSessionId); // its exit pushes the first exited row out of the table
    expect(host.ipc.table.get(first)).toBeUndefined();
    const facts = { ...live, writtenAt: expect.any(String) }; // the live answer is stamped when answered, the file when written
    expect(await host.call('engine.observedFacts', { appSessionId: first })).toEqual(facts);

    const restarted = engineHost(); // a new host over the same userData
    expect(await restarted.call('engine.observedFacts', { appSessionId: first })).toEqual(facts);
  });

  it('session.forget removes the file; an archive keeps it', async () => {
    const host = engineHost();
    const archived = 'app-facts-archived' as AppSessionId;
    await runOnce(host, archived, 'archive');
    await until(() => host.ipc.table.get(archived) === undefined, 'the archive’s release');
    expect((await host.call('engine.observedFacts', { appSessionId: archived }))?.model?.value).toBe('claude-haiku-4-5-20251001');

    const forgotten = 'app-facts-forgotten' as AppSessionId;
    await runOnce(host, forgotten);
    expect(existsSync(observedFactsPath(userData, forgotten))).toBe(true);
    await host.call('session.forget', { appSessionId: forgotten });
    expect(existsSync(observedFactsPath(userData, forgotten))).toBe(false);
    expect(await host.call('engine.observedFacts', { appSessionId: forgotten })).toBeNull();
  });
});
