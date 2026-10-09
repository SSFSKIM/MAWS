// Main's handlers for `browser.bookmarks.*` (cua board #90's spec, Interfaces "IPC"): the tree the index holds for a
// partition, and a sync of an imported profile's bookmarks now. Only the app window's top frame reaches them (the
// router's `isAppSender`), every input past its strict schema. A failing index answers an empty tree: the bar is a
// convenience, and the page under it still works.
import { emptyBookmarkTree } from '@shared/browser/bookmarks';
import type { BrowserBookmarksStore } from '../../index/browser-bookmarks';
import type { registerMainHandler } from '../../ipc/router';
import { errorCode, importLog } from '../import/log';
import type { BookmarkSync } from './sync';

export interface BookmarkHandlerDeps {
  store: Pick<BrowserBookmarksStore, 'tree'>;
  sync: Pick<BookmarkSync, 'sync'>;
  env: NodeJS.ProcessEnv;
  register: typeof registerMainHandler;
}

export function registerBookmarkHandlers({ store, sync, env, register }: BookmarkHandlerDeps): void {
  register('browser.bookmarks.tree', ({ partition }) => {
    try {
      return { tree: store.tree(partition) };
    } catch (error) {
      importLog({ kind: 'error', where: 'bookmarks_tree', code: errorCode(error) }, env);
      return { tree: emptyBookmarkTree() };
    }
  });
  register('browser.bookmarks.sync', ({ profileDir }) => sync.sync(profileDir));
}
