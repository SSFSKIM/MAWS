// switchRoute over a scripted store (C11 execution document, Interfaces "Gateway", *The switch*; M4's decisions, pins and
// refresh task "the switch's failure and the queue"): the confirm names background work and requires a Direct model for
// a gateway alias before anything is stopped, then interrupt → recheck → stop → start in order, one start at most, and
// the queue resumed only when the switch's own interrupt paused it. The sessions are the widget backend's over C5's
// nine-sessions scenario; C10's `session.start` is a scripted stand-in.
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import type { SessionStart, StartAnswer, StartOptions } from './c10-seam';
import { createGatewayStore, type GatewayStore } from './store';
import { createRouteSwitcher, switchButtonLabel, type SwitchAnswer } from './switch-route';

const ROOT = join(__dirname, '../../../..');
const READY = 'app-7412a115' as AppSessionId; // Settings idle probe: ready, idle, routed
const LIFECYCLE: readonly CommandName[] = ['session.status', 'session.interrupt', 'session.stop', 'session.queue.list', 'session.queue.setPaused'];
const task = (taskId: string, description: string, taskType = 'local_agent') => ({ taskId, taskType, description, ambient: false }) as EngineSessionStatus['backgroundTasks'][number];

interface Setup {
  backend: WidgetBackend;
  store: GatewayStore;
  log: string[];
  starts: { appSessionId: AppSessionId; options: StartOptions }[];
  toasts: string[];
  failSetup(reason: string): void;
  switcher: ReturnType<typeof createRouteSwitcher>;
}

let live: Setup | null = null;
afterEach(() => {
  vi.useRealTimers();
  live = null;
});

function setup(opts: { model?: string; effort?: EngineSessionStatus['effort']; tasks?: EngineSessionStatus['backgroundTasks']; turn?: boolean; start?: (options: StartOptions) => StartAnswer | 'no_ready'; startSeam?: boolean } = {}): Setup {
  const scenario = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
  const backend = createWidgetBackend({ root: ROOT, statuses: scenario.engine });
  const records = new Map<AppSessionId, SessionRecord>(scenario.sessions.map((r) => [r.appId, r]));
  const log: string[] = [];
  const bridge = backend.bridge();
  const client: MawsBridge = {
    ...bridge,
    invoke: ((name: CommandName, input: unknown) => {
      if (LIFECYCLE.includes(name)) log.push(name);
      return bridge.invoke(name as never, input as never);
    }) as MawsBridge['invoke'],
  };
  if (opts.model) {
    records.set(READY, { ...records.get(READY)!, model: { requested: opts.model, resolved: opts.model } });
    backend.emitStatus(READY, { model: { requested: opts.model, resolved: opts.model } });
  }
  if (opts.effort) backend.emitStatus(READY, { effort: opts.effort });
  if (opts.tasks) backend.emitStatus(READY, { backgroundTasks: opts.tasks });
  if (opts.turn) backend.emitTurnStarted(READY);
  const starts: Setup['starts'] = [];
  const failures = new Set<(reason: string) => void>();
  const start: SessionStart = {
    async start(appSessionId, options) {
      log.push('session.start');
      starts.push({ appSessionId, options });
      const answer = opts.start?.(options) ?? { status: 'starting' };
      if (answer === 'no_ready') return { status: 'starting' };
      if (answer.status === 'starting') {
        const verified = options.gateway === 'gateway' ? 'routed' : 'direct';
        setTimeout(() => backend.emitStatus(appSessionId, { process: 'initializing', launchId: 'launch-2', exit: null }), 0);
        setTimeout(() => backend.emitStatus(appSessionId, { process: 'ready', gateway: { mode: options.gateway, baseUrl: options.gateway === 'gateway' ? 'http://127.0.0.1:8641' : null, verified, autoModeServer: 'enabled', localLane: null } }), 5);
      }
      return answer;
    },
    onSetupFailure(_appSessionId, listener) {
      failures.add(listener);
      return () => void failures.delete(listener);
    },
  };
  const toasts: string[] = [];
  const store = createGatewayStore(client);
  const switcher = createRouteSwitcher(
    {
      client,
      record: (id) => records.get(id) ?? null,
      status: (id) => backend.status(id),
      start: () => (opts.startSeam === false ? null : start),
      toast: (text) => void toasts.push(text),
      timeouts: { turnMs: 300, exitMs: 300, readyMs: 400 },
    },
    store,
  );
  live = { backend, store, log, starts, toasts, failSetup: (reason) => failures.forEach((l) => l(reason)), switcher };
  return live;
}

const stateOf = (s: Setup) => s.store.getState().switching.get(READY);
async function confirming(s: Setup) {
  await vi.waitFor(() => expect(stateOf(s)?.phase).toBe('confirming'));
  return stateOf(s)!;
}
const CONFIRM: SwitchAnswer = { model: null, displayName: null, effort: null };

describe('switchRoute names background work, requires a Direct model for a gateway alias, rechecks before stop and runs interrupt, stop, start in order', () => {
  it('a turn open and no background work: interrupt, wait for the turn, re-read, stop, start direct, done on a verified direct status', async () => {
    const s = setup({ turn: true });
    const run = s.switcher.switchRoute(READY, 'direct');
    const sheet = await confirming(s);
    expect(sheet.confirm).toEqual({ target: 'direct', backgroundTasks: [], requiresModel: false, model: null, effort: null });
    expect(switchButtonLabel(sheet.confirm!)).toBe('Restart direct');
    expect(s.log, 'nothing but the status read before the answer').toEqual(['session.status']);
    s.switcher.answer(READY, CONFIRM);
    expect(await run).toBe('done');
    expect(s.log).toEqual(['session.status', 'session.queue.list', 'session.interrupt', 'session.status', 'session.stop', 'session.start', 'session.queue.list', 'session.queue.setPaused']);
    expect(s.starts).toEqual([{ appSessionId: READY, options: { gateway: 'direct' } }]);
    expect(stateOf(s)).toMatchObject({ phase: 'done', error: null });
    expect(s.toasts).toEqual(['Settings idle probe restarted direct']);
  });

  it('two background tasks: the confirm carries both, the button reads Stop them and switch, and nothing is called until it is pressed', async () => {
    const tasks = [task('t1', 'Sleep 120 s'), task('t2', 'Index the repository', 'local_workflow')];
    const s = setup({ tasks });
    const run = s.switcher.switchRoute(READY, 'direct');
    const sheet = await confirming(s);
    expect(sheet.confirm!.backgroundTasks).toEqual(tasks);
    expect(switchButtonLabel(sheet.confirm!)).toBe('Stop them and switch');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.log).toEqual(['session.status']);
    expect(s.starts).toEqual([]);
    s.switcher.answer(READY, null);
    expect(await run).toBe('cancelled');
    expect(stateOf(s)).toBeUndefined();
    expect(s.log).toEqual(['session.status']);
  });

  it('no turn and one active workflow: no interrupt, the workflow named, the status re-read before the stop, the stop only after the confirm', async () => {
    const s = setup({ tasks: [task('w1', 'Review pass', 'local_workflow')] });
    const run = s.switcher.switchRoute(READY, 'gateway');
    expect((await confirming(s)).confirm!.backgroundTasks.map((t) => t.description)).toEqual(['Review pass']);
    s.switcher.answer(READY, CONFIRM);
    expect(await run).toBe('done');
    expect(s.log).toEqual(['session.status', 'session.queue.list', 'session.status', 'session.stop', 'session.start', 'session.queue.list']);
    expect(s.starts[0].options).toEqual({ gateway: 'gateway' });
    expect(s.toasts).toEqual(['Settings idle probe restarted routed']);
  });

  it('work that started after the confirm returns the machine to the sheet with the new list and never stops; taskIds, not counts', async () => {
    const s = setup({ tasks: [task('t1', 'Sleep 120 s')] });
    const run = s.switcher.switchRoute(READY, 'direct');
    await confirming(s);
    // one task ended and another started: the count is the same, the ids are not
    s.backend.emitStatus(READY, { backgroundTasks: [task('t9', 'A new agent')] });
    s.switcher.answer(READY, CONFIRM);
    await vi.waitFor(() => expect(stateOf(s)?.confirm?.backgroundTasks.map((t) => t.taskId)).toEqual(['t9']));
    expect(stateOf(s)).toMatchObject({ phase: 'confirming', error: 'New background work started since you confirmed · check the list again' });
    expect(s.log).not.toContain('session.stop');
    s.switcher.answer(READY, null);
    expect(await run).toBe('cancelled');
    expect(s.log).not.toContain('session.stop');
    expect(s.starts).toEqual([]);
  });

  it('a gateway model requires a Claude model before anything stops, and the choice reaches session.start', async () => {
    const s = setup({ model: 'claude/astra', effort: 'max' });
    const run = s.switcher.switchRoute(READY, 'direct');
    expect((await confirming(s)).confirm).toMatchObject({ requiresModel: true, model: null });
    s.switcher.answer(READY, CONFIRM); // no model chosen: refused, still asking
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stateOf(s)?.phase).toBe('confirming');
    expect(s.log).toEqual(['session.status']);
    s.switcher.answer(READY, { model: 'sonnet', displayName: 'Sonnet 5', effort: 'high' });
    expect(await run).toBe('done');
    expect(s.starts).toEqual([{ appSessionId: READY, options: { gateway: 'direct', model: 'sonnet', effort: 'high' } }]);
    expect(s.toasts).toEqual(['Settings idle probe restarted direct · on Sonnet 5']);
  });

  it('reads the model to launch from the live status first, which the record is patched from', async () => {
    const s = setup();
    s.backend.emitStatus(READY, { model: { requested: 'claude/astra', resolved: 'gpt-5.5' } }); // the record still says sonnet
    const run = s.switcher.switchRoute(READY, 'direct');
    expect((await confirming(s)).confirm?.requiresModel).toBe(true);
    s.switcher.answer(READY, null);
    expect(await run).toBe('cancelled');
  });

  it('a chosen model whose levels admit the current effort passes no effort key; switching to the gateway asks for no model', async () => {
    const s = setup({ model: 'claude/astra' });
    const run = s.switcher.switchRoute(READY, 'direct');
    await confirming(s);
    s.switcher.answer(READY, { model: 'sonnet', displayName: 'Sonnet 5', effort: null });
    expect(await run).toBe('done');
    expect(s.starts[0].options).toEqual({ gateway: 'direct', model: 'sonnet' });

    const t = setup({ model: 'claude/astra' });
    const back = t.switcher.switchRoute(READY, 'gateway');
    expect((await confirming(t)).confirm).toMatchObject({ requiresModel: false });
    t.switcher.answer(READY, CONFIRM);
    expect(await back).toBe('done');
    expect(t.starts[0].options).toEqual({ gateway: 'gateway' });
  });

  it('a refused start is failed with the reason and never retried', async () => {
    const s = setup({ start: () => ({ status: 'refused', reason: 'Held by a terminal' }) });
    const run = s.switcher.switchRoute(READY, 'direct');
    await confirming(s);
    s.switcher.answer(READY, CONFIRM);
    expect(await run).toBe('failed');
    expect(s.starts).toHaveLength(1);
    expect(stateOf(s)).toMatchObject({ phase: 'failed', error: 'Stopped; the restart was refused: Held by a terminal · Resume from the sidebar' });
    expect(s.toasts).toEqual([]);
  });

  it('a setup failure after starting, or a mismatched route, is failed', async () => {
    const s = setup({ start: () => 'no_ready' });
    const run = s.switcher.switchRoute(READY, 'direct');
    await confirming(s);
    s.switcher.answer(READY, CONFIRM);
    await vi.waitFor(() => expect(s.starts).toHaveLength(1));
    s.failSetup('The relay was unreachable');
    expect(await run).toBe('failed');
    expect(stateOf(s)?.error).toBe('Stopped; the restart was refused: The relay was unreachable · Resume from the sidebar');

    const m = setup({ start: () => 'no_ready' });
    const mismatch = m.switcher.switchRoute(READY, 'direct');
    await confirming(m);
    m.switcher.answer(READY, CONFIRM);
    await vi.waitFor(() => expect(m.starts).toHaveLength(1));
    m.backend.emitStatus(READY, { process: 'ready', launchId: 'launch-2', exit: null, gateway: { mode: 'direct', baseUrl: null, verified: 'mismatch', autoModeServer: 'unknown', localLane: null } });
    expect(await mismatch).toBe('failed');
    expect(stateOf(m)?.error).toBe('Restarted, but the route reads unverified (asked for Direct) · check Session info');
  });

  it('a restart that never becomes ready is failed after its bound', async () => {
    const s = setup({ start: () => 'no_ready' });
    const run = s.switcher.switchRoute(READY, 'direct');
    await confirming(s);
    s.switcher.answer(READY, CONFIRM);
    expect(await run).toBe('failed');
    expect(stateOf(s)?.error).toBe('Stopped; the restart did not become ready within 60 s · Resume from the sidebar');
  });

  it('refuses a second switch while one is in flight, and every switch without C10’s start', async () => {
    const s = setup();
    const run = s.switcher.switchRoute(READY, 'direct');
    await confirming(s);
    expect(await s.switcher.switchRoute(READY, 'direct')).toBe('failed');
    expect(s.toasts).toEqual(['This session is already switching routes']);
    expect(stateOf(s)?.phase).toBe('confirming');
    s.switcher.answer(READY, null);
    expect(await run).toBe('cancelled');

    const none = setup({ startSeam: false });
    expect(await none.switcher.switchRoute(READY, 'direct')).toBe('failed');
    expect(none.log).toEqual([]);
    expect(none.toasts).toEqual(['Switching routes arrives with C10']);
  });
});

describe('the queue after a switch', () => {
  it('a turn open and a running queue: resumed once at done', async () => {
    const s = setup({ turn: true });
    const run = s.switcher.switchRoute(READY, 'direct');
    await confirming(s);
    s.switcher.answer(READY, CONFIRM);
    expect(await run).toBe('done');
    expect(s.log.filter((c) => c === 'session.queue.setPaused')).toHaveLength(1);
    expect(await s.backend.answer('session.queue.list', { appSessionId: READY })).toMatchObject({ paused: false, pauseReason: null });
  });

  it('a queue the human paused before the switch is left paused', async () => {
    const s = setup({ turn: true });
    await s.backend.answer('session.queue.setPaused', { appSessionId: READY, paused: true });
    const run = s.switcher.switchRoute(READY, 'direct');
    await confirming(s);
    s.switcher.answer(READY, CONFIRM);
    expect(await run).toBe('done');
    expect(s.log).not.toContain('session.queue.setPaused');
  });

  it('a pause whose reason changed during the restart is left alone', async () => {
    let unscript: (() => void) | null = null;
    const s = setup({
      turn: true,
      start: () => {
        unscript = live!.backend.script('session.queue.list', () => ({ entries: [], paused: true, pauseReason: 'refused' }));
        return { status: 'starting' };
      },
    });
    const run = s.switcher.switchRoute(READY, 'direct');
    await confirming(s);
    s.switcher.answer(READY, CONFIRM);
    expect(await run).toBe('done');
    expect(s.log).not.toContain('session.queue.setPaused');
    (unscript as (() => void) | null)?.();
  });
});
