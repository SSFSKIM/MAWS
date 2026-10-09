// Chrome's bookmarks, decoded (cua board #90's spec, "Reading"). Chrome keeps them in the profile directory's `Bookmarks`,
// public JSON (`{ version, roots: { bookmark_bar, other, synced }, checksum }`, each root a folder `{ type: 'folder',
// name, children }`, each child `{ type: 'url', name, url, date_added }` or a folder). The file is read in place, never
// staged and never written: the import and every later sync (src/main/browser/bookmarks/sync.ts) make the same read,
// which first re-applies `Local State`'s admission (the profile directory's real path under the Chrome folder's), since
// `O_NOFOLLOW` guards only the last component, then reads the file capped and not through a symlink. `parseBookmarks`
// is pure: the three roots, folders nested as they are, URL nodes whose URL is http(s) (the rule history's
// `classifyHistoryRow` applies; `javascript:`, `chrome:`, `file:` and the rest are skipped and counted), names cut at
// IMPORT_TEXT_MAX, at most BOOKMARKS_MAX URL nodes in document order (the rest skipped and counted), `date_added` as
// epoch ms. Nothing here logs: a bookmark's URL or name never reaches a line.
import { isAbsolute, join } from 'node:path';
import { BOOKMARKS_MAX, ROOT_NAMES, type BookmarkFolder, type BookmarkNode, type BookmarkTree } from '@shared/browser/bookmarks';
import { CHROME_PROFILE_DIR, IMPORT_TEXT_MAX } from '@shared/browser/import';
import { validateBrowserUrl } from '@shared/browser/url';
import { chromeTimeToUnixMs } from './crypto';
import { admitted, realDirectory } from './local-state';
import { readCappedNoFollow } from './read-capped';

export const BOOKMARKS_FILE_MAX_BYTES = 16 * 1024 * 1024; // a larger file is unreadable

// The tree with placeholder ids (document order; the index assigns its own), the URL nodes kept and skipped.
export interface DecodedBookmarks {
  tree: BookmarkTree;
  urls: number;
  skipped: number;
}

export type BookmarksRead = ({ ok: true } & DecodedBookmarks) | { ok: false; error: 'missing' | 'unreadable' };

export async function readChromeBookmarks(userDataDir: string, profileDir: string): Promise<BookmarksRead> {
  const missing = { ok: false, error: 'missing' } as const;
  const unreadable = { ok: false, error: 'unreadable' } as const;
  if (!isAbsolute(userDataDir) || !CHROME_PROFILE_DIR.test(profileDir)) return missing;
  const root = await realDirectory(userDataDir);
  if (root === null) return missing; // the Chrome folder moved or went
  const profilePath = join(userDataDir, profileDir);
  if (!(await admitted(root, userDataDir, profileDir))) return (await realDirectory(profilePath)) === null ? missing : unreadable;
  const read = await readCappedNoFollow(join(profilePath, 'Bookmarks'), BOOKMARKS_FILE_MAX_BYTES);
  if (read === 'missing') return missing;
  if (typeof read === 'string') return unreadable;
  const decoded = parseBookmarks(read.text);
  return decoded === null ? unreadable : { ok: true, ...decoded };
}

export function parseBookmarks(text: string): DecodedBookmarks | null {
  try {
    const roots = objectOr(objectOr(JSON.parse(text))?.roots);
    const bar = folderOr(roots?.bookmark_bar);
    if (!roots || !bar) return null;
    const decoder = new Decoder();
    const tree: BookmarkTree = {
      bar: decoder.folder(bar, ROOT_NAMES.bar),
      other: decoder.folder(folderOr(roots.other), ROOT_NAMES.other),
      mobile: decoder.folder(folderOr(roots.synced), ROOT_NAMES.mobile),
    };
    return { tree, urls: decoder.urls, skipped: decoder.skipped };
  } catch {
    return null; // a JSON SyntaxError (which quotes the input: never passed on) or a nesting too deep to walk
  }
}

class Decoder {
  urls = 0;
  skipped = 0;
  private nextId = 1;

  folder(source: Record<string, unknown> | null, fallbackName: string): BookmarkFolder {
    const folder: BookmarkFolder = { kind: 'folder', id: this.nextId++, name: source ? nameOf(source.name) : fallbackName, children: [] };
    const children = Array.isArray(source?.children) ? source.children : [];
    for (const child of children) {
      const node = this.node(objectOr(child));
      if (node) folder.children.push(node);
    }
    return folder;
  }

  private node(source: Record<string, unknown> | null): BookmarkNode | null {
    if (source?.type === 'folder') return this.folder(source, '');
    if (source?.type !== 'url') return null; // not a bookmark: neither kept nor counted
    const check = typeof source.url === 'string' ? validateBrowserUrl(source.url) : null;
    if (!check?.ok || this.urls >= BOOKMARKS_MAX) {
      this.skipped++;
      return null;
    }
    this.urls++;
    return { kind: 'url', id: this.nextId++, name: nameOf(source.name), url: check.url, addedAt: epochMs(source.date_added) };
  }
}

const objectOr = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const folderOr = (value: unknown): Record<string, unknown> | null => {
  const object = objectOr(value);
  return object?.type === 'folder' || (object && Array.isArray(object.children)) ? object : null;
};
const nameOf = (value: unknown): string => (typeof value === 'string' ? value.slice(0, IMPORT_TEXT_MAX) : '');

// Chrome time (a decimal string of microseconds since 1601-01-01 UTC) as epoch ms; 0, absent or malformed is unknown.
function epochMs(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return null;
  const ms = chromeTimeToUnixMs(BigInt(value));
  return ms > 0 && Number.isSafeInteger(ms) ? ms : null;
}
