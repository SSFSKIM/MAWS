// The synthetic Chrome user data directory, E4b's only Chrome fixture (E4b execution document, Design §17): no unit test,
// e2e or manual run reads the owner's Chrome. Lifted from E0b's spikes/browser-probe/import/{synthetic,crypto}.mjs (the
// cookie store's schema, index and row writer; the Safe Storage encryption) and extended to a whole user data
// directory: `Local State` with two profiles, `History` and `Cookies` per profile, `Preferences`, and installed
// extensions whose directory names are the ids their manifest keys derive, as Chrome's are. Every cookie value, history
// path and history title is a long unique sentinel, returned with the passwords so the e2e can assert that none of them
// reaches a log. No password store is built (Decision Log 6).
// cua board #90: Default also has a `Bookmarks` file (`writeChromeBookmarks`; its URLs' paths are sentinels too) and
// a 64×64 PNG as its Google profile picture, named by `Local State`'s `gaia_picture_file_name`.
import { createCipheriv, createHash, generateKeyPairSync, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';

export const SENTINEL_PREFIX = 'e4b-sentinel-';
export const SLOW_COPY_BYTES = 64 * 1024 * 1024; // the Work profile's probe copy, padded so its copy can be cancelled into

// E0b's probe extension (an MV3 worker, a content script marking the page, an offscreen document), copied as it is.
const PROBE_SOURCE = resolve(__dirname, '../../spikes/browser-probe/ext/test-ext');
const PROBE_FILES = ['sw.js', 'content.js', 'offscreen.html', 'offscreen.js', 'panel.html', 'popup.html', 'popup.js', 'options.html', 'options.js']; // cua #90: its popup and options page

// --- Lifted from E0b's crypto.mjs (the encryption half): Chrome's macOS Safe Storage scheme. The AES key is
// PBKDF2-HMAC-SHA1(password, "saltysalt", 1003, 16 bytes); a value is "v10" + AES-128-CBC(iv = 16 spaces, PKCS#7), and a
// cookie store at version 24 or later encrypts SHA-256(host_key) + value.
const PREFIX = Buffer.from('v10');
const IV = Buffer.alloc(16, 0x20);
const deriveKey = (safeStoragePassword: string) => pbkdf2Sync(safeStoragePassword, 'saltysalt', 1003, 16, 'sha1');
// Chrome stores a base64 string of 16 random bytes; the derivation treats it as the UTF-8 password.
const randomSafeStoragePassword = () => randomBytes(16).toString('base64');
function encrypt(key: Buffer, plaintext: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([PREFIX, cipher.update(plaintext), cipher.final()]);
}
const hostHash = (hostKey: string) => createHash('sha256').update(hostKey, 'utf8').digest();
const encryptCookieValue = (key: Buffer, hostKey: string, value: string) => encrypt(key, Buffer.concat([hostHash(hostKey), Buffer.from(value, 'utf8')]));
// Chrome time: microseconds since 1601-01-01 UTC. Whole milliseconds, so a reader converting back gets the same number.
const EPOCH_DELTA_US = 11644473600n * 1000000n;
const msToChromeTime = (ms: number) => BigInt(ms) * 1000n + EPOCH_DELTA_US;

// --- Lifted from E0b's synthetic.mjs: a real Chrome 14x profile's cookie store (schema version 24).
export const COOKIES_SCHEMA = `CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL,has_cross_site_ancestor INTEGER NOT NULL)`;
export const COOKIES_INDEX = `CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port)`;
const META_SCHEMA = 'CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)';
// E0b's recorded `urls` schema (results/all.json `import.realCopies.history.schema`, store version 70).
export const URLS_SCHEMA = `CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT,url LONGVARCHAR,title LONGVARCHAR,visit_count INTEGER DEFAULT 0 NOT NULL,typed_count INTEGER DEFAULT 0 NOT NULL,last_visit_time INTEGER NOT NULL,hidden INTEGER DEFAULT 0 NOT NULL)`;
// Chromium's `visits` table at history version 70 (components/history/core/browser/visit_database.cc). E0b recorded only
// its row count; nothing in MAWS reads it, so it is written for the store's shape and left empty.
const VISITS_SCHEMA = `CREATE TABLE visits(id INTEGER PRIMARY KEY AUTOINCREMENT,url INTEGER NOT NULL,visit_time INTEGER NOT NULL,from_visit INTEGER,external_referrer_url TEXT,transition INTEGER DEFAULT 0 NOT NULL,segment_id INTEGER,visit_duration INTEGER DEFAULT 0 NOT NULL,incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,opener_visit INTEGER,originator_cache_guid TEXT,originator_visit_id INTEGER,originator_from_visit INTEGER,originator_opener_visit INTEGER,is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,visited_link_id INTEGER DEFAULT 0 NOT NULL,app_id TEXT)`;

export interface FixtureCookie {
  hostKey: string;
  topFrameSiteKey: string; // '' for an unpartitioned row
  hasCrossSiteAncestor: boolean;
  name: string;
  value: string; // a sentinel
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: -1 | 0 | 1 | 2; // unspecified, None, Lax, Strict
  sourceScheme: 1 | 2; // http, https
  expiresMs: number | null; // null: a session cookie (has_expires 0)
}

export interface FixtureHistoryEntry {
  url: string; // its path a sentinel
  title: string; // a sentinel
  visitCount: number;
  typedCount: number;
  lastVisitMs: number;
  hidden: boolean;
  expected: 'imported' | 'hidden' | 'unsupportedScheme'; // what E4b's history import does with the row
}

export interface FixtureExtension {
  profileDir: string;
  id: string; // chromeExtensionId(the manifest key's SPKI DER), the directory name
  name: string; // as resolved (through _locales for the wallet)
  version: string;
  dir: string; // the version directory, <profile>/Extensions/<id>/<version>_0
}

// cua #90: a bookmark node as the fixture writes it; a URL node's `url` is absolute, any scheme.
export type FixtureBookmark = { name: string; url: string } | { name: string; children: FixtureBookmark[] };
export interface FixtureBookmarks {
  bar: FixtureBookmark[];
  other: FixtureBookmark[];
  synced: FixtureBookmark[];
}

export interface FixtureProfile {
  profileDir: string;
  name: string;
  dir: string;
  // cua #90: the `Bookmarks` file as written, and each URL bookmark's URL by name; null when the profile has none
  bookmarks: { file: string; roots: FixtureBookmarks; urls: Record<string, string> } | null;
  picture: string | null; // cua #90: the Google profile picture's path
  history: { file: string; rows: number; entries: FixtureHistoryEntry[] };
  cookies: { file: string; rows: number; partitioned: number; storeVersion: 24; entries: FixtureCookie[] };
  extensions: string[]; // ids, in Extensions/
}

export interface ChromeUserData {
  dir: string; // the user data directory (MAWS_E2E_CHROME_USER_DATA)
  host: string;
  password: string; // the Safe Storage password the Keychain stand-in holds
  wrongPassword: string;
  passwordFile: string; // <dir>/safe-storage-password.txt (MAWS_E2E_KEYCHAIN=file:<path>)
  wrongPasswordFile: string;
  profiles: { Default: FixtureProfile; 'Profile 1': FixtureProfile };
  extensions: { probe: FixtureExtension; fails: FixtureExtension; wallet: FixtureExtension; disabled: FixtureExtension; workProbe: FixtureExtension };
  sentinels: string[]; // every cookie value, history path and title, and both passwords: none may ever reach a log
}

export interface ChromeUserDataOptions {
  host?: string; // the host the cookie rows, the history rows and the probe's host permissions name (default 127.0.0.1)
  bookmarksOrigin?: string; // cua #90: the origin Default's bookmark URLs name (default http://<host>)
  slowCopy?: boolean; // pad the Work profile's probe copy with SLOW_COPY_BYTES of zeros
}

// Chrome's extension id: the first 128 bits of SHA-256 over the input (a manifest key's SPKI DER, or an unpacked
// directory's path when there is no key), each hex digit mapped 0-f to a-p.
export function chromeExtensionId(bytes: Uint8Array): string {
  const hex = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return hex.replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
}

export function buildChromeUserData(dir: string, { host = '127.0.0.1', slowCopy = false, bookmarksOrigin = `http://${host}` }: ChromeUserDataOptions = {}): ChromeUserData {
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).length > 0) throw new Error(`${dir} is not empty; the Chrome fixture is built only into a fresh directory`);
  const sentinels: string[] = [];
  const sentinel = (kind: 'cookie' | 'path' | 'title') => {
    const value = `${SENTINEL_PREFIX}${kind}-${randomBytes(8).toString('hex')}`;
    sentinels.push(value);
    return value;
  };

  const password = randomSafeStoragePassword();
  const wrongPassword = randomSafeStoragePassword();
  const key = deriveKey(password);
  const passwordFile = join(dir, 'safe-storage-password.txt');
  const wrongPasswordFile = join(dir, 'wrong-password.txt');
  writeFileSync(passwordFile, password);
  writeFileSync(wrongPasswordFile, wrongPassword);

  writeJson(join(dir, 'Local State'), {
    profile: {
      info_cache: {
        Default: {
          name: 'Person 1', gaia_name: 'Probe Owner', user_name: 'probe@example.test', avatar_icon: 'chrome://theme/IDR_PROFILE_AVATAR_26', is_using_default_name: true,
          gaia_picture_file_name: GAIA_PICTURE, // cua #90
        },
        'Profile 1': { name: 'Work', gaia_name: '', user_name: '', avatar_icon: 'chrome://theme/IDR_PROFILE_AVATAR_4', is_using_default_name: false },
      },
      last_used: 'Default',
      profiles_order: ['Default', 'Profile 1'],
    },
  });

  const now = Date.now();
  const hour = 3_600_000;
  const day = 24 * hour;
  const http = `http://${host}`;

  // Default ("Person 1"): six history rows (four importable, one hidden, one chrome:// page) and E0b's five cookies.
  const personDir = join(dir, 'Default');
  const personHistory: FixtureHistoryEntry[] = [
    { url: `${http}/${sentinel('path')}`, title: sentinel('title'), visitCount: 12, typedCount: 3, lastVisitMs: now - hour, hidden: false, expected: 'imported' },
    { url: `https://example.test/${sentinel('path')}`, title: sentinel('title'), visitCount: 7, typedCount: 1, lastVisitMs: now - day, hidden: false, expected: 'imported' },
    { url: `https://www.example.test/${sentinel('path')}`, title: sentinel('title'), visitCount: 3, typedCount: 0, lastVisitMs: now - 2 * day, hidden: false, expected: 'imported' },
    { url: `${http}/${sentinel('path')}`, title: sentinel('title'), visitCount: 5, typedCount: 2, lastVisitMs: now - 3 * day, hidden: false, expected: 'imported' },
    { url: `https://example.test/${sentinel('path')}`, title: sentinel('title'), visitCount: 1, typedCount: 0, lastVisitMs: now - 4 * day, hidden: true, expected: 'hidden' },
    { url: `chrome://settings/${sentinel('path')}`, title: sentinel('title'), visitCount: 2, typedCount: 0, lastVisitMs: now - 5 * day, hidden: false, expected: 'unsupportedScheme' },
  ];
  // E0b's SYNTHETIC_COOKIES with `localhost` rewritten to the host, every value a sentinel, and the CHIPS row host-only
  // (`embed.test`, undotted): Chrome stores a `__Host-` cookie host-only, and Chromium refuses one set with a domain.
  const personCookies: FixtureCookie[] = [
    { hostKey: host, topFrameSiteKey: '', hasCrossSiteAncestor: false, name: 'probe_session', value: sentinel('cookie'), path: '/', secure: false, httpOnly: true, sameSite: 1, sourceScheme: 1, expiresMs: now + day },
    { hostKey: host, topFrameSiteKey: '', hasCrossSiteAncestor: false, name: 'probe_pref', value: sentinel('cookie'), path: '/', secure: false, httpOnly: false, sameSite: -1, sourceScheme: 1, expiresMs: null },
    { hostKey: host, topFrameSiteKey: '', hasCrossSiteAncestor: false, name: 'probe_none_insecure', value: sentinel('cookie'), path: '/', secure: false, httpOnly: false, sameSite: 0, sourceScheme: 1, expiresMs: now + hour },
    { hostKey: '.example.test', topFrameSiteKey: '', hasCrossSiteAncestor: false, name: 'sid', value: sentinel('cookie'), path: '/', secure: true, httpOnly: true, sameSite: 2, sourceScheme: 2, expiresMs: now + hour },
    { hostKey: 'embed.test', topFrameSiteKey: 'https://example.test', hasCrossSiteAncestor: true, name: '__Host-part', value: sentinel('cookie'), path: '/', secure: true, httpOnly: false, sameSite: 0, sourceScheme: 2, expiresMs: now + hour },
  ];

  // Profile 1 ("Work"): two history rows and one plain cookie, its store under Network/ (the other place Chrome keeps it).
  const workDir = join(dir, 'Profile 1');
  const workHistory: FixtureHistoryEntry[] = [
    { url: `${http}/${sentinel('path')}`, title: sentinel('title'), visitCount: 4, typedCount: 1, lastVisitMs: now - 2 * hour, hidden: false, expected: 'imported' },
    { url: `https://example.test/${sentinel('path')}`, title: sentinel('title'), visitCount: 2, typedCount: 0, lastVisitMs: now - day, hidden: false, expected: 'imported' },
  ];
  const workCookies: FixtureCookie[] = [
    { hostKey: host, topFrameSiteKey: '', hasCrossSiteAncestor: false, name: 'work_session', value: sentinel('cookie'), path: '/', secure: false, httpOnly: true, sameSite: 1, sourceScheme: 1, expiresMs: now + day },
  ];
  sentinels.push(password, wrongPassword);

  // cua #90: Default's bookmarks (the spec's Acceptance): bar A, B, a bookmarklet the import skips, folder F (F1, F2 and
  // folder G with G1), then N01 to N40 so the bar overflows; O1 under Other bookmarks; Mobile bookmarks empty. 46 URLs
  // kept, 1 skipped.
  const mark = (name: string): FixtureBookmark => ({ name, url: `${bookmarksOrigin}/bookmark/${name}/${sentinel('path')}` });
  const personBookmarks: FixtureBookmarks = {
    bar: [
      mark('A'),
      mark('B'),
      { name: 'Bookmarklet', url: 'javascript:void(document.title)' },
      { name: 'F', children: [mark('F1'), mark('F2'), { name: 'G', children: [mark('G1')] }] },
      ...Array.from({ length: 40 }, (_, k) => mark(`N${String(k + 1).padStart(2, '0')}`)),
    ],
    other: [mark('O1')],
    synced: [],
  };

  const person: FixtureProfile = {
    profileDir: 'Default',
    name: 'Person 1',
    dir: personDir,
    history: writeHistory(join(personDir, 'History'), personHistory),
    cookies: writeCookies(join(personDir, 'Cookies'), personCookies, key, now),
    extensions: [],
    bookmarks: writeChromeBookmarks(join(personDir, 'Bookmarks'), personBookmarks, now), // cua #90
    picture: writePng(join(personDir, GAIA_PICTURE), 64), // cua #90
  };
  const work: FixtureProfile = {
    profileDir: 'Profile 1',
    name: 'Work',
    dir: workDir,
    history: writeHistory(join(workDir, 'History'), workHistory),
    cookies: writeCookies(join(workDir, 'Network', 'Cookies'), workCookies, key, now),
    extensions: [],
    bookmarks: null, // cua #90: no Bookmarks file, no picture
    picture: null,
  };

  const probe = installExtension(personDir, (manifestKey) => probeManifest(host, manifestKey), probeFiles);
  const fails = installExtension(
    personDir,
    (manifestKey, version) => ({
      manifest_version: 3,
      name: 'Probe fails',
      version,
      action: { default_title: 'Probe fails', default_popup: 'popup.html' }, // cua #103: failure, not a missing popup, mutes this action
      description: 'Its worker reads chrome.contextMenus, which MAWS does not provide',
      permissions: ['contextMenus'],
      background: { service_worker: 'sw.js' },
      key: manifestKey,
    }),
    (versionDir) => {
      writeFileSync(join(versionDir, 'sw.js'), 'chrome.contextMenus.onClicked.addListener(() => {});\n');
      writeFileSync(join(versionDir, 'popup.html'), '<!doctype html><title>Failed background probe</title><p>Its background failed.</p>');
    },
    ['1.9', '1.10'], // an older version directory left beside the newest, as Chrome leaves one mid-update
  );
  const wallet = installExtension(
    personDir,
    (manifestKey, version) => ({ manifest_version: 3, name: '__MSG_extName__', description: '__MSG_extDescription__', default_locale: 'en', version, key: manifestKey }),
    (versionDir) => writeJson(join(versionDir, '_locales', 'en', 'messages.json'), { extName: { message: 'Probe Wallet' }, extDescription: { message: 'A crypto wallet for testing' } }),
    ['2.0'],
    'Probe Wallet',
  );
  const disabled = installExtension(
    personDir,
    (manifestKey, version) => ({ manifest_version: 3, name: 'Disabled in Chrome', version, description: 'Chrome has this extension turned off', key: manifestKey }),
    () => {},
    ['0.1'],
  );
  const workProbe = installExtension(workDir, (manifestKey) => probeManifest(host, manifestKey), (versionDir) => {
    probeFiles(versionDir);
    if (slowCopy) writeZeros(join(versionDir, 'padding.bin'), SLOW_COPY_BYTES);
  });
  person.extensions = [probe.id, fails.id, wallet.id, disabled.id];
  work.extensions = [workProbe.id];

  // Chrome's own view of the extensions (Secure Preferences or Preferences `extensions.settings.<id>`): current Chromium
  // records disablement in `disable_reasons`, older ones in `state` (0 disabled, 1 enabled). The wallet has no entry, so
  // its state reads as unknown; Profile 1 has no Preferences at all.
  writeJson(join(personDir, 'Preferences'), {
    extensions: { settings: { [probe.id]: { state: 1 }, [fails.id]: { state: 1 }, [disabled.id]: { disable_reasons: [1], state: 0 } } },
  });

  return {
    dir,
    host,
    password,
    wrongPassword,
    passwordFile,
    wrongPasswordFile,
    profiles: { Default: person, 'Profile 1': work },
    extensions: { probe, fails, wallet, disabled, workProbe },
    sentinels,
  };
}

// cua #90 start
const GAIA_PICTURE = 'Google Profile Picture.png'; // current Chrome's name for it

// A `Bookmarks` file as Chrome writes it (public JSON: `{ checksum, roots: { bookmark_bar, other, synced }, version }`,
// each node with Chrome's `id`, `guid` and `date_added` in microseconds since 1601). Rewrites the file whole, as Chrome
// does through a temporary file; the e2e calls it again to edit the profile's bookmarks between syncs.
export function writeChromeBookmarks(file: string, roots: FixtureBookmarks, nowMs = Date.now()): NonNullable<FixtureProfile['bookmarks']> {
  let id = 0;
  const urls: Record<string, string> = {};
  const added = String(msToChromeTime(nowMs));
  const node = (bookmark: FixtureBookmark): Record<string, unknown> => {
    const common = { date_added: added, date_last_used: '0', guid: randomUUID(), id: String(++id), name: bookmark.name };
    if ('url' in bookmark) {
      urls[bookmark.name] = bookmark.url;
      return { ...common, type: 'url', url: bookmark.url };
    }
    return { ...common, children: bookmark.children.map(node), date_modified: added, type: 'folder' };
  };
  const root = (name: string, children: FixtureBookmark[]) => node({ name, children });
  const json = {
    checksum: createHash('md5').update(String(nowMs)).digest('hex'), // MAWS never checks it
    roots: { bookmark_bar: root('Bookmarks bar', roots.bar), other: root('Other bookmarks', roots.other), synced: root('Mobile bookmarks', roots.synced) },
    version: 1,
  };
  writeJson(file, json);
  return { file, roots, urls };
}

// A square opaque PNG of `size` pixels (8-bit RGB, one colour), written without an image library.
function writePng(file: string, size: number): string {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x5a)]); // filter 0, then RGB
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// cua #90 end

function writeHistory(file: string, entries: FixtureHistoryEntry[]): FixtureProfile['history'] {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(META_SCHEMA);
    db.exec(`INSERT INTO meta VALUES('version','70'),('last_compatible_version','16')`);
    db.exec(URLS_SCHEMA);
    db.exec(VISITS_SCHEMA);
    const insert = db.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?, ?)');
    for (const entry of entries) insert.run(entry.url, entry.title, entry.visitCount, entry.typedCount, msToChromeTime(entry.lastVisitMs), entry.hidden ? 1 : 0);
  } finally {
    db.close();
  }
  return { file, rows: entries.length, entries };
}

// E0b's cookie writer (synthetic.mjs `buildSyntheticProfile`), over the typed rows.
function writeCookies(file: string, entries: FixtureCookie[], key: Buffer, nowMs: number): FixtureProfile['cookies'] {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(META_SCHEMA);
    db.exec(`INSERT INTO meta VALUES('version','24'),('last_compatible_version','24')`);
    db.exec(COOKIES_SCHEMA);
    db.exec(COOKIES_INDEX);
    const insert = db.prepare('INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const now = msToChromeTime(nowMs);
    for (const c of entries) {
      const persistent = c.expiresMs === null ? 0 : 1;
      insert.run(
        now, c.hostKey, c.topFrameSiteKey, c.name, '', encryptCookieValue(key, c.hostKey, c.value), c.path, c.expiresMs === null ? 0n : msToChromeTime(c.expiresMs),
        c.secure ? 1 : 0, c.httpOnly ? 1 : 0, now, persistent, persistent, 1, c.sameSite, c.sourceScheme, c.sourceScheme === 2 ? 443 : 80,
        now, 0, c.hasCrossSiteAncestor ? 1 : 0,
      );
    }
  } finally {
    db.close();
  }
  return { file, rows: entries.length, partitioned: entries.filter((c) => c.topFrameSiteKey !== '').length, storeVersion: 24, entries };
}

// An installed extension under <profile>/Extensions/<id>/<version>_0/, its manifest carrying the `key` Chrome writes into
// an installed extension, so the id Electron derives on load is the directory's.
function installExtension(
  profileDir: string, // the profile directory's path
  manifest: (manifestKey: string, version: string) => Record<string, unknown>,
  files: (versionDir: string) => void,
  versions: string[] = ['1.0'],
  resolvedName?: string,
): FixtureExtension {
  const der = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' });
  const id = chromeExtensionId(der);
  const manifestKey = der.toString('base64');
  let written: Record<string, unknown> = {};
  let dir = '';
  for (const version of versions) {
    dir = join(profileDir, 'Extensions', id, `${version}_0`);
    mkdirSync(dir, { recursive: true });
    written = manifest(manifestKey, version);
    writeJson(join(dir, 'manifest.json'), written);
    files(dir);
  }
  const version = versions[versions.length - 1]!;
  return { profileDir: basename(profileDir), id, name: resolvedName ?? String(written.name), version, dir };
}

// E0b's probe manifest with host permissions and content-script matches for the given host, and the key.
function probeManifest(host: string, manifestKey: string): Record<string, unknown> {
  const source = JSON.parse(readFileSync(join(PROBE_SOURCE, 'manifest.json'), 'utf8')) as Record<string, unknown> & { content_scripts: Record<string, unknown>[] };
  const matches = [`http://${host}/*`];
  return { ...source, host_permissions: matches, content_scripts: source.content_scripts.map((script) => ({ ...script, matches })), key: manifestKey };
}

function probeFiles(versionDir: string): void {
  for (const file of PROBE_FILES) copyFileSync(join(PROBE_SOURCE, file), join(versionDir, file));
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// Real zeros, written in 1 MiB chunks: a sparse file could copy faster than the cancel it exists for.
function writeZeros(file: string, bytes: number): void {
  const chunk = Buffer.alloc(1024 * 1024);
  const fd = openSync(file, 'w');
  try {
    for (let written = 0; written < bytes; written += chunk.length) writeSync(fd, chunk, 0, Math.min(chunk.length, bytes - written));
  } finally {
    closeSync(fd);
  }
}
