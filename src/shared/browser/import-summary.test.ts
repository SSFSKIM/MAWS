import { describe, expect, it } from 'vitest';
import type { ImportReport } from './import';
import { CANCELLED_REPORT, DONE_REPORT, NO_SKIPS, WRONG_KEY_REPORT } from './import-fixtures';
import { summaryWords } from './import-summary';

describe('summaryWords (E4b Design §10: "N cookies, M history entries, K extensions · J skipped: reasons")', () => {
  it('reads the full import of the fixture as Acceptance case 1 quotes it', () => {
    expect(summaryWords(DONE_REPORT)).toBe(
      "4 cookies, 4 history entries, 3 extensions · 3 skipped: 1 rejected by Chromium (SameSite=None without Secure), 1 hidden page, 1 page MAWS's browser can't open",
    );
  });

  it('reads the wrong key as Acceptance case 2 quotes it', () => {
    expect(summaryWords(WRONG_KEY_REPORT)).toBe(
      "0 cookies, 4 history entries, 3 extensions · 7 skipped: 5 could not be decrypted: the Safe Storage password did not match this profile, 1 hidden page, 1 page MAWS's browser can't open",
    );
  });

  it('reads a cancelled run with the counts it reached', () => {
    expect(summaryWords(CANCELLED_REPORT)).toBe('1,200 cookies, 2 history entries · 3,912 skipped: 3,912 not imported (cancelled)');
  });

  it('counts a cookie once: set and confirmed, or skipped', () => {
    const cookies = { ...DONE_REPORT.cookies, imported: 3, partitioned: { imported: 2, verified: 1 }, skipped: { ...NO_SKIPS.cookies, notVerified: 1 }, hosts: {} };
    expect(summaryWords({ ...DONE_REPORT, history: null, extensions: null, cookies })).toBe('4 cookies · 1 skipped: 1 partitioned cookie not confirmed in the partition');
  });

  it('singularises, groups thousands and leaves out what was not chosen or not skipped', () => {
    const report: ImportReport = {
      ...DONE_REPORT,
      cookies: { ...DONE_REPORT.cookies, imported: 1, partitioned: { imported: 0, verified: 0 }, skipped: NO_SKIPS.cookies, hosts: {} },
      history: { ...DONE_REPORT.history, imported: 17_554, skipped: NO_SKIPS.history, hosts: {} },
      extensions: [DONE_REPORT.extensions[0]],
    };
    expect(summaryWords(report)).toBe('1 cookie, 17,554 history entries, 1 extension');
    expect(summaryWords({ ...report, cookies: null })).toBe('17,554 history entries, 1 extension');
    expect(summaryWords({ ...report, history: { ...report.history!, imported: 1 }, extensions: null, cookies: null })).toBe('1 history entry');
    expect(summaryWords({ ...report, history: null, cookies: null, extensions: null })).toBe('Nothing imported');
  });

  it('names every cookie and history reason in the order of the report, plurals right', () => {
    const report: ImportReport = {
      ...DONE_REPORT,
      cookies: {
        ...DONE_REPORT.cookies,
        imported: 0,
        partitioned: { imported: 0, verified: 0 },
        skipped: { wrongKey: 1, corruptRow: 2, expired: 1, sameSiteNoneInsecure: 2, rejected: 1, notVerified: 0, cancelled: 1 },
        hosts: {},
      },
      history: { ...DONE_REPORT.history, imported: 0, skipped: { hidden: 2, unsupportedScheme: 2, invalid: 1 }, hosts: {} },
      extensions: [],
    };
    expect(summaryWords(report)).toBe(
      '0 cookies, 0 history entries, 0 extensions · 13 skipped: 1 could not be decrypted: the Safe Storage password did not match this profile, ' +
        '2 unreadable rows, 1 expired, 2 rejected by Chromium (SameSite=None without Secure), 1 rejected by Chromium, 1 not imported (cancelled), ' +
        "2 hidden pages, 2 pages MAWS's browser can't open, 1 unreadable history entry",
    );
  });

  it('counts an extension that could not be copied or loaded as skipped, not imported', () => {
    const [probe, fails, wallet] = DONE_REPORT.extensions;
    const extensions = [probe, { ...fails, status: 'loadFailed' as const, error: 'Manifest file is missing or unreadable' }, { ...wallet, status: 'copyFailed' as const, error: 'EACCES' }];
    expect(summaryWords({ ...DONE_REPORT, cookies: null, history: null, extensions })).toBe(
      "1 extension · 2 skipped: 1 extension couldn't be copied, 1 extension couldn't load",
    );
  });
});
