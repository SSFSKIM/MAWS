// The direct tell through the engine host as the app runs it, over the replay transport the e2e stub engine plays too:
// the shipped mod's probe of a running background child, derived for a replay
// (spikes/protocol-probe/uxwave-tell-replay.mjs → fixtures/uxwave/uxwave-tell-builtin-replay.jsonl). A launch, the
// person's first message, the status saying `tell` once system/init lists the mod's server, and `session.tellAgent`
// writing the call the fixture holds for, answered delivered.
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import { type CommandInput, type CommandName, type CommandOutput } from '@shared/ipc/schema';
import { validateCommandOutput } from '@shared/ipc/validate';
import { registerEngineIpc } from './ipc';
import { TESTED_ENGINE_VERSION } from './engine-compat';

const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURE = 'spikes/protocol-probe/fixtures/uxwave/uxwave-tell-builtin-replay.jsonl';
type Row = { direction: string; frame: Record<string, unknown> };
const rows = (): Row[] => readFileSync(join(REPO_ROOT, FIXTURE), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Row);
const AGENT = (rows().find((r) => r.frame.subtype === 'task_started')!.frame.task_id as string) as AgentId;

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-tell-replay-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true, maxRetries: 10 });
});

const spec = (appSessionId: string): LaunchSpec =>
  LaunchSpecSchema.parse({
    appSessionId, cwd: '/tmp/maws-tell-replay', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'direct', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: FIXTURE, inheritGrantsFrom: null,
  });

function engineHost() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = () => true;
  const binaryProbe = async () => ({ path: '/x/claude', testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null });
  const ipc = registerEngineIpc(on, emit, { userData, replayEnabled: true, cwd: REPO_ROOT, binaryProbe });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input);
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  return { ipc, call };
}

async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('the direct tell, replayed through the engine host', () => {
  it('is the probe derived as the script derives it', async () => {
    const { deriveTellReplay, SOURCE } = (await import(pathToFileURL(join(REPO_ROOT, 'spikes/protocol-probe/uxwave-tell-replay.mjs')).href)) as { deriveTellReplay: (text: string) => string; SOURCE: string };
    expect(readFileSync(join(REPO_ROOT, FIXTURE), 'utf8')).toBe(deriveTellReplay(readFileSync(SOURCE, 'utf8')));
  });

  it('says `tell` once the mod is listed, and delivers the text to the running child', async () => {
    const host = engineHost();
    const app = 'app-tell-replay' as AppSessionId;
    await host.call('session.launch', { spec: spec(app) });
    await until(() => host.ipc.table.get(app)?.lifecycle === 'ready', 'ready');
    await host.call('session.send', { appSessionId: app, content: 'Start the child.' });
    await until(() => host.ipc.table.get(app)?.status().tell === true, 'the status says tell');
    expect((await host.call('session.status', { appSessionId: app })).mcpServers.map((s) => s.name)).not.toContain('maws-tell');
    expect(await host.call('session.tellAgent', { appSessionId: app, agentId: AGENT, text: 'Also list the folder' })).toEqual({ delivered: true });
    await host.call('session.stop', { appSessionId: app, reason: 'stop' });
  });
});
