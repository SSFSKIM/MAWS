// An imported profile's bookmarks in the index (cua board #90's spec, "Storage"; migration 7): one row per node, keyed per
// partition, replaced whole at every sync, read back as the tree, matched for the address field, removed per partition
// and by the boot sweep; a read-only index lists nothing and takes nothing.
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyBookmarkTree, type BookmarkFolder, type BookmarkNode, type BookmarkTree } from '@shared/browser/bookmarks';
import { tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';
import { MIGRATIONS } from './migrations';

const P = 'persist:maws-chrome-Default';
const W = 'persist:maws-chrome-Profile 1';

let next = 1000; // the decoder's placeholder ids, which the store never keeps
const u = (name: string, url: string, addedAt: number | null = 1_700_000_000_000): BookmarkNode => ({ kind: 'url', id: next++, name, url, addedAt });
const f = (name: string, children: BookmarkNode[]): BookmarkFolder => ({ kind: 'folder', id: next++, name, children });
const tree = (bar: BookmarkNode[], other: BookmarkNode[] = [], mobile: BookmarkNode[] = []): BookmarkTree => ({
  bar: f('Bookmarks bar', bar),
  other: f('Other bookmarks', other),
  mobile: f('Mobile bookmarks', mobile),
});
const SAMPLE = tree(
  [u('A', 'https://a.example/'), u('B', 'https://b.example/'), f('F', [u('F1', 'https://f1.example/'), u('F2', 'https://f2.example/'), f('G', [u('G1', 'https://g1.example/')])])],
  [u('O1', 'https://o1.example/', null)],
);

// The tree without ids, which `replace` reassigns.
type Shape = string | [string, Shape[]];
const shapeOf = (node: BookmarkNode): Shape => (node.kind === 'url' ? `${node.name} ${node.url} ${node.addedAt}` : [node.name, node.children.map(shapeOf)]);
const shapes = (t: BookmarkTree) => [shapeOf(t.bar), shapeOf(t.other), shapeOf(t.mobile)];
const ids = (t: BookmarkTree): number[] => {
  const all: number[] = [];
  const walk = (node: BookmarkNode) => {
    all.push(node.id);
    if (node.kind === 'folder') node.children.forEach(walk);
  };
  [t.bar, t.other, t.mobile].forEach(walk);
  return all;
};

describe('BrowserBookmarksStore', () => {
  let dir: ReturnType<typeof tempDir>;
  let path: string;
  let index: Index;
  const raw = <T,>(sql: string, ...params: (string | number)[]): T[] => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return db.prepare(sql).all(...params) as T[];
    } finally {
      db.close();
    }
  };
  const rowsOf = (partition: string) => raw<{ n: number }>('SELECT count(*) AS n FROM browser_bookmarks WHERE partition = ?', partition)[0]!.n;

  beforeEach(() => {
    dir = tempDir();
    path = join(dir.path, 'index.sqlite');
    index = new Index(path);
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  it('migration 7 creates the table with its two checks and the tree and url indexes', () => {
    expect(index.applied).toContain(7);
    const columns = raw<{ name: string; type: string; notnull: number; pk: number }>('PRAGMA table_info(browser_bookmarks)').map((c) => [c.name, c.type, c.notnull, c.pk]);
    expect(columns).toEqual([
      ['id', 'INTEGER', 0, 1], ['partition', 'TEXT', 1, 0], ['parent_id', 'INTEGER', 0, 0], ['root', 'TEXT', 1, 0], ['position', 'INTEGER', 1, 0],
      ['kind', 'TEXT', 1, 0], ['name', 'TEXT', 1, 0], ['url', 'TEXT', 0, 0], ['added_at_ms', 'INTEGER', 0, 0],
    ]);
    expect(raw<{ name: string }>('PRAGMA index_list(browser_bookmarks)').map((i) => i.name).sort()).toEqual(['browser_bookmarks_tree', 'browser_bookmarks_url']);
    index.close();
    const db = new DatabaseSync(path);
    expect(() => db.prepare("INSERT INTO browser_bookmarks (partition, root, position, kind, name) VALUES ('p', 'toolbar', 0, 'folder', 'x')").run()).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO browser_bookmarks (partition, root, position, kind, name) VALUES ('p', 'bar', 0, 'separator', 'x')").run()).toThrow(/CHECK/);
    db.close();
    index = new Index(path);
  });

  it('answers empty roots for a partition with no rows', () => {
    expect(index.browserBookmarks.tree(P)).toEqual(emptyBookmarkTree());
  });

  it('replaces a partition’s rows and answers the tree in Chrome’s order, folders nested, dates kept', () => {
    index.browserBookmarks.replace(P, SAMPLE);
    const read = index.browserBookmarks.tree(P);
    expect(shapes(read)).toEqual(shapes(SAMPLE));
    expect(rowsOf(P)).toBe(3 + 2 + 6); // the three roots, two folders and six URLs: every node a row
  });

  it('is idempotent: the same tree twice leaves the same rows and the same tree, with ids reassigned', () => {
    index.browserBookmarks.replace(P, SAMPLE);
    const first = index.browserBookmarks.tree(P);
    index.browserBookmarks.replace(P, SAMPLE);
    const second = index.browserBookmarks.tree(P);
    expect(shapes(second)).toEqual(shapes(first));
    expect(rowsOf(P)).toBe(11);
    expect(new Set(ids(second)).size).toBe(ids(second).length);
    expect(ids(second).some((id) => ids(first).includes(id))).toBe(false); // ids are stable only until the next sync
    expect(ids(second).some((id) => id >= 1000)).toBe(false); // never the decoder's placeholders
  });

  it('keeps partitions apart: replacing or removing one leaves the other', () => {
    index.browserBookmarks.replace(P, SAMPLE);
    index.browserBookmarks.replace(W, tree([u('W1', 'https://w1.example/')]));
    expect(shapeOf(index.browserBookmarks.tree(W).bar)).toEqual(['Bookmarks bar', ['W1 https://w1.example/ 1700000000000']]);
    index.browserBookmarks.replace(P, tree([u('A2', 'https://a.example/')]));
    expect(shapeOf(index.browserBookmarks.tree(W).bar)).toEqual(['Bookmarks bar', ['W1 https://w1.example/ 1700000000000']]);
    index.browserBookmarks.removePartition(P);
    expect(rowsOf(P)).toBe(0);
    expect(index.browserBookmarks.tree(P)).toEqual(emptyBookmarkTree());
    expect(rowsOf(W)).toBe(4);
  });

  it('replaces in one transaction: a tree that fails part-way leaves the previous rows', () => {
    index.browserBookmarks.replace(P, SAMPLE);
    const broken = tree([u('ok', 'https://ok.example/'), { kind: 'url', id: 1, name: null as unknown as string, url: 'https://bad.example/', addedAt: null }]); // name's NOT NULL fails
    expect(() => index.browserBookmarks.replace(P, broken)).toThrow();
    expect(shapes(index.browserBookmarks.tree(P))).toEqual(shapes(SAMPLE));
  });

  it('suggests URL bookmarks whose name or URL holds the query, in document order, each URL once', () => {
    index.browserBookmarks.replace(P, tree([u('Alpha', 'https://alpha.example/'), f('F', [u('Fun', 'https://fun.example/'), u('Alpha again', 'https://alpha.example/')])], [u('fan', 'https://x.example/f')]));
    index.browserBookmarks.replace(W, tree([u('Fun', 'https://fun.example/')]));
    expect(index.browserBookmarks.suggest(P, 'f', 8)).toEqual([
      { url: 'https://fun.example/', title: 'Fun' },
      { url: 'https://x.example/f', title: 'fan' },
    ]);
    expect(index.browserBookmarks.suggest(P, 'ALPHA', 8)).toEqual([{ url: 'https://alpha.example/', title: 'Alpha' }]);
    expect(index.browserBookmarks.suggest(P, 'example', 2)).toHaveLength(2);
    expect(index.browserBookmarks.suggest(P, '%', 8)).toEqual([]); // LIKE's wildcards are text
    expect(index.browserBookmarks.suggest(P, '', 8)).toEqual([]); // an empty field suggests history only
  });

  it('the boot sweep removes every partition it is not given', () => {
    index.browserBookmarks.replace(P, SAMPLE);
    index.browserBookmarks.replace(W, tree([u('W1', 'https://w1.example/')]));
    expect(index.browserBookmarks.removeExcept([W])).toBe(11);
    expect(rowsOf(P)).toBe(0);
    expect(rowsOf(W)).toBe(4);
    expect(index.browserBookmarks.removeExcept([])).toBe(4);
  });

  it('a read-only index (a newer app’s) lists nothing, suggests nothing, removes nothing and refuses a replace as indexUnavailable', () => {
    index.browserBookmarks.replace(P, SAMPLE);
    index.close();
    const newer = join(dir.path, 'newer.sqlite');
    copyFileSync(path, newer);
    const db = new DatabaseSync(newer);
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    db.close();
    index = new Index(newer);
    expect(index.readOnly).toBe(true);
    expect(index.browserBookmarks.tree(P)).toEqual(emptyBookmarkTree());
    expect(index.browserBookmarks.suggest(P, 'a', 8)).toEqual([]);
    expect(() => index.browserBookmarks.removePartition(P)).not.toThrow();
    expect(index.browserBookmarks.removeExcept([])).toBe(0);
    expect(() => index.browserBookmarks.replace(P, SAMPLE)).toThrow(expect.objectContaining({ code: 'indexUnavailable' }));
  });
});
