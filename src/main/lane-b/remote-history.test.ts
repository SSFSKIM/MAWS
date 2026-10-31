// A remote session's `session.events` read in pages the channel carries (P5 O7 M2, the milestone review's P2): one call
// when the answer fits; else the launch read on from its start in pages of whole rows, a page the endpoint refuses
// `too-large` halved, a row that alone can't cross left out with its place told as a gap, and a window the inputs can't
// page answered as history unavailable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { FakeLink } from '../../../test/lane-b/fake-link';
import { readEventsInPages } from './remote-history';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const APP = 'app-1';
const event = (seq: number, idx = 0, text = `${seq}.${idx}`, withSeq = true): SessionEvent =>
  ({ id: `${APP}:L1:${seq}:${idx}`, sessionId: 'eng-1', at: '2026-10-31T00:00:00.000Z', seq: withSeq ? seq : null, agentId: null, parentToolUseId: null, kind: 'notice.posted', level: 'info', text, key: null }) as unknown as SessionEvent;

/** A machine whose journal holds `rows`, answering `session.events` as the engine host does, and `too-large` past `max` bytes. */
function machine(rows: SessionEvent[][], max = 4000) {
  const link = new FakeLink();
  const asked: Array<{ afterSeq: number | null; limit: number | null }> = [];
  link.answers.set('session.events', (input) => {
    const afterSeq = input.afterSeq as number | null;
    const limit = input.limit as number | null;
    asked.push({ afterSeq, limit });
    const after = rows.filter((row) => afterSeq === null || row[0].seq! > afterSeq);
    let taken = after;
    if (limit !== null) {
      let count = 0;
      let end = 0;
      while (end < after.length && (end === 0 || count + after[end].length <= limit)) count += after[end++].length;
      taken = after.slice(0, end);
    }
    const events = taken.flat();
    const output = { events, lastSeq: taken.at(-1)?.[0].seq ?? afterSeq ?? 0, complete: taken.length === after.length };
    if (JSON.stringify(output).length > max) return { ok: false, error: { code: 'too-large' } };
    return { ok: true, output };
  });
  return { link, asked };
}

const read = (link: FakeLink, gaps: Array<{ launchId: string; at: { seq: number } }> = [], input: Record<string, unknown> = { appSessionId: APP, afterSeq: null, limit: null }, tooLarge: string[] = []) =>
  readEventsInPages(link, input, { launch: () => 'L1', gap: (launchId, at) => void gaps.push({ launchId, at }), tooLarge: (window) => void tooLarge.push(window), log: () => {}, pageEvents: 8 });

describe('readEventsInPages', () => {
  it('answers with one call when the whole answer fits the channel', async () => {
    const rows = [[event(1)], [event(2), event(2, 1)]];
    const { link, asked } = machine(rows);
    expect(await read(link)).toEqual({ ok: true, value: { events: rows.flat(), lastSeq: 2, complete: true } });
    expect(asked).toEqual([{ afterSeq: null, limit: null }]);
  });

  it('reads a launch too large for one answer in pages from its start, halving a page the endpoint refuses, and assembles one answer', async () => {
    const big = 'x'.repeat(700);
    const rows = Array.from({ length: 12 }, (_, i) => [event(i + 1, 0, big)]);
    const { link, asked } = machine(rows);
    const answer = await read(link);
    expect(answer).toEqual({ ok: true, value: { events: rows.flat(), lastSeq: 12, complete: true } });
    expect(asked[0]).toEqual({ afterSeq: null, limit: null });
    expect(asked[1]).toEqual({ afterSeq: null, limit: 8 }); // refused: halved
    expect(asked[2]).toEqual({ afterSeq: null, limit: 4 });
    expect(asked.slice(3).every((a) => a.limit !== null && a.limit <= 8)).toBe(true);
  });

  it('leaves out a row that alone can’t cross the channel, telling its place as a gap, and reads on after it', async () => {
    const rows = [[event(1)], [event(2, 0, 'y'.repeat(5000))], [event(3)]];
    const { link } = machine(rows);
    const gaps: Array<{ launchId: string; at: { seq: number } }> = [];
    expect(await read(link, gaps)).toEqual({ ok: true, value: { events: [event(1), event(3)], lastSeq: 3, complete: true } });
    expect(gaps).toEqual([{ launchId: 'L1', at: { seq: 2 } }]);
  });

  it('answers a window the inputs can’t page (an older page, a transcript read from disk) as history unavailable', async () => {
    const link = new FakeLink();
    link.answers.set('session.events', (input) => (input.limit === null ? { ok: false, error: { code: 'too-large' } } : { ok: true, output: { events: [event(1, 0, 'disk', false)], lastSeq: 0, complete: true } }));
    const unavailable = { ok: true, value: { events: [], lastSeq: 0, complete: true, historyUnavailable: true } };
    // and says why first (P5 O7 M2's milestone review): the renderer's bar tells the person what to do, until M4 pages these
    const said: string[] = [];
    expect(await read(link, [], { appSessionId: APP, afterSeq: null, limit: null, before: `${APP}:L1:9:0` }, said)).toEqual(unavailable);
    expect(said).toEqual(['older']);
    expect(await read(link, [], undefined, said)).toEqual(unavailable); // a disk page carries no seq: no read after it
    expect(said).toEqual(['older', 'newest']);
  });

  it('passes any other refusal on as the read’s', async () => {
    const link = new FakeLink();
    link.answers.set('session.events', () => ({ ok: false, error: { code: 'offline' } }));
    expect(await read(link)).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
  });
});

// P5 O7 M4 (acceptance 12; `rl2.events-budget`): with the machine's endpoint listing the byte budget, every window is read
// within it: a transcript window as one budgeted page with its cursor to what precedes it, a live launch in budgeted pages,
// and an item alone past the budget left out with its place said. Without the capability nothing carries the field.
describe('readEventsInPages within a byte budget', () => {
  const disk = (n: number, text = 'd'.repeat(300)) => Array.from({ length: n }, (_, i) => ({ ...event(i + 1, 0, text, false), id: `${APP}:disk:${i + 1}` }) as unknown as SessionEvent);
  const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

  /** The engine host's two readers under a budget: the transcript's windows (newest, or before a cursor) and the live stream's pages. */
  function budgeted(source: { transcript?: SessionEvent[]; rows?: SessionEvent[][] }) {
    const link = new FakeLink();
    link.peers = ['rl2.executor.machine', 'rl2.events-budget'];
    const asked: Array<Record<string, unknown>> = [];
    link.answers.set('session.events', (input) => {
      asked.push(input);
      const maxBytes = input.maxBytes as number | undefined;
      if (maxBytes === undefined) return { ok: false, error: { code: 'too-large' } };
      const bound = maxBytes - 256;
      if (source.transcript !== undefined) {
        const all = source.transcript;
        const end = input.before === undefined ? all.length : all.findIndex((e) => e.id === input.before);
        let start = end;
        while (start > 0 && size(all.slice(start - 1, end)) <= bound) start--;
        if (start === end && end > 0) return { ok: true, output: { events: [], lastSeq: 0, complete: true, earlier: all[end - 1].id, omitted: { events: 1, bytes: size(all[end - 1]), seq: null } } };
        return { ok: true, output: { events: all.slice(start, end), lastSeq: 0, complete: true, ...(start > 0 && { earlier: all[start].id }) } };
      }
      const rows = source.rows!.filter((row) => input.afterSeq === null || row[0].seq! > (input.afterSeq as number));
      const taken: SessionEvent[][] = [];
      for (const row of rows) {
        if (size([...taken.flat(), ...row]) > bound) {
          if (taken.length === 0) return { ok: true, output: { events: [], lastSeq: row[0].seq, complete: false, omitted: { events: row.length, bytes: size(row), seq: row[0].seq } } };
          break;
        }
        taken.push(row);
      }
      return { ok: true, output: { events: taken.flat(), lastSeq: taken.at(-1)?.[0].seq ?? (input.afterSeq as number | null) ?? 0, complete: taken.length === rows.length } };
    });
    return { link, asked, answer: link.answers.get('session.events')! };
  }

  const within = (link: FakeLink, input: Record<string, unknown>, said: { gaps: unknown[]; tooLarge: string[] } = { gaps: [], tooLarge: [] }, budget = true) =>
    readEventsInPages(link, input, { launch: () => 'L1', gap: (launchId, at) => void said.gaps.push({ launchId, at }), tooLarge: (window) => void said.tooLarge.push(window), log: () => {}, budget, pageBytes: 4096 });

  it('answers a parked session’s newest window as its newest rows within the budget, with the cursor that reaches the rest, never the bar', async () => {
    const transcript = disk(30);
    const { link, asked } = budgeted({ transcript });
    const said = { gaps: [] as unknown[], tooLarge: [] as string[] };
    const newest = await within(link, { appSessionId: APP, afterSeq: null, limit: null }, said);
    expect(newest.ok).toBe(true);
    const page = (newest as { value: { events: SessionEvent[]; earlier?: string; historyUnavailable?: true } }).value;
    expect(page.events.length).toBeGreaterThan(0);
    expect(page.events.at(-1)!.id).toBe(transcript.at(-1)!.id);
    expect(page.earlier).toBe(page.events[0].id);
    expect(page.historyUnavailable).toBeUndefined();
    // the older page, by that cursor, within the budget too
    const older = (await within(link, { appSessionId: APP, afterSeq: null, limit: null, before: page.earlier }, said)) as { ok: true; value: { events: SessionEvent[] } };
    expect(older.value.events.at(-1)!.id).toBe(transcript[transcript.findIndex((e) => e.id === page.events[0].id) - 1].id);
    expect(asked.every((a) => a.maxBytes === 4096)).toBe(true);
    expect(said).toEqual({ gaps: [], tooLarge: [] });
  });

  it('reads on past a transcript item alone over the budget, answering the rows before it and saying what was left out', async () => {
    const transcript = [...disk(4), { ...event(9, 0, 'z'.repeat(6000), false), id: `${APP}:disk:big` } as unknown as SessionEvent];
    const { link } = budgeted({ transcript });
    const answer = (await within(link, { appSessionId: APP, afterSeq: null, limit: null })) as { ok: true; value: Record<string, unknown> };
    expect(answer.value).toMatchObject({ events: transcript.slice(0, 4), lastSeq: 0, omitted: { events: 1, seq: null } });
    expect(answer.value.earlier).toBeUndefined();
  });

  it('reads a live launch in budgeted pages from its cursor and assembles one answer, a row alone past the budget a gap at its place', async () => {
    const rows = [...Array.from({ length: 10 }, (_, i) => [event(i + 1, 0, 'r'.repeat(900))]), [event(11, 0, 'y'.repeat(6000))], [event(12)]];
    const { link, asked } = budgeted({ rows });
    const said = { gaps: [] as unknown[], tooLarge: [] as string[] };
    const answer = await within(link, { appSessionId: APP, afterSeq: null, limit: null }, said);
    expect(answer).toEqual({ ok: true, value: { events: [...rows.slice(0, 10), rows[11]].flat(), lastSeq: 12, complete: true } });
    expect(said.gaps).toEqual([{ launchId: 'L1', at: { seq: 11 } }]);
    expect(asked.length).toBeGreaterThan(3);
    expect(asked.slice(1).map((a) => a.afterSeq)).toEqual([...asked.slice(1).map((a) => a.afterSeq)].sort((x, y) => (x as number) - (y as number)));
  });

  it('reads again without the budget when the engine host behind the endpoint refuses it (`invalid_input`)', async () => {
    const link = new FakeLink();
    link.peers = ['rl2.events-budget'];
    const asked: Array<Record<string, unknown>> = [];
    link.answers.set('session.events', (input) => {
      asked.push(input);
      if (input.maxBytes !== undefined) return { ok: false, error: { code: 'invalid_input', message: 'Unrecognized key: "maxBytes"' } };
      return { ok: true, output: { events: [event(1)], lastSeq: 1, complete: true } };
    });
    expect(await within(link, { appSessionId: APP, afterSeq: null, limit: null })).toEqual({ ok: true, value: { events: [event(1)], lastSeq: 1, complete: true } });
    expect(asked.map((a) => a.maxBytes)).toEqual([4096, undefined]);
  });

  // Fix wave 1 (finding 1): the budget goes only to the channel whose peer lists it, page by page.
  describe('across a channel to a peer without the budget', () => {
    const rows = [...Array.from({ length: 6 }, (_, i) => [event(i + 1, 0, 'r'.repeat(900))]), [event(7, 0, 'y'.repeat(6000))], [event(8)]];
    /** Budgeted pages from the engine host while the budget is sent; M2's machine (too-large past 4000 bytes) without it. */
    function downgrading(after: 'peer' | 'malformed') {
      const within = budgeted({ rows });
      const whole = machine(rows);
      const asked: Array<Record<string, unknown>> = [];
      const link = within.link;
      link.answers.set('session.events', (input) => {
        asked.push(input);
        if (input.maxBytes === undefined) return whole.link.answers.get('session.events')!(input);
        if (asked.length === 1) {
          if (after === 'peer') link.peers = ['rl2.executor.machine']; // the next channel's peer lacks the budget
          return within.answer(input);
        }
        return { ok: false, error: { code: 'malformed' } }; // a budgeted call carried to a peer that doesn't read the field
      });
      return { link, asked };
    }

    for (const after of ['peer', 'malformed'] as const) {
      it(`starts again on M2’s path when ${after === 'peer' ? 'the next channel’s peer no longer lists it' : 'a budgeted page is refused `malformed`'}, its gaps said once`, async () => {
        const { link, asked } = downgrading(after);
        const said = { gaps: [] as unknown[], tooLarge: [] as string[] };
        const answer = await readEventsInPages(link, { appSessionId: APP, afterSeq: null, limit: null }, { launch: () => 'L1', gap: (launchId, at) => void said.gaps.push({ launchId, at }), tooLarge: (window) => void said.tooLarge.push(window), log: () => {}, budget: true, pageBytes: 4096, pageEvents: 8 });
        expect(answer).toEqual({ ok: true, value: { events: [...rows.slice(0, 6), rows[7]].flat(), lastSeq: 8, complete: true } });
        expect(said.gaps).toEqual([{ launchId: 'L1', at: { seq: 7 } }]);
        const sent = asked.map((a) => a.maxBytes !== undefined);
        expect(sent.slice(after === 'peer' ? 1 : 2).every((budget) => !budget)).toBe(true);
      });
    }
  });

  it('never sends the budget to a machine whose endpoint did not list it, keeping the bar for a window it can’t page', async () => {
    const { link, asked } = budgeted({ transcript: disk(3) });
    const said = { gaps: [] as unknown[], tooLarge: [] as string[] };
    expect(await within(link, { appSessionId: APP, afterSeq: null, limit: null, before: `${APP}:disk:3` }, said, false)).toMatchObject({ ok: true, value: { historyUnavailable: true } });
    expect(asked.every((a) => a.maxBytes === undefined)).toBe(true);
    expect(said.tooLarge).toEqual(['older']);
  });
});
