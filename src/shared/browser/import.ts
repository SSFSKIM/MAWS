// The Chrome profile import (E4b execution document, Interfaces; P1 interface ledger §5 `browser.import.*`): what main
// reads from a Chrome user data directory, what the owner consents to, and the report an import ends with. Main owns
// the import; the renderer shows these shapes and every string in them (a profile's name, an extension's name) as text.
// Nothing here carries a cookie value, a cookie name, a URL path or a page title: the report keeps counts and hosts.
import * as z from 'zod';
import { BrowserPartitionSchema, profilePartition } from './tab';

// A key of `Local State`'s `profile.info_cache` (`Default`, `Profile 1`, …), and so a directory name under the user data
// directory: no separator, no leading dot (E4b Design §2). Main re-checks it against `info_cache` and the disk.
export const CHROME_PROFILE_DIR = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
// A Chrome extension id: 32 letters a to p, the directory name under a profile's `Extensions/` (Design §9).
export const EXTENSION_ID = /^[a-p]{32}$/;
export const IMPORT_TEXT_MAX = 1024; // every free-text field (an error's first line, a path)
export const IMPORT_NAME_MAX = 200; // names: a profile's, an extension's, a version
export const IMPORT_HOSTS_MAX = 20; // the hosts a report lists per skip reason (Decision Log 22)

export const ChromeProfileDirSchema = z.string().regex(CHROME_PROFILE_DIR);
export const ExtensionIdSchema = z.string().regex(EXTENSION_ID);
const TextSchema = z.string().max(IMPORT_TEXT_MAX);
const NameSchema = z.string().max(IMPORT_NAME_MAX);
const HostSchema = z.string().min(1).max(255);
const CountSchema = z.number().int().min(0);
const InstantSchema = z.iso.datetime();

// Chrome extension permissions Electron 44.4.5 does not implement (E0b's stderr digest and the probe's `present` table).
// Advisory: an extension asking for one gets a warning in its row, never a refusal; revisit when Electron moves.
export const ELECTRON_ABSENT_PERMISSIONS = [
  'bookmarks', 'commands', 'contentSettings', 'contextMenus', 'cookies', 'debugger', 'declarativeContent', 'downloads', 'favicon', 'history',
  'identity', 'nativeMessaging', 'notifications', 'pageCapture', 'privacy', 'proxy', 'search', 'sessions', 'sidePanel', 'tabGroups', 'topSites',
  'webNavigation', 'webRequestAuthProvider',
] as const;

// Wallet extensions by their Chrome Web Store id (Decision Log 8), each confirmed against its listing page
// (`https://chromewebstore.google.com/detail/<id>`); an id the page did not confirm is left out, not guessed.
export const WALLET_EXTENSION_IDS: readonly string[] = [
  'nkbihfbeogaeaoehlefnkodbefgpgknn', // MetaMask, verified 2026-10-06
  'bfnaelmomeimhlpmgjnjophhpkkoljpa', // Phantom, verified 2026-10-06
  'hnfanknocfeofbddgcijnmhnfnkdnaad', // Coinbase Wallet extension, verified 2026-10-06
  'acmacodkjbdgmoleebolmdjonilkdbch', // Rabby Wallet, verified 2026-10-06
  'egjidjbpglichdcondbcbdnbeeppgdph', // Trust Wallet, verified 2026-10-06
  'dmkamcknogkgcdfhhbddcghachkejeap', // Keplr, verified 2026-10-06
  'mcohilncbfahbmgdjkbpemcciiolgcge', // OKX Wallet, verified 2026-10-06
  'opfgelmcmbiajamepnmloijbpoleiama', // Rainbow, verified 2026-10-06
  'aflkmfhebedbjioipglgcbcmnbpgliof', // Backpack, verified 2026-10-06
  'bhhhlbepdkbapadjdnnojkbgioiodbic', // Solflare Wallet, verified 2026-10-06
  'dlcobpjiigpikoobohmabehhmhfoodbb', // Ready X (formerly Argent X, Argent Labs), verified 2026-10-06
  'fijngjgcjhjmmpcmkeiomlglpeiijkld', // Talisman Wallet, verified 2026-10-06
  'aholpfdialjgjfhomihkjbmgjidlcdno', // Exodus Web3 Wallet, verified 2026-10-06
  'klghhnkeealcohjjanjjdaeeggmfmlpl', // Zerion Wallet, verified 2026-10-06
];
const WALLET_WORDS = /\b(wallet|metamask|phantom|ethereum|solana|web3|crypto|bitcoin|defi|dapp)s?\b/i;

// P-21: a wallet starts off. A false positive costs the owner one toggle.
export function isWalletExtension(extension: { id: string; name: string; description?: string | null }): boolean {
  return WALLET_EXTENSION_IDS.includes(extension.id) || WALLET_WORDS.test(extension.name) || WALLET_WORDS.test(extension.description ?? '');
}

// A profile `Local State` names (E0b S1e: `name` shown, `gaia_name` and `user_name` muted; nothing else is read).
export const ChromeProfileSchema = z.strictObject({
  profileDir: ChromeProfileDirSchema,
  name: NameSchema,
  gaiaName: NameSchema.nullable(),
  userName: NameSchema.nullable(),
  lastUsed: z.boolean(), // `profile.last_used`: the picker preselects it
  imported: z.boolean(), // a record exists: not importable again until removed (Decision Log 2)
});
export type ChromeProfile = z.infer<typeof ChromeProfileSchema>;

// An extension the inspection found in the profile's `Extensions/` (Design §9), before consent.
export const ExtensionCandidateSchema = z.strictObject({
  id: ExtensionIdSchema,
  name: NameSchema, // resolved through `_locales` as Electron would
  version: NameSchema,
  manifestVersion: z.union([z.literal(2), z.literal(3)]),
  background: z.enum(['service_worker', 'page', 'none']),
  contentScripts: CountSchema,
  unsupportedPermissions: z.array(z.enum(ELECTRON_ABSENT_PERMISSIONS)),
  wallet: z.boolean(),
  chromeState: z.enum(['enabled', 'disabled', 'unknown']), // `disabled` arrives unchecked (Decision Log 9)
  sizeBytes: CountSchema,
  error: z.enum(['symlink', 'manifest', 'missing']).nullable(), // set: the row is disabled
});
export type ExtensionCandidate = z.infer<typeof ExtensionCandidateSchema>;

export const ImportCategoriesSchema = z.strictObject({ history: z.boolean(), cookies: z.boolean(), extensions: z.boolean() });
export type ImportCategories = z.infer<typeof ImportCategoriesSchema>;

export const ImportPhaseSchema = z.enum(['copying', 'history', 'keychain', 'cookies', 'verifying', 'extensions', 'cleaning']);
export type ImportPhase = z.infer<typeof ImportPhaseSchema>;

// `wrongKey`: the Keychain answered, and every attempted decrypt failed (Design §7); `skipped`: cookies were chosen but
// the store could not be copied, so the Keychain was never asked.
export const KeychainOutcomeSchema = z.enum(['allowed', 'denied', 'missing', 'timeout', 'wrongKey', 'skipped']);
export type KeychainOutcome = z.infer<typeof KeychainOutcomeSchema>;

export const COOKIE_SKIP_REASONS = ['wrongKey', 'corruptRow', 'expired', 'sameSiteNoneInsecure', 'rejected', 'notVerified', 'cancelled'] as const;
export const CookieSkipReasonSchema = z.enum(COOKIE_SKIP_REASONS);
export type CookieSkipReason = z.infer<typeof CookieSkipReasonSchema>;

export const HISTORY_SKIP_REASONS = ['hidden', 'unsupportedScheme', 'invalid'] as const;
export const HistorySkipReasonSchema = z.enum(HISTORY_SKIP_REASONS);
export type HistorySkipReason = z.infer<typeof HistorySkipReasonSchema>;

// One imported extension as the profile's record keeps it (persisted in `profiles.json`, so its permission names are
// any bounded string: a permission a later Electron implements must not make an old record unreadable).
export const ImportedExtensionSchema = z.strictObject({
  id: ExtensionIdSchema, // Electron's loaded id (Chrome's, from the manifest's `key`), or Chrome's directory id when never loaded
  chromeId: ExtensionIdSchema.nullable(), // Chrome's directory id when Electron derived another (Decision Log 20)
  name: NameSchema,
  version: NameSchema,
  enabled: z.boolean(), // the owner's toggle; `!wallet` at import (P-21)
  wallet: z.boolean(),
  unsupportedPermissions: z.array(NameSchema),
  status: z.enum(['loaded', 'off', 'loadFailed', 'copyFailed']),
  error: TextSchema.nullable(), // the failure's first line or code
  background: z.enum(['running', 'failed', 'stopped', 'none']),
  backgroundError: TextSchema.nullable(), // the worker's uncaught error, naming the absent `chrome.*` member
  checkedAt: InstantSchema,
});
export type ImportedExtension = z.infer<typeof ImportedExtensionSchema>;

const hostsBy = <const R extends readonly [string, ...string[]]>(reasons: R) => z.partialRecord(z.enum(reasons), z.array(HostSchema).max(IMPORT_HOSTS_MAX));
const countsBy = <const R extends readonly [string, ...string[]]>(reasons: R) => z.record(z.enum(reasons), CountSchema); // every reason present

// The report an import ends with (Design §10), kept whole on the record. Per category a block, or null when the owner
// did not choose it. Cookies count each row once: `imported` is the plain rows set, `partitioned.imported` the
// partitioned rows set, of which `partitioned.verified` were confirmed in the partition; a set partitioned row not
// confirmed is also `skipped.notVerified`, so the summary's set count is `imported + partitioned.verified`.
export const ImportReportSchema = z
  .strictObject({
    profileDir: ChromeProfileDirSchema,
    name: NameSchema,
    partition: BrowserPartitionSchema,
    startedAt: InstantSchema,
    finishedAt: InstantSchema,
    outcome: z.enum(['done', 'cancelled', 'failed']),
    failure: TextSchema.nullable(), // why a `failed` run could not continue
    history: z
      .strictObject({ imported: CountSchema, skipped: countsBy(HISTORY_SKIP_REASONS), hosts: hostsBy(HISTORY_SKIP_REASONS), error: TextSchema.nullable() })
      .nullable(),
    cookies: z
      .strictObject({
        imported: CountSchema,
        partitioned: z.strictObject({ imported: CountSchema, verified: CountSchema }),
        skipped: countsBy(COOKIE_SKIP_REASONS),
        hosts: hostsBy(COOKIE_SKIP_REASONS),
        keychain: KeychainOutcomeSchema,
        error: TextSchema.nullable(),
      })
      .nullable(),
    extensions: z.array(ImportedExtensionSchema).nullable(),
  })
  .refine((report) => report.partition === profilePartition(report.profileDir), { message: 'not the profile’s own partition', path: ['partition'] });
export type ImportReport = z.infer<typeof ImportReportSchema>;
