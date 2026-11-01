// Main's remote lane B adapter over a fake link (P5 O7 M2, "Acts", "Outcomes as results", "Reads", "Subscriptions follow
// the tabs"; Interfaces §J): the router's names it takes, the two act shapes, the resume behind an act on a session with
// no status, sends one at a time under the pending bound, the substitutes for two reads the pane makes, and the tabs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import type { SessionEvent } from '@shared/graph/events';
import { requestDigestOf } from '@shared/host/request-digest';
import type { CommandName, CommandResult, EventName } from '@shared/ipc/schema';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import { validateEventPayload } from '@shared/ipc/validate';
import { BUILTIN_MODELS } from '@shared/sessions/models';
import { record, status } from '../../../test/support/builders';
import { FakeLink, MINI, type FakeAct } from '../../../test/lane-b/fake-link';
import type { MainContext } from '../ipc/router';
import { createRemoteLaneB, routeLaneB, type RemoteLaneB } from './remote';
import { UNRESOLVED_MAX } from './remote-spawn';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;
const APP = 'app-1';
const statusOf = (app: string, launch: string, cwd = `/work/${app}`) => ({ ...status(app), launchId: launch, engineSessionId: `eng-${app}`, cwd });
const tabsOf = (...apps: string[]) => {
  const tabs = apps.map((app) => ({ id: `session:${addressOf(MINI, app as AppSessionId)}`, kind: 'session', appSessionId: addressOf(MINI, app as AppSessionId), pinned: false }));
  return { version: 3, current: NO_PROJECT, sets: { [NO_PROJECT]: { panes: [{ tabs, activeTabId: tabs[0]?.id ?? '' }], focusedPane: 0, splitRatio: 0.5 } }, closedTabs: [] };
};
const permission: SessionEvent = { id: `${APP}:L1:3:0`, sessionId: `eng-${APP}`, at: '2026-10-31T00:00:00.000Z', seq: 3, agentId: null, parentToolUseId: null, kind: 'permission.requested', requestId: 'req-1', toolUseId: 'tu-1', toolName: 'Bash', displayName: null, input: { command: 'ls' }, description: null, decisionReasonType: null, suggestions: [], blockedPath: null } as unknown as SessionEvent;

function lab(options: { tabs?: string[]; timing?: Parameters<typeof createRemoteLaneB>[0]['timing']; laneA?: string[] } = {}) {
  const link = new FakeLink();
  let links: Map<MachineRef, FakeLink> = new Map([[MINI, link]]);
  const remoteListeners = new Set<(machines: readonly MachineRef[]) => void>();
  const layoutListeners = new Set<(key: string) => void>();
  let tabs: unknown = tabsOf(...(options.tabs ?? [APP]));
  const emitted: Array<{ machine: MachineRef; name: EventName; payload: Record<string, unknown> }> = [];
  const logs: string[] = [];
  link.answers.set('session.get', (input) => ({ ok: true, output: record(String(input.appSessionId)) }));
  const adapter: RemoteLaneB = createRemoteLaneB({
    local: LOCAL,
    layout: { get: (key) => (key === 'main.tabs' ? tabs : null), onChange: (listener) => (layoutListeners.add(listener), () => void layoutListeners.delete(listener)) },
    remote: (machine) => links.get(machine) ?? null,
    onRemote: (listener) => (remoteListeners.add(listener), () => void remoteListeners.delete(listener)),
    emit: (machine, name, payload) => {
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      emitted.push({ machine, name, payload: payload as Record<string, unknown> });
    },
    laneOf: (machine, session) => (machine === MINI && options.laneA?.includes(session) ? 'A' : null),
    timing: { sendPendingMs: 60_000, ...options.timing },
    log: (line) => void logs.push(line),
  });
  const base: string[] = [];
  const route = routeLaneB(async (_m, name) => (base.push(name), { ok: true, value: 'base' }) as unknown as CommandResult<CommandName>, (m) => links.get(m) ?? null, adapter);
  const ctx: MainContext = { client: endableClientRef('page-1'), target: MINI };
  return {
    link,
    adapter,
    emitted,
    logs,
    base,
    route,
    cmd: (name: string, input: unknown, machine: MachineRef = MINI) => route(machine, name as CommandName, input, ctx),
    // M4c fix wave 2: a command made from a tab (the envelope's session: a spawn's New chat tab)
    cmdFrom: (name: string, input: unknown, from: string, client: MainContext['client'] = ctx.client) => route(MINI, name as CommandName, input, { ...ctx, client, session: from as AppSessionId }),
    setTabs(...apps: string[]) {
      tabs = tabsOf(...apps);
      for (const listener of layoutListeners) listener('main.tabs');
    },
    setLinks(next: Map<MachineRef, FakeLink>) {
      links = next;
      for (const listener of remoteListeners) listener([...next.keys()]);
    },
    of: (name: EventName) => emitted.filter((e) => e.name === name).map((e) => e.payload),
  };
}

/** The session's stream live on `launch`: its record read, its subscription's snapshot delivered. */
async function live(l: ReturnType<typeof lab>, app = APP, launch = 'L1') {
  await vi.advanceTimersByTimeAsync(0);
  const sub = l.link.open().find((s) => s.request.session.id === app)!;
  sub.sink.subbed('snapshot', { epoch: launch, seq: 0 });
  sub.sink.snapshot({ epoch: launch, seq: 0 }, { status: statusOf(app, launch) });
  return sub;
}

const settleWith = (outcome: Parameters<FakeAct['settle']>[0]) => (act: FakeAct) => act.settle(outcome);

describe('routeLaneB', () => {
  it('takes the acts and substitutes for a machine an RL2 link reaches; everything else, and any name for another machine, goes on', async () => {
    const l = lab();
    expect(await l.cmd('session.status', { appSessionId: APP })).toEqual({ ok: true, value: 'base' });
    expect(await l.cmd('session.queue.list', { appSessionId: APP })).toEqual({ ok: true, value: 'base' });
    expect(await l.cmd('session.interrupt', { appSessionId: APP, cancelEngineQueued: false }, OTHER)).toEqual({ ok: true, value: 'base' });
    expect(l.base).toEqual(['session.status', 'session.queue.list', 'session.interrupt']);
    for (const name of ['session.send', 'session.steer', 'session.interrupt', 'session.answer', 'session.queue.edit', 'session.setModel', 'session.acquire', 'attention.request', 'engine.models'] as CommandName[]) {
      expect(l.adapter.handles(name), name).toBe(true);
    }
    expect(l.adapter.handles('session.events')).toBe(true); // read in pages the channel carries
    for (const name of ['session.status', 'session.get', 'session.update', 'session.drafts.get', 'laneA.send'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(false);
  });
});

describe('acts', () => {
  it('builds an engine-host act with the session, the live launch’s context and the input as its args, and answers its outcome', async () => {
    const l = lab();
    await live(l);
    l.link.onAct = settleWith({ state: 'done', result: { stillQueued: [], cancelled: [] } });
    expect(await l.cmd('session.interrupt', { appSessionId: APP, cancelEngineQueued: true })).toEqual({ ok: true, value: { stillQueued: [], cancelled: [] } });
    expect(l.link.acts.map((a) => a.request)).toEqual([
      { action: 'session.interrupt', session: APP, context: { lane: 'B', launchId: 'L1', engineSessionId: `eng-${APP}` }, args: { appSessionId: APP, cancelEngineQueued: true }, executor: 'engine-host', sendBy: expect.any(Number) },
    ]);
  });

  it('seals an answer with the request digest drawn from the pending request it reads; a request no longer pending answers `not_pending` with no act', async () => {
    const l = lab();
    await live(l);
    l.link.answers.set('session.pendingRequest', (input) => ({ ok: true, output: { event: input.requestId === 'req-1' ? permission : null } }));
    l.link.onAct = settleWith({ state: 'done', result: { outcome: 'delivered' } });
    const answer = { kind: 'permission', decision: 'allow', scope: 'once' };
    expect(await l.cmd('session.answer', { appSessionId: APP, requestId: 'req-1', answer })).toEqual({ ok: true, value: { outcome: 'delivered' } });
    expect(l.link.acts[0].request).toMatchObject({ action: 'session.answer', requestDigest: requestDigestOf(APP, permission), args: { appSessionId: APP, requestId: 'req-1', answer } });
    expect(await l.cmd('session.answer', { appSessionId: APP, requestId: 'req-gone', answer })).toEqual({ ok: true, value: { outcome: 'not_pending' } });
    expect(l.link.acts).toHaveLength(1);
  });

  it('builds `session.acquire` as a `machine` act, with neither a session nor a context; its ready outcome subscribes an idle session at once', async () => {
    const l = lab();
    const sub = await live(l);
    sub.sink.ended('unavailable');
    l.link.onAct = settleWith({ state: 'done', result: { status: 'ready', appSessionId: APP, launched: true, joined: false } });
    expect(await l.cmd('session.acquire', { appSessionId: APP, reason: 'send' })).toEqual({ ok: true, value: { status: 'ready', appSessionId: APP, launched: true, joined: false } });
    expect(l.link.acts[0].request).toEqual({ action: 'session.acquire', args: { appSessionId: APP, reason: 'send' }, executor: 'machine', sendBy: expect.any(Number) });
    expect(l.link.open()).toHaveLength(1); // no backoff waited
  });

  it('resumes a session with no status before its act: `session.acquire`, then the act sealed with the resumed launch’s first status', async () => {
    const l = lab();
    await vi.advanceTimersByTimeAsync(0);
    const sub = l.link.open()[0];
    sub.sink.ended('unavailable'); // released: placed by its record, not live
    l.link.onAct = (act) => {
      if (act.request.action === 'session.acquire') return act.settle({ state: 'done', result: { status: 'ready', appSessionId: APP, launched: true, joined: false } });
      act.settle({ state: 'done', result: { messageUuid: null, disposition: 'sent', queueId: 'q1' } });
    };
    const sending = l.cmd('session.send', { appSessionId: APP, content: 'wake up' });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts.map((a) => a.request.action)).toEqual(['session.acquire']);
    const resumed = l.link.open()[0];
    resumed.sink.subbed('snapshot', { epoch: 'L2', seq: 0 });
    resumed.sink.snapshot({ epoch: 'L2', seq: 0 }, { status: statusOf(APP, 'L2') });
    expect(await sending).toEqual({ ok: true, value: { messageUuid: null, disposition: 'sent', queueId: 'q1' } });
    expect(l.link.acts.map((a) => a.request)).toEqual([
      { action: 'session.acquire', args: { appSessionId: APP, reason: 'send' }, executor: 'machine', sendBy: expect.any(Number) },
      { action: 'session.send', session: APP, context: { lane: 'B', launchId: 'L2', engineSessionId: `eng-${APP}` }, args: { appSessionId: APP, content: 'wake up' }, executor: 'engine-host', sendBy: expect.any(Number) },
    ]);
  });

  it('resumes a session whose launch exited with its row kept (a crash, a stop, a release) instead of sealing the act to it, and waits for the new launch’s `ready`', async () => {
    const l = lab();
    const sub = await live(l);
    const exited = { ...statusOf(APP, 'L1'), process: 'exited', exit: { code: 0, signal: null, reason: 'stop', at: '2026-10-31T00:00:00.000Z', release: null } };
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { status: exited });
    l.link.onAct = (act) => {
      if (act.request.action === 'session.acquire') return act.settle({ state: 'done', result: { status: 'ready', appSessionId: APP, launched: true, joined: false } });
      act.settle({ state: 'done', result: { messageUuid: null, disposition: 'sent', queueId: 'q1' } });
    };
    const sending = l.cmd('session.send', { appSessionId: APP, content: 'after the exit' });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts.map((a) => a.request.action)).toEqual(['session.acquire']);
    // The relaunch is starting: still not sealed.
    sub.sink.subbed('snapshot', { epoch: 'L2', seq: 0 });
    sub.sink.snapshot({ epoch: 'L2', seq: 0 }, { status: { ...statusOf(APP, 'L2'), process: 'starting' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts.map((a) => a.request.action)).toEqual(['session.acquire']);
    sub.sink.snapshot({ epoch: 'L2', seq: 0 }, { status: statusOf(APP, 'L2') });
    expect(await sending).toEqual({ ok: true, value: { messageUuid: null, disposition: 'sent', queueId: 'q1' } });
    expect(l.link.acts[1].request).toMatchObject({ action: 'session.send', context: { lane: 'B', launchId: 'L2', engineSessionId: `eng-${APP}` } });
  });

  it('waits for a launch already `starting` to be `ready`, with no resume of its own', async () => {
    const l = lab();
    const sub = await live(l);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { status: { ...statusOf(APP, 'L1'), process: 'initializing' } });
    l.link.onAct = settleWith({ state: 'done', result: { stillQueued: [], cancelled: [] } });
    const interrupting = l.cmd('session.interrupt', { appSessionId: APP, cancelEngineQueued: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(l.link.acts).toEqual([]);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { status: statusOf(APP, 'L1') });
    expect(await interrupting).toEqual({ ok: true, value: { stillQueued: [], cancelled: [] } });
    expect(l.link.acts.map((a) => a.request.action)).toEqual(['session.interrupt']);
  });

  it('answers a resume the machine refused, or one whose status never comes within the bound, with nothing sent', async () => {
    const l = lab({ timing: { sendPendingMs: 5000 } });
    await vi.advanceTimersByTimeAsync(0);
    l.link.open()[0].sink.ended('unavailable');
    l.link.onAct = settleWith({ state: 'done', result: { status: 'archived', appSessionId: APP } });
    expect(await l.cmd('session.send', { appSessionId: APP, content: 'hi' })).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'archived' } } });
    l.link.onAct = settleWith({ state: 'done', result: { status: 'ready', appSessionId: APP, launched: false, joined: true } });
    const sending = l.cmd('session.send', { appSessionId: APP, content: 'hi' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await sending).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini didn’t resume the session in time' } });
    expect(l.link.acts.filter((a) => a.request.action === 'session.send')).toEqual([]);
  });

  it('refuses an act on a session no tab holds: open the session to drive it', async () => {
    const l = lab({ tabs: [] });
    expect(await l.cmd('session.interrupt', { appSessionId: APP, cancelEngineQueued: false })).toEqual({ ok: false, error: { code: 'internal', message: 'session.interrupt: open the session to drive it', issues: { refusal: 'not-open' } } });
    expect(l.link.acts).toEqual([]);
  });
});

describe('sends', () => {
  it('sends one at a time: the next act is made only at the one before’s outcome; an interrupt and an answer never wait; past eight waiting, refused', async () => {
    const l = lab();
    await live(l);
    l.link.answers.set('session.pendingRequest', () => ({ ok: true, output: { event: permission } }));
    const first = l.cmd('session.send', { appSessionId: APP, content: 'one' });
    const second = l.cmd('session.steer', { appSessionId: APP, content: 'two', priority: 'next' });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts.map((a) => a.request.action)).toEqual(['session.send']);
    const interrupting = l.cmd('session.interrupt', { appSessionId: APP, cancelEngineQueued: false });
    const answering = l.cmd('session.answer', { appSessionId: APP, requestId: 'req-1', answer: { kind: 'permission', decision: 'deny' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts.map((a) => a.request.action)).toEqual(['session.send', 'session.interrupt', 'session.answer']);
    l.link.acts[1].settle({ state: 'done', result: { stillQueued: [], cancelled: [] } });
    l.link.acts[2].settle({ state: 'done', result: { outcome: 'delivered' } });
    expect(await interrupting).toMatchObject({ ok: true });
    expect(await answering).toMatchObject({ ok: true });
    const waiting = Array.from({ length: 7 }, (_, i) => l.cmd('session.send', { appSessionId: APP, content: `w${i}` }));
    expect(await l.cmd('session.send', { appSessionId: APP, content: 'too many' })).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'busy' } } });
    l.link.acts[0].settle({ state: 'done', result: { messageUuid: null, disposition: 'sent', queueId: 'q1' } });
    expect(await first).toMatchObject({ ok: true, value: { queueId: 'q1' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts.map((a) => a.request.action)).toEqual(['session.send', 'session.interrupt', 'session.answer', 'session.steer']);
    l.link.onAct = settleWith({ state: 'done', result: { messageUuid: null, disposition: 'sent', queueId: 'q' } });
    l.link.acts[3].settle({ state: 'done', result: { messageUuid: 'm-2' } });
    expect(await second).toEqual({ ok: true, value: { messageUuid: 'm-2' } });
    expect((await Promise.all(waiting)).every((r) => r.ok)).toBe(true);
  });

  it('answers a send the channel carried at the pending bound with the pending words, lets the next go, and logs the late outcome', async () => {
    const l = lab();
    await live(l);
    const first = l.cmd('session.send', { appSessionId: APP, content: 'lost' });
    const second = l.cmd('session.send', { appSessionId: APP, content: 'next' });
    await vi.advanceTimersByTimeAsync(0);
    l.link.acts[0].move('unknown');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await first).toEqual({ ok: false, error: { code: 'timeout', message: 'mini took the message but hasn’t confirmed it; check the transcript' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts.map((a) => a.request.args)).toEqual([{ appSessionId: APP, content: 'lost' }, { appSessionId: APP, content: 'next' }]);
    l.link.acts[1].settle({ state: 'done', result: { messageUuid: null, disposition: 'sent', queueId: 'q2' } });
    expect(await second).toMatchObject({ ok: true });
    l.link.acts[0].settle({ state: 'done', result: { messageUuid: null, disposition: 'sent', queueId: 'q1' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.logs.some((line) => line.includes('settled late') && line.includes('done'))).toBe(true);
  });

  it('gives an act never put on a channel the bound as its `sendBy`, so the link’s hold ends it there: A4’s words', async () => {
    const l = lab();
    await live(l);
    l.link.onAct = (act) => act.move('waiting');
    const made = Date.now();
    const sending = l.cmd('session.send', { appSessionId: APP, content: 'offline' });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts[0].request.sendBy).toBe(made + 60_000);
    let answered = false;
    void sending.then(() => (answered = true));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await sending).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini is offline' } });
  });

  it('keeps a resumed send inside the original bound: the resume’s time is not given back, and a send made at the bound is not made', async () => {
    const l = lab({ timing: { sendPendingMs: 1000 } });
    await vi.advanceTimersByTimeAsync(0);
    l.link.open()[0].sink.ended('unavailable');
    const made = Date.now();
    const sending = l.cmd('session.send', { appSessionId: APP, content: 'hello' });
    await vi.advanceTimersByTimeAsync(900);
    expect(l.link.acts.map((a) => a.request.action)).toEqual(['session.acquire']);
    l.link.acts[0].settle({ state: 'done', result: { status: 'ready', appSessionId: APP, launched: true, joined: false } });
    l.link.onAct = (act) => act.move('waiting'); // the channel drops as the send is made
    await vi.advanceTimersByTimeAsync(0);
    const resumed = l.link.open()[0];
    resumed.sink.subbed('snapshot', { epoch: 'L2', seq: 0 });
    resumed.sink.snapshot({ epoch: 'L2', seq: 0 }, { status: statusOf(APP, 'L2') });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts[1].request).toMatchObject({ action: 'session.send', sendBy: made + 1000 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await sending).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini is offline' } });
    expect(l.link.acts[1].settled).toEqual({ state: 'refused', reason: 'offline' });

    // A resume whose first status comes only at the bound: the send is not made at all.
    l.link.onAct = () => {};
    resumed.sink.ended('unavailable');
    const late = l.cmd('session.send', { appSessionId: APP, content: 'too late' });
    await vi.advanceTimersByTimeAsync(0);
    const acquire = l.link.acts.at(-1)!;
    expect(acquire.request.action).toBe('session.acquire');
    await vi.advanceTimersByTimeAsync(999);
    acquire.settle({ state: 'done', result: { status: 'ready', appSessionId: APP, launched: false, joined: true } });
    await vi.advanceTimersByTimeAsync(1);
    expect(await late).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini didn’t resume the session in time' } });
    expect(l.link.acts.filter((a) => a.request.action === 'session.send')).toHaveLength(1);
  });

  it('answers an act put on a channel just before the bound with the pending words at the bound', async () => {
    const l = lab();
    await live(l);
    l.link.onAct = (act) => act.move('waiting');
    const sending = l.cmd('session.send', { appSessionId: APP, content: 'late channel' });
    await vi.advanceTimersByTimeAsync(59_900);
    l.link.acts[0].move('sent');
    await vi.advanceTimersByTimeAsync(100);
    expect(await sending).toMatchObject({ ok: false, error: { code: 'timeout', message: 'mini took the message but hasn’t confirmed it; check the transcript' } });
    expect(l.link.acts[0].settled).toBeNull();
  });
});

describe('the substitutes', () => {
  it('answers `attention.request` from `session.pendingRequest` over the link', async () => {
    const l = lab();
    l.link.answers.set('session.pendingRequest', () => ({ ok: true, output: { event: permission } }));
    expect(await l.cmd('attention.request', { appSessionId: APP, requestId: 'req-1' })).toEqual({ ok: true, value: { event: permission } });
    expect(l.link.calls.at(-1)).toEqual({ name: 'session.pendingRequest', input: { appSessionId: APP, requestId: 'req-1' } });
  });

  it('answers `engine.models` from `session.listModels` of a live session there, the one in the asked directory first; else the built-in list', async () => {
    const l = lab({ tabs: [APP, 'app-2'] });
    expect(await l.cmd('engine.models', { refresh: false })).toEqual({ ok: true, value: { models: [...BUILTIN_MODELS], source: 'builtin', at: null } });
    await live(l, APP);
    await live(l, 'app-2');
    const models = [{ value: 'opus', resolvedModel: 'claude-opus', displayName: 'Opus', description: 'the big one' }];
    l.link.answers.set('session.listModels', () => ({ ok: true, output: { models } }));
    expect(await l.cmd('engine.models', { refresh: false, gateway: 'gateway', cwd: '/work/app-2' })).toEqual({ ok: true, value: { models, source: 'live', at: expect.any(String) } });
    expect(l.link.calls.at(-1)).toEqual({ name: 'session.listModels', input: { appSessionId: 'app-2' } });
  });
});

describe('session.events', () => {
  it('reads a launch too large for one answer in pages over the link, a row that can’t cross told as a gap at its place in the held launch', async () => {
    const l = lab();
    await live(l);
    const row = (seq: number) => [{ ...permission, id: `${APP}:L1:${seq}:0`, seq, requestId: `req-${seq}` }];
    l.link.answers.set('session.events', (input) => {
      if (input.limit === null) return { ok: false, error: { code: 'too-large' } };
      const after = (input.afterSeq as number | null) ?? 0;
      if (after === 1) return { ok: false, error: { code: 'too-large' } }; // row 2, alone
      return { ok: true, output: { events: row(after + 1), lastSeq: after + 1, complete: after + 1 === 3 } };
    });
    expect(await l.cmd('session.events', { appSessionId: APP, afterSeq: null, limit: null })).toEqual({ ok: true, value: { events: [...row(1), ...row(3)], lastSeq: 3, complete: true } });
    expect(l.of('remote.gap')).toEqual([{ appSessionId: APP, launchId: 'L1', at: { seq: 2 } }]);
    expect(l.base).toEqual([]); // not the manager's one call
  });

  it('says an older page too large for the channel is why its answer is history unavailable, before answering', async () => {
    const l = lab();
    await live(l);
    l.link.answers.set('session.events', () => ({ ok: false, error: { code: 'too-large' } }));
    expect(await l.cmd('session.events', { appSessionId: APP, afterSeq: null, limit: null, before: `${APP}:L1:9:0` })).toMatchObject({ ok: true, value: { events: [], historyUnavailable: true } });
    expect(l.of('remote.historyTooLarge')).toEqual([{ appSessionId: APP, window: 'older' }]);
  });
});

describe('the tabs and the links', () => {
  it('subscribes while a tab holds the session and lets it go ten seconds after its last tab closed', async () => {
    const l = lab();
    await live(l);
    l.setTabs();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(l.link.open()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(l.link.open()).toHaveLength(0);
    expect(await l.cmd('session.interrupt', { appSessionId: APP, cancelEngineQueued: false })).toMatchObject({ ok: false, error: { issues: { refusal: 'not-open' } } });
  });

  it('ends a machine’s sessions when its link closes, saying so', async () => {
    const l = lab();
    const sub = await live(l);
    l.setLinks(new Map());
    expect(sub.closed).toBe(true);
    expect(l.of('remote.session').at(-1)).toMatchObject({ address: APP, stream: 'ended', reason: 'the link to mini closed' });
  });

  it('never places a tab of a session the org rows list as lane A: no record read, no subscription', async () => {
    const l = lab({ tabs: ['la-1', APP], laneA: ['la-1'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.calls.map((c) => (c.input as { appSessionId: string }).appSessionId)).toEqual([APP]);
    expect(l.link.open().map((s) => s.request.session.id)).toEqual([APP]);
  });

  it('says a held session’s state again after a page’s `session.get` of it, for a page that just subscribed (a reload, a second window)', async () => {
    const l = lab();
    const sub = await live(l);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { queue: { entries: [], paused: false, pauseReason: null }, pendingItems: [], catalog: { commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 1 } });
    const said = l.emitted.length;
    expect(await l.cmd('session.get', { appSessionId: APP })).toEqual({ ok: true, value: 'base' }); // the read itself is the manager's
    expect(l.emitted.slice(said).map((e) => e.name)).toEqual(['session.changed', 'session.status', 'session.queue', 'session.catalogChanged', 'attention.changed', 'remote.session']);
    expect(l.emitted.at(-1)!.payload).toMatchObject({ address: APP, stream: 'live', reason: null });
    // Nothing for a session this app doesn't hold, or another machine's.
    const before = l.emitted.length;
    await l.cmd('session.get', { appSessionId: 'app-elsewhere' });
    await l.cmd('session.get', { appSessionId: APP }, OTHER);
    expect(l.emitted).toHaveLength(before);
  });

  it('stops: every subscription closed', async () => {
    const l = lab();
    const sub = await live(l);
    l.adapter.stop();
    expect(sub.closed).toBe(true);
  });
});

// P5 O7 M4: the checkout's writes, uploads in parts, the spawn, and the byte budget, each from the adapter's side.
describe('the checkout and the spawn (M4)', () => {
  const MiB = 1024 * 1024;
  const UPLOADS = '/work/app-1/.claude/desk-uploads/app-1';

  it('takes the checkout’s writes, the spawn, the watches and `files.read` (in pages); the checkout’s other reads stay the manager’s', () => {
    const l = lab();
    for (const name of ['files.write', 'files.upload', 'scm.stage', 'scm.commit', 'scm.push', 'scm.pr.create', 'scm.remote.cancel', 'session.spawn', 'git.watch', 'git.unwatch', 'files.watch', 'files.unwatch', 'files.read'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(true);
    for (const name of ['git.status', 'git.diff', 'files.list', 'scm.status', 'session.projects.list', 'fs.agentEvents'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(false);
  });

  it('builds a checkout write as a `machine` act with neither a session nor a context, on a session no tab holds and with no status', async () => {
    const l = lab({ tabs: [] });
    l.link.onAct = settleWith({ state: 'refused', reason: 'grade' });
    const write = { appSessionId: APP, path: 'README.md', content: 'hello\n', expectedHash: '0'.repeat(64) };
    expect(await l.cmd('files.write', write)).toMatchObject({ ok: false, error: { issues: { refusal: 'grade' } } });
    expect(l.link.acts.map((a) => a.request)).toEqual([{ action: 'files.write', args: write, executor: 'machine', sendBy: expect.any(Number) }]);
    expect(l.link.acts.some((a) => a.request.action === 'session.acquire')).toBe(false); // not resumed
  });

  it('uploads a 5 MiB file in three parts, each its own act in order, telling the chip how far it has come, and answers the machine’s path', async () => {
    const l = lab();
    l.link.onAct = (act) => {
      const { part } = act.request.args as { part: { index: number; last: boolean } };
      act.settle({ state: 'done', result: { status: 'ok', paths: part.last ? [`${UPLOADS}/u.0.pdf`] : [] } });
    };
    const bytes = Buffer.alloc(5 * MiB, 3);
    expect(await l.cmd('files.upload', { appSessionId: APP, files: [{ name: 'spec.pdf', bytes: bytes.toString('base64') }] })).toEqual({ ok: true, value: { status: 'ok', paths: [`${UPLOADS}/u.0.pdf`] } });
    const parts = l.link.acts.map((a) => a.request);
    expect(parts.map((p) => [p.action, p.executor, p.session, p.context])).toEqual(Array(3).fill(['files.upload', 'machine', undefined, undefined]));
    const args = parts.map((p) => p.args as { part: { upload: string; index: number; last: boolean }; files: Array<{ name: string; bytes: string }> });
    expect(args.map((a) => [a.part.index, a.part.last])).toEqual([[0, false], [1, false], [2, true]]);
    expect(new Set(args.map((a) => a.part.upload)).size).toBe(1);
    expect(Buffer.concat(args.map((a) => Buffer.from(a.files[0].bytes, 'base64'))).equals(bytes)).toBe(true);
    expect(args.map((a) => Buffer.from(a.files[0].bytes, 'base64').length)).toEqual([2 * MiB, 2 * MiB, MiB]);
    expect(l.of('remote.upload')).toEqual([0, 1, 2, 3].map((sent) => ({ appSessionId: APP, file: 0, name: 'spec.pdf', sent, parts: 3 })));
  });

  it('ends an upload at a part the machine refused, sending no part after it, and runs one upload at a time per session', async () => {
    const l = lab();
    const held: FakeAct[] = [];
    l.link.onAct = (act) => void held.push(act);
    const file = (name: string) => ({ appSessionId: APP, files: [{ name, bytes: Buffer.alloc(3 * MiB, 1).toString('base64') }] });
    const first = l.cmd('files.upload', file('a.bin'));
    const second = l.cmd('files.upload', file('b.bin'));
    await vi.advanceTimersByTimeAsync(0);
    expect(held.map((a) => (a.request.args as { files: Array<{ name: string }> }).files[0].name)).toEqual(['a.bin']);
    held[0].settle({ state: 'done', result: { status: 'refused', reason: 'part out of order' } });
    expect(await first).toEqual({ ok: true, value: { status: 'refused', reason: 'part out of order' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(held.map((a) => (a.request.args as { files: Array<{ name: string }> }).files[0].name)).toEqual(['a.bin', 'b.bin']);
    held[1].settle({ state: 'refused', reason: 'not-offered' });
    expect(await second).toMatchObject({ ok: false, error: { issues: { refusal: 'not-offered' } } });
    expect(held).toHaveLength(2);
  });

  it('builds the spawn as a stepped-up `machine` act on the machine, its bound running only from the moment it went out', async () => {
    const l = lab({ tabs: [] });
    let act!: FakeAct;
    l.link.onAct = (a) => {
      act = a;
      a.move('waiting'); // at the sheet and Touch ID
    };
    const spawn = { checkout: '/work/repo', permission_mode: 'default', brief: 'go' };
    let answer: unknown = null;
    void l.cmd('session.spawn', spawn).then((r) => (answer = r));
    await vi.advanceTimersByTimeAsync(0);
    expect(act.request).toEqual({ action: 'session.spawn', args: spawn, executor: 'machine', stepUp: 'required' });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(answer).toBeNull(); // the person's time at the sheet is not the machine's
    act.move('sent');
    await vi.advanceTimersByTimeAsync(209_999);
    expect(answer).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toMatchObject({ ok: false, error: { code: 'timeout', message: 'mini took the request but hasn’t confirmed it' } });
  });

  // The architect's ruling on M4d's gap: a session this app spawned waits a minute for the machine to list it.
  it('opens a session this app spawned waiting for the machine to list it, lets the wait go at its first open, and leaves another session as it was', async () => {
    const l = lab({ tabs: [] });
    let listed = false;
    l.link.answers.set('session.get', (input) => (input.appSessionId === 'app-new' && listed ? { ok: true, output: record('app-new') } : { ok: false, error: { code: 'grade' } }));
    l.link.onAct = settleWith({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
    expect(await l.cmd('session.spawn', { checkout: '/work/repo', permission_mode: 'default' })).toEqual({ ok: true, value: { status: 'ok', appSessionId: 'app-new' } });
    const reasonOf = (app: string) => l.of('remote.session').filter((p) => p.address === app).at(-1)?.reason;
    l.setTabs('app-new', 'app-other');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reasonOf('app-new')).toBe('Waiting for mini to list the new session…');
    expect(reasonOf('app-other')).toBe('mini can’t place this session'); // not spawned here: given up after 7.5 s
    listed = true;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(reasonOf('app-new')).toBeNull();
    // the wait let go: a later open of it is any session's
    listed = false;
    l.setTabs();
    await vi.advanceTimersByTimeAsync(60_000);
    l.setTabs('app-new');
    await vi.advanceTimersByTimeAsync(0);
    expect(reasonOf('app-new')).toBe('Opening on mini…');
  });

  // M4c fix wave 2 (the architect's rulings): a New chat tab's spawn is one attempt, kept by the tab it is made from (the
  // envelope's session), whatever input its next ask carries; a terminal unknown is said, never a pending start; an
  // outcome nobody waited for is kept as its answer alone.
  describe('a spawn’s attempt, by the tab it is made from', () => {
    const TAB = 'new-1';
    const spawn = { checkout: '/work/repo', permission_mode: 'default', brief: 'go' };
    const timedOut = async (l: ReturnType<typeof lab>, from = TAB, input: unknown = spawn) => {
      const asked = l.cmdFrom('session.spawn', input, from);
      await vi.advanceTimersByTimeAsync(210_000);
      expect(await asked).toMatchObject({ ok: false, error: { code: 'timeout' } });
    };

    it('answers the tab’s next ask from the same act, whatever its input, and starts one session', async () => {
      const l = lab({ tabs: [] });
      l.link.onAct = (a) => a.move('sent');
      await timedOut(l);
      let answer: unknown = null;
      void l.cmdFrom('session.spawn', { ...spawn, brief: 'go, and test it' }, TAB).then((r) => (answer = r)); // edited since
      await vi.advanceTimersByTimeAsync(0);
      expect(l.link.acts).toHaveLength(1); // no new act: no second sheet, no second session
      l.link.acts[0].settle({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(answer).toEqual({ ok: true, value: { status: 'ok', appSessionId: 'app-new' } });
      expect(l.adapter.spawnsKept()).toEqual([]);
    });

    const unknown = { ok: false, error: { code: 'internal', message: 'Couldn’t confirm whether it started on mini; check again, or check mini’s sessions', issues: { refusal: 'unknown' } } };

    it('never says a terminal unknown as a pending start, and asks the same op again at each ask: a later ok opens that session, one act', async () => {
      const l = lab({ tabs: [] });
      l.link.onAct = (a) => a.move('sent');
      await timedOut(l);
      l.link.acts[0].settle({ state: 'unknown', reason: 'expired' }); // nobody waiting
      await vi.advanceTimersByTimeAsync(0);
      const check = l.cmdFrom('session.spawn', spawn, TAB); // Check again
      await vi.advanceTimersByTimeAsync(0);
      expect(l.link.requeries.map((q) => q.request.action)).toEqual([`requery ${l.link.acts[0].opId}`]); // the same op, by query
      l.link.requeries[0].settle({ state: 'unknown', reason: 'expired' }); // still can't be known
      expect(await check).toMatchObject(unknown);
      // the ledger records it later (an engine host adopted across a restart): the next ask, a Send, hears it
      l.link.onRequery = (q) => q.settle({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
      expect(await l.cmdFrom('session.spawn', { ...spawn, brief: 'edited' }, TAB)).toEqual({ ok: true, value: { status: 'ok', appSessionId: 'app-new' } });
      expect(l.link.acts).toHaveLength(1); // never a second act
      expect(l.adapter.spawnsKept()).toEqual([]);
    });

    it('keeps an unknown said to a waiting page for the next ask, and only a new attempt key makes a new act, carrying no session', async () => {
      const l = lab({ tabs: [] });
      l.link.onAct = settleWith({ state: 'unknown', reason: 'closed' });
      expect(await l.cmdFrom('session.spawn', spawn, TAB)).toMatchObject(unknown);
      expect(l.adapter.spawnsKept()).toEqual([{ key: `${MINI}\n${TAB}`, state: 'said' }]);
      l.link.onRequery = (q) => q.settle({ state: 'unknown', reason: 'closed' });
      expect(await l.cmdFrom('session.spawn', spawn, TAB)).toMatchObject(unknown); // a Send: asked again, still unknown
      expect(l.link.acts).toHaveLength(1);
      // the person's explicit "Start a new session": the renderer's next attempt key
      l.link.onAct = settleWith({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
      expect(await l.cmdFrom('session.spawn', spawn, `${TAB}~1`)).toEqual({ ok: true, value: { status: 'ok', appSessionId: 'app-new' } });
      expect(l.link.acts).toHaveLength(2);
      // the attempt key is a key only: never the act's session or context, never in a log line
      for (const act of l.link.acts) expect(act.request).toEqual({ action: 'session.spawn', args: spawn, executor: 'machine', stepUp: 'required' });
      expect(l.logs.filter((line) => line.includes(TAB))).toEqual([]);
    });

    // the milestone re-review: an unknown never becomes a new act under its key, however long ago it was
    it('keeps an unknown past its tombstone as unresolved: the key’s Send and Check again answer unknown and make no act', async () => {
      const l = lab({ tabs: [] });
      l.link.onAct = settleWith({ state: 'unknown', reason: 'closed' });
      expect(await l.cmdFrom('session.spawn', spawn, TAB)).toMatchObject(unknown);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000 + 1);
      expect(await l.cmdFrom('session.spawn', spawn, 'new-9')).toMatchObject(unknown); // another key's own act; the sweep runs
      expect(l.adapter.spawnsKept()).toContainEqual({ key: `${MINI}\n${TAB}`, state: 'unresolved' }); // no op, no input
      const acts = l.link.acts.length;
      expect(await l.cmdFrom('session.spawn', spawn, TAB)).toMatchObject(unknown); // a Send
      expect(await l.cmdFrom('session.spawn', spawn, TAB)).toMatchObject(unknown); // Check again
      expect(l.link.acts).toHaveLength(acts);
      expect(l.link.requeries).toHaveLength(0); // past the horizon nothing is asked
      l.link.onAct = settleWith({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
      expect(await l.cmdFrom('session.spawn', spawn, `${TAB}~1`)).toMatchObject({ ok: true }); // only the explicit new key
      expect(l.link.acts).toHaveLength(acts + 1);
    });

    it('keeps at most UNRESOLVED_MAX unresolved keys, the oldest let go first', async () => {
      const l = lab({ tabs: [] });
      l.link.onAct = settleWith({ state: 'unknown', reason: 'closed' });
      for (let i = 0; i <= UNRESOLVED_MAX; i++) await l.cmdFrom('session.spawn', spawn, `tab-${i}`);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000 + 1);
      await l.cmdFrom('session.spawn', spawn, 'tab-last'); // the sweep
      const unresolved = l.adapter.spawnsKept().filter((k) => k.state === 'unresolved').map((k) => k.key);
      expect(unresolved).toHaveLength(UNRESOLVED_MAX);
      expect(unresolved).not.toContain(`${MINI}\ntab-0`);
    });

    it('keeps an outcome for the tab when the page waiting on it went: a reload during Check again starts one session', async () => {
      const l = lab({ tabs: [] });
      l.link.onAct = (a) => a.move('sent');
      await timedOut(l);
      const before = endableClientRef('page-before');
      let late: unknown = null;
      void l.cmdFrom('session.spawn', spawn, TAB, before).then((r) => (late = r)); // Check again
      await vi.advanceTimersByTimeAsync(0);
      before.end(); // the page reloads while the check waits
      l.link.acts[0].settle({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(late).toMatchObject({ ok: true }); // said to a page that is gone: not taken
      expect(l.adapter.spawnsKept()).toEqual([{ key: `${MINI}\n${TAB}`, state: 'said' }]);
      const after = endableClientRef('page-after');
      expect(await l.cmdFrom('session.spawn', spawn, TAB, after)).toEqual({ ok: true, value: { status: 'ok', appSessionId: 'app-new' } }); // the reloaded tab's Send
      expect(l.link.acts).toHaveLength(1);
      expect(l.adapter.spawnsKept()).toEqual([]);
    });

    it('keeps two tabs’ attempts apart, however alike their input', async () => {
      const l = lab({ tabs: [] });
      l.link.onAct = (a) => a.move('sent');
      await timedOut(l, 'new-1');
      await timedOut(l, 'new-2');
      expect(l.link.acts).toHaveLength(2);
      l.link.acts[0].settle({ state: 'done', result: { status: 'ok', appSessionId: 'app-one' } });
      l.link.acts[1].settle({ state: 'done', result: { status: 'ok', appSessionId: 'app-two' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(await l.cmdFrom('session.spawn', spawn, 'new-2')).toEqual({ ok: true, value: { status: 'ok', appSessionId: 'app-two' } });
      expect(await l.cmdFrom('session.spawn', spawn, 'new-1')).toEqual({ ok: true, value: { status: 'ok', appSessionId: 'app-one' } });
      expect(l.link.acts).toHaveLength(2);
    });

    it('lets the act go once it settles unasked, keeping its answer for the tab until it reads it or the bound passes', async () => {
      const l = lab({ tabs: [] });
      l.link.onAct = (a) => a.move('sent');
      await timedOut(l);
      expect(l.adapter.spawnsKept()).toEqual([{ key: `${MINI}\n${TAB}`, state: 'out' }]);
      l.link.acts[0].settle({ state: 'done', result: { status: 'refused', reason: 'untrusted' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(l.adapter.spawnsKept()).toEqual([{ key: `${MINI}\n${TAB}`, state: 'said' }]); // the answer alone
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
      l.link.onAct = settleWith({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
      expect(await l.cmdFrom('session.spawn', spawn, 'new-9')).toMatchObject({ ok: true }); // any ask sweeps
      expect(l.adapter.spawnsKept()).toEqual([]);
      // the machine's link replaced: an act out ends unknown, kept as its answer; the adapter stopped, nothing is kept
      l.link.onAct = (a) => a.move('sent');
      await timedOut(l, 'new-3');
      l.setLinks(new Map([[MINI, new FakeLink()]]));
      expect(l.adapter.spawnsKept()).toEqual([{ key: `${MINI}\nnew-3`, state: 'said' }]);
      l.adapter.stop();
      expect(l.adapter.spawnsKept()).toEqual([]);
    });
  });

  it('reads `session.events` within the byte budget only from a machine whose endpoint listed `rl2.events-budget`', async () => {
    const l = lab();
    await live(l);
    l.link.answers.set('session.events', (input) => ({ ok: true, output: { events: [], lastSeq: (input.afterSeq as number | null) ?? 0, complete: true } }));
    await l.cmd('session.events', { appSessionId: APP, afterSeq: null, limit: null });
    l.link.peers = ['rl2.executor.machine', 'rl2.events-budget'];
    await l.cmd('session.events', { appSessionId: APP, afterSeq: null, limit: null });
    expect(l.link.calls.filter((c) => c.name === 'session.events').map((c) => (c.input as { maxBytes?: number }).maxBytes)).toEqual([undefined, expect.any(Number)]);
  });

  // Fix wave 1 (findings 3 and 4): an idle stream that waits on its record keeps a way back whatever the feed does.
  async function idleFollowed() {
    const l = lab();
    l.link.peers = ['rl2.executor.machine', 'rl2.feeds'];
    await vi.advanceTimersByTimeAsync(0);
    const streams = () => l.link.subs.filter((s) => s.request.feed === undefined);
    const stream = () => l.link.open().find((s) => s.request.feed === undefined);
    const feed = l.link.open().find((s) => s.request.feed === 'checkout')!;
    stream()!.sink.ended('unavailable'); // not live: the first try
    feed.sink.subbed('snapshot', { epoch: 'checkout:boot', seq: 0 }); // the feed's opening: one more try, out now
    expect(streams()).toHaveLength(2);
    return { l, streams, stream, feed };
  }
  const running = { ...record(APP), holder: { kind: 'self' as const } };

  it('takes a start record that comes while a try is out once that try ends, and only once', async () => {
    const { streams, stream, feed } = await idleFollowed();
    feed.sink.event({ epoch: 'checkout:boot', seq: 1 }, { name: 'session.changed', payload: { record: running, cause: 'live', revision: 2 } });
    stream()!.sink.ended('unavailable'); // the try out answers after the record
    expect(streams()).toHaveLength(3);
    stream()!.sink.ended('unavailable'); // it went again: the record is spent, no storm
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(streams()).toHaveLength(3);
  });

  // Fix wave 2 (finding 3): the first try is a try out too.
  it('takes a start record that comes while the opening’s first try is out once it ends, and only once', async () => {
    const l = lab();
    l.link.peers = ['rl2.executor.machine', 'rl2.feeds'];
    await vi.advanceTimersByTimeAsync(0);
    const streams = () => l.link.subs.filter((s) => s.request.feed === undefined);
    const stream = () => l.link.open().find((s) => s.request.feed === undefined)!;
    const feed = l.link.open().find((s) => s.request.feed === 'checkout')!;
    feed.sink.subbed('snapshot', { epoch: 'checkout:boot', seq: 0 }); // the feed opens first: the stream is still opening
    feed.sink.event({ epoch: 'checkout:boot', seq: 1 }, { name: 'session.changed', payload: { record: running, cause: 'live', revision: 2 } });
    expect(streams()).toHaveLength(1);
    stream().sink.ended('unavailable');
    expect(streams()).toHaveLength(2);
    stream().sink.ended('unavailable');
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(streams()).toHaveLength(2);
  });

  it('falls back to the idle backoff when the next channel’s peer offers no feed, and stays put on `removed` or `grade`', async () => {
    const { l, streams, stream, feed } = await idleFollowed();
    stream()!.sink.ended('unavailable');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(streams()).toHaveLength(2); // waiting on the record
    l.link.peers = ['rl2.executor.machine'];
    feed.sink.ended('not-offered');
    await vi.advanceTimersByTimeAsync(1000);
    expect(streams()).toHaveLength(3);
    for (const reason of ['removed', 'grade']) {
      const m = await idleFollowed();
      m.stream()!.sink.ended('unavailable');
      m.feed.sink.ended(reason);
      await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
      expect([reason, m.streams()]).toEqual([reason, expect.objectContaining({ length: 2 })]);
    }
  });

  it('opens the session’s checkout feed beside its stream for a machine whose endpoint lists `rl2.feeds`, and closes it with the stream', async () => {
    const l = lab({ timing: { unsubscribeLingerMs: 100 } });
    l.link.peers = ['rl2.executor.machine', 'rl2.feeds'];
    await live(l);
    expect(l.link.open().map((s) => s.request.feed ?? 'stream')).toEqual(['stream', 'checkout']);
    l.setTabs();
    await vi.advanceTimersByTimeAsync(100);
    expect(l.link.open()).toEqual([]);
  });
});
