// Readers for a *copy* of a Chrome profile's stores, and the mapping from a Chrome cookie row to Electron's
// session.cookies.set details. Nothing here prints a value: callers receive counts, shapes and decrypted rows they
// are responsible for keeping inside the partition.
import { DatabaseSync } from 'node:sqlite';
import { chromeTimeToUnixSeconds, decryptCookieValue, decryptPassword } from './crypto.mjs';

function openReadOnly(path) {
  return new DatabaseSync(path, { readOnly: true });
}

// Chrome's microsecond timestamps exceed 2^53, so statements read BigInts; everything that fits a safe integer comes
// back as a Number, the rest (the *_utc and date_* columns) stays a BigInt, which crypto.mjs's time helpers accept.
function rows(db, sql, ...params) {
  const stmt = db.prepare(sql);
  stmt.setReadBigInts(true);
  return stmt.all(...params).map(normalize);
}
function one(db, sql, ...params) {
  return rows(db, sql, ...params)[0];
}
function normalize(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' && v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  return out;
}

export function readHistory(path, { top = 10 } = {}) {
  const db = openReadOnly(path);
  try {
    const counts = one(db, `SELECT (SELECT count(*) FROM urls) AS urls, (SELECT count(*) FROM visits) AS visits, (SELECT sum(visit_count) FROM urls) AS visit_sum, (SELECT min(last_visit_time) FROM urls WHERE last_visit_time > 0) AS oldest, (SELECT max(last_visit_time) FROM urls) AS newest`);
    const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'urls'`).get().sql;
    const version = db.prepare(`SELECT value FROM meta WHERE key = 'version'`).get()?.value;
    // What an import would carry per row (the shape, from the first row only, redacted to field names and types).
    const sample = rows(db, `SELECT url, title, visit_count, typed_count, last_visit_time, hidden FROM urls ORDER BY visit_count DESC LIMIT ?`, top);
    const hostCounts = new Map();
    for (const row of rows(db, `SELECT url, visit_count FROM urls`)) {
      let host = '(unparsable)';
      try { host = new URL(row.url).hostname; } catch { /* keep */ }
      hostCounts.set(host, (hostCounts.get(host) ?? 0) + row.visit_count);
    }
    return {
      version,
      schema,
      counts: { ...counts, oldest: chromeTimeToUnixSeconds(counts.oldest ?? 0), newest: chromeTimeToUnixSeconds(counts.newest ?? 0) },
      rowShape: sample.length ? Object.fromEntries(Object.entries(sample[0]).map(([k, v]) => [k, typeof v])) : null,
      distinctHosts: hostCounts.size,
    };
  } finally {
    db.close();
  }
}

export function readCookieRows(path) {
  const db = openReadOnly(path);
  try {
    const version = db.prepare(`SELECT value FROM meta WHERE key = 'version'`).get()?.value;
    const list = rows(db, `SELECT creation_utc, host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, has_expires, is_persistent, samesite, source_scheme, source_port, has_cross_site_ancestor FROM cookies`);
    return { version: Number(version), rows: list };
  } finally {
    db.close();
  }
}

const SAMESITE = { [-1]: 'unspecified', 0: 'no_restriction', 1: 'lax', 2: 'strict' };

// Chrome row -> Electron cookies.set details. Returns { details } or { skipped: reason }.
export function toElectronCookie(row, key) {
  if (row.top_frame_site_key) return { skipped: 'partitioned (CHIPS) cookie: Electron cookies.set has no partition key' };
  if (row.samesite === 0 && !row.is_secure) return { skipped: 'SameSite=None without Secure: Chromium rejects it on set (EXCLUDE_SAMESITE_NONE_INSECURE)' };
  let value = row.value;
  let hashed = null;
  if (row.encrypted_value && row.encrypted_value.length) {
    const d = decryptCookieValue(key, row.host_key, Buffer.from(row.encrypted_value));
    value = d.value;
    hashed = d.hashed;
  }
  const bareHost = row.host_key.startsWith('.') ? row.host_key.slice(1) : row.host_key;
  const scheme = row.is_secure || row.source_scheme === 2 ? 'https' : 'http';
  const details = {
    url: `${scheme}://${bareHost}${row.path || '/'}`,
    name: row.name,
    value,
    path: row.path || '/',
    secure: Boolean(row.is_secure),
    httpOnly: Boolean(row.is_httponly),
    sameSite: SAMESITE[row.samesite] ?? 'unspecified',
  };
  // A leading dot is a domain cookie; without it Chrome stored a host-only cookie, which Electron sets when `domain`
  // is omitted.
  if (row.host_key.startsWith('.')) details.domain = row.host_key;
  if (row.has_expires && row.expires_utc) details.expirationDate = chromeTimeToUnixSeconds(row.expires_utc);
  return { details, hashed };
}

export function readLogins(path, key) {
  const db = openReadOnly(path);
  try {
    const version = db.prepare(`SELECT value FROM meta WHERE key = 'version'`).get()?.value;
    const list = rows(db, `SELECT origin_url, action_url, username_element, username_value, password_element, password_value, signon_realm, blacklisted_by_user, scheme, date_created, date_last_used, keychain_identifier FROM logins`);
    const out = { version: Number(version), total: list.length, blocklist: 0, decrypted: 0, emptyPassword: 0, failed: 0, keychainIdentifier: 0, credentials: [] };
    for (const r of list) {
      if (r.blacklisted_by_user) { out.blocklist++; continue; }
      if (r.keychain_identifier && r.keychain_identifier.length) out.keychainIdentifier++;
      if (!r.password_value || !r.password_value.length) { out.emptyPassword++; continue; }
      if (!key) continue;
      try {
        const password = decryptPassword(key, Buffer.from(r.password_value));
        out.decrypted++;
        out.credentials.push({ origin_url: r.origin_url, action_url: r.action_url, username_element: r.username_element, username_value: r.username_value, password_element: r.password_element, password, signon_realm: r.signon_realm });
      } catch {
        out.failed++;
      }
    }
    return out;
  } finally {
    db.close();
  }
}

export function readLocalStateProfiles(localStateJson) {
  const data = JSON.parse(localStateJson);
  const cache = data.profile?.info_cache ?? {};
  return Object.entries(cache).map(([dir, info]) => ({ dir, fields: Object.keys(info).sort(), hasName: typeof info.name === 'string', hasGaiaName: typeof info.gaia_name === 'string', hasUserName: typeof info.user_name === 'string', hasAvatar: typeof info.avatar_icon === 'string' }));
}
