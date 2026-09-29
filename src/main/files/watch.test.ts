// `files.watch` through the service (C8c execution document, Interfaces "The open-first boundary", `watch`): one
// fs.watch per confirmed directory whatever the holders, events once per holder session, a 250 ms trailing debounce,
// and a batch forwarded only after its directory is confirmed again.
import fs, { appendFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { FilesChanged } from '@shared/ipc/schema/files';
import type { AllowlistRecord } from './allowlist';
import { createFilesService, type BoundaryPoint, type FilesService } from './service';

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;

let root: string;
let dir: string;
let emitted: FilesChanged[];
let calls: BoundaryPoint[];
let files: FilesService;
let watchers: { close: ReturnType<typeof vi.fn> }[];

const record = (directory: string): AllowlistRecord => ({ directory, additionalDirectories: [], worktree: null });
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));
// FSEvents replays events from just before a watch was installed (measured: the fixture's own writes arrive ~10 ms after
// the install); a test that counts events lets that replay drain first.
async function quiet() {
  await settle();
  emitted.length = 0;
  calls.length = 0;
}
// Ages a file past the two-second `created` window: on APFS an mtime set before the birth time moves the birth time.
function age(path: string) {
  const old = new Date(Date.now() - 60_000);
  utimesSync(path, old, old);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-files-watch-')));
  dir = join(root, 'dir');
  mkdirSync(dir);
  writeFileSync(join(dir, 'old.txt'), 'old');
  age(join(dir, 'old.txt'));
  emitted = [];
  calls = [];
  watchers = [];
  const realWatch = fs.watch.bind(fs);
  vi.spyOn(fs, 'watch').mockImplementation(((...args: Parameters<typeof fs.watch>) => {
    const watcher = realWatch(...args);
    watchers.push({ close: vi.spyOn(watcher, 'close') as unknown as ReturnType<typeof vi.fn> });
    return watcher;
  }) as typeof fs.watch);
  const records = new Map([[A, record(root)], [B, record(root)]]);
  files = createFilesService({
    records: (id) => records.get(id) ?? null,
    hooks: { at: async (point) => void calls.push(point) },
    emit: (payload) => {
      calls.push(`emit:${payload.kind}` as BoundaryPoint);
      emitted.push(payload);
    },
  });
});
afterEach(() => {
  files.dispose();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

// FSEvents can lag by seconds under a loaded machine (pnpm verify runs suites in parallel): the waits are bounded at 6 s.
describe('files watch', { timeout: 20_000 }, () => {
  it('ages a file on this volume as the suite relies on', () => {
    expect(statSync(join(dir, 'old.txt')).birthtimeMs).toBeLessThan(Date.now() - 30_000);
  });

  it('shares one watcher between two holders and emits once per holder session', async () => {
    await files.watch(A, dir, 1);
    await files.watch(B, dir, 2);
    await files.watch(A, dir, 3); // a second window for the same session
    await quiet();
    expect(watchers).toHaveLength(1);
    expect(files.watching()).toEqual([dir]);
    writeFileSync(join(dir, 'new.txt'), 'new');
    await vi.waitFor(() => expect(emitted).toHaveLength(2), { timeout: 6000 });
    await settle(400);
    expect(emitted.sort((x, y) => x.appSessionId.localeCompare(y.appSessionId))).toEqual([
      { appSessionId: A, path: join(dir, 'new.txt'), kind: 'created' },
      { appSessionId: B, path: join(dir, 'new.txt'), kind: 'created' },
    ]);
  });

  it('reports created, changed and removed', async () => {
    await files.watch(A, dir, 1);
    await quiet();
    writeFileSync(join(dir, 'fresh.txt'), 'fresh');
    await vi.waitFor(() => expect(emitted).toContainEqual({ appSessionId: A, path: join(dir, 'fresh.txt'), kind: 'created' }), { timeout: 6000 });
    appendFileSync(join(dir, 'old.txt'), ' more');
    await vi.waitFor(() => expect(emitted).toContainEqual({ appSessionId: A, path: join(dir, 'old.txt'), kind: 'changed' }), { timeout: 6000 });
    unlinkSync(join(dir, 'old.txt'));
    await vi.waitFor(() => expect(emitted).toContainEqual({ appSessionId: A, path: join(dir, 'old.txt'), kind: 'removed' }), { timeout: 6000 });
  });

  it('reports a removed child named as its watched parent as removed at its own path, beside the parent changed', async () => {
    const twin = join(dir, 'dir'); // the parent's own basename, which FSEvents also uses for the parent's own events
    writeFileSync(twin, 'twin');
    age(twin);
    await files.watch(A, dir, 1);
    await quiet();
    unlinkSync(twin);
    await vi.waitFor(() => expect(emitted).toContainEqual({ appSessionId: A, path: twin, kind: 'removed' }), { timeout: 6000 });
    expect(emitted).toContainEqual({ appSessionId: A, path: dir, kind: 'changed' });
  });

  it('coalesces a burst of events per filename into one batch', async () => {
    await files.watch(A, dir, 1);
    await quiet();
    for (let i = 0; i < 5; i++) appendFileSync(join(dir, 'old.txt'), `${i}`);
    writeFileSync(join(dir, 'burst.txt'), 'b');
    appendFileSync(join(dir, 'burst.txt'), 'c');
    await vi.waitFor(() => expect(emitted.length).toBeGreaterThanOrEqual(2), { timeout: 6000 });
    await settle();
    expect(emitted.filter((e) => e.path === join(dir, 'old.txt'))).toEqual([{ appSessionId: A, path: join(dir, 'old.txt'), kind: 'changed' }]);
    expect(emitted.filter((e) => e.path === join(dir, 'burst.txt'))).toEqual([{ appSessionId: A, path: join(dir, 'burst.txt'), kind: 'created' }]);
    expect(calls.filter((c) => c === 'before-batch')).toHaveLength(1);
  });

  it('confirms a batch before it forwards it', async () => {
    await files.watch(A, dir, 1);
    await quiet();
    writeFileSync(join(dir, 'x.txt'), 'x');
    await vi.waitFor(() => expect(emitted).toHaveLength(1), { timeout: 6000 });
    expect(calls).toEqual(['before-batch', 'emit:created']);
  });

  it('closes the watcher when the last holder unwatches, and not before', async () => {
    await files.watch(A, dir, 1);
    await files.watch(A, dir, 1); // ref-counted: the same holder twice
    await files.watch(B, dir, 1);
    await files.unwatch(A, dir, 1);
    await files.unwatch(B, dir, 1);
    expect(watchers[0].close).not.toHaveBeenCalled();
    await files.unwatch(A, dir, 1);
    expect(watchers[0].close).toHaveBeenCalledTimes(1);
    expect(files.watching()).toEqual([]);
    await files.unwatch(A, dir, 1); // an unknown hold is a no-op
  });

  it('an unwatch in flight across its window’s release leaves the next page’s hold under the same key', async () => {
    await files.watch(A, dir, 1);
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => (resume = resolve));
    const realpath = fs.promises.realpath.bind(fs.promises);
    vi.spyOn(fs.promises, 'realpath').mockImplementationOnce((async (path: string) => {
      await gate;
      return realpath(path);
    }) as typeof fs.promises.realpath);
    const stale = files.unwatch(A, dir, 1); // the old page's, held at its realpath
    files.release(1); // the window navigates
    await files.watch(A, dir, 1); // the new page's hold, under the same (owner, session, path)
    resume();
    await stale;
    expect(files.watching()).toEqual([dir]);
    await files.unwatch(A, dir, 1); // the new page's own unwatch still drops it
    expect(files.watching()).toEqual([]);
  });

  it('unwatch drops the hold on the directory the path names now when its realpath moved between two watches', async () => {
    const asked = join(root, 'Case'); // APFS is case-insensitive: a case-only rename moves the realpath under the same path
    mkdirSync(asked);
    await files.watch(A, asked, 1); // keyed by …/Case
    renameSync(asked, join(root, 'case'));
    expect(realpathSync.native(asked)).toBe(join(root, 'case')); // the volume this suite relies on (realpath(3), as fs.promises)
    await files.watch(A, asked, 1); // the same holder, now keyed by …/case
    expect(files.watching().sort()).toEqual([asked, join(root, 'case')].sort());
    await files.unwatch(A, asked, 1);
    expect(files.watching()).toEqual([asked]); // the newer hold, on the directory the path names now, went
    await files.unwatch(A, asked, 1);
    expect(files.watching()).toEqual([]);
  });

  it('releases every hold of a window that closes or navigates', async () => {
    await files.watch(A, dir, 1);
    await files.watch(B, dir, 2);
    await quiet();
    files.release(1);
    expect(watchers[0].close).not.toHaveBeenCalled();
    writeFileSync(join(dir, 'y.txt'), 'y');
    await vi.waitFor(() => expect(emitted).toHaveLength(1), { timeout: 6000 });
    expect(emitted[0].appSessionId).toBe(B); // the released holder's session is no longer told
    files.release(2);
    expect(watchers[0].close).toHaveBeenCalled();
    expect(files.watching()).toEqual([]);
  });

  it('invalidates a stale entry when a second holder opens a different directory at the same realpath, and installs anew', async () => {
    await files.watch(A, dir, 1);
    renameSync(dir, join(root, 'moved'));
    mkdirSync(dir);
    await files.watch(B, dir, 2);
    expect(emitted).toEqual([{ appSessionId: A, path: dir, kind: 'invalidated' }]);
    expect(watchers).toHaveLength(2);
    expect(watchers[0].close).toHaveBeenCalled();
    expect(files.watching()).toEqual([dir]);
    await settle(); // libuv restarts its one FSEvents stream when a watcher is added or closed; a write inside the restart is lost
    writeFileSync(join(dir, 'z.txt'), 'z');
    await vi.waitFor(() => expect(emitted).toContainEqual({ appSessionId: B, path: join(dir, 'z.txt'), kind: 'created' }), { timeout: 6000 });
  });

  it('invalidates a watch whose directory is removed, and a fresh watch after it is back installs a new watcher', async () => {
    await files.watch(A, dir, 1);
    await settle(); // past the stream restart (above)
    rmSync(dir, { recursive: true });
    await vi.waitFor(() => expect(emitted).toContainEqual({ appSessionId: A, path: dir, kind: 'invalidated' }), { timeout: 6000 });
    expect(files.watching()).toEqual([]);
    mkdirSync(dir);
    await files.watch(A, dir, 1);
    expect(watchers).toHaveLength(2);
    expect(files.watching()).toEqual([dir]);
  });
});
