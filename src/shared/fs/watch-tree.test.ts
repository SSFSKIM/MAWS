import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drain, errno, FakeWatchFs } from '../../../test/support/fake-watch-fs';
import { BURST_EVENTS, BURST_SETTLE_MS, RECONCILE_MS, recursiveWatch, watchTree, type WatchHandle } from './watch-tree';

type Heard = [string, string | null];

function open(fake: FakeWatchFs, prune?: (dir: string) => boolean | Promise<boolean>) {
  const heard: Heard[] = [];
  const errors: NodeJS.ErrnoException[] = [];
  const handle = watchTree(fake.root, { fs: fake.options, prune }, (event, filename) => heard.push([event, filename]));
  handle.on('error', (error) => errors.push(error));
  return { handle, heard, errors, names: () => heard.map(([, filename]) => filename) };
}

describe('the watch tree walks a directory tree', () => {
  it('watches the root and every directory beneath it, one non-recursive watch each and none per file', async () => {
    const fake = new FakeWatchFs();
    fake.write('a.txt');
    fake.write('src/b.ts');
    fake.write('src/deep/er/c.ts');
    fake.write('docs/d.md');
    fake.write('src/link', 'link'); // a symlink is never descended
    const { handle } = open(fake);
    expect(fake.watched()).toEqual(['']); // the root's watch is placed by the call itself
    await drain();
    expect(fake.watched().sort()).toEqual(['', 'docs', 'src', 'src/deep', 'src/deep/er']);
    handle.close();
  });

  it('walks asynchronously: a listing that resolves later holds no watch placed beside it', async () => {
    const fake = new FakeWatchFs();
    fake.mkdir('slow/inner');
    fake.mkdir('fast/inner');
    const release = fake.hold('slow');
    const { handle } = open(fake);
    await drain();
    expect(fake.watched().sort()).toEqual(['', 'fast', 'fast/inner', 'slow']); // `slow` is watched before it is listed
    release();
    await drain();
    expect(fake.watched()).toContain('slow/inner');
    handle.close();
  });

  it('never walks or watches a directory the predicate prunes, and keeps every ancestor of an admitted one', async () => {
    const fake = new FakeWatchFs();
    fake.write('node_modules/pkg/index.js');
    fake.write('src/build/out.js');
    fake.write('src/kept/a.ts');
    const asked: string[] = [];
    const { handle } = open(fake, async (dir) => {
      asked.push(dir);
      return dir === 'node_modules' || dir === 'src/build';
    });
    await drain();
    expect(fake.watched().sort()).toEqual(['', 'src', 'src/kept']);
    expect(asked.sort()).toEqual(['node_modules', 'src', 'src/build', 'src/kept']); // nothing beneath a pruned one is asked
    handle.close();
  });

  it('ends its initial walk in one event with no filename, and is silent while it walks', async () => {
    const fake = new FakeWatchFs();
    fake.write('src/a.ts');
    const { handle, heard } = open(fake);
    expect(heard).toEqual([]);
    await drain();
    expect(heard).toEqual([['rename', null]]);
    handle.close();
  });

  it('names each event by its path relative to the root', async () => {
    const fake = new FakeWatchFs();
    fake.write('src/deep/a.ts');
    const { handle, heard } = open(fake);
    await drain();
    heard.length = 0;
    fake.fire('src/deep', 'change', 'a.ts');
    fake.fire('', 'change', 'top.txt');
    expect(heard).toEqual([
      ['change', 'src/deep/a.ts'],
      ['change', 'top.txt'],
    ]);
    handle.close();
  });

  it('throws ENOENT at the root from the call itself, as fs.watch does', () => {
    const fake = new FakeWatchFs('/r');
    expect(() => watchTree('/missing', { fs: fake.options }, () => {})).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });

  it('drops a directory that vanished between its listing and its watch, silently', async () => {
    const fake = new FakeWatchFs();
    fake.mkdir('gone');
    fake.mkdir('kept');
    fake.failWatch = (path) => (path === fake.abs('gone') ? errno('ENOENT', path) : null);
    const { handle, errors } = open(fake);
    await drain();
    expect(fake.watched().sort()).toEqual(['', 'kept']);
    expect(errors).toEqual([]);
    handle.close();
  });
});

describe('the watch tree follows directories created and removed after it opened', () => {
  it('watches a directory its parent reports created, reporting each entry it already holds and then the directory itself', async () => {
    const fake = new FakeWatchFs();
    const { handle, heard } = open(fake);
    await drain();
    heard.length = 0;
    fake.write('jobs/abcd1234/state.json'); // written before any watch could see it
    fake.write('jobs/abcd1234/tmp/out.txt');
    fake.fire('', 'rename', 'jobs');
    await drain();
    expect(fake.watched().sort()).toEqual(['', 'jobs', 'jobs/abcd1234', 'jobs/abcd1234/tmp']);
    expect(heard).toContainEqual(['rename', 'jobs/abcd1234/state.json']);
    expect(heard).toContainEqual(['rename', 'jobs/abcd1234/tmp/out.txt']);
    // Each directory's own event follows its listing's.
    const at = (name: string) => heard.findIndex(([, filename]) => filename === name);
    expect(at('jobs')).toBeGreaterThan(at('jobs/abcd1234'));
    expect(at('jobs/abcd1234')).toBeGreaterThan(at('jobs/abcd1234/state.json'));
    expect(heard.filter(([, filename]) => filename === 'jobs')).toHaveLength(1);
    handle.close();
  });

  it('holds a late directory unwatched until the predicate answers, then watches it with one event naming it', async () => {
    const fake = new FakeWatchFs();
    let answer!: (pruned: boolean) => void;
    const { handle, heard } = open(fake, (dir) => (dir === 'fresh' ? new Promise<boolean>((resolve) => (answer = resolve)) : false));
    await drain();
    heard.length = 0;
    fake.mkdir('fresh');
    fake.fire('', 'rename', 'fresh');
    fake.write('fresh/early.txt'); // written while the verdict is pending
    await drain();
    expect(fake.watched()).toEqual(['']);
    expect(heard).toEqual([]);
    answer(false);
    await drain();
    expect(fake.watched()).toEqual(['', 'fresh']);
    expect(heard).toEqual([
      ['rename', 'fresh/early.txt'],
      ['rename', 'fresh'],
    ]);
    handle.close();
  });

  it('reports a late directory the predicate prunes once, by its own name, and never watches it', async () => {
    const fake = new FakeWatchFs();
    const { handle, heard } = open(fake, (dir) => dir === 'node_modules');
    await drain();
    heard.length = 0;
    fake.write('node_modules/a/b.js');
    fake.fire('', 'rename', 'node_modules');
    await drain();
    expect(fake.watched()).toEqual(['']);
    expect(heard).toEqual([['rename', 'node_modules']]);
    handle.close();
  });

  it('watches a directory seen twice once', async () => {
    const fake = new FakeWatchFs();
    const { handle } = open(fake);
    await drain();
    fake.mkdir('twice');
    fake.fire('', 'rename', 'twice');
    fake.fire('', 'rename', 'twice');
    await drain();
    expect(fake.watched()).toEqual(['', 'twice']);
    handle.close();
  });

  it('reports a removed directory by its parent and closes its watch and every watch beneath it', async () => {
    const fake = new FakeWatchFs();
    fake.write('a/b/c.txt');
    const { handle, heard } = open(fake);
    await drain();
    heard.length = 0;
    fake.rm('a');
    // inotify tells the removed directories themselves too; libuv names such an event by the directory's own name.
    fake.fire('a/b', 'rename', 'b');
    fake.fire('a', 'rename', 'a');
    fake.fire('', 'rename', 'a');
    await drain();
    expect(fake.watched()).toEqual(['']);
    expect(heard).toEqual([['rename', 'a']]); // never `a/a` or `a/b/b`
    handle.close();
  });

  it("reads an event naming a child that shares its directory's name as the child's", async () => {
    const fake = new FakeWatchFs();
    fake.write('src/src');
    const { handle, heard } = open(fake);
    await drain();
    heard.length = 0;
    fake.fire('src', 'change', 'src');
    await drain();
    expect(heard).toEqual([['change', 'src/src']]);
    heard.length = 0;
    fake.rm('src/src');
    fake.fire('src', 'rename', 'src');
    await drain();
    expect(heard).toEqual([['rename', 'src/src']]);
    handle.close();
  });

  it('watches a directory replaced under the same name afresh', async () => {
    const fake = new FakeWatchFs();
    fake.mkdir('dist');
    const { handle, heard } = open(fake);
    await drain();
    const first = fake.watches.find((watch) => watch.path === fake.abs('dist'))!;
    heard.length = 0;
    fake.rm('dist');
    fake.write('dist/new.js'); // removed and made again before either event was read
    fake.fire('', 'rename', 'dist');
    fake.fire('', 'rename', 'dist');
    await drain();
    expect(first.closed).toBe(true);
    expect(fake.watched()).toEqual(['', 'dist']);
    expect(heard).toContainEqual(['rename', 'dist/new.js']);
    handle.close();
  });

  it('reports a file event once it knows the name is no directory', async () => {
    const fake = new FakeWatchFs();
    const { handle, heard } = open(fake);
    await drain();
    heard.length = 0;
    fake.write('new.txt');
    fake.fire('', 'rename', 'new.txt');
    fake.fire('', 'rename', 'never-there.txt');
    await drain();
    expect(heard).toEqual([
      ['rename', 'new.txt'],
      ['rename', 'never-there.txt'],
    ]);
    expect(fake.watched()).toEqual(['']);
    handle.close();
  });
});

describe('the watch tree reconciles', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('re-walks on a slow timer, watching what it finds unwatched, and ends each pass in one event with no filename', async () => {
    const fake = new FakeWatchFs();
    const { handle, heard } = open(fake);
    await drain();
    heard.length = 0;
    fake.write('quiet/a.txt'); // its parent's event was lost
    await vi.advanceTimersByTimeAsync(RECONCILE_MS - 1);
    await drain();
    expect(fake.watched()).toEqual(['']);
    expect(heard).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await drain();
    expect(fake.watched()).toEqual(['', 'quiet']);
    expect(heard).toEqual([['rename', null]]);
    await vi.advanceTimersByTimeAsync(RECONCILE_MS);
    await drain();
    expect(heard).toEqual([['rename', null], ['rename', null]]); // every pass, whether or not it found anything
    handle.close();
  });

  it('takes its period from the options', async () => {
    const fake = new FakeWatchFs();
    const heard: Heard[] = [];
    const handle = watchTree(fake.root, { fs: fake.options, reconcileMs: 600_000 }, (event, filename) => heard.push([event, filename]));
    await drain();
    heard.length = 0;
    await vi.advanceTimersByTimeAsync(RECONCILE_MS);
    await drain();
    expect(heard).toEqual([]);
    await vi.advanceTimersByTimeAsync(600_000 - RECONCILE_MS);
    await drain();
    expect(heard).toEqual([['rename', null]]);
    handle.close();
  });

  it('re-walks once, a settle after a burst ends, and not before', async () => {
    const fake = new FakeWatchFs();
    const { handle, heard } = open(fake);
    await drain();
    for (let i = 0; i < BURST_EVENTS; i++) fake.fire('', 'change', `f${i}`);
    heard.length = 0;
    await vi.advanceTimersByTimeAsync(BURST_SETTLE_MS / 2);
    fake.fire('', 'change', 'late'); // the burst goes on: the settle waits for it to end
    await vi.advanceTimersByTimeAsync(BURST_SETTLE_MS / 2 + 1);
    await drain();
    expect(heard).toEqual([['change', 'late']]);
    await vi.advanceTimersByTimeAsync(BURST_SETTLE_MS / 2);
    await drain();
    expect(heard).toEqual([['change', 'late'], ['rename', null]]);
    await vi.advanceTimersByTimeAsync(BURST_SETTLE_MS * 5);
    await drain();
    expect(heard).toHaveLength(2);
    handle.close();
  });

  it('sees no burst in fewer events', async () => {
    const fake = new FakeWatchFs();
    const { handle, heard } = open(fake);
    await drain();
    for (let i = 0; i < BURST_EVENTS - 1; i++) fake.fire('', 'change', `f${i}`);
    heard.length = 0;
    await vi.advanceTimersByTimeAsync(BURST_SETTLE_MS * 3);
    await drain();
    expect(heard).toEqual([]);
    handle.close();
  });

  it('drops the watches of a directory a pass finds gone', async () => {
    const fake = new FakeWatchFs();
    fake.mkdir('a/b');
    const { handle } = open(fake);
    await drain();
    fake.rm('a/b'); // its parent's event was lost
    await vi.advanceTimersByTimeAsync(RECONCILE_MS);
    await drain();
    expect(fake.watched()).toEqual(['', 'a']);
    handle.close();
  });
});

describe('the watch tree at exhaustion', () => {
  it.each(['ENOSPC', 'EMFILE'])('reports %s from a watch call once, with the code and the directory, after closing the partial tree', async (code) => {
    const fake = new FakeWatchFs();
    fake.mkdir('a');
    fake.mkdir('b/c');
    fake.failWatch = (path, call) => (call === 3 ? errno(code, path) : null);
    const { handle, heard, errors } = open(fake);
    await drain();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code });
    expect([fake.abs('a'), fake.abs('b'), fake.abs('b/c')]).toContain(errors[0].path); // the directory the third call named
    expect(fake.watched()).toEqual([]);
    // Closed: nothing more is heard, nothing more is watched.
    fake.mkdir('d');
    fake.fire('', 'rename', 'd');
    await drain();
    expect(heard).toEqual([]);
    expect(fake.watched()).toEqual([]);
    handle.close(); // idempotent after the tree closed itself
    expect(errors).toHaveLength(1);
  });

  it('reports the root\'s own exhaustion on a later tick, never from the call', async () => {
    const fake = new FakeWatchFs();
    fake.failWatch = (path) => errno('ENOSPC', path);
    let handle!: WatchHandle;
    expect(() => (handle = watchTree(fake.root, { fs: fake.options }, () => {}))).not.toThrow();
    const errors: NodeJS.ErrnoException[] = [];
    handle.on('error', (error) => errors.push(error)); // attached after the call, as both watchers attach theirs
    expect(errors).toEqual([]);
    await drain();
    expect(errors.map((error) => [error.code, error.path])).toEqual([['ENOSPC', fake.root]]);
    expect(fake.listings).toBe(0);
  });

  it('reports a late directory\'s exhaustion likewise', async () => {
    const fake = new FakeWatchFs();
    const { handle, errors } = open(fake);
    await drain();
    fake.failWatch = (path) => errno('ENOSPC', path);
    fake.mkdir('later');
    fake.fire('', 'rename', 'later');
    await drain();
    expect(errors.map((error) => [error.code, error.path])).toEqual([['ENOSPC', fake.abs('later')]]);
    expect(fake.watched()).toEqual([]);
    handle.close();
  });

  it('passes the root watch\'s later error on and closes; a directory beneath it that errs is dropped', async () => {
    const fake = new FakeWatchFs();
    fake.mkdir('sub');
    const { handle, errors } = open(fake);
    await drain();
    const sub = fake.watches.find((watch) => watch.path === fake.abs('sub'))!;
    sub.errors.forEach((listener) => listener(errno('EPERM', sub.path)));
    expect(fake.watched()).toEqual(['']);
    expect(errors).toEqual([]);
    const root = fake.watches.find((watch) => watch.path === fake.root)!;
    root.errors.forEach((listener) => listener(errno('EPERM', root.path)));
    await drain();
    expect(errors.map((error) => error.code)).toEqual(['EPERM']);
    expect(fake.watched()).toEqual([]);
    handle.close();
  });
});

describe('closing the watch tree', () => {
  it('closes every watch, cancels its walk and timers, and emits nothing more; a second close changes nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const fake = new FakeWatchFs();
      fake.mkdir('a/b');
      const release = fake.hold('a');
      const { handle, heard } = open(fake);
      await drain();
      handle.close();
      handle.close();
      release();
      await drain();
      await vi.advanceTimersByTimeAsync(RECONCILE_MS * 2);
      await drain();
      expect(fake.watched()).toEqual([]);
      expect(heard).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the platform\'s recursive watch', () => {
  let dir: string;
  beforeEach(() => void (dir = realpathSync(mkdtempSync(join(tmpdir(), 'maws-watch-tree-')))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // fs.watch answers an FSWatcher, an EventEmitter (node:fs exports no FSWatcher constructor); the tree is none.
  it('is the watch tree on Linux for a recursive watch, and fs.watch for a flat one', () => {
    const tree = recursiveWatch('linux')(dir, { recursive: true }, () => {});
    const flat = recursiveWatch('linux')(dir, { recursive: false }, () => {});
    expect(tree).not.toBeInstanceOf(EventEmitter);
    expect(flat).toBeInstanceOf(EventEmitter);
    tree.close();
    flat.close();
  });

  it('is fs.watch everywhere else', () => {
    const flat = recursiveWatch('darwin')(dir, { recursive: false }, () => {});
    expect(flat).toBeInstanceOf(EventEmitter);
    flat.close();
    if (process.platform === 'linux') return; // Node's own recursive call is what the tree replaces there
    const deep = recursiveWatch('darwin')(dir, { recursive: true, prune: () => true }, () => {});
    expect(deep).toBeInstanceOf(EventEmitter);
    deep.close();
  });
});

// Real inotify, on the pool's Linux unit job (P5 O3-E D10). Each wait is bounded.
describe.runIf(process.platform === 'linux')('the watch tree over inotify', () => {
  let root: string;
  let handle: WatchHandle | null;
  let heard: string[];
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-watch-tree-')));
    heard = [];
    handle = null;
  });
  afterEach(() => {
    handle?.close();
    rmSync(root, { recursive: true, force: true });
  });

  // The inotify watches this process holds, from /proc/self/fdinfo (what O3-G's measure read).
  function inotifyWatches(): number {
    let watches = 0;
    for (const fd of readdirSync('/proc/self/fd')) {
      let target: string;
      try {
        target = readlinkSync(`/proc/self/fd/${fd}`);
      } catch {
        continue;
      }
      if (target !== 'anon_inode:inotify') continue;
      try {
        watches += readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').split('\n').filter((line) => line.startsWith('inotify wd:')).length;
      } catch {
        // the descriptor closed meanwhile
      }
    }
    return watches;
  }

  async function until(check: () => boolean, withinMs: number, what: string): Promise<number> {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > withinMs) throw new Error(`${what}: not within ${withinMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return Date.now() - start;
  }

  function start(): void {
    handle = watchTree(root, {}, (_event, filename) => heard.push(filename ?? '<null>'));
  }

  it('names events relative to the root, watching directories and no file', async () => {
    mkdirSync(join(root, 'src/deep'), { recursive: true });
    for (let i = 0; i < 20; i++) writeFileSync(join(root, 'src/deep', `f${i}.ts`), 'x');
    const before = inotifyWatches();
    start();
    await until(() => heard.includes('<null>'), 2000, 'the initial walk');
    expect(inotifyWatches() - before).toBe(3); // the root, src, src/deep
    writeFileSync(join(root, 'src/deep/f3.ts'), 'changed');
    await until(() => heard.includes('src/deep/f3.ts'), 1000, 'the write');
  });

  it("reports a directory's children written after it was made, and closes the watch of a removed one", async () => {
    start();
    await until(() => heard.includes('<null>'), 2000, 'the initial walk');
    const before = inotifyWatches();
    mkdirSync(join(root, 'late/inner'), { recursive: true });
    writeFileSync(join(root, 'late/inner/early.txt'), 'x');
    await until(() => heard.includes('late/inner/early.txt'), 1000, 'the early file');
    await until(() => inotifyWatches() === before + 2, 1000, 'the late watches');
    writeFileSync(join(root, 'late/inner/after.txt'), 'x');
    await until(() => heard.includes('late/inner/after.txt'), 1000, 'the later file');
    rmSync(join(root, 'late'), { recursive: true });
    await until(() => heard.includes('late'), 1000, 'the removal');
    await until(() => inotifyWatches() === before, 1000, 'the closed watches');
    expect(heard).not.toContain('late/late');
  });

  it('names every file of a 2,000-file burst into a new directory within 1 s of the burst', async () => {
    start();
    await until(() => heard.includes('<null>'), 2000, 'the initial walk');
    mkdirSync(join(root, 'burst'));
    const files = 2000;
    await new Promise<void>((resolve, reject) =>
      execFile(process.execPath, ['-e', `const fs=require('fs');for(let i=0;i<${files};i++)fs.writeFileSync(${JSON.stringify(join(root, 'burst'))}+'/c'+i,'x')`], (error) => (error ? reject(error) : resolve())),
    );
    await until(
      () => {
        const named = new Set(heard.filter((name) => /^burst\/c\d+$/.test(name)));
        return named.size === files;
      },
      1000, // from the writer's exit: its own run is not the tree's
      'every burst file',
    );
  });
});
