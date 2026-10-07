// The synthetic Chrome user data directory (E4b execution document, Design §17): the layout, `Local State`'s two
// profiles, the stores' schemas, versions and rows, the encryption, the extensions' ids and the returned values.
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildChromeUserData, chromeExtensionId, COOKIES_SCHEMA, SENTINEL_PREFIX, SLOW_COPY_BYTES, type ChromeUserData } from './chrome-profile';

// E0b's recorded `urls` schema (spikes/browser-probe/results/all.json `import.realCopies.history.schema`, version 70).
const URLS_SCHEMA =
  'CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT,url LONGVARCHAR,title LONGVARCHAR,visit_count INTEGER DEFAULT 0 NOT NULL,typed_count INTEGER DEFAULT 0 NOT NULL,last_visit_time INTEGER NOT NULL,hidden INTEGER DEFAULT 0 NOT NULL)';
const PROBE_SOURCE = resolve(__dirname, '../../spikes/browser-probe/ext/test-ext');
const EXTENSION_ID = /^[a-p]{32}$/;

const roots: string[] = [];
const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), 'maws-chrome-fixture-'));
  roots.push(root);
  return join(root, 'Chrome');
};
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const open = (file: string) => {
  const db = new DatabaseSync(file, { readOnly: true });
  return db;
};
const rowsOf = (file: string, sql: string): Record<string, unknown>[] => {
  const db = open(file);
  try {
    const statement = db.prepare(sql);
    statement.setReadBigInts(true);
    return statement.all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
};
const metaVersion = (file: string) => rowsOf(file, "SELECT value FROM meta WHERE key = 'version'")[0]?.value;
const json = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;
interface LocalState {
  profile: { info_cache: Record<string, Record<string, unknown>>; last_used: string };
}
interface Manifest {
  key: string;
  name: string;
  version: string;
  manifest_version: number;
  description?: string;
  default_locale?: string;
  permissions?: string[];
  host_permissions?: string[];
  background?: unknown;
  content_scripts: { matches: string[] }[];
}
const manifestOf = (dir: string) => json<Manifest>(join(dir, 'manifest.json'));

// Chrome's macOS scheme, restated independently of the builder: PBKDF2-HMAC-SHA1, AES-128-CBC with sixteen spaces.
const keyOf = (password: string) => pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
function decryptRow(password: string, hostKey: string, blob: Uint8Array): string {
  const bytes = Buffer.from(blob);
  expect(bytes.subarray(0, 3).toString('latin1')).toBe('v10');
  const decipher = createDecipheriv('aes-128-cbc', keyOf(password), Buffer.alloc(16, 0x20));
  const plain = Buffer.concat([decipher.update(bytes.subarray(3)), decipher.final()]);
  if (!plain.subarray(0, 32).equals(createHash('sha256').update(hostKey, 'utf8').digest())) throw new Error('host hash mismatch');
  return plain.subarray(32).toString('utf8');
}

const CHROME_EPOCH_DELTA_US = 11644473600n * 1000000n;
const chromeTimeToMs = (time: bigint) => Number((time - CHROME_EPOCH_DELTA_US) / 1000n);

describe('chromeExtensionId', () => {
  it('maps the first 128 bits of SHA-256 to a-p, as Electron 44.4.5 derived E0b test extension id from its path', () => {
    // E0b loaded ext/test-ext unpacked (no `key`), so Electron derived the id from the directory path: results/all.json
    // `extensions.testExtension.id`. The same hash-and-map derives an id from a manifest key's SPKI DER.
    const path = '/Users/new/Developer/GitHub/MAWS/.claude/worktrees/agent-aeb92fd79dacad2a0/spikes/browser-probe/ext/test-ext';
    expect(chromeExtensionId(Buffer.from(path, 'utf8'))).toBe('cddgipniephaglaopjjeihjehogcpggh');
  });
});

describe('buildChromeUserData', () => {
  let fixture: ChromeUserData;
  beforeAll(() => {
    fixture = buildChromeUserData(scratch(), { host: '127.0.0.1' });
  });

  it("writes Local State with Chrome's two profiles, Default last used", () => {
    const state = json<LocalState>(join(fixture.dir, 'Local State'));
    expect(Object.keys(state.profile.info_cache)).toEqual(['Default', 'Profile 1']);
    expect(state.profile.info_cache.Default).toMatchObject({ name: 'Person 1', gaia_name: 'Probe Owner', user_name: 'probe@example.test' });
    expect(state.profile.info_cache['Profile 1']).toMatchObject({ name: 'Work', gaia_name: '', user_name: '' });
    expect(state.profile.last_used).toBe('Default');
    for (const profileDir of ['Default', 'Profile 1']) expect(statSync(join(fixture.dir, profileDir)).isDirectory()).toBe(true);
    expect(fixture.profiles.Default).toMatchObject({ profileDir: 'Default', name: 'Person 1', dir: join(fixture.dir, 'Default') });
    expect(fixture.profiles['Profile 1']).toMatchObject({ profileDir: 'Profile 1', name: 'Work', dir: join(fixture.dir, 'Profile 1') });
  });

  it("writes Default's History at version 70 with E0b's urls schema, an empty visits table and the six rows", () => {
    const file = join(fixture.dir, 'Default', 'History');
    expect(fixture.profiles.Default.history.file).toBe(file);
    expect(metaVersion(file)).toBe('70');
    expect(rowsOf(file, "SELECT sql FROM sqlite_master WHERE name = 'urls'")[0]?.sql).toBe(URLS_SCHEMA);
    expect(rowsOf(file, 'SELECT count(*) AS n FROM visits')[0]?.n).toBe(0n);

    const rows = rowsOf(file, 'SELECT url, title, visit_count, typed_count, last_visit_time, hidden FROM urls ORDER BY id');
    const { entries } = fixture.profiles.Default.history;
    expect(rows).toHaveLength(6);
    expect(entries).toHaveLength(6);
    rows.forEach((row, at) => {
      const entry = entries[at]!;
      expect(row.url).toBe(entry.url);
      expect(row.title).toBe(entry.title);
      expect(Number(row.visit_count)).toBe(entry.visitCount);
      expect(Number(row.typed_count)).toBe(entry.typedCount);
      expect(chromeTimeToMs(row.last_visit_time as bigint)).toBe(entry.lastVisitMs);
      expect(Number(row.hidden)).toBe(entry.hidden ? 1 : 0);
    });
    // Four importable http(s) rows with distinct counts and times, one hidden, one chrome:// page.
    const importable = entries.filter((entry) => entry.expected === 'imported');
    expect(importable).toHaveLength(4);
    for (const key of ['visitCount', 'typedCount', 'lastVisitMs', 'title'] as const) expect(new Set(importable.map((entry) => entry[key])).size).toBe(4);
    expect(importable.every((entry) => /^https?:\/\//.test(entry.url))).toBe(true);
    expect(entries.filter((entry) => entry.expected === 'hidden').map((entry) => entry.hidden)).toEqual([true]);
    expect(entries.filter((entry) => entry.expected === 'unsupportedScheme').map((entry) => entry.url.split('/')[0])).toEqual(['chrome:']);
    expect(fixture.profiles.Default.history.rows).toBe(6);
  });

  it("writes Default's Cookies at version 24 with E0b's schema: five rows, each value encrypted with SHA-256(host_key) first", () => {
    const file = join(fixture.dir, 'Default', 'Cookies');
    const { cookies } = fixture.profiles.Default;
    expect(cookies.file).toBe(file);
    expect(metaVersion(file)).toBe('24');
    expect(rowsOf(file, "SELECT sql FROM sqlite_master WHERE name = 'cookies'")[0]?.sql).toBe(COOKIES_SCHEMA);
    expect(rowsOf(file, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'cookies_unique_index'")).toHaveLength(1);

    const rows = rowsOf(file, 'SELECT * FROM cookies ORDER BY rowid');
    expect(rows.map((row) => row.name)).toEqual(['probe_session', 'probe_pref', 'probe_none_insecure', 'sid', '__Host-part']);
    expect(cookies.rows).toBe(5);
    expect(cookies.partitioned).toBe(1);
    rows.forEach((row, at) => {
      const entry = cookies.entries[at]!;
      expect(row.value).toBe(''); // every value is encrypted, as on the owner's store
      expect(decryptRow(fixture.password, row.host_key as string, row.encrypted_value as Uint8Array)).toBe(entry.value);
      expect(row).toMatchObject({
        host_key: entry.hostKey,
        top_frame_site_key: entry.topFrameSiteKey,
        path: entry.path,
        is_secure: BigInt(entry.secure ? 1 : 0),
        is_httponly: BigInt(entry.httpOnly ? 1 : 0),
        samesite: BigInt(entry.sameSite),
        has_expires: BigInt(entry.expiresMs === null ? 0 : 1),
        has_cross_site_ancestor: BigInt(entry.hasCrossSiteAncestor ? 1 : 0),
      });
      if (entry.expiresMs !== null) expect(chromeTimeToMs(row.expires_utc as bigint)).toBe(entry.expiresMs);
    });
    // The host rows are rewritten to the given host; the CHIPS row is host-only (undotted), as Chrome stores `__Host-`.
    expect(rows.slice(0, 3).map((row) => row.host_key)).toEqual(['127.0.0.1', '127.0.0.1', '127.0.0.1']);
    expect(rows[3]).toMatchObject({ host_key: '.example.test', is_secure: 1n, samesite: 2n });
    expect(rows[4]).toMatchObject({ host_key: 'embed.test', top_frame_site_key: 'https://example.test', samesite: 0n, is_secure: 1n });
    expect(rows[1]).toMatchObject({ samesite: -1n, has_expires: 0n, expires_utc: 0n });
    expect(rows[2]).toMatchObject({ samesite: 0n, is_secure: 0n });
  });

  it('writes the Safe Storage password and a wrong one beside the profiles; the wrong one decrypts none of the five rows', () => {
    expect(readFileSync(fixture.passwordFile, 'utf8')).toBe(fixture.password);
    expect(readFileSync(fixture.wrongPasswordFile, 'utf8')).toBe(fixture.wrongPassword);
    expect(fixture.passwordFile).toBe(join(fixture.dir, 'safe-storage-password.txt'));
    expect(fixture.wrongPasswordFile).toBe(join(fixture.dir, 'wrong-password.txt'));
    expect(fixture.wrongPassword).not.toBe(fixture.password);
    const rows = rowsOf(fixture.profiles.Default.cookies.file, 'SELECT host_key, encrypted_value FROM cookies');
    const failed = rows.filter((row) => {
      try {
        decryptRow(fixture.wrongPassword, row.host_key as string, row.encrypted_value as Uint8Array);
        return false;
      } catch {
        return true;
      }
    });
    expect(failed).toHaveLength(5); // E0b's wrongKey: 5 of 5
  });

  it('builds no password store', () => {
    for (const profileDir of ['Default', 'Profile 1']) {
      expect(existsSync(join(fixture.dir, profileDir, 'Login Data'))).toBe(false);
      expect(existsSync(join(fixture.dir, profileDir, 'Login Data For Account'))).toBe(false);
    }
  });

  it("gives Profile 1 its own stores: two history rows and one plain cookie under Network/", () => {
    const work = fixture.profiles['Profile 1'];
    expect(work.history.file).toBe(join(fixture.dir, 'Profile 1', 'History'));
    expect(rowsOf(work.history.file, 'SELECT count(*) AS n FROM urls')[0]?.n).toBe(2n);
    expect(work.history.entries.every((entry) => entry.expected === 'imported')).toBe(true);
    expect(work.cookies.file).toBe(join(fixture.dir, 'Profile 1', 'Network', 'Cookies'));
    expect(existsSync(join(fixture.dir, 'Profile 1', 'Cookies'))).toBe(false);
    const rows = rowsOf(work.cookies.file, 'SELECT host_key, top_frame_site_key, encrypted_value FROM cookies');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ host_key: '127.0.0.1', top_frame_site_key: '' });
    expect(decryptRow(fixture.password, '127.0.0.1', rows[0]!.encrypted_value as Uint8Array)).toBe(work.cookies.entries[0]!.value);
    expect(work.cookies).toMatchObject({ rows: 1, partitioned: 0 });
    expect(work.extensions).toEqual([fixture.extensions.workProbe.id]);
  });

  it('installs the four extensions under directories named by the id their manifest key derives', () => {
    const { probe, fails, wallet, disabled, workProbe } = fixture.extensions;
    expect(fixture.profiles.Default.extensions).toEqual([probe.id, fails.id, wallet.id, disabled.id]);
    expect(new Set([probe.id, fails.id, wallet.id, disabled.id, workProbe.id]).size).toBe(5);
    for (const extension of [probe, fails, wallet, disabled, workProbe]) {
      expect(extension.id).toMatch(EXTENSION_ID);
      const manifest = manifestOf(extension.dir);
      expect(chromeExtensionId(Buffer.from(manifest.key, 'base64'))).toBe(extension.id);
      expect(manifest.version).toBe(extension.version);
      expect(extension.dir).toBe(join(fixture.dir, extension.profileDir, 'Extensions', extension.id, `${extension.version}_0`));
    }
  });

  it('copies E0b probe extension with host permissions for the given host', () => {
    const { probe } = fixture.extensions;
    const manifest = manifestOf(probe.dir);
    const source = manifestOf(PROBE_SOURCE);
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*']);
    expect(manifest.content_scripts[0]?.matches).toEqual(['http://127.0.0.1/*']);
    expect(manifest.permissions).toEqual(source.permissions);
    expect(manifest.background).toEqual({ service_worker: 'sw.js' });
    expect(manifest.name).toBe(probe.name);
    for (const file of ['sw.js', 'content.js', 'offscreen.html', 'offscreen.js', 'panel.html']) {
      expect(readFileSync(join(probe.dir, file), 'utf8')).toBe(readFileSync(join(PROBE_SOURCE, file), 'utf8'));
    }
  });

  it('writes the failing extension: contextMenus alone, a worker reading chrome.contextMenus at its top level, two versions', () => {
    const { fails } = fixture.extensions;
    const manifest = manifestOf(fails.dir);
    expect(manifest).toMatchObject({ manifest_version: 3, permissions: ['contextMenus'], background: { service_worker: 'sw.js' } });
    expect(readFileSync(join(fails.dir, 'sw.js'), 'utf8').split('\n')[0]).toBe('chrome.contextMenus.onClicked.addListener(() => {});');
    // An older version directory beside it: the newest by version order (1.10 over 1.9) is the one to import.
    expect(readdirSync(join(fails.dir, '..')).sort()).toEqual(['1.10_0', '1.9_0']);
    expect(fails.version).toBe('1.10');
  });

  it('writes the wallet with its name and description behind _locales, and no background', () => {
    const { wallet } = fixture.extensions;
    const manifest = manifestOf(wallet.dir);
    expect(manifest).toMatchObject({ name: '__MSG_extName__', description: '__MSG_extDescription__', default_locale: 'en' });
    expect(manifest.background).toBeUndefined();
    const messages = json<Record<string, { message: string }>>(join(wallet.dir, '_locales', 'en', 'messages.json'));
    expect(messages.extName?.message).toBe('Probe Wallet');
    expect(messages.extDescription?.message).toBe('A crypto wallet for testing');
    expect(wallet.name).toBe('Probe Wallet');
  });

  it("records Chrome's view of each extension in Preferences: the disabled one by disable_reasons and state", () => {
    const { probe, fails, wallet, disabled } = fixture.extensions;
    const settings = json<{ extensions: { settings: Record<string, unknown> } }>(join(fixture.dir, 'Default', 'Preferences')).extensions.settings;
    expect(settings[disabled.id]).toEqual({ disable_reasons: [1], state: 0 });
    expect(settings[probe.id]).toEqual({ state: 1 });
    expect(settings[fails.id]).toEqual({ state: 1 });
    expect(settings[wallet.id]).toBeUndefined(); // absent: Chrome's state unknown
    expect(manifestOf(disabled.dir).name).toBe('Disabled in Chrome');
    expect(existsSync(join(fixture.dir, 'Profile 1', 'Preferences'))).toBe(false);
  });

  it('returns every value the logs must never show, each a long unique sentinel present in the stores', () => {
    const { Default: person, 'Profile 1': work } = fixture.profiles;
    const values = [...person.cookies.entries, ...work.cookies.entries].map((entry) => entry.value);
    const paths = [...person.history.entries, ...work.history.entries].map((entry) => new URL(entry.url).pathname.slice(1));
    const titles = [...person.history.entries, ...work.history.entries].map((entry) => entry.title);
    for (const sentinel of [...values, ...paths, ...titles]) {
      expect(sentinel.startsWith(SENTINEL_PREFIX)).toBe(true);
      expect(sentinel.length).toBeGreaterThanOrEqual(30);
      expect(fixture.sentinels).toContain(sentinel);
    }
    expect(fixture.sentinels).toContain(fixture.password);
    expect(fixture.sentinels).toContain(fixture.wrongPassword);
    expect(new Set(fixture.sentinels).size).toBe(fixture.sentinels.length);
    expect(fixture.sentinels).toHaveLength(values.length + paths.length + titles.length + 2);
  });

  it('pads nothing without slowCopy', () => {
    expect(existsSync(join(fixture.extensions.workProbe.dir, 'padding.bin'))).toBe(false);
  });
});

describe('buildChromeUserData options', () => {
  it("with slowCopy pads the Work profile's probe copy with zeros, and nothing else", () => {
    const fixture = buildChromeUserData(scratch(), { host: 'localhost', slowCopy: true });
    expect(statSync(join(fixture.extensions.workProbe.dir, 'padding.bin')).size).toBe(SLOW_COPY_BYTES);
    expect(SLOW_COPY_BYTES).toBe(64 * 1024 * 1024);
    expect(existsSync(join(fixture.extensions.probe.dir, 'padding.bin'))).toBe(false);
    expect(fixture.profiles.Default.cookies.entries[0]!.hostKey).toBe('localhost');
    expect(manifestOf(fixture.extensions.probe.dir).host_permissions).toEqual(['http://localhost/*']);
  });

  it('refuses a directory that already holds anything, so it never writes into a real Chrome folder', () => {
    const dir = scratch();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Local State'), '{}');
    expect(() => buildChromeUserData(dir)).toThrow(/not empty/);
    expect(readFileSync(join(dir, 'Local State'), 'utf8')).toBe('{}');
  });
});
