// Builds a synthetic Chrome profile under a scratch directory: a Cookies store (schema version 24) and a Login Data
// store (schema version 43) with the exact CREATE TABLE statements of a real Chrome 14x profile, encrypted with a
// freshly generated Safe Storage password. The password is written beside them as the stand-in for the Keychain
// item, so the decrypt path can be proved end to end without ever touching the owner's real key.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveKey, encryptCookieValue, encryptPassword, randomSafeStoragePassword, unixSecondsToChromeTime } from './crypto.mjs';

export const COOKIES_SCHEMA = `CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL,has_cross_site_ancestor INTEGER NOT NULL)`;
export const COOKIES_INDEX = `CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port)`;
export const LOGINS_SCHEMA = `CREATE TABLE logins (origin_url VARCHAR NOT NULL, action_url VARCHAR, username_element VARCHAR, username_value VARCHAR, password_element VARCHAR, password_value BLOB, submit_element VARCHAR, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL, scheme INTEGER NOT NULL, password_type INTEGER, times_used INTEGER, form_data BLOB, display_name VARCHAR, icon_url VARCHAR, federation_url VARCHAR, skip_zero_click INTEGER, generation_upload_status INTEGER, possible_username_pairs BLOB, id INTEGER PRIMARY KEY AUTOINCREMENT, date_last_used INTEGER NOT NULL DEFAULT 0, moving_blocked_for BLOB, date_password_modified INTEGER NOT NULL DEFAULT 0, sender_email VARCHAR, sender_name VARCHAR, date_received INTEGER, sharing_notification_displayed INTEGER NOT NULL DEFAULT 0, keychain_identifier BLOB, sender_profile_image_url VARCHAR, date_last_filled INTEGER NOT NULL DEFAULT 0, actor_login_approved INTEGER NOT NULL DEFAULT 0, UNIQUE (origin_url, username_element, username_value, password_element, signon_realm))`;

export const SYNTHETIC_COOKIES = [
  // host-only cookie on localhost, http, sent to the probe's own server: the end-to-end proof
  { host_key: 'localhost', name: 'probe_session', value: 'synthetic-session-token-1', path: '/', is_secure: 0, is_httponly: 1, samesite: 1, source_scheme: 1, source_port: 17333, expires_in_s: 86400 },
  // legacy cookie: samesite -1 (unspecified) as Chrome stores cookies set without a SameSite attribute; a session cookie
  { host_key: 'localhost', name: 'probe_pref', value: 'theme=light', path: '/', is_secure: 0, is_httponly: 0, samesite: -1, source_scheme: 1, source_port: 17333, expires_in_s: 0 },
  // SameSite=None without Secure: Chromium rejects it on set, so the import must skip it with a reason
  { host_key: 'localhost', name: 'probe_none_insecure', value: 'x', path: '/', is_secure: 0, is_httponly: 0, samesite: 0, source_scheme: 1, source_port: 17333, expires_in_s: 3600 },
  // domain cookie, secure, https origin: proves the mapping of a leading-dot host_key
  { host_key: '.example.test', name: 'sid', value: 'abc123', path: '/', is_secure: 1, is_httponly: 1, samesite: 2, source_scheme: 2, source_port: 443, expires_in_s: 3600 },
  // partitioned (CHIPS) cookie: Electron's cookies.set has no partition key, expected to be reported as skipped
  { host_key: '.embed.test', top_frame_site_key: 'https://example.test', has_cross_site_ancestor: 1, name: '__Host-part', value: 'p1', path: '/', is_secure: 1, is_httponly: 0, samesite: 0, source_scheme: 2, source_port: 443, expires_in_s: 3600 },
];

export const SYNTHETIC_LOGINS = [
  { origin_url: 'http://localhost:17333/index.html', action_url: 'http://localhost:17333/login', username_element: 'username', username_value: 'probe-user', password_element: 'password', password: 'correct horse battery staple', signon_realm: 'http://localhost:17333/', scheme: 0 },
  { origin_url: 'https://example.test/login', action_url: 'https://example.test/session', username_element: 'email', username_value: 'someone@example.test', password_element: 'pw', password: 'hunter2', signon_realm: 'https://example.test/', scheme: 0 },
  // a blocklist row ("never save for this site"): no password, blacklisted_by_user=1, as 91 of the owner's rows are
  { origin_url: 'https://never.test/', action_url: '', username_element: '', username_value: '', password_element: '', password: '', signon_realm: 'https://never.test/', scheme: 0, blacklisted_by_user: 1 },
];

export function buildSyntheticProfile(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const password = randomSafeStoragePassword();
  const key = deriveKey(password);
  writeFileSync(join(dir, 'safe-storage-password.txt'), password);

  const now = unixSecondsToChromeTime(Date.now() / 1000);
  const cookies = new DatabaseSync(join(dir, 'Cookies'));
  cookies.exec(`CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)`);
  cookies.exec(`INSERT INTO meta VALUES('version','24'),('last_compatible_version','24')`);
  cookies.exec(COOKIES_SCHEMA);
  cookies.exec(COOKIES_INDEX);
  const insCookie = cookies.prepare(`INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const c of SYNTHETIC_COOKIES) {
    const expires = c.expires_in_s ? unixSecondsToChromeTime(Date.now() / 1000 + c.expires_in_s) : 0n;
    insCookie.run(
      now, c.host_key, c.top_frame_site_key ?? '', c.name, '', encryptCookieValue(key, c.host_key, c.value), c.path, expires,
      c.is_secure, c.is_httponly, now, c.expires_in_s ? 1 : 0, c.expires_in_s ? 1 : 0, 1, c.samesite, c.source_scheme, c.source_port,
      now, 0, c.has_cross_site_ancestor ?? 0,
    );
  }
  cookies.close();

  const logins = new DatabaseSync(join(dir, 'Login Data'));
  logins.exec(`CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)`);
  logins.exec(`INSERT INTO meta VALUES('version','43'),('last_compatible_version','40')`);
  logins.exec(LOGINS_SCHEMA);
  logins.exec(`CREATE INDEX logins_signon ON logins (signon_realm)`);
  const insLogin = logins.prepare(`INSERT INTO logins (origin_url, action_url, username_element, username_value, password_element, password_value, submit_element, signon_realm, date_created, blacklisted_by_user, scheme, password_type, times_used, form_data, display_name, icon_url, federation_url, skip_zero_click, generation_upload_status, possible_username_pairs, date_last_used, moving_blocked_for, date_password_modified, sender_email, sender_name, date_received, sharing_notification_displayed, keychain_identifier, sender_profile_image_url, date_last_filled, actor_login_approved) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const l of SYNTHETIC_LOGINS) {
    insLogin.run(
      l.origin_url, l.action_url, l.username_element, l.username_value, l.password_element,
      l.password ? encryptPassword(key, l.password) : Buffer.alloc(0), '', l.signon_realm, now, l.blacklisted_by_user ?? 0, l.scheme, 0, 0,
      Buffer.alloc(0), '', '', '', 0, 0, Buffer.alloc(0), 0n, Buffer.alloc(0), now, '', '', 0n, 0, Buffer.alloc(0), '', 0n, 0,
    );
  }
  logins.close();
  return { dir, password, keyHex: key.toString('hex') };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const dir = process.argv[2] || '/tmp/maws-e0b-synth';
  const r = buildSyntheticProfile(dir);
  console.log(`synthetic profile at ${r.dir}: ${SYNTHETIC_COOKIES.length} cookies, ${SYNTHETIC_LOGINS.length} logins, key derived from a generated password (not printed)`);
}
