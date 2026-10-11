// A build time follows the system display locale (D2 widened at the P2-F sitting), pinned in an English and a Korean
// locale; an unreadable time is shown as it came.
import { describe, expect, it } from 'vitest';
import { builtAtLabel } from './build-time';

describe('builtAtLabel', () => {
  const iso = new Date(2026, 9, 8, 14, 5).toISOString(); // Oct 8, 14:05 local

  it('writes the month, the day and the clock time in the locale', () => {
    expect(builtAtLabel(iso, 'en-US').replace(/\s/g, ' ')).toBe('Oct 8, 2:05 PM');
    expect(builtAtLabel(iso, 'ko-KR')).toMatch(/^10월 8일 \S+ 2:05$/);
  });

  it('shows an unreadable time as it came', () => {
    expect(builtAtLabel('not a time', 'en-US')).toBe('not a time');
  });
});
