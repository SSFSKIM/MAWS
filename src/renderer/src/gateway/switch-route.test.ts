// switchRoute over a scripted store (C11 execution document, Interfaces "Gateway", *The switch*; M4's decisions, pins and
// refresh task "the switch's failure and the queue"): the confirm names background work and requires a Direct model for
// a gateway alias before anything is stopped, then interrupt → recheck → stop → start in order, one start at most, and
// the queue resumed only when the switch's own interrupt paused it. The sessions are the widget backend's over C5's
// nine-sessions scenario, which answers C10's `session.start` (the resume, ready on the route asked for) through the
// switch's own start adapter; a case scripts its refusal or a start that never becomes ready.
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandName, PreloadBridge } from '@shared/ipc/schema';
import { REGISTRY } from '@shared/ipc/registry';
import { addressingOf, bareOf } from '@shared/machine/address';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { createClient } from '../ipc/client';
import { pageScenario } from '../test-support/shell-stores';
import type { SetupEvent, StartOutcome } from '@shared/sessions/setup';
import { sessionStartOver, type StartOptions } from './session-start';
import { createGatewayStore, type GatewayStore } from './store';
import { createRouteSwitcher, switchButtonLabel, type SwitchAnswer } from './switch-route';
// P5 O7 M9: the features a switch back to the machine's own route hands back to its observation
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { routeOf } from '../composer/list-models';
import { readsEngineUsage } from '../statusline/direct-fallback';
import { createSessionsStore } from '../stores/sessions';
import { createUsageStore, windowsFor } from '../stores/usage';
import { throughClaudeUsage } from './observed-route';
import { hasLiveGatewaySession } from './relay-monitor';
import { routingFacts } from './routing-facts';

const ROOT = join(__dirname, '../../../..');
const READY = 'app-7412a115' as AppSessionId; // Settings idle probe: ready, idle, routed
// P5 O6 M2: the backend is main, asked, answering and emitting with the bare `READY`; the switch runs on the page's client
// over it, with the page's records and statuses, whose ids are addresses (`ID`).
const ID = at(READY);
const addressing = addressingOf(REGISTRY);
const LIFECYCLE: readonly CommandName[] = ['session.status', 'session.interrupt', 'session.stop', 'session.start', 'session.queue.list', 'session.queue.setPaused'];
const task = (taskId: string, description: string, taskType = 'local_agent') => ({ taskId, taskType, description, ambient: false }) as EngineSessionStatus['backgroundTasks'][number];

interface Setup {
  backend: WidgetBackend;
  store: GatewayStore;
  log: string[];
  starts: { appSessionId: AppSessionId; options: StartOptions }[];
  toasts: string[];
  failSetup(outcome: SetupEvent['outcome']): void;
  switcher: ReturnType<typeof createRouteSwitcher>;
}

let live: Setup | null = null;
afterEach(() => {
  vi.useRealTimers();
  live = null;
});

// `start`: C10's answer instead of the backend's resume (`no_ready`: `starting`, and nothing follows); `onStart`: run as
// the start is asked, before the backend's own resume.
function setup(opts: { model?: string; effort?: EngineSessionStatus['effort']; tasks?: EngineSessionStatus['backgroundTasks']; turn?: boolean; start?: StartOutcome | 'no_ready'; onStart?: () => void } = {}): Setup {
  const scenario = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
  const backend = createWidgetBackend({ root: ROOT, statuses: scenario.engine, records: scenario.sessions });
  const records = new Map<AppSessionId, SessionRecord>(pageScenario(scenario).sessions.map((r) => [r.appId, r]));
  const log: string[] = [];
  const bridge = backend.bridge();
  const client = createClient(() => ({
    ...bridge,
    invoke: ((name: CommandName, input: unknown, machine?: typeof TEST_MACHINE) => {
      if (LIFECYCLE.includes(name)) log.push(name);
      if (name === 'session.start') opts.onStart?.();
      return bridge.invoke(name as never, input as never, machine);
    }) as PreloadBridge['invoke'],
  }));
  if (opts.model) {
    records.set(ID, { ...records.get(ID)!, model: { requested: opts.model, resolved: opts.model } });
    backend.emitStatus(READY, { model: { requested: opts.model, resolved: opts.model } });
  }
  if (opts.effort) backend.emitStatus(READY, { effort: opts.effort });
  if (opts.tasks) backend.emitStatus(READY, { backgroundTasks: opts.tasks });
  if (opts.turn) backend.emitTurnStarted(READY);
  if (opts.start) {
    const answer = opts.start;
    backend.script('session.start', (input) => (answer === 'no_ready' ? { status: 'starting', appSessionId: (input as { appSessionId: AppSessionId }).appSessionId } : answer));
  }
  const toasts: string[] = [];
  const store = createGatewayStore(client);
  const switcher = createRouteSwitcher(
    {
      client,
      record: (id) => records.get(id) ?? null,
      status: (id) => addressing.output('engine.sessions').lift([backend.status(bareOf(id))], TEST_MACHINE)[0]!,
      start: sessionStartOver(client),
      toast: (text, action) => void toasts.push(action ? `${text} [${action.label}]` : text),
      timeouts: { turnMs: 300, exitMs: 300, readyMs: 400 },
    },
    store,
  );
  live = {
    backend,
    store,
    log,
    get starts() {
      return backend.calls.filter((c) => c.command === 'session.start').map((c) => ({ appSessionId: (c.input as { appSessionId: AppSessionId }).appSessionId, options: (c.input as { options: StartOptions }).options }));
    },
    toasts,
    failSetup: (outcome) => backend.emitSetup({ appSessionId: READY, phase: 'failed', detail: null, outcome }),
    switcher,
  };
  return live;
}

const stateOf = (s: Setup) => s.store.getState().switching.get(ID);
async function confirming(s: Setup) {
  await vi.waitFor(() => expect(stateOf(s)).toMatchObject({ phase: 'confirming', confirm: expect.anything() })); // asking, its confirm known
  return stateOf(s)!;
}
const CONFIRM: SwitchAnswer = { model: null, displayName: null, effort: null };

describe('switchRoute names background work, requires a Direct model for a gateway alias, rechecks before stop and runs interrupt, stop, start in order', () => {
  it('a turn open and no background work: interrupt, wait for the turn, re-read, stop, start direct, done on a verified direct status', async () => {
    const s = setup({ turn: true });
    const run = s.switcher.switchRoute(ID, 'direct');
    const sheet = await confirming(s);
    expect(sheet.confirm).toEqual({ target: 'direct', backgroundTasks: [], requiresModel: false, model: null, effort: null });
    expect(switchButtonLabel(sheet.confirm!)).toBe('Restart direct');
    expect(s.log, 'nothing but the status read before the answer').toEqual(['session.status']);
    s.switcher.answer(ID, CONFIRM);
    expect(await run).toBe('done');
    expect(s.log).toEqual(['session.status', 'session.queue.list', 'session.interrupt', 'session.status', 'session.stop', 'session.start', 'session.queue.list', 'session.queue.setPaused']);
    // W1: the switch stops everything, so a waiting `next` steer is held with the queue across the restart
    expect(s.backend.calls.filter((c) => c.command === 'session.interrupt').map((c) => c.input)).toEqual([{ appSessionId: READY, cancelEngineQueued: false, holdEngineQueued: true }]);
    expect(s.starts).toEqual([{ appSessionId: READY, options: { gateway: 'direct' } }]);
    expect(stateOf(s)).toMatchObject({ phase: 'done', error: null });
    expect(s.toasts).toEqual(['Settings idle probe restarted direct']);
  });

  it('two background tasks: the confirm carries both, the button reads Stop them and switch, and nothing is called until it is pressed', async () => {
    const tasks = [task('t1', 'Sleep 120 s'), task('t2', 'Index the repository', 'local_workflow')];
    const s = setup({ tasks });
    const run = s.switcher.switchRoute(ID, 'direct');
    const sheet = await confirming(s);
    expect(sheet.confirm!.backgroundTasks).toEqual(tasks);
    expect(switchButtonLabel(sheet.confirm!)).toBe('Stop them and switch');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.log).toEqual(['session.status']);
    expect(s.starts).toEqual([]);
    s.switcher.answer(ID, null);
    expect(await run).toBe('cancelled');
    expect(stateOf(s)).toBeUndefined();
    expect(s.log).toEqual(['session.status']);
  });

  it('no turn and one active workflow: no interrupt, the workflow named, the status re-read before the stop, the stop only after the confirm', async () => {
    const s = setup({ tasks: [task('w1', 'Review pass', 'local_workflow')] });
    const run = s.switcher.switchRoute(ID, 'gateway');
    expect((await confirming(s)).confirm!.backgroundTasks.map((t) => t.description)).toEqual(['Review pass']);
    s.switcher.answer(ID, CONFIRM);
    expect(await run).toBe('done');
    expect(s.log).toEqual(['session.status', 'session.queue.list', 'session.status', 'session.stop', 'session.start', 'session.queue.list']);
    expect(s.starts[0].options).toEqual({ gateway: 'gateway' });
    expect(s.toasts).toEqual(['Settings idle probe restarted routed']);
  });

  it('work that started after the confirm returns the machine to the sheet with the new list and never stops; taskIds, not counts', async () => {
    const s = setup({ tasks: [task('t1', 'Sleep 120 s')] });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    // one task ended and another started: the count is the same, the ids are not
    s.backend.emitStatus(READY, { backgroundTasks: [task('t9', 'A new agent')] });
    s.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(stateOf(s)?.confirm?.backgroundTasks.map((t) => t.taskId)).toEqual(['t9']));
    expect(stateOf(s)).toMatchObject({ phase: 'confirming', error: 'New background work started since you confirmed · check the list again' });
    expect(s.log).not.toContain('session.stop');
    s.switcher.answer(ID, null);
    expect(await run).toBe('cancelled');
    expect(s.log).not.toContain('session.stop');
    expect(s.starts).toEqual([]);
  });

  it('the recheck compares against the list the sheet showed when it was answered, not the one read at open', async () => {
    const s = setup({ tasks: [task('t1', 'Sleep 120 s')] });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    const shown = [task('t1', 'Sleep 120 s'), task('t2', 'Started while the sheet was open')];
    s.backend.emitStatus(READY, { backgroundTasks: shown }); // C10's disclosure shows it live, so the human saw it
    s.switcher.answer(ID, { ...CONFIRM, backgroundTasks: shown });
    expect(await run).toBe('done');
    expect(s.log).toContain('session.stop');
  });

  it('a gateway model requires a Claude model before anything stops, and the choice reaches session.start', async () => {
    const s = setup({ model: 'claude/astra', effort: 'max' });
    const run = s.switcher.switchRoute(ID, 'direct');
    expect((await confirming(s)).confirm).toMatchObject({ requiresModel: true, model: null });
    s.switcher.answer(ID, CONFIRM); // no model chosen: refused, still asking
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stateOf(s)?.phase).toBe('confirming');
    expect(s.log).toEqual(['session.status']);
    s.switcher.answer(ID, { model: 'sonnet', displayName: 'Sonnet 5', effort: 'high' });
    expect(await run).toBe('done');
    expect(s.starts).toEqual([{ appSessionId: READY, options: { gateway: 'direct', model: 'sonnet', effort: 'high' } }]);
    expect(s.toasts).toEqual(['Settings idle probe restarted direct · on Sonnet 5']);
  });

  it('reads the model to launch from the live status first, which the record is patched from', async () => {
    const s = setup();
    s.backend.emitStatus(READY, { model: { requested: 'claude/astra', resolved: 'gpt-5.5' } }); // the record still says sonnet
    const run = s.switcher.switchRoute(ID, 'direct');
    expect((await confirming(s)).confirm?.requiresModel).toBe(true);
    s.switcher.answer(ID, null);
    expect(await run).toBe('cancelled');
  });

  it('a chosen model whose levels admit the current effort passes no effort key; switching to the gateway asks for no model', async () => {
    const s = setup({ model: 'claude/astra' });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.switcher.answer(ID, { model: 'sonnet', displayName: 'Sonnet 5', effort: null });
    expect(await run).toBe('done');
    expect(s.starts[0].options).toEqual({ gateway: 'direct', model: 'sonnet' });

    const t = setup({ model: 'claude/astra' });
    const back = t.switcher.switchRoute(ID, 'gateway');
    expect((await confirming(t)).confirm).toMatchObject({ requiresModel: false });
    t.switcher.answer(ID, CONFIRM);
    expect(await back).toBe('done');
    expect(t.starts[0].options).toEqual({ gateway: 'gateway' });
  });

  it('a refused start is failed with the reason and never retried', async () => {
    const s = setup({ start: { status: 'held', appSessionId: READY, holder: { kind: 'terminal', pid: 4711 }, attach: null } });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    expect(await run).toBe('failed');
    expect(s.starts).toHaveLength(1);
    expect(stateOf(s)).toMatchObject({ phase: 'failed', error: 'Stopped; the restart was refused: Held by terminal · 4711 · Resume from the sidebar' });
    expect(s.toasts).toEqual([]);
  });

  it('a setup failure after starting, or a mismatched route, is failed', async () => {
    const s = setup({ start: 'no_ready' });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(s.starts).toHaveLength(1));
    s.failSetup({ kind: 'relay_unreachable', health: { url: 'http://127.0.0.1:8641', ok: false, status: null, latencyMs: null, checkedAt: '2026-09-29T12:00:00.000Z', error: 'ECONNREFUSED' } });
    expect(await run).toBe('failed');
    expect(stateOf(s)?.error).toBe('Stopped; the restart was refused: The relay was unreachable · Resume from the sidebar');

    const m = setup({ start: 'no_ready' });
    const mismatch = m.switcher.switchRoute(ID, 'direct');
    await confirming(m);
    m.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(m.starts).toHaveLength(1));
    m.backend.emitStatus(READY, { process: 'ready', launchId: 'launch-2', exit: null, gateway: { mode: 'direct', baseUrl: null, verified: 'mismatch', autoModeServer: 'unknown', localLane: null } });
    expect(await mismatch).toBe('failed');
    expect(stateOf(m)?.error).toBe('Restarted, but the route reads unverified (asked for Direct) · check Session info');
  });

  it('a restart verified on the other route is a mismatch that fails at once, not after the ready bound', async () => {
    const s = setup({ start: 'no_ready' });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(s.starts).toHaveLength(1));
    const at = Date.now();
    s.backend.emitStatus(READY, { process: 'ready', launchId: 'launch-2', exit: null, gateway: { mode: 'gateway', baseUrl: 'http://127.0.0.1:8641', verified: 'routed', autoModeServer: 'enabled', localLane: null } });
    expect(await run).toBe('failed');
    expect(Date.now() - at, 'well inside the 400 ms bound').toBeLessThan(200);
    expect(stateOf(s)?.error).toBe('Restarted, but the route reads unverified (asked for Direct) · check Session info');
  });

  it('a restart that never becomes ready is failed after its bound', async () => {
    const s = setup({ start: 'no_ready' });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    expect(await run).toBe('failed');
    expect(stateOf(s)?.error).toBe('Stopped; the restart did not become ready within 60 s · Resume from the sidebar');
  });

  it('refuses a second switch while one is in flight', async () => {
    const s = setup();
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    expect(await s.switcher.switchRoute(ID, 'direct')).toBe('failed');
    expect(s.toasts).toEqual(['This session is already switching routes']);
    expect(stateOf(s)?.phase).toBe('confirming');
    s.switcher.answer(ID, null);
    expect(await run).toBe('cancelled');
  });
});

describe('one switch in flight per session', () => {
  it('a second call made before the first awaits anything is refused, whichever target it names, and the first runs alone', async () => {
    const s = setup();
    const first = s.switcher.switchRoute(ID, 'direct');
    const second = s.switcher.switchRoute(ID, 'gateway'); // the same tick: a double click, or both targets of an unrecorded route
    expect(await second).toBe('failed');
    expect(s.toasts).toEqual(['This session is already switching routes']);
    expect(stateOf(s)).toMatchObject({ target: 'direct', phase: 'confirming' });
    await confirming(s);
    expect(s.log.filter((c) => c === 'session.status'), 'one machine read the status').toHaveLength(1);
    expect(s.switcher.answer(ID, null)).toBe(true);
    expect(await first).toBe('cancelled');
  });
});

// Whole-branch review: a switch toward the gateway checks the relay after the answer and before anything is stopped.
describe('a switch toward the gateway checks the relay first', () => {
  it('a relay that does not answer refuses the switch in words, with Open ClaudeUsage, and interrupts and stops nothing', async () => {
    const s = setup({ turn: true });
    s.backend.script('engine.relayHealth', () => ({ url: 'http://127.0.0.1:8641', ok: false, status: null, latencyMs: null, checkedAt: '2026-09-29T12:00:00.000Z', error: 'ECONNREFUSED' }));
    const run = s.switcher.switchRoute(ID, 'gateway');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    expect(await run).toBe('failed');
    expect(stateOf(s)).toMatchObject({ phase: 'failed', error: "ClaudeUsage's relay is not answering · nothing was stopped" });
    expect(s.toasts).toEqual(["ClaudeUsage's relay is not answering · nothing was stopped [Open ClaudeUsage]"]);
    expect(s.log).not.toContain('session.interrupt');
    expect(s.log).not.toContain('session.stop');
    expect(s.log).not.toContain('session.start');
  });

  it('an answering relay lets the switch run; a switch to Direct asks it nothing', async () => {
    const s = setup();
    const run = s.switcher.switchRoute(ID, 'gateway');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    expect(await run).toBe('done');
    expect(s.backend.calls.filter((c) => c.command === 'engine.relayHealth').map((c) => c.input)).toEqual([{ force: true }]);
    const d = setup();
    const direct = d.switcher.switchRoute(ID, 'direct');
    await confirming(d);
    d.switcher.answer(ID, CONFIRM);
    expect(await direct).toBe('done');
    expect(d.backend.calls.filter((c) => c.command === 'engine.relayHealth')).toEqual([]);
  });
});

describe('the queue after a switch', () => {
  it('a failure after the switch’s own interrupt resumes the queue it paused, once', async () => {
    const s = setup({ turn: true, start: { status: 'held', appSessionId: READY, holder: { kind: 'terminal', pid: 4711 }, attach: null } });
    for (const content of ['first queued', 'second queued']) await s.backend.answer('session.send', { appSessionId: READY, content });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    expect(await run).toBe('failed');
    expect(s.log).toContain('session.interrupt');
    expect(s.log.filter((c) => c === 'session.queue.setPaused')).toHaveLength(1);
    expect(await s.backend.answer('session.queue.list', { appSessionId: READY })).toMatchObject({ paused: false, pauseReason: null });
  });

  it('a turn open and a running queue of two: the entries survive the restart and the queue resumes once at done', async () => {
    const s = setup({ turn: true });
    for (const content of ['first queued', 'second queued']) expect(await s.backend.answer('session.send', { appSessionId: READY, content })).toMatchObject({ disposition: 'queued' });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    expect(await run).toBe('done');
    expect(s.log.filter((c) => c === 'session.queue.setPaused')).toHaveLength(1);
    const queue = (await s.backend.answer('session.queue.list', { appSessionId: READY })) as { entries: { content: unknown }[]; paused: boolean; pauseReason: unknown };
    expect(queue).toMatchObject({ paused: false, pauseReason: null });
    expect(queue.entries.map((e) => e.content)).toEqual(['first queued', 'second queued']);
  });

  it('a cancel after the recheck returned to the sheet resumes the queue its interrupt paused, once', async () => {
    const s = setup({ turn: true, tasks: [task('t1', 'Sleep 120 s')] });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.backend.emitStatus(READY, { backgroundTasks: [task('t1', 'Sleep 120 s'), task('t2', 'A new agent')] });
    s.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(stateOf(s)?.error).toBe('New background work started since you confirmed · check the list again'));
    expect(s.log).toContain('session.interrupt');
    expect(await s.backend.answer('session.queue.list', { appSessionId: READY })).toMatchObject({ paused: true, pauseReason: 'interrupt' });
    s.switcher.answer(ID, null);
    expect(await run).toBe('cancelled');
    expect(s.log.filter((c) => c === 'session.queue.setPaused')).toHaveLength(1);
    expect(await s.backend.answer('session.queue.list', { appSessionId: READY })).toMatchObject({ paused: false, pauseReason: null });
    expect(s.log).not.toContain('session.stop');
  });

  it('a cancel after the recheck leaves a pause the human made alone', async () => {
    const s = setup({ turn: true, tasks: [task('t1', 'Sleep 120 s')] });
    await s.backend.answer('session.queue.setPaused', { appSessionId: READY, paused: true });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.backend.emitStatus(READY, { backgroundTasks: [task('t2', 'A new agent')] });
    s.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(stateOf(s)?.error).not.toBeNull());
    s.switcher.answer(ID, null);
    expect(await run).toBe('cancelled');
    expect(s.log).not.toContain('session.queue.setPaused');
  });

  it('a queue the human paused before the switch is left paused', async () => {
    const s = setup({ turn: true });
    await s.backend.answer('session.queue.setPaused', { appSessionId: READY, paused: true });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    expect(await run).toBe('done');
    expect(s.log).not.toContain('session.queue.setPaused');
  });

  it('a pause whose reason changed during the restart is left alone', async () => {
    let unscript: (() => void) | null = null;
    const s = setup({
      turn: true,
      onStart: () => {
        unscript = live!.backend.script('session.queue.list', () => ({ entries: [], paused: true, pauseReason: 'refused' }));
      },
    });
    const run = s.switcher.switchRoute(ID, 'direct');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    expect(await run).toBe('done');
    expect(s.log).not.toContain('session.queue.setPaused');
    (unscript as (() => void) | null)?.();
  });
});

// P5 O7 M9 (the architect's ruling on m9-4): the machine's route is every session's default and gateway and direct are
// per-session choices, so the switch reaches all three: back to the machine's own is a restart on `route: 'machine'`,
// verified as a launch is, by what get_status reports (`observed`), never a mismatch, and every feature then follows
// that observation again.
describe('back to the machine’s own route', () => {
  const RELAY = 'http://127.0.0.1:8641';
  const onMachine = (observed: NonNullable<EngineSessionStatus['gateway']['observed']> | undefined, verified: EngineSessionStatus['gateway']['verified']) => ({
    mode: (observed?.kind === 'claudeusage' ? 'gateway' : 'direct') as 'gateway' | 'direct',
    baseUrl: observed?.baseUrl ?? null,
    verified,
    autoModeServer: 'enabled' as const,
    localLane: null,
    route: 'machine' as const,
    ...(observed !== undefined && { observed }),
  });
  const pageScenarioRecord = () => pageScenario(loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'))).sessions.find((r) => r.appId === ID)!;
  const pageStatus = (s: Setup) => addressing.output('engine.sessions').lift([s.backend.status(READY)], TEST_MACHINE)[0]!;
  const features = (s: Setup) => {
    const status = pageStatus(s);
    const sessions = createSessionsStore();
    sessions.getState().applyStatus({ appSessionId: ID, status }, TEST_MACHINE);
    const usage = createUsageStore();
    return {
      claudeUsage: throughClaudeUsage(status, null),
      catalogue: routeOf(status, null),
      engineUsage: readsEngineUsage(status),
      relayBanner: hasLiveGatewaySession(sessions.getState()),
      windows: windowsFor(usage.getState(), pageScenarioRecord(), status).source,
      facts: routingFacts(pageScenarioRecord(), status, null, SETTINGS_DEFAULTS_V21, null),
    };
  };

  it('machine → gateway → machine: each restart on the route asked for, the way back verified by what the machine reached, and the features following it', async () => {
    const s = setup({ start: 'no_ready' });
    s.backend.emitStatus(READY, { gateway: onMachine({ kind: 'login', baseUrl: null, login: 'Claude Max' }, 'direct') }); // on its own route, through its login
    expect(features(s)).toMatchObject({ claudeUsage: false, catalogue: 'direct', engineUsage: true, relayBanner: false, windows: 'direct', facts: { machine: true, targets: ['gateway', 'direct'] } });

    const toGateway = s.switcher.switchRoute(ID, 'gateway');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(s.starts).toHaveLength(1));
    expect(s.starts[0]!.options).toEqual({ gateway: 'gateway' });
    s.backend.emitStatus(READY, { process: 'ready', launchId: 'launch-2', exit: null, gateway: { mode: 'gateway', baseUrl: RELAY, verified: 'routed', autoModeServer: 'enabled', localLane: null } });
    expect(await toGateway).toBe('done');
    expect(features(s)).toMatchObject({ claudeUsage: true, catalogue: 'gateway', engineUsage: false, relayBanner: true, windows: 'drain', facts: { machine: false, targets: ['direct', 'machine'] } });

    const back = s.switcher.switchRoute(ID, 'machine');
    const sheet = await confirming(s);
    expect(sheet.confirm).toEqual({ target: 'machine', backgroundTasks: [], requiresModel: false, model: null, effort: null });
    expect(switchButtonLabel(sheet.confirm!)).toBe('Restart on the machine’s own');
    s.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(s.starts).toHaveLength(2));
    // the machine route's relay check is main's, as at a launch: nothing passes it unasked
    expect(s.starts[1]!.options).toEqual({ route: 'machine' });
    s.backend.emitStatus(READY, { process: 'ready', launchId: 'launch-3', exit: null, gateway: onMachine(undefined, 'pending') });
    expect(stateOf(s)?.phase).toBe('starting'); // not verified yet
    s.backend.emitStatus(READY, { gateway: onMachine({ kind: 'claudeusage', baseUrl: RELAY }, 'routed') });
    expect(await back).toBe('done');
    expect(s.toasts.at(-1)).toBe('Settings idle probe restarted · now on this machine’s own setup (ClaudeUsage)');
    expect(features(s)).toMatchObject({
      claudeUsage: true,
      catalogue: 'gateway',
      engineUsage: false,
      relayBanner: true,
      windows: 'drain',
      facts: { machine: true, route: 'gateway', line: `The machine’s own · ClaudeUsage relay · ${RELAY}`, targets: ['gateway', 'direct'] },
    });
  });

  it('names a login or a host the machine reached after the switch back, and never calls one a mismatch', async () => {
    for (const [observed, verified, words] of [
      [{ kind: 'login', baseUrl: null, login: 'Claude Max' }, 'direct', 'Anthropic login · Claude Max'],
      [{ kind: 'host', baseUrl: 'https://llm.example.test/v1' }, 'direct', 'llm.example.test'],
      [{ kind: 'host', baseUrl: 'https://llm.example.test/v1' }, 'mismatch', 'llm.example.test'], // whatever an older host wrote
    ] as const) {
      const s = setup({ start: 'no_ready' });
      const run = s.switcher.switchRoute(ID, 'machine');
      await confirming(s);
      s.switcher.answer(ID, CONFIRM);
      await vi.waitFor(() => expect(s.starts).toHaveLength(1));
      s.backend.emitStatus(READY, { process: 'ready', launchId: 'launch-2', exit: null, gateway: onMachine(observed, verified) });
      expect(await run, words).toBe('done');
      expect(s.toasts.at(-1)).toBe(`Settings idle probe restarted · now on this machine’s own setup (${words})`);
      expect(features(s)).toMatchObject({ claudeUsage: false, catalogue: 'direct', engineUsage: true, relayBanner: false, windows: 'direct' });
    }
  });

  // The launch's preflight is main's (machine-route.ts guardMachineRoute at session.start): only there is it known whether
  // the machine's own settings name the relay, so the switch hears a dead one as the start's `relay_unreachable`, after the
  // stop, and asks then; only Switch anyway sends `startAnyway`, on the machine route still.
  const DOWN: StartOutcome = { status: 'relay_unreachable', appSessionId: READY, health: { url: RELAY, ok: false, status: null, latencyMs: null, checkedAt: '2026-11-04T23:00:00.000Z', error: 'timed out' } };
  const relayNamedAndDown = (s: Setup) =>
    s.backend.script('session.start', (input) => {
      const { appSessionId, options } = input as { appSessionId: AppSessionId; options: StartOptions };
      return 'startAnyway' in options && options.startAnyway ? { status: 'starting', appSessionId } : DOWN;
    });
  const advising = async (s: Setup) => vi.waitFor(() => expect(stateOf(s)?.phase).toBe('advising'));

  it('with the relay the machine names down: asks before restarting, and only Switch anyway starts, past the check, on the machine route', async () => {
    const s = setup();
    relayNamedAndDown(s);
    const run = s.switcher.switchRoute(ID, 'machine');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    await advising(s);
    expect(s.starts).toEqual([{ appSessionId: READY, options: { route: 'machine' } }]); // asked as a launch is: refused, nothing started
    expect(s.switcher.advise(ID, true)).toBe(true);
    await vi.waitFor(() => expect(s.starts).toHaveLength(2));
    expect(s.starts[1]!.options).toEqual({ route: 'machine', startAnyway: true });
    s.backend.emitStatus(READY, { process: 'ready', launchId: 'launch-2', exit: null, gateway: onMachine({ kind: 'claudeusage', baseUrl: RELAY }, 'routed') });
    expect(await run).toBe('done');
    expect(s.toasts.at(-1)).toBe('Settings idle probe restarted · now on this machine’s own setup (ClaudeUsage)');
  });

  it('with the relay the machine names down, Cancel starts nothing more and leaves the session stopped, to resume on its route', async () => {
    const s = setup();
    relayNamedAndDown(s);
    const run = s.switcher.switchRoute(ID, 'machine');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    await advising(s);
    expect(s.switcher.advise(ID, false)).toBe(true);
    expect(await run).toBe('failed');
    expect(s.starts).toHaveLength(1);
    expect(stateOf(s)).toMatchObject({ phase: 'failed', error: 'Stopped, not switched: this machine’s relay isn’t answering · Resume from the sidebar to restart it on the route it was on' });
    expect(s.switcher.advise(ID, true), 'nothing asks any more').toBe(false);
  });

  // A gateway alias the machine's own route can't reach (its settings resolve to a login or another host): main's guard
  // refuses the model (`field: 'model'`), which the switch can't foresee; it asks for a Claude model, as Direct's does,
  // and starts on the machine's own with it
  it('a gateway alias against a machine that resolves elsewhere: asks for a Claude model after the refusal, then starts on the machine’s own', async () => {
    const WORDS = 'claude/sol is a ClaudeUsage alias; this machine’s own route reaches llm.example.test';
    const s = setup({ model: 'claude/sol' });
    s.backend.script('session.start', (input) => {
      const { appSessionId, options } = input as { appSessionId: AppSessionId; options: StartOptions };
      return options.model === 'opus' ? { status: 'starting', appSessionId } : { status: 'invalid', appSessionId, field: 'model', message: WORDS };
    });
    const run = s.switcher.switchRoute(ID, 'machine');
    const first = await confirming(s);
    expect(first.confirm!.requiresModel, 'the resolution is main’s: nothing asked up front').toBe(false);
    s.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(stateOf(s)).toMatchObject({ phase: 'confirming', error: WORDS, confirm: { target: 'machine', requiresModel: true, backgroundTasks: [] } }));
    expect(s.starts).toEqual([{ appSessionId: READY, options: { route: 'machine' } }]);
    expect(s.switcher.answer(ID, CONFIRM), 'a model is required').toBe(false);
    s.switcher.answer(ID, { model: 'opus', displayName: 'Opus 5.5', effort: null });
    await vi.waitFor(() => expect(s.starts).toHaveLength(2));
    expect(s.starts[1]!.options).toEqual({ route: 'machine', model: 'opus' });
    s.backend.emitStatus(READY, { process: 'ready', launchId: 'launch-2', exit: null, gateway: onMachine({ kind: 'host', baseUrl: 'https://llm.example.test/v1' }, 'direct') });
    expect(await run).toBe('done');
    expect(s.toasts.at(-1)).toBe('Settings idle probe restarted · now on this machine’s own setup (llm.example.test) · on Opus 5.5');
  });

  it('a refused gateway alias, then Cancel: the session stays stopped, to resume on its route', async () => {
    const s = setup({ model: 'claude/sol' });
    s.backend.script('session.start', (input) => ({ status: 'invalid', appSessionId: (input as { appSessionId: AppSessionId }).appSessionId, field: 'model', message: 'not reachable' }));
    const run = s.switcher.switchRoute(ID, 'machine');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(stateOf(s)).toMatchObject({ phase: 'confirming', confirm: { requiresModel: true } }));
    s.switcher.answer(ID, null);
    expect(await run).toBe('failed');
    expect(stateOf(s)?.error).toBe('Stopped, not switched: not reachable · Resume from the sidebar to restart it on the route it was on');
    expect(s.starts).toHaveLength(1);
  });

  it('with the relay up, or no relay named, main starts it at once: straight through, with no startAnyway', async () => {
    const s = setup({ start: 'no_ready' }); // main's guard passed: `starting`
    const run = s.switcher.switchRoute(ID, 'machine');
    await confirming(s);
    s.switcher.answer(ID, CONFIRM);
    await vi.waitFor(() => expect(s.starts).toHaveLength(1));
    expect(stateOf(s)?.phase).toBe('starting');
    s.backend.emitStatus(READY, { process: 'ready', launchId: 'launch-2', exit: null, gateway: onMachine({ kind: 'login', baseUrl: null, login: 'Claude Max' }, 'direct') });
    expect(await run).toBe('done');
    expect(s.starts).toEqual([{ appSessionId: READY, options: { route: 'machine' } }]);
  });
});
