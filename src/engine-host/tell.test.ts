// The direct tell's engine half against the shipped mod's own probe (spikes/protocol-probe/fixtures/uxwave/
// uxwave-tell-builtin-*.jsonl, Claude Code 2.1.331, the scripted API stand-in): each case's engine answers the host's
// checked mcp_call with the error it recorded, and the host reads it. The fixtures also record what reached the agent:
// the next request of a running background child and of a child its parent waits on carried the text, a finished child
// was resumed with it, a stopped child was not, and plan mode refused the call (so the window keeps the relay there).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import type { StdinFrame } from '@shared/wire/frames';
import { CHECKED_CALL_CAPABILITY, TELL_LINE, TELL_MOD, TELL_TOOL, tellPresent } from '@shared/maws/tell';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import { SessionStatusTracker } from './session-status';
import { ControlClient, ControlError } from './rpc';
import type { EngineTransport } from './transport';
import { tellAgent } from './tell';

const REPO_ROOT = resolve(__dirname, '../..');
type Row = { seq: number; direction: string; frame: Record<string, unknown> };
const rowsOf = (name: string): Row[] =>
  readFileSync(join(REPO_ROOT, 'spikes/protocol-probe/fixtures/uxwave', `uxwave-tell-builtin-${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
const metaOf = (rows: Row[], event: string) => rows.filter((r) => r.direction === 'meta' && r.frame.event === event).map((r) => r.frame);
type Envelope = { subtype: string; request_id: string; response?: unknown; error?: string };

// The case's recorded call and the engine's recorded answer to it.
function recorded(name: string) {
  const rows = rowsOf(name);
  const at = rows.findIndex((r) => r.direction === 'out' && (r.frame.request as { subtype?: string } | undefined)?.subtype === 'mcp_call');
  const request = rows[at]!.frame as { request_id: string; request: Record<string, unknown> };
  const answer = rows.find((r) => r.direction === 'in' && r.frame.type === 'control_response' && (r.frame.response as Envelope).request_id === request.request_id)!.frame.response as Envelope;
  return { rows, request: request.request, answer };
}

// A transport whose engine answers every control request with the recorded envelope under the minted id.
function engine(envelope: Envelope) {
  const writes: StdinFrame[] = [];
  const transport: EngineTransport = {
    pid: null,
    frames: (async function* () {})(),
    stderr: (async function* () {})(),
    write: (frame) => {
      writes.push(frame);
      if (frame.type === 'control_request') queueMicrotask(() => client.observe({ type: 'control_response', response: { ...envelope, request_id: frame.request_id } }));
      return Promise.resolve();
    },
    endInput: () => {},
    kill: () => {},
    exited: new Promise(() => {}),
  };
  const rows: JournalRow[] = [];
  const client = new ControlClient(transport, { row: (direction, frame) => { const row = { seq: rows.length + 1, direction, at: '', frame }; rows.push(row); return row; } }, 'L', { warn: () => {} });
  return { client, writes };
}

const tellAs = async (name: string) => {
  const { rows, request, answer } = recorded(name);
  const { client, writes } = engine(answer);
  const agent = (request.arguments as { agent: string }).agent;
  const outcome = await tellAgent(client, agent, 'also list the folder').catch((error: unknown) => error);
  return { rows, request, outcome, written: (writes[0] as { request: Record<string, unknown> }).request };
};

describe('the direct tell, as the shipped mod answered it', () => {
  it('writes the checked mcp_call the probe made, the text led by the line that says who wrote it', async () => {
    const { request, written } = await tellAs('live-bg');
    expect(written.tool).toBe(TELL_TOOL);
    expect(written).toMatchObject({ subtype: 'mcp_call', tool: request.tool, check_permissions: true, arguments: { agent: (request.arguments as { agent: string }).agent } });
    expect((written.arguments as { text: string }).text).toBe(`${TELL_LINE}\nalso list the folder`);
  });

  it('a running background child: delivered, and its next request carried the text', async () => {
    const { rows, outcome } = await tellAs('live-bg');
    expect(outcome).toEqual({ delivered: true });
    expect(metaOf(rows, 'child_told')[0]!.value).toBe(true);
  });

  it('a child its parent waits on: delivered, and its next request carried the text', async () => {
    const { rows, outcome } = await tellAs('waited');
    expect(outcome).toEqual({ delivered: true });
    expect(rows.filter((r) => r.frame.subtype === 'task_started').map((r) => r.frame.is_backgrounded)).toEqual([false]);
    expect(metaOf(rows, 'child_told')[0]!.value).toBe(true);
  });

  it('a finished child: delivered, and it was resumed with the text', async () => {
    const { rows, outcome } = await tellAs('ended');
    expect(outcome).toEqual({ delivered: true });
    expect(rows.filter((r) => r.frame.subtype === 'task_started')).toHaveLength(2);
    expect(metaOf(rows, 'resumed_with_text')[0]!.value).toBe(true);
  });

  it('a stopped child: refused with the engine\'s reason', async () => {
    const { outcome } = await tellAs('stopped');
    expect(outcome).toEqual({ delivered: false, reason: expect.stringMatching(/^Agent "\w+" was stopped and was not resumed\./) });
  });

  it('dontAsk mode: delivered, the mod allowing the host\'s own call', async () => {
    const { rows, outcome } = await tellAs('dontask');
    expect(outcome).toEqual({ delivered: true });
    expect(metaOf(rows, 'permission_asked')).toEqual([]);
  });

  it('plan mode: the engine refuses the call, which is thrown as it came, and nothing reached the child', async () => {
    const { rows, outcome } = await tellAs('plan');
    expect(outcome).toBeInstanceOf(ControlError);
    expect((outcome as ControlError).message).toMatch(/requires interactive approval, and permission prompts are not available/);
    expect(metaOf(rows, 'resumed_with_text')[0]!.value).toBe(false);
  });
});

describe('what the host vouches for', () => {
  it('sends nothing to a string that is not an agent\'s id, which the engine\'s send would read as a name or an address', async () => {
    const { client, writes } = engine({ subtype: 'success', request_id: '' , response: { content: 'delivered' } });
    expect(await tellAgent(client, 'worker', 'hi')).toEqual({ delivered: false, reason: 'worker is not the id of an agent of this session' });
    expect(await tellAgent(client, 'session_01abc', 'hi')).toMatchObject({ delivered: false });
    expect(writes).toEqual([]);
    expect(await tellAgent(client, 'ascout-bcbb17e39be8c1bd', 'hi')).toEqual({ delivered: true }); // a named agent's id
  });

  it('reads a plain success only as the mod\'s own word for a delivery', async () => {
    expect(await tellAgent(engine({ subtype: 'success', request_id: '', response: { content: [{ type: 'text', text: 'delivered' }] } }).client, 'a0123456789abcdef', 'hi')).toEqual({ delivered: true });
    await expect(tellAgent(engine({ subtype: 'success', request_id: '', response: { content: 'something else' } }).client, 'a0123456789abcdef', 'hi')).rejects.toThrow("the tell's answer was not the mod's");
  });
});

describe('whether a session took the mod', () => {
  const spec = LaunchSpecSchema.parse({
    appSessionId: 'app-tell', cwd: '/tmp/r', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null,
  });
  const initOf = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row).find((r) => r.frame.type === 'system' && r.frame.subtype === 'init')!.frame;
  const tracked = (path: string) => {
    const tracker = new SessionStatusTracker(spec, () => {});
    tracker.observe(initOf(path), '2026-11-24T00:00:00.000Z');
    return tracker.snapshot();
  };

  it('says the mod\'s server as `tell`, and lists neither it nor its plugin as the person\'s', () => {
    const withMod = tracked('spikes/protocol-probe/fixtures/uxwave/uxwave-tell-builtin-live-bg.jsonl');
    expect(withMod.tell).toBe(true);
    expect(tellPresent(withMod)).toBe(true);
    expect(withMod.mcpServers.map((s) => s.name)).not.toContain(TELL_MOD);
    expect(withMod.plugins.map((p) => p.name)).not.toContain(TELL_MOD);
    expect(withMod.plugins.length).toBeGreaterThan(0); // the engine's own plugins stay
  });

  it('is absent where the engine took no mod, and once its server is listed failed', () => {
    const without = tracked('spikes/protocol-probe/fixtures/init.jsonl');
    expect(without.tell).toBeUndefined();
    expect(tellPresent(without)).toBe(false);
    const tracker = new SessionStatusTracker(spec, () => {});
    tracker.applyMcpStatus({ mcpServers: [{ name: TELL_MOD, status: 'connected', source: 'plugin' }] }, tracker.askMcp());
    expect(tracker.snapshot().tell).toBeUndefined(); // no checked mcp_call offered yet: an engine can serve mods with it off
    tracker.observe({ type: 'system', subtype: 'init', capabilities: [CHECKED_CALL_CAPABILITY] }, '2026-11-24T00:00:00.000Z');
    expect(tracker.snapshot().tell).toBe(true);
    tracker.observe({ type: 'system', subtype: 'init', capabilities: ['ui_surface_v1'], mcp_servers: [{ name: TELL_MOD, status: 'connected', source: 'plugin' }] }, '2026-11-24T00:00:01.000Z');
    expect(tracker.snapshot().tell).toBeUndefined();
    tracker.observe({ type: 'system', subtype: 'init', capabilities: [CHECKED_CALL_CAPABILITY], mcp_servers: [{ name: TELL_MOD, status: 'connected', source: 'plugin' }] }, '2026-11-24T00:00:02.000Z');
    expect(tracker.snapshot().tell).toBe(true);
    expect(tracker.applyMcpStatus({ mcpServers: [{ name: TELL_MOD, status: 'failed', source: 'plugin' }] }, tracker.askMcp())).toBe(true);
    expect(tracker.snapshot().tell).toBeUndefined();
    expect(tracker.snapshot().mcpServers).toEqual([]);
    expect(tellPresent(null)).toBe(false);
  });
});
