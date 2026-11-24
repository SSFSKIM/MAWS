// The built-in mod as written (mods/maws-tell; the charter's Decision Log, 2026-11-24): its hooks registered against a
// recording `on`, each answered as the engine would ask it. What the engine does with the answers is the probe's
// (src/engine-host/tell.test.ts, spikes/protocol-probe/fixtures/uxwave/uxwave-tell-builtin-*.jsonl).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { TELL_AGENT_ID, TELL_MOD, TELL_REFUSED, TELL_TOOL } from '@shared/maws/tell';
import { tellModDir } from './launch';

const MOD = resolve(__dirname, '../../mods/maws-tell');
type Hook = (...args: unknown[]) => unknown;
interface Registered { event: string; matcher: Record<string, unknown> | null; hook: Hook }

async function hooks(): Promise<Registered[]> {
  const registered: Registered[] = [];
  const module = (await import(pathToFileURL(join(MOD, 'hooks/register.mjs')).href)) as { register: (on: (...args: unknown[]) => void) => void };
  module.register((event: unknown, a: unknown, b?: unknown) => {
    registered.push(b === undefined ? { event: event as string, matcher: null, hook: a as Hook } : { event: event as string, matcher: a as Record<string, unknown>, hook: b as Hook });
  });
  return registered;
}
const hookOf = (all: Registered[], event: string) => all.find((h) => h.event === event)!;
const HOST_ID = 'toolu_mcp_call_0123456789abcdef';
const GOOD = 'a0123456789abcdef';
const GONE = 'afedcba9876543210';

describe('the maws-tell mod', () => {
  it('checks an agent id by the shape the app checks it by', () => {
    expect(readFileSync(join(MOD, 'hooks/register.mjs'), 'utf8')).toContain(`const AGENT_ID = ${TELL_AGENT_ID.toString()};`);
  });

  it('is the plugin the app names, its hooks module declared', () => {
    expect(JSON.parse(readFileSync(join(MOD, '.claude-plugin/plugin.json'), 'utf8')).name).toBe(TELL_MOD);
    expect(JSON.parse(readFileSync(join(MOD, 'hooks/hooks.json'), 'utf8'))).toEqual({ modules: ['./register.mjs'] });
    expect(tellModDir(join(resolve(__dirname, '../..'), 'out/main/engine-host.js'))).toBe(MOD); // a checkout's
  });

  it('registers its tool at the session\'s start, after the engine\'s own start', async () => {
    const start = hookOf(await hooks(), 'session.start');
    const order: string[] = [];
    const register = vi.fn(async () => { order.push('register'); return { tool: TELL_TOOL }; });
    await start.hook({ tool: { register }, ui: { log: vi.fn() } }, {}, async () => { order.push('next'); return {}; });
    expect(order).toEqual(['next', 'register']);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'tell', inputSchema: expect.objectContaining({ required: ['agent', 'text'] }) }));
  });

  it('offers the tool to no model', async () => {
    const offer = hookOf(await hooks(), 'tool.offer');
    expect(offer.matcher).toEqual({ tool: TELL_TOOL });
    expect(offer.hook({}, { tool: TELL_TOOL, for: 'list' })).toEqual({ isOffered: false });
  });

  it('allows the host\'s own call at tool.check and leaves any other to the engine', async () => {
    const check = hookOf(await hooks(), 'tool.check');
    expect(check.matcher).toEqual({ tool: TELL_TOOL });
    const next = vi.fn(() => ({ decision: 'ask' }));
    expect(check.hook({}, { tool: TELL_TOOL, tool_use_id: HOST_ID }, next)).toMatchObject({ decision: 'allow' });
    expect(check.hook({}, { tool: TELL_TOOL, tool_use_id: 'toolu_01model' }, next)).toEqual({ decision: 'ask' });
  });

  it('sends the host\'s call with the engine\'s send, refuses another\'s, and marks a refusal', async () => {
    const run = hookOf(await hooks(), 'tool.run');
    const send = vi.fn(async ({ to }: { to: { agentId: string } }) => (to.agentId === GOOD ? { isDelivered: true } : { isDelivered: false, reason: 'was stopped' }));
    const $ = { session: { send } };
    expect(await run.hook($, { tool: TELL_TOOL, tool_use_id: HOST_ID, agent: GOOD, text: 'hello' })).toEqual({ result: 'delivered' });
    expect(send).toHaveBeenCalledWith({ to: { agentId: GOOD }, text: 'hello' });
    expect(await run.hook($, { tool: TELL_TOOL, tool_use_id: HOST_ID, agent: GONE, text: 'hello' })).toEqual({ deny: `${TELL_REFUSED}was stopped` });
    expect(await run.hook($, { tool: TELL_TOOL, tool_use_id: 'toolu_01model', agent: GOOD, text: 'hello' })).toEqual({ deny: expect.stringMatching(/^TELL_NOT_HOST /) });
    expect(await run.hook($, { tool: TELL_TOOL, tool_use_id: HOST_ID, agent: '', text: 'hello' })).toEqual({ deny: expect.stringMatching(/^TELL_REFUSED /) });
    expect(await run.hook($, { tool: TELL_TOOL, tool_use_id: HOST_ID, agent: 'worker', text: 'hello' })).toEqual({ deny: expect.stringMatching(/^TELL_REFUSED /) }); // a name, which the send could resolve to another session
    expect(send).toHaveBeenCalledTimes(2);
  });
});
