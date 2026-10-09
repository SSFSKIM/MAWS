// cua #90: the bookmarks bar's rules (cua board #90's spec, "The bar").
import { describe, expect, it } from 'vitest';
import { emptyBookmarkTree, type BookmarkNode, type BookmarkTree } from '@shared/browser/bookmarks';
import type { ImportedBookmarks } from '@shared/browser/profiles';
import { barOrigins, barShown, canShowBar, chipHow, firstHidden } from './bookmarks-bar';

const CONSENTED: ImportedBookmarks = { consentedAt: '2026-10-08T09:00:00.000Z', syncedAt: '2026-10-08T09:00:01.000Z', count: 1, error: null, errorAt: null };
const url = (id: number, href: string): BookmarkNode => ({ kind: 'url', id, name: `n${id}`, url: href, addedAt: null });
const treeWith = (...children: BookmarkNode[]): BookmarkTree => {
  const tree = emptyBookmarkTree();
  tree.bar.children.push(...children);
  return tree;
};

describe('barShown: the bar\'s hidden states', () => {
  const tree = treeWith(url(2, 'https://a.example/'));
  it('shows for a consented profile with a non-empty bar while the setting shows it', () => {
    expect(barShown({ bookmarks: CONSENTED }, 'shown', tree)).toBe(true);
  });
  it('hides with no record, no consent, an empty bar root, no tree yet, or the setting hidden', () => {
    expect(barShown(undefined, 'shown', tree)).toBe(false); // the Default partition, or a removed profile
    expect(barShown({ bookmarks: null }, 'shown', tree)).toBe(false); // imported without Bookmarks
    expect(barShown({ bookmarks: CONSENTED }, 'shown', treeWith())).toBe(false); // Other bookmarks alone shows no bar
    expect(barShown({ bookmarks: CONSENTED }, 'shown', undefined)).toBe(false);
    expect(barShown({ bookmarks: CONSENTED }, 'hidden', tree)).toBe(false);
  });
  it('still shows when the last sync failed: the rows it kept are shown', () => {
    expect(barShown({ bookmarks: { ...CONSENTED, error: 'missing', errorAt: CONSENTED.syncedAt } }, 'shown', tree)).toBe(true);
  });
});

describe('firstHidden: the » slot\'s first chip', () => {
  it('is the first chip whose right edge passes the room, or null when all fit', () => {
    expect(firstHidden([40, 90, 150, 210], 160)).toBe(3);
    expect(firstHidden([40, 90, 150, 210], 210)).toBeNull();
    expect(firstHidden([40, 90], 30)).toBe(0);
    expect(firstHidden([], 100)).toBeNull();
    expect(firstHidden([100.4], 100)).toBeNull(); // sub-pixel rounding
  });
});

describe('chipHow: the click\'s target', () => {
  it('opens a new tab for ⌘-click, Ctrl-click and the middle button; the tab itself otherwise', () => {
    expect(chipHow({ metaKey: false, ctrlKey: false, button: 0 })).toBe('current');
    expect(chipHow({ metaKey: true, ctrlKey: false, button: 0 })).toBe('newTab');
    expect(chipHow({ metaKey: false, ctrlKey: true, button: 0 })).toBe('newTab');
    expect(chipHow({ metaKey: false, ctrlKey: false, button: 1 })).toBe('newTab');
  });
});

describe('barOrigins', () => {
  it('lists the URL chips\' origins once each, in order, folders aside', () => {
    const folder: BookmarkNode = { kind: 'folder', id: 9, name: 'F', children: [url(10, 'https://inside.example/')] };
    expect(barOrigins([url(2, 'https://a.example/x'), folder, url(3, 'https://b.example:8443/'), url(4, 'https://a.example/y')])).toEqual(['https://a.example', 'https://b.example:8443']);
  });
});

describe('canShowBar: where ⌘⇧B is the bar\'s', () => {
  it('is a consented profile\'s partition, its bar shown or hidden; not the Default partition, an unconsented profile or an unknown one', () => {
    const records = [{ partition: 'persist:maws-chrome-Default', bookmarks: CONSENTED }, { partition: 'persist:maws-chrome-Work', bookmarks: null }];
    expect(canShowBar(records, 'persist:maws-chrome-Default')).toBe(true);
    expect(canShowBar(records, 'persist:maws-browser')).toBe(false);
    expect(canShowBar(records, 'persist:maws-chrome-Work')).toBe(false);
    expect(canShowBar(records, 'persist:maws-chrome-Gone')).toBe(false);
  });
});
