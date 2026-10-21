// The e2e clock pin (e2e/support/clock.ts) against what Intl draws for the app's `formatClock` options in any locale,
// and against the texts Electron's own ICU draws, which can differ from this runner's Node (ko-KR: "오후 2:02" there,
// "PM 2:02" under Node 22's system ICU 78.2).
import { describe, expect, it } from 'vitest';
import { CLOCK } from '../../e2e/support/clock';

const whole = new RegExp(`^${CLOCK}$`, 'u');
const options = { hour: 'numeric', minute: '2-digit' } as const; // src/renderer/src/app/date-format.ts, `clock`
const times = [[14, 2], [2, 5], [0, 0], [12, 30], [23, 59]].map(([h, m]) => new Date(2026, 9, 21, h, m));
const drawn = (locale: string) => times.map((t) => new Intl.DateTimeFormat(locale, options).format(t));

describe('the e2e clock pattern', () => {
  it('matches what Intl draws for en-US, ko-KR, fi-FI, da-DK and ar-EG, in either hour cycle', () => {
    for (const locale of ['en-US', 'ko-KR', 'fi-FI', 'da-DK', 'ar-EG']) {
      for (const tag of [locale, `${locale}-u-hc-h23`, `${locale}-u-hc-h12`]) for (const text of drawn(tag)) expect(text, tag).toMatch(whole);
    }
    expect(drawn('fi-FI')[0]).toBe('14.02'); // the separator is not a colon
    expect(drawn('ar-EG')[0]).toBe('٢:٠٢ م'); // nor are the digits ASCII
  });

  it('matches the texts Electron 44’s ICU draws (ELECTRON_RUN_AS_NODE=1, 2026-10-21)', () => {
    for (const text of ['2:02 PM', '2:02 PM', '오후 2:02', '14.02', '2.05', '٢:٠٢ م', '下午2:02', '14 h 02', '2:02 p.m.', '۱۴:۰۲']) expect(text).toMatch(whole);
  });

  it('matches every locale this runner’s Intl knows', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const tags = [...letters].flatMap((a) => [...letters].flatMap((b) => [a + b, ...[...letters].map((c) => a + b + c)]));
    const locales = Intl.DateTimeFormat.supportedLocalesOf(tags);
    expect(locales.length).toBeGreaterThan(100);
    const misses = locales.flatMap((locale) => drawn(locale).filter((text) => !whole.test(text)).map((text) => `${locale} ${JSON.stringify(text)}`));
    expect(misses).toEqual([]);
  });

  it('rejects what is not an hour and minute', () => {
    for (const text of ['', 'Invalid Date', 'NaN:NaN', '--:--', '14', '1402', '14:2', '143:02', '14:02:33', '2:02:33 PM', '3m', 'in 3m', 'Oct 21', '2026-10-21', '2026-10-21T14:02:00Z', '1760000000000']) {
      expect(text, JSON.stringify(text)).not.toMatch(whole);
    }
  });

  it('pins the time inside a sentence the way the e2e specs use it', () => {
    const released = new RegExp(`^Released at ${CLOCK} to stay under 2 GB$`, 'u');
    for (const text of ['2:02 PM', '오후 2:02', '14.02', '٢:٠٢ م']) expect(`Released at ${text} to stay under 2 GB`).toMatch(released);
    expect('Released at Invalid Date to stay under 2 GB').not.toMatch(released);
    expect('Released at  to stay under 2 GB').not.toMatch(released);
  });
});
