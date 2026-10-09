import { describe, expect, it } from 'vitest';
import {
  CHROME_PROFILE_DIR,
  ChromeProfileSchema,
  ELECTRON_ABSENT_PERMISSIONS,
  EXTENSION_ID,
  ExtensionCandidateSchema,
  IMPORT_HOSTS_MAX,
  ImportCategoriesSchema,
  ImportedExtensionSchema,
  ImportPhaseSchema,
  ImportReportSchema,
  isWalletExtension,
  KeychainOutcomeSchema,
  WALLET_EXTENSION_IDS,
} from './import';
import { DONE_REPORT, PROBE_EXTENSION } from '../../../test/support/import-reports';

const CANDIDATE = {
  id: 'cddgipniephaglaopjjeihjehogcpggh', name: 'Probe', version: '1.0', manifestVersion: 3, background: 'service_worker', contentScripts: 1,
  unsupportedPermissions: ['cookies', 'webNavigation', 'contextMenus', 'notifications', 'sidePanel'], wallet: false, chromeState: 'enabled',
  sizeBytes: 4096, error: null,
} as const;

describe('the Chrome profile directory and extension id rules', () => {
  it('admits the profile directories Chrome names and refuses paths', () => {
    for (const dir of ['Default', 'Profile 1', 'Profile 12', 'Guest Profile', 'System_Profile.2'])
      expect(CHROME_PROFILE_DIR.test(dir), dir).toBe(true);
    for (const dir of ['../x', 'a/b', '', '.', '..', ' Default', '.hidden', 'a\\b', 'x'.repeat(65), 'Profile\n1'])
      expect(CHROME_PROFILE_DIR.test(dir), JSON.stringify(dir)).toBe(false);
  });

  it('takes an extension id as 32 letters a to p', () => {
    expect(EXTENSION_ID.test('nkbihfbeogaeaoehlefnkodbefgpgknn')).toBe(true);
    for (const id of ['nkbihfbeogaeaoehlefnkodbefgpgkn', 'nkbihfbeogaeaoehlefnkodbefgpgknnn', 'NKBIHFBEOGAEAOEHLEFNKODBEFGPGKNN', 'zkbihfbeogaeaoehlefnkodbefgpgknn', '../bihfbeogaeaoehlefnkodbefgpgknn'])
      expect(EXTENSION_ID.test(id), id).toBe(false);
  });
});

describe('wallet recognition (P-21: wallets start off)', () => {
  it('knows every seed id by its listing, each a valid extension id, once', () => {
    expect(WALLET_EXTENSION_IDS.length).toBeGreaterThan(0);
    expect(new Set(WALLET_EXTENSION_IDS).size).toBe(WALLET_EXTENSION_IDS.length);
    for (const id of WALLET_EXTENSION_IDS) expect(EXTENSION_ID.test(id), id).toBe(true);
    expect(isWalletExtension({ id: 'nkbihfbeogaeaoehlefnkodbefgpgknn', name: 'Something', description: null })).toBe(true); // MetaMask, by id alone
  });

  it('recognises a wallet by the words of its name or description', () => {
    const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(isWalletExtension({ id, name: 'Probe Wallet', description: null })).toBe(true);
    expect(isWalletExtension({ id, name: 'Probe', description: 'A crypto wallet for testing' })).toBe(true);
    for (const name of ['MetaMask', 'Solana Wallets', 'web3 helper', 'Bitcoin ticker', 'DeFi dashboard', 'Dapps launcher', 'Ethereum tools', 'PHANTOM'])
      expect(isWalletExtension({ id, name, description: '' }), name).toBe(true);
  });

  it('leaves words that only contain a wallet word alone', () => {
    const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    for (const name of ['Wallpaper Changer', 'Cryptography notes', 'Google Translate', 'Walletless reader'])
      expect(isWalletExtension({ id, name, description: 'Changes your wallpaper' }), name).toBe(false);
  });
});

describe('the import shapes (E4b Interfaces)', () => {
  it('accepts a Chrome profile and refuses an extra key or a path for a directory', () => {
    const profile = { profileDir: 'Default', name: 'Person 1', gaiaName: 'Probe Owner', userName: 'probe@example.test', lastUsed: true, imported: false };
    expect(ChromeProfileSchema.parse(profile)).toEqual(profile);
    expect(ChromeProfileSchema.safeParse({ ...profile, gaiaName: null, userName: null }).success).toBe(true);
    expect(ChromeProfileSchema.safeParse({ ...profile, avatar: 'x' }).success).toBe(false);
    expect(ChromeProfileSchema.safeParse({ ...profile, profileDir: '../Default' }).success).toBe(false);
    expect(ChromeProfileSchema.safeParse({ ...profile, name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('accepts an extension candidate and refuses an extra key, an unknown permission or a bad id', () => {
    expect(ExtensionCandidateSchema.parse(CANDIDATE)).toEqual(CANDIDATE);
    expect(ExtensionCandidateSchema.safeParse({ ...CANDIDATE, background: 'none', manifestVersion: 2, chromeState: 'unknown', error: 'symlink' }).success).toBe(true);
    expect(ExtensionCandidateSchema.safeParse({ ...CANDIDATE, path: '/x' }).success).toBe(false);
    expect(ExtensionCandidateSchema.safeParse({ ...CANDIDATE, unsupportedPermissions: ['storage'] }).success).toBe(false);
    expect(ExtensionCandidateSchema.safeParse({ ...CANDIDATE, manifestVersion: 4 }).success).toBe(false);
    expect(ExtensionCandidateSchema.safeParse({ ...CANDIDATE, id: 'probe' }).success).toBe(false);
  });

  // Advisory (Design §9): the list's contents follow Electron and are not pinned; only its shape is.
  it('lists the permissions Electron lacks once each', () => {
    expect(new Set(ELECTRON_ABSENT_PERMISSIONS).size).toBe(ELECTRON_ABSENT_PERMISSIONS.length);
  });

  it('takes the categories, the phases and the Keychain outcomes as closed sets', () => {
    const categories = { history: true, cookies: false, extensions: true, bookmarks: true }; // cua #90: bookmarks
    expect(ImportCategoriesSchema.parse(categories)).toEqual(categories);
    expect(ImportCategoriesSchema.safeParse({ ...categories, passwords: false }).success).toBe(false);
    expect(ImportCategoriesSchema.safeParse({ history: true, cookies: false, extensions: true }).success).toBe(false);
    expect(ImportPhaseSchema.options).toEqual(['copying', 'history', 'keychain', 'cookies', 'verifying', 'bookmarks', 'extensions', 'cleaning']);
    expect(KeychainOutcomeSchema.options).toEqual(['allowed', 'denied', 'missing', 'timeout', 'wrongKey', 'skipped']);
  });

  it('accepts an imported extension and refuses an extra key', () => {
    expect(ImportedExtensionSchema.parse(PROBE_EXTENSION)).toEqual(PROBE_EXTENSION);
    expect(ImportedExtensionSchema.safeParse({ ...PROBE_EXTENSION, status: 'copyFailed', error: 'EACCES', background: 'none' }).success).toBe(true);
    expect(ImportedExtensionSchema.safeParse({ ...PROBE_EXTENSION, path: '/x' }).success).toBe(false);
    expect(ImportedExtensionSchema.safeParse({ ...PROBE_EXTENSION, status: 'running' }).success).toBe(false);
    // Persisted in profiles.json: a permission a later Electron gains must not make an old record unreadable.
    expect(ImportedExtensionSchema.safeParse({ ...PROBE_EXTENSION, unsupportedPermissions: ['someFuturePermission'] }).success).toBe(true);
  });

  it('accepts the report and refuses an extra key, a missing skip count or too many hosts', () => {
    expect(ImportReportSchema.parse(DONE_REPORT)).toEqual(DONE_REPORT);
    expect(ImportReportSchema.safeParse({ ...DONE_REPORT, history: null, cookies: null, extensions: null, outcome: 'failed', failure: 'the partition could not be created' }).success).toBe(true);
    expect(ImportReportSchema.safeParse({ ...DONE_REPORT, rows: [] }).success).toBe(false);
    const cookies = DONE_REPORT.cookies!;
    const withoutExpired: Partial<typeof cookies.skipped> = { ...cookies.skipped };
    delete withoutExpired.expired;
    expect(ImportReportSchema.safeParse({ ...DONE_REPORT, cookies: { ...cookies, skipped: withoutExpired } }).success).toBe(false);
    expect(ImportReportSchema.safeParse({ ...DONE_REPORT, cookies: { ...cookies, skipped: { ...cookies.skipped, stale: 1 } } }).success).toBe(false);
    const hosts = Array.from({ length: IMPORT_HOSTS_MAX + 1 }, (_, i) => `h${i}.test`);
    expect(ImportReportSchema.safeParse({ ...DONE_REPORT, cookies: { ...cookies, hosts: { rejected: hosts.slice(1) } } }).success).toBe(true);
    expect(ImportReportSchema.safeParse({ ...DONE_REPORT, cookies: { ...cookies, hosts: { rejected: hosts } } }).success).toBe(false);
  });

  it('refuses a report whose partition is not the profile’s own', () => {
    expect(ImportReportSchema.safeParse({ ...DONE_REPORT, partition: 'persist:maws-browser' }).success).toBe(false);
    expect(ImportReportSchema.safeParse({ ...DONE_REPORT, partition: 'persist:maws-chrome-Profile 1' }).success).toBe(false);
  });

  it('refuses more partitioned cookies verified than set', () => {
    const cookies = DONE_REPORT.cookies;
    expect(ImportReportSchema.safeParse({ ...DONE_REPORT, cookies: { ...cookies, partitioned: { imported: 2, verified: 2 } } }).success).toBe(true);
    expect(ImportReportSchema.safeParse({ ...DONE_REPORT, cookies: { ...cookies, partitioned: { imported: 1, verified: 2 } } }).success).toBe(false);
  });
});
