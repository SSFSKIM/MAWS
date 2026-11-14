// Main's remote lane B adapter over a fake link (P5 O7 M2, "Acts", "Outcomes as results", "Reads", "Subscriptions follow
// the tabs"; Interfaces §J): the router's names it takes, the two act shapes, the resume behind an act on a session with
// no status, sends one at a time under the pending bound, the substitutes for two reads the pane makes, and the tabs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import type { SessionEvent } from '@shared/graph/events';
import { requestDigestOf } from '@shared/host/request-digest';
import type { CommandName, CommandResult, EventName } from '@shared/ipc/schema';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import { REMOTE_UPLOAD_REFUSED_WORDS } from '@shared/ipc/schema/remote';
import { addressOf } from '@shared/machine/address';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending';
import { validateEventPayload } from '@shared/ipc/validate';
import { BUILTIN_MODELS } from '@shared/sessions/models';
import { project, record, status } from '../../../test/support/builders';
import { FakeLink, MINI, type FakeAct } from '../../../test/lane-b/fake-link';
import type { MainContext } from '../ipc/router';
import type { CallResult } from '../machines/remote/link';
import { AGENT_TOO_LARGE, createRemoteLaneB, routeLaneB, standInForMachines, type RemoteLaneB } from './remote';
import { UNRESOLVED_MAX } from './remote-spawn';
import { startNotifier } from '../attention/notifier';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { READ_REFUSED } from '@shared/org/reader'; // board #525

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

function lab(options: { tabs?: string[]; timing?: Parameters<typeof createRemoteLaneB>[0]['timing']; laneA?: string[]; others?: string[]; record?: (input: Record<string, unknown>) => CallResult } = {}) {
  const link = new FakeLink();
  let links: Map<MachineRef, FakeLink> = new Map([[MINI, link]]);
  const remoteListeners = new Set<(machines: readonly MachineRef[]) => void>();
  const layoutListeners = new Set<(key: string) => void>();
  let tabs: unknown = tabsOf(...(options.tabs ?? [APP]));
  const emitted: Array<{ machine: MachineRef; name: EventName; payload: Record<string, unknown> }> = [];
  const logs: string[] = [];
  link.answers.set('session.get', options.record ?? ((input) => ({ ok: true, output: record(String(input.appSessionId)) })));
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
    othersOf: (machine, session) => machine === MINI && options.others?.includes(session) === true, // board #525
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
  const sub = l.link.open().find((s) => s.request.session?.id === app)!;
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
    for (const name of ['session.status', 'session.get', 'session.drafts.get', 'laneA.send'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(false);
  });

  // The project registry's M11: a harness build's e2e fixture (src/main/org/registry-fixture.ts) stands in for a machine
  // ahead of its link and step-up; what it leaves, and everything once it is removed, goes on as before.
  it('answers from a harness stand-in first, ahead of the link, and as before once it is removed', async () => {
    const l = lab();
    const stood: string[] = [];
    const remove = standInForMachines((machine, name) => (name === 'session.projects.addFolder' ? (stood.push(`${machine} ${name}`), { ok: true, value: 'stood in' } as unknown as CommandResult<CommandName>) : undefined));
    expect(() => standInForMachines(() => undefined)).toThrow(/already installed/);
    expect(await l.cmd('session.projects.addFolder', { directory: '/srv/next' })).toEqual({ ok: true, value: 'stood in' });
    expect(await l.cmd('session.status', { appSessionId: APP })).toEqual({ ok: true, value: 'base' });
    expect(stood).toEqual([`${MINI} session.projects.addFolder`]);
    expect(l.link.acts).toEqual([]);
    remove();
    expect(await l.cmd('session.status', { appSessionId: APP })).toEqual({ ok: true, value: 'base' });
    expect(l.base).toEqual(['session.status', 'session.status']);
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
    expect(await sending).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini is offline', issues: { refusal: 'offline' } } });
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
    expect(await sending).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini is offline', issues: { refusal: 'offline' } } });
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
    expect(l.link.open().map((s) => s.request.session?.id)).toEqual([APP]);
  });

  it('says a held session’s state again after a page’s `session.get` of it, for a page that just subscribed (a reload, a second window)', async () => {
    const l = lab();
    const sub = await live(l);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { queue: { entries: [], paused: false, pauseReason: null }, pendingItems: [], catalog: { commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 1 } });
    const said = l.emitted.length;
    expect(await l.cmd('session.get', { appSessionId: APP })).toEqual({ ok: true, value: 'base' }); // the read itself is the manager's
    expect(l.emitted.slice(said).map((e) => e.name)).toEqual(['session.changed', 'session.status', 'session.queue', 'session.catalogChanged', 'attention.changed', 'remote.session', 'remote.settled']); // U9 M5: the generation settled
    expect(l.emitted.at(-2)!.payload).toMatchObject({ address: APP, stream: 'live', reason: null });
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
    for (const name of ['git.status', 'git.diff', 'files.list', 'scm.status', 'session.projects.list'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(false);
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

  // O12 M11: B's endpoint ranks the spawner as owner, so a session spawned here is placed at once; one that isn't follows
  // the ordinary record retries, then "can't place", as any session does (the main-side listing wait is gone).
  it('opens a session this app spawned as any session: placed when the machine answers, else "can’t place" after the retries', async () => {
    const l = lab({ tabs: [] });
    l.link.answers.set('session.get', (input) => (input.appSessionId === 'app-new' ? { ok: true, output: record('app-new') } : { ok: false, error: { code: 'grade' } }));
    l.link.onAct = settleWith({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
    expect(await l.cmd('session.spawn', { checkout: '/work/repo', permission_mode: 'default' })).toEqual({ ok: true, value: { status: 'ok', appSessionId: 'app-new' } });
    l.link.onAct = settleWith({ state: 'done', result: { status: 'ok', appSessionId: 'app-unplaced' } });
    expect(await l.cmd('session.spawn', { checkout: '/work/repo', permission_mode: 'default' })).toMatchObject({ ok: true });
    const reasonOf = (app: string) => l.of('remote.session').filter((p) => p.address === app).at(-1)?.reason;
    l.setTabs('app-new', 'app-unplaced');
    await vi.advanceTimersByTimeAsync(0);
    expect(reasonOf('app-new')).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reasonOf('app-unplaced')).toBe('mini can’t place this session');
  });

  // Board #525: a session the org rows list as another member's says its refused read as the reader's grade, at once.
  it('says a `grade` refusal of another member’s session’s record as READ_REFUSED, and of the member’s own as not placed yet', async () => {
    const l = lab({ tabs: [], others: ['app-theirs'] });
    l.link.answers.set('session.get', () => ({ ok: false, error: { code: 'grade' } }));
    const reasonOf = (app: string) => l.of('remote.session').filter((p) => p.address === app).at(-1)?.reason;
    l.setTabs('app-theirs', 'app-mine');
    await vi.advanceTimersByTimeAsync(0);
    expect(reasonOf('app-theirs')).toBe(READ_REFUSED);
    expect(reasonOf('app-mine')).toBe('Opening on mini…');
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

// P5 O7 M6 fix wave 1: the machine's attention feed against a session's stream. The feed's items are the machine's whole
// list (derived errors among them), the stream's the broker's alone, and both are `attention.changed`, which replaces: while
// the feed follows, it alone speaks for the machine's sessions.
describe('the attention feed beside a session’s stream', () => {
  const T = '2026-10-31T00:00:00.000Z';
  const itemOf = (app: string, kind: 'error' | 'permission', id: string) => ({
    id, appSessionId: app, sessionId: null, kind, request: { requestId: kind === 'permission' ? 'req-1' : null, toolUseId: null, taskId: null, agentId: null },
    summary: kind, createdAt: T, state: 'pending', stateChangedAt: T, expiresAt: null,
  });
  const error = itemOf(APP, 'error', 'att-err');
  const asked = itemOf(APP, 'permission', 'att-req-1');
  const parts = (pendingItems: unknown[]) => ({ queue: { entries: [], paused: false, pauseReason: null }, pendingItems, catalog: { commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 1 } });
  /** The machine's feed open and its first snapshot delivered. */
  function fed(l: ReturnType<typeof lab>, items: unknown[]) {
    l.link.peers = ['rl2.executor.machine', 'rl2.feeds'];
    l.setLinks(new Map([[MINI, l.link]]));
    const feed = l.link.open().find((s) => s.request.feed === 'attention')!;
    feed.sink.subbed('snapshot', { epoch: 'attention:boot', seq: 0 });
    feed.sink.snapshot({ epoch: 'attention:boot', seq: 0 }, items);
    return feed;
  }
  const attentionOf = (l: ReturnType<typeof lab>) => l.of('attention.changed').filter((p) => p.appSessionId === APP).map((p) => (p.items as Array<{ id: string }>).map((i) => i.id));

  it('keeps a feed item the broker doesn’t hold through the stream’s opening and a page’s replay, which tells the feed’s items', async () => {
    const l = lab();
    fed(l, [error]);
    const sub = await live(l);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([]));
    expect(attentionOf(l)).toEqual([]);
    await l.cmd('session.get', { appSessionId: APP });
    expect(attentionOf(l)).toEqual([['att-err']]);
    expect(l.adapter.attention.machine(MINI)!.sessions.get(APP)).toEqual([error]);
  });

  it('never brings back an item the feed cleared with a late stream snapshot', async () => {
    const l = lab();
    const feed = fed(l, [asked]);
    const sub = await live(l);
    feed.sink.event({ epoch: 'attention:boot', seq: 1 }, { appSessionId: APP, items: [] });
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked]));
    expect(attentionOf(l)).toEqual([[]]);
  });

  it('leaves the stream the session’s attention against an endpoint without the feed, and gives it back when the feed ends `not-offered`', async () => {
    const l = lab();
    const sub = await live(l);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked]));
    expect(attentionOf(l)).toEqual([['att-req-1']]); // no rl2.feeds: no feed, the stream speaks

    l.link.peers = ['rl2.executor.machine', 'rl2.feeds'];
    l.setLinks(new Map([[MINI, l.link]]));
    const feed = l.link.open().find((s) => s.request.feed === 'attention')!;
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked]));
    expect(attentionOf(l)).toHaveLength(2); // fix wave 5: the feed is opening, not fed: the stream still speaks
    feed.sink.ended('not-offered'); // an endpoint older than M6
    expect(attentionOf(l)).toEqual([['att-req-1'], ['att-req-1'], ['att-req-1']]);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([]));
    expect(attentionOf(l).at(-1)).toEqual([]);
  });

  // fix wave 2: a page's announcement re-says a machine's attention only while its feed follows
  it('keeps the stream’s items after the feed ended `not-offered` through a page’s announcement and its `session.get`', async () => {
    const l = lab();
    const sub = await live(l);
    const feed = fed(l, [asked]);
    feed.sink.ended('not-offered');
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked]));
    expect(attentionOf(l).at(-1)).toEqual(['att-req-1']);
    const said = l.emitted.length;
    l.adapter.attention.sayAgain(); // attention.pendingNavigate
    await l.cmd('session.get', { appSessionId: APP });
    // fix wave 3: the machine's state is the streams' items, never the ended feed's emptied cache
    expect(l.emitted.slice(said).filter((e) => e.name === 'remote.attention').map((e) => e.payload)).toEqual([{ machine: MINI, items: [asked], greyed: false }]);
    expect(attentionOf(l).at(-1)).toEqual(['att-req-1']);
  });

  // fix wave 3 (the milestone review's repro): the fallback items survive the next disconnect, greyed, and come back at `up`
  it('greys the stream’s fallback items at the link’s `down` after the feed ended, rather than erasing them', async () => {
    const l = lab();
    const sub = await live(l);
    const feed = fed(l, [asked]);
    feed.sink.ended('not-offered');
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked]));
    l.link.set('down', null);
    vi.advanceTimersByTime(REMOTE_ACT_PENDING_MS); // U9 M5: greyed once the machine reads offline
    expect(l.of('remote.attention').at(-1)).toEqual({ machine: MINI, items: [asked], greyed: true });
    l.link.peers = ['rl2.executor.machine']; // the next channel's peer reads no feeds: the streams stay the machine's
    l.link.set('up');
    expect(l.of('remote.attention').at(-1)).toEqual({ machine: MINI, items: [asked], greyed: false });
  });

  // fix wave 4 (the milestone re-check): the dock counts what Needs you shows, and the handover raises nothing again
  it('counts a live fallback item in the dock badge and raises it once across the handover from the feed to the stream', async () => {
    const l = lab();
    const badges: number[] = [];
    const raised: string[] = [];
    let clock = 0;
    const stop = startNotifier(fakeSpineView(), {
      port: { notify: (_c, request) => (raised.push(request.body), { close: () => {} }), badge: (_c, count) => void badges.push(count), focus: () => ({}) as never },
      isFocused: () => false, isViewing: () => false, navigate: () => {}, failure: () => {}, settings: () => SETTINGS_DEFAULTS_V21, emit: () => true, emitFrom: () => true,
      remote: l.adapter.attention, now: () => clock,
    });
    clock = 60_000; // the machine first reached past the startup window: its first snapshot is raised
    try {
      const sub = await live(l);
      const feed = fed(l, [asked]);
      sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked]));
      expect(badges.at(-1)).toBe(1);
      feed.sink.ended('not-offered'); // the link stays up
      expect(badges.at(-1)).toBe(1);
      expect(raised).toHaveLength(1);
      sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([])); // the stream says it answered
      expect(badges.at(-1)).toBe(0);
      sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked, error]));
      expect(badges.at(-1)).toBe(1);
      expect(raised).toHaveLength(2); // the error, new; the permission seen before
    } finally {
      stop();
    }
  });

  // fix wave 5: one predicate (`fed`) for who speaks, so what the renderer is told and what the dock counts agree
  /** The renderer's partition for the machine, as the store applies what main says: `remote.attention` replaces it whole, `attention.changed` one session. */
  function shown(l: ReturnType<typeof lab>) {
    let at = 0;
    const sessions = new Map<string, Array<{ id: string }>>();
    return () => {
      for (const e of l.emitted.slice(at)) {
        if (e.name === 'remote.attention') {
          sessions.clear();
          for (const i of e.payload.items as Array<{ id: string; appSessionId: string }>) sessions.set(i.appSessionId, [...(sessions.get(i.appSessionId) ?? []), i]);
        }
        if (e.name === 'attention.changed') sessions.set(e.payload.appSessionId as string, e.payload.items as Array<{ id: string }>);
      }
      at = l.emitted.length;
      return [...sessions.values()].flat().map((i) => i.id);
    };
  }
  function badgeOf(l: ReturnType<typeof lab>) {
    const badges: number[] = [];
    const stop = startNotifier(fakeSpineView(), {
      port: { notify: () => ({ close: () => {} }), badge: (_c, count) => void badges.push(count), focus: () => ({}) as never },
      isFocused: () => false, isViewing: () => false, navigate: () => {}, failure: () => {}, settings: () => SETTINGS_DEFAULTS_V21, emit: () => true, emitFrom: () => true,
      remote: l.adapter.attention,
    });
    return { badge: () => badges.at(-1), stop };
  }

  it('agrees with the dock before a feed’s first snapshot: the stream’s permission is shown and counted', async () => {
    const l = lab();
    const view = shown(l);
    const dock = badgeOf(l);
    try {
      l.link.peers = ['rl2.executor.machine', 'rl2.feeds'];
      l.setLinks(new Map([[MINI, l.link]])); // the feed opens; its snapshot is held
      const sub = await live(l);
      sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked]));
      l.adapter.attention.sayAgain();
      expect(dock.badge()).toBe(1);
      expect(view()).toEqual(['att-req-1']);
      // its snapshot takes the partition; from then on the feed alone speaks
      const feed = l.link.open().find((s) => s.request.feed === 'attention')!;
      feed.sink.subbed('snapshot', { epoch: 'attention:boot', seq: 0 });
      feed.sink.snapshot({ epoch: 'attention:boot', seq: 0 }, [error]);
      sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked]));
      expect(view()).toEqual(['att-err']);
      expect(dock.badge()).toBe(1);
    } finally {
      dock.stop();
    }
  });

  it('agrees with the dock when a feed returns on a new channel with the link staying up and the stream clears before its snapshot', async () => {
    const l = lab();
    const view = shown(l);
    const dock = badgeOf(l);
    try {
      const sub = await live(l);
      const feed = fed(l, [asked]);
      sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked]));
      feed.sink.ended('not-offered');
      expect(view()).toEqual(['att-req-1']);
      expect(dock.badge()).toBe(1);
      l.link.peers = ['rl2.executor.machine', 'rl2.feeds']; // a reconnect within the grace: a new h2 list, the state still up
      l.link.setCaps({ ...l.link.caps()! });
      expect(l.link.open().filter((s) => s.request.feed === 'attention')).toHaveLength(1);
      sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([]));
      expect(dock.badge()).toBe(0);
      expect(view()).toEqual([]);
    } finally {
      dock.stop();
    }
  });

  it('gives a machine’s sessions back to their streams when the feed couldn’t carry a change (`omitted`)', async () => {
    const l = lab();
    const sub = await live(l);
    const feed = fed(l, [asked]);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, parts([asked])); // held, unsaid while the feed follows
    feed.sink.event({ epoch: 'attention:boot', seq: 1 }, { omitted: 'too-large', bytes: 5 * 1024 * 1024 });
    expect([...l.adapter.attention.machine(MINI)!.sessions]).toEqual([[APP, [asked]]]); // fix wave 4: the streams' items, effective
    expect(l.of('remote.attention').at(-1)).toEqual({ machine: MINI, items: [asked], greyed: false });
    expect(attentionOf(l).at(-1)).toEqual(['att-req-1']);
    expect(feed.closed).toBe(true);
  });

  it('answers `session.search` of a machine whose endpoint offers none (older than M6) `host_unavailable`, as an offline one', async () => {
    const l = lab();
    const refused = routeLaneB(async () => ({ ok: false, error: { code: 'internal', message: 'session.search: refused not-offered by machine mini', issues: { refusal: 'not-offered' } } }) as CommandResult<CommandName>, (m) => (m === MINI ? l.link : null), l.adapter);
    const ctx: MainContext = { client: endableClientRef('page-1'), target: MINI };
    expect(await refused(MINI, 'session.search', { query: 'bisect' }, ctx)).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    // any other refusal, and any other name, keeps the machine's word
    const other = routeLaneB(async () => ({ ok: false, error: { code: 'internal', message: 'x', issues: { refusal: 'not-offered' } } }) as CommandResult<CommandName>, (m) => (m === MINI ? l.link : null), l.adapter);
    expect(await other(MINI, 'session.list', {}, ctx)).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});


// P5 O7 M8 ("The sitting's failures"): the adapter's half of M8's rows (§U), the operations' receipts, the task list's and
// the unfollow's targets, and the send's uploads behind `rl2.upload-blocks`.
describe('the sitting’s failures (M8)', () => {
  const ready = { status: 'ready', appSessionId: APP, launched: true, joined: false };

  it('takes M8’s acts, the sign-in by name, the task list and the unfollow', () => {
    const l = lab();
    for (const name of ['maws.ask.answer', 'side.question.clear', 'session.reloadPlugins', 'connectors.signInServer', 'fs.tasks', 'fs.unfollow'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(true);
    for (const name of ['maws.asks.list', 'side.question.list', 'session.operations', 'fs.subagents', 'fs.workflows'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(false); // plain calls: the manager's path
  });

  it('answers a MAWS ask on a released session by resuming it first, then the act sealed with the resumed launch', async () => {
    const l = lab();
    await vi.advanceTimersByTimeAsync(0);
    l.link.open()[0].sink.ended('unavailable');
    l.link.onAct = (act) => {
      if (act.request.action === 'session.acquire') return act.settle({ state: 'done', result: ready });
      act.settle({ state: 'done', result: { outcome: 'delivered' } });
    };
    const answer = { appSessionId: APP, askId: 'ask-1', answers: [] };
    const answering = l.cmd('maws.ask.answer', answer);
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts.map((a) => a.request.action)).toEqual(['session.acquire']);
    const resumed = l.link.open()[0];
    resumed.sink.subbed('snapshot', { epoch: 'L2', seq: 0 });
    resumed.sink.snapshot({ epoch: 'L2', seq: 0 }, { status: statusOf(APP, 'L2') });
    expect(await answering).toEqual({ ok: true, value: { outcome: 'delivered' } });
    expect(l.link.acts[1].request).toEqual({ action: 'maws.ask.answer', session: APP, context: { lane: 'B', launchId: 'L2', engineSessionId: `eng-${APP}` }, args: answer, executor: 'engine-host', sendBy: expect.any(Number) });
  });

  it('builds the side question’s clear and Reload plugins as engine-host acts; an operation’s receipt is waited for across a reopening', async () => {
    const l = lab();
    const sub = await live(l);
    l.link.onAct = (act) => act.settle({ state: 'done', result: act.request.action === 'session.reloadPlugins' ? { opId: 'op-reload' } : {} });
    expect(await l.cmd('side.question.clear', { appSessionId: APP })).toEqual({ ok: true, value: {} });
    expect(await l.cmd('session.reloadPlugins', { appSessionId: APP })).toEqual({ ok: true, value: { opId: 'op-reload' } });
    expect(l.link.acts.map((a) => [a.request.action, a.request.executor, a.request.session])).toEqual([
      ['side.question.clear', 'engine-host', APP],
      ['session.reloadPlugins', 'engine-host', APP],
    ]);
    l.link.answers.set('session.operations', (input) => ({ ok: true, output: { outcomes: (input.opIds as string[]).map((opId) => ({ opId, pending: true })) } }));
    sub.sink.ended('behind');
    l.link.open()[0].sink.subbed('replay', { epoch: 'L1', seq: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.calls.filter((c) => c.name === 'session.operations').map((c) => c.input)).toEqual([{ appSessionId: APP, opIds: ['op-reload'] }]);
  });

  it('sends the sign-in by a server’s name as a `machine` act with a listener for its consent', async () => {
    const closed: number[] = [];
    const l = lab();
    const adapter = createRemoteLaneB({
      local: LOCAL,
      layout: { get: () => tabsOf(), onChange: () => () => {} },
      remote: (machine) => (machine === MINI ? l.link : null),
      onRemote: () => () => {},
      emit: () => {},
      listenCallback: async () => ({ port: 4711, close: () => void closed.push(4711) }),
      log: () => {},
    });
    l.link.onAct = settleWith({ state: 'done', result: { opId: 'op-sign' } });
    const fields = { name: 'linear', scope: 'user', cwd: null, appSessionId: APP };
    const ctx: MainContext = { client: endableClientRef('page-1'), target: MINI };
    expect(await adapter.dispatch(l.link, 'connectors.signInServer', fields, ctx)).toEqual({ ok: true, value: { opId: 'op-sign' } });
    expect(l.link.acts.map((a) => a.request)).toEqual([{ action: 'connectors.signInServer', args: { ...fields, callback: { port: 4711 } }, executor: 'machine', sendBy: expect.any(Number) }]);
    adapter.stop();
    expect(closed).toEqual([4711]);
  });

  it('names the session a task list belongs to: the input’s, the page’s, else the open session whose list it is; none, refused here', async () => {
    const l = lab();
    const sub = await live(l);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { status: { ...statusOf(APP, 'L1'), taskListId: 'team/list' } });
    l.link.answers.set('fs.tasks', () => ({ ok: true, output: { tasks: [] } }));
    expect(await l.cmd('fs.tasks', { listId: 'team-list' })).toEqual({ ok: true, value: { tasks: [] } });
    expect(await l.cmdFrom('fs.tasks', { listId: 'other' }, 'app-2')).toEqual({ ok: true, value: { tasks: [] } });
    expect(await l.cmd('fs.tasks', { listId: 'other', appSessionId: 'app-3' })).toEqual({ ok: true, value: { tasks: [] } });
    expect(l.link.calls.filter((c) => c.name === 'fs.tasks').map((c) => c.input)).toEqual([
      { listId: 'team-list', appSessionId: APP },
      { listId: 'other', appSessionId: 'app-2' },
      { listId: 'other', appSessionId: 'app-3' },
    ]);
    expect(await l.cmd('fs.tasks', { listId: 'nobody-s' })).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'no-target' } } });
    expect(l.link.calls.filter((c) => c.name === 'fs.tasks')).toHaveLength(3);
  });

  it('sends an unfollow of a named agent, and turns the session-wide one into one per agent this device follows there, leaving other clients’ follows alone', async () => {
    const l = lab();
    l.link.answers.set('fs.agentEvents', () => ({ ok: true, output: { events: [], complete: true } }));
    l.link.answers.set('fs.unfollow', () => ({ ok: true, output: null }));
    for (const agentId of ['agent-1', 'agent-2']) expect(await l.cmd('fs.agentEvents', { appSessionId: APP, agentId })).toEqual({ ok: true, value: { events: [], complete: true } });
    await l.cmd('fs.agentEvents', { appSessionId: 'app-2', agentId: 'agent-9' }); // another session's
    expect(await l.cmd('fs.unfollow', { appSessionId: APP, agentId: 'agent-1' })).toEqual({ ok: true, value: undefined });
    expect(await l.cmd('fs.unfollow', { appSessionId: APP, agentId: null })).toEqual({ ok: true, value: undefined });
    expect(l.link.calls.filter((c) => c.name === 'fs.unfollow').map((c) => c.input)).toEqual([
      { appSessionId: APP, agentId: 'agent-1' },
      { appSessionId: APP, agentId: 'agent-2' },
    ]);
    // nothing followed there any more: the session-wide one has nothing to end, and sends nothing
    expect(await l.cmd('fs.unfollow', { appSessionId: APP, agentId: null })).toEqual({ ok: true, value: undefined });
    expect(l.link.calls.filter((c) => c.name === 'fs.unfollow')).toHaveLength(2);
    // an unfollow the machine refused is the answer, and its follow is kept for the next
    l.link.answers.set('fs.unfollow', () => ({ ok: false, error: { code: 'unavailable' } }));
    expect(await l.cmd('fs.unfollow', { appSessionId: 'app-2', agentId: null })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    l.link.answers.set('fs.unfollow', () => ({ ok: true, output: null }));
    expect(await l.cmd('fs.unfollow', { appSessionId: 'app-2', agentId: null })).toEqual({ ok: true, value: undefined });
    expect(l.link.calls.filter((c) => c.name === 'fs.unfollow').map((c) => c.input).slice(2)).toEqual([
      { appSessionId: 'app-2', agentId: 'agent-9' },
      { appSessionId: 'app-2', agentId: 'agent-9' },
    ]);
  });

  // The remote drill-in (2026-11-06): `fs.agentEvents` takes no byte budget, so an agent's disk window past the channel's
  // bound is refused `too-large` after the machine took the follow's hold: the drill-in is told why in words, and the
  // follow is this device's to let go of as any other.
  it('answers an agent’s transcript too large for the channel with its words, and lets go of the follow the machine took', async () => {
    const l = lab();
    l.link.answers.set('fs.agentEvents', () => ({ ok: false, error: { code: 'too-large' } }));
    l.link.answers.set('fs.unfollow', () => ({ ok: true, output: null }));
    expect(await l.cmd('fs.agentEvents', { appSessionId: APP, agentId: 'agent-1' })).toMatchObject({ ok: false, error: { code: 'internal', message: AGENT_TOO_LARGE(l.link.name), issues: { refusal: 'too-large' } } });
    expect(await l.cmd('fs.unfollow', { appSessionId: APP, agentId: null })).toEqual({ ok: true, value: undefined });
    expect(l.link.calls.filter((c) => c.name === 'fs.unfollow').map((c) => c.input)).toEqual([{ appSessionId: APP, agentId: 'agent-1' }]);
  });

  it('lets a session-wide unfollow cover an agent read still out when it was made (the machine took its hold before answering)', async () => {
    const l = lab();
    let answer!: (value: unknown) => void;
    l.link.answers.set('fs.agentEvents', () => new Promise((resolve) => (answer = resolve)) as never);
    l.link.answers.set('fs.unfollow', () => ({ ok: true, output: null }));
    const reading = l.cmd('fs.agentEvents', { appSessionId: APP, agentId: 'agent-1' });
    await vi.advanceTimersByTimeAsync(0);
    const unfollowing = l.cmd('fs.unfollow', { appSessionId: APP, agentId: null });
    answer({ ok: true, output: { events: [], complete: true } });
    await Promise.all([reading, unfollowing]);
    expect(l.link.calls.filter((c) => c.name === 'fs.unfollow').map((c) => c.input)).toEqual([{ appSessionId: APP, agentId: 'agent-1' }]);
    // a read out that then failed is covered too: its hold may have been taken before it failed
    l.link.answers.set('fs.agentEvents', () => new Promise((resolve) => (answer = resolve)) as never);
    const failing = l.cmd('fs.agentEvents', { appSessionId: APP, agentId: 'agent-2' });
    await vi.advanceTimersByTimeAsync(0);
    const again = l.cmd('fs.unfollow', { appSessionId: APP, agentId: null });
    answer({ ok: false, error: { code: 'timeout' } });
    await Promise.all([failing, again]);
    expect(l.link.calls.filter((c) => c.name === 'fs.unfollow').map((c) => c.input).slice(1)).toEqual([{ appSessionId: APP, agentId: 'agent-2' }]);
  });

  it('keeps an agent whose read failed while out, and whose unfollow was refused, for the next session-wide unfollow', async () => {
    const l = lab();
    let answer!: (value: unknown) => void;
    l.link.answers.set('fs.agentEvents', () => new Promise((resolve) => (answer = resolve)) as never);
    l.link.answers.set('fs.unfollow', () => ({ ok: false, error: { code: 'unavailable' } }));
    const reading = l.cmd('fs.agentEvents', { appSessionId: APP, agentId: 'agent-1' });
    await vi.advanceTimersByTimeAsync(0);
    const cleanup = l.cmd('fs.unfollow', { appSessionId: APP, agentId: null });
    answer({ ok: false, error: { code: 'timeout' } }); // the machine may have taken its hold already
    await reading;
    expect(await cleanup).toMatchObject({ ok: false });
    expect(l.link.calls.filter((c) => c.name === 'fs.unfollow')).toHaveLength(1);
    l.link.answers.set('fs.unfollow', () => ({ ok: true, output: null }));
    expect(await l.cmd('fs.unfollow', { appSessionId: APP, agentId: null })).toMatchObject({ ok: true });
    expect(l.link.calls.filter((c) => c.name === 'fs.unfollow').map((c) => c.input)).toEqual([
      { appSessionId: APP, agentId: 'agent-1' },
      { appSessionId: APP, agentId: 'agent-1' },
    ]);
  });

  it('sends a send’s uploads only to an endpoint that lists `rl2.upload-blocks`, and the mention alone to one that doesn’t', async () => {
    const l = lab();
    await live(l);
    l.link.onAct = settleWith({ state: 'done', result: { messageUuid: null, disposition: 'sent', queueId: 'q1' } });
    const send = { appSessionId: APP, content: 'read @.claude/desk-uploads/app-1/u.0.pdf', uploads: [{ uploadId: 'u.0.pdf', as: 'document' }] };
    await l.cmd('session.send', send);
    l.link.peers = ['rl2.executor.machine', 'rl2.upload-blocks'];
    await l.cmd('session.send', send);
    const sent = l.link.acts.map((a) => a.request);
    expect(sent[0]).toMatchObject({ args: { appSessionId: APP, content: send.content } });
    expect(sent[0].args).not.toHaveProperty('uploads');
    expect(sent[0].requires).toBeUndefined();
    expect(sent[1]).toMatchObject({ args: send, requires: 'rl2.upload-blocks' });
  });

  it('carries a send’s uploads made while no channel is current, for the channel it goes on to judge; one an older peer refuses as not offered goes again with the mention alone', async () => {
    const l = lab();
    await live(l);
    l.link.lose(); // within the grace: still `up`, no channel; the send waits under the link's hold
    const settles: Array<Parameters<FakeAct['settle']>[0]> = [{ state: 'refused', reason: 'not-offered' }, { state: 'done', result: { messageUuid: null, disposition: 'sent', queueId: 'q2' } }];
    l.link.onAct = (act) => {
      if (l.link.peerCapabilities() === null) l.link.relink(['rl2.executor.machine']); // the channel it goes on: an older peer
      act.settle(settles.shift()!);
    };
    const send = { appSessionId: APP, content: 'read @.claude/desk-uploads/app-1/u.0.pdf', uploads: [{ uploadId: 'u.0.pdf', as: 'document' }] };
    expect(await l.cmd('session.send', send)).toEqual({ ok: true, value: { messageUuid: null, disposition: 'sent', queueId: 'q2' } });
    const sent = l.link.acts.map((a) => a.request);
    expect(sent[0]).toMatchObject({ args: send, requires: 'rl2.upload-blocks' });
    expect(sent[1].args).toEqual({ appSessionId: APP, content: send.content });
    expect(sent[1].requires).toBeUndefined();
    expect(l.logs.some((line) => line.includes('rl2.upload-blocks'))).toBe(true);
  });

  it('sends again with the mention alone only when the channel it went on lists no `rl2.upload-blocks`; a not-offered from one that does is the send’s error', async () => {
    const l = lab();
    await live(l);
    l.link.lose();
    l.link.onAct = (act) => {
      l.link.relink(['rl2.executor.machine', 'rl2.upload-blocks']); // the channel it went on reads uploads
      act.settle({ state: 'refused', reason: 'not-offered' });
    };
    const send = { appSessionId: APP, content: 'read it', uploads: [{ uploadId: 'u.0.pdf', as: 'document' }] };
    expect(await l.cmd('session.send', send)).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'not-offered' } } });
    expect(l.link.acts).toHaveLength(1);
  });

  it('words a send whose uploads the machine refused (`malformed`, no reason) as the attachment’s, for the composer to show', async () => {
    const l = lab();
    await live(l);
    l.link.peers = ['rl2.executor.machine', 'rl2.upload-blocks'];
    l.link.onAct = settleWith({ state: 'refused', reason: 'malformed' });
    const send = { appSessionId: APP, content: 'read it', uploads: [{ uploadId: 'u.0.pdf', as: 'document' }] };
    expect(await l.cmd('session.send', send)).toEqual({ ok: false, error: { code: 'invalid_input', message: REMOTE_UPLOAD_REFUSED_WORDS, issues: { refusal: 'malformed', uploads: 'refused' } } });
    // the refusal can't say which part failed, so the words name the message and the attachment's likely causes alike
    expect(REMOTE_UPLOAD_REFUSED_WORDS).toBe('The message wasn’t sent. If its attachment is more than a day old or isn’t a supported file, attach it again.');
    // a send without uploads keeps the machine's word
    expect(await l.cmd('session.send', { appSessionId: APP, content: 'plain' })).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'malformed' } } });
  });
});

// P5 O7 M9 ("Remote setup"): the adapter's half of the setup rows (§U). The folder list and the trust read are the
// endpoint's `list` calls for the machine's owners, graded `spawn` in the registry, which `dispatchOverLink` refuses
// act-required before sending: they go by name (`callOverLink`). The registration is a `machine` act, stepped up as the
// spawn is (the endpoint always asks it of a `machine-admin` act).
describe('the remote setup (M9)', () => {
  it('takes the folder list, the trust read and the registration', () => {
    const l = lab();
    for (const name of ['machine.folders.list', 'session.trust.check', 'session.projects.addFolder'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(true);
  });

  it('sends the folder list and the trust read as calls by name, with no session, and answers what the machine said', async () => {
    const l = lab();
    const entries = [{ name: 'GitHub', path: '/Users/o/Developer/GitHub', protected: false }];
    l.link.answers.set('machine.folders.list', () => ({ ok: true, output: { entries, cursor: null } }));
    const trust = (directory: string) => ({ directory, trustKey: directory, keyKind: 'directory', configPath: '/Users/o/.claude.json', trusted: true, source: 'trustKey', isHome: false, found: [] });
    l.link.answers.set('session.trust.check', (input) => ({ ok: true, output: trust(String(input.directory)) }));
    expect(await l.cmd('machine.folders.list', { path: '~/Developer' })).toEqual({ ok: true, value: { entries, cursor: null } });
    expect(await l.cmd('session.trust.check', { directory: '/Users/o/Developer/GitHub/maws' })).toEqual({ ok: true, value: trust('/Users/o/Developer/GitHub/maws') });
    expect(l.link.calls.filter((c) => c.name !== 'session.get')).toEqual([
      { name: 'machine.folders.list', input: { path: '~/Developer' } },
      { name: 'session.trust.check', input: { directory: '/Users/o/Developer/GitHub/maws' } },
    ]);
    // the endpoint's refusal is the machine's word
    l.link.answers.set('machine.folders.list', () => ({ ok: false, error: { code: 'owners-only' } }));
    expect(await l.cmd('machine.folders.list', {})).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'owners-only' } } });
    expect(l.base).toEqual([]);
  });

  it('builds the registration as a `machine` act, stepped up, and answers its outcome or its refusal', async () => {
    const l = lab();
    const location = { kind: 'directory', path: '/Users/o/Documents/proj' };
    const answer = { project: project('p-1', 0, { directory: '/Users/o/Documents/proj' }), location };
    l.link.onAct = settleWith({ state: 'done', result: answer });
    expect(await l.cmd('session.projects.addFolder', { directory: '/Users/o/Documents/proj' })).toEqual({ ok: true, value: answer });
    expect(l.link.acts.map((a) => a.request)).toEqual([{ action: 'session.projects.addFolder', args: { directory: '/Users/o/Documents/proj' }, executor: 'machine', sendBy: expect.any(Number), stepUp: 'required' }]);
    l.link.onAct = settleWith({ state: 'refused', reason: 'protected' });
    expect(await l.cmd('session.projects.addFolder', { directory: '/Users/o/Documents/other' })).toMatchObject({ ok: false, error: { issues: { refusal: 'protected' } } });
  });
});

// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §G, "Older peers"): a machine
// whose endpoint does not list `rl2.project-acts` in its RL2 handshake is sent none of `into`, `own`, `link`,
// `relocate`, `resolve` or `expect`: an older endpoint could drop a field it does not know and do a plain add unsaid.
// Each is refused here, before anything goes, `not-offered`, the refusal the page already reads for an older peer.
describe('the project acts (the project registry)', () => {
  const guarded: Array<[string, Record<string, unknown>]> = [
    ['session.projects.addFolder', { directory: '/srv/a', into: 'p-1' }],
    ['session.projects.addFolder', { directory: '/srv/a', own: true }],
    ['session.projects.link', { id: 'p-1', into: null }],
    ['session.projects.relocate', { id: 'p-1', directory: '/srv/b' }],
    ['session.projects.remove', { id: 'p-1', expect: { path: '/srv/a', project: 'q-1' } }],
    ['session.projects.resolve', { directory: '/srv/a' }],
  ];

  it('are taken by the adapter, `resolve` among them', () => {
    const l = lab();
    for (const name of ['session.projects.link', 'session.projects.relocate', 'session.projects.update', 'session.projects.remove', 'session.projects.resolve'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(true);
  });

  it('go to a peer that lists `rl2.project-acts`: the acts as `machine` acts, `resolve` as a call', async () => {
    const l = lab();
    l.link.relink(['rl2.executor.machine', 'rl2.project-acts']);
    l.link.onAct = settleWith({ state: 'done', result: null });
    l.link.answers.set('session.projects.resolve', () => ({ ok: true, output: { project: null, by: 'machine', at: null, label: { key: 'folder:x:a', name: 'a', source: 'folder', smnsId: null } } }));
    for (const [name, input] of guarded) await l.cmd(name, input);
    expect(l.link.acts.map((a) => a.request.action)).toEqual(guarded.slice(0, 5).map(([name]) => name));
    expect(l.link.calls.filter((c) => c.name === 'session.projects.resolve')).toEqual([{ name: 'session.projects.resolve', input: { directory: '/srv/a' } }]);
    expect(l.base).toEqual([]);
  });

  // Review 1, finding 7: the check at the command's start is not the last word. An act waiting on Touch ID or resent after
  // a reconnection carries the capability as `requires`, which the act table judges at each transmission; `resolve` goes
  // only on the channel it was checked against, and fails `offline` at that channel's end rather than going to the next.
  it('carry the capability to every send: the acts as `requires`, `resolve` bound to the channel it was checked on', async () => {
    const l = lab();
    l.link.relink(['rl2.executor.machine', 'rl2.project-acts']);
    l.link.onAct = settleWith({ state: 'done', result: null });
    for (const [name, input] of guarded.slice(0, 5)) await l.cmd(name, input);
    await l.cmd('session.projects.addFolder', { directory: '/srv/a' });
    expect(l.link.acts.map((a) => a.request.requires)).toEqual([...guarded.slice(0, 5).map(() => 'rl2.project-acts'), undefined]);
    l.link.answers.set('session.projects.resolve', () => new Promise<never>(() => {}));
    const resolving = l.cmd('session.projects.resolve', { directory: '/srv/a' });
    await vi.waitFor(() => expect(l.link.calls.filter((c) => c.name === 'session.projects.resolve')).toHaveLength(1));
    l.link.lose();
    expect(await resolving).toMatchObject({ ok: false });
    l.link.relink(['rl2.executor.machine']);
    expect(l.link.calls.filter((c) => c.name === 'session.projects.resolve')).toHaveLength(1);
  });

  it('are refused `not-offered`, unsent, to a peer that does not; a plain add, a remove with no expectation and a rename still go', async () => {
    const l = lab();
    l.link.onAct = settleWith({ state: 'done', result: null });
    for (const [name, input] of guarded) expect([name, await l.cmd(name, input)]).toMatchObject([name, { ok: false, error: { code: 'internal', issues: { refusal: 'not-offered' } } }]);
    expect(l.link.acts).toEqual([]);
    expect(l.link.calls.filter((c) => c.name === 'session.projects.resolve')).toEqual([]);
    await l.cmd('session.projects.addFolder', { directory: '/srv/a' });
    await l.cmd('session.projects.remove', { id: 'p-1' });
    await l.cmd('session.projects.update', { id: 'p-1', patch: { name: 'A' } });
    expect(l.link.acts.map((a) => a.request.action)).toEqual(['session.projects.addFolder', 'session.projects.remove', 'session.projects.update']);
  });
});

// The UX wave (U9, M1; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §1 and §3): the session
// acts go only to a machine whose endpoint lists `rl2.session-acts`. With a current channel that lacks it an act answers
// at once and nothing is sent; with no channel current it waits under the link's hold, carrying the capability as
// `requires` for the channel it goes on to judge. The machine acts work with no tab open and resume nothing; the two
// engine-host acts need the session's tab, and a pane's answer never resumes a session. A refused act says UC-7.5's
// sentence, its code in `issues.refusal`.
describe('the session acts (`rl2.session-acts`)', () => {
  const SESSION_ACTS = ['rl2.executor.machine', 'rl2.session-acts'];
  const machineActs: Array<[string, Record<string, unknown>]> = [
    ['session.archive', { appSessionId: APP }],
    ['session.update', { appSessionId: APP, patch: { archived: false } }],
    ['session.rename', { appSessionId: APP, title: 'Loft notes' }],
    ['attention.acknowledge', { appSessionId: APP, attentionId: `${APP}:error:e1`, how: 'dismissed' }],
  ];

  it('are taken by the adapter, the archived read among them', () => {
    const l = lab();
    for (const name of ['session.archive', 'session.update', 'session.rename', 'attention.acknowledge', 'session.steer.cancel', 'maws.pane.answer', 'session.list'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(true);
  });

  it('build the machine acts with no session and no context, carrying the capability, on a session no tab holds, resuming nothing', async () => {
    const l = lab({ tabs: [] });
    l.link.relink(SESSION_ACTS);
    l.link.onAct = settleWith({ state: 'done', result: null });
    l.link.answers.set('session.list', () => ({ ok: true, output: { sessions: [], revision: 1 } }));
    for (const [name, input] of machineActs) await l.cmd(name, input);
    expect(l.link.acts.map((a) => a.request)).toEqual(machineActs.map(([action, args]) => ({ action, args, executor: 'machine', sendBy: expect.any(Number), requires: 'rl2.session-acts' })));
    expect(await l.cmd('session.list', { includeArchived: true })).toEqual({ ok: true, value: { sessions: [], revision: 1 } });
    expect(l.link.calls.filter((c) => c.name === 'session.list')).toEqual([{ name: 'session.list', input: { includeArchived: true } }]);
    expect(l.base).toEqual([]);
  });

  it('build taking back a waiting message and a pane’s answer as engine-host acts on the open session, carrying the capability', async () => {
    const l = lab();
    l.link.relink(SESSION_ACTS);
    await live(l);
    l.link.onAct = (act) => act.settle({ state: 'done', result: act.request.action === 'session.steer.cancel' ? { outcome: 'cancelled' } : { outcome: 'delivered' } });
    expect(await l.cmd('session.steer.cancel', { appSessionId: APP, messageUuid: 'm2' })).toEqual({ ok: true, value: { outcome: 'cancelled' } });
    expect(await l.cmd('maws.pane.answer', { appSessionId: APP, requestId: 'req-1', result: { ok: false, error: 'closed' } })).toEqual({ ok: true, value: { outcome: 'delivered' } });
    expect(l.link.acts.map((a) => a.request)).toEqual([
      { action: 'session.steer.cancel', session: APP, context: { lane: 'B', launchId: 'L1', engineSessionId: `eng-${APP}` }, args: { appSessionId: APP, messageUuid: 'm2' }, executor: 'engine-host', sendBy: expect.any(Number), requires: 'rl2.session-acts' },
      { action: 'maws.pane.answer', session: APP, context: { lane: 'B', launchId: 'L1', engineSessionId: `eng-${APP}` }, args: { appSessionId: APP, requestId: 'req-1', result: { ok: false, error: 'closed' } }, executor: 'engine-host', sendBy: expect.any(Number), requires: 'rl2.session-acts' },
    ]);
  });

  it('never resume a released session for a pane’s answer: the request it answers died with its launch', async () => {
    const l = lab();
    l.link.relink(SESSION_ACTS);
    await vi.advanceTimersByTimeAsync(0);
    l.link.open()[0].sink.ended('unavailable'); // released: no live launch
    expect(await l.cmd('maws.pane.answer', { appSessionId: APP, requestId: 'req-1', result: { ok: false, error: 'closed' } })).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(l.link.acts).toEqual([]);
  });

  it('need the session’s tab for the engine-host acts', async () => {
    const l = lab({ tabs: [] });
    l.link.relink(SESSION_ACTS);
    expect(await l.cmd('session.steer.cancel', { appSessionId: APP, messageUuid: 'm2' })).toMatchObject({ ok: false, error: { issues: { refusal: 'not-open' } } });
    expect(l.link.acts).toEqual([]);
  });

  it('are sent nothing of to a peer whose handshake lacks the capability, answered at once in UC-7.5’s words', async () => {
    const l = lab();
    await live(l); // the peer lists rl2.executor.machine alone, as build F's
    l.link.answers.set('session.list', () => ({ ok: true, output: { sessions: [], revision: 1 } }));
    expect(await l.cmd('session.archive', { appSessionId: APP })).toEqual({ ok: false, error: { code: 'internal', message: 'Not archived: update MAWS on mini and try again', issues: { refusal: 'not-offered' } } });
    expect(await l.cmd('session.rename', { appSessionId: APP, title: 'Loft notes' })).toMatchObject({ ok: false, error: { message: 'Not renamed: update MAWS on mini and try again', issues: { refusal: 'not-offered' } } });
    expect(await l.cmd('attention.acknowledge', machineActs[3][1])).toMatchObject({ ok: false, error: { message: 'Not dismissed: update MAWS on mini and try again' } });
    for (const [name, input] of [['session.update', machineActs[1][1]], ['session.steer.cancel', { appSessionId: APP, messageUuid: 'm2' }], ['maws.pane.answer', { appSessionId: APP, requestId: 'req-1', result: { ok: false, error: 'closed' } }], ['session.list', { includeArchived: true }]] as const) {
      expect([name, await l.cmd(name, input)]).toMatchObject([name, { ok: false, error: { issues: { refusal: 'not-offered' } } }]);
    }
    expect(l.link.acts).toEqual([]);
    expect(l.link.calls.filter((c) => c.name === 'session.list')).toEqual([]);
  });

  it('wait under the link’s hold with no channel current, never answered `host_unavailable`, and end in the offline sentence', async () => {
    const l = lab({ tabs: [] });
    l.link.lose(); // still `up` for the grace: no channel current, no peer known
    l.link.onAct = (act) => act.move('waiting');
    const made = Date.now();
    const archiving = l.cmd('session.archive', { appSessionId: APP });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.acts.map((a) => a.request)).toEqual([{ action: 'session.archive', args: { appSessionId: APP }, executor: 'machine', sendBy: made + 60_000, requires: 'rl2.session-acts' }]);
    let answered = false;
    void archiving.then(() => (answered = true));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(answered).toBe(false);
    l.link.acts[0].settle({ state: 'refused', reason: 'offline' });
    expect(await archiving).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'Not archived: mini is offline', issues: { refusal: 'offline' } } });
  });

  it('word a machine’s refusal and a failure by UC-7.5, the code riding in `issues.refusal`', async () => {
    const l = lab({ tabs: [] });
    l.link.relink(SESSION_ACTS);
    const outcomes: Array<[Parameters<FakeAct['settle']>[0], unknown]> = [
      [{ state: 'refused', reason: 'grade' }, { code: 'internal', message: 'Not renamed: only the session’s owners can', issues: { refusal: 'grade' } }],
      [{ state: 'refused', reason: 'read-only' }, { code: 'internal', message: 'Not renamed: mini is in read-only mode', issues: { refusal: 'read-only' } }],
      [{ state: 'refused', reason: 'unavailable' }, { code: 'host_unavailable', message: 'Not renamed: mini is busy; try again in a moment', issues: { refusal: 'unavailable' } }],
      [{ state: 'not-sent' }, { code: 'host_unavailable', message: 'Not renamed: mini is offline', issues: { refusal: 'not-sent' } }],
      [{ state: 'failed', error: { code: 'internal', message: 'unknown app session: app-1' } }, { code: 'internal', message: 'Not renamed: unknown app session: app-1' }],
    ];
    for (const [outcome, error] of outcomes) {
      l.link.onAct = settleWith(outcome);
      expect(await l.cmd('session.rename', { appSessionId: APP, title: 'Loft notes' }), JSON.stringify(outcome)).toEqual({ ok: false, error });
    }
  });

  it('keep the pending sentence for an act the channel carried whose outcome hasn’t come by the bound', async () => {
    const l = lab({ tabs: [] });
    l.link.relink(SESSION_ACTS);
    l.link.onAct = (act) => act.move('sent');
    const archiving = l.cmd('session.archive', { appSessionId: APP });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await archiving).toEqual({ ok: false, error: { code: 'timeout', message: 'mini took the request but hasn’t confirmed it' } });
  });
});

// The UX wave (U9, M2; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §1, M2's Decisions): a
// fork in place is a `machine` act, signed before its first copy goes, carrying the capability, made from a tab or with
// none, and not through the spawn table: two forks from one tab are two forks. Its answer is waited for within the fork's
// command budget on the machine, past the pending bound; a machine's `ceiling` refusal of it names the mode it refused.
describe('the fork (`rl2.session-acts`)', () => {
  const SESSION_ACTS = ['rl2.executor.machine', 'rl2.session-acts'];
  const FORK = { appSessionId: APP, target: { kind: 'inPlace' }, message: { content: 'go on', display: 'go on' }, rewindTo: 'u-1' };
  const STARTING = { status: 'starting', appSessionId: 'fork-1' };

  it('is a `machine` act on the machine, stepped up before it goes, carrying the capability, on a session no tab holds', async () => {
    const l = lab({ tabs: [] });
    l.link.relink(SESSION_ACTS);
    l.link.onAct = settleWith({ state: 'done', result: STARTING });
    expect(l.adapter.handles('session.fork')).toBe(true);
    expect(await l.cmd('session.fork', FORK)).toEqual({ ok: true, value: STARTING });
    expect(l.link.acts.map((a) => a.request)).toEqual([{ action: 'session.fork', args: FORK, executor: 'machine', sendBy: expect.any(Number), stepUp: 'required', requires: 'rl2.session-acts' }]);
    expect(l.base).toEqual([]);
  });

  it('makes two forks of two presses in one tab', async () => {
    const l = lab();
    l.link.relink(SESSION_ACTS);
    let n = 0;
    l.link.onAct = (act) => act.settle({ state: 'done', result: { status: 'starting', appSessionId: `fork-${++n}` } });
    expect(await l.cmdFrom('session.fork', FORK, APP)).toEqual({ ok: true, value: { status: 'starting', appSessionId: 'fork-1' } });
    expect(await l.cmdFrom('session.fork', FORK, APP)).toEqual({ ok: true, value: { status: 'starting', appSessionId: 'fork-2' } });
    expect(l.link.acts).toHaveLength(2);
  });

  it('waits for its answer within the fork’s budget past the pending bound, where another act reads pending', async () => {
    const l = lab({ tabs: [] });
    l.link.relink(SESSION_ACTS);
    Object.assign(l.link, { budgets: { 'session.fork': 30_000 } });
    l.link.onAct = (act) => act.move('accepted');
    const forking = l.cmd('session.fork', FORK);
    let answered = false;
    void forking.then(() => (answered = true));
    await vi.advanceTimersByTimeAsync(60_000 + 30_000); // the pending bound and the budget, short of the round trip's margin
    expect(answered).toBe(false);
    l.link.acts[0].settle({ state: 'done', result: STARTING });
    expect(await forking).toEqual({ ok: true, value: STARTING });

    const late = l.cmd('session.fork', FORK);
    await vi.advanceTimersByTimeAsync(60_000 + 31_000);
    expect(await late).toEqual({ ok: false, error: { code: 'timeout', message: 'mini took the request but hasn’t confirmed it' } });
  });

  it('is sent nothing of to a peer whose handshake lacks the capability, answered at once in UC-7.5’s words', async () => {
    const l = lab({ tabs: [] });
    l.link.relink(['rl2.executor.machine']); // build F's
    expect(await l.cmd('session.fork', FORK)).toEqual({ ok: false, error: { code: 'internal', message: 'Not forked: update MAWS on mini and try again', issues: { refusal: 'not-offered' } } });
    expect(l.link.acts).toEqual([]);
  });

  it('words the machine’s refusals by UC-7.5, a `ceiling` failure naming the mode it refused', async () => {
    const l = lab({ tabs: [] });
    l.link.relink(SESSION_ACTS);
    const outcomes: Array<[Parameters<FakeAct['settle']>[0], unknown]> = [
      [{ state: 'refused', reason: 'owners-only' }, { code: 'internal', message: 'Not forked: only mini’s owners can', issues: { refusal: 'owners-only' } }],
      [{ state: 'refused', reason: 'step-up' }, { code: 'internal', message: 'Not forked: the confirmation was cancelled', issues: { refusal: 'step-up' } }],
      [{ state: 'refused', reason: 'read-only' }, { code: 'internal', message: 'Not forked: mini is in read-only mode', issues: { refusal: 'read-only' } }],
      [
        { state: 'failed', error: { code: 'internal', message: 'the source’s permission mode bypassPermissions is above this machine’s ceiling', issues: { refusal: 'ceiling', mode: 'bypassPermissions' } } },
        { code: 'internal', message: 'Not forked: mini doesn’t start sessions in bypassPermissions from another machine', issues: { refusal: 'ceiling' } },
      ],
      [{ state: 'failed', error: { code: 'internal', message: 'engine-unconfigured: the engine is not configured yet' } }, { code: 'internal', message: 'Not forked: engine-unconfigured: the engine is not configured yet' }],
    ];
    for (const [outcome, error] of outcomes) {
      l.link.onAct = settleWith(outcome);
      expect(await l.cmd('session.fork', FORK), JSON.stringify(outcome)).toEqual({ ok: false, error });
    }
  });
});

// P5 O15 M2b (the panel's finding 2): the adapter keeps each session's count of its stream's answers, so a record made
// again for a new link object goes on from it, and a page's armed `answer.n` is passed by the new record's first answer
describe('the stream’s answer across records', () => {
  it('a record made again for a new link object continues the session’s count', async () => {
    const l = lab();
    await live(l);
    const said = () => l.of('remote.session').filter((s) => s.address === APP).at(-1)?.answer;
    expect(said()).toEqual({ n: 1, mode: 'snapshot' });
    const next = new FakeLink();
    next.answers.set('session.get', (input) => ({ ok: true, output: record(String(input.appSessionId)) }));
    l.setLinks(new Map([[MINI, next]]));
    await vi.advanceTimersByTimeAsync(0);
    const sub = next.open().find((s) => s.request.session?.id === APP)!;
    sub.sink.subbed('snapshot', { epoch: 'L2', seq: 0 });
    expect(said()).toEqual({ n: 2, mode: 'snapshot' });
    l.adapter.stop();
  });
});

// The UX wave, U9 (M5, "The settled word"; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §9):
// one round per machine and generation of its link. The word is said once, on the session's queue of events, when no
// lane is placing and none awaiting, after the `remote.session` that carried the round's last answer. Each case is in
// main's order of words.
describe('the settled word', () => {
  /** Each word main said, in order: its name, a `remote.session`'s answer, a word's generation. */
  const words = (l: ReturnType<typeof lab>) =>
    l.emitted.map(({ name, payload }) => (name === 'remote.settled' ? `settled ${String(payload.generation)}` : name === 'remote.session' ? `session ${JSON.stringify(payload.answer)}` : name));
  const settledAt = (l: ReturnType<typeof lab>) => words(l).findIndex((w) => w.startsWith('settled'));

  it('holds the word through a transient refusal of the record and its retry, the record, its subscription, and says it after that subscription’s answer', async () => {
    const answers: CallResult[] = [{ ok: false, error: { code: 'offline' } }];
    const l = lab({ record: (input) => answers.shift() ?? { ok: true, output: record(String(input.appSessionId)) } });
    await vi.advanceTimersByTimeAsync(0); // the refusal: a back-off, placing
    expect(l.of('remote.settled')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000); // the retry: the record, and its subscription in the same step
    expect(l.of('session.changed')).toHaveLength(1);
    const sub = l.link.open().find((s) => s.request.session?.id === APP)!;
    expect(sub).toBeDefined();
    expect(l.of('remote.settled'), 'nothing between the record and its subscription’s answer').toEqual([]);
    sub.sink.subbed('snapshot', { epoch: 'L1', seq: 0 });
    expect(l.of('remote.settled')).toEqual([{ machine: MINI, generation: 1 }]);
    const said = words(l);
    expect(said.slice(settledAt(l) - 1, settledAt(l) + 1)).toEqual(['session {"n":1,"mode":"snapshot"}', 'settled 1']);
  });

  it('says nothing between a record read that succeeds and its subscription, and the word after the answer', async () => {
    const l = lab();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('session.changed')).toHaveLength(1);
    expect(l.link.open()).toHaveLength(1);
    expect(l.of('remote.settled')).toEqual([]);
    l.link.open()[0].sink.subbed('replay', { epoch: 'L1', seq: 0 });
    expect(l.of('remote.settled')).toEqual([{ machine: MINI, generation: 1 }]);
    expect(words(l)[settledAt(l) - 1]).toBe('session {"n":1,"mode":"replay"}');
  });

  it('holds the next generation’s word for a subscription kept across a loss until its `subbed`, and says it once', async () => {
    const l = lab();
    const sub = await live(l);
    expect(l.of('remote.settled')).toEqual([{ machine: MINI, generation: 1 }]);
    l.link.set('down', null);
    l.link.set('up');
    expect(l.of('remote.settled'), 'the kept subscription has not answered').toHaveLength(1);
    sub.sink.subbed('replay', { epoch: 'L1', seq: 0 });
    expect(l.of('remote.settled')).toEqual([{ machine: MINI, generation: 1 }, { machine: MINI, generation: 2 }]);
    const said = words(l);
    expect(said.indexOf('session {"n":2,"mode":"replay"}'), 'after the answer that carried the round').toBeLessThan(said.indexOf('settled 2'));
    // said once per generation, whatever opens later
    l.setTabs(APP, 'app-2');
    await vi.advanceTimersByTimeAsync(0);
    l.link.open().find((s) => s.request.session?.id === 'app-2')!.sink.subbed('snapshot', { epoch: 'L9', seq: 0 });
    expect(l.of('remote.settled')).toHaveLength(2);
  });

  it('says it at `up` when the machine has no lane at all, and a round that had not settled says nothing at `down`', async () => {
    const l = lab({ tabs: [] });
    l.setLinks(new Map([[MINI, l.link]]));
    expect(l.of('remote.settled')).toEqual([{ machine: MINI, generation: 1 }]);
    l.link.set('down', null);
    l.link.set('up');
    expect(l.of('remote.settled')).toEqual([{ machine: MINI, generation: 1 }, { machine: MINI, generation: 2 }]);
    l.setTabs(APP); // a lane placing: generation 3's round waits for it, and the loss ends that round unsaid
    l.link.set('down', null);
    l.link.set('up');
    l.link.set('down', null);
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('remote.settled')).toHaveLength(2);
  });

  it('is said again to a page that has just subscribed, for the generation settled', async () => {
    const l = lab();
    await live(l);
    await l.cmd('session.get', { appSessionId: APP });
    expect(l.of('remote.settled')).toEqual([{ machine: MINI, generation: 1 }, { machine: MINI, generation: 1 }]);
  });
});

// The UX wave, U9 (M5, "The three lines share one prefix"; A15): a remote tab's open, counted from the moment the tab's
// interest opens the session; the New chat chooser's two reads of one machine, as one line once both answered
describe('the timing lines', () => {
  const timing = (l: ReturnType<typeof lab>) => l.logs.filter((line) => line.startsWith('lane B: timing '));

  it('logs a remote tab’s open once: the link up, its record, its history asked and its first rows, each from the open', async () => {
    const l = lab();
    l.link.answers.set('session.events', () => ({ ok: true, output: { events: [], lastSeq: 0, complete: true } }));
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(20);
    await l.cmd('session.events', { appSessionId: APP, afterSeq: null, limit: null });
    await l.cmd('session.events', { appSessionId: APP, afterSeq: null, limit: null });
    expect(timing(l).filter((line) => line.startsWith('lane B: timing open'))).toEqual([`lane B: timing open mini/${APP}: link up +0, record +0, history asked +25, first rows +25`]);
  });

  it('logs the chooser’s two reads of a machine, started together, as one line once both answered, and a lone read not at all', async () => {
    const l = lab({ tabs: [] });
    l.link.answers.set('machine.folders.list', () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, output: { entries: [], cursor: null } }), 30)));
    const both = Promise.all([l.cmd('session.projects.list', undefined), l.cmd('machine.folders.list', {})]);
    await vi.advanceTimersByTimeAsync(30);
    await both;
    expect(timing(l)).toEqual(['lane B: timing chooser mini: session.projects.list 0 ms, machine.folders.list 30 ms']);
    const alone = l.cmd('machine.folders.list', {});
    await vi.advanceTimersByTimeAsync(1_000);
    await alone;
    const sheet = Promise.all([l.cmd('session.projects.list', undefined), l.cmd('machine.folders.list', { path: '/srv/a' })]); // a folder of the sheet
    await vi.advanceTimersByTimeAsync(30);
    await sheet;
    expect(timing(l)).toHaveLength(1);
  });
});
