// `browser.bookmarks.*`'s handlers (cua board #90's spec, Interfaces "IPC"): the partition's tree, empty when the index
// fails; a sync answered as the mirror answers it.
import { describe, expect, it, vi } from 'vitest';
import { emptyBookmarkTree, type BookmarkTree } from '@shared/browser/bookmarks';
import type { CommandName } from '@shared/ipc/schema';
import { validateCommandOutput } from '@shared/ipc/validate';
import { registerBookmarkHandlers } from './register';

const P = 'persist:maws-chrome-Default';
const TREE: BookmarkTree = {
  ...emptyBookmarkTree(),
  bar: { kind: 'folder', id: 1, name: 'Bookmarks bar', children: [{ kind: 'url', id: 2, name: 'A', url: 'https://a.example/', addedAt: 1_700_000_000_000 }] },
};

function setup() {
  const handlers = new Map<CommandName, (input: unknown) => unknown>();
  const store = { tree: vi.fn((): BookmarkTree => TREE) };
  const sync = { sync: vi.fn(async () => ({ syncedAt: '2026-10-08T12:00:00.000Z', count: 1 })) };
  registerBookmarkHandlers({ store, sync, env: {}, register: (name, handler) => void handlers.set(name, handler as (input: unknown) => unknown) });
  return { store, sync, call: (name: CommandName, input: unknown) => handlers.get(name)!(input) };
}

describe('browser.bookmarks.* handlers', () => {
  it('answers the partition’s tree, in the command’s output shape', () => {
    const { call, store } = setup();
    const answer = call('browser.bookmarks.tree', { partition: P });
    expect(answer).toEqual({ tree: TREE });
    expect(store.tree).toHaveBeenCalledWith(P);
    expect(validateCommandOutput('browser.bookmarks.tree', answer).ok).toBe(true);
  });

  it('answers empty roots when the index fails, logging its code only', () => {
    const { call, store } = setup();
    store.tree.mockImplementation(() => {
      throw Object.assign(new Error('database disk image is malformed https://a.example/'), { code: 'ERR_SQLITE_ERROR' });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(call('browser.bookmarks.tree', { partition: P })).toEqual({ tree: emptyBookmarkTree() });
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(['[browser-import] error bookmarks_tree ERR_SQLITE_ERROR']);
    } finally {
      warn.mockRestore();
    }
  });

  it('runs a sync of the profile and answers what it answers', async () => {
    const { call, sync } = setup();
    const answer = await call('browser.bookmarks.sync', { profileDir: 'Default' });
    expect(answer).toEqual({ syncedAt: '2026-10-08T12:00:00.000Z', count: 1 });
    expect(sync.sync).toHaveBeenCalledWith('Default');
    expect(validateCommandOutput('browser.bookmarks.sync', answer).ok).toBe(true);
    expect(validateCommandOutput('browser.bookmarks.sync', { error: 'refused', reason: 'an import is running' }).ok).toBe(true);
    expect(validateCommandOutput('browser.bookmarks.sync', { error: 'missing' }).ok).toBe(true);
    expect(validateCommandOutput('browser.bookmarks.sync', { error: 'gone' }).ok).toBe(false);
  });
});
