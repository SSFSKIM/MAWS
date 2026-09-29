import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureTime, duration, needsSeparator, separatorLabel } from './time';

const NOW = '2026-09-28T15:00:00.000Z';

afterEach(() => configureTime(null));

describe('durations', () => {
  it('formats under a minute as seconds, under an hour as minutes and seconds, else hours and zero-padded minutes', () => {
    expect(duration(0)).toBe('0s');
    expect(duration(45_000)).toBe('45s');
    expect(duration(59_999)).toBe('59s');
    expect(duration(134_000)).toBe('2m 14s');
    expect(duration(3_600_000)).toBe('1h 00m');
    expect(duration(3_720_000)).toBe('1h 02m');
    expect(duration(7_500_000)).toBe('2h 05m');
  });
});

describe('time separators', () => {
  it('needs a separator before a human turn after 60 minutes and before an engine turn or loose row after 10 minutes', () => {
    const t0 = '2026-09-28T10:00:00.000Z';
    expect(needsSeparator(null, t0, 'human')).toBe(true); // the first row always gets one
    expect(needsSeparator(t0, '2026-09-28T10:59:59.000Z', 'human')).toBe(false);
    expect(needsSeparator(t0, '2026-09-28T11:00:00.000Z', 'human')).toBe(true);
    expect(needsSeparator(t0, '2026-09-28T10:09:59.000Z', 'engine')).toBe(false);
    expect(needsSeparator(t0, '2026-09-28T10:10:00.000Z', 'engine')).toBe(true);
    expect(needsSeparator(t0, '2026-09-28T10:10:00.000Z', 'loose')).toBe(true);
  });

  it('labels today, yesterday, a weekday within six days, else the date, each followed by the time', () => {
    configureTime({ now: NOW, locale: 'en-US', timeZone: 'UTC' });
    expect(separatorLabel('2026-09-28T01:12:00.000Z')).toBe('Today 1:12 AM');
    expect(separatorLabel('2026-09-27T23:45:00.000Z')).toBe('Yesterday 11:45 PM');
    expect(separatorLabel('2026-09-24T09:05:00.000Z')).toBe('Thursday 9:05 AM'); // four days back
    expect(separatorLabel('2026-09-22T09:05:00.000Z')).toBe('Tuesday 9:05 AM'); // six days back, still a weekday
    expect(separatorLabel('2026-09-21T09:05:00.000Z')).toBe('Sep 21, 2026 9:05 AM'); // seven days back
    expect(separatorLabel('2025-12-31T18:30:00.000Z')).toBe('Dec 31, 2025 6:30 PM');
  });

  // Every flatten of the row list labels every separator (hundreds on a long transcript), so a label must not build
  // formatters: building four per label cost about 12 ms per flatten of synthetic/500, several times in one frame when
  // receipts mount (M6 profile).
  it('reuses its formatters across labels', () => {
    configureTime({ now: NOW, locale: 'en-US', timeZone: 'UTC' });
    separatorLabel('2026-09-28T01:12:00.000Z'); // warm
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    for (let i = 0; i < 500; i += 1) separatorLabel(new Date(Date.parse('2026-09-20T00:00:00.000Z') + i * 1_800_000).toISOString());
    expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
    spy.mockRestore();
  });

  it('labels afresh when the clock, the zone or the locale changes', () => {
    const at = '2026-09-28T14:30:00.000Z';
    configureTime({ now: NOW, locale: 'en-US', timeZone: 'UTC' });
    expect(separatorLabel(at)).toBe('Today 2:30 PM');
    configureTime({ now: '2026-09-29T15:00:00.000Z', locale: 'en-US', timeZone: 'UTC' });
    expect(separatorLabel(at)).toBe('Yesterday 2:30 PM');
    configureTime({ now: NOW, locale: 'en-US', timeZone: 'Asia/Seoul' });
    expect(separatorLabel(at)).toBe('Yesterday 11:30 PM');
    configureTime({ now: NOW, locale: 'en-GB', timeZone: 'UTC' });
    expect(separatorLabel(at)).toBe('Today 14:30');
  });

  it('follows the configured time zone for the day boundary', () => {
    configureTime({ now: NOW, locale: 'en-US', timeZone: 'Asia/Seoul' }); // 2026-09-29 00:00 KST
    expect(separatorLabel('2026-09-28T15:30:00.000Z')).toBe('Today 12:30 AM');
    expect(separatorLabel('2026-09-28T14:30:00.000Z')).toBe('Yesterday 11:30 PM');
  });
});
