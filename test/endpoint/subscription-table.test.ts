// The subscription table's own rules (O10 M8; RL3), on a channel stand-in: a `sub` is registered before it is decided,
// so the device's `credit` can come first; a later `sub` of the same id replaces it, and the replaced one's decision,
// when it comes, answers nothing that would end the newer one; and the stream's credit rule.
import type { EndpointMessage, SubMessage } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import type { RemoteChannel } from '../../src/endpoint/channels';
import { Interest } from '../../src/endpoint/interest';
import { STREAM_WINDOW_BYTES, Subscriptions, type Plane, type Subscription } from '../../src/endpoint/subscriptions';
import { PlaneA } from '../../src/endpoint/plane-a';
import { NO_RECORDS } from '../../src/endpoint/sources';

/**
 * A channel stand-in: `sent` is its queue in order. A stream message handed over by `transmit` is done (sealed and on
 * the carrier) at once, or, with `hold`, only at `flush`.
 */
function channel(options: { hold?: boolean } = {}): RemoteChannel & { sent: EndpointMessage[]; flush(): void; terminated: string[] } {
  const sent: EndpointMessage[] = [];
  const waiting: Array<() => void> = [];
  const terminated: string[] = [];
  return {
    key: 'direct:1',
    carrier: 'direct',
    id: 'ch-1',
    member: 'm-1',
    device: 'd-1',
    clientClass: 'native-mac',
    closed: false,
    sent,
    send: (message) => (sent.push(message), true),
    transmit: (message) => {
      sent.push(message);
      return options.hold ? new Promise<boolean>((resolve) => waiting.push(() => resolve(true))) : Promise.resolve(true);
    },
    flush: () => {
      for (const done of waiting.splice(0)) done();
    },
    close: () => {},
    terminate: (reason: string) => void terminated.push(reason),
    terminated,
    onClose: () => () => {},
  } as RemoteChannel & { sent: EndpointMessage[]; flush(): void; terminated: string[] };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function table(seams: { transmitDeadlineMs?: number } = {}): { subs: Subscriptions; opened: Subscription[] } {
  const opened: Subscription[] = [];
  const plane: Plane = { open: (sub) => void opened.push(sub), close: () => {}, stop: () => {} };
  const subs = new Subscriptions({
    ...seams,
    authorize: () => Promise.resolve({ ok: true }) as never,
    planes: { A: plane, B: plane },
    interest: new Interest({ interest: () => null, log: () => {} }),
    records: NO_RECORDS,
    now: () => Date.now(),
    log: () => {},
  });
  return { subs, opened };
}

const sub = (credit = 1000): SubMessage => ({ t: 'sub', sub: 's1', session: { lane: 'B', id: 'app-1' }, cursor: null, credit });

describe('the subscription table', () => {
  it('answers a replaced sub’s refusal with nothing, and the newer one’s with its reason', () => {
    const { subs } = table();
    const ch = channel();
    const first = sub();
    const second = sub();
    subs.receive(ch, first, () => {});
    subs.receive(ch, second, () => {});
    subs.refused(ch, first, 'grade');
    expect(ch.sent).toEqual([]);
    expect(subs.get(ch, 's1')?.message).toBe(second);
    subs.refused(ch, second, 'grade');
    expect(ch.sent).toEqual([{ t: 'ended', sub: 's1', reason: 'grade' }]);
    expect(subs.get(ch, 's1')).toBeNull();
  });

  it('starts only the sub still registered, with the credit that came before its decision', async () => {
    const { subs, opened } = table();
    const ch = channel();
    const first = sub(0);
    subs.receive(ch, first, () => {});
    subs.credit(ch, { t: 'credit', sub: 's1', bytes: 500 });
    subs.start(ch, first, { ok: true } as never);
    expect(opened).toHaveLength(1);
    // The credit counts: an `ev` goes now.
    opened[0].ev({ epoch: 'e', seq: 1 }, { n: 1 });
    await settle();
    expect(ch.sent.map((m) => m.t)).toEqual(['ev']);
    const second = sub();
    subs.receive(ch, second, () => {});
    subs.start(ch, first, { ok: true } as never);
    expect(opened).toHaveLength(1);
  });

  it('sends a stream message while any credit is left, then holds the rest until credit comes', async () => {
    const { subs, opened } = table();
    const ch = channel();
    const m = sub(10);
    subs.receive(ch, m, () => {});
    subs.start(ch, m, { ok: true } as never);
    const s = opened[0];
    s.subbed('snapshot', { epoch: 'e', seq: 0 });
    s.ev({ epoch: 'e', seq: 1 }, { text: 'x'.repeat(100) });
    s.ev({ epoch: 'e', seq: 2 }, { text: 'y' });
    await settle();
    // `subbed` costs nothing; the first `ev` overdraws the credit, the second waits.
    expect(ch.sent.map((x) => x.t)).toEqual(['subbed', 'ev']);
    expect(s.backlog).toBeGreaterThan(0);
    s.control({ t: 'paused', sub: 's1', reason: 'no-app' });
    expect(ch.sent.map((x) => x.t)).toEqual(['subbed', 'ev', 'paused']);
    subs.credit(ch, { t: 'credit', sub: 's1', bytes: 10_000 });
    await settle();
    expect(ch.sent.map((x) => x.t)).toEqual(['subbed', 'ev', 'paused', 'ev']);
    expect(s.backlog).toBe(0);
  });

  it('keeps no more than a small window of stream messages in the channel’s queue, so a control message never waits behind a credited flood', async () => {
    const { subs, opened } = table();
    const ch = channel({ hold: true });
    const m = sub(4 * 1024 * 1024);
    subs.receive(ch, m, () => {});
    subs.start(ch, m, { ok: true } as never);
    const s = opened[0];
    // 64 events of 64 KiB, all paid for by the credit: 4 MiB the channel would otherwise queue before anything else.
    for (let i = 1; i <= 64; i++) s.ev({ epoch: 'e', seq: i }, { text: 'z'.repeat(64 * 1024) });
    await settle();
    s.control({ t: 'paused', sub: 's1', reason: 'no-app' });
    const before = ch.sent.findIndex((x) => x.t === 'paused');
    expect(before).toBeLessThanOrEqual(STREAM_WINDOW_BYTES / (64 * 1024) + 1);
    // The flood goes on as the channel takes it, every event once, in order.
    for (let i = 0; i < 200 && ch.sent.filter((x) => x.t === 'ev').length < 64; i++) {
      ch.flush();
      await settle();
    }
    expect(ch.sent.filter((x) => x.t === 'ev').map((x) => (x as { seq: number }).seq)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
  });

  it('shares the window between a channel’s subscriptions in turn', async () => {
    const { subs, opened } = table();
    const ch = channel({ hold: true });
    for (const id of ['s1', 's2']) {
      const m = { ...sub(4 * 1024 * 1024), sub: id };
      subs.receive(ch, m, () => {});
      subs.start(ch, m, { ok: true } as never);
    }
    // s1's flood fills the window before s2 has anything; once the channel takes it, they go in turn.
    for (const s of opened) for (let i = 1; i <= 16; i++) s.ev({ epoch: 'e', seq: i }, { text: 'z'.repeat(64 * 1024) });
    await settle();
    const before = ch.sent.length;
    ch.flush();
    await settle();
    const next = ch.sent.slice(before).map((x) => (x as { sub: string }).sub);
    expect(next.slice(0, 4)).toEqual(['s1', 's2', 's1', 's2']);
  });

  it('holds a subscription’s stream while its access is checked again, and lets it go on when the check grants it', async () => {
    let decide: (ok: boolean) => void = () => {};
    const opened: Subscription[] = [];
    const plane: Plane = { open: (s) => void opened.push(s), close: () => {}, stop: () => {} };
    let authorizing = false;
    const subs = new Subscriptions({
      authorize: () => (authorizing ? new Promise((resolve) => (decide = (ok) => resolve((ok ? { ok: true } : { ok: false, reason: 'grade' }) as never))) : Promise.resolve({ ok: true } as never)),
      planes: { A: plane, B: plane },
      interest: new Interest({ interest: () => null, log: () => {} }),
      records: NO_RECORDS,
      now: () => Date.now(),
      log: () => {},
    });
    const ch = channel();
    const m = sub();
    subs.receive(ch, m, () => {});
    subs.start(ch, m, { ok: true, target: { lane: 'B', session: 'eng-1', appSessionId: 'app-1' } } as never);
    authorizing = true;
    subs.recheck();
    opened[0].ev({ epoch: 'e', seq: 1 }, { n: 1 });
    await settle();
    expect(ch.sent).toEqual([]);
    decide(true);
    await settle();
    await settle();
    expect(ch.sent.map((x) => x.t)).toEqual(['ev']);
  });

  it('wakes its producer when the device takes its stream, when credit comes, and when a hold ends', async () => {
    const { subs, opened } = table();
    const ch = channel({ hold: true });
    const m = sub(4 * 1024 * 1024);
    subs.receive(ch, m, () => {});
    subs.start(ch, m, { ok: true } as never);
    const s = opened[0];
    let woken = 0;
    s.onRoom = () => void woken++;
    for (let i = 1; i <= 8; i++) s.ev({ epoch: 'e', seq: i }, { text: 'z'.repeat(64 * 1024) });
    await settle();
    const before = woken;
    ch.flush();
    await settle();
    expect(woken).toBeGreaterThan(before);
    const held = woken;
    s.hold();
    s.unhold();
    await settle();
    expect(woken).toBeGreaterThan(held);
    const credited = woken;
    subs.credit(ch, { t: 'credit', sub: 's1', bytes: 1 });
    await settle();
    expect(woken).toBeGreaterThan(credited);
  });

  it('ends the carrier under a channel whose send never completes, so its cursors resume elsewhere', async () => {
    const { subs, opened } = table({ transmitDeadlineMs: 30 });
    const ch = channel({ hold: true });
    const m = sub(4 * 1024 * 1024);
    subs.receive(ch, m, () => {});
    subs.start(ch, m, { ok: true } as never);
    opened[0].ev({ epoch: 'e', seq: 1 }, { n: 1 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(ch.terminated).toEqual(['timeout']);
  });

  it('sends a lane A cards view stale from a hold its whole pending set when the hold ends with credit left', async () => {
    let decide: (ok: boolean) => void = () => {};
    let authorizing = false;
    const planeA = new PlaneA({ send: () => {}, connected: () => true, member: () => ({ project: 'p', lane: 'A', launch: 'L1' }), log: () => {}, backlogBytes: 4096 });
    const other: Plane = { open: () => {}, close: () => {}, stop: () => {} };
    const subs = new Subscriptions({
      authorize: () => (authorizing ? new Promise((resolve) => (decide = (ok) => resolve((ok ? { ok: true } : { ok: false, reason: 'grade' }) as never))) : Promise.resolve({ ok: true } as never)),
      planes: { A: planeA, B: other },
      interest: new Interest({ interest: () => null, log: () => {} }),
      records: NO_RECORDS,
      now: () => Date.now(),
      log: () => {},
    });
    const ch = channel();
    const m: SubMessage = { t: 'sub', sub: 'c1', session: { lane: 'A', id: 'la-1' }, view: 'cards', cursor: null, credit: 4 * 1024 * 1024 };
    subs.receive(ch, m, () => {});
    subs.start(ch, m, { ok: true, target: { lane: 'A', session: 'la-1' } } as never);
    await settle();
    authorizing = true;
    subs.recheck();
    // While held, raises pile up past the backlog: the view goes stale, owing its whole set.
    for (let i = 0; i < 20; i++) planeA.message({ project: 'p', session: 'la-1', kind: 'raised', sub: null, n: null, body: { request: `r${i}`, session: 'la-1', input: 'x'.repeat(512) } } as never);
    decide(true);
    for (let i = 0; i < 5; i++) await settle();
    const snaps = ch.sent.filter((x) => x.t === 'snap');
    const last = JSON.parse((snaps.at(-1) as { body: string }).body) as { raised: unknown[] };
    expect(last.raised).toHaveLength(20);
  });
});
