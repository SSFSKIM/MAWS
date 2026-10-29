// Lane B's pending counts reach `notify` with no device subscribed (O10's follow-up to O13 M5's finding; P5 Surprises):
// the endpoint follows the engine host's `session.brokerItems` for every session, subscribed or not, and reads the whole
// set (`engine.pendingItems`) at each engine-host link it is told of, as sminos restates lane A's after each RL10
// welcome. The counts go through the one Notifier, under its rules: a rise `waiting`, a fall `settled`, each change
// once, and only for a session listed now. Against the fake engine host behind the fake services; the hub's side is the
// frames the Notifier hands the hub link, and which sessions are listed is the suite's.
import type { NotifyFrame } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Notifier, type NotifyContext } from '../../src/endpoint/notify';
import type { NotifiedFile } from '../../src/endpoint/state/store';
import { item, makeOrg, PROJECT, startEndpoint, stopAll, type Fixture, type Org } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

/** The notify frames the endpoint hands its hub link, each awaited as it is sent. */
class Sent {
  readonly frames: NotifyFrame[] = [];
  #waiters: Array<{ n: number; resolve: () => void }> = [];

  push(frame: NotifyFrame): void {
    this.frames.push({ ...frame });
    this.#waiters = this.#waiters.filter((w) => (this.frames.length >= w.n ? (w.resolve(), false) : true));
  }

  /** Resolves once `n` frames in all have been sent. */
  count(n: number): Promise<void> {
    if (this.frames.length >= n) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.push({ n, resolve }));
  }
}

const notify = (session: string, kind: string, pending: number): NotifyFrame => ({ t: 'notify', session, project: PROJECT, kind, pending }) as NotifyFrame;

/**
 * An endpoint whose engine host holds `ids`, an app attached, no device subscribed; `listed` names the sessions listed at
 * the hub now (the suite's, in place of the listings' judgment).
 */
async function lab(ids: string[], listed: string[]): Promise<{ f: Fixture; sent: Sent; listed: Set<string> }> {
  const f = await startEndpoint(org, started);
  for (const id of ids) f.host.add(id);
  f.host.attach(true);
  const sent = new Sent();
  const names = new Set(listed);
  vi.spyOn(f.endpoint.hub, 'send').mockImplementation((frame) => {
    if (frame.t === 'notify') sent.push(frame);
    return true;
  });
  vi.spyOn(f.endpoint.listings, 'listed').mockImplementation((session) => (names.has(session) ? { project: PROJECT } : null));
  return { f, sent, listed: names };
}

describe('lane B’s pending counts with no device subscribed', () => {
  it('tells a request raised on a listed lane B session as `waiting` with the count, a second as a rise', async () => {
    const { f, sent } = await lab(['app-1'], ['app-1']);
    f.host.request('app-1', 'permission', 'rq-1');
    await sent.count(1);
    f.host.request('app-1', 'question', 'rq-2');
    await sent.count(2);
    expect(sent.frames).toEqual([notify('app-1', 'waiting', 1), notify('app-1', 'waiting', 2)]);
  });

  it('tells a settle as `settled` with what remains, then `settled 0`', async () => {
    const { f, sent } = await lab(['app-1'], ['app-1']);
    f.host.request('app-1', 'permission', 'rq-1');
    f.host.request('app-1', 'question', 'rq-2');
    await sent.count(2);
    const s = f.host.session('app-1');
    f.host.setItems('app-1', s.items.filter((i) => (i.request as { requestId: string }).requestId !== 'rq-1'));
    await sent.count(3);
    f.host.setItems('app-1', []);
    await sent.count(4);
    expect(sent.frames.slice(2)).toEqual([notify('app-1', 'settled', 1), notify('app-1', 'settled', 0)]);
  });

  it('counts only the items that wait on an answer: an answered (confirmed or retired) item is not pending', async () => {
    const { f, sent } = await lab(['app-1'], ['app-1']);
    const s = f.host.session('app-1');
    f.host.setItems('app-1', [
      { ...item(s, 'rq-1', 'permission'), state: 'delivered' },
      { ...item(s, 'rq-2', 'question'), state: 'confirmed' },
      { ...item(s, 'rq-3', 'question'), state: 'retired' },
      item(s, 'rq-4', 'question'),
    ]);
    await sent.count(1);
    expect(sent.frames).toEqual([notify('app-1', 'waiting', 2)]);
  });

  it('restates the whole set at an engine-host reconnect: a count that changed while the host was away is told, and none stays stale', async () => {
    const { f, sent } = await lab(['app-1', 'app-2', 'app-3'], ['app-1', 'app-2', 'app-3', 'app-4']);
    f.host.request('app-1', 'permission', 'rq-1');
    f.host.request('app-2', 'permission', 'rq-2');
    f.host.request('app-3', 'question', 'rq-3');
    await sent.count(3);
    // The link ends (the host restarts): what changes meanwhile reaches the endpoint as no event.
    f.host.upstream(false);
    const one = f.host.session('app-1');
    f.host.setItems('app-1', [...one.items, item(one, 'rq-1b', 'question')]);
    f.host.setItems('app-2', []);
    f.host.sessions.delete('app-3');
    f.host.add('app-4');
    f.host.request('app-4', 'question', 'rq-4');
    expect(sent.frames).toHaveLength(3);
    f.host.upstream(true);
    // One restatement, told at once: each session's change once.
    await sent.count(7);
    const bySession = (frames: NotifyFrame[]) => [...frames].sort((a, b) => a.session.localeCompare(b.session));
    expect(bySession(sent.frames.slice(3))).toEqual([notify('app-1', 'waiting', 2), notify('app-2', 'settled', 0), notify('app-3', 'settled', 0), notify('app-4', 'waiting', 1)]);
    // Live events go on from the restated set: a settle is one change.
    f.host.setItems('app-4', []);
    await sent.count(8);
    expect(sent.frames.slice(7)).toEqual([notify('app-4', 'settled', 0)]);
  });

  it('keeps a live change that came while the restatement was being read over the read’s older answer', async () => {
    const { f, sent } = await lab(['app-1'], ['app-1']);
    f.host.request('app-1', 'permission', 'rq-1');
    await sent.count(1);
    f.host.hold('engine.pendingItems');
    const restating = f.endpoint.laneB.restate();
    // The read was answered as it arrived (one item); the settle after it reaches the endpoint first.
    f.host.setItems('app-1', []);
    await sent.count(2);
    f.host.release('engine.pendingItems');
    await restating;
    expect(sent.frames).toEqual([notify('app-1', 'waiting', 1), notify('app-1', 'settled', 0)]);
  });

  it('tells nothing of an unlisted session, nor of a withdrawn one after its `settled 0`', async () => {
    const { f, sent, listed } = await lab(['app-1', 'app-2'], ['app-1']);
    f.host.request('app-2', 'permission', 'rq-0');
    f.host.request('app-1', 'permission', 'rq-1');
    await sent.count(1);
    expect(sent.frames).toEqual([notify('app-1', 'waiting', 1)]);
    // app-1 is withdrawn (made private): its count is settled at the hub, and nothing more is told of it.
    listed.delete('app-1');
    f.endpoint.notifier.withdrawn('app-1', PROJECT);
    await sent.count(2);
    f.host.request('app-1', 'question', 'rq-2');
    // A listed session's request while the link is down, as the anchor: the restatement tells it in the same breath as
    // anything it would tell of app-1 or app-2.
    f.host.upstream(false);
    listed.add('app-3');
    f.host.add('app-3');
    f.host.request('app-3', 'question', 'rq-3');
    f.host.upstream(true);
    await sent.count(3);
    expect(sent.frames).toEqual([notify('app-1', 'waiting', 1), notify('app-1', 'settled', 0), notify('app-3', 'waiting', 1)]);
  });
});

describe('the Notifier’s lane B counts', () => {
  const setup = () => {
    const sent: unknown[] = [];
    let file: NotifiedFile = {};
    const ctx: NotifyContext = {
      send: (frame) => (sent.push({ ...frame }), true),
      listed: (session) => (['a1', 'b1'].includes(session) ? { project: 'p1' } : null),
      store: { read: () => file, write: (next) => void (file = next) },
      log: () => {},
    };
    return { notifier: new Notifier(ctx), sent, ctx, file: () => file };
  };
  const told = (session: string, kind: string, pending: number) => ({ t: 'notify', session, project: 'p1', kind, pending });

  it('keeps lane B’s counts apart from lane A’s across a restart: a lane A set leaves a lane B count alone, and the engine host’s set settles it', () => {
    const { notifier, sent, ctx, file } = setup();
    notifier.pendingSet('p1', [{ session: 'a1', request: 'r1' }]);
    notifier.laneBSet(new Map([['b1', 1]]));
    expect(file()).toEqual({ a1: { project: 'p1', pending: 1 }, b1: { project: 'p1', pending: 1, lane: 'B' } });
    const restarted = new Notifier(ctx);
    restarted.pendingSet('p1', []);
    expect(sent.slice(2)).toEqual([told('a1', 'settled', 0)]);
    restarted.laneBSet(new Map());
    expect(sent.slice(3)).toEqual([told('b1', 'settled', 0)]);
    expect(file()).toEqual({});
  });
});
