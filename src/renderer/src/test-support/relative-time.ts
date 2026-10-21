// Relative times as MAWS writes them, in its one display locale (`@shared/app/date-format`; English throughout, P4
// Decision Log 4), so a suite that checks the words around one reads them as the app does, whatever the system locale
// (the renderer's suites run under a Korean one, vitest.config.ts). Imported by tests only.
import { DISPLAY_LOCALE } from '@shared/app/date-format';

type Unit = Intl.RelativeTimeFormatUnit;
const long = new Intl.RelativeTimeFormat(DISPLAY_LOCALE, { style: 'long' });
const narrow = new Intl.RelativeTimeFormat(DISPLAY_LOCALE, { style: 'narrow' });

export const REL = {
  now: new Intl.RelativeTimeFormat(DISPLAY_LOCALE, { numeric: 'auto' }).format(0, 'second'), // now
  ago: (n: number, unit: Unit) => long.format(-n, unit), // 2 days ago
  agoNarrow: (n: number, unit: Unit) => narrow.format(-n, unit), // 3m ago
  in: (n: number, unit: Unit) => narrow.format(n, unit), // in 3m
  amount: (n: number, unit: 'second' | 'minute' | 'hour' | 'day' | 'week') => new Intl.NumberFormat(DISPLAY_LOCALE, { style: 'unit', unit, unitDisplay: 'narrow' }).format(n), // 2h
};
