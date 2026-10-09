// Chrome's `Bookmarks` file decoded (cua board #90's spec, "Reading"): the three roots, folders nested as they are, only
// http(s) URLs, names cut, at most BOOKMARKS_MAX URL nodes in document order, Chrome's microsecond dates as epoch ms;
// and the in-place read under the profile's admission, capped and never through a symlink.
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOOKMARKS_MAX, type BookmarkNode } from '@shared/browser/bookmarks';
import { IMPORT_TEXT_MAX } from '@shared/browser/import';
import { buildChromeUserData } from '../../../../../test/support/chrome-profile';
import { BOOKMARKS_FILE_MAX_BYTES, parseBookmarks, readChromeBookmarks } from './bookmarks';

// 2026-10-06T10:00:00.000Z in Chrome time (microseconds since 1601-01-01 UTC)
const ADDED_MS = Date.parse('2026-10-06T10:00:00.000Z');
const chromeTime = (ms: number) => String(BigInt(ms) * 1000n + 11644473600n * 1000000n);

let guid = 0;
const url = (name: string, href: string, added = ADDED_MS) => ({ date_added: chromeTime(added), date_last_used: '0', guid: `g-${++guid}`, id: String(guid), name, type: 'url', url: href });
const folder = (name: string, children: unknown[]) => ({ children, date_added: chromeTime(ADDED_MS), date_last_used: '0', date_modified: '0', guid: `g-${++guid}`, id: String(guid), name, type: 'folder' });
const file = (roots: { bar?: unknown[]; other?: unknown[]; synced?: unknown[] }) =>
  JSON.stringify({
    checksum: '0123456789abcdef0123456789abcdef',
    roots: { bookmark_bar: folder('Bookmarks bar', roots.bar ?? []), other: folder('Other bookmarks', roots.other ?? []), synced: folder('Mobile bookmarks', roots.synced ?? []) },
    version: 1,
  });

// The decoded tree without its placeholder ids, as names and URLs.
type Shape = string | [string, Shape[]];
const shape = (node: BookmarkNode): Shape => (node.kind === 'url' ? `${node.name} ${node.url}` : [node.name, node.children.map(shape)]);

describe('parseBookmarks', () => {
  const sample = file({
    bar: [
      url('A', 'https://a.example/'),
      url('Bookmarklet', 'javascript:alert(1)'),
      folder('F', [url('F1', 'https://f1.example/x?y=1'), url('Settings', 'chrome://settings/'), folder('G', [url('G1', 'http://g1.example/')]), folder('Empty', [])]),
    ],
    other: [url('O1', 'https://o1.example/'), url('Local', 'file:///etc/hosts')],
    synced: [url('M'.repeat(IMPORT_TEXT_MAX + 10), 'https://m.example/')],
  });

  it('keeps the three roots in Chrome’s order with folders nested as they are and only http(s) URLs', () => {
    const decoded = parseBookmarks(sample)!;
    expect(shape(decoded.tree.bar)).toEqual([
      'Bookmarks bar',
      ['A https://a.example/', ['F', ['F1 https://f1.example/x?y=1', ['G', ['G1 http://g1.example/']], ['Empty', []]]]],
    ]);
    expect(shape(decoded.tree.other)).toEqual(['Other bookmarks', ['O1 https://o1.example/']]);
    expect(decoded.tree.mobile.children).toHaveLength(1);
  });

  it('counts the URLs kept, root and nested, and the ones skipped (javascript:, chrome:, file:)', () => {
    const decoded = parseBookmarks(sample)!;
    expect(decoded.urls).toBe(5);
    expect(decoded.skipped).toBe(3);
  });

  it('cuts names at IMPORT_TEXT_MAX and converts Chrome’s microseconds since 1601 to epoch ms', () => {
    const decoded = parseBookmarks(sample)!;
    const mobile = decoded.tree.mobile.children[0]!;
    expect(mobile.name).toHaveLength(IMPORT_TEXT_MAX);
    expect(mobile.kind === 'url' && mobile.addedAt).toBe(ADDED_MS);
  });

  it('takes a missing, zero or malformed date as unknown, and a missing name as empty', () => {
    const decoded = parseBookmarks(
      file({ bar: [{ ...url('Zero', 'https://z.example/'), date_added: '0' }, { ...url('Bad', 'https://b.example/'), date_added: 'soon' }, { type: 'url', url: 'https://n.example/' }] }),
    )!;
    expect(decoded.tree.bar.children.map((node) => [node.name, node.kind === 'url' ? node.addedAt : 'folder'])).toEqual([['Zero', null], ['Bad', null], ['', null]]);
  });

  it('serialises a URL as the browser does', () => {
    const decoded = parseBookmarks(file({ bar: [url('Upper', 'HTTPS://Upper.Example')] }))!;
    expect(decoded.tree.bar.children[0]).toMatchObject({ kind: 'url', url: 'https://upper.example/' });
  });

  it(`keeps at most ${BOOKMARKS_MAX} URLs in document order and counts the rest as skipped`, () => {
    const many = Array.from({ length: BOOKMARKS_MAX + 5 }, (_, k) => url(`N${k}`, `https://n.example/${k}`));
    const decoded = parseBookmarks(file({ bar: many.slice(0, 10), other: [folder('Lots', many.slice(10))] }))!;
    expect(decoded.urls).toBe(BOOKMARKS_MAX);
    expect(decoded.skipped).toBe(5);
    const lots = decoded.tree.other.children[0]!;
    expect(lots.kind === 'folder' && lots.children.at(-1)!.name).toBe(`N${BOOKMARKS_MAX - 1}`);
  });

  it('gives every node an id, unique within the tree', () => {
    const decoded = parseBookmarks(sample)!;
    const ids: number[] = [];
    const walk = (node: BookmarkNode) => {
      ids.push(node.id);
      if (node.kind === 'folder') node.children.forEach(walk);
    };
    [decoded.tree.bar, decoded.tree.other, decoded.tree.mobile].forEach(walk);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads a file without `synced` (or `other`) as empty roots, and refuses what is not Chrome’s shape', () => {
    const partial = JSON.stringify({ roots: { bookmark_bar: folder('Bookmarks bar', [url('A', 'https://a.example/')]) }, version: 1 });
    expect(parseBookmarks(partial)!.tree.mobile.children).toEqual([]);
    for (const text of ['', 'not json', '[]', 'null', '{}', JSON.stringify({ roots: {} }), JSON.stringify({ roots: { bookmark_bar: 'x' } })]) expect(parseBookmarks(text), text).toBeNull();
  });
});

describe('readChromeBookmarks', () => {
  let root: string;
  let userData: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'maws-90-bookmarks-'));
    userData = join(root, 'Chrome');
    mkdirSync(join(userData, 'Default'), { recursive: true });
    writeFileSync(join(userData, 'Default', 'Bookmarks'), file({ bar: [url('A', 'https://a.example/'), url('J', 'javascript:void 0')] }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads the synthetic fixture’s Default as the spec’s Acceptance counts it: 46 kept, the bookmarklet skipped', async () => {
    const fixture = buildChromeUserData(join(root, 'Fixture'));
    const read = await readChromeBookmarks(fixture.dir, 'Default');
    expect(read).toMatchObject({ ok: true, urls: 46, skipped: 1 });
    if (!read.ok) return;
    expect(read.tree.bar.children.slice(0, 3).map((node) => node.name)).toEqual(['A', 'B', 'F']);
    expect(read.tree.other.children.map((node) => node.name)).toEqual(['O1']);
    expect(await readChromeBookmarks(fixture.dir, 'Profile 1')).toEqual({ ok: false, error: 'missing' });
  });

  it('reads the profile’s file in place', async () => {
    const read = await readChromeBookmarks(userData, 'Default');
    expect(read).toMatchObject({ ok: true, urls: 1, skipped: 1 });
  });

  it('answers missing for no file, no profile directory or no Chrome folder', async () => {
    rmSync(join(userData, 'Default', 'Bookmarks'));
    expect(await readChromeBookmarks(userData, 'Default')).toEqual({ ok: false, error: 'missing' });
    expect(await readChromeBookmarks(userData, 'Profile 1')).toEqual({ ok: false, error: 'missing' });
    renameSync(userData, join(root, 'Moved'));
    expect(await readChromeBookmarks(userData, 'Default')).toEqual({ ok: false, error: 'missing' });
  });

  it('answers unreadable for a file over the cap, not JSON, or a symlink', async () => {
    const bookmarks = join(userData, 'Default', 'Bookmarks');
    writeFileSync(bookmarks, Buffer.alloc(BOOKMARKS_FILE_MAX_BYTES + 1, 0x20));
    expect(await readChromeBookmarks(userData, 'Default')).toEqual({ ok: false, error: 'unreadable' });
    writeFileSync(bookmarks, '{ not json');
    expect(await readChromeBookmarks(userData, 'Default')).toEqual({ ok: false, error: 'unreadable' });
    const elsewhere = join(root, 'elsewhere.json');
    writeFileSync(elsewhere, file({ bar: [url('A', 'https://a.example/')] }));
    rmSync(bookmarks);
    symlinkSync(elsewhere, bookmarks);
    expect(await readChromeBookmarks(userData, 'Default')).toEqual({ ok: false, error: 'unreadable' });
  });

  it('never follows a profile directory replaced by a symlink out of the Chrome folder', async () => {
    const outside = join(root, 'outside');
    renameSync(join(userData, 'Default'), outside);
    symlinkSync(outside, join(userData, 'Default'));
    expect(await readChromeBookmarks(userData, 'Default')).toEqual({ ok: false, error: 'unreadable' });
  });

  it('refuses a profile directory Chrome could not name, and a relative Chrome folder', async () => {
    expect(await readChromeBookmarks(userData, '../Chrome/Default')).toEqual({ ok: false, error: 'missing' });
    expect(await readChromeBookmarks('Chrome', 'Default')).toEqual({ ok: false, error: 'missing' });
  });
});
