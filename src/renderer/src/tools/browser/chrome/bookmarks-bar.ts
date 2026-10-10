// cua #90: the bookmarks bar's rules (cua board #90's spec, "The bar"), pure. When the bar shows, which chip is the
// first the bar cannot fit (the » menu lists it and every one after), what a chip's click asks for, and the page
// origins whose icons the bar asks the partition's favicon cache for.
import type { BookmarkNode, BookmarkTree } from '@shared/browser/bookmarks';
import type { ImportedProfile } from '@shared/browser/profiles';
import type { BrowserSettings } from '@shared/ipc/schema/settings';

// The bar shows for a tab of an imported profile whose bookmarks were imported, while the setting shows it, and only
// when the profile's bookmarks bar holds anything (no empty bar with a hint: the import sheet is the place).
export function barShown(record: Pick<ImportedProfile, 'bookmarks'> | undefined, setting: BrowserSettings['bookmarksBar'], tree: BookmarkTree | undefined): boolean {
  return record?.bookmarks != null && setting === 'shown' && tree !== undefined && tree.bar.children.length > 0;
}

// Whether a tab of `partition` can show a bar, shown or hidden: an imported profile's whose bookmarks were imported.
// ⌘⇧B is the bar's there only; anywhere else it stays Toggle right panel's (the spec's Decision Log, 2026-10-09: the
// chord narrowed to tabs that can show a bar).
export const canShowBar = (records: readonly Pick<ImportedProfile, 'partition' | 'bookmarks'>[], partition: string): boolean =>
  records.some((record) => record.partition === partition && record.bookmarks != null);

// The first chip whose right edge passes the room the chips have (`rights`: each chip's right edge, measured from the
// chips' own left edge, in order); null when every chip fits.
export function firstHidden(rights: readonly number[], room: number): number | null {
  const at = rights.findIndex((right) => right > room + 0.5); // half a pixel of rounding is not an overflow
  return at === -1 ? null : at;
}

// ⌘-click (or Ctrl-click) and the middle button open a new unselected tab, as Chrome's bar does; any other click loads
// the bookmark in the tab.
export const chipHow = (event: { metaKey: boolean; ctrlKey: boolean; button: number }): 'current' | 'newTab' =>
  event.metaKey || event.ctrlKey || event.button === 1 ? 'newTab' : 'current';

// The page origin of a bookmark's URL, or null.
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// The distinct origins of the bar's own URL chips, in order.
export function barOrigins(nodes: readonly BookmarkNode[]): string[] {
  const origins = new Set<string>();
  for (const node of nodes) {
    const origin = node.kind === 'url' ? originOf(node.url) : null;
    if (origin !== null) origins.add(origin);
  }
  return [...origins];
}
