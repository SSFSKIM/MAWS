// The machine's `attention` feed's own transitions (P5 O7 M6, §R), on a channel stand-in with the machine and the
// member's ranks in the suite's hands: what a new head moves (the ranks read again, nothing sent on the old ones
// meanwhile), a placement read overtaken by the session's record, the changes heard while the snapshot's read is out,
// and a machine that can't answer the read. test/endpoint/feeds.test.ts proves the feed end to end over a real channel.
import type { ChannelMessage, EndpointMessage, MachineFeedSubMessage } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { SessionRanks } from '../../src/endpoint/authorize';
import { AttentionFeeds } from '../../src/endpoint/attention-feed';
import type { RemoteChannel } from '../../src/endpoint/channels';
import { Interest } from '../../src/endpoint/interest';
import { NO_RECORDS } from '../../src/endpoint/sources';
import { Subscriptions, type Plane } from '../../src/endpoint/subscriptions';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
type Msg = EndpointMessage & Record<string, unknown>;

function channel(): RemoteChannel & { sent: Msg[] } {
  const sent: Msg[] = [];
  return {
    key: 'direct:1',
    carrier: 'direct',
    id: 'ch-1',
    member: 'm-1',
    device: 'd-1',
    clientClass: 'native-mac',
    client: endableClientRef('d-1/ch-1'),
    closed: false,
    sent,
    send: (message: EndpointMessage) => (sent.push(message as Msg), true),
    transmit: (message: EndpointMessage) => (sent.push(message as Msg), Promise.resolve(true)),
    close: () => {},
    terminate: () => {},
    onClose: () => () => {},
  } as unknown as RemoteChannel & { sent: Msg[] };
}

/** A gate a test opens: what waits on it goes once `open` is called. */
function gate(): { wait: Promise<void>; open(): void } {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

const item = (appSessionId: string, requestId: string) => ({ id: `att-${requestId}`, appSessionId, request: { requestId } });

/**
 * The machine (`attention.list`, `session.get`), the member's ranks (the engine sessions it views, under a head numbered
 * `head`), and one attention feed on a channel stand-in.
 */
function scene(options: { backlogBytes?: number; getFails?: (id: string) => boolean } = {}) {
  const machine = new Map<string, unknown[]>();
  const records = new Map<string, { appId: string; engineSessionId: string | null }>();
  const holds = { list: null as Promise<void> | null, get: new Map<string, Promise<void>>(), ranks: null as Promise<void> | null };
  const state = { head: 1, views: new Set<string>(), listFails: false, ranksRead: 0 };
  const ok = (value: unknown): HostResponse => ({ t: 'res', id: '0', ok: true, value });
  const feeds = new AttentionFeeds({
    dispatch: async (owner, name, input) => {
      if (name === 'attention.list') {
        const answer = [...machine.values()].flat();
        await holds.list;
        return state.listFails ? { t: 'res', id: '0', ok: false, error: { code: 'host_unavailable', message: 'away' } } : ok(answer);
      }
      if (name === 'session.get') {
        const id = (input as { appSessionId: string }).appSessionId;
        const record = records.get(id) ?? null;
        await holds.get.get(id);
        if (options.getFails?.(id) === true) return { t: 'res', id: '0', ok: false, error: { code: 'timeout', message: 'slow' } };
        return ok(record);
      }
      throw new Error(`unexpected ${owner} ${name}`);
    },
    ranks: async (): Promise<SessionRanks> => {
      state.ranksRead += 1;
      const head = state.head;
      await holds.ranks;
      const current = () => state.head === head;
      return { current, holds: (placement) => current() && placement !== null && state.views.has(placement.target.session) };
    },
    log: () => {},
    backlogBytes: options.backlogBytes,
  });
  const plane: Plane = { open: (s) => feeds.open(s), close: (s) => feeds.close(s), stop: () => feeds.stop(), accessChanged: () => feeds.accessChanged() };
  const subs = new Subscriptions({
    authorize: () => Promise.resolve({ ok: true }) as never,
    planes: { A: plane, B: plane, feeds: plane },
    interest: new Interest({ interest: () => null, log: () => {} }),
    records: NO_RECORDS,
    now: () => Date.now(),
    log: () => {},
  });
  const ch = channel();
  return {
    machine,
    records,
    holds,
    state,
    feeds,
    subs,
    ch,
    /** A session in the machine's index under engine session `eng-<id>`. */
    record(id: string, engine: string | null = `eng-${id}`) {
      records.set(id, { appId: id, engineSessionId: engine });
    },
    /** The session's items change on the machine. */
    change(id: string, items: unknown[]) {
      if (items.length === 0) machine.delete(id);
      else machine.set(id, items);
      feeds.event('machine', { name: 'attention.changed', payload: { appSessionId: id, items } });
    },
    open(credit = 1 << 22) {
      const m: MachineFeedSubMessage = { t: 'sub', sub: 'att', feed: 'attention', cursor: null, credit };
      subs.receive(ch, m, (c, message) => subs.start(c, message, {}));
    },
    credit(bytes: number) {
      subs.credit(ch, { t: 'credit', sub: 'att', bytes });
    },
    /** The member stops viewing the engine session `engine`: a record change (the table's re-check). */
    revoke(engine: string) {
      state.views.delete(engine);
      subs.recheck({ lane: 'B', session: engine, appSessionId: '' });
    },
    snaps: () => ch.sent.filter((m) => m.t === 'snap').map((m) => JSON.parse(m.body as string) as unknown[]),
    bodies: () => ch.sent.filter((m) => m.t === 'ev').map((m) => m.body),
    ended: () => ch.sent.filter((m) => m.t === 'ended') as ChannelMessage[],
  };
}

/** The subscription's credit spent before the feed queues anything (a stand-in message on the stream), so what it queues waits. */
function spend(s: ReturnType<typeof scene>): void {
  s.subs.get(s.ch, 'att')!.ev({ epoch: 'spent', seq: 0 }, { spent: true });
}

describe('the attention feed’s transitions', () => {
  it('reads the ranks again at a new head, sends nothing on the old ones meanwhile, and then the difference', async () => {
    const s = scene();
    s.record('app-1');
    s.record('app-2');
    s.machine.set('app-1', [item('app-1', 'r1')]);
    s.machine.set('app-2', [item('app-2', 'r2')]);
    s.state.views.add('eng-app-1');
    s.open();
    await settle();
    expect(s.snaps()).toEqual([[item('app-1', 'r1')]]);

    // A new head: the member owns app-2's machine now and no longer views app-1. Its ranks' read is held.
    const ranks = gate();
    s.holds.ranks = ranks.wait;
    s.state.head = 2;
    s.state.views = new Set(['eng-app-2']);
    s.subs.recheck();
    s.change('app-1', [item('app-1', 'r1'), item('app-1', 'r3')]);
    s.change('app-2', [item('app-2', 'r2'), item('app-2', 'r4')]);
    await settle();
    expect(s.bodies()).toEqual([]);
    ranks.open();
    await settle();
    expect(s.bodies()).toEqual([
      { appSessionId: 'app-1', items: [] },
      { appSessionId: 'app-2', items: [item('app-2', 'r2'), item('app-2', 'r4')] },
    ]);
    expect(s.ended()).toEqual([]);
  });

  it('takes a session’s record heard while its placement is read over the read’s older answer', async () => {
    const s = scene();
    s.record('app-1');
    s.state.views.add('eng-app-1');
    s.open();
    await settle();
    expect(s.snaps()).toEqual([[]]);
    const read = gate();
    s.holds.get.set('app-1', read.wait);
    s.change('app-1', [item('app-1', 'r1')]);
    await settle();
    // The session moves to an engine session the member can't view, before the read (of the viewed one) lands.
    s.feeds.event('machine', { name: 'session.changed', payload: { record: { appId: 'app-1', engineSessionId: 'eng-other' }, cause: 'update', revision: 2 } });
    read.open();
    await settle();
    expect(s.bodies()).toEqual([]);
    s.feeds.event('machine', { name: 'session.changed', payload: { record: { appId: 'app-1', engineSessionId: 'eng-app-1' }, cause: 'update', revision: 3 } });
    expect(s.bodies()).toEqual([{ appSessionId: 'app-1', items: [item('app-1', 'r1')] }]);
  });

  it('lays the changes heard while its snapshot’s read is out over the read’s answer, and places a session that names its engine session late', async () => {
    const s = scene();
    s.record('app-1');
    s.record('app-2', null); // its engine hasn't said its id: nobody's to rank
    s.state.views = new Set(['eng-app-1', 'eng-app-2']);
    s.machine.set('app-1', [item('app-1', 'r1')]);
    s.machine.set('app-2', [item('app-2', 'r2')]);
    const list = gate();
    s.holds.list = list.wait;
    s.open();
    await settle();
    s.change('app-1', [item('app-1', 'r1'), item('app-1', 'r3')]);
    list.open();
    await settle();
    expect(s.snaps()).toEqual([[item('app-1', 'r1'), item('app-1', 'r3')]]);
    // Its next change places it again, its record naming its engine session now.
    s.record('app-2');
    s.change('app-2', [item('app-2', 'r2'), item('app-2', 'r5')]);
    await settle();
    expect(s.bodies()).toEqual([{ appSessionId: 'app-2', items: [item('app-2', 'r2'), item('app-2', 'r5')] }]);
  });

  // Fix wave 1: a decision made when an output was queued is not one about when it leaves.
  it('takes back a snapshot still queued when a share is withdrawn, and queues it again cut to the rights now', async () => {
    const s = scene();
    s.record('app-1');
    s.record('app-2');
    s.machine.set('app-1', [item('app-1', 'r1')]);
    s.machine.set('app-2', [item('app-2', 'r2')]);
    s.state.views = new Set(['eng-app-1', 'eng-app-2']);
    s.open(1);
    spend(s);
    await settle();
    expect(s.snaps()).toEqual([]); // queued, waiting for credit
    s.revoke('eng-app-1');
    s.credit(1 << 20);
    await settle();
    expect(s.snaps()).toEqual([[item('app-2', 'r2')]]);
    expect(JSON.stringify(s.ch.sent)).not.toContain('att-r1');
  });

  it('takes back a change still queued when a share is withdrawn: the device gets the session emptied, never the item', async () => {
    const s = scene();
    s.record('app-1');
    s.machine.set('app-1', [item('app-1', 'r1')]);
    s.state.views.add('eng-app-1');
    s.open(1); // the snapshot spends it
    await settle();
    expect(s.snaps()).toEqual([[item('app-1', 'r1')]]);
    s.change('app-1', [item('app-1', 'r1'), item('app-1', 'private')]);
    await settle();
    expect(s.bodies()).toEqual([]);
    s.revoke('eng-app-1');
    s.credit(1 << 20);
    await settle();
    expect(s.bodies()).toEqual([{ appSessionId: 'app-1', items: [] }]);
    expect(JSON.stringify(s.ch.sent)).not.toContain('att-private');
  });

  it('holds what is queued while the ranks are read again at a new head, and lets it go once they still allow it', async () => {
    const s = scene();
    s.record('app-1');
    s.machine.set('app-1', [item('app-1', 'r1')]);
    s.state.views.add('eng-app-1');
    s.open(1);
    await settle();
    s.change('app-1', [item('app-1', 'r1'), item('app-1', 'r2')]);
    const ranks = gate();
    s.holds.ranks = ranks.wait;
    s.state.head = 2;
    s.subs.recheck();
    s.credit(1 << 20);
    await settle();
    expect(s.bodies()).toEqual([]);
    ranks.open();
    await settle();
    expect(s.bodies()).toEqual([{ appSessionId: 'app-1', items: [item('app-1', 'r1'), item('app-1', 'r2')] }]);
  });

  it('ends `behind` when a part-sent snapshot no longer stands', async () => {
    const s = scene();
    s.record('app-1');
    const big = Array.from({ length: 6 }, (_, i) => ({ ...item('app-1', `r${i}`), pad: 'p'.repeat(100 * 1024) }));
    s.machine.set('app-1', big);
    s.state.views.add('eng-app-1');
    s.open(1); // the first page goes, the rest wait for credit
    await settle();
    expect(s.ch.sent.filter((m) => m.t === 'snap').length).toBe(1);
    s.revoke('eng-app-1');
    await settle();
    expect(s.ended()).toEqual([{ t: 'ended', sub: 'att', reason: 'behind' }]);
  });

  it('ends `behind` when its snapshot alone passes the backlog bound', async () => {
    const s = scene({ backlogBytes: 2048 });
    s.record('app-1');
    s.machine.set('app-1', Array.from({ length: 60 }, (_, i) => item('app-1', `r${i}`)));
    s.state.views.add('eng-app-1');
    s.open(1);
    spend(s);
    await settle();
    expect(s.snaps()).toEqual([]);
    expect(s.ended()).toEqual([{ t: 'ended', sub: 'att', reason: 'behind' }]);
  });

  it('ends `unavailable` when the spine can’t place a session, rather than taking it for one nobody may rank', async () => {
    let failing = true;
    const s = scene({ getFails: () => failing });
    s.record('app-1');
    s.machine.set('app-1', [item('app-1', 'r1')]);
    s.state.views.add('eng-app-1');
    s.open();
    await settle();
    expect(s.snaps()).toEqual([]);
    expect(s.ended()).toEqual([{ t: 'ended', sub: 'att', reason: 'unavailable' }]);
    // The device's reopening, once the spine answers, places it.
    failing = false;
    s.open();
    await settle();
    expect(s.snaps()).toEqual([[item('app-1', 'r1')]]);
  });

  it('ends `unavailable` when the machine can’t answer its snapshot’s read', async () => {
    const s = scene();
    s.state.listFails = true;
    s.open();
    await settle();
    expect(s.ch.sent).toEqual([{ t: 'ended', sub: 'att', reason: 'unavailable' }]);
  });
});
