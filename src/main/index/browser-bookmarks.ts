// An imported Chrome profile's bookmarks (cua board #90's spec, "Storage"; index migration 7's `browser_bookmarks`): one
// row per node of the read-only mirror, keyed per partition. A sync replaces a partition's rows whole in one
// transaction, so the ids are reassigned each time (a node's id is stable only until the next sync); the tree is read
// back from `(partition, parent_id, position)`, the address field's matches from the URL rows. Like the history, the
// mirror is a convenience: a read-only index (a newer app's file) lists and suggests nothing, removes nothing, and
// refuses a replace as `indexUnavailable`, which the sync and the import report.
import { BOOKMARK_ROOTS, emptyBookmarkTree, type BookmarkFolder, type BookmarkNode, type BookmarkRoot, type BookmarkTree } from '@shared/browser/bookmarks';
import type { Db } from './db';

interface Row {
  id: number;
  parent_id: number | null;
  root: BookmarkRoot;
  kind: 'url' | 'folder';
  name: string;
  url: string | null;
  added_at_ms: number | null;
}

// LIKE's wildcards in typed text are text.
const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

export class BrowserBookmarksStore {
  constructor(private readonly db: Db) {}

  // A newer app's index, opened read-only: the sync refuses before reading anything.
  get readOnly(): boolean {
    return this.db.readOnly;
  }

  // The partition's rows replaced by the tree, in one transaction; every node's id is the new row's.
  replace(partition: string, tree: BookmarkTree): void {
    if (this.db.readOnly) throw Object.assign(new Error('the index is unavailable'), { code: 'indexUnavailable' });
    this.db.transaction(() => {
      this.db.run('DELETE FROM browser_bookmarks WHERE partition = ?', partition);
      const insert = (node: BookmarkNode, root: BookmarkRoot, parentId: number | null, position: number) => {
        const { id } = this.db.get<{ id: number }>(
          'INSERT INTO browser_bookmarks (partition, parent_id, root, position, kind, name, url, added_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
          partition, parentId, root, position, node.kind, node.name, node.kind === 'url' ? node.url : null, node.kind === 'url' ? node.addedAt : null,
        )!;
        if (node.kind === 'folder') node.children.forEach((child, at) => insert(child, root, id, at));
      };
      BOOKMARK_ROOTS.forEach((root, at) => insert(tree[root], root, null, at));
    });
  }

  // The partition's tree; empty roots when it has no rows, or the index is read-only.
  tree(partition: string): BookmarkTree {
    const tree = emptyBookmarkTree();
    if (this.db.readOnly) return tree;
    const rows = this.db.all<Row>(
      'SELECT id, parent_id, root, kind, name, url, added_at_ms FROM browser_bookmarks WHERE partition = ? ORDER BY parent_id, position',
      partition,
    );
    const nodes = new Map<number, BookmarkNode>();
    for (const row of rows) {
      nodes.set(
        row.id,
        row.kind === 'folder'
          ? { kind: 'folder', id: row.id, name: row.name, children: [] }
          : { kind: 'url', id: row.id, name: row.name, url: row.url ?? '', addedAt: row.added_at_ms },
      );
    }
    for (const row of rows) {
      const node = nodes.get(row.id)!;
      if (row.parent_id === null) {
        if (node.kind === 'folder') tree[row.root] = node;
        continue;
      }
      const parent = nodes.get(row.parent_id);
      if (parent?.kind === 'folder') (parent as BookmarkFolder).children.push(node);
    }
    return tree;
  }

  // URL bookmarks whose name or URL holds `query` (ASCII case-insensitively, SQLite's LIKE), in document order, each URL
  // once (its first bookmark's name); an empty query matches nothing, so an empty field suggests history only.
  suggest(partition: string, query: string, limit: number): { url: string; title: string | null }[] {
    if (this.db.readOnly || query === '') return [];
    return this.db
      .all<{ url: string; name: string }>(
        `SELECT url, name, min(id) AS first FROM browser_bookmarks WHERE partition = ?1 AND kind = 'url' AND (url LIKE ?2 ESCAPE '\\' OR name LIKE ?2 ESCAPE '\\')
         GROUP BY url ORDER BY first LIMIT ?3`,
        partition, likePattern(query), limit,
      )
      .map(({ url, name }) => ({ url, title: name === '' ? null : name }));
  }

  // "Remove imported profile", and a cancelled or failed import's rollback.
  removePartition(partition: string): void {
    if (this.db.readOnly) return;
    this.db.run('DELETE FROM browser_bookmarks WHERE partition = ?', partition);
  }

  // The boot sweep: every row of a partition `keep` does not list (only an imported profile's partition has rows);
  // answers the rows removed.
  removeExcept(keep: readonly string[]): number {
    if (this.db.readOnly) return 0;
    return this.db.run('DELETE FROM browser_bookmarks WHERE partition NOT IN (SELECT value FROM json_each(?))', JSON.stringify(keep));
  }
}
