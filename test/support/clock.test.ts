// The e2e clock pin (e2e/support/clock.ts) against the app's own clock: every time the renderer shows goes through
// `formatClock`, in the one display locale whatever the machine's (P4 Decision Log 4), so the pin is that clock's shape
// and nothing a surface that leaked the system's locale, or drew a date, would write.
import { describe, expect, it } from 'vitest';
import { dateFormats, formatClock, formatDate, formatShortDate, formatWeekdayHour } from '@shared/app/date-format';
import { CLOCK } from '../../e2e/support/clock';

const whole = new RegExp(`^${CLOCK}$`);
const times = [[14, 2], [2, 5], [0, 0], [12, 30], [23, 59]].map(([h, m]) => new Date(2026, 9, 21, h, m).getTime());

describe('the e2e clock pin', () => {
  it('matches every clock the app writes, midnight and noon included', () => {
    for (const t of times) expect(formatClock(t)).toMatch(whole);
    expect(formatClock(times[0]!)).toBe('2:02 PM'); // ICU's narrow no-break space before the day period
  });

  it('pins the time inside a sentence the way the e2e specs use it', () => {
    const released = new RegExp(`^Released at ${CLOCK} to stay under 2 GB$`);
    expect(`Released at ${formatClock(times[0]!)} to stay under 2 GB`).toMatch(released);
    expect('Released at  to stay under 2 GB').not.toMatch(released);
  });

  it('refuses what a surface that leaked the system’s locale would write: its clock in ko-KR, fi-FI, ar-EG, a 24-hour one', () => {
    for (const locale of ['ko-KR', 'fi-FI', 'ar-EG', 'en-GB', 'de-DE', 'ja-JP']) {
      expect(dateFormats(locale).clock(times[0]!), locale).not.toMatch(whole);
    }
  });

  it('refuses the app’s dates and what is not an hour and minute', () => {
    const t = times[0]!;
    for (const text of [formatShortDate(t, t), formatDate(t), formatWeekdayHour(t), dateFormats('ko-KR').shortDate(t, t), '', 'Invalid Date', 'NaN:NaN PM', '14:02', '2:02', '2:2 PM', '2:02:33 PM']) {
      expect(text, JSON.stringify(text)).not.toMatch(whole);
    }
  });
});
