// The e2e clock pin (e2e/support/clock.ts) against what Intl draws for the app's `formatClock` options in any locale,
// and against the texts Electron's own ICU draws, which can differ from this runner's Node (ko-KR: "오후 2:02" there,
// "PM 2:02" under Node 22's system ICU 78.2). Each formatter is made once per locale and options (making one is what
// costs), over the few dates and times that tell the cases apart.
import { describe, expect, it } from 'vitest';
import { CLOCK } from '../../e2e/support/clock';

const whole = new RegExp(`^${CLOCK}$`, 'u');
const options = { hour: 'numeric', minute: '2-digit' } as const; // src/renderer/src/app/date-format.ts, `clock`
// a two-digit afternoon, a one-digit morning, midnight
const times = [[14, 2], [2, 5], [0, 0]].map(([h, m]) => new Date(2026, 9, 21, h, m));
const drawn = (locale: string) => {
  const format = new Intl.DateTimeFormat(locale, options);
  return times.map((t) => format.format(t));
};
const letters = [...'abcdefghijklmnopqrstuvwxyz'];
// Every locale this runner's Intl knows: the two-letter languages probed, the three-letter ones ICU 78 carries named
// (probing all 17,576 three-letter tags costs over a second), and the regional locales that draw a clock or a date
// their language does not (fr-CA's 14 h 02, from a sweep of each language under 41 regions; es-US's p.m.; zh-TW's 下午).
const THREE_LETTER =
  'agq ars asa ast bas bem bez bgc bho blo brx bua ccp ceb cgg chr ckb csw dav dje doi dsb dua dyo ebu ewo fil fur gaa gsw guz haw hsb jgo jmc kab kam kde kea kgp khq kkj kln kok ksb ksf ksh kxv lag lij lkt lmo lrc luo luy mai mas mer mfe mgh mgo mni mua mzn naq nds nmg nnh nqo nso nus nyn pcm pms prg raj rof rwk sah saq sat sbp scn seh ses shi shn smn syr szl teo tok twq tyv tzm vai vec vmw vun wae xnr xog yav yrl yue zgh';
const locales = Intl.DateTimeFormat.supportedLocalesOf([...letters.flatMap((a) => letters.map((b) => a + b)), ...THREE_LETTER.split(' '), 'fr-CA', 'es-US', 'zh-TW']);

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

  it('matches every locale this runner’s Intl knows, whose hour-minute separators are the ones it names', () => {
    expect(locales.length).toBeGreaterThan(200);
    const misses: string[] = [];
    const separators = new Set<string>();
    for (const locale of locales) {
      const format = new Intl.DateTimeFormat(locale, options);
      for (const t of times) {
        const parts = format.formatToParts(t);
        const text = parts.map((p) => p.value).join('');
        if (!whole.test(text)) misses.push(`${locale} ${JSON.stringify(text)}`);
        // what stands between the hour and the minute (Electron 44's ICU draws the first three; Dzongkha only Node's)
        separators.add(parts.slice(parts.findIndex((p) => p.type === 'hour') + 1, parts.findIndex((p) => p.type === 'minute')).map((p) => p.value).join(''));
      }
    }
    expect(misses).toEqual([]);
    expect([...separators].sort()).toEqual([' h ', ' སྐར་མ་ ', '.', ':'].sort());
  });

  it('rejects what is not an hour and minute', () => {
    for (const text of ['', 'Invalid Date', 'NaN:NaN', '--:--', '14', '1402', '14:2', '143:02', '14:02:33', '2:02:33 PM', '3m', 'in 3m', 'Oct 21', '2026-10-21', '2026-10-21T14:02:00Z', '1760000000000']) {
      expect(text, JSON.stringify(text)).not.toMatch(whole);
    }
  });

  it('rejects the dates the app draws, the only exception being a month and day spelled as a dotted time', () => {
    // formatShortDate's month and day as Intl draws them here and in Electron 44 (10월 21일, 10月21日, 21.10.)
    const shortDate = (locale: string) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(2026, 9, 21));
    for (const locale of ['ko-KR', 'ja-JP', 'zh-CN', 'zh-TW', 'fi-FI']) expect(shortDate(locale), locale).not.toMatch(whole);
    for (const text of ['10월 21일', '10月21日', '21.10.', '21. Okt.', 'Oct 21']) expect(text).not.toMatch(whole);
    // every other format of date-format.ts in every locale, on a one-digit and a two-digit day and month (5 January,
    // 21 October): only bg's month and day (5.01, 21.10), which reads as a dotted time in any locale that writes one
    // (fi-FI's 14.02): no pattern that names no locale can tell them apart
    const formats = [{ weekday: 'short', hour: 'numeric' }, { month: 'short', day: 'numeric' }, { month: 'short', day: 'numeric', year: 'numeric' }, { dateStyle: 'medium', timeStyle: 'short' }] as const;
    const days = [new Date(2026, 0, 5, 14, 2), new Date(2026, 9, 21, 14, 2)];
    const taken = new Set<string>();
    for (const locale of locales) {
      for (const format of formats) {
        const formatter = new Intl.DateTimeFormat(locale, format);
        for (const day of days) if (whole.test(formatter.format(day))) taken.add(locale);
      }
    }
    expect([...taken]).toEqual(['bg']);
  });

  it('pins the time inside a sentence the way the e2e specs use it', () => {
    const released = new RegExp(`^Released at ${CLOCK} to stay under 2 GB$`, 'u');
    for (const text of ['2:02 PM', '오후 2:02', '14.02', '٢:٠٢ م']) expect(`Released at ${text} to stay under 2 GB`).toMatch(released);
    for (const text of ['Invalid Date', '', '10월 21일', '10月21日', '21.10.']) expect(`Released at ${text} to stay under 2 GB`).not.toMatch(released);
  });
});
