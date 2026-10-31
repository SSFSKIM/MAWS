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
