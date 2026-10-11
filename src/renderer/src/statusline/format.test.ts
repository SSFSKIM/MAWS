import { describe, expect, it } from 'vitest';
import { ago, resetsIn, resetsInCompact, windowShown } from './format';
import { REL } from '../test-support/relative-time';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('status line time copy', () => {
  it('reads a reset countdown in days and hours, hours and minutes, or minutes', () => {
    expect(resetsIn(5 * DAY + 21 * HOUR + 12 * MIN, 'en-US')).toBe('5d 21h');
    expect(resetsIn(2 * HOUR + 37 * MIN + 59_000, 'en-US')).toBe('2h 37m');
    expect(resetsIn(16 * MIN + 5_000, 'en-US')).toBe('16m');
    expect(resetsIn(20_000, 'en-US')).toBe('under a minute');
    expect(resetsInCompact(5 * DAY + 21 * HOUR, 'en-US')).toBe('5d21h');
    expect(resetsInCompact(2 * HOUR + 37 * MIN, 'en-US')).toBe('2h37m');
    expect(resetsInCompact(16 * MIN, 'en-US')).toBe('16m');
    expect(resetsInCompact(20_000, 'en-US')).toBe('<1m');
  });

  // D2 widened (the review of S-locale): the countdown's numbers and units follow the system locale, compact as before;
  // the words around them ("resets in", "under a minute") stay English, as all UI copy does.
  it('writes the countdown’s numbers and units in the locale', () => {
    expect(resetsIn(5 * DAY + 21 * HOUR + 12 * MIN, 'ko-KR')).toBe('5일 21시간');
    expect(resetsIn(2 * HOUR + 37 * MIN, 'ko-KR')).toBe('2시간 37분');
    expect(resetsIn(16 * MIN, 'ko-KR')).toBe('16분');
    expect(resetsIn(20_000, 'ko-KR')).toBe('under a minute');
    expect(resetsInCompact(2 * HOUR + 37 * MIN, 'ko-KR')).toBe('2시간37분');
    expect(resetsInCompact(20_000, 'ko-KR')).toBe('<1분');
  });

  it('reads how long ago a reading was taken', () => {
    // compact, in the system locale (3m ago, 3분 전)
    expect(ago(30_000)).toBe(REL.now);
    expect(ago(3 * MIN)).toBe(REL.agoNarrow(3, 'minute'));
    expect(ago(2 * HOUR + 5 * MIN)).toBe(REL.agoNarrow(2, 'hour'));
    expect(ago(3 * DAY)).toBe(REL.agoNarrow(3, 'day'));
  });

  it('a window whose reset time has passed reads 0% with no countdown', () => {
    const now = Date.parse('2026-09-29T08:00:00Z');
    expect(windowShown({ percent: 53, resetsAt: '2026-09-29T11:20:00Z', recordedAt: '2026-09-29T07:34:17Z' }, now)).toEqual({ percent: 53, resetInMs: 3 * HOUR + 20 * MIN, reset: false });
    expect(windowShown({ percent: 100, resetsAt: '2026-09-29T07:50:00Z', recordedAt: '2026-09-29T04:26:32Z' }, now)).toEqual({ percent: 0, resetInMs: null, reset: true });
  });
});
