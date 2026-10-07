// Chrome's cookie store, decoded (E4b Design §7 and §8; E0b's stores.mjs `readCookieRows` and `toElectronCookie`). Pure
// over an opened copy: rows in, decodes out. Decrypt first, classify after (Decision Log 25), so a wrong key fails
// every encrypted row whatever else is wrong with it. A decode holds the cookie's value; the caller keeps it inside the
// loop that sets it and never logs it. A partitioned row decodes to CDP parameters only, never to cookies.set details.
import type { DatabaseSync } from 'node:sqlite';
import type { CookiesSetDetails } from 'electron';
import type { CookieSkipReason } from '@shared/browser/import';
import { chromeTimeToUnixMs, chromeTimeToUnixSeconds, COOKIE_HOST_HASH_FROM_VERSION, DecryptError, decryptCookieValue } from './crypto';
import { allRows, countOf, storeVersion } from './sqlite';

export interface ChromeCookieRow {
  hostKey: string; // `.example.test` for a domain cookie, `example.test` for a host-only one
  topFrameSiteKey: string; // '' for an unpartitioned row
  name: string;
  value: string; // '' when the value is encrypted
  encryptedValue: Uint8Array;
  path: string;
  expiresUtc: bigint; // Chrome time
  isSecure: boolean;
  isHttpOnly: boolean;
  hasExpires: boolean;
  sameSite: number; // -1 unspecified, 0 None, 1 Lax, 2 Strict
  sourceScheme: number; // 0 unset, 1 http, 2 https
  hasCrossSiteAncestor: boolean;
}

// `Network.setCookie`'s parameters for a partitioned (CHIPS) row (A-33 item 8; E4-0 pass2/main.mjs `chipsScenario`).
export interface NetworkSetCookieParams {
  name: string;
  value: string;
  url: string;
  domain?: string;
  path: string;
  secure: true;
  httpOnly: boolean;
  sameSite?: 'None' | 'Lax' | 'Strict';
  expires?: number; // seconds
  partitionKey: { topLevelSite: string; hasCrossSiteAncestor: boolean };
}

// `decrypted`: the value came from a successful decrypt. The wrong-key verdict is "at least one decrypt attempted and
// none succeeded", so rows with a plain value (decrypted: false, never attempted) do not count toward it.
export type CookieDecodeSkipReason = Extract<CookieSkipReason, 'wrongKey' | 'corruptRow' | 'expired' | 'sameSiteNoneInsecure'>;
export type CookieDecode =
  | { kind: 'plain'; details: CookiesSetDetails; host: string; decrypted: boolean }
  | { kind: 'partitioned'; cdp: NetworkSetCookieParams; host: string; decrypted: boolean }
  | { kind: 'skipped'; reason: CookieDecodeSkipReason; host: string; decrypted: boolean };

const COLUMNS =
  'host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, has_expires, samesite, source_scheme, has_cross_site_ancestor';

export function readCookieRows(db: DatabaseSync): { storeVersion: number; rows: ChromeCookieRow[] } {
  const version = storeVersion(db);
  const rows = allRows(db, `SELECT ${COLUMNS} FROM cookies`).map(
    (row): ChromeCookieRow => ({
      hostKey: String(row.host_key ?? ''),
      topFrameSiteKey: String(row.top_frame_site_key ?? ''),
      name: String(row.name ?? ''),
      value: String(row.value ?? ''),
      encryptedValue: row.encrypted_value instanceof Uint8Array ? row.encrypted_value : new Uint8Array(),
      path: String(row.path ?? ''),
      expiresUtc: BigInt((row.expires_utc as bigint | number | null) ?? 0),
      isSecure: Boolean(row.is_secure),
      isHttpOnly: Boolean(row.is_httponly),
      hasExpires: Boolean(row.has_expires),
      sameSite: Number(row.samesite ?? -1),
      sourceScheme: Number(row.source_scheme ?? 0),
      hasCrossSiteAncestor: Boolean(row.has_cross_site_ancestor),
    }),
  );
  return { storeVersion: version, rows };
}

// What the consent sheet shows: "5,112 cookies (1,005 partitioned)" (Design §3).
export function cookieStoreCounts(db: DatabaseSync): { rows: number; partitioned: number; storeVersion: number } {
  return {
    rows: countOf(db, 'SELECT count(*) AS n FROM cookies'),
    partitioned: countOf(db, "SELECT count(*) AS n FROM cookies WHERE top_frame_site_key <> ''"),
    storeVersion: storeVersion(db),
  };
}

const SAME_SITE: Record<number, CookiesSetDetails['sameSite']> = { [-1]: 'unspecified', 0: 'no_restriction', 1: 'lax', 2: 'strict' };
const CDP_SAME_SITE: Record<number, NetworkSetCookieParams['sameSite']> = { 0: 'None', 1: 'Lax', 2: 'Strict' };

export function decodeCookieRow(row: ChromeCookieRow, key: Buffer, version: number, nowMs: number = Date.now()): CookieDecode {
  const host = row.hostKey.startsWith('.') ? row.hostKey.slice(1) : row.hostKey;
  const skip = (reason: CookieDecodeSkipReason, decrypted: boolean): CookieDecode => ({ kind: 'skipped', reason, host, decrypted });

  let value = row.value;
  let decrypted = false;
  if (row.encryptedValue.length > 0) {
    try {
      value = decryptCookieValue(key, row.hostKey, row.encryptedValue, { requireHostHash: version >= COOKIE_HOST_HASH_FROM_VERSION }).value;
      decrypted = true;
    } catch (error) {
      return skip(error instanceof DecryptError && error.kind === 'prefix' ? 'corruptRow' : 'wrongKey', false);
    }
  }

  if (row.hasExpires && chromeTimeToUnixMs(row.expiresUtc) < nowMs) return skip('expired', decrypted); // Decision Log 11
  if (row.sameSite === 0 && !row.isSecure) return skip('sameSiteNoneInsecure', decrypted); // Chromium: EXCLUDE_SAMESITE_NONE_INSECURE
  const path = row.path || '/';
  // A leading dot is a domain cookie; without one Chrome stored a host-only cookie, set by omitting `domain`.
  const domain = row.hostKey.startsWith('.') ? { domain: row.hostKey } : {};
  const expiry = row.hasExpires ? chromeTimeToUnixSeconds(row.expiresUtc) : null; // none: a session cookie (Decision Log 10)

  if (row.topFrameSiteKey !== '') {
    const url = urlOf('https', host, path);
    if (url === null) return skip('corruptRow', decrypted);
    const sameSite = CDP_SAME_SITE[row.sameSite];
    const cdp: NetworkSetCookieParams = {
      name: row.name,
      value,
      url,
      ...domain,
      path,
      secure: true,
      httpOnly: row.isHttpOnly,
      ...(sameSite ? { sameSite } : {}),
      ...(expiry === null ? {} : { expires: expiry }),
      partitionKey: { topLevelSite: row.topFrameSiteKey, hasCrossSiteAncestor: row.hasCrossSiteAncestor },
    };
    return { kind: 'partitioned', cdp, host, decrypted };
  }

  const url = urlOf(row.isSecure || row.sourceScheme === 2 ? 'https' : 'http', host, path);
  if (url === null) return skip('corruptRow', decrypted);
  const details: CookiesSetDetails = {
    url,
    name: row.name,
    value,
    path,
    ...domain,
    secure: row.isSecure,
    httpOnly: row.isHttpOnly,
    sameSite: SAME_SITE[row.sameSite] ?? 'unspecified',
    ...(expiry === null ? {} : { expirationDate: expiry }),
  };
  return { kind: 'plain', details, host, decrypted };
}

function urlOf(scheme: 'http' | 'https', host: string, path: string): string | null {
  if (host === '') return null;
  const text = `${scheme}://${host}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    new URL(text);
    return text;
  } catch {
    return null;
  }
}
