// A build time in the display locale, read under the owner's Korean system locale (vitest.config.ts's `node-display`;
// P4 Decision Log 4); an unreadable time is shown as it came.
import { describe, expect, it } from 'vitest';
import { builtAtLabel } from './build-time';

describe('builtAtLabel', () => {
  const iso = new Date(2026, 9, 8, 14, 5).toISOString(); // Oct 8, 14:05 local

  it('writes the month, the day and the clock time in English', () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().locale).toBe('ko-KR');
    expect(builtAtLabel(iso).replace(/\s/g, ' ')).toBe('Oct 8, 2:05 PM');
  });

  it('shows an unreadable time as it came', () => {
    expect(builtAtLabel('not a time')).toBe('not a time');
  });
});
