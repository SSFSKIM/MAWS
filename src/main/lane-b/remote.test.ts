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
    expect(await l.cmd('session.events', { appSessionId: APP, afterSeq: null, limit: 10 })).toEqual({ ok: true, value: 'base' });
    expect(await l.cmd('session.interrupt', { appSessionId: APP, cancelEngineQueued: false }, OTHER)).toEqual({ ok: true, value: 'base' });
    expect(l.base).toEqual(['session.status', 'session.events', 'session.interrupt']);
    for (const name of ['session.send', 'session.steer', 'session.interrupt', 'session.answer', 'session.queue.edit', 'session.setModel', 'session.acquire', 'attention.request', 'engine.models'] as CommandName[]) {
      expect(l.adapter.handles(name), name).toBe(true);
    }
    for (const name of ['session.status', 'session.events', 'session.get', 'session.update', 'session.drafts.get', 'laneA.send'] as CommandName[]) expect(l.adapter.handles(name), name).toBe(false);
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
