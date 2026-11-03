// Browser work in `mawsd`: the fence's daemon side (P5 O17 M3; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
// Interfaces §E). The holds per engine connection and session, the engine host's snapshot first on each fresh link and
// at each change, one in flight, and an acquire answered only once a snapshot naming its session is acknowledged on the
// current link. Plain Node, over a stand-in engine host whose acknowledgements the test releases.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { createBrowserWork, oldHostReason, reconnectingReason, type EngineConnection } from './browser-work';

const S = 'app-s' as AppSessionId;
const T = 'app-t' as AppSessionId;

// A stand-in engine host: each snapshot it is sent, acknowledged (or failed) when the test says
function engineHost() {
  const sent: { held: AppSessionId[]; ack(): void; fail(message: string): void }[] = [];
  const send = (held: AppSessionId[]) =>
    new Promise<void>((resolve, reject) => void sent.push({ held: [...held], ack: resolve, fail: (message) => reject(new Error(message)) }));
  return { sent, send, snapshots: () => sent.map((s) => s.held) };
}

// An acquire's outcome as the test reads it without awaiting: pending, done or the reason it failed
function watched(promise: Promise<void>) {
  const state = { settled: 'pending' as 'pending' | 'done' | 'failed', reason: '' };
  promise.then(
    () => void (state.settled = 'done'),
    (error: unknown) => void ((state.settled = 'failed'), (state.reason = (error as Error).message)),
  );
  return state;
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function setUp() {
  const work = createBrowserWork({ machine: 'mini', log: () => {} });
  const host = engineHost();
  const engine: EngineConnection = { name: 'render host' };
  return { work, host, engine };
}

describe('browser work in mawsd', () => {
  it('sends the snapshot first on a fresh link, before anything else, the holds it kept across the loss among it', async () => {
    const { work, host, engine } = setUp();
    void work.linkUp(host.send, true);
    expect(host.snapshots()).toEqual([[]]); // a fresh mawsd's own truth: ordinarily empty, which clears `unknown`
    host.sent[0]!.ack();
    await tick();
    const acquired = watched(work.acquire(engine, S));
    await tick();
    host.sent[1]!.ack();
    await tick();
    expect(acquired.settled).toBe('done');

    work.linkDown(); // an engine-host restart: the render host's tab and its hold survive
    const successor = engineHost();
    void work.linkUp(successor.send, true);
    expect(successor.snapshots()).toEqual([[S]]); // sent at once, synchronously: first on the successor's link
    expect(work.held()).toEqual([S]);
  });

  it('answers an acquire only once the engine host acknowledged a snapshot naming its session', async () => {
    const { work, host, engine } = setUp();
    void work.linkUp(host.send, true);
    host.sent[0]!.ack();
    await tick();
    const acquired = watched(work.acquire(engine, S));
    await tick();
    expect(host.snapshots()).toEqual([[], [S]]);
    expect(acquired.settled).toBe('pending');
    host.sent[1]!.ack();
    await tick();
    expect(acquired.settled).toBe('done');
    // a second engine's acquire for a session the acknowledged, latest snapshot names resolves at once, sending nothing
    const second = watched(work.acquire({ name: 'another' }, S));
    await tick();
    expect(second.settled).toBe('done');
    expect(host.sent).toHaveLength(2);
  });

  it('the reacquire race: a new acquire waits for the following {S}’s acknowledgement, never the earlier one', async () => {
    const { work, host, engine } = setUp();
    void work.linkUp(host.send, true);
    host.sent[0]!.ack();
    await tick();
    const first = watched(work.acquire(engine, S));
    await tick();
    host.sent[1]!.ack(); // {S} acknowledged
    await tick();
    expect(first.settled).toBe('done');

    work.release(engine, S); // the last release sends {}, its acknowledgement held back
    expect(host.snapshots().at(-1)).toEqual([]);
    const again = watched(work.acquire(engine, S));
    await tick();
    expect(again.settled).toBe('pending'); // the acknowledged {S} no longer counts: {} was sent after it
    expect(host.sent).toHaveLength(3); // one in flight: the {S} that follows waits for {}'s answer
    host.sent[2]!.ack(); // {}'s acknowledgement names no S
    await tick();
    expect(again.settled).toBe('pending');
    expect(host.snapshots().at(-1)).toEqual([S]);
    host.sent[3]!.ack();
    await tick();
    expect(again.settled).toBe('done');
  });

  it('coalesces changes behind the one snapshot in flight, and a release never waits', async () => {
    const { work, host, engine } = setUp();
    void work.linkUp(host.send, true);
    const other: EngineConnection = { name: 'another' };
    const a = watched(work.acquire(engine, S)); // behind the link's first snapshot, still unanswered
    const b = watched(work.acquire(other, T));
    work.release(other, T); // returns at once, while a snapshot is in flight
    const c = watched(work.acquire(other, T));
    await tick();
    expect(host.snapshots()).toEqual([[]]);
    host.sent[0]!.ack();
    await tick();
    expect(host.snapshots()).toEqual([[], [S, T]]); // three changes, one snapshot
    expect([a.settled, c.settled]).toEqual(['pending', 'pending']);
    expect(b.settled).toBe('failed'); // released before its fence: no tab
    host.sent[1]!.ack();
    await tick();
    expect([a.settled, c.settled]).toEqual(['done', 'done']);
    expect(host.sent).toHaveLength(2);
  });

  it('an engine connection’s end removes all its holds, and fails its acquires in flight', async () => {
    const { work, host, engine } = setUp();
    void work.linkUp(host.send, true);
    host.sent[0]!.ack();
    await tick();
    void work.acquire(engine, S);
    await tick();
    host.sent[1]!.ack();
    await tick();
    const pending = watched(work.acquire(engine, T));
    const other: EngineConnection = { name: 'another' };
    void work.acquire(other, T);
    await tick();
    work.engineGone(engine);
    await tick();
    expect(pending.settled).toBe('failed');
    expect(work.held()).toEqual([T]); // the other connection's hold stays
    host.sent[2]!.ack();
    await tick();
    expect(host.snapshots().at(-1)).toEqual([T]);
  });

  it('with no engine-host link, rejects with the reconnecting reason, distinct from the old host’s', async () => {
    const { work, engine } = setUp();
    await expect(work.acquire(engine, S)).rejects.toThrow('the engine host on mini is reconnecting');
    expect(reconnectingReason('mini')).not.toBe(oldHostReason('mini'));
    expect(work.held()).toEqual([]); // a failed acquire holds nothing
  });

  it('the old-host cell: an engine host without host.browserWork is sent nothing, and an acquire rejects with its reason', async () => {
    const { work, host, engine } = setUp();
    await work.linkUp(host.send, false);
    await expect(work.acquire(engine, S)).rejects.toThrow('the engine host on mini predates browser work holds; it is replaced when idle');
    expect(host.sent).toEqual([]);
    expect(work.held()).toEqual([]);
  });

  it('a link lost before the acknowledgement fails the acquire; an acknowledgement from an earlier link never counts', async () => {
    const { work, host, engine } = setUp();
    void work.linkUp(host.send, true);
    host.sent[0]!.ack();
    await tick();
    const lost = watched(work.acquire(engine, S));
    await tick();
    work.linkDown();
    await tick();
    expect(lost).toEqual({ settled: 'failed', reason: 'the engine host on mini is reconnecting' });
    expect(work.held()).toEqual([]); // no tab: the hold went with the acquire

    const successor = engineHost();
    void work.linkUp(successor.send, true);
    const next = watched(work.acquire(engine, S));
    await tick();
    host.sent[1]!.ack(); // the earlier link's late answer for {S}
    await tick();
    expect(next.settled).toBe('pending');
    successor.sent[0]!.ack(); // the fresh link's first snapshot, sent before the acquire: it names no S
    await tick();
    expect(next.settled).toBe('pending');
    expect(successor.snapshots()).toEqual([[], [S]]);
    successor.sent[1]!.ack();
    await tick();
    expect(next.settled).toBe('done');
  });

  it('a refused snapshot fails the acquires waiting on it, sends nothing more on its own, and the next acquire sends again', async () => {
    const logs: string[] = [];
    const work = createBrowserWork({ machine: 'mini', log: (line) => void logs.push(line) });
    const host = engineHost();
    const [engine, other] = [{ name: 'render host' }, { name: 'another' }];
    void work.linkUp(host.send, true);
    host.sent[0]!.ack();
    await tick();
    void work.acquire(other, T);
    await tick();
    host.sent[1]!.ack();
    await tick();
    const refused = watched(work.acquire(engine, S));
    await tick();
    host.sent[2]!.fail('host.browserWork from a client that did not declare host.attachment');
    await tick();
    expect(refused).toEqual({ settled: 'failed', reason: 'the engine host on mini did not take the browser work hold: host.browserWork from a client that did not declare host.attachment' });
    await tick();
    expect(host.snapshots()).toEqual([[], [T], [S, T], [T]]); // S's hold went with its acquire: one snapshot says so
    host.sent[3]!.fail('still refused');
    await tick();
    expect(host.sent).toHaveLength(4); // nothing changed and nothing waits: no loop
    const later = watched(work.acquire(other, T)); // T already held, but the last snapshot was never acknowledged
    await tick();
    expect(host.snapshots().at(-1)).toEqual([T]);
    host.sent[4]!.ack();
    await tick();
    expect(later.settled).toBe('done');
    expect(logs.some((line) => line.includes('still refused'))).toBe(true);
  });

  // §E: a popup adopted from a session tab needs no acquire, and a parent's close never clears the hold before its
  // adopted child is counted. A stand-in engine counts the session's tabs as the render host does (M4).
  it('a popup adopted from a session tab acquires nothing again; the hold is released at zero tabs, once', async () => {
    const { work, host, engine } = setUp();
    void work.linkUp(host.send, true);
    host.sent[0]!.ack();
    await tick();
    let tabs = 0;
    const create = async () => {
      if (tabs === 0) await work.acquire(engine, S);
      tabs += 1;
    };
    const adoptPopup = () => void (tabs += 1); // counted synchronously with its opener's tab alive
    const close = () => {
      tabs -= 1;
      if (tabs === 0) work.release(engine, S);
    };
    const created = create();
    await tick();
    host.sent[1]!.ack();
    await created;
    adoptPopup();
    close(); // the parent
    expect(work.held()).toEqual([S]);
    close(); // the popup: the last
    expect(work.held()).toEqual([]);
    expect(host.snapshots()).toEqual([[], [S], []]);
  });
});
