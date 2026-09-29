import { describe, expect, it } from 'vitest';
import { ago, resetsIn, resetsInCompact, windowShown } from './format';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('status line time copy', () => {
  it('reads a reset countdown in days and hours, hours and minutes, or minutes', () => {
    expect(resetsIn(5 * DAY + 21 * HOUR + 12 * MIN)).toBe('5d 21h');
    expect(resetsIn(2 * HOUR + 37 * MIN + 59_000)).toBe('2h 37m');
    expect(resetsIn(16 * MIN + 5_000)).toBe('16m');
    expect(resetsIn(20_000)).toBe('under a minute');
    expect(resetsInCompact(5 * DAY + 21 * HOUR)).toBe('5d21h');
    expect(resetsInCompact(2 * HOUR + 37 * MIN)).toBe('2h37m');
    expect(resetsInCompact(16 * MIN)).toBe('16m');
    expect(resetsInCompact(20_000)).toBe('<1m');
  });

  it('reads how long ago a reading was taken', () => {
    expect(ago(30_000)).toBe('just now');
    expect(ago(3 * MIN)).toBe('3m ago');
    expect(ago(2 * HOUR + 5 * MIN)).toBe('2h ago');
    expect(ago(3 * DAY)).toBe('3d ago');
  });

  it('a window whose reset time has passed reads 0% with no countdown', () => {
    const now = Date.parse('2026-09-29T08:00:00Z');
    expect(windowShown({ percent: 53, resetsAt: '2026-09-29T11:20:00Z', recordedAt: '2026-09-29T07:34:17Z' }, now)).toEqual({ percent: 53, resetInMs: 3 * HOUR + 20 * MIN, reset: false });
    expect(windowShown({ percent: 100, resetsAt: '2026-09-29T07:50:00Z', recordedAt: '2026-09-29T04:26:32Z' }, now)).toEqual({ percent: 0, resetInMs: null, reset: true });
  });
});
