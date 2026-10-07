// The import report's summary line (E4b Design §10), the one place its English lives: the import sheet's report and
// Settings › Browser's records both show it (`IMPORT_COPY.summary` reuses it). "N cookies, M history entries,
// K extensions · J skipped: reasons", a category the owner did not choose left out, the reasons in the report's order.
import type { CookieSkipReason, HistorySkipReason, ImportedExtension, ImportReport } from './import';
import { COOKIE_SKIP_REASONS, HISTORY_SKIP_REASONS } from './import';

const count = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`;

const COOKIE_REASONS: Record<CookieSkipReason, (n: number) => string> = {
  wrongKey: (n) => `${count(n)} could not be decrypted: the Safe Storage password did not match this profile`,
  corruptRow: (n) => plural(n, 'unreadable row'),
  expired: (n) => `${count(n)} expired`,
  sameSiteNoneInsecure: (n) => `${count(n)} rejected by Chromium (SameSite=None without Secure)`,
  rejected: (n) => `${count(n)} rejected by Chromium`,
  notVerified: (n) => `${plural(n, 'partitioned cookie')} not confirmed in the partition`,
  cancelled: (n) => `${count(n)} not imported (cancelled)`,
};

const HISTORY_REASONS: Record<HistorySkipReason, (n: number) => string> = {
  hidden: (n) => plural(n, 'hidden page'),
  unsupportedScheme: (n) => `${plural(n, 'page')} MAWS's browser can't open`,
  invalid: (n) => plural(n, 'unreadable history entry', 'unreadable history entries'),
};

const EXTENSION_SKIPS = {
  copyFailed: (n: number) => `${plural(n, 'extension')} couldn't be copied`,
  loadFailed: (n: number) => `${plural(n, 'extension')} couldn't load`,
} satisfies Partial<Record<ImportedExtension['status'], (n: number) => string>>;

export function summaryWords(report: ImportReport): string {
  const imported: string[] = [];
  const skipped: [number, string][] = [];
  const { cookies, history, extensions } = report;
  if (cookies) {
    imported.push(plural(cookies.imported + cookies.partitioned.verified, 'cookie'));
    for (const reason of COOKIE_SKIP_REASONS) skipped.push([cookies.skipped[reason], COOKIE_REASONS[reason](cookies.skipped[reason])]);
  }
  if (history) {
    imported.push(plural(history.imported, 'history entry', 'history entries'));
    for (const reason of HISTORY_SKIP_REASONS) skipped.push([history.skipped[reason], HISTORY_REASONS[reason](history.skipped[reason])]);
  }
  if (extensions) {
    imported.push(plural(extensions.filter((e) => e.status === 'loaded' || e.status === 'off').length, 'extension'));
    for (const status of ['copyFailed', 'loadFailed'] as const) {
      const n = extensions.filter((e) => e.status === status).length;
      skipped.push([n, EXTENSION_SKIPS[status](n)]);
    }
  }
  if (imported.length === 0) return 'Nothing imported';
  const reasons = skipped.filter(([n]) => n > 0);
  const total = reasons.reduce((sum, [n]) => sum + n, 0);
  return total === 0 ? imported.join(', ') : `${imported.join(', ')} · ${count(total)} skipped: ${reasons.map(([, words]) => words).join(', ')}`;
}
