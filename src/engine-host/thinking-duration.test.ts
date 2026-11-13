// X1's recorded duration of a finished thinking block (UX wave U2, X1's amendment; the U2a execution document, M1 and
// decision 1): the engine writes one number per thought, `thinking_duration_ms` on the `assistant` frame that holds the
// block and `thinkingDurationMs` on the transcript row; both producers carry it on that block's
// `assistant.block.complete`, from a number that is a duration, and only when the frame or the row holds exactly one
// thinking block. Recorded sessions first, then constructed frames and rows (invented content).
import { describe, expect, it } from 'vitest';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { parseTranscriptRecord } from '@shared/wire/transcript';
import { loadJournal, loadUxwaveJournal, loadUxwaveTranscript } from '../../test/support/fixtures';
import { createBackfillContext, recordToEvents } from './fs/backfill';
import { Normalizer } from './normalizer';

type Complete = Extract<SessionEvent, { kind: 'assistant.block.complete' }>;
const SESSION = 'sess-1' as SessionId;
const AT = '2026-11-13T10:00:00.000Z';

const live = (rows: JournalRow[]): SessionEvent[] => {
  const normalizer = new Normalizer({ appSessionId: 'app-1' as AppSessionId, launchId: 'LAUNCH01', sessionId: null });
  return rows.flatMap((row) => normalizer.push(row));
};
const fromRecords = (records: unknown[]): SessionEvent[] => {
  const ctx = createBackfillContext({ sessionId: SESSION, agent: null });
  return records.flatMap((record) => recordToEvents(parseTranscriptRecord(record), ctx));
};
const thoughts = (events: SessionEvent[]): Complete[] =>
  events.filter((e): e is Complete => e.kind === 'assistant.block.complete' && e.block.type === 'thinking' && e.parentToolUseId === null);
const recorded = (events: SessionEvent[]) => thoughts(events).map((e) => e.thinkingDurationMs);

describe('the recorded duration, from recorded sessions', () => {
  it('u3-cron-r1: the thought before the run of two carries 10,192 ms from the wire journal and from the transcript file', () => {
    expect(recorded(live(loadUxwaveJournal('u3-cron-r1')))).toEqual([10_192]);
    expect(recorded(fromRecords(loadUxwaveTranscript('u3-cron-r1')))).toEqual([10_192]);
  });

  it('a thought with no text (the thinking probe’s “without” half) carries its number too', () => {
    for (const name of ['uxwave-thinking-haiku-without-1', 'uxwave-thinking-sonnet-without-3', 'uxwave-thinking-opus-without-1']) {
      const events = thoughts(live(loadJournal('pass3', `uxwave/${name}`)));
      expect(events, name).toHaveLength(1);
      expect(String(events[0]!.block.thinking ?? '').trim(), name).toBe('');
      expect(events[0]!.thinkingDurationMs, name).toBeGreaterThan(0);
    }
  });

  it('every event a producer makes with the number is valid X1', () => {
    for (const event of [...live(loadUxwaveJournal('u3-cron-r1')), ...fromRecords(loadUxwaveTranscript('u3-cron-r1'))]) SessionEventSchema.parse(event);
  });
});

// One `assistant` frame of a session MAWS runs, and the transcript row the engine writes for it.
const frame = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  seq: 1, direction: 'in' as const, at: AT,
  frame: { type: 'assistant', uuid: 'a-1', session_id: 'sess-1', parent_tool_use_id: null, message: { id: 'msg_1', role: 'assistant', model: 'claude-test', content, stop_reason: null, usage: {} }, ...extra },
});
const row = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: 'assistant', uuid: 'a-1', parentUuid: null, timestamp: AT, sessionId: 'sess-1', message: { id: 'msg_1', role: 'assistant', model: 'claude-test', content }, ...extra,
});
const THOUGHT = { type: 'thinking', thinking: 'Checking which of the two layouts the tests expect.', signature: 'sig' };
const OTHER_THOUGHT = { type: 'thinking', thinking: 'And whether the fixture is still current.', signature: 'sig' };
const TEXT = { type: 'text', text: 'Both layouts pass.' };

describe('the recorded duration, by producer', () => {
  const both = (content: unknown[], wire: Record<string, unknown>, file: Record<string, unknown>) =>
    [live([frame(content, wire)]), fromRecords([row(content, file)])] as const;

  it('rides the thinking block’s event, and no other block’s', () => {
    for (const events of both([THOUGHT], { thinking_duration_ms: 12_400 }, { thinkingDurationMs: 12_400 })) expect(recorded(events)).toEqual([12_400]);
    for (const events of both([TEXT], { thinking_duration_ms: 12_400 }, { thinkingDurationMs: 12_400 })) {
      const complete = events.filter((e): e is Complete => e.kind === 'assistant.block.complete');
      expect(complete).toHaveLength(1);
      expect('thinkingDurationMs' in complete[0]!).toBe(false);
    }
  });

  it('keeps zero, a duration', () => {
    for (const events of both([THOUGHT], { thinking_duration_ms: 0 }, { thinkingDurationMs: 0 })) expect(recorded(events)).toEqual([0]);
  });

  it('sets none with two thinking blocks in the frame or the row: one number for two would be a guess', () => {
    for (const events of both([THOUGHT, OTHER_THOUGHT], { thinking_duration_ms: 12_400 }, { thinkingDurationMs: 12_400 })) {
      expect(thoughts(events)).toHaveLength(2);
      expect(thoughts(events).some((e) => 'thinkingDurationMs' in e)).toBe(false);
    }
  });

  it.each([['a string', '12400'], ['a negative number', -5], ['an infinite number', Number.POSITIVE_INFINITY], ['not a number', Number.NaN], ['null', null]])('sets none from %s', (_, value) => {
    for (const events of both([THOUGHT], { thinking_duration_ms: value }, { thinkingDurationMs: value })) {
      expect(thoughts(events)).toHaveLength(1);
      expect('thinkingDurationMs' in thoughts(events)[0]!).toBe(false);
    }
  });

  it('sets none when the engine wrote none (an engine older than 2.1.287)', () => {
    for (const events of both([THOUGHT], {}, {})) {
      expect(thoughts(events)).toHaveLength(1);
      expect('thinkingDurationMs' in thoughts(events)[0]!).toBe(false);
    }
  });
});
