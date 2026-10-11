// Relative times as the machine running the tests writes them (D2 widened at the P2-F sitting: the renderer's relative
// times follow the system locale, `app/date-format.ts`), so a suite that checks the words around one holds on any
// locale; the values themselves are pinned in English and Korean by `app/date-format.test.ts`. Imported by tests only.
type Unit = Intl.RelativeTimeFormatUnit;
const long = new Intl.RelativeTimeFormat(undefined, { style: 'long' });
const narrow = new Intl.RelativeTimeFormat(undefined, { style: 'narrow' });

export const REL = {
  now: new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(0, 'second'), // now, 지금
  ago: (n: number, unit: Unit) => long.format(-n, unit), // 2 days ago, 2일 전
  agoNarrow: (n: number, unit: Unit) => narrow.format(-n, unit), // 3m ago, 3분 전
  in: (n: number, unit: Unit) => narrow.format(n, unit), // in 3m, 3분 후
  amount: (n: number, unit: 'second' | 'minute' | 'hour' | 'day' | 'week') => new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'narrow' }).format(n), // 2h, 2시간
};
