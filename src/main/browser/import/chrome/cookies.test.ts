// The cookie decoder over the synthetic Chrome profile (E4b Design §7 and §8; Acceptance G1): decrypt first, classify
// after, E0b's mapping to Electron's cookies.set details, and the CDP parameters for a partitioned row.
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildChromeUserData, type ChromeUserData, type FixtureCookie } from '../../../../../test/support/chrome-profile';
import { cookieStoreCounts, decodeCookieRow, readCookieRows, type ChromeCookieRow, type CookieDecode } from './cookies';

let root: string;
let fixture: ChromeUserData;
let rows: ChromeCookieRow[];
let storeVersion: number;
let key: Buffer;
const NOW = Date.now();

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-e4b-cookies-'));
  fixture = buildChromeUserData(join(root, 'Chrome'));
  key = pbkdf2Sync(fixture.password, 'saltysalt', 1003, 16, 'sha1');
  const db = new DatabaseSync(fixture.profiles.Default.cookies.file);
  try {
    ({ rows, storeVersion } = readCookieRows(db));
  } finally {
    db.close();
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const entry = (name: string): FixtureCookie => fixture.profiles.Default.cookies.entries.find((cookie) => cookie.name === name)!;
const row = (name: string): ChromeCookieRow => rows.find((candidate) => candidate.name === name)!;
const decode = (name: string, over: Partial<ChromeCookieRow> = {}, version = storeVersion, now = NOW): CookieDecode => decodeCookieRow({ ...row(name), ...over }, key, version, now);
const seconds = (ms: number) => Math.floor(ms / 1000);
const v10 = (plaintext: Buffer) => {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from('v10'), cipher.update(plaintext), cipher.final()]);
};

describe('reading a staged cookie store', () => {
  it('reads the five rows and the store version, every value still encrypted', () => {
    expect(storeVersion).toBe(24);
    expect(rows).toHaveLength(5);
    for (const candidate of rows) {
      expect(candidate.value).toBe('');
      expect(Buffer.from(candidate.encryptedValue).subarray(0, 3).toString()).toBe('v10');
      expect(typeof candidate.expiresUtc).toBe('bigint'); // Chrome time exceeds 2^53
    }
  });

  it('counts the rows, the partitioned ones and the version for the consent sheet', () => {
    const db = new DatabaseSync(fixture.profiles.Default.cookies.file);
    try {
      expect(cookieStoreCounts(db)).toEqual({ rows: 5, partitioned: 1, storeVersion: 24 });
    } finally {
      db.close();
    }
  });
});

describe('reading an older cookie store', () => {
  it('reads a store without has_cross_site_ancestor (before version 23), taking it as false', () => {
    const file = join(root, 'Cookies-v22');
    const db = new DatabaseSync(file);
    try {
      db.exec("CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR); INSERT INTO meta VALUES('version','22')");
      db.exec('CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL)');
      db.prepare('INSERT INTO cookies VALUES (0, ?, ?, ?, ?, ?, ?, 0, 1, 0, 0, 0, 0, 1, 0, 2, 443, 0, 0)').run('embed.test', 'https://example.test', 'old', 'plain-value', new Uint8Array(), '/');
      const read = readCookieRows(db);
      expect(read.storeVersion).toBe(22);
      expect(read.rows).toHaveLength(1);
      expect(read.rows[0]!.hasCrossSiteAncestor).toBe(false);
      expect(decodeCookieRow(read.rows[0]!, key, read.storeVersion, NOW)).toMatchObject({ kind: 'partitioned', cdp: { partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false } } });
    } finally {
      db.close();
    }
  });
});

describe('decodeCookieRow on the fixture’s five rows', () => {
  it('decodes 3 plain, 1 partitioned and 1 SameSite=None-without-Secure skip (the probe’s counts)', () => {
    const decodes = rows.map((candidate) => decodeCookieRow(candidate, key, storeVersion, NOW));
    expect(decodes.filter((d) => d.kind === 'plain')).toHaveLength(3);
    expect(decodes.filter((d) => d.kind === 'partitioned')).toHaveLength(1);
    expect(decodes.filter((d) => d.kind === 'skipped').map((d) => d.kind === 'skipped' && d.reason)).toEqual(['sameSiteNoneInsecure']);
    expect(decodes.every((d) => d.decrypted)).toBe(true);
  });

  it('maps a host-only http cookie as E0b did: no domain, http, lax, httpOnly, an expiry in seconds', () => {
    const session = entry('probe_session');
    expect(decode('probe_session')).toEqual({
      kind: 'plain',
      host: fixture.host,
      decrypted: true,
      details: { url: `http://${fixture.host}/`, name: 'probe_session', value: session.value, path: '/', secure: false, httpOnly: true, sameSite: 'lax', expirationDate: seconds(session.expiresMs!) },
    });
  });

  it('leaves a Chrome session cookie without an expiry, so it stays a session cookie (Decision Log 10)', () => {
    expect(decode('probe_pref')).toEqual({
      kind: 'plain',
      host: fixture.host,
      decrypted: true,
      details: { url: `http://${fixture.host}/`, name: 'probe_pref', value: entry('probe_pref').value, path: '/', secure: false, httpOnly: false, sameSite: 'unspecified' },
    });
  });

  it('sets a domain only for a dotted host key, on https for a secure row', () => {
    const sid = entry('sid');
    expect(decode('sid')).toEqual({
      kind: 'plain',
      host: 'example.test',
      decrypted: true,
      details: { url: 'https://example.test/', name: 'sid', value: sid.value, path: '/', domain: '.example.test', secure: true, httpOnly: true, sameSite: 'strict', expirationDate: seconds(sid.expiresMs!) },
    });
  });

  it('decodes the partitioned row to Network.setCookie parameters only, never to cookies.set details', () => {
    const part = entry('__Host-part');
    const decoded = decode('__Host-part');
    expect(decoded).toEqual({
      kind: 'partitioned',
      host: 'embed.test',
      decrypted: true,
      cdp: {
        name: '__Host-part',
        value: part.value,
        url: 'https://embed.test/',
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'None',
        expires: seconds(part.expiresMs!),
        partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: true },
      },
    });
    expect(decoded).not.toHaveProperty('details');
    // A __Host- row is host-only in Chrome's store, so no domain reaches CDP (Chromium's sanitiser refuses one).
    expect(decoded.kind === 'partitioned' && 'domain' in decoded.cdp).toBe(false);
  });

  it('gives a dotted partitioned row its domain and maps SameSite words for CDP', () => {
    const over = { hostKey: '.embed.test', name: 'part2' };
    const blob = v10(Buffer.concat([createHash('sha256').update('.embed.test').digest(), Buffer.from('x')]));
    const lax = decode('__Host-part', { ...over, encryptedValue: blob, sameSite: 1 });
    expect(lax.kind === 'partitioned' && lax.cdp).toMatchObject({ domain: '.embed.test', sameSite: 'Lax', url: 'https://embed.test/' });
    const strict = decode('__Host-part', { ...over, encryptedValue: blob, sameSite: 2 });
    expect(strict.kind === 'partitioned' && strict.cdp.sameSite).toBe('Strict');
    const unspecified = decode('__Host-part', { ...over, encryptedValue: blob, sameSite: -1 });
    expect(unspecified.kind === 'partitioned' && 'sameSite' in unspecified.cdp).toBe(false);
  });

  it('skips SameSite=None without Secure after decrypting it', () => {
    expect(decode('probe_none_insecure')).toEqual({ kind: 'skipped', reason: 'sameSiteNoneInsecure', host: fixture.host, decrypted: true });
  });
});

describe('decodeCookieRow’s failures', () => {
  it('fails all five rows as wrongKey with a wrong key, decrypting none (E0b’s 5 of 5)', () => {
    const wrong = pbkdf2Sync(fixture.wrongPassword, 'saltysalt', 1003, 16, 'sha1');
    const decodes = rows.map((candidate) => decodeCookieRow(candidate, wrong, storeVersion, NOW));
    expect(decodes.map((d) => (d.kind === 'skipped' ? d.reason : d.kind))).toEqual(['wrongKey', 'wrongKey', 'wrongKey', 'wrongKey', 'wrongKey']);
    expect(decodes.some((d) => d.decrypted)).toBe(false);
    for (const decoded of decodes) expect(JSON.stringify(decoded)).not.toContain('e4b-sentinel-');
  });

  it('decrypts before it classifies: an expired row with a wrong key is wrongKey, with the right key expired', () => {
    const later = NOW + 2 * 24 * 3_600_000;
    expect(decode('probe_session', {}, storeVersion, later)).toEqual({ kind: 'skipped', reason: 'expired', host: fixture.host, decrypted: true });
    const wrong = pbkdf2Sync('not the password', 'saltysalt', 1003, 16, 'sha1');
    expect(decodeCookieRow(row('probe_session'), wrong, storeVersion, later)).toMatchObject({ kind: 'skipped', reason: 'wrongKey' });
  });

  it('never expires a session cookie', () => {
    expect(decode('probe_pref', {}, storeVersion, NOW + 365 * 24 * 3_600_000).kind).toBe('plain');
  });

  it('gates the host hash on the store version: a bare value reads at version 23 and fails at 24', () => {
    const bare = v10(Buffer.from('bare-value'));
    const at23 = decode('probe_session', { encryptedValue: bare }, 23);
    expect(at23.kind === 'plain' && at23.details.value).toBe('bare-value');
    expect(decode('probe_session', { encryptedValue: bare }, 24)).toMatchObject({ kind: 'skipped', reason: 'wrongKey', decrypted: false });
  });

  it('calls a value without the v10 prefix a corrupt row, not a wrong key', () => {
    expect(decode('probe_session', { encryptedValue: Buffer.from('v11garbage-garbage') })).toEqual({ kind: 'skipped', reason: 'corruptRow', host: fixture.host, decrypted: false });
  });

  it('calls a row whose URL cannot be built a corrupt row', () => {
    const hostKey = 'bad host';
    const blob = v10(Buffer.concat([createHash('sha256').update(hostKey).digest(), Buffer.from('x')]));
    expect(decode('probe_session', { hostKey, encryptedValue: blob })).toMatchObject({ kind: 'skipped', reason: 'corruptRow', decrypted: true });
  });

  it('takes a row with a plain value and no encrypted value as it is, not as a decrypt', () => {
    const decoded = decode('probe_session', { value: 'plain-value', encryptedValue: new Uint8Array() });
    expect(decoded).toMatchObject({ kind: 'plain', decrypted: false, details: { value: 'plain-value' } });
  });
});
