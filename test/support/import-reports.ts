// Test data only (never imported by app code): the reports E4b's Acceptance quotes, over the synthetic Chrome profile of
// `test/support/chrome-profile.ts` (E4b Design §17), shared by the shared, main and renderer suites so the three agree on
// one shape. Hosts only, never a cookie name, value, path or title (Decision Log 22).
import type { ImportedExtension, ImportReport } from '@shared/browser/import';

const AT = '2026-10-06T10:00:05.000Z';

export const NO_SKIPS = {
  cookies: { wrongKey: 0, corruptRow: 0, expired: 0, sameSiteNoneInsecure: 0, rejected: 0, notVerified: 0, cancelled: 0 },
  history: { hidden: 0, unsupportedScheme: 0, invalid: 0 },
} satisfies { cookies: NonNullable<ImportReport['cookies']>['skipped']; history: NonNullable<ImportReport['history']>['skipped'] };

export const PROBE_EXTENSION = {
  id: 'cddgipniephaglaopjjeihjehogcpggh', chromeId: null, name: 'Probe', version: '1.0', enabled: true, wallet: false,
  unsupportedPermissions: ['cookies', 'webNavigation', 'contextMenus', 'notifications', 'sidePanel'],
  status: 'loaded', error: null, background: 'running', backgroundError: null, checkedAt: AT,
} satisfies ImportedExtension;

export const FAILS_EXTENSION = {
  id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', chromeId: null, name: 'Fails', version: '1.0', enabled: true, wallet: false,
  unsupportedPermissions: ['contextMenus'],
  // main's finished wording (`describeBackgroundError`, Decision Log 39), not the worker's raw text
  status: 'loaded', error: null, background: 'failed', backgroundError: 'chrome.contextMenus.onClicked is not available in MAWS', checkedAt: AT,
} satisfies ImportedExtension;

export const WALLET_EXTENSION = {
  id: 'cccccccccccccccccccccccccccccccc', chromeId: null, name: 'Probe Wallet', version: '1.0', enabled: false, wallet: true,
  unsupportedPermissions: [], status: 'off', error: null, background: 'none', backgroundError: null, checkedAt: AT,
} satisfies ImportedExtension;

// Acceptance case 1: every category, the key right.
export const DONE_REPORT = {
  profileDir: 'Default', name: 'Person 1', partition: 'persist:maws-chrome-Default',
  startedAt: '2026-10-06T10:00:00.000Z', finishedAt: AT, outcome: 'done', failure: null,
  history: { imported: 4, skipped: { ...NO_SKIPS.history, hidden: 1, unsupportedScheme: 1 }, hosts: { hidden: ['hidden.test'], unsupportedScheme: ['settings'] }, error: null },
  cookies: {
    imported: 3, partitioned: { imported: 1, verified: 1 }, skipped: { ...NO_SKIPS.cookies, sameSiteNoneInsecure: 1 }, hosts: { sameSiteNoneInsecure: ['127.0.0.1'] },
    keychain: 'allowed', error: null,
  },
  extensions: [PROBE_EXTENSION, FAILS_EXTENSION, WALLET_EXTENSION],
  bookmarks: null, // cua #90: E4b's reports had no bookmarks block; BOOKMARKS_REPORT has one
} satisfies ImportReport;

// cua #90 start: the import with Bookmarks chosen, over the fixture's `Bookmarks` file (46 URLs kept, a javascript: one
// skipped); and E4b's report as profiles.json version 1 held it, before the bookmarks block existed.
export const BOOKMARKS_REPORT = { ...DONE_REPORT, bookmarks: { imported: 46, skipped: 1, error: null } } satisfies ImportReport;
export const V1_REPORT = withoutBookmarks(DONE_REPORT);
function withoutBookmarks({ bookmarks, ...report }: typeof DONE_REPORT) {
  void bookmarks;
  return report;
}
// cua #90 end

// Acceptance case 2: the wrong Safe Storage password; every encrypted row fails, nothing is set.
export const WRONG_KEY_REPORT = {
  ...DONE_REPORT,
  cookies: { imported: 0, partitioned: { imported: 0, verified: 0 }, skipped: { ...NO_SKIPS.cookies, wrongKey: 5 }, hosts: { wrongKey: ['127.0.0.1', 'example.test', 'embed.test'] }, keychain: 'wrongKey', error: null },
} satisfies ImportReport;

// A run cancelled in the cookies phase (extensions not chosen): the counts it reached, the rest of the rows cancelled.
export const CANCELLED_REPORT = {
  ...DONE_REPORT,
  outcome: 'cancelled',
  history: { imported: 2, skipped: NO_SKIPS.history, hosts: {}, error: null },
  cookies: { imported: 1200, partitioned: { imported: 0, verified: 0 }, skipped: { ...NO_SKIPS.cookies, cancelled: 3912 }, hosts: {}, keychain: 'allowed', error: null },
  extensions: null,
} satisfies ImportReport;
