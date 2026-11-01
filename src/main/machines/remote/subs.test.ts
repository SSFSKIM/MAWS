// The link's subscriptions (P5 O7 M1, "Subscriptions"): the cursor's rules, paging, repeats, credit and endings, against
// a channel the test plays.
import { SUB_CREDIT_MAX, type Cursor, type DeviceMessage, type EndpointMessage } from 'org-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubTable, type SubscriptionSink } from './subs';
import { MAX_SUBS, timingOf } from './timing';

function harness() {
  const sent: DeviceMessage[] = [];
  const channel = { current: true, peer: [] as string[] };
  const logs: string[] = [];
  const table = new SubTable({ send: (m) => (channel.current ? (sent.push(m), true) : false), current: () => channel.current, peerCapabilities: () => (channel.current ? channel.peer : null), timing: timingOf(), log: (l) => void logs.push(l) });
  const heard: Array<[string, ...unknown[]]> = [];
  const sink: SubscriptionSink = {
    subbed: (mode, at) => void heard.push(['subbed', mode, at]),
    snapshot: (at, value) => void heard.push(['snapshot', at, value]),
    event: (at, body) => void heard.push(['event', at, body]),
    paused: (reason) => void heard.push(['paused', reason]),
    resumed: () => void heard.push(['resumed']),
    ended: (reason) => void heard.push(['ended', reason]),
  };
  return { table, sent, channel, heard, sink, logs, subs: () => sent.filter((m) => m.t === 'sub') as Array<Extract<DeviceMessage, { t: 'sub' }>> };
}

const ev = (sub: string, seq: number, idx: number, epoch = 'L1'): EndpointMessage => ({ t: 'ev', sub, epoch, seq, idx, body: { seq, idx } });
const pages = (sub: string, at: Cursor, value: unknown, size: number): EndpointMessage[] => {
  const text = JSON.stringify(value);
  const out: EndpointMessage[] = [];
  for (let i = 0; i * size < text.length; i++) out.push({ t: 'snap', sub, ...at, page: i, last: (i + 1) * size >= text.length, body: text.slice(i * size, (i + 1) * size) });
  return out;
};

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('the cursor', () => {
  it('stays on a replay and moves with each delivered event', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'B', id: 'app-1' }, cursor: { epoch: 'L1', seq: 3, idx: 1 } }, h.sink, null);
    expect(h.subs()[0]).toEqual({ t: 'sub', sub: s.id, session: { lane: 'B', id: 'app-1' }, cursor: { epoch: 'L1', seq: 3, idx: 1 }, credit: 1024 * 1024 });
    h.table.receive({ t: 'subbed', sub: s.id, mode: 'replay', epoch: 'L1', seq: 3, idx: 1 });
    expect(s.cursor()).toEqual({ epoch: 'L1', seq: 3, idx: 1 });
    h.table.receive(ev(s.id, 3, 2));
    h.table.receive(ev(s.id, 4, 0));
    expect(s.cursor()).toEqual({ epoch: 'L1', seq: 4, idx: 0 });
  });

  it('moves to a snapshot’s position only once its last page arrives', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'B', id: 'app-1' }, cursor: { epoch: 'L1', seq: 9, idx: 0 } }, h.sink, null);
    h.table.receive({ t: 'subbed', sub: s.id, mode: 'snapshot', epoch: 'L2', seq: 0 });
    const [first, ...rest] = pages(s.id, { epoch: 'L2', seq: 0 }, { status: { process: 'ready' }, queue: [] }, 10);
    h.table.receive(first);
    expect(s.cursor()).toEqual({ epoch: 'L1', seq: 9, idx: 0 });
    // a drop now resubscribes from where the sink stood
    h.channel.current = false;
    h.channel.current = true;
    h.table.onCurrent();
    expect(h.subs().at(-1)?.cursor).toEqual({ epoch: 'L1', seq: 9, idx: 0 });
    h.table.receive({ t: 'subbed', sub: s.id, mode: 'snapshot', epoch: 'L2', seq: 0 });
    for (const page of [first, ...rest]) h.table.receive(page);
    expect(s.cursor()).toEqual({ epoch: 'L2', seq: 0 });
    expect(h.heard.filter((x) => x[0] === 'snapshot')).toEqual([['snapshot', { epoch: 'L2', seq: 0 }, { status: { process: 'ready' }, queue: [] }]]);
    // a later replace-whole part doesn't move it
    h.table.receive(ev(s.id, 1, 0, 'L2'));
    for (const page of pages(s.id, { epoch: 'L2', seq: 1, idx: 0 }, { queue: [1] }, 100)) h.table.receive(page);
    expect(s.cursor()).toEqual({ epoch: 'L2', seq: 1, idx: 0 });
  });

  it('delivers events after a snapshot in the cursor’s own epoch (lane A’s snapshot at n 0)', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'A', id: 'la-1' }, cursor: { epoch: 'E', seq: 7 } }, h.sink, null);
    h.table.receive({ t: 'subbed', sub: s.id, mode: 'snapshot', epoch: 'E', seq: 0 });
    for (const page of pages(s.id, { epoch: 'E', seq: 0 }, { rows: [] }, 100)) h.table.receive(page);
    h.table.receive({ t: 'ev', sub: s.id, epoch: 'E', seq: 1, body: 'one' });
    expect(h.heard.filter((x) => x[0] === 'event')).toEqual([['event', { epoch: 'E', seq: 1 }, 'one']]);
  });
});

describe('delivery', () => {
  it('joins pages and discards an assembly with a page out of order', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'B', id: 'app-1' } }, h.sink, null);
    const ps = pages(s.id, { epoch: 'L1', seq: 0 }, { a: 'x'.repeat(30) }, 8);
    h.table.receive(ps[0]);
    h.table.receive(ps[2]);
    h.table.receive(ps[1]);
    expect(h.heard.filter((x) => x[0] === 'snapshot')).toEqual([]);
    expect(h.logs.some((l) => l.includes('out of order'))).toBe(true);
    for (const page of ps) h.table.receive(page);
    expect(h.heard.filter((x) => x[0] === 'snapshot')).toEqual([['snapshot', { epoch: 'L1', seq: 0 }, { a: 'x'.repeat(30) }]]);
  });

  it('drops an event at or before the cursor within its epoch', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'B', id: 'app-1' }, cursor: { epoch: 'L1', seq: 2, idx: 1 } }, h.sink, null);
    h.table.receive({ t: 'subbed', sub: s.id, mode: 'replay', epoch: 'L1', seq: 2, idx: 1 });
    for (const [seq, idx] of [[2, 0], [2, 1], [2, 2], [2, 2], [3, 0]]) h.table.receive(ev(s.id, seq, idx));
    expect(h.heard.filter((x) => x[0] === 'event').map((x) => x[1])).toEqual([
      { epoch: 'L1', seq: 2, idx: 2 },
      { epoch: 'L1', seq: 3, idx: 0 },
    ]);
  });

  it('returns credit in batches of 256 KiB, or after 250 ms', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'B', id: 'app-1' } }, h.sink, null);
    const small = ev(s.id, 1, 0);
    h.table.receive(small);
    expect(h.sent.filter((m) => m.t === 'credit')).toEqual([]);
    vi.advanceTimersByTime(250);
    expect(h.sent.filter((m) => m.t === 'credit')).toEqual([{ t: 'credit', sub: s.id, bytes: Buffer.byteLength(JSON.stringify(small)) }]);
    const big: EndpointMessage = { t: 'ev', sub: s.id, epoch: 'L1', seq: 2, idx: 0, body: 'x'.repeat(300 * 1024) };
    h.table.receive(big);
    expect(h.sent.filter((m) => m.t === 'credit').at(-1)).toEqual({ t: 'credit', sub: s.id, bytes: Buffer.byteLength(JSON.stringify(big)) });
  });

  it('splits a refund over SUB_CREDIT_MAX into messages that keep the exact total (an overdrawn credit)', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'B', id: 'app-1' } }, h.sink, null);
    const small: EndpointMessage = { t: 'ev', sub: s.id, epoch: 'L1', seq: 1, idx: 0, body: 'x'.repeat(100 * 1024) };
    const large: EndpointMessage = { t: 'ev', sub: s.id, epoch: 'L1', seq: 2, idx: 0, body: 'y'.repeat(4 * 1024 * 1024 - 200) };
    h.table.receive(small);
    h.table.receive(large);
    const credits = h.sent.filter((m) => m.t === 'credit') as Array<{ bytes: number }>;
    const total = Buffer.byteLength(JSON.stringify(small)) + Buffer.byteLength(JSON.stringify(large));
    expect(total).toBeGreaterThan(SUB_CREDIT_MAX);
    expect(credits.length).toBeGreaterThan(1);
    expect(credits.every((c) => c.bytes >= 1 && c.bytes <= SUB_CREDIT_MAX)).toBe(true);
    expect(credits.reduce((sum, c) => sum + c.bytes, 0)).toBe(total);
  });
});

describe('endings', () => {
  it('removes a subscription the endpoint ends', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'B', id: 'app-1' } }, h.sink, null);
    h.table.receive({ t: 'ended', sub: s.id, reason: 'removed' });
    expect(h.table.size).toBe(0);
    h.table.onCurrent();
    expect(h.subs()).toHaveLength(1);
    expect(h.heard).toEqual([['ended', 'removed']]);
  });

  it('ends a 65th subscription `busy` without a round trip', async () => {
    const h = harness();
    for (let i = 0; i < MAX_SUBS; i++) h.table.subscribe({ session: { lane: 'B', id: `s${i}` } }, h.sink, null);
    h.table.subscribe({ session: { lane: 'B', id: 'one-more' } }, h.sink, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.subs()).toHaveLength(MAX_SUBS);
    expect(h.heard).toEqual([['ended', 'busy']]);
  });

  it('sends unsub on close', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'B', id: 'app-1' } }, h.sink, null);
    s.close();
    expect(h.sent.at(-1)).toEqual({ t: 'unsub', sub: s.id });
    expect(h.table.size).toBe(0);
  });

  it('pauses each sink `offline` once past the grace, and the next subbed resumes it', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'B', id: 'app-1' } }, h.sink, null);
    h.table.onOffline();
    h.table.onOffline();
    expect(h.heard).toEqual([['paused', 'offline']]);
    h.table.onCurrent();
    h.table.receive({ t: 'subbed', sub: s.id, mode: 'snapshot', epoch: 'L1', seq: 0 });
    h.table.onOffline();
    expect(h.heard.filter((x) => x[0] === 'paused')).toHaveLength(2);
  });

  it('keeps one id across channels', () => {
    const h = harness();
    const s = h.table.subscribe({ session: { lane: 'A', id: 'la-1' } }, h.sink, null);
    h.table.onCurrent();
    expect(h.subs().map((m) => m.sub)).toEqual([s.id, s.id]);
  });
});

// P5 O7 M4 (§R): a session's checkout feed, behind `rl2.feeds`.
describe('feeds', () => {
  it('sends a checkout feed with no view and no cursor to a peer that lists `rl2.feeds`, again on each channel, deduping by (epoch, seq)', async () => {
    const h = harness();
    h.channel.peer = ['rl2.feeds'];
    const s = h.table.subscribe({ session: { lane: 'B', id: 'app-1' }, view: 'full', feed: 'checkout' }, h.sink, null);
    expect(h.subs()).toEqual([{ t: 'sub', sub: s.id, session: { lane: 'B', id: 'app-1' }, feed: 'checkout', cursor: null, credit: 1024 * 1024 }]);
    h.table.receive({ t: 'subbed', sub: s.id, mode: 'snapshot', epoch: 'checkout:boot', seq: 0 });
    h.table.receive({ t: 'ev', sub: s.id, epoch: 'checkout:boot', seq: 1, body: { name: 'files.changed', payload: {} } });
    h.table.receive({ t: 'ev', sub: s.id, epoch: 'checkout:boot', seq: 1, body: { name: 'files.changed', payload: {} } });
    expect(h.heard.filter((x) => x[0] === 'event')).toHaveLength(1);
    h.table.onCurrent();
    expect(h.subs().at(-1)).toEqual({ t: 'sub', sub: s.id, session: { lane: 'B', id: 'app-1' }, feed: 'checkout', cursor: null, credit: 1024 * 1024 });
    // a new opening starts the count again
    h.table.receive({ t: 'subbed', sub: s.id, mode: 'snapshot', epoch: 'checkout:boot', seq: 0 });
    h.table.receive({ t: 'ev', sub: s.id, epoch: 'checkout:boot', seq: 1, body: { name: 'git.changed', payload: {} } });
    expect(h.heard.filter((x) => x[0] === 'event')).toHaveLength(2);
  });

  it('ends a feed `not-offered`, never sent, for a peer that lists no `rl2.feeds`, on its subscribe or on the next channel', async () => {
    const h = harness();
    h.table.subscribe({ session: { lane: 'B', id: 'app-1' }, feed: 'checkout' }, h.sink, null);
    await Promise.resolve();
    expect(h.subs()).toEqual([]);
    expect(h.heard).toEqual([['ended', 'not-offered']]);
    expect(h.table.size).toBe(0);

    h.channel.peer = ['rl2.feeds'];
    const later = harness();
    later.channel.peer = ['rl2.feeds'];
    later.table.subscribe({ session: { lane: 'B', id: 'app-1' }, feed: 'checkout' }, later.sink, null);
    later.channel.peer = []; // the next channel's peer, an older build
    later.table.onCurrent();
    await Promise.resolve();
    expect(later.subs()).toHaveLength(1);
    expect(later.heard).toEqual([['ended', 'not-offered']]);
    expect(later.table.size).toBe(0);
  });

  // P5 O7 M6: the machine's attention feed names no session
  it('sends the machine’s attention feed with no session, view or cursor, again on each channel, and ends it `not-offered` for a peer without `rl2.feeds`', async () => {
    const h = harness();
    h.channel.peer = ['rl2.feeds'];
    const s = h.table.subscribe({ feed: 'attention' }, h.sink, null);
    expect(h.subs()).toEqual([{ t: 'sub', sub: s.id, feed: 'attention', cursor: null, credit: 1024 * 1024 }]);
    h.table.receive({ t: 'subbed', sub: s.id, mode: 'snapshot', epoch: 'attention:boot', seq: 0 });
    h.table.receive({ t: 'ev', sub: s.id, epoch: 'attention:boot', seq: 1, body: { appSessionId: 'app-1', items: [] } });
    h.table.receive({ t: 'ev', sub: s.id, epoch: 'attention:boot', seq: 1, body: { appSessionId: 'app-1', items: [] } });
    expect(h.heard.filter((x) => x[0] === 'event')).toHaveLength(1);
    h.table.onCurrent();
    expect(h.subs().at(-1)).toEqual({ t: 'sub', sub: s.id, feed: 'attention', cursor: null, credit: 1024 * 1024 });
    h.channel.peer = [];
    h.table.onCurrent();
    await Promise.resolve();
    expect(h.subs()).toHaveLength(2);
    expect(h.heard.at(-1)).toEqual(['ended', 'not-offered']);
  });
});
