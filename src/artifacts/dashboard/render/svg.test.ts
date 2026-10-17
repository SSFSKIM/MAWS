// The time grains of a figure's labels (E2 panel): a tick list's grain is the coarsest unit every tick sits on, down to
// the second and the millisecond, so accepted distinct instants never read alike; years keep four digits.
import { describe, expect, it } from 'vitest';
import { formatInstant, unitOf } from './svg';

const at = (iso: string) => Date.parse(iso);

describe('unitOf', () => {
  it('reads a second and a millisecond grain; midnight means no second or millisecond either', () => {
    expect(unitOf([at('2026-10-16T00:00:01Z'), at('2026-10-16T00:00:02Z')])).toBe('second');
    expect(unitOf([at('2026-10-16T00:00:00.200Z'), at('2026-10-16T00:00:00.400Z')])).toBe('millisecond');
    expect(unitOf([at('2026-10-16T00:00:00Z'), at('2026-10-17T00:00:00Z')])).toBe('day');
    expect(unitOf([at('2026-10-16T01:00:00Z'), at('2026-10-16T02:00:00Z')])).toBe('hour');
    expect(unitOf([at('2026-10-16T01:00:00Z'), at('2026-10-16T01:00:30Z')])).toBe('second');
    expect(unitOf([at('2026-10-16T01:05:00Z'), at('2026-10-16T01:10:00Z')])).toBe('minute');
    expect(unitOf([at('2026-01-01T00:00:00Z'), at('2027-01-01T00:00:00Z')])).toBe('year');
  });
});

describe('formatInstant', () => {
  it('writes each grain in UTC, the clock as fine as its grain', () => {
    const t = at('2026-10-16T14:05:09.250Z');
    expect(formatInstant(t, 'year')).toBe('2026');
    expect(formatInstant(t, 'month')).toBe('2026-10');
    expect(formatInstant(t, 'day')).toBe('2026-10-16');
    expect(formatInstant(t, 'hour')).toBe('10-16 14:05');
    expect(formatInstant(t, 'minute')).toBe('10-16 14:05');
    expect(formatInstant(t, 'second')).toBe('10-16 14:05:09');
    expect(formatInstant(t, 'millisecond')).toBe('10-16 14:05:09.250');
  });

  it('keeps a year below 1000 four digits', () => {
    const d = new Date(0);
    d.setUTCFullYear(99, 0, 1);
    expect(formatInstant(d.getTime(), 'year')).toBe('0099');
    expect(formatInstant(d.getTime(), 'day')).toBe('0099-01-01');
  });
});
