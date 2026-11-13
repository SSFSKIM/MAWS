// The wake case's reading (test/support/remote-wake.ts) over made-up logs and pipe records in the forms the writers give
// them: a run that passes reads as one, and each way §I's step 5 or 6 can fail is named.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PipeRequest } from './loopback-pipe';
import type { LogLine } from './main-log';
import { CHECKPOINT_ROWS as STREAM_CHECKPOINT_ROWS } from '../../src/engine-host/session-stream';
import { PAGE_EVENTS } from '../../src/shared/host/stream-catchup';
import { besideOutcome, boundMissMessage, CHANNEL_CLOSED_WITHIN_MS, historySeen, historyReadsBeside, CHECKPOINT_ROWS, INJECT_AFTER_STALL_MS, PAST_RESUME_MARGIN_MS, PING_MS, RESUME_MS, RESUME_PAGE_EVENTS, lastPageIn, linkPending, markersNotOnce, placeOfEvent, readWake, ruleBContext, sixMissing, sixSubscriptions, subscriptionsIn, unavailableSummary, VOID_LOAD, wakeMisses, wakeSummary, wakeTimingSummary, wakeVerdict, type LoadRead, type WakeInput, type WakeRecord } from './remote-wake';

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
  // each resume page's rows on B past its cursor, through its look-ahead row: 6,591 after 309, 6,639 after 311
  const pageRows = { 'app-1': 6_591, 'app-2': 6_639 };
  return { carrier, ref: REF, expected: sixSubscriptions(APPS), held, pageRows, main, endpoint, host, launchedAt: at(0), stalledAt: at(10), injectedAt: at(80), restoredAt: at(restored), hubRestoredAt: at(hub), requests };
}
const without = (lines: readonly LogLine[], part: string) => lines.filter((l) => !l.text.includes(part));
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
    expect(s1).toMatchObject({ what: 'session B:app-1', stream: 'app-1', held: 'L1:310:4', after: { mode: 'replay', asked: 'L1:310:4', ms: 250 }, endpoint: { mode: 'replay', asked: 'L1:310:4', ms: 21 }, journal: { after: 309, rows: 6_900, ms: 20, checkpoint: null, bound: 16_591 }, first: { delivery: 'event', position: 'L1:311:0', ms: 400 } });
    expect(record.subscriptions.find((s) => s.id === 'at')).toMatchObject({ stream: null, held: null, journal: null, after: { mode: 'snapshot', asked: 'none' } });
    expect(wakeMisses(record)).toEqual([]);
    expect(wakeSummary(record)).toBe("[remote-wake] direct: up 200 ms and last subbed 300 ms after the restore; feed connected 400 ms and last listings page 600 ms after the hub's restore; 1 upgrade, 1 feed open");
  });

  it('whose evidence could not be read still has its line', () => {
    expect(unavailableSummary('relay', 'ENOENT: no such file')).toBe("[remote-wake] relay: evidence unavailable: main.log, B's logs or the pipes could not be read (ENOENT: no such file)");
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
    const snapshot = input.main.map((l) => (l.text.includes('subscription s1 session B:app-1: first event after subbed') ? { ...l, text: l.text.replace('first event after subbed', 'first snapshot after subbed') } : l));
    expect(failuresOf({ ...input, main: snapshot })).toEqual(['direct: subscription s1 (session B:app-1) has no first event after subbed line after its subbed']);
    const repeated = input.main.map((l) => (l.text.includes('subscription s1 session B:app-1: first event') ? { ...l, text: l.text.replace('at L1:311:0', 'at L1:310:4') } : l));
    expect(failuresOf({ ...input, main: repeated })).toEqual(["direct: subscription s1 (session B:app-1)'s first event after subbed is at L1:310:4, not after L1:310:4, the cursor it held"]);
  });

  it('names what B’s logs lack: the endpoint’s answer and the journal read', () => {
    const input = passing('direct');
    expect(failuresOf({ ...input, endpoint: without(input.endpoint, 'channel k2 sub c2 ') })).toEqual(["direct: B's mawsd.log has no sub c2 line (feed checkout B:app-2) after the restore"]);
    expect(failuresOf({ ...input, host: without(input.host, 'app-2 after 311') })).toEqual(["direct: B's host.log has no session.events app-2 … from the journal line after the restore: the stream's cursor is not shown evicted"]);
  });

  it('holds the rows each resume read took to CHECKPOINT_ROWS plus the page B’s journal holds (§L), naming the rows and the bound', () => {
    expect(CHECKPOINT_ROWS, 'the engine host’s interval').toBe(STREAM_CHECKPOINT_ROWS);
    expect(RESUME_PAGE_EVENTS, 'the resume’s page, as B’s endpoint reads it').toBe(PAGE_EVENTS);
    // the logged rows alone raised, the page B's journal holds unchanged: over the bound
    const input = passing('direct');
    const raised = input.host.map((l) => (l.text.includes('app-1 after 309') ? { ...l, text: l.text.replace('6900 rows', '1000000 rows') } : l));
    expect(failuresOf({ ...input, host: raised })).toEqual(["direct: B's read of session.events app-1 after 309 took 1000000 rows, over its bound of 16591: 10000 rows (CHECKPOINT_ROWS) plus the page's 6591, the rows B's journal holds from the cursor through the page's look-ahead row, read from the first row"]);
    expect(failuresOf({ ...input, host: raised.map((l) => (l.text.includes('app-1 after 309') ? { ...l, text: l.text.replace('1000000 rows', '16591 rows') } : l)) }), 'at its bound').toEqual([]);
    // a page whose rows on B were not established gives no bound, and says so
    expect(failuresOf({ ...input, pageRows: { 'app-2': 6_639 } })).toEqual(["direct: B's read of session.events app-1 after 309 took 6900 rows, and the page's rows on B past the cursor were not established: no bound to hold them to"]);
    // app-1's cursor past the first boundary: a read from the checkpoint at 10,000 holds the bound, one from the first row
    // (today's scan, or a failed checkpoint read's fallback, which counts both attempts) does not
    const resumedAt = (host: string): WakeInput => {
      const moved = (lines: readonly LogLine[]) => lines.map((l) => ({ ...l, text: l.text.replaceAll('L1:310:4', 'L1:12000:4').replaceAll('L1:311:0', 'L1:12001:0') }));
      return { ...input, held: { ...input.held, 'app-1': 'L1:12000:4' }, pageRows: { ...input.pageRows, 'app-1': 101 }, main: moved(input.main), endpoint: moved(input.endpoint), host: input.host.map((l) => (l.text.includes('app-1 after 309') ? { ...l, text: host } : l)) };
    };
    const { record, failures } = readWake(resumedAt('warn: [engine-host] session.events app-1 after 11999: from the journal, 2100 rows read in 9 ms, from the checkpoint at seq 10000'));
    expect(failures).toEqual([]);
    expect(record.subscriptions.find((s) => s.id === 's1')!.journal).toEqual({ after: 11_999, rows: 2_100, ms: 9, checkpoint: 10_000, bound: 10_101 });
    expect(failuresOf(resumedAt('warn: [engine-host] session.events app-1 after 11999: from the journal, 12100 rows read in 80 ms'))).toEqual(["direct: B's read of session.events app-1 after 11999 took 12100 rows, over its bound of 10101: 10000 rows (CHECKPOINT_ROWS) plus the page's 101, the rows B's journal holds from the cursor through the page's look-ahead row, read from the first row"]);
  });

  // Decision Log 39 (b): A's panes hold their sessions through the stall, so none reads its session's whole launch on B
  // (`after start`, the pane's hydration) between the restore and that session's `subbed`, where it contends with the
  // stream's own opening. B's line is written at the read's end; the read began its `ms` before.
  it('names a whole-launch read of a session that landed on B between the restore and that session’s subbed, in both modes', () => {
    const whole = (s: number, app: string, ms: number) => line(s, `warn: [engine-host] session.events ${app} after start: from the journal, 6843 rows read in ${ms} ms`);
    for (const carrier of ['direct', 'relay'] as const) {
      const input = passing(carrier);
      const withReads = (...reads: LogLine[]) => failuresOf({ ...input, host: [...input.host, ...reads] });
      // app-1's sub answered on B at +240 ms, app-2's at +290 ms
      expect(withReads(whole(82.1, 'app-1', 40))).toEqual([`${carrier}: subscription s1 (session B:app-1): B read its session's whole launch (session.events app-1 after start, 6843 rows in 40 ms, from +60 ms to +100 ms) before B's subbed at +240 ms`]);
      expect(withReads(whole(82.5, 'app-1', 400)), 'begun before the subbed, ended after it').toEqual([`${carrier}: subscription s1 (session B:app-1): B read its session's whole launch (session.events app-1 after start, 6843 rows in 400 ms, from +100 ms to +500 ms) before B's subbed at +240 ms`]);
      expect(withReads(whole(82.28, 'app-2', 5)), 'each session against its own subbed').toEqual([`${carrier}: subscription s2 (session B:app-2): B read its session's whole launch (session.events app-2 after start, 6843 rows in 5 ms, from +275 ms to +280 ms) before B's subbed at +290 ms`]);
      // after the session's own subbed, or before the restore (the launch's hydration, at 3 s): none
      expect(withReads(whole(82.5, 'app-1', 100), whole(82.4, 'app-2', 50), whole(81.9, 'app-2', 30))).toEqual([]);
    }
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

  it('records the stall’s length, from the stall to the restore', () => {
    expect(readWake(passing('direct')).record.stallMs).toBe(72_000);
  });
});

// Decision Log 33 (d): `conditions` holds only what §F lists, from the inject, where §F's window opens; the fourth
// condition is about the lane that was adopted, so the other lane's failed attempts and its spent line are kept apart
// A5 (UX wave U9 M5, #565): beside the live session's resume, a cold or idle tab's pane reads nothing; it reads at
// main's settled word, which follows that resume's answer. Here app-1 is the live session (A heard its subbed at +250 ms,
// B answered it at +240 ms) and app-2 the tab beside it. A's own start line of each history read (`asked`) is the read
// whatever B answers it from (its ring, its journal or disk) and whether or not it has ended.
describe('the reads beside a resume', () => {
  const whole = (s: number, app: string, ms: number) => line(s, `warn: [engine-host] session.events ${app} after start: from the journal, 420 rows read in ${ms} ms`);
  const asked = (s: number, app: string) => line(s, `[lane-b] lane B: timing history B/${app}: asked`);
  const read = (s: number, app: string, ms: number) => line(s, `[lane-b] lane B: timing history B/${app}: budgeted launch, 1 pages, 5469 bytes, ${ms} ms`);
  // each pane's first read, at the launch: the start and end lines the check stands on
  const opened = [asked(3, 'app-1'), read(3.1, 'app-1', 100), asked(3, 'app-2'), read(3.2, 'app-2', 200)];
  const inputOf = (a: readonly LogLine[], b: readonly LogLine[] = [], first: readonly LogLine[] = opened) => {
    const input = passing('direct');
    return { carrier: 'direct' as const, ref: REF, live: 'app-1', sessions: APPS, main: [...input.main, ...first, ...a], endpoint: input.endpoint, host: [...input.host, ...b], launchedAt: input.launchedAt, stalledAt: input.stalledAt, restoredAt: input.restoredAt };
  };
  const beside = (a: readonly LogLine[], b: readonly LogLine[] = []) => historyReadsBeside(inputOf(a, b));

  // M5's re-review, finding 1: with no start line to read the check would pass whatever was read, so it stands only on
  // each pane's first read shown before the stall, its start paired with its end
  it('fail without each session’s first read before the stall, its start and its end, whatever came after', () => {
    expect(historyReadsBeside(inputOf([], [], [])).failures).toEqual([
      "direct: main.log has no history read of session app-1 between the launch and the stall (an asked line and its end): the check would see no read",
      "direct: main.log has no history read of session app-2 between the launch and the stall (an asked line and its end): the check would see no read",
    ]);
    expect(historyReadsBeside(inputOf([], [], [asked(3, 'app-1'), read(3.1, 'app-1', 100), asked(3, 'app-2')])).failures, 'a start with no end').toEqual(["direct: main.log has no history read of session app-2 between the launch and the stall (an asked line and its end): the check would see no read"]);
    expect(historyReadsBeside(inputOf([], [], [read(3.1, 'app-1', 100), read(3.2, 'app-2', 200)])).failures, 'ends with no start (an older build)').toHaveLength(2);
    expect(historySeen(opened, APPS, at(0), at(10))).toEqual([]);
    expect(historySeen([], APPS, at(0), at(10))).toEqual(['app-1', 'app-2']);
  });

  // M5's re-review, finding 2: the case's bounded wait returns the last answered read when it gives up; that read may be
  // an early empty one while every later read failed, and the observation never completed
  it('stand only on a reading that completed: an early empty read, then failures until the wait gave up, fails', () => {
    expect(besideOutcome({ done: true, last: { failures: [], inFlight: [] }, error: null }, 30_000)).toEqual([]);
    expect(besideOutcome({ done: true, last: { failures: ['direct: a failure'], inFlight: [] }, error: null }, 30_000)).toEqual(['direct: a failure']);
    expect(besideOutcome({ done: false, last: { failures: [], inFlight: [] }, error: 'ENOENT: no such file, main.log' }, 30_000)).toEqual(["the reading did not complete within 30000 ms: ENOENT: no such file, main.log"]);
    expect(besideOutcome({ done: false, last: { failures: [], inFlight: ['app-2 (asked at +300 ms)'] }, error: null }, 30_000)).toEqual(['the reading did not complete within 30000 ms: still in flight: app-2 (asked at +300 ms)']);
    expect(besideOutcome({ done: false, last: null, error: null }, 30_000)).toEqual(['the reading did not complete within 30000 ms: no answer']);
  });

  it('are none in a run whose resume reads only from its cursor, and a read asked after the live session’s subbed passes', () => {
    expect(beside([])).toEqual({ failures: [], inFlight: [] });
    expect(beside([asked(82.3, 'app-2'), read(82.35, 'app-2', 50), asked(81.5, 'app-2'), read(81.6, 'app-2', 100)])).toEqual({ failures: [], inFlight: [] });
  });

  it('name a history read A asked before it heard the live session’s subbed, whatever B answered it from', () => {
    // B answered from its ring: no journal line on B at all
    expect(beside([asked(82.1, 'app-2'), read(82.12, 'app-2', 20)]).failures).toEqual(["direct: A asked B for session app-2's history at +100 ms, before it heard B's subbed of the live session app-1 at +250 ms"]);
  });

  it('name a read still in flight, and keep it among those in flight until its end line', () => {
    const outstanding = beside([asked(82.2, 'app-2')]);
    expect(outstanding.failures).toEqual(["direct: A asked B for session app-2's history at +200 ms, before it heard B's subbed of the live session app-1 at +250 ms"]);
    expect(outstanding.inFlight).toEqual(['app-2 (asked at +200 ms)']);
    expect(beside([asked(82.3, 'app-2')]).inFlight, 'after the subbed, in flight still').toEqual(['app-2 (asked at +300 ms)']);
    expect(beside([asked(82.3, 'app-2'), read(82.4, 'app-2', 100)]).inFlight).toEqual([]);
  });

  it('name a whole-launch read on B between the restore and B’s subbed of the live session, begun before it', () => {
    expect(beside([], [whole(82.1, 'app-2', 40)]).failures).toEqual(["direct: B read session app-2's whole launch (session.events app-2 after start, 420 rows in 40 ms, from +60 ms to +100 ms) before B's subbed of the live session app-1 at +240 ms"]);
    expect(beside([], [whole(82.5, 'app-2', 400)]).failures, 'begun before the subbed, ended after it').toEqual(["direct: B read session app-2's whole launch (session.events app-2 after start, 420 rows in 400 ms, from +100 ms to +500 ms) before B's subbed of the live session app-1 at +240 ms"]);
    expect(beside([], [whole(82.3, 'app-2', 50), whole(81.9, 'app-2', 30)]).failures, 'after the subbed, or before the restore').toEqual([]);
  });

  it('name a live session not answered after the restore, on either side', () => {
    const input = passing('direct');
    const after = (l: LogLine) => l.at >= input.restoredAt && l.text.includes('session B:app-1: subbed');
    const reading = (main: readonly LogLine[], endpoint: readonly LogLine[]) => historyReadsBeside({ ...inputOf([]), main: [...main, ...opened], endpoint }).failures;
    expect(reading(input.main.filter((l) => !after(l)), input.endpoint)).toEqual(["direct: main.log has no subscription … session B:app-1: subbed line after the restore"]);
    expect(reading(input.main, input.endpoint.filter((l) => !after(l)))).toEqual(["direct: B's mawsd.log has no sub … session B:app-1: subbed line after the restore"]);
  });
});

describe('the conditions', () => {
  const conditionsOf = (input: WakeInput, ...extra: LogLine[]) => {
    const { conditions, otherLane, windowContext, beforeInject } = readWake({ ...input, main: input.main.concat(extra) }).record;
    return { conditions, otherLane, windowContext, beforeInject };
  };

  it('count from the inject: today’s attempts against the refused pipes during the stall are kept apart, as before the inject', () => {
    expect(conditionsOf(passing('direct'), m(35, "attempt failed (today's): no relay (connect ECONNREFUSED 127.0.0.1:60705 (ECONNREFUSED)); next in 984 ms"))).toEqual({
      conditions: [],
      otherLane: [],
      windowContext: [],
      beforeInject: ["-47000 ms attempt failed (today's): no relay (connect ECONNREFUSED 127.0.0.1:60705 (ECONNREFUSED)); next in 984 ms"],
    });
  });

  it('keep today’s attempt failed after the inject as context, no condition: it names no lane of §F’s', () => {
    expect(conditionsOf(passing('relay'), m(81, "attempt failed (today's): no relay (connect ECONNREFUSED 127.0.0.1:60705 (ECONNREFUSED)); next in 984 ms"))).toEqual({
      conditions: [],
      otherLane: [],
      windowContext: ["-1000 ms attempt failed (today's): no relay (connect ECONNREFUSED 127.0.0.1:60705 (ECONNREFUSED)); next in 984 ms"],
      beforeInject: [],
    });
  });

  it('on the relay’s launch, keep the direct lane’s failed attempt on the held pipe and its spent line as the other lane’s, not conditions (the early run’s line)', () => {
    const input = passing('relay');
    expect(conditionsOf(input, m(83.052, 'attempt failed (direct): ws://127.0.0.1:60706 did not open within 1000 ms; next in 99 ms'), m(90, 'lane direct: spent (6 attempts)'))).toEqual({
      conditions: [],
      otherLane: ['+1052 ms attempt failed (direct): ws://127.0.0.1:60706 did not open within 1000 ms; next in 99 ms', '+8000 ms lane direct: spent (6 attempts)'],
      windowContext: [],
      beforeInject: [],
    });
    expect(conditionsOf(input, m(82.15, 'attempt failed (relay): no handshake within 2000 ms; next in 100 ms'), m(83, 'lane relay: spent (6 attempts)')).conditions).toEqual(['+150 ms attempt failed (relay): no handshake within 2000 ms; next in 100 ms', '+1000 ms lane relay: spent (6 attempts)']);
  });

  it('on the direct launch, keep the relay lane’s as the other lane’s', () => {
    expect(conditionsOf(passing('direct'), m(82.1, 'attempt failed (relay): no relay (connect ECONNREFUSED 127.0.0.1:60705 (ECONNREFUSED)); next in 100 ms'), m(82.12, 'lane relay: spent (no target)'))).toEqual({
      conditions: [],
      otherLane: ['+100 ms attempt failed (relay): no relay (connect ECONNREFUSED 127.0.0.1:60705 (ECONNREFUSED)); next in 100 ms', '+120 ms lane relay: spent (no target)'],
      windowContext: [],
      beforeInject: [],
    });
  });

  it('read the lane adopted from the up line: an up over the other carrier makes the case’s own lane the other', () => {
    const input = passing('direct');
    const main = input.main.map((l) => (l.at === at(82.2) ? m(82.2, 'up over the relay carrier') : l));
    expect(conditionsOf({ ...input, main }, m(82.1, 'attempt failed (direct): no handshake within 2000 ms; next in 100 ms'))).toMatchObject({ conditions: [], otherLane: ['+100 ms attempt failed (direct): no handshake within 2000 ms; next in 100 ms'] });
  });

  it('keep a catch-up whatever its lane, and the acts ahead of the subscriptions over 4 KiB', () => {
    const lines = [m(82.1, 'attempt (direct): catch-up, dial 2'), m(82.11, 'attempt (relay): catch-up, dial 2'), m(82.13, 'wrote 14 act message(s), 9000 bytes, ahead of the subscriptions')];
    expect(conditionsOf(passing('direct'), ...lines)).toEqual({
      conditions: ['+100 ms attempt (direct): catch-up, dial 2', '+110 ms attempt (relay): catch-up, dial 2', '+130 ms wrote 14 act message(s), 9000 bytes, ahead of the subscriptions'],
      otherLane: [],
      windowContext: [],
      beforeInject: [],
    });
  });

  it('keep the floor as context, no condition: §F lets a path return after it with the claim intact', () => {
    expect(conditionsOf(passing('direct'), m(82.12, "floor after 10000 ms: today's attempts from here (10 s without a channel)"))).toEqual({
      conditions: [],
      otherLane: [],
      windowContext: ["+120 ms floor after 10000 ms: today's attempts from here (10 s without a channel)"],
      beforeInject: [],
    });
  });

  it('take the acts ahead of the subscriptions as a condition only past 4 KiB: 4096 bytes is context, 4097 a condition', () => {
    const at4096 = m(82.13, 'wrote 3 act message(s), 4096 bytes, ahead of the subscriptions');
    const at4097 = m(82.14, 'wrote 3 act message(s), 4097 bytes, ahead of the subscriptions');
    expect(conditionsOf(passing('direct'), at4096, at4097)).toEqual({
      conditions: ['+140 ms wrote 3 act message(s), 4097 bytes, ahead of the subscriptions'],
      otherLane: [],
      windowContext: ['+130 ms wrote 3 act message(s), 4096 bytes, ahead of the subscriptions'],
      beforeInject: [],
    });
  });
});

describe('the feed’s last page', () => {
  it('is in once its line is at or after the hub’s restore', () => {
    const input = passing('direct');
    expect(lastPageIn(input.main, input.hubRestoredAt)).toBe(true);
    expect(lastPageIn(without(input.main, '[org-feed] listings'), input.hubRestoredAt)).toBe(false);
    expect(lastPageIn(input.main, at(85))).toBe(false);
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

// Decision Log 37: the inject waits until B is past its resume window, the state an hour asleep leaves B in
describe('the wait past B’s resume window', () => {
  // The endpoint module is reached only through its entries (eslint's no-restricted-imports), which export neither
  // constant, so each is read from its declaration in the source
  const declared = (file: string, pattern: RegExp): number[] => {
    const match = pattern.exec(readFileSync(resolve(__dirname, '../../src/endpoint', file), 'utf8'));
    expect(match, `src/endpoint/${file} declares ${pattern.source}`).not.toBeNull();
    return match!.slice(1).map((n) => Number(n.replaceAll('_', '')));
  };

  it('is B’s latest close of the silent channel, its resume window and a margin, from the endpoint’s own constants', () => {
    const [pingMin, pingMax] = declared('channels.ts', /^export const PING_MS: readonly \[number, number\] = \[([\d_]+), ([\d_]+)\];$/m);
    const [resumeMs] = declared('interest.ts', /^export const RESUME_MS = ([\d_]+);$/m);
    expect(PING_MS, 'B’s endpoint’s ping period').toEqual([pingMin, pingMax]);
    expect(RESUME_MS, 'B’s resume window').toBe(resumeMs);
    // the period running at the stall may have heard A just before it; three silent ones after it close the channel
    expect(CHANNEL_CLOSED_WITHIN_MS).toBe(4 * pingMax);
    expect(PAST_RESUME_MARGIN_MS).toBe(10_000);
    expect(INJECT_AFTER_STALL_MS).toBe(4 * pingMax + resumeMs + 10_000);
    expect(INJECT_AFTER_STALL_MS).toBe(158_000);
  });
});

describe('B’s own lines', () => {
  // the stall at 10 s, the restore at 82 s
  const withB = (input: WakeInput): WakeInput => ({
    ...input,
    endpoint: [
      line(8, 'idle: collected in 30 ms, heap 40.0 to 30.0 MiB (used 31.0 to 29.0)'),
      ...input.endpoint,
      line(40, 'idle: collected in 25 ms, heap 43.9 to 28.0 MiB (used 32.6 to 27.2)'),
      line(41, '[spine] something else'),
      line(42, '[endpoint] endpoint: a stream on channel k1 could not be opened: gone'),
    ],
    host: [...input.host, line(45, '[supervisor] idle: collected in 12 ms, heap 20.0 to 18.0 MiB (used 15.0 to 14.0)'), line(46, '[supervisor] quiet'), line(70, 'warn: [engine-host] session.events app-1 after 309: from the journal, 6900 rows read in 19 ms')],
  });

  it('are kept from the stall on, both logs in time order, with their times from the restore: the idle collections, the endpoint’s sub lines and the journal reads', () => {
    const { record } = readWake(withB(passing('direct')));
    const feeds = FEEDS.map((what) => ({ ms: 200, log: 'mawsd', kind: 'sub', text: `[endpoint] endpoint: channel k2 sub ${IDS[what]} ${what}: subbed snapshot at e:2:-, asked from none, after 0 ms` }));
    expect(record.bLines).toEqual([
      { ms: -42_000, log: 'mawsd', kind: 'idle-collected', text: 'idle: collected in 25 ms, heap 43.9 to 28.0 MiB (used 32.6 to 27.2)' },
      { ms: -37_000, log: 'host', kind: 'idle-collected', text: '[supervisor] idle: collected in 12 ms, heap 20.0 to 18.0 MiB (used 15.0 to 14.0)' },
      { ms: -12_000, log: 'host', kind: 'journal', text: 'warn: [engine-host] session.events app-1 after 309: from the journal, 6900 rows read in 19 ms' },
      ...feeds,
      { ms: 230, log: 'host', kind: 'journal', text: 'warn: [engine-host] session.events app-1 after 309: from the journal, 6900 rows read in 20 ms' },
      { ms: 240, log: 'mawsd', kind: 'sub', text: '[endpoint] endpoint: channel k2 sub s1 session B:app-1: subbed replay at L1:310:4, asked from L1:310:4, after 21 ms' },
      { ms: 270, log: 'host', kind: 'journal', text: 'warn: [engine-host] session.events app-2 after 311: from the journal, 6950 rows read in 30 ms' },
      { ms: 290, log: 'mawsd', kind: 'sub', text: '[endpoint] endpoint: channel k2 sub s2 session B:app-2: subbed replay at L2:312:2, asked from L2:312:2, after 33 ms' },
    ]);
  });

  it('are context, never a failure', () => {
    expect(failuresOf(withB(passing('relay')))).toEqual([]);
  });

  it('give each stream its J, its own journal read’s ms and the remainder, J less that read', () => {
    expect(readWake(passing('direct')).record.streams).toEqual([
      { app: 'app-1', id: 's1', jMs: 21, journalMs: 20, remainderMs: 1 },
      { app: 'app-2', id: 's2', jMs: 33, journalMs: 30, remainderMs: 3 },
    ]);
    const input = passing('direct');
    const { record } = readWake({ ...input, host: without(input.host, 'app-2 after 311'), endpoint: without(input.endpoint, 'sub s1 session') });
    expect(record.streams).toEqual([
      { app: 'app-1', id: 's1', jMs: null, journalMs: 20, remainderMs: null },
      { app: 'app-2', id: 's2', jMs: 33, journalMs: null, remainderMs: null },
    ]);
  });

  it('are summed up in one line per carrier: the stall, the wait, the settle, the idle collections before the restore and each stream’s J/journal/remainder', () => {
    const { record } = readWake(withB(passing('direct')));
    expect(wakeTimingSummary(record, { resumeWaitMs: 93_000, settleMs: 60_002 })).toBe(
      "[remote-wake] direct: stalled 72000 ms: waited 93000 ms until 158000 ms after the stall, settled in 60002 ms, restored 2000 ms after the inject; idle collections before the restore: 1 on mawsd, 1 on the engine host; each stream's J/journal/remainder: app-1 21/20/1 ms, app-2 33/30/3 ms",
    );
    const bare = readWake({ ...passing('relay'), host: [] }).record;
    expect(wakeTimingSummary(bare, { resumeWaitMs: 0, settleMs: 30_001 })).toBe(
      "[remote-wake] relay: stalled 72000 ms: waited 0 ms until 158000 ms after the stall, settled in 30001 ms, restored 2000 ms after the inject; idle collections before the restore: 0 on mawsd, 0 on the engine host; each stream's J/journal/remainder: app-1 21/none/none, app-2 33/none/none",
    );
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
  it('reads Rule B over the 30 s samples and the end, as context only', () => {
    expect(ruleBContext([1, 2, 3], 2)).toEqual([]);
    expect(ruleBContext([6, 6, 6], null)).toEqual(["the machine's load: peak 6 at or over 5, 30 s pair 6 at or over 4.7 (Rule B)"]);
  });
});

// Decision Log 33 (c) and (d), Decision Log 31 (d): void by a window's load, outside §F's conditions, or a verdict
describe('the verdict', () => {
  const direct = readWake(passing('direct')).record;
  const relay = readWake(passing('relay')).record;
  const quiet = (...at: LoadRead['at'][]): LoadRead[] => at.map((instant) => ({ at: instant, load: 3.1 }));
  const loads = { direct: quiet('inject', 'last subbed', "hub's restore", 'last page'), relay: quiet('inject', 'last subbed', 'last page') };
  const late = (record: WakeRecord, conditions: string[] = []): WakeRecord => ({ ...record, upMs: 1_200, conditions });

  it('is a pass for a run within its bounds at a quiet load', () => {
    expect(wakeVerdict([direct, relay], loads, [])).toEqual({ void: false, outside: false, pass: true, voidReasons: [], boundMisses: [], outsideMisses: [], outsideConditions: [] });
  });

  it('voids the run on any window read of 5 or more, naming every read of that carrier; no verdict, though a bound was missed', () => {
    expect(VOID_LOAD).toBe(5);
    const verdict = wakeVerdict([late(direct), relay], { ...loads, relay: [{ at: 'inject', load: 4.99 }, { at: 'last subbed', load: 5 }, { at: 'last page', load: 5.31 }] }, []);
    expect(verdict).toMatchObject({ void: true, outside: false, pass: null, boundMisses: ['direct: the link up 1200 ms after the restore, over 1000 ms'] });
    expect(verdict.voidReasons).toEqual(["relay: the 1-minute load read 5 or more after the last subbed and after the feed's last page (4.99 at the inject, 5.00 after the last subbed, 5.31 after the feed's last page)"]);
    expect(wakeVerdict([direct, relay], { ...loads, direct: [{ at: "hub's restore", load: 7.2 }] }, []).voidReasons).toEqual(["direct: the 1-minute load read 5 or more at the hub's restore (7.20 at the hub's restore)"]);
  });

  it('voids the run on the read after the final reading, where the evidence the verdict takes is fixed', () => {
    const verdict = wakeVerdict([direct, relay], { ...loads, relay: [...loads.relay, { at: 'final', load: 5.4 }] }, []);
    expect(verdict).toMatchObject({ void: true, pass: null });
    expect(verdict.voidReasons).toEqual(["relay: the 1-minute load read 5 or more after the final reading (3.10 at the inject, 3.10 after the last subbed, 3.10 after the feed's last page, 5.40 after the final reading)"]);
  });

  it('fails a miss with no condition as a miss', () => {
    expect(wakeVerdict([late(direct), relay], loads, [])).toEqual({ void: false, outside: false, pass: false, voidReasons: [], boundMisses: ['direct: the link up 1200 ms after the restore, over 1000 ms'], outsideMisses: [], outsideConditions: [] });
  });

  it('fails a plain miss with each stream’s J beside it, and no label for a large one', () => {
    const slow: WakeRecord = { ...late(direct), streams: direct.streams.map((s) => (s.app === 'app-2' ? { ...s, jMs: 1_360 } : s)) };
    expect(boundMissMessage([slow, { ...relay, streams: relay.streams.map((s) => ({ ...s, jMs: null })) }])).toBe(
      "every subscription within 1 s of the restore and the feed within 2 s of the hub’s, per carrier; each stream's J: direct app-1 21 ms, app-2 1360 ms; relay app-1 none, app-2 none",
    );
    expect(wakeVerdict([slow, relay], loads, [])).toMatchObject({ pass: false, outside: false, boundMisses: ['direct: the link up 1200 ms after the restore, over 1000 ms'] });
  });

  it('labels a miss on a carrier whose conditions are not empty as outside §F’s conditions: neither a breach nor a pass', () => {
    const conditions = ['+150 ms attempt failed (relay): no handshake within 2000 ms; next in 100 ms'];
    expect(wakeVerdict([direct, late(relay, conditions)], loads, [])).toEqual({
      void: false,
      outside: true,
      pass: null,
      voidReasons: [],
      boundMisses: [],
      outsideMisses: ['relay: the link up 1200 ms after the restore, over 1000 ms'],
      outsideConditions: ['relay: +150 ms attempt failed (relay): no handshake within 2000 ms; next in 100 ms'],
    });
    // conditions with no miss change nothing; a plain miss beside an outside one is still a fail
    expect(wakeVerdict([direct, { ...relay, conditions }], loads, [])).toMatchObject({ outside: false, pass: true, outsideConditions: [] });
    expect(wakeVerdict([late(direct), late(relay, conditions)], loads, [])).toMatchObject({ outside: true, pass: false });
  });

  it('is no pass while a line or count is missing', () => {
    expect(wakeVerdict([direct], loads, ['relay: main.log, B’s logs or the pipes could not be read: ENOENT'])).toMatchObject({ void: false, pass: false });
  });
});
