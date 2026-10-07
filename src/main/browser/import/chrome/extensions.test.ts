// The extension inspection (E4b Design §9; Acceptance G1): candidates from a profile's `Extensions/`, names resolved
// through `_locales`, the permissions Electron lacks, wallets, Chrome's own enabled state, and refusals.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildChromeUserData, type ChromeUserData } from '../../../../../test/support/chrome-profile';
import { compareChromeVersions, inspectExtensions, type InspectedExtension } from './extensions';

let root: string;
let fixture: ChromeUserData;
let found: InspectedExtension[];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'maws-e4b-extensions-'));
  fixture = buildChromeUserData(join(root, 'Chrome'));
  found = await inspectExtensions(fixture.profiles.Default.dir);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const byId = (id: string) => found.find((extension) => extension.candidate.id === id)!;
const treeSize = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? treeSize(join(dir, entry.name)) : statSync(join(dir, entry.name)).size), 0);

// A scratch profile with hand-written extensions.
let counter = 0;
function profile(): string {
  const dir = join(root, `profile-${++counter}`);
  mkdirSync(join(dir, 'Extensions'), { recursive: true });
  return dir;
}
function install(profileDir: string, id: string, version: string, manifest: unknown): string {
  const dir = join(profileDir, 'Extensions', id, version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return dir;
}
const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);

describe('inspectExtensions over the fixture’s Default profile', () => {
  it('finds the four installed extensions with their names resolved as Electron resolves them', () => {
    const { probe, fails, wallet, disabled } = fixture.extensions;
    expect(found.map((extension) => extension.candidate.id).sort()).toEqual([probe.id, fails.id, wallet.id, disabled.id].sort());
    expect(byId(probe.id).candidate.name).toBe('MAWS probe extension');
    expect(byId(wallet.id).candidate.name).toBe('Probe Wallet'); // __MSG_extName__ through _locales/en
    expect(byId(disabled.id).candidate.name).toBe('Disabled in Chrome');
  });

  it('describes the probe extension: MV3, a worker, a content script, five permissions MAWS lacks, Chrome-enabled', () => {
    const { probe } = fixture.extensions;
    expect(byId(probe.id)).toEqual({
      versionDir: probe.dir,
      candidate: {
        id: probe.id,
        name: 'MAWS probe extension',
        version: '1.0',
        manifestVersion: 3,
        background: 'service_worker',
        contentScripts: 1,
        unsupportedPermissions: ['cookies', 'webNavigation', 'contextMenus', 'notifications', 'sidePanel'],
        wallet: false,
        chromeState: 'enabled',
        sizeBytes: treeSize(probe.dir),
        error: null,
      },
    });
  });

  it('takes the highest version directory (1.10 over 1.9)', () => {
    const fails = byId(fixture.extensions.fails.id);
    expect(fails.candidate.version).toBe('1.10');
    expect(fails.versionDir).toBe(fixture.extensions.fails.dir);
    expect(fails.candidate.unsupportedPermissions).toEqual(['contextMenus']);
  });

  it('marks the wallet by its words and reads Chrome’s state from Preferences', () => {
    expect(byId(fixture.extensions.wallet.id).candidate).toMatchObject({ wallet: true, chromeState: 'unknown', background: 'none', contentScripts: 0 });
    expect(byId(fixture.extensions.disabled.id).candidate).toMatchObject({ wallet: false, chromeState: 'disabled' });
  });
});

describe('inspectExtensions’ rules', () => {
  it('marks a wallet by its verified id whatever its name', async () => {
    const dir = profile();
    install(dir, 'nkbihfbeogaeaoehlefnkodbefgpgknn', '11.0.0_0', { manifest_version: 3, name: 'Some Extension', version: '11.0.0' });
    expect((await inspectExtensions(dir))[0]!.candidate.wallet).toBe(true);
  });

  it('takes only directories named as extension ids, and version directories by their pattern', async () => {
    const dir = profile();
    install(dir, 'Temp', '1.0_0', { manifest_version: 3, name: 'No', version: '1.0' });
    install(dir, 'q'.repeat(32), '1.0_0', { manifest_version: 3, name: 'No', version: '1.0' });
    install(dir, ID_A, '1.0_0', { manifest_version: 3, name: 'Yes', version: '1.0' });
    install(dir, ID_A, '../escape', { manifest_version: 3, name: 'No', version: '9.0' });
    install(dir, ID_A, 'Temp', { manifest_version: 3, name: 'No', version: '9.0' });
    expect((await inspectExtensions(dir)).map((extension) => [extension.candidate.id, extension.candidate.name])).toEqual([[ID_A, 'Yes']]);
  });

  it('refuses a tree holding a symlink, and an extension directory that is one', async () => {
    const dir = profile();
    const versionDir = install(dir, ID_A, '1.0_0', { manifest_version: 3, name: 'Linked', version: '1.0' });
    mkdirSync(join(versionDir, 'lib'));
    symlinkSync('/etc/hosts', join(versionDir, 'lib', 'hosts'));
    symlinkSync(join(fixture.profiles.Default.dir, 'Extensions', fixture.extensions.probe.id), join(dir, 'Extensions', ID_B));
    const result = await inspectExtensions(dir);
    expect(result.find((extension) => extension.candidate.id === ID_A)!.candidate).toMatchObject({ error: 'symlink', name: 'Linked' });
    expect(result.find((extension) => extension.candidate.id === ID_B)).toMatchObject({ versionDir: null, candidate: { error: 'symlink' } });
  });

  it('reports missing files and an unreadable manifest as the row’s error', async () => {
    const dir = profile();
    mkdirSync(join(dir, 'Extensions', ID_A, '1.0_0'), { recursive: true });
    install(dir, ID_B, '2.0_0', '{ not json e4b-sentinel-manifest');
    const result = await inspectExtensions(dir);
    expect(result.find((extension) => extension.candidate.id === ID_A)).toMatchObject({ versionDir: null, candidate: { error: 'missing', name: ID_A } });
    const broken = result.find((extension) => extension.candidate.id === ID_B)!;
    expect(broken.candidate).toMatchObject({ error: 'manifest', name: ID_B, version: '2.0' });
    expect(JSON.stringify(broken)).not.toContain('sentinel');
  });

  it('refuses a manifest version Electron cannot load', async () => {
    const dir = profile();
    install(dir, ID_A, '1.0_0', { manifest_version: 1, name: 'Old', version: '1.0' });
    expect((await inspectExtensions(dir))[0]!.candidate.error).toBe('manifest');
  });

  it('reads a background page or scripts as a page, and falls back to _locales/en for a missing default locale', async () => {
    const dir = profile();
    const versionDir = install(dir, ID_A, '1.0_0', { manifest_version: 2, name: '__MSG_Name__', default_locale: 'fr', version: '1.0', background: { scripts: ['bg.js'] } });
    mkdirSync(join(versionDir, '_locales', 'en'), { recursive: true });
    writeFileSync(join(versionDir, '_locales', 'en', 'messages.json'), JSON.stringify({ name: { message: 'Localised' } })); // keys are case-insensitive
    expect((await inspectExtensions(dir))[0]!.candidate).toMatchObject({ name: 'Localised', manifestVersion: 2, background: 'page' });
  });

  it('reads Chrome’s state from Secure Preferences first, a disable_reasons bitmask included', async () => {
    const dir = profile();
    install(dir, ID_A, '1.0_0', { manifest_version: 3, name: 'A', version: '1.0' });
    install(dir, ID_B, '1.0_0', { manifest_version: 3, name: 'B', version: '1.0' });
    writeFileSync(join(dir, 'Secure Preferences'), JSON.stringify({ extensions: { settings: { [ID_A]: { disable_reasons: 4 } } } }));
    writeFileSync(join(dir, 'Preferences'), JSON.stringify({ extensions: { settings: { [ID_A]: { state: 1 }, [ID_B]: { disable_reasons: [] } } } }));
    const states = Object.fromEntries((await inspectExtensions(dir)).map((extension) => [extension.candidate.id, extension.candidate.chromeState]));
    expect(states).toEqual({ [ID_A]: 'disabled', [ID_B]: 'enabled' });
  });

  it('answers no candidates for a profile without Extensions/', async () => {
    const dir = join(root, 'bare');
    mkdirSync(dir);
    expect(await inspectExtensions(dir)).toEqual([]);
  });
});

describe('compareChromeVersions', () => {
  it('compares dotted numbers numerically', () => {
    expect(compareChromeVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareChromeVersions('2.0', '2.0.0')).toBeLessThan(0);
    expect(compareChromeVersions('3.1', '3.1')).toBe(0);
  });
});
