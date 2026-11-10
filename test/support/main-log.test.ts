// The gate case's reading of the logs (test/support/main-log.ts): a line's time and text, a log's two generations, and
// each line the case reads in the form its writer gives it (src/main/machines/remote/link.ts and subs.ts, the wake source,
// the org feed, src/endpoint/subscriptions.ts through mawsd's `[endpoint]` prefix, the engine host's stream through its
// routed console's `warn: [engine-host]`; Decision Log 19).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { caseLineOf, parseLogLine, parseLogText, positionOf, readLogLines } from './main-log';

const REF = 'Bref0123456789abcdef';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('a log line', () => {
  it('is its time and its text', () => {
    expect(parseLogLine('2026-11-10T08:00:01.250Z [wake] slept 3600000 ms (clock)')).toEqual({ at: Date.parse('2026-11-10T08:00:01.250Z'), text: '[wake] slept 3600000 ms (clock)' });
    expect(parseLogLine('2026-11-10T08:00:01.250Z ')).toEqual({ at: Date.parse('2026-11-10T08:00:01.250Z'), text: '' });
  });

  it('is nothing without a time first', () => {
    expect(parseLogLine('[wake] slept 3600000 ms (clock)')).toBeNull();
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('2026-11-10 08:00:01 text')).toBeNull();
  });

  it('a text keeps the lines that have a time and leaves out the rest', () => {
    expect(parseLogText('2026-11-10T08:00:00.000Z a\nstray output\n2026-11-10T08:00:00.001Z b\n').map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('a log is read with its previous generation first, and a missing one is none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'main-log-'));
    dirs.push(dir);
    const path = join(dir, 'main.log');
    expect(readLogLines(path)).toEqual([]);
    writeFileSync(`${path}.1`, '2026-11-10T08:00:00.000Z older\n');
    writeFileSync(path, '2026-11-10T08:00:01.000Z newer\n');
    expect(readLogLines(path).map((l) => l.text)).toEqual(['older', 'newer']);
  });
});

describe('a position', () => {
  it('is its epoch, its seq and its idx', () => {
    expect(positionOf('L-1:120:3')).toEqual({ epoch: 'L-1', seq: 120, idx: 3 });
    expect(positionOf('L-1:120:-')).toEqual({ epoch: 'L-1', seq: 120, idx: null });
    expect(positionOf('none')).toBeNull();
    expect(positionOf('garbled')).toBeNull();
  });
});

describe('the lines the case reads', () => {
  const cases: [string, unknown][] = [
    ['[wake] slept 3600000 ms (clock)', { kind: 'wake', sleptMs: 3_600_000, source: 'clock' }],
    ['[reach] window open for 60 s (wake)', { kind: 'reach-window', reason: 'wake' }],
    [`[machines] ${REF}: wake after 3600000 ms: dropped no channel, 1 attempt(s) in flight`, { kind: 'link-wake', ref: REF, sleptMs: 3_600_000, dropped: 'no channel, 1 attempt(s) in flight' }],
    [`[machines] ${REF}: up over the relay carrier`, { kind: 'up', ref: REF, carrier: 'relay' }],
    [`[machines] ${REF}: up over the direct carrier (within the grace)`, { kind: 'up', ref: REF, carrier: 'direct' }],
    [`[machines] ${REF}: the direct channel was lost (timeout); reconnecting`, { kind: 'lost', ref: REF, carrier: 'direct', reason: 'timeout' }],
    [`[machines] ${REF}: subscription AbC_9-x session B:app-1: subbed replay at L1:6800:2, asked from L1:310:-`, { kind: 'subbed', ref: REF, id: 'AbC_9-x', what: 'session B:app-1', mode: 'replay', position: 'L1:6800:2', asked: 'L1:310:-' }],
    [`[machines] ${REF}: subscription q1 feed checkout B:app-1: subbed snapshot at e:4:-, asked from none`, { kind: 'subbed', ref: REF, id: 'q1', what: 'feed checkout B:app-1', mode: 'snapshot', position: 'e:4:-', asked: 'none' }],
    [`[machines] ${REF}: subscription q2 feed attention: subbed missing at e:0:-, asked from none`, { kind: 'subbed', ref: REF, id: 'q2', what: 'feed attention', mode: 'missing', position: 'e:0:-', asked: 'none' }],
    [`[machines] ${REF}: subscription q1 session B:app-1: first event after subbed, at L1:311:0`, { kind: 'first', ref: REF, id: 'q1', what: 'session B:app-1', delivery: 'event', position: 'L1:311:0' }],
    [`[machines] ${REF}: subscription q1: dropped a repeated event at L1:300:1`, { kind: 'repeated', ref: REF, id: 'q1', position: 'L1:300:1' }],
    [`[machines] ${REF}: attempt failed (direct): no handshake within 2000 ms; next in 100 ms`, { kind: 'attempt-failed', ref: REF, which: 'direct', why: 'no handshake within 2000 ms; next in 100 ms' }],
    [`[machines] ${REF}: lane direct: spent (6 attempts)`, { kind: 'lane-spent', ref: REF, lane: 'direct', why: '6 attempts' }],
    [`[machines] ${REF}: floor after 10000 ms: today's attempts from here (10 s without a channel)`, { kind: 'floor', ref: REF, afterMs: 10_000, why: '10 s without a channel' }],
    [`[machines] ${REF}: attempt (relay): catch-up, dial 2`, { kind: 'catch-up', ref: REF, which: 'relay', dial: 2 }],
    [`[machines] ${REF}: wrote 2 act message(s), 830 bytes, ahead of the subscriptions`, { kind: 'acts-ahead', ref: REF, messages: 2, bytes: 830 }],
    ['[org-feed] wake after 3600000 ms: dropped the socket', { kind: 'feed-wake', sleptMs: 3_600_000, what: 'dropped the socket' }],
    ['[org-feed] connected to 127.0.0.1:52011', { kind: 'feed-connected', host: '127.0.0.1:52011' }],
    ['[org-feed] listings: last page, 3 records in 1 pages', { kind: 'feed-last-page', records: 3, pages: 1 }],
    ['[endpoint] endpoint: channel k7 sub AbC_9-x session B:app-1: subbed replay at L1:6800:2, asked from L1:310:-, after 41 ms', { kind: 'endpoint-subbed', channel: 'k7', id: 'AbC_9-x', what: 'session B:app-1', mode: 'replay', position: 'L1:6800:2', asked: 'L1:310:-', ms: 41 }],
    ['endpoint: channel k7 sub q2 feed attention: subbed snapshot at e:1:-, asked from none, after 0 ms', { kind: 'endpoint-subbed', channel: 'k7', id: 'q2', what: 'feed attention', mode: 'snapshot', position: 'e:1:-', asked: 'none', ms: 0 }],
    ['warn: [engine-host] session.events app-1 after 310: from the journal, 6810 rows read in 23 ms', { kind: 'journal', app: 'app-1', after: 310, rows: 6_810, ms: 23 }],
    ['session.events app-1 after start: from the journal, 12 rows read in 1 ms, from the checkpoint at seq 9', { kind: 'journal', app: 'app-1', after: null, rows: 12, ms: 1 }],
  ];
  it.each(cases)('%s', (text, line) => {
    expect(caseLineOf(text)).toEqual(line);
  });

  it('reads nothing else', () => {
    for (const text of [
      '[main] build e2e (pid 1)',
      `[machines] ${REF}: probe network: seeking`,
      '[org-feed] the open had no answer within 2000 ms',
      'warn: [engine-host] ring evicted app-1 launch L1: events through seq 1001 are the journal\'s now',
      `[machines] ${REF}: subscription q1 session B:app-1: subbed replay at L1:1:-`, // no asked cursor: not the line
    ]) expect(caseLineOf(text), text).toBeNull();
  });
});
