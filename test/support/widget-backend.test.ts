import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineSessionStatusSchema } from '../../src/shared/engine/status';
import type { AppSessionId } from '../../src/shared/graph/ids';
import { loadScenario } from './scenario';
import { createWidgetBackend, fixtureLine, RESPONSES, WidgetBackendError, WIDGET_BACKEND_COMMANDS } from './widget-backend';

const ROOT = join(__dirname, '../..');
const scenario = () => loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'), Date.parse('2026-09-29T12:00:00Z'));
const READY = 'app-7412a115' as AppSessionId; // ready, idle, routed
const backendOf = () => {
  const emitted: { name: string; payload: unknown }[] = [];
  const backend = createWidgetBackend({ root: ROOT, statuses: scenario().engine, emit: (name, payload) => void emitted.push({ name, payload }), now: () => '2026-09-29T12:00:01.000Z' });
  return { backend, emitted };
};

describe('the widget backend', () => {
  it('names a readable fixture line for every subtype it answers', () => {
    for (const line of Object.values(RESPONSES)) expect(fixtureLine(ROOT, line), line).toBeTypeOf('object');
  });

  it('answers each read from its named line, in any order and as often as asked, and logs the calls', async () => {
    const { backend } = backendOf();
    const status = await backend.answer('session.getStatus', { appSessionId: READY });
    const context = await backend.answer('session.getContextUsage', { appSessionId: READY, detail: 'full' });
    expect(await backend.answer('session.getStatus', { appSessionId: READY })).toEqual(status);
    expect(status).toEqual(fixtureLine(ROOT, 'pass2/auto-routed#145'));
    expect(context).toMatchObject({ totalTokens: 30433, maxTokens: 200000, percentage: 15 });
    expect(backend.calls.map((c) => [c.command, c.subtype])).toEqual([
      ['session.getStatus', 'get_status'],
      ['session.getContextUsage', 'get_context_usage'],
      ['session.getStatus', 'get_status'],
    ]);
    expect(backend.calls[1].input).toEqual({ appSessionId: READY, detail: 'full' });
  });

  it("answers a ready session's status in C3's shape with the init facts, and the catalogue", async () => {
    const { backend } = backendOf();
    const status = EngineSessionStatusSchema.parse(await backend.answer('session.status', { appSessionId: READY }));
    expect(status.process).toBe('ready');
    expect(status.plugins).toHaveLength(11);
    expect(status.mcpServers.map((s) => s.name)).toEqual(['plugin:ptc:ptc', 'plugin:chatgpt-advisor:advisor', 'openaiDeveloperDocs']);
    expect(status.fastMode).toEqual({ state: 'off', disabledReason: 'sdk_opt_in_required' });
    const catalog = (await backend.answer('session.catalog', { appSessionId: READY })) as { skills: string[]; agents: unknown[]; commands: unknown[] };
    expect(catalog.skills).toHaveLength(18);
    expect(catalog.commands.length).toBeGreaterThan(0);
  });

  it('refuses a session it does not hold and a read on a session without a ready process', async () => {
    const { backend } = backendOf();
    const exited = scenario().engine.find((s) => s.process !== 'ready');
    await expect(backend.answer('session.getStatus', { appSessionId: 'nobody' })).rejects.toBeInstanceOf(WidgetBackendError);
    if (exited) await expect(backend.answer('session.getStatus', { appSessionId: exited.appSessionId })).rejects.toBeInstanceOf(WidgetBackendError);
  });

  it('lets a script override one command until it is removed', async () => {
    const { backend } = backendOf();
    const off = backend.script('session.getUsage', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'get_usage unanswered after 8 s' });
    });
    await expect(backend.answer('session.getUsage', { appSessionId: READY })).rejects.toMatchObject({ error: { code: 'timeout' } });
    off();
    await expect(backend.answer('session.getUsage', { appSessionId: READY })).resolves.toMatchObject({ rate_limits_available: false });
  });

  it('emits statuses in C3 shape and refuses a patch that breaks it', () => {
    const { backend, emitted } = backendOf();
    const next = backend.emitStatus(READY, { engineState: 'running' });
    expect(emitted.at(-1)).toEqual({ name: 'session.status', payload: { appSessionId: READY, status: next } });
    expect(() => backend.emitStatus(READY, { engineState: 'busy' } as never)).toThrow();
    expect(backend.status(READY).engineState).toBe('running');
  });

  it("mints each new turn's id in C3's EventId form and clears the local-lane observation", () => {
    const { backend } = backendOf();
    const first = backend.emitTurnStarted(READY);
    backend.emitStatus(READY, { gateway: { ...backend.status(READY).gateway, localLane: { observedInTurn: first, at: '2026-09-29T12:00:02.000Z' } } });
    const second = backend.emitTurnStarted(READY);
    expect(first).toBe('app-7412a115:scenario:1:0');
    expect(second).toBe('app-7412a115:scenario:2:0');
    expect(backend.status(READY).turn?.id).toBe(second);
    expect(backend.status(READY).gateway.localLane).toBeNull();
  });

  it('serves a bridge whose invoke answers in the X2 envelope and whose listeners hear the emits', async () => {
    const { backend } = backendOf();
    const bridge = backend.bridge();
    const heard: unknown[] = [];
    const off = bridge.on('session.operation', (event) => heard.push(event));
    expect(await bridge.invoke('session.getSandboxDialog', { appSessionId: READY })).toMatchObject({ ok: true, value: { mode: 'disabled', supported: true } });
    expect(await bridge.invoke('session.getStatus', { appSessionId: 'nobody' })).toEqual({ ok: false, error: { code: 'internal', message: 'unknown app session: nobody' } });
    expect(await bridge.invoke('session.send', { appSessionId: READY, content: 'x' })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    const event = { appSessionId: READY, opId: 'op-1', command: 'session.reloadPlugins' as const, late: false, outcome: { ok: true as const, value: {} } };
    backend.emitOperation(event);
    off();
    backend.emitOperation(event);
    expect(heard).toEqual([event]);
    expect(WIDGET_BACKEND_COMMANDS).toContain('session.mcpStatus');
  });
});
