// One remote lane B session's fold (P5 O7 M2, "One subscription per session", "The record", "An idle session's stream",
// "The capability list"): its record read and retried, its `full` subscription's parts and events turned into the events
// the renderer already consumes, its gaps, its idle retries, and its `remote.session` at each change.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { EventName } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import { humanTurn, item, record, status } from '../../../test/support/builders';
import { deliver, FakeLink, MINI } from '../../../test/lane-b/fake-link';
import { READ_REFUSED } from '@shared/org/reader';
import type { CallResult } from '../machines/remote/link';
import { RemoteSession } from './remote-session';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const APP = 'app-1';
const notice = (launch: string, seq: number, idx: number): SessionEvent =>
  ({ id: `${APP}:${launch}:${seq}:${idx}`, sessionId: 'eng-1', at: '2026-10-31T00:00:00.000Z', seq, agentId: null, parentToolUseId: null, kind: 'notice.posted', level: 'info', text: `${seq}.${idx}`, key: null }) as unknown as SessionEvent;
const statusOf = (launch: string) => ({ ...status(APP), launchId: launch, engineSessionId: 'eng-1' });
const queue = { entries: [], paused: false, pauseReason: null };
const catalog = { commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 1 };
/** An operation's completion as the engine host says it (`session.operation`); the two MCP commands carry no value. */
const operation = (opId: string, command: 'session.mcpReconnect' | 'session.generateTitle' = 'session.mcpReconnect', value: { title: string } | null = null) => ({
  appSessionId: APP,
  opId,
  command,
  late: false,
  outcome: { ok: true as const, value },
});

type Emitted = { machine: MachineRef; name: EventName; payload: Record<string, unknown> };

function lab(options: { record?: () => unknown; followed?: () => boolean; others?: boolean } = {}) {
  const link = new FakeLink();
  const emitted: Emitted[] = [];
  const logs: string[] = [];
  link.answers.set('session.get', () => ({ ok: true, output: options.record === undefined ? record(APP) : options.record() }));
  let revision = 100;
  const session = new RemoteSession({
    machine: MINI,
    app: APP,
    link,
    emit: (machine, name, payload) => {
      const checked = validateEventPayload(name, payload); // what emitFrom refuses, the suite refuses
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      emitted.push({ machine, name, payload: payload as Record<string, unknown> });
    },
    timing: { recordRetryMs: [500, 1000, 2000, 4000], idleRetryMs: [1000, 30_000], idleProbeMaxMs: 30 * 60_000, batchMax: 500 },
    revision: () => ++revision,
    ...(options.followed && { followed: options.followed }),
    ...(options.others !== undefined && { othersSession: () => options.others! }),
    log: (line) => void logs.push(line),
  });
  const names = () => emitted.map((e) => e.name);
  const of = (name: EventName) => emitted.filter((e) => e.name === name).map((e) => e.payload);
  const lastState = () => of('remote.session').at(-1);
  return { link, session, emitted, logs, names, of, lastState };
}

/** Starts the session, its record answered, and opens its subscription with a snapshot of `launch`. */
async function opened(l: ReturnType<typeof lab>, launch = 'L1') {
  l.session.start();
  await vi.advanceTimersByTimeAsync(0);
  const sub = l.link.open()[0];
  sub.sink.subbed('snapshot', { epoch: launch, seq: 0 });
  sub.sink.snapshot({ epoch: launch, seq: 0 }, { status: statusOf(launch), queue, pendingItems: [], catalog });
  return sub;
}

describe('opening', () => {
  it('reads the record, emits it as `session.changed` for the machine, then subscribes `full` from no cursor', async () => {
    const l = lab();
    l.session.start();
    expect(l.lastState()).toMatchObject({ address: APP, stream: 'opening', reason: 'Opening on mini…' });
    expect(l.link.subs).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.calls).toEqual([{ name: 'session.get', input: { appSessionId: APP } }]);
    expect(l.of('session.changed')).toEqual([{ record: record(APP), cause: 'live', revision: 101 }]);
    expect(l.emitted.every((e) => e.machine === MINI)).toBe(true);
    expect(l.link.subs.map((s) => s.request)).toEqual([{ session: { lane: 'B', id: APP }, view: 'full', cursor: null }]);
    expect(l.session.state.record).toEqual(record(APP));
  });

  it('retries a session the machine can’t place yet at 0.5, 1, 2 and 4 s, then ends “can’t place”; a later start tries again', async () => {
    let answer: unknown = null;
    const l = lab({ record: () => answer });
    l.session.start();
    for (const wait of [0, 500, 1000, 2000]) {
      await vi.advanceTimersByTimeAsync(wait);
      expect(l.lastState()).toMatchObject({ stream: 'opening', reason: 'Opening on mini…' });
    }
    await vi.advanceTimersByTimeAsync(4000);
    expect(l.link.calls).toHaveLength(5);
    expect(l.lastState()).toMatchObject({ stream: 'ended', reason: 'mini can’t place this session', controls: { send: { available: false, reason: 'mini can’t place this session' } } });
    expect(l.link.subs).toEqual([]);
    answer = record(APP);
    l.session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.subs).toHaveLength(1);
    expect(l.lastState()).toMatchObject({ reason: null });
  });

  it('counts a `grade` refusal as not placed yet, as null', async () => {
    let n = 0;
    const l = lab();
    l.link.answers.set('session.get', () => (++n < 3 ? { ok: false, error: { code: 'grade' } } : { ok: true, output: record(APP) }));
    l.session.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(n).toBe(3);
    expect(l.link.subs).toHaveLength(1);
  });

  // Board #525: `grade` is also a member below View there, so on another member's session its first one is said at once,
  // in the words the renderer knows; the ladder asks on, so a just-started session the machine places within it still
  // opens. On an owner's (one this app spawned included) it is the machine not placing it yet, as before.
  it('says a `grade` refusal at once as READ_REFUSED, every control closed with it, and opens the record the ladder then reads', async () => {
    let n = 0;
    const l = lab({ others: true });
    l.link.answers.set('session.get', () => (++n < 3 ? { ok: false, error: { code: 'grade' } } : { ok: true, output: record(APP) }));
    l.session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.lastState()).toMatchObject({ stream: 'opening', reason: READ_REFUSED, controls: { send: { available: false, reason: READ_REFUSED } } });
    await vi.advanceTimersByTimeAsync(500);
    expect(n).toBe(2);
    expect(l.lastState()).toMatchObject({ reason: READ_REFUSED });
    await vi.advanceTimersByTimeAsync(1000);
    expect(l.of('session.changed')).toHaveLength(1);
    expect(l.lastState()).toMatchObject({ reason: null });
  });

  it('keeps READ_REFUSED through a transient answer and past the ladder, with no poll after it; a later start that reads the record clears it', async () => {
    let answer: CallResult = { ok: false, error: { code: 'grade' } };
    const l = lab({ others: true });
    l.link.answers.set('session.get', () => answer);
    l.session.start();
    await vi.advanceTimersByTimeAsync(0);
    answer = { ok: false, error: { code: 'offline' } }; // the link's, not the session's: it says nothing of the member's grade
    await vi.advanceTimersByTimeAsync(500);
    expect(l.lastState()).toMatchObject({ reason: READ_REFUSED });
    answer = { ok: false, error: { code: 'grade' } };
    await vi.advanceTimersByTimeAsync(120_000);
    expect(l.lastState()).toMatchObject({ stream: 'ended', reason: READ_REFUSED });
    const asked = l.link.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(l.link.calls).toHaveLength(asked);
    answer = { ok: true, output: record(APP) };
    l.session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.lastState()).toMatchObject({ reason: null });
  });

  it('says an owner’s `grade` refusal as not placed yet: opening through the ladder, then “can’t place”', async () => {
    for (const others of [false, undefined]) {
      const l = lab(others === undefined ? {} : { others });
      l.link.answers.set('session.get', () => ({ ok: false, error: { code: 'grade' } }));
      l.session.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(l.lastState()).toMatchObject({ stream: 'opening', reason: 'Opening on mini…' });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(l.lastState()).toMatchObject({ stream: 'ended', reason: 'mini can’t place this session' });
      l.session.stop();
    }
  });
});

describe('the stream', () => {
  it('turns the opening’s parts into the events the renderer reads, the status first: broker items as attention items still waiting', async () => {
    const l = lab();
    l.session.start();
    await vi.advanceTimersByTimeAsync(0);
    const sub = l.link.open()[0];
    sub.sink.subbed('snapshot', { epoch: 'L1', seq: 0 });
    const waiting = item(APP, 'permission', '2026-10-31T00:00:00.000Z');
    const answered = item(APP, 'question', '2026-10-31T00:00:01.000Z', { state: 'confirmed' });
    const before = l.emitted.length;
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { status: statusOf('L1'), queue, pendingItems: [waiting, answered], catalog });
    expect(l.emitted.slice(before).map((e) => e.name).filter((n) => n !== 'remote.session')).toEqual(['session.status', 'session.queue', 'session.catalogChanged', 'attention.changed']);
    expect(l.of('session.status')).toEqual([{ appSessionId: APP, status: statusOf('L1') }]);
    expect(l.of('session.queue')).toEqual([{ ...queue, appSessionId: APP }]);
    expect(l.of('session.catalogChanged')).toEqual([{ appSessionId: APP, launchId: 'L1', catalog }]);
    expect(l.of('attention.changed')).toEqual([{ appSessionId: APP, items: [waiting] }]);
    expect(l.session.state).toMatchObject({ stream: 'live', launch: 'L1' });
    expect(l.session.context()).toEqual({ launchId: 'L1', engineSessionId: 'eng-1' });
    // A later part alone replaces its own.
    sub.sink.snapshot({ epoch: 'L1', seq: 3 }, { pendingItems: [] });
    expect(l.of('attention.changed').at(-1)).toEqual({ appSessionId: APP, items: [] });
  });

  // UC-1 (A17): a machine on an older build still sends a delivered broker item; it is answered, so the window is not told it
  it('tells the window no broker item whose answer was delivered', async () => {
    const l = lab();
    l.session.start();
    await vi.advanceTimersByTimeAsync(0);
    const sub = l.link.open()[0];
    sub.sink.subbed('snapshot', { epoch: 'L1', seq: 0 });
    const waiting = item(APP, 'permission', '2026-10-31T00:00:00.000Z');
    const answered = item(APP, 'permission', '2026-10-31T00:00:01.000Z', { id: 'att-answered' as never, state: 'delivered' });
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { status: statusOf('L1'), queue, pendingItems: [waiting, answered], catalog });
    expect(l.of('attention.changed')).toEqual([{ appSessionId: APP, items: [waiting] }]);
  });

  it('batches events per macrotask, at most 500 to a batch, before any part that follows', async () => {
    const l = lab();
    const sub = await opened(l);
    const events = Array.from({ length: 501 }, (_, i) => notice('L1', 1 + Math.floor(i / 2), i % 2));
    for (const e of events) deliver(sub, { epoch: 'L1', seq: e.seq!, idx: Number(e.id.split(':').at(-1)) }, e);
    expect(l.of('session.eventBatch')).toHaveLength(1); // the 500th flushed at once
    await vi.advanceTimersByTimeAsync(0);
    const batches = l.of('session.eventBatch');
    expect(batches.map((b) => (b.events as unknown[]).length)).toEqual([500, 1]);
    expect(batches.flatMap((b) => b.events as SessionEvent[]).map((e) => e.id)).toEqual(events.map((e) => e.id));
    deliver(sub, { epoch: 'L1', seq: 300, idx: 0 }, notice('L1', 300, 0));
    sub.sink.snapshot({ epoch: 'L1', seq: 300, idx: 0 }, { queue: { ...queue, paused: true } });
    expect(l.names().filter((n) => n === 'session.eventBatch' || n === 'session.queue').slice(-2)).toEqual(['session.eventBatch', 'session.queue']);
  });

  it('tells a gap once each for a later snapshot (a relaunch), a missing range and an event too large to carry, before what follows; the first subbed and a replay tell none', async () => {
    const l = lab();
    const sub = await opened(l);
    expect(l.of('remote.gap')).toEqual([]);
    sub.sink.subbed('replay', { epoch: 'L1', seq: 0 });
    expect(l.of('remote.gap')).toEqual([]);
    sub.sink.subbed('snapshot', { epoch: 'L2', seq: 0 });
    const gapAt = l.names().lastIndexOf('remote.gap');
    expect(l.of('remote.gap')).toEqual([{ appSessionId: APP, launchId: 'L2' }]);
    expect(l.lastState()).toMatchObject({ stream: 'gap' });
    sub.sink.snapshot({ epoch: 'L2', seq: 0 }, { status: statusOf('L2'), queue, pendingItems: [], catalog });
    expect(l.names().indexOf('session.status', gapAt)).toBeGreaterThan(gapAt);
    expect(l.lastState()).toMatchObject({ stream: 'live' });
    expect(l.session.context()).toEqual({ launchId: 'L2', engineSessionId: 'eng-1' });
    // A `missing` stream goes on from what the machine still has (lane B's from the launch's start): the hole ends at the
    // first event it delivers, which the gap names (`at`), told just before it; an omitted event names its own place
    sub.sink.subbed('missing', { epoch: 'L2', seq: 0, idx: -1 });
    expect(l.lastState()).toMatchObject({ stream: 'gap' });
    expect(l.of('remote.gap')).toHaveLength(1);
    deliver(sub, { epoch: 'L2', seq: 8, idx: 0 }, notice('L2', 8, 0));
    expect(l.of('remote.gap')).toHaveLength(2);
    deliver(sub, { epoch: 'L2', seq: 9, idx: 0 }, { omitted: 'too-large', bytes: 5_000_000 });
    expect(l.of('session.eventBatch')).toHaveLength(1); // flushed before the gap
    expect(l.of('remote.gap')).toEqual([
      { appSessionId: APP, launchId: 'L2' },
      { appSessionId: APP, launchId: 'L2', at: { seq: 8, idx: 0 } },
      { appSessionId: APP, launchId: 'L2', at: { seq: 9, idx: 0 } },
    ]);
    expect((l.of('session.eventBatch')[0].events as SessionEvent[]).map((e) => e.id)).toEqual([notice('L2', 8, 0).id]);
    expect(l.names().filter((n) => n === 'remote.gap' || n === 'session.eventBatch').slice(-3)).toEqual(['remote.gap', 'session.eventBatch', 'remote.gap']); // each gap before what follows it
  });

  it('tells a `missing` gap the stream delivered nothing after when it ends, with no place', async () => {
    const l = lab();
    const sub = await opened(l);
    sub.sink.subbed('missing', { epoch: 'L1', seq: 0, idx: -1 });
    expect(l.of('remote.gap')).toEqual([]);
    sub.sink.ended('unavailable');
    expect(l.of('remote.gap')).toEqual([{ appSessionId: APP, launchId: 'L1' }]);
  });

  // P5 O7 M8 (m8-1, red first; "What draws Working…"): an event this build can't read is left out with a log line and
  // nothing else, so a dropped `turn.ended` leaves its turn open and the pane drawing "Working…" until a relaunch. The
  // rule M8 binds: it is a gap at its place, and the session's status and record are read again, the re-read folded in,
  // so the turn the stream left open closes by the machine's word. The renderer's gap bar is a notice and closes no turn
  // (transcript/source/ipc.ts), so the healing is the re-read status (`turn: null`) emitted after the gap. Flipped by m8-3.
  it('marks an unreadable `turn.ended` as a gap at its place, reads the status and the record again, and the re-read status closes the open turn', async () => {
    const l = lab();
    l.session.start();
    await vi.advanceTimersByTimeAsync(0);
    const sub = l.link.open()[0];
    const running = { ...status(APP, { engineState: 'running', turn: humanTurn }), launchId: 'L1', engineSessionId: 'eng-1' };
    sub.sink.subbed('snapshot', { epoch: 'L1', seq: 0 });
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { status: running, queue, pendingItems: [], catalog });
    const started = { id: `${APP}:L1:4:0`, sessionId: 'eng-1', at: '2026-10-31T00:00:00.000Z', seq: 4, agentId: null, parentToolUseId: null, kind: 'turn.started', userMessageUuid: null, origin: 'human' };
    deliver(sub, { epoch: 'L1', seq: 4, idx: 0 }, started);
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('session.eventBatch').flatMap((b) => b.events as SessionEvent[]).map((e) => e.kind)).toEqual(['turn.started']); // the turn is open
    const rested = statusOf('L1'); // the machine's word after the turn: idle, `turn: null`
    l.link.answers.set('session.status', () => ({ ok: true, output: rested }));
    const asked = l.link.calls.length;
    const from = l.emitted.length;
    deliver(sub, { epoch: 'L1', seq: 5, idx: 0 }, { ...started, id: `${APP}:L1:5:0`, seq: 5, kind: 'turn.ended', costUsd: 'not a number' });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('remote.gap')).toEqual([{ appSessionId: APP, launchId: 'L1', at: { seq: 5, idx: 0 } }]);
    expect(l.link.calls.slice(asked)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'session.status', input: { appSessionId: APP } }), expect.objectContaining({ name: 'session.get', input: { appSessionId: APP } })]));
    const after = l.emitted.slice(from);
    const gapAt = after.findIndex((e) => e.name === 'remote.gap');
    const healed = after.findIndex((e, i) => i > gapAt && e.name === 'session.status');
    expect([gapAt >= 0, healed > gapAt]).toEqual([true, true]);
    expect(after[healed].payload).toEqual({ appSessionId: APP, status: rested });
    expect(after.slice(gapAt).some((e) => e.name === 'session.changed')).toBe(true);
    expect(l.session.state.status).toMatchObject({ engineState: 'idle', turn: null });
  });

  it('keeps a status the stream delivered after the gap over the re-read that answers later', async () => {
    const l = lab();
    const sub = await opened(l);
    let answer!: (value: unknown) => void;
    l.link.answers.set('session.status', () => new Promise((resolve) => (answer = resolve)) as never);
    deliver(sub, { epoch: 'L1', seq: 5, idx: 0 }, { kind: 'turn.ended', costUsd: 'not a number' });
    await vi.advanceTimersByTimeAsync(0);
    const newer = { ...status(APP, { engineState: 'running', turn: humanTurn }), launchId: 'L1', engineSessionId: 'eng-1' };
    sub.sink.snapshot({ epoch: 'L1', seq: 6 }, { status: newer });
    answer({ ok: true, output: statusOf('L1') });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('session.status').at(-1)).toEqual({ appSessionId: APP, status: newer });
    expect(l.session.state.status).toEqual(newer);
  });

  it('reads again once per run of unreadable events: one read out at a time, one more after it for those it missed', async () => {
    const l = lab();
    const sub = await opened(l);
    const answers: Array<() => void> = [];
    l.link.answers.set('session.status', () => new Promise((resolve) => answers.push(() => resolve({ ok: true, output: statusOf('L1') }))) as never);
    const reads = () => l.link.calls.filter((c) => c.name === 'session.status').length;
    for (let seq = 5; seq < 9; seq += 1) deliver(sub, { epoch: 'L1', seq, idx: 0 }, { kind: 'turn.ended', costUsd: 'not a number' });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('remote.gap')).toHaveLength(4); // each at its place
    expect(reads()).toBe(1);
    answers.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(reads()).toBe(2);
    answers.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(reads()).toBe(2);
  });

  it('passes the link’s and the machine’s pauses on as the stream’s state', async () => {
    const l = lab();
    const sub = await opened(l);
    sub.sink.paused('offline');
    expect(l.lastState()).toMatchObject({ stream: 'paused' });
    sub.sink.resumed();
    expect(l.lastState()).toMatchObject({ stream: 'live' });
  });

  // P5 O7 M8 ("Operations and panel events"; Interfaces §U): the machine's notices beside the stream's state, each its
  // local event under the machine's address. The `side` part says nothing of its own: the side question's completion is
  // its `operation` part, which the side store already patches its log from or lists it again on (side/store.ts,
  // `onSideOperation`).
  it('emits each panel part as its local event, two completions in a row both, a completion in the opening too; the side part adds none', async () => {
    const l = lab();
    l.session.start();
    await vi.advanceTimersByTimeAsync(0);
    const sub = l.link.open()[0];
    sub.sink.subbed('snapshot', { epoch: 'L1', seq: 0 });
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { operation: operation('op-0') }); // ahead of the opening's state
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { status: statusOf('L1'), queue, pendingItems: [], catalog });
    sub.sink.snapshot({ epoch: 'L1', seq: 1 }, { operation: operation('op-1') });
    sub.sink.snapshot({ epoch: 'L1', seq: 1 }, { operation: operation('op-2', 'session.generateTitle', { title: 'Named' }) });
    sub.sink.snapshot({ epoch: 'L1', seq: 1 }, { subagents: { agents: [] } });
    sub.sink.snapshot({ epoch: 'L1', seq: 1 }, { workflow: { runId: 'run-1' } });
    sub.sink.snapshot({ epoch: 'L1', seq: 1 }, { tasks: { listId: 'eng-1' } });
    const said = l.emitted.length;
    sub.sink.snapshot({ epoch: 'L1', seq: 1 }, { side: { exchanges: [] } });
    expect(l.emitted.slice(said).filter((e) => e.name !== 'remote.session')).toEqual([]);
    expect(l.of('session.operation')).toEqual([operation('op-0'), operation('op-1'), operation('op-2', 'session.generateTitle', { title: 'Named' })]);
    expect(l.of('fs.subagentsChanged')).toEqual([{ appSessionId: APP, agents: [] }]);
    expect(l.of('fs.workflowChanged')).toEqual([{ appSessionId: APP, runId: 'run-1' }]);
    expect(l.of('fs.tasksChanged')).toEqual([{ listId: 'eng-1' }]);
    expect(l.emitted.every((e) => e.machine === MINI)).toBe(true);
  });

  it('opens again from its cursor at once when the machine ends the stream `behind`, with the status kept', async () => {
    const l = lab();
    const sub = await opened(l);
    deliver(sub, { epoch: 'L1', seq: 4, idx: 0 }, notice('L1', 4, 0));
    sub.sink.ended('behind');
    expect(l.link.open().map((s) => s.request.cursor)).toEqual([{ epoch: 'L1', seq: 4, idx: 0 }]);
    expect(l.session.state).toMatchObject({ ended: null, status: statusOf('L1') });
    expect(l.lastState()).not.toMatchObject({ stream: 'ended' });
    l.link.open()[0].sink.subbed('replay', { epoch: 'L1', seq: 4, idx: 0 });
    expect(l.lastState()).toMatchObject({ stream: 'live' });
    expect(l.of('remote.gap')).toEqual([]);
  });
});

// P5 O7 M8 ("Operations and panel events"): a completion the channel lost on the way is asked of the machine at every
// opening of the stream, for the receipts this session's waiters hold (`session.operations`).
describe('operations across a reopening', () => {
  const LOST = 'the machine lost this operation’s result; check the transcript';
  function asked(l: ReturnType<typeof lab>) {
    return l.link.calls.filter((c) => c.name === 'session.operations').map((c) => c.input);
  }

  it('asks at the reopening for the waiters’ opIds: emits a completion it missed, keeps a pending one for its part, settles a forgotten one as failed; drops what follows a settled one', async () => {
    const l = lab();
    const sub = await opened(l);
    for (const opId of ['op-done', 'op-running', 'op-gone']) l.session.awaitOperation(opId, 'session.mcpReconnect');
    l.link.answers.set('session.operations', (input) => ({
      ok: true,
      output: { outcomes: (input.opIds as string[]).map((opId) => (opId === 'op-done' ? { opId, event: operation(opId) } : opId === 'op-running' ? { opId, pending: true } : { opId, unknown: true })) },
    }));
    sub.sink.ended('unavailable'); // the session was released between the receipts and their completions
    expect(asked(l)).toEqual([]);
    l.session.kick();
    l.link.open()[0].sink.subbed('snapshot', { epoch: 'L1', seq: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked(l)).toEqual([{ appSessionId: APP, opIds: ['op-done', 'op-running', 'op-gone'] }]);
    expect(l.of('session.operation')).toEqual([
      operation('op-done'),
      { appSessionId: APP, opId: 'op-gone', command: 'session.mcpReconnect', late: false, outcome: { ok: false, error: { code: 'engine_error', message: LOST, engineCode: null } } },
    ]);
    const again = l.link.open()[0];
    again.sink.snapshot({ epoch: 'L1', seq: 1 }, { operation: operation('op-running') });
    again.sink.snapshot({ epoch: 'L1', seq: 1 }, { operation: operation('op-gone') }); // late, for one settled: dropped
    again.sink.snapshot({ epoch: 'L1', seq: 1 }, { operation: operation('op-done') }); // a repeat: dropped
    expect(l.of('session.operation').map((e) => e.opId)).toEqual(['op-done', 'op-gone', 'op-running']);
    // nothing left waiting: the next opening asks nothing
    again.sink.ended('behind');
    l.link.open()[0].sink.subbed('replay', { epoch: 'L1', seq: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked(l)).toHaveLength(1);
  });

  it('emits a completion that came on the stream during the opening once, though the machine’s answer carries it too; a late success still passes once', async () => {
    const l = lab();
    const sub = await opened(l);
    l.session.awaitOperation('op-1', 'session.mcpReconnect');
    l.link.answers.set('session.operations', () => ({ ok: true, output: { outcomes: [{ opId: 'op-1', event: operation('op-1') }] } }));
    sub.sink.ended('behind');
    const next = l.link.open()[0];
    next.sink.subbed('replay', { epoch: 'L1', seq: 0 });
    next.sink.snapshot({ epoch: 'L1', seq: 0 }, { operation: operation('op-1') }); // ahead of the answer
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('session.operation')).toEqual([operation('op-1')]);
    const late = { ...operation('op-1'), late: true };
    next.sink.snapshot({ epoch: 'L1', seq: 1 }, { operation: late });
    next.sink.snapshot({ epoch: 'L1', seq: 1 }, { operation: late });
    expect(l.of('session.operation')).toEqual([operation('op-1'), late]);
  });

  it('gives a waiter whose first completion it never saw the late one the machine kept in its place as its first', async () => {
    const l = lab();
    const sub = await opened(l);
    l.session.awaitOperation('op-1', 'session.mcpReconnect');
    l.link.answers.set('session.operations', () => ({ ok: true, output: { outcomes: [{ opId: 'op-1', event: { ...operation('op-1'), late: true } }] } }));
    sub.sink.ended('behind');
    l.link.open()[0].sink.subbed('replay', { epoch: 'L1', seq: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('session.operation')).toEqual([operation('op-1')]);
  });

  it('holds no waiter for a receipt whose completion came first, and asks again at the next opening after a read that failed', async () => {
    const l = lab();
    const sub = await opened(l);
    sub.sink.snapshot({ epoch: 'L1', seq: 1 }, { operation: operation('op-early') });
    l.session.awaitOperation('op-early', 'session.mcpReconnect'); // its receipt answered after its completion
    l.session.awaitOperation('op-1', 'session.mcpReconnect');
    l.link.answers.set('session.operations', () => ({ ok: false, error: { code: 'offline' } }));
    sub.sink.ended('behind');
    l.link.open()[0].sink.subbed('replay', { epoch: 'L1', seq: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked(l)).toEqual([{ appSessionId: APP, opIds: ['op-1'] }]);
    l.link.answers.set('session.operations', () => ({ ok: true, output: { outcomes: [{ opId: 'op-1', event: operation('op-1') }] } }));
    l.link.open()[0].sink.ended('behind');
    await vi.advanceTimersByTimeAsync(250); // a second `behind` with the cursor standing backs off
    l.link.open()[0].sink.subbed('replay', { epoch: 'L1', seq: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked(l)).toHaveLength(2);
    expect(l.of('session.operation').map((e) => e.opId)).toEqual(['op-early', 'op-1']);
  });
});

describe('an idle session', () => {
  it('reads an `ended unavailable` as not live: idle, no status, subscribed again from its cursor on a doubling backoff; `kick` subscribes at once', async () => {
    const l = lab();
    const sub = await opened(l);
    deliver(sub, { epoch: 'L1', seq: 4, idx: 1 }, notice('L1', 4, 1));
    sub.sink.ended('unavailable');
    expect(l.session.state).toMatchObject({ stream: 'idle', status: null });
    expect(l.session.context()).toBeNull();
    expect(l.lastState()).toMatchObject({ stream: 'idle', reason: null, controls: { send: { available: true } } });
    await vi.advanceTimersByTimeAsync(999);
    expect(l.link.open()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(l.link.open().map((s) => s.request.cursor)).toEqual([{ epoch: 'L1', seq: 4, idx: 1 }]);
    l.link.open()[0].sink.ended('unavailable');
    await vi.advanceTimersByTimeAsync(1999);
    expect(l.link.open()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    l.link.open()[0].sink.ended('unavailable');
    l.session.kick();
    expect(l.link.open()).toHaveLength(1);
    // A fresh subscription's first subbed tells no gap, its launch another or not.
    const again = l.link.open()[0];
    again.sink.subbed('snapshot', { epoch: 'L2', seq: 0 });
    expect(l.of('remote.gap')).toEqual([]);
  });

  // O5's landing audit: each try places the session on the machine's engine host (waking a parked one) and reports
  // interest, which restarts the machine's park clock; so an open tab on a session that isn't live tries again only when
  // its record says it runs, carried by the checkout feed.
  it('with its record followed, waits for it: no try in 15 min; a record that says it runs, or names another engine session, subscribes at once', async () => {
    const l = lab({ followed: () => true });
    const sub = await opened(l);
    sub.sink.ended('unavailable');
    expect(l.session.state.stream).toBe('idle');
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(l.link.subs).toHaveLength(1);

    // A change that says nothing of its running (a title) is told, and tries nothing.
    const titled = { ...record(APP), holder: { kind: 'none' as const }, title: { text: 'renamed', source: 'user' as const } };
    l.session.recordChanged(titled);
    expect(l.of('session.changed').at(-1)).toMatchObject({ record: titled, cause: 'live' });
    expect(l.session.state.record).toEqual(titled);
    expect(l.link.subs).toHaveLength(1);

    l.session.recordChanged({ ...titled, holder: { kind: 'self' } });
    expect(l.link.open()).toHaveLength(1);
    l.link.open()[0].sink.ended('unavailable'); // it went again before the stream opened: wait again
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(l.link.subs).toHaveLength(2);
    l.session.recordChanged({ ...titled, engineSessionId: 'eng-2' as never }); // a `/clear` elsewhere
    expect(l.link.subs).toHaveLength(3);
    // While the stream is open, a record is told and tries nothing.
    l.link.open()[0].sink.subbed('snapshot', { epoch: 'L2', seq: 0 });
    l.session.recordChanged({ ...titled, holder: { kind: 'self' } });
    expect(l.link.subs).toHaveLength(3);
  });

  it('without a feed carrying its record, tries again on a backoff that grows past the machine’s park window (10 min) and stays there', async () => {
    const l = lab();
    const sub = await opened(l);
    sub.sink.ended('unavailable');
    const tries: number[] = [];
    const start = Date.now();
    for (let waited = 0; waited < 2 * 60 * 60_000; waited += 1000) {
      await vi.advanceTimersByTimeAsync(1000);
      const open = l.link.open();
      if (open.length === 0) continue;
      tries.push(Date.now() - start);
      open[0].sink.ended('unavailable');
    }
    const gaps = tries.map((at, i) => at - (tries[i - 1] ?? 0));
    expect(gaps.slice(0, 4)).toEqual([1000, 2000, 4000, 8000]);
    expect(gaps.filter((gap) => gap < 10 * 60_000).length).toBe(10); // 1 s to 512 s, then each well past the window
    expect(gaps.slice(10).every((gap) => gap >= 17 * 60_000 && gap <= 30 * 60_000)).toBe(true);
    expect(tries.length).toBeLessThan(15);
  });

  it('ends for good on `removed`, and stops on its own at `stop`', async () => {
    const l = lab();
    const sub = await opened(l);
    l.link.set('down', null, 'removed');
    sub.sink.ended('removed');
    expect(l.lastState()).toMatchObject({ stream: 'ended', reason: 'This Mac is no longer allowed on mini', link: { state: 'down', refusal: 'removed' } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(l.link.subs).toHaveLength(1);
    const m = lab();
    const s = await opened(m);
    m.session.stop();
    expect(s.closed).toBe(true);
  });
});

describe('remote.session', () => {
  it('closes every control on a session-only `removed` (the right on it withdrawn, the link still up), in the session’s words', async () => {
    const l = lab();
    const sub = await opened(l);
    sub.sink.ended('removed');
    const ended = l.lastState()!;
    expect(ended).toMatchObject({ stream: 'ended', reason: 'mini no longer lets you open this session', link: { state: 'up', refusal: null } });
    expect(Object.values(ended.controls as Record<string, { available: boolean }>).every((c) => !c.available)).toBe(true);
  });

  it('says the record, the last of each part and its state again at `replay`, for a page that just subscribed', async () => {
    const l = lab();
    await opened(l);
    const said = l.emitted.length;
    l.session.replay();
    expect(l.names().slice(said)).toEqual(['session.changed', 'session.status', 'session.queue', 'session.catalogChanged', 'attention.changed', 'remote.session']);
    expect(l.emitted.slice(said).map((e) => e.payload)).toEqual([
      { record: record(APP), cause: 'live', revision: expect.any(Number) },
      { appSessionId: APP, status: statusOf('L1') },
      { ...queue, appSessionId: APP },
      { appSessionId: APP, launchId: 'L1', catalog },
      { appSessionId: APP, items: [] },
      l.lastState(),
    ]);
  });

  it('follows the link’s state and caps, said once per change', async () => {
    const l = lab();
    await opened(l);
    const count = () => l.of('remote.session').length;
    const before = count();
    l.link.set('up', 'direct');
    expect(count()).toBe(before); // nothing changed
    l.link.set('up', 'relay');
    expect(l.lastState()).toMatchObject({ link: { state: 'up', carrier: 'relay', member: 'member-a', rights: ['spawn'] } });
    l.link.setCaps({ member: 'member-a', device: 'mac1', clientClass: 'native-mac', machine: { grades: ['spawn', 'shell'] }, stateVersion: 3 });
    expect(l.lastState()).toMatchObject({ link: { rights: ['spawn', 'shell'] } });
    l.link.set('down');
    // media too since M4c lifted its gap (uploads cross in parts), as a send does while the link is down
    expect(l.lastState()).toMatchObject({ link: { state: 'down', carrier: null }, reason: null, controls: { send: { available: true }, media: { available: true } } });
  });
});

// m8-3's task review: the races a reopening leaves open (the reviewer's reproductions, ported).
describe('a reopening’s races', () => {
  it('reconciles a receipt that comes after the opening it was made before has reconciled (RL4 recovered it late)', async () => {
    const l = lab();
    const sub = await opened(l);
    l.link.answers.set('session.operations', () => ({ ok: true, output: { outcomes: [{ opId: 'op-1', event: operation('op-1') }] } }));
    const made = l.session.openings(); // the act went out on this opening
    sub.sink.subbed('replay', { epoch: 'L1', seq: 0 }); // the channel lost the receipt and the completion; the link resubscribed
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.calls.filter((c) => c.name === 'session.operations')).toEqual([]); // nothing was waiting then
    l.session.awaitOperation('op-1', 'session.mcpReconnect', made);
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('session.operation')).toEqual([operation('op-1')]);
    // a receipt made and heard within one opening asks nothing: its part comes on the stream
    l.session.awaitOperation('op-2', 'session.mcpReconnect', l.session.openings());
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.calls.filter((c) => c.name === 'session.operations')).toHaveLength(1);
  });

  it('takes a late completion heard before its receipt as the first this app saw', async () => {
    const l = lab();
    const sub = await opened(l);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { operation: { ...operation('op-1'), late: true } });
    l.session.awaitOperation('op-1', 'session.mcpReconnect', l.session.openings());
    expect(l.of('session.operation')).toEqual([operation('op-1')]);
  });

  it('never brings a released launch’s context back from a re-read that answers after the stream ended', async () => {
    const l = lab();
    const sub = await opened(l);
    let answer!: (value: unknown) => void;
    l.link.answers.set('session.status', () => ({ ok: true, output: statusOf('L1') }));
    l.link.answers.set('session.get', () => new Promise((resolve) => (answer = resolve)) as never);
    deliver(sub, { epoch: 'L1', seq: 1, idx: 0 }, { kind: 'turn.ended', costUsd: 'bad' });
    await vi.advanceTimersByTimeAsync(0); // the status answered; the record is still out
    sub.sink.ended('unavailable');
    expect(l.session.context()).toBeNull();
    answer({ ok: true, output: record(APP) });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.session.context()).toBeNull();
    expect(l.session.state.stream).toBe('idle');
  });
});

// m8-3's task review, the architect's A: what a panel lists is never left silently stale across a reopening.
describe('the panels across a reopening', () => {
  it('makes every panel list again at each opening after the first: the task list, the subagents, the workflow runs, and the side questions’ word', async () => {
    const l = lab();
    const sub = await opened(l);
    sub.sink.snapshot({ epoch: 'L1', seq: 0 }, { status: { ...statusOf('L1'), taskListId: 'team/list' } });
    l.link.answers.set('fs.subagents', () => ({ ok: true, output: { agents: [] } }));
    l.link.answers.set('fs.workflows', () => ({ ok: true, output: { runs: [{ runId: 'run-9', snapshot: null, journal: [] }] } }));
    const panelEvents = () => l.names().filter((n) => ['fs.tasksChanged', 'fs.subagentsChanged', 'fs.workflowChanged', 'remote.reopened'].includes(n));
    expect(panelEvents()).toEqual([]); // the first opening: each panel lists on its mount
    sub.sink.subbed('replay', { epoch: 'L1', seq: 0 }); // the link resubscribed
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('fs.tasksChanged')).toEqual([{ listId: 'team-list' }]);
    expect(l.of('fs.subagentsChanged')).toEqual([{ appSessionId: APP, agents: [] }]);
    expect(l.of('fs.workflowChanged')).toEqual([{ appSessionId: APP, runId: '' }]); // no run in particular: the list as a whole
    expect(l.of('remote.reopened')).toEqual([{ appSessionId: APP }]);
    expect(l.link.calls.filter((c) => c.name === 'fs.workflows')).toEqual([]); // the panels read their own
  });
});

// m8-3's task review, the architect's B: a stream that keeps ending `behind` with no progress backs off, then falls back.
describe('`behind` bounded by progress', () => {
  it('reopens at once, then backs off from 250 ms while the cursor stands, and after three reopens with no progress shows the gap and retries on the idle backoff; progress resets it', async () => {
    const l = lab();
    const sub = await opened(l);
    deliver(sub, { epoch: 'L1', seq: 4, idx: 0 }, notice('L1', 4, 0));
    const opens = () => l.link.open().length;
    sub.sink.ended('behind');
    expect(opens()).toBe(1); // the first reopen: at once
    for (const wait of [250, 500]) {
      l.link.open()[0].sink.ended('behind'); // no event since: the cursor stands
      expect(opens()).toBe(0);
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(opens()).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(opens()).toBe(1);
    }
    l.link.open()[0].sink.ended('behind'); // the third reopen with no progress
    expect(l.lastState()).toMatchObject({ stream: 'gap' });
    await vi.advanceTimersByTimeAsync(999);
    expect(opens()).toBe(0);
    await vi.advanceTimersByTimeAsync(1); // the idle backoff's first step
    expect(opens()).toBe(1);
    // progress: the next `behind` reopens at once again
    const moving = l.link.open()[0];
    moving.sink.subbed('replay', { epoch: 'L1', seq: 4, idx: 0 });
    deliver(moving, { epoch: 'L1', seq: 5, idx: 0 }, notice('L1', 5, 0));
    moving.sink.ended('behind');
    expect(opens()).toBe(1);
  });
});

// m8-3's task review, round 2 (the reviewer's probes, ported).
describe('a reopening’s races, round 2', () => {
  it('keeps doubling the fallback’s backoff across openings that end `behind` with no progress', async () => {
    const l = lab();
    const sub = await opened(l);
    sub.sink.ended('behind');
    for (const delay of [250, 500, 1000]) {
      const next = l.link.open()[0];
      next.sink.subbed('replay', { epoch: 'L1', seq: 0 });
      next.sink.ended('behind');
      await vi.advanceTimersByTimeAsync(delay);
      expect(l.link.open()).toHaveLength(1);
    }
    const next = l.link.open()[0];
    next.sink.subbed('replay', { epoch: 'L1', seq: 0 });
    next.sink.ended('behind');
    await vi.advanceTimersByTimeAsync(1000);
    expect(l.link.open()).toHaveLength(0); // the second fallback waits 2 s
    await vi.advanceTimersByTimeAsync(1000);
    expect(l.link.open()).toHaveLength(1);
  });

  it('never replaces a newer subagents part with the reopening’s older read', async () => {
    const l = lab();
    const sub = await opened(l);
    let answer!: (value: unknown) => void;
    l.link.answers.set('fs.subagents', () => new Promise((resolve) => (answer = resolve)) as never);
    sub.sink.subbed('replay', { epoch: 'L1', seq: 0 });
    const agents = [{ agentId: 'agent-1', meta: null, transcriptPath: '/scratch/agent-1.jsonl', size: 0, mtimeMs: 1, runId: null }];
    sub.sink.snapshot({ epoch: 'L1', seq: 1 }, { subagents: { agents } });
    answer({ ok: true, output: { agents: [] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('fs.subagentsChanged').at(-1)?.agents).toEqual(agents);
  });

  it('tells the workflow panels to list again at a reopening though no run was ever named and none is listed now', async () => {
    const l = lab();
    const sub = await opened(l);
    l.link.answers.set('fs.workflows', () => ({ ok: true, output: { runs: [] } }));
    sub.sink.subbed('replay', { epoch: 'L1', seq: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.of('fs.workflowChanged')).toEqual([{ appSessionId: APP, runId: '' }]);
  });
});

// M8's reviewer-high review: a gap's re-read never rolls a newer record back.
describe('a gap’s re-read and the record feed', () => {
  it('drops the re-read record when the checkout feed changed the record while the reads were out', async () => {
    const l = lab({ followed: () => true });
    const sub = await opened(l);
    let status!: (value: unknown) => void;
    l.link.answers.set('session.status', () => new Promise((resolve) => (status = resolve)) as never);
    l.link.answers.set('session.get', () => ({ ok: true, output: record(APP) })); // R1, answered at once
    deliver(sub, { epoch: 'L1', seq: 5, idx: 0 }, { kind: 'turn.ended', costUsd: 'not a number' });
    await vi.advanceTimersByTimeAsync(0);
    const renamed = { ...record(APP), title: { text: 'renamed', source: 'user' as const } }; // R2, from the feed
    l.session.recordChanged(renamed);
    status({ ok: true, output: statusOf('L1') });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.session.state.record).toEqual(renamed);
    expect(l.of('session.changed').at(-1)).toMatchObject({ record: renamed });
  });
});

// P5 O15 M2b (Decision Log 39, the architect's ruling on the re-review's P2s): `remote.session` says the stream's latest
// answer itself, so a page that held a session's transcript through a loss reads its return from what the machine
// answered, never from a published state a link change says again. `n` rises at each `subbed` (whatever sink, a fresh
// one after `behind` included) and at each end that leaves the stream `idle` (`unavailable`) or `ended`.
describe('the stream’s answer', () => {
  const answer = (l: ReturnType<typeof lab>) => l.lastState()?.answer;

  it('is none before the first answer, then each `subbed` with its mode, a fresh sink’s after `behind` included', async () => {
    const l = lab();
    l.session.start();
    expect(answer(l)).toBeNull();
    const sub = await opened(l);
    expect(answer(l)).toEqual({ n: 1, mode: 'snapshot' });
    sub.sink.subbed('replay', { epoch: 'L1', seq: 3 });
    expect(answer(l)).toEqual({ n: 2, mode: 'replay' });
    sub.sink.subbed('missing', { epoch: 'L1', seq: 3 });
    expect(answer(l)).toEqual({ n: 3, mode: 'missing' });
    sub.sink.ended('behind');
    const fresh = l.link.open()[0]!;
    expect(fresh).not.toBe(sub);
    expect(answer(l), 'a reopening is no answer').toEqual({ n: 3, mode: 'missing' });
    fresh.sink.subbed('snapshot', { epoch: 'L2', seq: 0 });
    expect(answer(l), 'the fresh sink’s, though it tells no gap').toEqual({ n: 4, mode: 'snapshot' });
    l.session.stop();
  });

  it('is `unavailable` at an end that leaves the stream idle, `ended` at one that ends it', async () => {
    const idle = lab();
    (await opened(idle)).sink.ended('unavailable');
    expect(idle.lastState()).toMatchObject({ stream: 'idle', answer: { n: 2, mode: 'unavailable' } });
    idle.session.stop();
    const gone = lab();
    (await opened(gone)).sink.ended('gone');
    expect(gone.lastState()).toMatchObject({ stream: 'ended', answer: { n: 2, mode: 'ended' } });
  });

  // the architect's condition (b): nothing main does while the link is down reads as the return's answer
  it('is left as it was by an end the link itself makes (its loss, its refusal, its close), or one heard while it is down', async () => {
    const refused = lab();
    const sub = await opened(refused);
    refused.link.set('down');
    sub.sink.ended('removed'); // the link refused for good: its table ends every subscription
    expect(refused.lastState()).toMatchObject({ stream: 'ended', answer: { n: 1, mode: 'snapshot' } });
    const down = lab();
    const held = await opened(down);
    down.link.set('down');
    held.sink.ended('unavailable'); // a refusal made with no channel current (`busy`), not B's answer
    expect(down.lastState()).toMatchObject({ stream: 'idle', answer: { n: 1, mode: 'snapshot' } });
    down.session.stop();
    const stopped = lab();
    await opened(stopped);
    stopped.session.stop('closed'); // a new link for the machine ends what the old one carried
    expect(stopped.lastState()).toMatchObject({ stream: 'ended', answer: { n: 1, mode: 'snapshot' } });
  });

  // the architect's condition (c): `n` only grows for the session, a record made again (a new link) included
  it('goes on from the session’s count when its record is made again', async () => {
    let count = 7; // the adapter's count for the session, kept across its records (remote.ts)
    const link = new FakeLink();
    link.answers.set('session.get', () => ({ ok: true, output: record(APP) }));
    const said: unknown[] = [];
    const watched = new RemoteSession({ machine: MINI, app: APP, link, emit: (_m, name, payload) => void (name === 'remote.session' && said.push((payload as { answer?: unknown }).answer)), timing: { recordRetryMs: [500], idleRetryMs: [1000, 30_000], idleProbeMaxMs: 60_000, batchMax: 500 }, revision: () => 1, log: () => {}, nextAnswer: () => ++count });
    watched.start();
    await vi.advanceTimersByTimeAsync(0);
    link.open().at(-1)!.sink.subbed('snapshot', { epoch: 'L2', seq: 0 });
    expect(said.at(-1)).toEqual({ n: 8, mode: 'snapshot' });
    watched.stop();
  });

  it('is left as it was by a republish a link change makes, an idle stream’s retry opened while offline included', async () => {
    const l = lab();
    const sub = await opened(l);
    sub.sink.ended('unavailable');
    const said = l.of('remote.session').length;
    l.link.set('down');
    await vi.advanceTimersByTimeAsync(1000); // the idle retry opens a subscription while the link is down
    l.link.set('up');
    const after = l.of('remote.session').slice(said);
    expect(after.length).toBeGreaterThan(0);
    expect(after.map((s) => s.answer)).toEqual(after.map(() => ({ n: 2, mode: 'unavailable' })));
    l.link.open()[0]!.sink.subbed('replay', { epoch: 'L1', seq: 0 });
    expect(answer(l)).toEqual({ n: 3, mode: 'replay' });
    l.session.stop();
  });
});

// The UX wave, U9 (M5, "The settled word"; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md): each lane has
// exactly one standing at any moment, read in one synchronous reading, and tells the adapter each change of it after
// whatever it said for that change (`standingChanged`), so the machine's round is evaluated in main's order of words.
describe('the standing', () => {
  function standingLab(answers: CallResult[]) {
    const l = lab();
    const told: Array<ReturnType<RemoteSession['standing']>> = [];
    l.link.answers.set('session.get', () => answers.shift() ?? { ok: true, output: record(APP) });
    const session = new RemoteSession({
      machine: MINI,
      app: APP,
      link: l.link,
      emit: () => {},
      timing: { recordRetryMs: [500, 1000, 2000, 4000], idleRetryMs: [1000, 30_000], idleProbeMaxMs: 30 * 60_000, batchMax: 500 },
      revision: () => 1,
      standingChanged: () => void told.push(session.standing()),
      log: () => {},
    });
    return { link: l.link, session, told };
  }

  it('is placing through a transient failure’s back-off and a null answer’s retry, and awaiting from the hand-over to its subscription', async () => {
    const s = standingLab([{ ok: false, error: { code: 'offline' } }, { ok: true, output: null }]);
    expect(s.session.standing()).toBeNull(); // not started: nothing to wait for
    s.session.start();
    expect(s.session.standing()).toBe('placing');
    await vi.advanceTimersByTimeAsync(0); // offline: the back-off
    expect(s.session.standing()).toBe('placing');
    await vi.advanceTimersByTimeAsync(1_000); // null: the ladder's retry timer
    expect(s.session.standing()).toBe('placing');
    expect(s.link.open()).toEqual([]);
    await vi.advanceTimersByTimeAsync(500); // the record: subscribed in the same step
    expect(s.link.open()).toHaveLength(1);
    expect(s.session.standing()).toBe('awaiting');
    expect(s.told.includes('quiet'), 'never quiet between the record and its subscription').toBe(false);
    s.link.open()[0].sink.subbed('snapshot', { epoch: 'L1', seq: 0 });
    expect(s.session.standing()).toBe('quiet');
    expect(s.told.at(-1)).toBe('quiet');
  });

  it('is awaiting again from main’s word of a loss for a subscription it keeps, until its next `subbed`', async () => {
    const s = standingLab([]);
    s.session.start();
    await vi.advanceTimersByTimeAsync(0);
    const sub = s.link.open()[0];
    sub.sink.subbed('snapshot', { epoch: 'L1', seq: 0 });
    expect(s.session.standing()).toBe('quiet');
    s.session.lost();
    expect(s.session.standing()).toBe('awaiting');
    sub.sink.subbed('replay', { epoch: 'L1', seq: 0 });
    expect(s.session.standing()).toBe('quiet');
  });

  it('is quiet once idle with no try out, or ended for good; and none once let go', async () => {
    const s = standingLab([]);
    s.session.start();
    await vi.advanceTimersByTimeAsync(0);
    s.link.open()[0].sink.ended('unavailable');
    expect(s.session.standing()).toBe('quiet');
    s.session.lost(); // nothing out: nothing kept across the loss
    expect(s.session.standing()).toBe('quiet');
    s.session.stop();
    expect(s.session.standing()).toBeNull();
    const ladder = standingLab([{ ok: true, output: null }, { ok: true, output: null }, { ok: true, output: null }, { ok: true, output: null }, { ok: true, output: null }]);
    ladder.session.start();
    await vi.advanceTimersByTimeAsync(10_000); // the ladder's end: can't place
    expect(ladder.session.standing()).toBe('quiet');
    expect(ladder.told.at(-1)).toBe('quiet');
  });
});
