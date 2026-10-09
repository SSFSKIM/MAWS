// An imported Chrome profile's bookmarks (cua board #90, the in-app browser's Chrome-like top chrome; its spec's
// Interfaces "Bookmarks"): a read-only mirror of the profile's `Bookmarks` file, its three roots as Chrome shows them
// (the bookmarks bar, "Other bookmarks", "Mobile bookmarks", which Chrome's file calls `bookmark_bar`, `other` and
// `synced`), kept per partition in the index (migration 7) and re-read whenever the partition comes up and on demand.
// A node's `id` is the index row's, stable only until the next sync replaces the partition's rows: the renderer never
// keys on one across syncs. Only http(s) URLs are kept (the rule `validateBrowserUrl` applies to every tab path).
import * as z from 'zod';
import { IMPORT_TEXT_MAX } from './import';
import { validateBrowserUrl } from './url';

export const BOOKMARKS_MAX = 20000; // URL nodes kept per profile, in document order; the rest are skipped and counted
export const BOOKMARK_SUGGESTIONS_MAX = 3; // of the address field's BROWSER_SUGGESTIONS_MAX rows, the bookmarks at most, first

export type BookmarkUrl = { kind: 'url'; id: number; name: string; url: string; addedAt: number | null };
export type BookmarkFolder = { kind: 'folder'; id: number; name: string; children: BookmarkNode[] };
export type BookmarkNode = BookmarkUrl | BookmarkFolder;

// `BrowserUrlSchema`'s rule (src/shared/ipc/schema/browser.ts, which imports this file): http or https, no whitespace.
const BookmarkUrlSchema = z.string().refine((url) => !/\s/.test(url) && validateBrowserUrl(url).ok, { message: 'not an http or https URL' });

export const BookmarkNodeSchema: z.ZodType<BookmarkNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('url'), id: z.number().int(), name: z.string().max(IMPORT_TEXT_MAX), url: BookmarkUrlSchema, addedAt: z.number().int().nullable() }),
    z.strictObject({ kind: z.literal('folder'), id: z.number().int(), name: z.string().max(IMPORT_TEXT_MAX), children: z.array(BookmarkNodeSchema) }),
  ]),
);
const RootSchema = z.strictObject({ kind: z.literal('folder'), id: z.number().int(), name: z.string().max(IMPORT_TEXT_MAX), children: z.array(BookmarkNodeSchema) });

export const BookmarkTreeSchema = z.strictObject({ bar: RootSchema, other: RootSchema, mobile: RootSchema });
export type BookmarkTree = z.infer<typeof BookmarkTreeSchema>;
export const BOOKMARK_ROOTS = ['bar', 'other', 'mobile'] as const;
export type BookmarkRoot = (typeof BOOKMARK_ROOTS)[number];

// Why a sync left the rows as they were (the record's `bookmarks.error`): the file gone (or the Chrome folder or the
// profile directory moved), unreadable (over the cap, not JSON, not Chrome's shape, or a profile directory no longer
// under the Chrome folder), or the index unable to take the rows.
export const BookmarkSyncErrorSchema = z.enum(['missing', 'unreadable', 'indexUnavailable']);
export type BookmarkSyncError = z.infer<typeof BookmarkSyncErrorSchema>;

// The roots' names when nothing is stored (Chrome's English names; a stored tree keeps the file's own).
export const ROOT_NAMES: Record<BookmarkRoot, string> = { bar: 'Bookmarks bar', other: 'Other bookmarks', mobile: 'Mobile bookmarks' };

// A tree with nothing in it: what a partition with no rows, or a read-only index, answers. Root ids are 0, which no
// index row has.
export function emptyBookmarkTree(): BookmarkTree {
  const root = (name: string): BookmarkFolder => ({ kind: 'folder', id: 0, name, children: [] });
  return { bar: root(ROOT_NAMES.bar), other: root(ROOT_NAMES.other), mobile: root(ROOT_NAMES.mobile) };
}
