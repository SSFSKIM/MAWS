// The wake case's reading (test/support/remote-wake.ts) over made-up logs and pipe records in the forms the writers give
// them: a run that passes reads as one, and each way §I's step 5 or 6 can fail is named.
import { describe, expect, it } from 'vitest';
import type { PipeRequest } from './loopback-pipe';
import type { LogLine } from './main-log';
import { linkPending, loadVoid, markersNotOnce, placeOfEvent, readWake, sixMissing, sixSubscriptions, subscriptionsIn, wakeMisses, wakeSummary, type WakeInput } from './remote-wake';

const REF = 'Bref0123456789abcdef';
const APPS = ['app-1', 'app-2'];
const T0 = Date.parse('2026-11-10T08:00:00.000Z');
const at = (s: number) => T0 + Math.round(s * 1_000);
const line = (s: number, text: string): LogLine => ({ at: at(s), text });
const m = (s: number, text: string) => line(s, `[machines] ${REF}: ${text}`);

// launch at 0 s, the six answered at 5 s, the stall at 10 s, the inject at 80 s, the restore at 82 s (the hub's at 84 s
// on the direct launch); ids s1/s2 the streams, c1/c2 the checkout feeds, at/ar the machine's feeds
const IDS: Record<string, string> = { 'session B:app-1': 's1', 'session B:app-2': 's2', 'feed checkout B:app-1': 'c1', 'feed checkout B:app-2': 'c2', 'feed attention': 'at', 'feed artifacts': 'ar' };
const FEEDS = ['feed checkout B:app-1', 'feed checkout B:app-2', 'feed attention', 'feed artifacts'];
function passing(carrier: 'direct' | 'relay'): WakeInput {
  const restored = 82;
  const hub = carrier === 'direct' ? 84 : restored;
  const main: LogLine[] = [
    m(4, `up over the ${carrier} carrier`),
    m(5, 'subscription s1 session B:app-1: subbed snapshot at L1:310:-, asked from none'),
    m(5, 'subscription s2 session B:app-2: subbed snapshot at L2:312:-, asked from none'),
    ...FEEDS.map((what) => m(5, `subscription ${IDS[what]} ${what}: subbed snapshot at e:1:-, asked from none`)),
    m(30, `the ${carrier} channel was lost (timeout); reconnecting`),
    line(80.01, '[wake] slept 3600000 ms (clock)'),
    m(80.01, 'wake after 3600000 ms: dropped no channel, 1 attempt(s) in flight'),
    line(80.01, '[org-feed] wake after 3600000 ms: no socket'),
    m(82.2, `up over the ${carrier} carrier`),
    m(82.25, 'subscription s1 session B:app-1: subbed replay at L1:310:4, asked from L1:310:4'),
    m(82.3, 'subscription s2 session B:app-2: subbed replay at L2:312:2, asked from L2:312:2'),
    ...FEEDS.map((what) => m(82.21, `subscription ${IDS[what]} ${what}: subbed snapshot at e:2:-, asked from none`)),
    m(82.4, 'subscription s1 session B:app-1: first event after subbed, at L1:311:0'),
    m(82.45, 'subscription s2 session B:app-2: first event after subbed, at L2:313:0'),
    line(hub + 0.4, '[org-feed] connected to 127.0.0.1:5000'),
    line(hub + 0.6, '[org-feed] listings: last page, 2 records in 1 pages'),
  ];
  const endpoint: LogLine[] = [
    line(5, '[endpoint] endpoint: channel k1 sub s1 session B:app-1: subbed snapshot at L1:310:-, asked from none, after 2 ms'),
    line(82.24, '[endpoint] endpoint: channel k2 sub s1 session B:app-1: subbed replay at L1:310:4, asked from L1:310:4, after 21 ms'),
    line(82.29, '[endpoint] endpoint: channel k2 sub s2 session B:app-2: subbed replay at L2:312:2, asked from L2:312:2, after 33 ms'),
    ...FEEDS.map((what) => line(82.2, `[endpoint] endpoint: channel k2 sub ${IDS[what]} ${what}: subbed snapshot at e:2:-, asked from none, after 0 ms`)),
  ];
  const host: LogLine[] = [
    line(3, 'warn: [engine-host] session.events app-1 after start: from the journal, 310 rows read in 1 ms'),
    line(82.23, 'warn: [engine-host] session.events app-1 after 309: from the journal, 6900 rows read in 20 ms'),
    line(82.27, 'warn: [engine-host] session.events app-2 after 311: from the journal, 6950 rows read in 30 ms'),
  ];
  const probe = (s: number): PipeRequest => ({ at: at(s), firstLine: null });
  const request = (s: number, target: string): PipeRequest => ({ at: at(s), firstLine: `GET ${target} HTTP/1.1` });
  const relaySocket = `/api/machines/${REF}/socket`;
  const requests =
    carrier === 'direct'
      ? { direct: [request(1, '/'), probe(82.05), request(82.1, '/')], hub: [request(1, '/api/registry/socket?app=1'), request(1, relaySocket), probe(84.05), request(84.1, '/api/registry/socket?app=1'), request(84.1, `/api/machines/${REF}/endpoint`)] }
      : { direct: [request(1, '/'), probe(82.05), request(82.1, '/'), request(84.3, '/')], hub: [request(1, relaySocket), probe(82.05), request(82.1, relaySocket), request(82.1, '/api/registry/socket?app=1')] };
  const held = { 'app-1': 'L1:310:4', 'app-2': 'L2:312:2' };
  return { carrier, ref: REF, expected: sixSubscriptions(APPS), held, main, endpoint, host, launchedAt: at(0), stalledAt: at(10), injectedAt: at(80), restoredAt: at(restored), hubRestoredAt: at(hub), requests };
}
const without = (lines: LogLine[], part: string) => lines.filter((l) => !l.text.includes(part));
const failuresOf = (input: WakeInput) => readWake(input).failures;

describe('the six', () => {
  it('are each session’s stream and checkout feed and the machine’s two feeds', () => {
    expect(sixSubscriptions(APPS)).toEqual([
      { what: 'session B:app-1', stream: 'app-1' },
      { what: 'feed checkout B:app-1', stream: null },
      { what: 'session B:app-2', stream: 'app-2' },
      { what: 'feed checkout B:app-2', stream: null },
      { what: 'feed attention', stream: null },
      { what: 'feed artifacts', stream: null },
    ]);
  });

  it('are read from a stretch of the log, each by its last subbed line', () => {
    const input = passing('direct');
    const held = subscriptionsIn(input.main, REF, input.launchedAt, input.stalledAt);
    expect([...held.keys()].sort()).toEqual(Object.keys(IDS).sort());
    expect(held.get('session B:app-1')).toMatchObject({ id: 's1', mode: 'snapshot', position: 'L1:310:-' });
    expect(sixMissing(input.expected, held)).toEqual([]);
    expect(sixMissing(input.expected, subscriptionsIn(input.main, REF, input.launchedAt, at(4)))).toEqual(input.expected.map(({ what }) => `no subbed line for ${what}`));
    expect(subscriptionsIn(input.main, 'another-ref-000000', input.launchedAt).size).toBe(0);
  });

  it('a subscription beside them is named', () => {
    const held = subscriptionsIn([...passing('direct').main, m(6, 'subscription x9 feed browser.inventory B:app-1: subbed snapshot at e:1:-, asked from none')], REF, at(0), at(10));
    expect(sixMissing(sixSubscriptions(APPS), held)).toEqual(['a subscription besides the six: feed browser.inventory B:app-1 (x9)']);
  });
});

describe('what the link still lacks after the restore', () => {
  it('is nothing once the carrier is up and every id is answered', () => {
    const input = passing('relay');
    expect(linkPending(input.main, REF, 'relay', Object.values(IDS), input.restoredAt)).toEqual([]);
  });
  it('names the up line and each id not answered yet', () => {
    const input = passing('relay');
    const main = without(without(input.main, 'subscription s2 session B:app-2: subbed replay'), 'up over the relay carrier');
    expect(linkPending(main, REF, 'relay', ['s1', 's2'], input.restoredAt)).toEqual(['the up over the relay carrier line', 'a subbed line for s2']);
  });
});

describe('a run', () => {
  it('that passes on the direct carrier reads as one, with its times from the restores', () => {
    const { record, failures } = readWake(passing('direct'));
    expect(failures).toEqual([]);
    expect(record.upMs).toBe(200);
    expect(record.lastSubbedMs).toBe(300);
    expect(record.upgrades).toBe(1);
    expect(record.feedOpens).toBe(1);
    expect(record.feed).toEqual({ connectedMs: 400, lastPageMs: 600, records: 2, pages: 1 });
    expect(record.wake).toBe('[wake] slept 3600000 ms (clock)');
    expect(record.linkWake).toBe('wake after 3600000 ms: dropped no channel, 1 attempt(s) in flight');
    expect(record.lost).toEqual(['the direct channel was lost (timeout); reconnecting']);
    expect(record.waitMs).toBe(2_000);
    const s1 = record.subscriptions.find((s) => s.id === 's1')!;
    expect(s1).toMatchObject({ what: 'session B:app-1', stream: 'app-1', held: 'L1:310:4', after: { mode: 'replay', asked: 'L1:310:4', ms: 250 }, endpoint: { mode: 'replay', asked: 'L1:310:4', ms: 21 }, journal: { after: 309, rows: 6_900, ms: 20 }, first: { delivery: 'event', position: 'L1:311:0', ms: 400 } });
    expect(record.subscriptions.find((s) => s.id === 'at')).toMatchObject({ stream: null, held: null, journal: null, after: { mode: 'snapshot', asked: 'none' } });
    expect(wakeMisses(record)).toEqual([]);
    expect(wakeSummary(record)).toBe("[remote-wake] direct: up 200 ms and last subbed 300 ms after the restore; feed connected 400 ms and last listings page 600 ms after the hub's restore; 1 upgrade, 1 feed open");
  });

  it('that passes on the relay reads as one, the hub’s restore being the restore', () => {
    const { record, failures } = readWake(passing('relay'));
    expect(failures).toEqual([]);
    expect(record.upgrades).toBe(1);
    expect(record.feed.connectedMs).toBe(400);
    expect(record.requests.direct.map((r) => r.firstLine)).toEqual([null, 'GET / HTTP/1.1', 'GET / HTTP/1.1']);
  });

  it('names a wake the log does not show', () => {
    const input = passing('direct');
    expect(failuresOf({ ...input, main: without(input.main, '[wake] slept') })).toEqual(['direct: no [wake] slept 3600000 ms line after the inject']);
    expect(failuresOf({ ...input, main: without(input.main, 'wake after 3600000 ms: dropped') })).toEqual(["direct: no link line wake after 3600000 ms: dropped … after the inject"]);
  });

  it('names an up over the other carrier, and none at all', () => {
    const input = passing('direct');
    const main = input.main.map((l) => (l.at === at(82.2) ? m(82.2, 'up over the relay carrier') : l));
    expect(failuresOf({ ...input, main })).toEqual(['direct: the link came up over the relay carrier after the restore, not the direct']);
    expect(failuresOf({ ...input, main: without(input.main, 'up over the direct carrier').concat(m(4, 'up over the direct carrier')) })).toEqual(['direct: no up over the direct carrier line after the restore']);
  });

  it('names a subscription not answered after the restore, or answered during the stall', () => {
    const input = passing('direct');
    expect(failuresOf({ ...input, main: without(input.main, 'subscription ar feed artifacts: subbed snapshot at e:2') })).toEqual(['direct: subscription ar (feed artifacts) has no subbed line after the restore']);
    const early = input.main.concat(m(50, 'subscription at feed attention: subbed snapshot at e:2:-, asked from none'));
    expect(failuresOf({ ...input, main: early })).toEqual(['direct: subscription at (feed attention) was answered during the stall']);
  });

  it('names a stream that is not a replay from the cursor it held', () => {
    const input = passing('direct');
    const swap = (from: string, to: string, logs: ('main' | 'endpoint' | 'host')[] = ['main']) => {
      const out = { ...input };
      for (const log of logs) out[log] = input[log].map((l) => (l.text.includes(from) ? { ...l, text: l.text.replace(from, to) } : l));
      return out;
    };
    expect(failuresOf(swap('subbed replay at L1:310:4, asked from L1:310:4', 'subbed snapshot at L1:310:4, asked from L1:310:4'))).toEqual([
      'direct: subscription s1 (session B:app-1) answered snapshot, not replay',
      'direct: B answered subscription s1 replay where A read snapshot',
    ]);
    expect(failuresOf(swap('asked from L1:310:4', 'asked from none'))).toEqual(['direct: subscription s1 (session B:app-1) asked from none, not from L1:310:4, the cursor it held', 'direct: B was asked for subscription s1 from L1:310:4, where A asked from none']);
    expect(failuresOf(swap('asked from L1:310:4', 'asked from L9:310:4'))[0]).toBe('direct: subscription s1 (session B:app-1) asked from L9:310:4, not from L1:310:4, the cursor it held');
  });

  it('names a resume that jumped forward in the same launch, though B agrees and replays it from its journal', () => {
    const input = passing('direct');
    const jump = (l: LogLine) => ({ ...l, text: l.text.replace('L1:310:4, asked from L1:310:4', 'L1:400:0, asked from L1:400:0').replace('app-1 after 309:', 'app-1 after 399:') });
    expect(failuresOf({ ...input, main: input.main.map(jump), endpoint: input.endpoint.map(jump), host: input.host.map(jump) })).toEqual([
      'direct: subscription s1 (session B:app-1) asked from L1:400:0, not from L1:310:4, the cursor it held',
      "direct: B's host.log read session.events app-1 from the journal after 399, not after 309, the row before the cursor it held",
    ]);
  });

  it('names a stream with no cursor established before the stall', () => {
    const input = passing('direct');
    expect(failuresOf({ ...input, held: { 'app-2': 'L2:312:2' } })).toEqual(['direct: subscription s1 (session B:app-1) has no cursor established before the stall']);
  });

  it('names a stream whose content did not resume after its subbed, or resumed at or before its cursor', () => {
    const input = passing('direct');
    for (const [id, app] of [['s1', 'app-1'], ['s2', 'app-2']] as const) {
      const what = `session B:${app}`;
      expect(failuresOf({ ...input, main: without(input.main, `subscription ${id} ${what}: first event after subbed`) })).toEqual([`direct: subscription ${id} (${what}) has no first event after subbed line after its subbed`]);
    }
    const early = input.main.map((l) => (l.text.includes('subscription s2 session B:app-2: first event after subbed') ? { ...l, at: at(82.29) } : l));
    expect(failuresOf({ ...input, main: early })).toEqual(['direct: subscription s2 (session B:app-2) has no first event after subbed line after its subbed']);
    const repeated = input.main.map((l) => (l.text.includes('subscription s1 session B:app-1: first event') ? { ...l, text: l.text.replace('at L1:311:0', 'at L1:310:4') } : l));
    expect(failuresOf({ ...input, main: repeated })).toEqual(["direct: subscription s1 (session B:app-1)'s first event after subbed is at L1:310:4, not after L1:310:4, the cursor it held"]);
  });

  it('names what B’s logs lack: the endpoint’s answer and the journal read', () => {
    const input = passing('direct');
    expect(failuresOf({ ...input, endpoint: without(input.endpoint, 'channel k2 sub c2 ') })).toEqual(["direct: B's mawsd.log has no sub c2 line (feed checkout B:app-2) after the restore"]);
    expect(failuresOf({ ...input, host: without(input.host, 'app-2 after 311') })).toEqual(["direct: B's host.log has no session.events app-2 … from the journal line after the restore: the stream's cursor is not shown evicted"]);
  });

  it('names a repeated event', () => {
    const input = passing('direct');
    expect(failuresOf({ ...input, main: input.main.concat(m(83, 'subscription s1: dropped a repeated event at L1:400:2')) })).toEqual(['direct: main.log says subscription s1: dropped a repeated event at L1:400:2']);
  });

  it('names the counts on the direct launch: upgrades, the stalled hub, the feed’s opens', () => {
    const input = passing('direct');
    const direct = [...input.requests.direct, { at: at(83), firstLine: 'GET / HTTP/1.1' }];
    expect(failuresOf({ ...input, requests: { ...input.requests, direct } })).toEqual(['direct: the direct pipe saw 2 upgrade requests since the stall, not one: GET / HTTP/1.1 | GET / HTTP/1.1']);
    const hub = [...input.requests.hub, { at: at(83), firstLine: null }, { at: at(85), firstLine: 'GET /api/registry/socket?app=1 HTTP/1.1' }];
    expect(failuresOf({ ...input, requests: { ...input.requests, hub } })).toEqual(["direct: the hub's pipe, stalled, saw 1 connection(s) since the stall", "direct: the hub's pipe saw 2 requests for /api/registry/socket?app=1 since the stall, not one"]);
  });

  it('names the counts on the relay launch: one socket, and no direct carrier', () => {
    const input = passing('relay');
    const relaySocket = `GET /api/machines/${REF}/socket HTTP/1.1`;
    expect(failuresOf({ ...input, requests: { ...input.requests, hub: [...input.requests.hub, { at: at(86), firstLine: relaySocket }] } })).toEqual([`relay: the hub's pipe saw 2 requests for /api/machines/${REF}/socket since the stall, not one`]);
    expect(failuresOf({ ...input, main: input.main.concat(m(90, 'up over the direct carrier')) })).toEqual(['relay: an up over the direct carrier line since the stall: a direct dial reached B through the held pipe']);
  });

  it('names a feed that did not come back after the hub’s restore', () => {
    const input = passing('direct');
    expect(failuresOf({ ...input, main: without(input.main, '[org-feed] listings') })).toEqual(["direct: no [org-feed] listings: last page line after the hub's restore"]);
    const early = input.main.map((l) => (l.text.startsWith('[org-feed] connected') ? { ...l, at: at(83) } : l));
    expect(failuresOf({ ...input, main: early })).toEqual(["direct: [org-feed] connected came 1000 ms before the hub's restore"]);
  });

  it('names a six that was not six before the stall', () => {
    const input = passing('direct');
    expect(failuresOf({ ...input, main: without(input.main, 'subscription at feed attention: subbed snapshot at e:1') })[0]).toBe('direct: before the stall, no subbed line for feed attention');
  });

  it('keeps the lines that show a condition of §F missed, with their time from the restore', () => {
    const input = passing('direct');
    const main = input.main.concat(m(82.15, 'attempt failed (direct): no handshake within 2000 ms; next in 100 ms'), m(82.18, 'lane direct: spent (6 attempts)'));
    expect(readWake({ ...input, main }).record.conditions).toEqual(['+150 ms attempt failed (direct): no handshake within 2000 ms; next in 100 ms', '+180 ms lane direct: spent (6 attempts)']);
  });
});

describe('the bounds', () => {
  it('name each time over its bound, and nothing at its bound', () => {
    const input = passing('direct');
    const late = input.main.map((l) => {
      if (l.text.includes('subscription s2 session B:app-2: subbed replay')) return { ...l, at: input.restoredAt + 1_001 };
      if (l.text.startsWith('[org-feed] connected')) return { ...l, at: input.hubRestoredAt + 2_000 };
      if (l.text.startsWith('[org-feed] listings')) return { ...l, at: input.hubRestoredAt + 2_500 };
      return l;
    });
    expect(wakeMisses(readWake({ ...input, main: late }).record)).toEqual([
      'direct: subscription s2 (session B:app-2) answered 1001 ms after the restore, over 1000 ms',
      "direct: the feed's last listings page 2500 ms after the hub's restore, over 2000 ms",
    ]);
  });
});

describe('an event’s place', () => {
  it('is its launch, row and index, from its id, as a cursor is written', () => {
    expect(placeOfEvent('app-1', 'app-1:L-1:310:4')).toBe('L-1:310:4');
    expect(placeOfEvent('app-1', 'app-1:a:b:310:0')).toBe('a:b:310:0');
    expect(placeOfEvent('app-1', 'app-2:L-1:310:4')).toBeNull();
    expect(placeOfEvent('app-1', 'app-1:side-thread:opened')).toBeNull();
    expect(placeOfEvent('app-1', 'app-1:L-1:x:4')).toBeNull();
  });
});

describe('the pane', () => {
  it('names each marker it does not show exactly once', () => {
    const markers = ['⟦t3:1⟧', '⟦t3:2⟧', '⟦t3:10⟧'];
    expect(markersNotOnce('⟦t3:1⟧ ⟦t3:2⟧ ⟦t3:10⟧ ', markers)).toEqual([]);
    expect(markersNotOnce('⟦t3:1⟧ ⟦t3:1⟧ ⟦t3:10⟧ ⟦t33:2⟧', markers)).toEqual([{ marker: '⟦t3:1⟧', count: 2 }, { marker: '⟦t3:2⟧', count: 0 }]);
  });
});

describe('the load', () => {
  it('voids a run only under Rule B', () => {
    expect(loadVoid([1, 2, 3], 2)).toEqual([]);
    expect(loadVoid([6, 6, 6], null)).toEqual(["the machine's load: peak 6 at or over 5, 30 s pair 6 at or over 4.7 (Rule B)"]);
  });
});
