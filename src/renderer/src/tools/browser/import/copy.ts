// Every sentence the Chrome profile import sheet shows (E4b execution document, Design §3, §10, §12 and §18): its
// titles per state, the picker, the four category rows, the Keychain line, the progress labels, the report and the
// removal sheet. The report's summary line is `summaryWords` (src/shared/browser/import-summary.ts), its one English
// home. The Cookies row names the Keychain dialog's Allow button and no other (E0b S1e).
import type { CookieSkipReason, ExtensionCandidate, HistorySkipReason, ImportedExtension, ImportPhase, ImportReport, KeychainOutcome } from '@shared/browser/import';
import { summaryWords } from '@shared/browser/import-summary';

const count = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`;
export const importDate = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

// The categories' names, and the two Chrome stores the inspection stages as the rows and the report name them.
const CATEGORIES = { history: 'History', cookies: 'Cookies', extensions: 'Extensions' } as const;
type Store = 'history' | 'cookies';

// A Chrome store the inspection or the run could not read, by main's code (`missing`, `symlink`, an errno, an SQLite
// code, `indexUnavailable`): the code stays in the row's title; the words say what the owner can do (Codex's recovery line).
function storeError(store: Store, code: string): string {
  const name = CATEGORIES[store];
  if (code === 'missing') return `This profile has no ${name} file.`;
  if (code === 'symlink') return `${name} is a link in this profile, so MAWS didn't copy it.`;
  if (code === 'indexUnavailable') return `MAWS's index is read-only right now, so ${name.toLowerCase()} couldn't be imported.`;
  return `${name} couldn't be read from the copy. Chrome may have been writing it; quit Chrome and try again.`;
}

// The report's history error. The run reads a copy the inspection already opened, so an error there (other than the
// copy going missing or turning into a link) is MAWS's index refusing the write, not Chrome.
function historyError(code: string): string {
  if (code === 'missing' || code === 'symlink' || code === 'indexUnavailable') return storeError('history', code);
  return "MAWS couldn't write the history into its index; some history wasn't imported.";
}

const PHASES: Record<ImportPhase, string> = {
  copying: "Preparing the profile's browser storage…", // the run opens the partition here (Decision Log 38)
  history: 'Importing browsing history…',
  keychain: 'Waiting for the Keychain… choose Allow in the macOS dialog',
  cookies: 'Importing cookies…',
  verifying: 'Confirming partitioned cookies…',
  extensions: 'Importing extensions…',
  cleaning: 'Cleaning up…',
};

// The Keychain's answer when it was not `allowed` (Design §5); `skipped` is worded by `keychainLine`.
const KEYCHAIN: Record<Exclude<KeychainOutcome, 'allowed' | 'skipped'>, string> = {
  denied: 'Keychain access was not allowed; cookies were not imported',
  missing: 'No Chrome Safe Storage item in your login keychain; cookies were not imported',
  timeout: 'The Keychain did not answer in time; cookies were not imported',
  wrongKey: 'The Safe Storage password did not match this profile; no cookie was imported',
};

// Why a run could not continue (`ImportReport.failure`, Decision Log 38).
const FAILURES: Record<string, string> = {
  partitionUnavailable: "MAWS couldn't open browser storage for this profile.",
  recordUnwritable: "MAWS couldn't save the imported profile's record.",
  unexpected: 'Something unexpected stopped the import.',
};

const CANDIDATE_ERRORS: Record<NonNullable<ExtensionCandidate['error']>, string> = {
  symlink: "The extension's files couldn't be safely read",
  missing: "The extension's files are missing from this Chrome profile",
  manifest: "The extension's manifest couldn't be read",
};

// Main's refusal or error message as the middle of a sentence: ending in exactly one full stop.
const reason = (message: string) => `${message.trim().replace(/\.+$/, '')}.`;

export const IMPORT_COPY = {
  title: {
    pick: 'Import a Chrome profile',
    consent: (name: string) => `What to import from ${name}`,
    running: (name: string | null) => (name === null ? 'Importing a Chrome profile…' : `Importing from ${name}…`),
    done: (name: string) => `Imported from ${name}`,
    cancelled: 'Cancelled',
    failed: 'The import failed',
  },

  // the picker
  chromeRunning: 'Quit Chrome for the most complete copy',
  notFound: (path: string) => `No Chrome folder at ${path}`,
  localStateUnreadable: "Chrome's Local State couldn't be read in this folder",
  noProfiles: 'This Chrome folder lists no profiles',
  chooseFolder: 'Choose another Chrome folder…',
  imported: (date: string | null) => (date === null ? 'Imported' : `Imported ${date}`),
  reading: "Reading Chrome's profiles…",
  profilesFailed: (message: string) => `Couldn't list Chrome's profiles: ${message}`,
  chooseFailed: (message: string) => `Couldn't use that folder: ${message}`,
  inspecting: 'Reading what this profile holds…',
  inspectFailed: (message: string) => `Couldn't read what this profile holds: ${reason(message)} Choose the profile again.`,
  startFailed: (message: string) => `Couldn't start the import: ${reason(message)} Choose the profile again.`,
  continue: 'Continue',

  // the consent
  history: (rows: number) => `${plural(rows, 'page')}. Read from a copy; needs no password. Shown in the address bar's suggestions.`,
  cookies: (rows: number, partitioned: number) =>
    rows === 0
      ? 'No cookies in this profile.'
      : `${plural(rows, 'cookie')}${partitioned > 0 ? ` (${count(partitioned)} partitioned)` : ''}. macOS will ask once for Chrome's Safe Storage password from your login keychain; choose Allow. ` +
        'MAWS reads it once, keeps it in memory only while the cookies are decrypted, and never writes it anywhere. Nothing is written back to Chrome.',
  cookiesAgents: (name: string) => `New browser tabs, including the ones agents open through MAWS's browser tools, will be signed in as ${name} wherever Chrome was.`,
  passwords: 'Saved passwords — a credential store comes later',
  extensions: (n: number) => (n === 0 ? 'No extensions in this profile.' : `${plural(n, 'extension')}. Copied into MAWS and loaded in this profile's tabs.`),
  storeError,
  categories: CATEGORIES,
  importExtension: (name: string) => `Import ${name}`,
  candidateError: (error: NonNullable<ExtensionCandidate['error']>) => CANDIDATE_ERRORS[error],
  walletChip: 'Wallet · off until you turn it on',
  disabledInChrome: 'Disabled in Chrome',
  mv2: 'MV2',
  noBackground: 'No background',
  unsupported: (n: number) => `${plural(n, 'permission')} MAWS doesn't support`,
  unverified: (name: string) =>
    `MAWS can't verify these extensions or their saved permissions. Imported extensions run code inside MAWS's browser pages for this profile. Continue only if you trust what ${name} installed in Chrome.`,
  import: 'Import',

  // the run
  phase: (phase: ImportPhase) => PHASES[phase],
  starting: 'Starting…',
  progress: (done: number, total: number) => `${count(done)} of ${count(total)}`,
  cancel: 'Cancel',
  cancelling: 'Cancelling…',

  // the report
  summary: summaryWords,
  reached: (summary: string) => `Before it stopped: ${summary}`,
  nothingKept: (name: string) => `Nothing from ${name} was kept: what the import reached was removed again.`,
  failure: (code: string | null) => FAILURES[code ?? 'unexpected'] ?? FAILURES.unexpected!,
  partitionedLine: (set: number, verified: number) => `${plural(set, 'partitioned cookie')} set, ${count(verified)} confirmed in the partition`,
  keychainLine,
  historyError,
  extensionsHeading: 'Extensions',
  extensionStatus,
  unsupportedHeading: "Permissions MAWS doesn't support",
  skippedSites: (store: Store, reason: string, n: number) => `${CATEGORIES[store]} · ${reason} (${count(n)})`,
  cookieReasons: {
    wrongKey: 'Could not be decrypted',
    corruptRow: 'Unreadable rows',
    expired: 'Expired',
    sameSiteNoneInsecure: 'Rejected by Chromium (SameSite=None without Secure)',
    rejected: 'Rejected by Chromium',
    notVerified: 'Partitioned cookies not confirmed in the partition',
    cancelled: 'Not imported (cancelled)',
  } satisfies Record<CookieSkipReason, string>,
  historyReasons: { hidden: 'Hidden pages', unsupportedScheme: "Pages MAWS's browser can't open", invalid: 'Unreadable history entries' } satisfies Record<HistorySkipReason, string>,
  nowActive: (name: string) => `New tabs browse as ${name}. Change in Settings › Browser.`,
  done: 'Done',
  close: 'Close',

  // the broken records file (Decision Log 35)
  profilesFileBroken: "MAWS's list of imported Chrome profiles couldn't be read and was set aside; their cookies and history were removed. Import the profiles again from Settings › Browser.",

  // Settings › Browser's extension toggles
  toggling: (enabled: boolean) => (enabled ? 'Turning on…' : 'Turning off…'),
  toggleFailed: (name: string, enabled: boolean, message: string) => `Couldn't turn ${name} ${enabled ? 'on' : 'off'}: ${message}`,

  // the removal (Design §12)
  removeTitle: (name: string) => `Remove ${name}?`,
  removeBody: (name: string, { history, extensions, tabs }: { history: number; extensions: number; tabs: number }) =>
    `Removes ${name}'s cookies and site data, its browsing history (${plural(history, 'entry', 'entries')} imported), ${plural(extensions, 'extension')} and its ${plural(tabs, 'open tab')} from MAWS. Chrome is untouched.`,
  removeAcknowledge: (name: string) => `Remove everything MAWS imported from ${name}`,
  remove: 'Remove',
  removeFailed: (message: string) => `Couldn't remove the profile: ${message}`,
};

// The Keychain outcome line under the summary, or null when it adds nothing: `allowed`, or `skipped` on a run that
// did not finish (its cookies were cancelled, which the summary says). `skipped` without an error is a cookie store
// with no rows (Decision Log 38); with one it is the store's code.
function keychainLine(cookies: NonNullable<ImportReport['cookies']>, outcome: ImportReport['outcome']): string | null {
  if (cookies.keychain === 'allowed') return null;
  if (cookies.keychain === 'skipped') {
    if (cookies.error !== null) return storeError('cookies', cookies.error);
    return outcome === 'done' ? 'This profile has no cookies to import' : null;
  }
  return KEYCHAIN[cookies.keychain];
}

// One imported extension's state in words (Design §10): loaded with its background, off, or why it is not running. An
// extension turned on whose profile was not opened this boot is `enabled` with status `off` (Decision Log 39).
function extensionStatus(extension: ImportedExtension): string {
  switch (extension.status) {
    case 'loaded':
      if (extension.background === 'running') return 'Loaded · background running';
      if (extension.background === 'none') return 'Loaded · no background';
      if (extension.background === 'stopped') return 'Loaded · background stopped';
      return extension.backgroundError === null ? 'Loaded · background failed' : `Loaded · background failed: ${extension.backgroundError}`;
    case 'off':
      if (extension.enabled) return 'On · loads when a tab next opens in this profile';
      return extension.wallet ? 'Off (wallet)' : 'Off';
    case 'loadFailed':
      return `Couldn't load: ${extension.error ?? 'unknown error'}`;
    case 'copyFailed':
      return "Couldn't copy";
  }
}
