// A restore's label as the history rail shows it, in English under the owner's Korean system locale (P4 Decision Log 4;
// vitest.config.ts runs this suite in `node-display`): the host writes it, so the host's own Intl default never reaches it.
import { describe, expect, it } from 'vitest';
import { restoreLabel } from './restore';

describe('restoreLabel', () => {
  it("names the version by its label, else by its time in English", () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().locale).toBe('ko-KR');
    expect(restoreLabel({ label: 'Clean draft', at: 0 })).toBe('Restored from Clean draft');
    expect(restoreLabel({ label: null, at: new Date(2026, 9, 12, 9, 41).getTime() }).replace(/\s/g, ' ')).toBe('Restored from Oct 12, 9:41 AM');
  });
});
