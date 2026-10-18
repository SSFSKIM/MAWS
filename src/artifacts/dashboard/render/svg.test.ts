// The time grains of a figure's labels (E2 panel): a tick list's grain is the coarsest unit every tick sits on, down to
// the second and the millisecond, so accepted distinct instants never read alike; years keep four digits.
import { describe, expect, it } from 'vitest';
import { formatInstant, formatNumber, formatValue, unitOf } from './svg';

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

// P3-F dashboard-model wave (sweep#2): a cell's number keeps a small nonzero value's significant figures and sign; the
// fixed places of an axis tick or a pie share are formatNumber's, unchanged
describe('formatValue', () => {
  it('keeps three significant figures of a nonzero value too small for its places, and its sign', () => {
    expect([0.001, -0.001, 1e-5, 0.0049, -0.000123456, 1e-6].map((v) => formatValue(v))).toEqual(['0.001', '−0.001', '0.00001', '0.0049', '−0.000123', '0.000001']);
    expect(formatValue(0.0001 * 100, 1)).toBe('0.01'); // a percent's one place
  });

  it('is formatNumber elsewhere: rounding, zero, grouping, the exponent past its bounds', () => {
    for (const v of [0, -0, 0.005, 0.0149, -2.5, 12345.678, 9e-7, -1e-7, 2e15, Number.NaN, Infinity]) expect(formatValue(v), String(v)).toBe(formatNumber(v));
    expect([0, 0.005, 12345.678, 9e-7].map((v) => formatValue(v))).toEqual(['0', '0.01', '12,345.68', '9.00e−7']);
    expect(formatNumber(0.001)).toBe('0'); // ticks and shares keep their fixed places
  });
});
