import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EngineSessionStatusSchema } from '../../src/shared/engine/status';
import type { AppSessionId } from '../../src/shared/graph/ids';
import { loadScenario } from './scenario';
import { createWidgetBackend, fixtureLine, RESPONSES, syntheticFixture, WidgetBackendError, WIDGET_BACKEND_COMMANDS } from './widget-backend';

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
    expect(await bridge.invoke('session.bash', { appSessionId: READY, command: 'ls' })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    const event = { appSessionId: READY, opId: 'op-1', command: 'session.reloadPlugins' as const, late: false, outcome: { ok: true as const, value: {} } };
    backend.emitOperation(event);
    off();
    backend.emitOperation(event);
    expect(heard).toEqual([event]);
    expect(WIDGET_BACKEND_COMMANDS).toContain('session.mcpStatus');
  });

  // M3: the controls and the operations
  it("moves the status as C3's host does after an accepted control, and answers C3's result values", async () => {
    const { backend, emitted } = backendOf();
    expect(await backend.answer('session.setModel', { appSessionId: READY, model: 'haiku' })).toEqual({ ok: true, error: null, code: null });
    expect(backend.status(READY).model).toEqual({ requested: 'haiku', resolved: 'claude-sonnet-5[1m]' });
    // haiku carries no supportsAutoMode: the engine's refusal of seq 156, the effective mode kept
    expect(await backend.answer('session.setPermissionMode', { appSessionId: READY, mode: 'auto' })).toEqual({
      effective: 'auto',
      refusal: 'auto_mode_model',
      error: 'Cannot set permission mode to auto: auto mode unavailable for this model',
    });
    expect(await backend.answer('session.setPermissionMode', { appSessionId: READY, mode: 'default' })).toEqual({ effective: 'default', refusal: null, error: null });
    expect(await backend.answer('session.setPermissionMode', { appSessionId: READY, mode: 'auto' })).toMatchObject({ effective: 'default', refusal: 'auto_mode_model' });
    expect(backend.status(READY).permissionMode).toEqual({ requested: 'auto', effective: 'default', refusal: 'auto_mode_model' });
    await backend.answer('session.setModel', { appSessionId: READY, model: 'claude/astra' });
    expect(await backend.answer('session.setPermissionMode', { appSessionId: READY, mode: 'auto' })).toEqual({ effective: 'auto', refusal: null, error: null }); // seq 165
    expect(await backend.answer('session.setEffort', { appSessionId: READY, effort: 'high' })).toBeUndefined();
    expect(backend.status(READY).effort).toBe('high');
    expect(await backend.answer('session.applyFlagSettings', { appSessionId: READY, settings: { fastMode: true } })).toBeUndefined();
    expect(backend.status(READY).fastMode).toEqual({ state: 'off', disabledReason: 'sdk_opt_in_required' }); // the next init frame reports it
    expect(backend.calls.map((c) => c.subtype)).toEqual(['set_model', 'set_permission_mode', 'set_permission_mode', 'set_permission_mode', 'set_model', 'set_permission_mode', 'apply_flag_settings', 'apply_flag_settings']);
    expect(emitted.filter((e) => e.name === 'session.status')).toHaveLength(7);
  });

  it('answers an operation with its receipt and completes it on session.operation, at once or when settled', async () => {
    const { backend, emitted } = backendOf();
    const operations = () => emitted.filter((e) => e.name === 'session.operation').map((e) => e.payload as { opId: string; outcome: unknown });
    const { opId } = (await backend.answer('session.reloadPlugins', { appSessionId: READY })) as { opId: string };
    await vi.waitFor(() => expect(operations()).toHaveLength(1));
    expect(operations()[0]).toMatchObject({ opId, outcome: { ok: true, value: { error_count: 0 } } });
    const value = (operations()[0].outcome as { value: { commands: unknown[]; agents: unknown[]; plugins: unknown[] } }).value;
    expect([value.commands.length, value.agents.length, value.plugins.length]).toEqual([52, 5, 11]);

    backend.holdOperations(true);
    backend.scriptOutcome('session.mcpToggle', () => ({ ok: false, error: { code: 'engine_error', message: 'Server not found: x', engineCode: null } }));
    await backend.answer('session.mcpToggle', { appSessionId: READY, serverName: 'x', enabled: false });
    await new Promise((r) => setTimeout(r, 5));
    expect(operations()).toHaveLength(1);
    expect(backend.settleOperations()).toBe(1);
    expect(operations()[1].outcome).toEqual({ ok: false, error: { code: 'engine_error', message: 'Server not found: x', engineCode: null } });
  });

  it('answers mcp_status with the toggles the engine accepted', async () => {
    const { backend } = backendOf();
    backend.holdOperations(true);
    await backend.answer('session.mcpToggle', { appSessionId: READY, serverName: 'openaiDeveloperDocs', enabled: false });
    const before = (await backend.answer('session.mcpStatus', { appSessionId: READY })) as { mcpServers: { name: string; status: string }[] };
    expect(before.mcpServers.find((s) => s.name === 'openaiDeveloperDocs')?.status).toBe('connected'); // not yet completed
    backend.settleOperations();
    const after = (await backend.answer('session.mcpStatus', { appSessionId: READY })) as { mcpServers: { name: string; status: string }[] };
    expect(after.mcpServers.map((s) => s.status)).toEqual(['connected', 'connected', 'disabled']);
  });

  it('answers the compact widget’s prompt and the app queue', async () => {
    const { backend } = backendOf();
    expect(await backend.answer('session.send', { appSessionId: READY, content: '/compact' })).toMatchObject({ disposition: 'sent' });
    expect(await backend.answer('session.queue.list', { appSessionId: READY })).toEqual({ entries: [], paused: false, pauseReason: null });
    expect(backend.calls.at(-2)).toEqual({ command: 'session.send', subtype: null, input: { appSessionId: READY, content: '/compact' } });
  });

  // M4: the route switch's lifecycle commands, moving the status and the app queue as C3's host does.
  it('interrupts an open turn (pausing the queue for it), stops the process, and resumes the queue', async () => {
    const { backend, emitted } = backendOf();
    backend.emitTurnStarted(READY);
    expect(await backend.answer('session.interrupt', { appSessionId: READY, cancelEngineQueued: false })).toEqual({ stillQueued: [], cancelled: [] });
    expect(await backend.answer('session.queue.list', { appSessionId: READY })).toMatchObject({ paused: true, pauseReason: 'interrupt' });
    await vi.waitFor(() => expect(backend.status(READY).turn).toBeNull()); // the turn ends after the answer, as turn.ended follows
    expect(backend.status(READY).engineState).toBe('idle');
    expect(await backend.answer('session.stop', { appSessionId: READY, reason: 'stop' })).toEqual({ exited: true, code: 0, signal: null });
    expect(backend.status(READY)).toMatchObject({ process: 'exited', exit: { reason: 'stop' } });
    expect(emitted.at(-1)).toMatchObject({ name: 'session.status', payload: { status: { process: 'exited' } } });
    await backend.answer('session.queue.setPaused', { appSessionId: READY, paused: false });
    expect(await backend.answer('session.queue.list', { appSessionId: READY })).toMatchObject({ paused: false, pauseReason: null });
    await backend.answer('session.queue.setPaused', { appSessionId: READY, paused: true });
    expect(await backend.answer('session.queue.list', { appSessionId: READY })).toMatchObject({ paused: true, pauseReason: 'user' });
  });

  it('holds a send made while a turn is open as a queued entry, which queue.list answers and a stop keeps', async () => {
    const { backend } = backendOf();
    backend.emitTurnStarted(READY);
    expect(await backend.answer('session.send', { appSessionId: READY, content: 'first' })).toMatchObject({ disposition: 'queued' });
    expect(await backend.answer('session.send', { appSessionId: READY, content: 'second' })).toMatchObject({ disposition: 'queued' });
    expect(backend.status(READY).queue).toEqual({ length: 2, paused: false });
    await backend.answer('session.stop', { appSessionId: READY, reason: 'stop' });
    const queue = (await backend.answer('session.queue.list', { appSessionId: READY })) as { entries: { content: unknown; state: string }[] };
    expect(queue.entries.map((e) => [e.content, e.state])).toEqual([['first', 'queued'], ['second', 'queued']]);
  });

  it('keeps the synthetic answers readable, each citing where its shape comes from', () => {
    for (const name of ['reload-plugins.json', 'mcp-reconnect.json', 'mcp-toggle.json', 'mcp-toggle-connect-failed.json', 'get-session-cost.json']) {
      expect(syntheticFixture(ROOT, name)._from, name).toMatch(/SPEC/);
    }
    const failed = syntheticFixture(ROOT, 'mcp-toggle-connect-failed.json') as { operation: unknown; mcp_status: { mcpServers: { name: string; status: string; error?: string }[] } };
    expect(failed.operation).toEqual({ ok: false, error: { code: 'engine_error', message: 'Connection failed', engineCode: null } });
    expect(failed.mcp_status.mcpServers.find((s) => s.name === 'openaiDeveloperDocs')).toMatchObject({ status: 'failed', error: 'Connection failed' });
  });
});

describe('the auto-routed-controls replay fixture', () => {
  it('is pass2/auto-routed verbatim under a C11 provenance row, without the unissuable fork_conversation pair (seq 146-147)', () => {
    const lines = (path: string) => readFileSync(join(ROOT, path), 'utf8').split('\n').filter((l) => l.length > 0);
    const source = lines('spikes/protocol-probe/fixtures/pass2/auto-routed.jsonl');
    const derived = lines('test/fixtures/engine/auto-routed-controls.jsonl');
    const provenance = JSON.parse(derived[0]) as { seq: number; direction: string; frame: { event: string; source: string; omittedSeqs: number[] } };
    expect(provenance).toMatchObject({ seq: 0, direction: 'meta', frame: { event: 'provenance', source: 'spikes/protocol-probe/fixtures/pass2/auto-routed.jsonl', omittedSeqs: [146, 147] } });
    expect(derived.slice(1)).toEqual(source.filter((l) => ![146, 147].includes((JSON.parse(l) as { seq: number }).seq)));
  });
});
