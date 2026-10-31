// One remote lane B session's fold (P5 O7 M2, "One subscription per session", "The record", "An idle session's stream",
// "The capability list"): its record read and retried, its `full` subscription's parts and events turned into the events
// the renderer already consumes, its gaps, its idle retries, and its `remote.session` at each change.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { EventName } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import { item, record, status } from '../../../test/support/builders';
import { deliver, FakeLink, MINI } from '../../../test/lane-b/fake-link';
import { RemoteSession } from './remote-session';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const APP = 'app-1';
const notice = (launch: string, seq: number, idx: number): SessionEvent =>
  ({ id: `${APP}:${launch}:${seq}:${idx}`, sessionId: 'eng-1', at: '2026-10-31T00:00:00.000Z', seq, agentId: null, parentToolUseId: null, kind: 'notice.posted', level: 'info', text: `${seq}.${idx}`, key: null }) as unknown as SessionEvent;
const statusOf = (launch: string) => ({ ...status(APP), launchId: launch, engineSessionId: 'eng-1' });
const queue = { entries: [], paused: false, pauseReason: null };
const catalog = { commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 1 };

type Emitted = { machine: MachineRef; name: EventName; payload: Record<string, unknown> };

function lab(options: { record?: () => unknown; followed?: () => boolean } = {}) {
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

  it('passes the link’s and the machine’s pauses on as the stream’s state', async () => {
    const l = lab();
    const sub = await opened(l);
    sub.sink.paused('offline');
    expect(l.lastState()).toMatchObject({ stream: 'paused' });
    sub.sink.resumed();
    expect(l.lastState()).toMatchObject({ stream: 'live' });
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
