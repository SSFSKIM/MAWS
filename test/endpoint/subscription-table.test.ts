// The subscription table's own rules (O10 M8; RL3), on a channel stand-in: a `sub` is registered before it is decided,
// so the device's `credit` can come first; a later `sub` of the same id replaces it, and the replaced one's decision,
// when it comes, answers nothing that would end the newer one; and the stream's credit rule.
import type { EndpointMessage, SubMessage } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import type { RemoteChannel } from '../../src/endpoint/channels';
import { Interest } from '../../src/endpoint/interest';
import { Subscriptions, type Plane, type Subscription } from '../../src/endpoint/subscriptions';
import { NO_RECORDS } from '../../src/endpoint/sources';

function channel(): RemoteChannel & { sent: EndpointMessage[] } {
  const sent: EndpointMessage[] = [];
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
    close: () => {},
    onClose: () => () => {},
  } as RemoteChannel & { sent: EndpointMessage[] };
}

function table(): { subs: Subscriptions; opened: Subscription[] } {
  const opened: Subscription[] = [];
  const plane: Plane = { open: (sub) => void opened.push(sub), close: () => {}, stop: () => {} };
  const subs = new Subscriptions({
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

  it('starts only the sub still registered, with the credit that came before its decision', () => {
    const { subs, opened } = table();
    const ch = channel();
    const first = sub(0);
    subs.receive(ch, first, () => {});
    subs.credit(ch, { t: 'credit', sub: 's1', bytes: 500 });
    subs.start(ch, first, { ok: true } as never);
    expect(opened).toHaveLength(1);
    // The credit counts: an `ev` goes now.
    opened[0].ev({ epoch: 'e', seq: 1 }, { n: 1 });
    expect(ch.sent.map((m) => m.t)).toEqual(['ev']);
    const second = sub();
    subs.receive(ch, second, () => {});
    subs.start(ch, first, { ok: true } as never);
    expect(opened).toHaveLength(1);
  });

  it('sends a stream message while any credit is left, then holds the rest until credit comes', () => {
    const { subs, opened } = table();
    const ch = channel();
    const m = sub(10);
    subs.receive(ch, m, () => {});
    subs.start(ch, m, { ok: true } as never);
    const s = opened[0];
    s.subbed('snapshot', { epoch: 'e', seq: 0 });
    s.ev({ epoch: 'e', seq: 1 }, { text: 'x'.repeat(100) });
    s.ev({ epoch: 'e', seq: 2 }, { text: 'y' });
    // `subbed` costs nothing; the first `ev` overdraws the credit, the second waits.
    expect(ch.sent.map((x) => x.t)).toEqual(['subbed', 'ev']);
    expect(s.backlog).toBeGreaterThan(0);
    s.control({ t: 'paused', sub: 's1', reason: 'no-app' });
    expect(ch.sent.map((x) => x.t)).toEqual(['subbed', 'ev', 'paused']);
    subs.credit(ch, { t: 'credit', sub: 's1', bytes: 10_000 });
    expect(ch.sent.map((x) => x.t)).toEqual(['subbed', 'ev', 'paused', 'ev']);
    expect(s.backlog).toBe(0);
  });
});
