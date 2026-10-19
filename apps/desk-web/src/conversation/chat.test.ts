// The group chat's blocks (§4, 2026-10-19): a sender's consecutive items within a few minutes under one header, a
// request joining its session's run; lifecycle lines merged per session into one quiet run; a day separator where the
// calendar day changes; a human's message, agent traffic and the working record as blocks of their own.
import { describe, expect, it } from 'vitest';
import type { LogEvent } from 'desk-hub/protocol';
import { chatBlocks, dayOf } from './chat';
import type { StreamItem } from './stream';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const S2 = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
let offset = 0;
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 19, 8, minutes)).toISOString();
const event = (ts: string, kind: string, fields: Record<string, unknown> = {}): LogEvent => ({ ts, writer: `mini/${S1}`, seq: ++offset, kind, mac: { nonce: `n${offset}`, value: 'v' }, ...fields }) as LogEvent;
const message = (session: string, from: string, minutes: number): StreamItem => ({ kind: 'message', key: `m${++offset}`, offset, event: event(at(minutes), 'message'), session, from, text: `said ${offset}` });
const question = (session: string, from: string, minutes: number): StreamItem => ({ kind: 'question', key: `q${++offset}`, offset, event: event(at(minutes), 'question'), session, from, text: 'Which?', questions: ['Which?'], choices: [], request: 'toolu_1', ref: 'r', answered: null });
const request = (session: string, ts: string | null = null): StreamItem => ({ kind: 'request', key: `req${++offset}`, request: 'toolu_p', ref: 'rp', session, ts });
const system = (session: string, subject: string, rest: string, minutes: number): StreamItem => ({ kind: 'system', key: `s${++offset}`, offset, event: event(at(minutes), 'joined'), session, subject, rest, text: `${subject} ${rest}` });
const human = (minutes: number): StreamItem => ({ kind: 'human', key: `h${++offset}`, offset, event: event(at(minutes), 'human'), text: 'hi', to: '*', wake: false });
const shape = (items: StreamItem[]) => chatBlocks(items).map((b) => (b.kind === 'run' ? `run:${b.from}:${b.items.length}` : b.kind === 'quiet' ? `quiet:${b.lines.map((l) => `${l.subject}[${l.says.length}]`).join(',')}` : b.kind));

describe('runs', () => {
  it("puts a sender's consecutive messages, questions and requests under one header while they come within the window", () => {
    expect(shape([message(S1, 'maws-45', 0), message(S1, 'maws-45', 2), question(S1, 'maws-45', 4), request(S1), message(S1, 'maws-45', 8)])).toEqual(['day', 'run:maws-45:5']);
  });

  it('starts a new run when the sender changes, or after the window since the last dated item', () => {
    expect(shape([message(S1, 'maws-45', 0), message(S2, 'maws-fe', 1), message(S2, 'maws-fe', 2), message(S2, 'maws-fe', 9)])).toEqual(['day', 'run:maws-45:1', 'run:maws-fe:2', 'run:maws-fe:1']);
  });

  it("names a run of requests alone by nothing, taking the alias of the first message that joins it; a human's message ends a run", () => {
    const blocks = chatBlocks([request(S1), message(S1, 'maws-45', 0), human(1), message(S1, 'maws-45', 2)]);
    expect(blocks.map((b) => b.kind)).toEqual(['run', 'day', 'run', 'human', 'run']);
    // The request came before any dated item: its run stands before the day's separator, unnamed; the message, dated,
    // opens the day and a run of its own.
    expect(blocks[0]).toMatchObject({ kind: 'run', from: null, ts: null });
    expect(blocks[2]).toMatchObject({ kind: 'run', from: 'maws-45' });
  });

  it("dates a request by the entry it was first seen behind, so one seen past the window does not join the sender's old run", () => {
    expect(shape([message(S1, 'maws-45', 0), request(S1, at(3))])).toEqual(['day', 'run:maws-45:2']);
    expect(shape([message(S1, 'maws-45', 0), request(S1, at(20))])).toEqual(['day', 'run:maws-45:1', 'run:null:1']);
  });
});

describe('quiet runs', () => {
  it("merges a session's consecutive lifecycle lines into one, and keeps another session's apart", () => {
    const items = [system(S1, 'maws-45', 'joined on mini', 0), system(S1, 'maws-45', 'is in charge of: grid', 0), system(S2, 'maws-fe', 'joined on SK.local', 1), message(S1, 'maws-45', 2), system(S1, 'maws-45', 'ended', 3)];
    expect(shape(items)).toEqual(['day', 'quiet:maws-45[2],maws-fe[1]', 'run:maws-45:1', 'quiet:maws-45[1]']);
    const quiet = chatBlocks(items)[1];
    expect(quiet.kind === 'quiet' && quiet.lines[0].says.map((s) => s.text)).toEqual(['joined on mini', 'is in charge of: grid']);
  });

  it('keeps lines of one session apart when their subject differs (a rename names the old alias)', () => {
    expect(shape([system(S1, 'maws-45', 'is now maws-46', 0), system(S1, 'maws-46', 'is in charge of: grid', 0)])).toEqual(['day', 'quiet:maws-45[1],maws-46[1]']);
  });
});

describe('days', () => {
  it('separates the calendar days, splitting a run across midnight', () => {
    const late = new Date(Date.UTC(2026, 9, 18, 23, 58)).toISOString();
    const early = new Date(Date.UTC(2026, 9, 19, 0, 1)).toISOString();
    const items: StreamItem[] = [
      { kind: 'message', key: 'a', offset: 1, event: event(late, 'message'), session: S1, from: 'maws-45', text: 'late' },
      { kind: 'message', key: 'b', offset: 2, event: event(early, 'message'), session: S1, from: 'maws-45', text: 'early' },
    ];
    const blocks = chatBlocks(items);
    // Local days: the two stand apart when midnight falls between them in this zone, else together.
    if (dayOf(late) === dayOf(early)) expect(blocks.map((b) => b.kind)).toEqual(['day', 'run']);
    else expect(blocks.map((b) => b.kind)).toEqual(['day', 'run', 'day', 'run']);
  });

  it('opens a new day for a request first seen after midnight, a few minutes after the run before it', () => {
    const late = new Date(2026, 9, 18, 23, 58).toISOString();
    const items: StreamItem[] = [{ kind: 'message', key: 'a', offset: 1, event: event(late, 'message'), session: S1, from: 'maws-45', text: 'late' }, request(S1, new Date(2026, 9, 19, 0, 1).toISOString())];
    expect(chatBlocks(items).map((b) => b.kind)).toEqual(['day', 'run', 'day', 'run']);
  });

  it('keys each separator by the item that opened its day, since a writer whose clock is behind can put yesterday after today', () => {
    const [today, yesterday] = [new Date(2026, 9, 19, 10).toISOString(), new Date(2026, 9, 18, 10).toISOString()];
    const items: StreamItem[] = [
      { kind: 'message', key: 'a', offset: 1, event: event(today, 'message'), session: S1, from: 'maws-45', text: 'today' },
      { kind: 'message', key: 'b', offset: 2, event: event(yesterday, 'message'), session: S2, from: 'maws-fe', text: 'a clock behind' },
      { kind: 'message', key: 'c', offset: 3, event: event(today, 'message'), session: S1, from: 'maws-45', text: 'today again' },
    ];
    expect(chatBlocks(items).flatMap((b) => (b.kind === 'day' ? [b.key] : []))).toEqual(['day:a', 'day:b', 'day:c']);
  });

  it('dates a run of agent traffic by its first message, and a working-record fold by nothing', () => {
    const items: StreamItem[] = [
      { kind: 'agents', key: 'ag', says: [{ offset: 1, event: event(at(0), 'say') }] },
      { kind: 'work', key: 'w', offset: 2, session: S1 },
    ];
    expect(chatBlocks(items).map((b) => b.kind)).toEqual(['day', 'agents', 'work']);
  });
});
