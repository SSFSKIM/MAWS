// The open-first boundary of `files.*` (C8c execution document, Interfaces "The boundary tests"). Every substitution
// runs at a named boundary point through the service's test-only hook, so each race is reproduced deterministically;
// the two negative controls run the same substitutions against the check-then-use shape K1 corrects and read outside
// bytes and outside metadata, so the service's refusal in the same scenario is evidence, not an accident of the point.
import { execFileSync } from 'node:child_process';
import fs, { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { FILES_LIST_MAX_ENTRIES, type FilesChanged } from '@shared/ipc/schema/files';
import { rootsOf, under, type AllowlistRecord } from './allowlist';
import { createFilesService, type BoundaryPoint, type FilesServiceOptions } from './service';

const OUT = "path outside the session's directories";
const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;
const MiB = 1024 * 1024;

let base: string;
let root: string;
let outside: string;
let records: Map<string, AllowlistRecord>;
let points: Partial<Record<BoundaryPoint, (path: string) => void | Promise<void>>>;
let emitted: FilesChanged[];
let services: { dispose(): void }[];

const at = (...parts: string[]) => join(base, ...parts);
const inRoot = (...parts: string[]) => join(root, ...parts);
function write(path: string, content: string | Buffer) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}
// Replace `path` by a symlink to `target`, keeping the original beside it for `restore`.
function swapToLink(path: string, target: string) {
  renameSync(path, `${path}.away`);
  symlinkSync(target, path);
}
function restore(path: string) {
  unlinkSync(path);
  renameSync(`${path}.away`, path);
}
const record = (directory: string, additionalDirectories: string[] = [], worktree: string | null = null): AllowlistRecord => ({
  directory,
  additionalDirectories,
  worktree: worktree === null ? null : { path: worktree, branch: null },
});
function service(extra: Partial<FilesServiceOptions> = {}) {
  const created = createFilesService({
    records: (id) => records.get(id) ?? null,
    hooks: {
      at: async (point, path) => {
        const fn = points[point];
        if (!fn) return;
        delete points[point]; // each substitution runs once
        await fn(path);
      },
    },
    emit: (payload) => emitted.push(payload),
    ...extra,
  });
  services.push(created);
  return created;
}
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`not answered within ${ms} ms`)), ms))]);
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-files-')));
  root = at('root');
  outside = at('outside');
  write(inRoot('README.md'), '# readme\n');
  write(inRoot('src', 'a.ts'), 'export const a = 1;\n');
  write(inRoot('src', 'other.ts'), 'export const other = 2;\n');
  write(inRoot('a', 'sub', 'f.txt'), 'inner');
  write(join(outside, 'secret.txt'), 'secret');
  write(join(outside, 'src', 'a.ts'), 'outside secret a');
  write(join(outside, 'a', 'sub', 'f.txt'), 'x'.repeat(999));
  mkdirSync(join(outside, 'dirs', 'src', 'a.ts'), { recursive: true });
  write(at('root2', 'x.txt'), 'look-alike');
  records = new Map([[A, record(root)]]);
  points = {};
  emitted = [];
  services = [];
});
afterEach(() => {
  for (const created of services) created.dispose();
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

describe('files service boundary', () => {
  describe('negatives: each answers the refusal and reads nothing', () => {
    it('refuses a symlink inside a root that points to a file outside', async () => {
      symlinkSync(join(outside, 'secret.txt'), inRoot('leak'));
      await expect(service().read({ appSessionId: A, path: inRoot('leak') })).rejects.toThrow(OUT);
    });

    it('refuses `..` segments that leave the root', async () => {
      await expect(service().read({ appSessionId: A, path: `${root}/../outside/secret.txt` })).rejects.toThrow(OUT);
    });

    it('serves a path through a root that is itself a symlink, and refuses one escaping through it', async () => {
      symlinkSync(root, at('root-link'));
      symlinkSync(join(outside, 'secret.txt'), inRoot('leak'));
      records.set(A, record(at('root-link')));
      const files = service();
      expect(await files.read({ appSessionId: A, path: at('root-link', 'src', 'a.ts') })).toMatchObject({ content: 'export const a = 1;\n' });
      await expect(files.read({ appSessionId: A, path: at('root-link', 'leak') })).rejects.toThrow(OUT);
      await expect(files.read({ appSessionId: A, path: `${at('root-link')}/../outside/secret.txt` })).rejects.toThrow(OUT);
    });

    it('refuses a path that is a prefix of the root but not a child', async () => {
      await expect(service().read({ appSessionId: A, path: at('root2', 'x.txt') })).rejects.toThrow(OUT);
      await expect(service().list({ appSessionId: A, path: at('root2') })).rejects.toThrow(OUT);
    });

    it('refuses a relative path', async () => {
      await expect(service().read({ appSessionId: A, path: 'src/a.ts' })).rejects.toThrow('path must be absolute');
    });

    it('refuses a session with no record', async () => {
      await expect(service().read({ appSessionId: 'nope' as AppSessionId, path: inRoot('src', 'a.ts') })).rejects.toThrow('unknown app session: nope');
    });

    it('refuses everything for a session whose every root is missing on disk', async () => {
      records.set(A, record(at('gone'), [at('also-gone')]));
      const files = service();
      await expect(files.read({ appSessionId: A, path: at('gone', 'a.ts') })).rejects.toThrow(OUT);
      await expect(files.list({ appSessionId: A })).rejects.toThrow(OUT);
    });

    it('refuses a missing name under an in-root symlink to an outside directory, and says not found for a missing in-root name', async () => {
      symlinkSync(outside, inRoot('out'));
      const files = service();
      await expect(files.read({ appSessionId: A, path: inRoot('out', 'nope') })).rejects.toThrow(OUT);
      await expect(files.read({ appSessionId: A, path: inRoot('nope') })).rejects.toThrow(`not found: ${inRoot('nope')}`);
      await expect(files.read({ appSessionId: A, path: inRoot('src', 'deeper', 'nope') })).rejects.toThrow('not found: ');
    });

    it('refuses the `..` probe alike whether the probed outside name exists or not', async () => {
      const probe = `${at('x', 'probe')}/../../root/nope`;
      const files = service();
      await expect(files.read({ appSessionId: A, path: probe })).rejects.toThrow(OUT);
      mkdirSync(at('x', 'probe'), { recursive: true });
      await expect(files.read({ appSessionId: A, path: probe })).rejects.toThrow(OUT);
    });

    it('refuses an in-root path that is not already normal though it names an in-root file', async () => {
      await expect(service().read({ appSessionId: A, path: `${root}/src/../README.md` })).rejects.toThrow(OUT);
      await expect(service().read({ appSessionId: A, path: `${root}//README.md` })).rejects.toThrow(OUT);
    });

    it('refuses a dangling in-root link rather than answering not found', async () => {
      symlinkSync(join(outside, 'absent'), inRoot('dangling'));
      await expect(service().read({ appSessionId: A, path: inRoot('dangling') })).rejects.toThrow(OUT);
      await expect(service().read({ appSessionId: A, path: inRoot('dangling', 'x') })).rejects.toThrow(OUT);
    });

    it('refuses a list or a watch through an in-root symlink to an outside directory', async () => {
      symlinkSync(outside, inRoot('out'));
      const files = service();
      await expect(files.list({ appSessionId: A, path: inRoot('out') })).rejects.toThrow(OUT);
      await expect(files.watch(A, inRoot('out'), 1)).rejects.toThrow(OUT);
    });
  });

  describe('pre-open substitutions at before-open', () => {
    it('refuses a final component replaced by a symlink pointing outside (ELOOP)', async () => {
      points['before-open'] = () => {
        unlinkSync(inRoot('src', 'a.ts'));
        symlinkSync(join(outside, 'secret.txt'), inRoot('src', 'a.ts'));
      };
      await expect(service().read({ appSessionId: A, path: inRoot('src', 'a.ts') })).rejects.toThrow(OUT);
    });

    it('refuses an ancestor replaced by a symlink pointing outside (step 5)', async () => {
      points['before-open'] = () => swapToLink(inRoot('src'), join(outside, 'src'));
      await expect(service().read({ appSessionId: A, path: inRoot('src', 'a.ts') })).rejects.toThrow(OUT);
    });

    it('refuses, without naming a type, a parent swapped to an outside directory holding a directory of the file’s name', async () => {
      points['before-open'] = () => swapToLink(inRoot('src'), join(outside, 'dirs', 'src'));
      const answer = service().read({ appSessionId: A, path: inRoot('src', 'a.ts') });
      await expect(answer).rejects.toThrow(OUT);
      await expect(answer).rejects.not.toThrow('not a regular file');
    });

    it('answers not a regular file for a file replaced by an in-root directory (step 5b)', async () => {
      points['before-open'] = () => {
        unlinkSync(inRoot('src', 'a.ts'));
        mkdirSync(inRoot('src', 'a.ts'));
      };
      await expect(service().read({ appSessionId: A, path: inRoot('src', 'a.ts') })).rejects.toThrow(`not a regular file: ${inRoot('src', 'a.ts')}`);
    });

    it('refuses a list of a directory replaced by a file (step 3, ENOTDIR)', async () => {
      points['before-open'] = () => {
        rmSync(inRoot('a', 'sub'), { recursive: true });
        writeFileSync(inRoot('a', 'sub'), 'now a file');
      };
      await expect(service().list({ appSessionId: A, path: inRoot('a', 'sub') })).rejects.toThrow(OUT);
    });

    it('permits an in-root replacement before the open and serves the replacement’s bytes', async () => {
      points['before-open'] = () => renameSync(inRoot('src', 'other.ts'), inRoot('src', 'a.ts'));
      expect(await service().read({ appSessionId: A, path: inRoot('src', 'a.ts') })).toMatchObject({ content: 'export const other = 2;\n' });
    });
  });

  describe('swap and restore, at before-open then after-open', () => {
    it('refuses by the (dev, ino) mismatch an ancestor swapped outside before the open and restored after it', async () => {
      points['before-open'] = () => swapToLink(inRoot('src'), join(outside, 'src'));
      points['after-open'] = () => restore(inRoot('src'));
      await expect(service().read({ appSessionId: A, path: inRoot('src', 'a.ts') })).rejects.toThrow(OUT);
      expect(readFileSync(inRoot('src', 'a.ts'), 'utf8')).toBe('export const a = 1;\n'); // the tree is back as it was
    });
  });

  describe('post-open substitutions at after-open', () => {
    it('refuses a read whose target was replaced in-root after the open (identity, not only containment)', async () => {
      points['after-open'] = () => renameSync(inRoot('src', 'other.ts'), inRoot('src', 'a.ts'));
      await expect(service().read({ appSessionId: A, path: inRoot('src', 'a.ts') })).rejects.toThrow(OUT);
    });

    it('refuses a list whose directory was replaced in-root after the open', async () => {
      mkdirSync(inRoot('target'));
      write(inRoot('sibling', 'f.txt'), 'sibling');
      points['after-open'] = () => renameSync(inRoot('sibling'), inRoot('target'));
      await expect(service().list({ appSessionId: A, path: inRoot('target') })).rejects.toThrow(OUT);
    });
  });

  describe('FIFO', () => {
    it('answers not a regular file for a pre-existing FIFO within a second', async () => {
      execFileSync('mkfifo', [inRoot('pipe')]);
      await expect(within(service().read({ appSessionId: A, path: inRoot('pipe') }), 1000)).rejects.toThrow(`not a regular file: ${inRoot('pipe')}`);
    });

    it('answers the same for a file replaced by a FIFO before the open, and a healthy read completes right after', async () => {
      points['before-open'] = () => {
        unlinkSync(inRoot('src', 'a.ts'));
        execFileSync('mkfifo', [inRoot('src', 'a.ts')]);
      };
      const files = service();
      await expect(within(files.read({ appSessionId: A, path: inRoot('src', 'a.ts') }), 1000)).rejects.toThrow('not a regular file');
      // four blocked opens would hold every threadpool thread; a healthy read proves none is held
      const reads = Array.from({ length: 4 }, () => files.read({ appSessionId: A, path: inRoot('src', 'other.ts') }));
      expect((await within(Promise.all(reads), 1000)).map((r) => r.content)).toEqual(Array(4).fill('export const other = 2;\n'));
    });
  });

  describe('negative control', () => {
    // Step 1, then readFile(real0): the check-then-open shape of C4's artifacts.ts before K1.
    async function checkThenOpen(path: string, between: () => void): Promise<string> {
      const roots = await rootsOf(records.get(A)!);
      const real0 = await realpath(path);
      if (!roots.some((r) => under(r, real0))) throw new Error(OUT);
      between();
      return readFile(real0, 'utf8');
    }

    it('reads the outside file’s bytes through check-then-open under the same ancestor substitution', async () => {
      const read = await checkThenOpen(inRoot('src', 'a.ts'), () => swapToLink(inRoot('src'), join(outside, 'src')));
      expect(read).toBe('outside secret a');
    });
  });

  it('opens with numeric flags including O_NONBLOCK and O_NOFOLLOW, and never calls readFile', async () => {
    const open = vi.spyOn(fs.promises, 'open');
    const readFileSpy = vi.spyOn(fs.promises, 'readFile');
    const files = service();
    await files.read({ appSessionId: A, path: inRoot('src', 'a.ts') });
    await files.list({ appSessionId: A, path: inRoot('src') });
    const { O_NONBLOCK, O_NOFOLLOW, O_DIRECTORY } = fs.constants;
    expect(open).toHaveBeenCalledTimes(2);
    for (const [, flags] of open.mock.calls) {
      expect(typeof flags).toBe('number');
      expect((flags as number) & O_NONBLOCK).toBe(O_NONBLOCK);
      expect((flags as number) & O_NOFOLLOW).toBe(O_NOFOLLOW);
    }
    expect((open.mock.calls[0][1] as number) & O_DIRECTORY).toBe(0);
    expect((open.mock.calls[1][1] as number) & O_DIRECTORY).toBe(O_DIRECTORY);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it('answers not a regular file for an in-root directory, and the refusal for a watch of a regular file', async () => {
    const files = service();
    await expect(files.read({ appSessionId: A, path: inRoot('src') })).rejects.toThrow(`not a regular file: ${inRoot('src')}`);
    await expect(files.watch(A, inRoot('src', 'a.ts'), 1)).rejects.toThrow(OUT);
    await expect(files.list({ appSessionId: A, path: inRoot('src', 'a.ts') })).rejects.toThrow(OUT);
  });
});

describe('files service late confirmation', () => {
  // `a` is the ancestor swapped to `outside/a`, whose `sub/f.txt` has the same name as the inside entry and 999 bytes.
  const swapAncestor = () => swapToLink(inRoot('a'), join(outside, 'a'));

  it('refuses the whole listing when an ancestor is swapped after readdir', async () => {
    points['after-readdir'] = swapAncestor;
    const answer = service().list({ appSessionId: A, path: inRoot('a', 'sub') });
    await expect(answer).rejects.toThrow(OUT); // nothing collected is answered: the outside size never leaves
  });

  it('reports the outside size through check-then-list under the same substitution (the control)', async () => {
    async function checkThenList(path: string, between: () => void) {
      const roots = await rootsOf(records.get(A)!);
      const real0 = await realpath(path);
      if (!roots.some((r) => under(r, real0))) throw new Error(OUT);
      const names = await readdir(real0);
      between();
      return Promise.all(names.map(async (name) => ({ name, size: (await lstat(join(real0, name))).size })));
    }
    expect(await checkThenList(inRoot('a', 'sub'), swapAncestor)).toEqual([{ name: 'f.txt', size: 999 }]);
  });

  it('refuses a watch whose directory is swapped after the install, closes the watcher, and emits nothing for outside writes', async () => {
    const realWatch = fs.watch.bind(fs);
    const closes: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(fs, 'watch').mockImplementation(((...args: Parameters<typeof fs.watch>) => {
      const watcher = realWatch(...args);
      closes.push(vi.spyOn(watcher, 'close') as unknown as ReturnType<typeof vi.fn>);
      return watcher;
    }) as typeof fs.watch);
    points['after-watch-install'] = swapAncestor;
    await expect(service().watch(A, inRoot('a', 'sub'), 1)).rejects.toThrow(OUT);
    expect(closes).toHaveLength(1);
    expect(closes[0]).toHaveBeenCalled();
    writeFileSync(join(outside, 'a', 'sub', 'new.txt'), 'outside write');
    appendFileSync(join(outside, 'a', 'sub', 'f.txt'), 'more');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(emitted).toEqual([]);
  });

  it('drops a batch whose directory was swapped, invalidates once per holder, refuses a re-watch while it stands, and recovers after', async () => {
    records.set(B, record(root));
    const realWatch = fs.watch.bind(fs);
    const closes: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(fs, 'watch').mockImplementation(((...args: Parameters<typeof fs.watch>) => {
      const watcher = realWatch(...args);
      closes.push(vi.spyOn(watcher, 'close') as unknown as ReturnType<typeof vi.fn>);
      return watcher;
    }) as typeof fs.watch);
    const files = service();
    const dir = inRoot('a', 'sub');
    await files.watch(A, dir, 1);
    await files.watch(B, dir, 1);
    expect(closes).toHaveLength(1); // one watcher for both holders
    // FSEvents replays the fixture's own writes just after an install; let that batch pass before arming the swap
    await new Promise((resolve) => setTimeout(resolve, 700));
    emitted.length = 0;
    points['before-batch'] = swapAncestor;
    writeFileSync(join(dir, 'new.txt'), 'inside write');
    await vi.waitFor(() => expect(emitted).toHaveLength(2), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 400)); // nothing else trails the invalidation
    expect(emitted.filter((e) => e.path !== dir)).toEqual([]); // no filename forwarded
    expect(emitted.sort((x, y) => x.appSessionId.localeCompare(y.appSessionId))).toEqual([
      { appSessionId: A, path: dir, kind: 'invalidated' },
      { appSessionId: B, path: dir, kind: 'invalidated' },
    ]);
    expect(closes[0]).toHaveBeenCalled();
    expect(files.watching()).toEqual([]);

    await expect(files.watch(A, dir, 1)).rejects.toThrow(OUT); // refused at step 1 while the swap stands
    restore(inRoot('a'));
    emitted.length = 0;
    await files.watch(A, dir, 1);
    expect(closes).toHaveLength(2); // a new watcher
    writeFileSync(join(dir, 'after.txt'), 'restored');
    await vi.waitFor(() => expect(emitted).toContainEqual({ appSessionId: A, path: join(dir, 'after.txt'), kind: 'created' }), { timeout: 3000 });
  });
});

describe('files service listing and reading', () => {
  it('reads at offset and length with truncated and length', async () => {
    write(inRoot('ten.txt'), '0123456789');
    const files = service();
    expect(await files.read({ appSessionId: A, path: inRoot('ten.txt'), offset: 2, length: 3 })).toEqual({
      encoding: 'utf8', content: '234', bytes: 10, offset: 2, length: 3, truncated: true, mime: 'text/plain',
    });
    expect(await files.read({ appSessionId: A, path: inRoot('ten.txt'), offset: 7 })).toMatchObject({ content: '789', length: 3, truncated: false });
    expect(await files.read({ appSessionId: A, path: inRoot('ten.txt'), offset: 10 })).toMatchObject({ content: '', length: 0, truncated: false, offset: 10 });
    expect(await files.read({ appSessionId: A, path: inRoot('ten.txt'), offset: 50 })).toMatchObject({ content: '', length: 0, truncated: false });
  });

  it('ends a utf8 chunk on a character boundary and begins the next with the whole character', async () => {
    write(inRoot('euro.txt'), 'ab€cd'); // € is three bytes: a b E2 82 AC c d
    const files = service();
    const first = await files.read({ appSessionId: A, path: inRoot('euro.txt'), length: 3 });
    expect(first).toMatchObject({ content: 'ab', length: 2, truncated: true });
    const second = await files.read({ appSessionId: A, path: inRoot('euro.txt'), offset: first.offset + first.length, length: 3 });
    expect(second).toMatchObject({ content: '€', offset: 2, length: 3, truncated: true });
    // a chunk withholding would leave empty reads forward to finish the character instead
    expect(await files.read({ appSessionId: A, path: inRoot('euro.txt'), offset: 2, length: 1 })).toMatchObject({ content: '€', length: 3 });
  });

  it('withholds a trailing \\r so a CRLF is never split across chunks', async () => {
    write(inRoot('crlf.txt'), 'ab\r\ncd\r\n');
    const files = service();
    const first = await files.read({ appSessionId: A, path: inRoot('crlf.txt'), length: 3 });
    expect(first).toMatchObject({ content: 'ab', length: 2, truncated: true });
    expect(await files.read({ appSessionId: A, path: inRoot('crlf.txt'), offset: 2, length: 3 })).toMatchObject({ content: '\r\ncd'.slice(0, 3), length: 3 });
    // a lone \r chunk reads forward one byte for the \n; the chunk that ends the file keeps its \r
    expect(await files.read({ appSessionId: A, path: inRoot('crlf.txt'), offset: 2, length: 1 })).toMatchObject({ content: '\r\n', length: 2 });
    write(inRoot('cr-end.txt'), 'ab\r');
    expect(await files.read({ appSessionId: A, path: inRoot('cr-end.txt') })).toMatchObject({ content: 'ab\r', length: 3, truncated: false });
  });

  it('decides the encoding once per file from its head, whatever the chunk', async () => {
    const late = Buffer.alloc(2 * MiB, 0x61);
    late[1.5 * MiB] = 0; // a NUL past the sniff: the file is text
    write(inRoot('late-nul.log'), late);
    const early = Buffer.alloc(2 * MiB, 0x61);
    early[100] = 0; // a NUL inside the sniff: every chunk is binary, even one with no NUL of its own
    write(inRoot('early-nul.log'), early);
    const files = service();
    expect(await files.read({ appSessionId: A, path: inRoot('late-nul.log') })).toMatchObject({ encoding: 'utf8', length: MiB, truncated: true });
    expect(await files.read({ appSessionId: A, path: inRoot('late-nul.log'), offset: MiB })).toMatchObject({ encoding: 'utf8', length: MiB, truncated: false });
    const tail = await files.read({ appSessionId: A, path: inRoot('early-nul.log'), offset: MiB });
    expect(tail).toMatchObject({ encoding: 'base64', mime: 'application/octet-stream', length: MiB });
    expect(Buffer.from(tail.content, 'base64').equals(early.subarray(MiB))).toBe(true);
  });

  it('answers base64 for a PNG and a NUL-bearing file, utf8 for text, and the mime by extension', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    write(inRoot('dot.png'), png);
    write(inRoot('data.bin'), Buffer.from([1, 2, 0, 3, 0, 4, 5, 6, 7, 8, 9, 10]));
    write(inRoot('label.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text>Ünïcødé</text></svg>');
    const files = service();
    expect(await files.read({ appSessionId: A, path: inRoot('dot.png') })).toEqual({
      encoding: 'base64', content: png.toString('base64'), bytes: png.length, offset: 0, length: png.length, truncated: false, mime: 'image/png',
    });
    expect(await files.read({ appSessionId: A, path: inRoot('data.bin') })).toMatchObject({ encoding: 'base64', bytes: 12, mime: 'application/octet-stream' });
    expect(await files.read({ appSessionId: A, path: inRoot('label.svg') })).toMatchObject({ encoding: 'utf8', mime: 'image/svg+xml', content: expect.stringContaining('Ünïcødé') });
    expect(await files.read({ appSessionId: A, path: inRoot('src', 'a.ts') })).toMatchObject({ encoding: 'utf8', mime: 'text/x-typescript' });
    expect(await files.read({ appSessionId: A, path: inRoot('README.md') })).toMatchObject({ encoding: 'utf8', mime: 'text/markdown' });
  });

  it('lists directories first, then files by locale, with symlinks, their targets and FIFOs as other', async () => {
    write(inRoot('mix', 'b.txt'), 'b');
    write(inRoot('mix', 'A.txt'), 'a');
    mkdirSync(inRoot('mix', 'zdir'));
    mkdirSync(inRoot('mix', 'adir'));
    symlinkSync(join(outside, 'secret.txt'), inRoot('mix', 'link'));
    execFileSync('mkfifo', [inRoot('mix', 'pipe')]);
    const listing = await service().list({ appSessionId: A, path: inRoot('mix') });
    expect(listing).toMatchObject({ root, path: inRoot('mix'), truncated: false });
    expect(listing.entries.map((e) => [e.name, e.kind])).toEqual([
      ['adir', 'dir'], ['zdir', 'dir'], ['A.txt', 'file'], ['b.txt', 'file'], ['link', 'symlink'], ['pipe', 'other'],
    ]);
    expect(listing.entries.find((e) => e.name === 'link')).toMatchObject({ path: inRoot('mix', 'link'), target: join(outside, 'secret.txt') });
    expect(listing.entries.find((e) => e.name === 'b.txt')).toMatchObject({ size: 1, target: null });
  });

  it('drops an entry deleted after readdir without failing the listing or naming it', async () => {
    write(inRoot('gone-soon', 'keep.txt'), 'k');
    write(inRoot('gone-soon', 'drop.txt'), 'd');
    points['after-readdir'] = () => unlinkSync(inRoot('gone-soon', 'drop.txt'));
    const listing = await service().list({ appSessionId: A, path: inRoot('gone-soon') });
    expect(listing.entries.map((e) => e.name)).toEqual(['keep.txt']);
  });

  it('lists the roots in record order, deduplicated by realpath, and names the most specific root of a listing', async () => {
    mkdirSync(at('extra'));
    symlinkSync(root, at('root-link'));
    records.set(A, record(at('root-link'), [at('extra'), inRoot('src')], root));
    const files = service();
    const roots = await files.list({ appSessionId: A });
    expect(roots).toMatchObject({ root: null, path: '', truncated: false });
    expect(roots.entries.map((e) => [e.name, e.path, e.kind])).toEqual([
      ['root', root, 'dir'], ['extra', at('extra'), 'dir'], ['src', inRoot('src'), 'dir'],
    ]);
    expect(await files.list({ appSessionId: A, path: inRoot('src') })).toMatchObject({ root: inRoot('src') });
    expect(await files.list({ appSessionId: A, path: inRoot('a') })).toMatchObject({ root });
  });

  it('cuts a listing at the cap with truncated', async () => {
    mkdirSync(inRoot('many'));
    for (let i = 0; i <= FILES_LIST_MAX_ENTRIES; i++) writeFileSync(inRoot('many', `f${String(i).padStart(5, '0')}.txt`), '');
    const listing = await service().list({ appSessionId: A, path: inRoot('many') });
    expect(listing.truncated).toBe(true);
    expect(listing.entries).toHaveLength(FILES_LIST_MAX_ENTRIES);
    expect(listing.entries.at(-1)!.name).toBe('f04999.txt');
  });
});

describe('files openExternal', () => {
  it('refuses a path outside the roots and opens nothing', async () => {
    const openPath = vi.fn(async () => '');
    const files = service({ openPath, env: {} });
    await expect(files.openExternal(A, join(outside, 'secret.txt'))).rejects.toThrow(OUT);
    symlinkSync(join(outside, 'secret.txt'), inRoot('leak'));
    await expect(files.openExternal(A, inRoot('leak'))).rejects.toThrow(OUT);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('opens the checked realpath and relays shell.openPath’s answer', async () => {
    const openPath = vi.fn<(path: string) => Promise<string>>(async () => '');
    const files = service({ openPath, env: {} });
    expect(await files.openExternal(A, inRoot('README.md'))).toEqual({ opened: true, message: null });
    expect(openPath).toHaveBeenCalledWith(inRoot('README.md'));
    openPath.mockResolvedValueOnce('No application knows how to open this file');
    expect(await files.openExternal(A, inRoot('README.md'))).toEqual({ opened: false, message: 'No application knows how to open this file' });
  });

  it('under MAWS_E2E=1 with MAWS_E2E_OPEN_LOG appends the realpath instead of opening', async () => {
    const openPath = vi.fn(async () => '');
    const log = at('open.log');
    symlinkSync(root, at('root-link'));
    records.set(A, record(at('root-link')));
    const files = service({ openPath, env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log } });
    expect(await files.openExternal(A, at('root-link', 'README.md'))).toEqual({ opened: true, message: null });
    expect(await files.openExternal(A, at('root-link', 'src', 'a.ts'))).toEqual({ opened: true, message: null });
    expect(readFileSync(log, 'utf8')).toBe(`${inRoot('README.md')}\n${inRoot('src', 'a.ts')}\n`);
    expect(openPath).not.toHaveBeenCalled();
    // without MAWS_E2E the log variable is ignored: the production path has no seam
    const production = service({ openPath, env: { MAWS_E2E_OPEN_LOG: log } });
    await production.openExternal(A, inRoot('README.md'));
    expect(openPath).toHaveBeenCalledTimes(1);
  });
});
