// The endpoint acceptance run's verdicts (deploy/endpoint-verdicts.ts; P5 O10 M11): acceptance 2's lane A rule over a
// subscription followed across its resumes, the per-item report, and the secrets kept out of every printed line.
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ItemReport, laneAProblems, resumeCursor, rowUuid, Secrets, type PlaneMessage, type Segment } from '../../deploy/endpoint-verdicts.ts';

const row = (sub: string | null, n: number | null, uuid: string): PlaneMessage => ({ kind: 'row', sub, n, body: { row: { uuid, type: 'assistant' }, agentId: null } });
const snap = (rows: string[]): PlaneMessage => ({ kind: 'snapshot', sub: 'E1', n: 0, body: { rows: rows.map((uuid) => ({ uuid })), more: false } });

/** A first subscription under epoch `epoch`: its snapshot at seq 0 holding `before`, then rows numbered on. */
function first(epoch: string, before: string[], rows: string[]): Segment {
  return {
    after: 'first',
    cursor: null,
    expect: 'snapshot',
    subbed: { mode: 'snapshot', epoch, seq: 0 },
    snapshot: { epoch, seq: 0, message: { ...snap(before), sub: epoch } },
    events: rows.map((uuid, i) => ({ epoch, seq: i + 1, message: row(epoch, i + 1, uuid) })),
  };
}

/** A replay after `prev`, continuing its epoch's numbering with `rows`. */
function replay(prev: Segment, after: string, rows: string[], { seqFrom, nFrom }: { seqFrom?: number; nFrom?: number } = {}): Segment {
  const cursor = resumeCursor(prev)!;
  const s = seqFrom ?? cursor.seq + 1;
  const lastN = [...prev.events].reverse().find((e) => typeof e.message.n === 'number')?.message.n as number | undefined;
  const n = nFrom ?? (lastN ?? 0) + 1;
  return {
    after,
    cursor,
    expect: 'replay',
    subbed: { mode: 'replay', epoch: cursor.epoch, seq: cursor.seq },
    snapshot: null,
    events: rows.map((uuid, i) => ({ epoch: cursor.epoch, seq: s + i, message: row(cursor.epoch, n + i, uuid) })),
  };
}

describe('acceptance 2, lane A: a subscription followed across its resumes', () => {
  it('passes a replay that resumes exactly after the cursor, and a snapshot after a restart that holds every row', () => {
    const a = first('E1', ['r0'], ['r1', 'r2']);
    const b = replay(a, 'the hub socket cut', ['r3', 'r4']);
    const c: Segment = {
      after: 'mawsd restart',
      cursor: resumeCursor(b),
      expect: 'snapshot',
      subbed: { mode: 'snapshot', epoch: 'E2', seq: 0 },
      snapshot: { epoch: 'E2', seq: 0, message: { ...snap(['r4', 'r3', 'r2', 'r1', 'r0']), sub: 'E2' } },
      events: [{ epoch: 'E2', seq: 1, message: row('E2', 1, 'r5') }],
    };
    expect(laneAProblems([a, b, c], ['r1', 'r2', 'r3', 'r4', 'r5'])).toEqual([]);
  });

  it('names a lost event by the endpoint’s seq and by sminos’s n', () => {
    const a = first('E1', [], ['r1', 'r2']);
    const b = replay(a, 'the hub deploy', ['r4'], { seqFrom: 4, nFrom: 4 });
    expect(laneAProblems([a, b], ['r1', 'r2', 'r4'])).toEqual(['after the hub deploy: seq 4 where 3 was next (1 lost)', "after the hub deploy: sminos's n 4 where 3 was next"]);
  });

  it('names an event delivered twice, and the row it repeats', () => {
    const a = first('E1', [], ['r1', 'r2']);
    const b = replay(a, 'the hub socket cut', ['r2', 'r3'], { seqFrom: 2, nFrom: 2 });
    expect(laneAProblems([a, b], ['r1', 'r2', 'r3'])).toEqual([
      'after the hub socket cut: seq 2 where 3 was next (a repeat)',
      "after the hub socket cut: sminos's n 2 where 3 was next",
      'after the hub socket cut: the row r2 came twice in epoch E1',
    ]);
  });

  it('refuses a snapshot where a replay was the design’s answer, and a replay under another epoch', () => {
    const a = first('E1', [], ['r1']);
    const snapInstead: Segment = { ...first('E9', ['r1'], []), after: 'the hub socket cut', cursor: resumeCursor(a), expect: 'replay' };
    expect(laneAProblems([a, snapInstead], ['r1'])).toEqual(['after the hub socket cut: answered snapshot, expected replay']);
    const wrongEpoch: Segment = { ...replay(a, 'the hub socket cut', []), subbed: { mode: 'replay', epoch: 'E7', seq: 1 } };
    expect(laneAProblems([a, wrongEpoch], ['r1'])[0]).toMatch(/a replay under epoch E7, not the cursor's E1/);
  });

  it('counts a produced row no epoch held as lost', () => {
    const a = first('E1', [], ['r1']);
    expect(laneAProblems([a], ['r1', 'r2'])).toEqual(['1 of the 2 rows the session wrote reached no answer of the subscription (first: r2)']);
  });

  it('takes a restart’s snapshot of the newest rows alone, but not a hole after its oldest', () => {
    const a = first('E1', [], ['r1', 'r2', 'r3']);
    // After a restart sminos's snapshot pages the newest rows only (`more`): r1 lives in the first epoch alone.
    const tail: Segment = { ...first('E2', ['r4', 'r3', 'r2'], ['r5']), after: 'mawsd restart', cursor: resumeCursor(a) };
    expect(laneAProblems([a, tail], ['r1', 'r2', 'r3', 'r4', 'r5'])).toEqual([]);
    const holed: Segment = { ...first('E2', ['r4', 'r2'], ['r5']), after: 'mawsd restart', cursor: resumeCursor(a) };
    expect(laneAProblems([a, holed], ['r1', 'r2', 'r3', 'r4', 'r5'])).toEqual(['the latest epoch, E2, lacks 1 row the session wrote after its oldest (first: r3)']);
  });

  it('ignores session-wide messages in sminos’s numbering, while the endpoint numbers them', () => {
    const a = first('E1', [], ['r1']);
    a.events.push({ epoch: 'E1', seq: 2, message: { kind: 'presence', sub: null, n: null, body: {} } });
    a.events.push({ epoch: 'E1', seq: 3, message: row('E1', 2, 'r2') });
    expect(laneAProblems([a], ['r1', 'r2'])).toEqual([]);
  });

  it('fails an unanswered subscription, and no subscription at all', () => {
    expect(laneAProblems([], [])).toEqual(['no subscription was made']);
    const a = first('E1', [], ['r1']);
    expect(laneAProblems([a, { ...replay(a, 'mawsd restart', []), subbed: null }], ['r1'])).toEqual(['after mawsd restart: the subscription was not answered']);
  });

  it('reads a row’s uuid from a `row` message alone', () => {
    expect(rowUuid(row('E1', 1, 'u1'))).toBe('u1');
    expect(rowUuid({ kind: 'presence', body: { row: { uuid: 'u1' } } })).toBeNull();
    expect(rowUuid({ kind: 'row', body: { row: { uuid: '' } } })).toBeNull();
  });
});

describe('the report', () => {
  it('passes an item whose every check passed, and names its outstanding clauses under it', async () => {
    const lines: string[] = [];
    const report = new ItemReport(['2', '3'], (l) => lines.push(l));
    await report.check('2', 'lane A over the relay', async () => 'no event lost or doubled');
    await report.check('3', 'a replayed frame', async () => {
      throw new Error('the action ran twice');
    });
    report.outstanding('2', "lane B's live half waits for O3");
    expect(report.summary()).toBe(false);
    expect(lines).toEqual([
      'ok   2 lane A over the relay: no event lost or doubled',
      'FAIL 3 a replayed frame: the action ran twice',
      'PASS 2',
      "  outstanding: lane B's live half waits for O3",
      'FAIL 3',
    ]);
  });

  it('says NOT SHOWN for an item with a check that could not run here, and FAIL for one with no check', async () => {
    const lines: string[] = [];
    const report = new ItemReport(['2', '5'], (l) => lines.push(l));
    await report.check('2', 'the hub deploy', async () => ({ skip: 'no deploy in this scene' }));
    await report.check('2', 'the hub socket cut', async () => 'replayed');
    expect(report.summary()).toBe(false);
    expect(lines.slice(-2)).toEqual(['NOT SHOWN 2: the hub deploy (no deploy in this scene)', 'FAIL 5: nothing was checked']);
  });

  it('starts no check once the run is interrupted', async () => {
    const stop = new AbortController();
    const report = new ItemReport(['2'], () => {}, stop.signal);
    stop.abort(new Error('interrupted by SIGINT'));
    await expect(report.check('2', 'x', async () => 'y')).rejects.toThrow('interrupted by SIGINT');
  });
});

describe('secrets', () => {
  it('scrubs every secret the run handled out of a printed line, and lists each for the runner’s search', () => {
    const list = join(mkdtempSync(join(tmpdir(), 'ep-secrets-')), 'scan');
    const secrets = new Secrets(list);
    const code = 'smns-enroll-v2.' + 'A'.repeat(60);
    secrets.add(code);
    secrets.add('short');
    secrets.add(undefined);
    secrets.add(code);
    const printed: string[] = [];
    secrets.guard((l) => printed.push(l))(`enroll failed: ${code} refused`);
    expect(printed).toEqual(['enroll failed: <secret> refused']);
    expect(readFileSync(list, 'utf8')).toBe(`${code}\n`);
    expect(statSync(list).mode & 0o777).toBe(0o600);
  });
});
