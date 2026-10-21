import { describe, expect, it } from 'vitest';
import type { LogEvent } from 'desk-hub/protocol';
import type { RequestRecord } from '../project/conversation';
import { eventLanding, landedItem, landingStatus } from './landing';
import type { StreamItem } from './stream';

const event = (writer: string, seq: number, kind = 'message') => ({ ts: '2026-10-15T10:00:00.000Z', writer, seq, kind }) as unknown as LogEvent;
const items: StreamItem[] = [
  { kind: 'message', key: 'm1', offset: 1, event: event('mini/s1', 4), session: 's1', from: 'maws-45', text: 'hi' },
  { kind: 'question', key: 'q1', offset: 2, event: event('mini/s1', 5, 'question'), session: 's1', from: 'maws-45', text: 'which?', questions: ['which?'], choices: [], request: 'toolu_async', ref: 'ref-async', answered: null },
  { kind: 'work', key: 'w1', offset: 2, session: 's1' },
  { kind: 'request', key: 'r1', request: 'toolu_native', ref: 'ref-native', session: 's1', ts: null },
];

describe('landedItem', () => {
  it('finds the card a request landing names, whether a request row or a question in the log', () => {
    expect(landedItem({ kind: 'request', request: 'toolu_native' }, items)).toBe('r1');
    expect(landedItem({ kind: 'request', request: 'toolu_async' }, items)).toBe('q1');
  });

  it('finds a message by its writer and seq', () => {
    expect(landedItem({ kind: 'event', writer: 'mini/s1', seq: 4 }, items)).toBe('m1');
    expect(landedItem({ kind: 'event', writer: 'mini/s1', seq: 5 }, items)).toBe('q1');
  });

  it('finds nothing the channel does not draw', () => {
    expect(landedItem({ kind: 'request', request: 'toolu_other' }, items)).toBeNull();
    expect(landedItem({ kind: 'event', writer: 'mini/s2', seq: 4 }, items)).toBeNull();
  });
});

describe('landingStatus', () => {
  const request = { kind: 'request', request: 'toolu_x' } as const;
  const message = { kind: 'event', writer: 'mini/s1', seq: 9 } as const;

  it('is shown once the card is drawn: drawn means verified', () => {
    expect(landingStatus({ landing: request, found: true, ready: false, unverified: false })).toEqual({ kind: 'shown' });
  });

  it('is checking until the log and the pending set are in', () => {
    expect(landingStatus({ landing: request, found: false, ready: false, unverified: false })).toEqual({ kind: 'checking', text: 'Checking the request…' });
    expect(landingStatus({ landing: message, found: false, ready: false, unverified: false })).toEqual({ kind: 'checking', text: 'Checking the message…' });
  });

  it('says a request settled before the page opened is no longer waiting', () => {
    expect(landingStatus({ landing: request, found: false, ready: true, unverified: false })).toEqual({
      kind: 'gone',
      text: 'This request is no longer waiting: it was answered or withdrawn before you opened it.',
    });
  });

  it('says a card that failed verification is not shown, whatever else holds', () => {
    expect(landingStatus({ landing: request, found: false, ready: true, unverified: true })).toEqual({ kind: 'unverified', text: 'This request failed verification, so it is not shown.' });
    expect(landingStatus({ landing: message, found: false, ready: false, unverified: true })).toEqual({ kind: 'unverified', text: 'This message failed verification, so it is not shown.' });
  });

  it('says a message the log does not hold is missing', () => {
    expect(landingStatus({ landing: message, found: false, ready: true, unverified: false })).toEqual({ kind: 'missing', text: 'This message is not in the log this browser holds.' });
  });
});

describe('eventLanding', () => {
  const logged = (kind: string, src: unknown) => ({ ...event('mini/s1', 7, kind), src }) as LogEvent;
  const pending = (request: string, toolUseId?: string) =>
    ({ key: request, request, machine: 'mini', raised: { request, session: 's1', tool: 'mcp__doperpowers__AskUserQuestion', input: {}, async: true, ...(toolUseId && { toolUseId }) }, at: 1, pending: true, terminalOnly: false, settled: null }) as unknown as RequestRecord;
  const nowhere = { request: null, message: null, question: null };

  it('lands a <message> on its transcript row, whatever the requests', () => {
    expect(eventLanding(logged('message', 'row-uuid#0'), [pending('row-uuid#0')], false)).toEqual({ ...nowhere, message: 'row-uuid#0' });
  });

  it("lands a message tool's message as a message, by its call's id (the session view finds the call's row)", () => {
    expect(eventLanding(logged('message', 'toolu_msg'), [], false)).toEqual({ ...nowhere, message: 'toolu_msg' });
  });

  it("lands a question on the card of the request a bridge raised for the same ask, by its id or its call's id", () => {
    expect(eventLanding(logged('question', 'toolu_ask'), [pending('toolu_other'), pending('toolu_ask')], false)).toEqual({ ...nowhere, request: 'toolu_ask' });
    expect(eventLanding(logged('question', 'toolu_ask'), [pending('request-7', 'toolu_ask')], true)).toEqual({ ...nowhere, request: 'request-7' });
  });

  it("lands a question no request waits for on its call's row, once the pending set is checked", () => {
    expect(eventLanding(logged('question', 'toolu_ask'), [pending('toolu_other')], true)).toEqual({ ...nowhere, question: 'toolu_ask' });
    expect(eventLanding(logged('question', 'toolu_ask'), [], false)).toEqual(nowhere); // its request may not be checked yet
  });

  it('lands nowhere for an event not held yet, one without a src, or another kind', () => {
    expect(eventLanding(undefined, [], true)).toEqual(nowhere);
    expect(eventLanding(logged('question', undefined), [], true)).toEqual(nowhere);
    expect(eventLanding(logged('say', 'x'), [], true)).toEqual(nowhere);
  });
});
