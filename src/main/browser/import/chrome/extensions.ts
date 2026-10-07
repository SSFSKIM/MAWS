// The extension inspection (E4b Design §9; E0b findings :307-344): what a Chrome profile's `Extensions/` holds, read in
// place before consent, as JSON parses under caps and a directory walk; nothing is copied or executed here. Every
// `Extensions/<id>/` with a Chrome id; per id the highest version directory holding a `manifest.json`; the name and
// description resolved through `_locales` as Electron resolves them; the permissions Electron lacks; wallets (P-21);
// Chrome's own enabled state from `Secure Preferences` then `Preferences` (Decision Log 9). A tree holding a symlink is
// refused, and no file is read through a symlink.
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ELECTRON_ABSENT_PERMISSIONS, EXTENSION_ID, IMPORT_NAME_MAX, isWalletExtension, type ExtensionCandidate } from '@shared/browser/import';

const MANIFEST_MAX_BYTES = 1024 * 1024;
const MESSAGES_MAX_BYTES = 1024 * 1024;
const PREFERENCES_MAX_BYTES = 8 * 1024 * 1024;
const VERSION_DIR = /^[0-9][0-9A-Za-z._-]{0,63}$/;
const LOCALE = /^[A-Za-z0-9_-]{1,32}$/;
const MESSAGE = /^__MSG_(\w+)__$/;
type AbsentPermission = (typeof ELECTRON_ABSENT_PERMISSIONS)[number];
const ABSENT: ReadonlySet<string> = new Set(ELECTRON_ABSENT_PERMISSIONS);
const isAbsent = (permission: unknown): permission is AbsentPermission => typeof permission === 'string' && ABSENT.has(permission);

// `versionDir`: the directory an import copies (Design §9's copy), null when there is nothing safe to copy.
export interface InspectedExtension {
  candidate: ExtensionCandidate;
  versionDir: string | null;
}

export async function inspectExtensions(profilePath: string): Promise<InspectedExtension[]> {
  const root = join(profilePath, 'Extensions');
  const isRealDirectory = await lstat(root).then((info) => info.isDirectory(), () => false); // a symlinked Extensions/ is refused whole
  const entries = isRealDirectory ? await readdir(root, { withFileTypes: true }).catch(() => []) : [];
  const chromeState = await chromeStates(profilePath);
  const found: InspectedExtension[] = [];
  for (const entry of entries) {
    if (!EXTENSION_ID.test(entry.name)) continue;
    const id = entry.name;
    if (entry.isSymbolicLink()) found.push(refused(id, '', 'symlink', chromeState(id)));
    else if (entry.isDirectory()) found.push(await inspectOne(join(root, id), id, chromeState(id)));
  }
  return found.sort((a, b) => (a.candidate.id < b.candidate.id ? -1 : 1));
}

async function inspectOne(idDir: string, id: string, chromeState: ExtensionCandidate['chromeState']): Promise<InspectedExtension> {
  const versions = await readdir(idDir, { withFileTypes: true }).catch(() => []);
  let chosen: { name: string; version: string; symlink: boolean } | null = null;
  for (const entry of versions) {
    if (!VERSION_DIR.test(entry.name)) continue;
    const symlink = entry.isSymbolicLink();
    if (!symlink && !(entry.isDirectory() && (await isFile(join(idDir, entry.name, 'manifest.json'))))) continue;
    const version = entry.name.replace(/_\d+$/, '');
    if (chosen === null || compareChromeVersions(version, chosen.version) > 0) chosen = { name: entry.name, version, symlink };
  }
  if (chosen === null) return refused(id, '', 'missing', chromeState);
  if (chosen.symlink) return refused(id, chosen.version, 'symlink', chromeState);

  const versionDir = join(idDir, chosen.name);
  const tree = await walk(versionDir).catch(() => null); // a tree that cannot be read is this extension's failure only
  if (tree === null) return refused(id, chosen.version, 'missing', chromeState);
  const manifest = objectOr(await readJson(join(versionDir, 'manifest.json'), MANIFEST_MAX_BYTES));
  const manifestVersion = manifest?.manifest_version;
  if (!manifest || (manifestVersion !== 2 && manifestVersion !== 3)) return refused(id, chosen.version, tree.symlink ? 'symlink' : 'manifest', chromeState);

  // O_NOFOLLOW guards only a path's last component, so a tree holding a symlink is never read past its manifest.
  const messages = tree.symlink ? new Map<string, string>() : await localeMessages(versionDir, manifest.default_locale);
  const name = bounded(resolve(manifest.name, messages)) || id;
  const description = resolve(manifest.description, messages);
  const candidate: ExtensionCandidate = {
    id,
    name,
    version: bounded(typeof manifest.version === 'string' ? manifest.version : '') || chosen.version,
    manifestVersion,
    background: backgroundOf(manifest.background),
    contentScripts: Array.isArray(manifest.content_scripts) ? manifest.content_scripts.length : 0,
    unsupportedPermissions: unsupported(manifest.permissions),
    wallet: isWalletExtension({ id, name, description }),
    chromeState,
    sizeBytes: tree.bytes,
    error: tree.symlink ? 'symlink' : null,
  };
  return { candidate, versionDir: tree.symlink ? null : versionDir };
}

function refused(id: string, version: string, error: 'symlink' | 'manifest' | 'missing', chromeState: ExtensionCandidate['chromeState']): InspectedExtension {
  const candidate: ExtensionCandidate = {
    id,
    name: id,
    version,
    manifestVersion: 3,
    background: 'none',
    contentScripts: 0,
    unsupportedPermissions: [],
    wallet: isWalletExtension({ id, name: '' }),
    chromeState,
    sizeBytes: 0,
    error,
  };
  return { candidate, versionDir: null };
}

// Chrome's own version order: dotted parts compared as numbers; a version with more parts after equal ones is higher.
export function compareChromeVersions(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const l = Number.parseInt(left[i]!, 10);
    const r = Number.parseInt(right[i]!, 10);
    if (Number.isNaN(l) || Number.isNaN(r)) {
      if (left[i] !== right[i]) return left[i]! < right[i]! ? -1 : 1;
    } else if (l !== r) return l - r;
  }
  return left.length - right.length;
}

function backgroundOf(background: unknown): ExtensionCandidate['background'] {
  const value = objectOr(background);
  if (typeof value?.service_worker === 'string') return 'service_worker';
  if (typeof value?.page === 'string' || (Array.isArray(value?.scripts) && value.scripts.length > 0)) return 'page';
  return 'none';
}

function unsupported(permissions: unknown): AbsentPermission[] {
  return Array.isArray(permissions) ? [...new Set(permissions.filter(isAbsent))] : [];
}

// `__MSG_<key>__` through `_locales/<default_locale>/messages.json`, then `_locales/en/` (keys case-insensitive).
async function localeMessages(versionDir: string, defaultLocale: unknown): Promise<Map<string, string>> {
  const messages = new Map<string, string>();
  const locales = [typeof defaultLocale === 'string' && LOCALE.test(defaultLocale) ? defaultLocale : null, 'en'];
  for (const locale of locales.reverse()) {
    if (locale === null) continue;
    const file = objectOr(await readJson(join(versionDir, '_locales', locale, 'messages.json'), MESSAGES_MAX_BYTES));
    for (const [key, entry] of Object.entries(file ?? {})) {
      const message = objectOr(entry)?.message;
      if (typeof message === 'string') messages.set(key.toLowerCase(), message); // the default locale, read last, wins
    }
  }
  return messages;
}

function resolve(text: unknown, messages: Map<string, string>): string {
  if (typeof text !== 'string') return '';
  const key = MESSAGE.exec(text)?.[1];
  return key === undefined ? text : (messages.get(key.toLowerCase()) ?? text);
}

const bounded = (text: string) => text.slice(0, IMPORT_NAME_MAX);

// `extensions.settings.<id>` in `Secure Preferences`, then `Preferences`: a non-empty `disable_reasons` (a list, or a
// non-zero bitmask in older Chromes) is disabled; else the legacy `state` (0 disabled, 1 enabled); an explicitly empty
// `disable_reasons` is enabled; anything else, or an unreadable file, is unknown. No other key is read.
async function chromeStates(profilePath: string): Promise<(id: string) => ExtensionCandidate['chromeState']> {
  const sources = await Promise.all(['Secure Preferences', 'Preferences'].map((file) => readJson(join(profilePath, file), PREFERENCES_MAX_BYTES)));
  const settings = sources.map((data) => objectOr(objectOr(objectOr(data)?.extensions)?.settings));
  return (id) => {
    for (const source of settings) {
      const entry = objectOr(source?.[id]);
      if (!entry) continue;
      const reasons = entry.disable_reasons;
      if ((Array.isArray(reasons) && reasons.length > 0) || (typeof reasons === 'number' && reasons !== 0)) return 'disabled';
      if (entry.state === 0) return 'disabled';
      if (entry.state === 1 || Array.isArray(reasons) || reasons === 0) return 'enabled';
    }
    return 'unknown';
  };
}

// The tree's size, and whether it holds a symlink anywhere (never followed).
async function walk(dir: string): Promise<{ bytes: number; symlink: boolean }> {
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) return { bytes, symlink: true };
    if (entry.isDirectory()) {
      const inner = await walk(path);
      bytes += inner.bytes;
      if (inner.symlink) return { bytes, symlink: true };
    } else if (entry.isFile()) bytes += (await lstat(path)).size;
  }
  return { bytes, symlink: false };
}

async function isFile(path: string): Promise<boolean> {
  return lstat(path).then((info) => info.isFile(), () => false);
}

const objectOr = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

// A JSON file read without following a symlink and under a cap; anything else (absent, too large, not JSON) is null.
async function readJson(file: string, maxBytes: number): Promise<unknown> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); // a FIFO never blocks; isFile refuses it
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    return JSON.parse(await handle.readFile('utf8'));
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}
