// The open-first boundary of `files.*` (C8c execution document, Interfaces "The boundary tests"). Every substitution
// runs at a named boundary point through the service's test-only hook, so each race is reproduced deterministically;
// the two negative controls run the same substitutions against the check-then-use shape K1 corrects and read outside
// bytes and outside metadata, so the service's refusal in the same scenario is evidence, not an accident of the point.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { appendFileSync, chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchoredMessage } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import { FILES_LIST_MAX_ENTRIES, FILES_MOVED, FILES_PROTECTED, FILES_READ_MAX_LENGTH, FILES_WRITE_MAX_BYTES, OUTSIDE_LIST_PAGE, type FilesChanged, type FilesWriteOutput } from '@shared/ipc/schema/files';
import { endableClientRef } from '@shared/ipc/client';
import type { LibraryEntry } from '@shared/ipc/schema/library';
import { summary } from '../../../test/support/index-fixture';
import { fakeBus } from '../../../test/support/fake-bus';
import { loadUxwaveTranscript } from '../../../test/support/fixtures';
import { queuedNotification, queuedPeerMessage, queuedPrompt } from '../../../test/support/queued-rows';
import { askSteerText } from '@shared/maws/ask';
import { linkedReadBlock } from '@shared/maws/linked-read';
import { fileLinkSteps, normalizeLexically, PAUSE } from '@shared/files/named'; // UX wave U6b-4b; U6b-4c: fileLinkSteps
import { MARKDOWN_RENDER_CAP } from '@shared/files/markdown'; // UX wave U6b-4c
import { Index } from '../index/index';
import { fileAdmission } from './admission';
import { openFileGrants, type FileGrants } from './grants';
import { openFileLinks, type FileLinks } from './links'; // UX wave U6b-4c
import { ownFolders } from './own';
import { ADMISSION_CASES, admissionRepos, type AdmissionPaths } from '../../../test/support/admission-cases';
import { rootsOf, under, type AllowlistRecord } from './allowlist';
import { NO_LINK } from '../fs/no-link';
import { StoreFixture } from '../../../test/support/store-fixture';
import { runGit } from '../../../test/support/git-fixture';
import { execGit, type ExecFileFn } from '../git/runner';
import { createIgnoreCheck, type IgnoreCheck } from './ignored';
import { createNamedPaths, NAMED_PATH_MAX, NAMED_WAIT_MS, type Naming, type NamedPathsOptions } from './named';
import { createFilesService, FOLLOW_IN_FLIGHT_MAX, O_NOFOLLOW_ANY, OPEN_FLAGS, type BoundaryPoint, type FilesServiceOptions } from './service';
import { registerFilesHandlers } from './register';

const OUT = "path outside the session's directories";
// UX wave U6f: who asks (`FilesCaller`): a request from another machine that no claimed act carries, and, absent, this
// machine's own client
const UNCLAIMED = { remote: true, claim: null } as const;
const fromAnotherMachine = (remote: boolean) => (remote ? UNCLAIMED : undefined);

// UX wave U6f: what the disk is asked, by the walk and the listing (their `node:fs/promises` imports) and by the service
// (`fs.promises`), recorded only while a case asks (`recordTouches`), for the cases that hold a private folder untouched
const touches = vi.hoisted(() => ({ on: false, seen: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const seen =
    <A extends unknown[], R>(name: string, call: (...args: A) => R) =>
    (...args: A): R => {
      if (touches.on) touches.seen.push(`${name} ${String(args[0])}`);
      return call(...args);
    };
  return { ...actual, lstat: seen('lstat', actual.lstat), stat: seen('stat', actual.stat), readdir: seen('readdir', actual.readdir), readlink: seen('readlink', actual.readlink), realpath: seen('realpath', actual.realpath), open: seen('open', actual.open) };
});
// UX wave U6b-4c (X3.5): the turns of the event loop given back through `node:timers/promises`, counted while a case asks
const turnsGiven = vi.hoisted(() => ({ count: 0 }));
vi.mock('node:timers/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:timers/promises')>();
  const counted = ((...args: Parameters<typeof actual.setImmediate>) => ((turnsGiven.count += 1), actual.setImmediate(...args))) as typeof actual.setImmediate;
  return { ...actual, setImmediate: counted };
});
function recordTouches(): string[] {
  touches.seen = [];
  touches.on = true;
  for (const name of ['lstat', 'stat', 'readdir', 'readlink', 'realpath', 'open'] as const) {
    const original = (fs.promises[name] as (...args: unknown[]) => unknown).bind(fs.promises);
    vi.spyOn(fs.promises, name).mockImplementation(((...args: unknown[]) => {
      if (touches.on) touches.seen.push(`${name} ${String(args[0])}`);
      return original(...args);
    }) as never);
  }
  return touches.seen;
}
// What of the recorded asks lies inside `folder`: a path under it, or a read of its own entries
const inside = (seen: readonly string[], folder: string) =>
  seen.filter((entry) => {
    const call = entry.slice(0, entry.indexOf(' '));
    const path = entry.slice(entry.indexOf(' ') + 1);
    return path.startsWith(`${folder}${sep}`) || ((call === 'readdir' || call === 'open') && path === folder);
  });
const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;
const H = 'H' as AppSessionId; // U6e: a session whose folder holds MAWS's own folders
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
// The client port's open and reveal over Electron-shaped fakes: openPath answers '' or the error text.
function portOf({ openPath, showItemInFolder }: { openPath?: (path: string) => Promise<string>; showItemInFolder?: (path: string) => void }): NonNullable<FilesServiceOptions['port']> {
  return {
    openExternal: async (_client, target) => {
      const message = await openPath!((target as { path: string }).path);
      return message === '' ? { opened: true } : { opened: false, reason: message };
    },
    reveal: async (_client, path) => (showItemInFolder!(path), { revealed: true }),
  };
}
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error(`not answered within ${ms} ms`)), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// UX wave U6b-2: a raw read's identity as Interfaces §B writes it, from the path's own stat
function identityAt(path: string): string {
  const stat = statSync(path, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
// Returns once the file system's clock has moved past `path`'s change time, so a write made now gives the file another
// one: Linux stamps a change from a coarse clock, and two changes inside one of its ticks carry the same time. Bounded,
// since the loop is synchronous and the runner cannot interrupt it: a clock that does not move fails the case, with why.
const CLOCK_TRIES = 100_000;
const CLOCK_PATIENCE_MS = 5000;
function pastChangeTime(path: string) {
  const before = statSync(path, { bigint: true }).ctimeNs;
  const probe = `${path}.tick`;
  const deadline = Date.now() + CLOCK_PATIENCE_MS;
  try {
    for (let tries = 0; tries < CLOCK_TRIES && Date.now() < deadline; tries++) {
      writeFileSync(probe, String(tries % 2)); // a write of one byte: each one stamps the probe's change time again
      if (statSync(probe, { bigint: true }).ctimeNs > before) return;
    }
  } finally {
    rmSync(probe, { force: true });
  }
  throw new Error(`the premise is not met: the file system's change time did not move past ${path}'s within ${CLOCK_TRIES} writes or ${CLOCK_PATIENCE_MS} ms`);
}
// The bytes a base64 answer carries
const bytesOf = (answer: { encoding: string; content: string }) => Buffer.from(answer.content, answer.encoding as BufferEncoding);

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
  touches.on = false;
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
      await expect(files.watch(A, inRoot('out'), 'p1')).rejects.toThrow(OUT);
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

    it('refuses an ancestor replaced by a symlink pointing outside (step 3, ELOOP)', async () => {
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
    // Before the M1 review this reached step 5 and was refused by (dev, ino); with real0 opened under O_NOFOLLOW_ANY the
    // open itself refuses (ELOOP), so no descriptor to outside bytes ever exists and `after-open` is never reached.
    // macOS: the kernel honours O_NOFOLLOW_ANY (0x20000000, macOS 11 and later; another kernel ignores the bit).
    it.skipIf(process.platform !== 'darwin')('refuses an ancestor swapped outside before the open, at the open, before anything could restore it', async () => {
      const open = vi.spyOn(fs.promises, 'open');
      points['before-open'] = () => swapToLink(inRoot('src'), join(outside, 'src'));
      points['after-open'] = () => restore(inRoot('src'));
      await expect(service().read({ appSessionId: A, path: inRoot('src', 'a.ts') })).rejects.toThrow(OUT);
      expect(points['after-open']).toBeDefined(); // no descriptor was opened
      await expect(open.mock.results[0].value).rejects.toMatchObject({ code: 'ELOOP' });
      restore(inRoot('src'));
    });

    // UX wave U6b-2 (probe 7, third part): a raw read takes the same open, so the same swap is refused at it
    it.skipIf(process.platform !== 'darwin')('a raw read refuses an ancestor swapped outside before the open', async () => {
      const open = vi.spyOn(fs.promises, 'open');
      points['before-open'] = () => swapToLink(inRoot('src'), join(outside, 'src'));
      points['after-open'] = () => restore(inRoot('src'));
      await expect(service().read({ appSessionId: A, path: inRoot('src', 'a.ts'), raw: true })).rejects.toThrow(OUT);
      expect(points['after-open']).toBeDefined(); // no descriptor was opened
      await expect(open.mock.results[0].value).rejects.toMatchObject({ code: 'ELOOP' });
      restore(inRoot('src'));
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

    // The M1 review's flip, played step by step against the shape before O_NOFOLLOW_ANY: open the path as given with
    // O_NOFOLLOW (the final component only), then realpath and stat as two path steps. An ancestor that is an outside
    // link at the open, a directory at the realpath and a link again at the stat passes the (dev, ino) check with the
    // outside descriptor. The service opens real0 with O_NOFOLLOW_ANY, so the same first flip ends at the open (the
    // `swap and restore` case above).
    // macOS: its last step is the service's open refusing the flip, and the kernel honours O_NOFOLLOW_ANY (0x20000000,
    // macOS 11 and later; another kernel ignores the bit).
    it.skipIf(process.platform !== 'darwin')('serves the outside file through the pre-review open-then-confirm shape when an ancestor flips link, directory, link', async () => {
      const path = inRoot('src', 'a.ts');
      const roots = await rootsOf(records.get(A)!);
      swapToLink(inRoot('src'), join(outside, 'src'));
      const handle = await fs.promises.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        const opened = await handle.stat({ bigint: true });
        restore(inRoot('src'));
        const real = await realpath(path);
        expect(roots.some((r) => under(r, real))).toBe(true); // in-root at the realpath
        swapToLink(inRoot('src'), join(outside, 'src'));
        const now = await fs.promises.stat(real, { bigint: true });
        expect(now.dev === opened.dev && now.ino === opened.ino).toBe(true); // the confirmation passes
        expect((await handle.readFile('utf8'))).toBe('outside secret a');
      } finally {
        await handle.close();
      }
      await expect(fs.promises.open(path, OPEN_FLAGS)).rejects.toMatchObject({ code: 'ELOOP' }); // the service's open, same state
    });
  });

  // macOS: O_NOFOLLOW_ANY and not O_NOFOLLOW; Linux, which ignores that bit: O_NOFOLLOW (the open walked and confirmed)
  it('opens real0 with numeric flags including O_NONBLOCK and the platform’s no-link bit (O_NOFOLLOW_ANY on macOS, not O_NOFOLLOW), and never calls readFile', async () => {
    symlinkSync(root, at('root-link'));
    records.set(A, record(at('root-link')));
    const open = vi.spyOn(fs.promises, 'open');
    const readFileSpy = vi.spyOn(fs.promises, 'readFile');
    const files = service();
    await files.read({ appSessionId: A, path: at('root-link', 'src', 'a.ts') });
    await files.list({ appSessionId: A, path: at('root-link', 'src') });
    const { O_NONBLOCK, O_NOFOLLOW, O_DIRECTORY } = fs.constants;
    expect(open.mock.calls.map(([path]) => path)).toEqual([inRoot('src', 'a.ts'), inRoot('src')]); // the realpath, not the path as given
    for (const [, flags] of open.mock.calls) {
      expect(typeof flags).toBe('number');
      expect((flags as number) & O_NONBLOCK).toBe(O_NONBLOCK);
      expect((flags as number) & (O_NOFOLLOW | O_NOFOLLOW_ANY)).toBe(NO_LINK); // one of them: macOS answers EINVAL for the two (below)
      if (process.platform === 'darwin') expect(NO_LINK).toBe(O_NOFOLLOW_ANY);
    }
    expect((open.mock.calls[0][1] as number) & O_DIRECTORY).toBe(0);
    expect((open.mock.calls[1][1] as number) & O_DIRECTORY).toBe(O_DIRECTORY);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  // The guard on this platform: if the kernel ignored O_NOFOLLOW_ANY (a port, or a macOS that dropped it), the read
  // race the flag closes would silently reopen. Fail loudly instead.
  // macOS: the kernel honours O_NOFOLLOW_ANY (0x20000000, macOS 11 and later; another kernel ignores the bit); MAWS
  // runs on macOS alone, and this case keeps failing loudly there.
  it.skipIf(process.platform !== 'darwin')('has a kernel that honours O_NOFOLLOW_ANY: the service flags refuse a symlink anywhere on the path', async () => {
    symlinkSync(join(root, 'src'), inRoot('alias'));
    await expect(fs.promises.open(inRoot('alias', 'a.ts'), OPEN_FLAGS)).rejects.toMatchObject({ code: 'ELOOP' }); // an ancestor
    // a symlink high on the path, several real directories above the target (as /var → /private/var would be)
    symlinkSync(base, at('high'));
    await expect(fs.promises.open(at('high', 'root', 'src', 'a.ts'), OPEN_FLAGS)).rejects.toMatchObject({ code: 'ELOOP' });
    await expect(fs.promises.open(at('high', 'root', 'src'), OPEN_FLAGS | fs.constants.O_DIRECTORY)).rejects.toMatchObject({ code: 'ELOOP' });
    symlinkSync(inRoot('README.md'), inRoot('readme-link'));
    await expect(fs.promises.open(inRoot('readme-link'), OPEN_FLAGS)).rejects.toMatchObject({ code: 'ELOOP' }); // the last component
    const handle = await fs.promises.open(inRoot('src', 'a.ts'), OPEN_FLAGS); // a realpath opens
    await handle.close();
    // why OPEN_FLAGS carries no O_NOFOLLOW: this kernel refuses the combination outright
    await expect(fs.promises.open(inRoot('src', 'a.ts'), OPEN_FLAGS | fs.constants.O_NOFOLLOW)).rejects.toMatchObject({ code: 'EINVAL' });
  });

  it('reads through an in-root symlinked directory, and refuses a final-component symlink even to an in-root file', async () => {
    symlinkSync(inRoot('src'), inRoot('alias'));
    symlinkSync(inRoot('README.md'), inRoot('readme-link'));
    const files = service();
    expect(await files.read({ appSessionId: A, path: inRoot('alias', 'a.ts') })).toMatchObject({ content: 'export const a = 1;\n' });
    await expect(files.read({ appSessionId: A, path: inRoot('readme-link') })).rejects.toThrow(OUT);
    await expect(files.list({ appSessionId: A, path: inRoot('alias') })).rejects.toThrow(OUT); // a directory link too: shown, not opened
    await expect(files.watch(A, inRoot('alias'), 'p1')).rejects.toThrow(OUT);
    // Spelled with a trailing slash, lstat follows the link (the path names the target directory): refused all the same.
    await expect(files.list({ appSessionId: A, path: `${inRoot('alias')}/` })).rejects.toThrow(OUT);
    await expect(files.watch(A, `${inRoot('alias')}/`, 'p1')).rejects.toThrow(OUT);
    expect(files.watching()).toEqual([]);
  });

  // A readdir or fs.watch that fails after step 5 (the directory removed or replaced between the confirmation and the
  // call, which no boundary point separates, so the failure is injected where Node would raise it) answers the leak
  // rule or the refusal, never Node's message, which names the path and one bit of existence.
  describe('a path-based step failing after the confirmation', () => {
    const enoent = (syscall: string, path: string) => Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${path}'`), { code: 'ENOENT' });

    it('answers not found when readdir finds the in-root directory removed', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementationOnce((async (path: string) => {
        rmSync(path, { recursive: true });
        throw enoent('scandir', path);
      }) as unknown as typeof fs.promises.readdir);
      await expect(service().list({ appSessionId: A, path: inRoot('a', 'sub') })).rejects.toThrow(new Error(`not found: ${inRoot('a', 'sub')}`));
    });

    it('answers the refusal when readdir fails on a directory that is still there', async () => {
      vi.spyOn(fs.promises, 'readdir').mockRejectedValueOnce(Object.assign(new Error(`EACCES: permission denied, scandir '${inRoot('a', 'sub')}'`), { code: 'EACCES' }));
      await expect(service().list({ appSessionId: A, path: inRoot('a', 'sub') })).rejects.toThrow(new Error(OUT));
    });

    it('answers the refusal when readdir finds the directory swapped to an outside link', async () => {
      vi.spyOn(fs.promises, 'readdir').mockImplementationOnce((async (path: string) => {
        swapToLink(inRoot('a'), join(outside, 'a'));
        throw enoent('scandir', path);
      }) as unknown as typeof fs.promises.readdir);
      await expect(service().list({ appSessionId: A, path: inRoot('a', 'sub') })).rejects.toThrow(new Error(OUT));
    });

    it('answers not found when fs.watch finds the in-root directory removed, and leaves no watch behind', async () => {
      const files = service();
      vi.spyOn(fs, 'watch').mockImplementationOnce(((path: string) => {
        rmSync(path, { recursive: true });
        throw enoent('watch', path);
      }) as unknown as typeof fs.watch);
      await expect(files.watch(A, inRoot('a', 'sub'), 'p1')).rejects.toThrow(new Error(`not found: ${inRoot('a', 'sub')}`));
      expect(files.watching()).toEqual([]);
    });
  });

  it('answers not a regular file for an in-root directory, and the refusal for a watch of a regular file', async () => {
    const files = service();
    await expect(files.read({ appSessionId: A, path: inRoot('src') })).rejects.toThrow(`not a regular file: ${inRoot('src')}`);
    await expect(files.watch(A, inRoot('src', 'a.ts'), 'p1')).rejects.toThrow(OUT);
    await expect(files.list({ appSessionId: A, path: inRoot('src', 'a.ts') })).rejects.toThrow(OUT);
  });
});

describe('files service late confirmation', { timeout: 20_000 }, () => {
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
    await expect(service().watch(A, inRoot('a', 'sub'), 'p1')).rejects.toThrow(OUT);
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
    await files.watch(A, dir, 'p1');
    await files.watch(B, dir, 'p1');
    expect(closes).toHaveLength(1); // one watcher for both holders
    // FSEvents replays the fixture's own writes just after an install; let that batch pass before arming the swap
    await new Promise((resolve) => setTimeout(resolve, 700));
    emitted.length = 0;
    points['before-batch'] = swapAncestor;
    writeFileSync(join(dir, 'new.txt'), 'inside write');
    await vi.waitFor(() => expect(emitted).toHaveLength(2), { timeout: 6000 });
    await new Promise((resolve) => setTimeout(resolve, 400)); // nothing else trails the invalidation
    expect(emitted.filter((e) => e.path !== dir)).toEqual([]); // no filename forwarded
    expect(emitted.sort((x, y) => x.appSessionId.localeCompare(y.appSessionId))).toEqual([
      { appSessionId: A, path: dir, kind: 'invalidated' },
      { appSessionId: B, path: dir, kind: 'invalidated' },
    ]);
    expect(closes[0]).toHaveBeenCalled();
    expect(files.watching()).toEqual([]);

    await expect(files.watch(A, dir, 'p1')).rejects.toThrow(OUT); // refused at step 1 while the swap stands
    restore(inRoot('a'));
    emitted.length = 0;
    await files.watch(A, dir, 'p1');
    await new Promise((resolve) => setTimeout(resolve, 700)); // past the FSEvents stream restart the new watcher causes
    expect(closes).toHaveLength(2); // a new watcher
    writeFileSync(join(dir, 'after.txt'), 'restored');
    await vi.waitFor(() => expect(emitted).toContainEqual({ appSessionId: A, path: join(dir, 'after.txt'), kind: 'created' }), { timeout: 6000 });
  });
});

describe('files service listing and reading', () => {
  it('reads at offset and length with truncated and length', async () => {
    write(inRoot('ten.txt'), '0123456789');
    const files = service();
    expect(await files.read({ appSessionId: A, path: inRoot('ten.txt'), offset: 2, length: 3 })).toEqual({
      encoding: 'utf8', content: '234', bytes: 10, offset: 2, length: 3, truncated: true, mime: 'text/plain', hash: null, utf8: null,
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
      encoding: 'base64', content: png.toString('base64'), bytes: png.length, offset: 0, length: png.length, truncated: false, mime: 'image/png', hash: null, utf8: null,
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

  it('reads the entries of a large directory a bounded number at a time', async () => {
    mkdirSync(inRoot('wide'));
    for (let i = 0; i < 300; i++) writeFileSync(inRoot('wide', `f${String(i).padStart(3, '0')}.txt`), '');
    const lstat = fs.promises.lstat.bind(fs.promises);
    let open = 0;
    let most = 0;
    vi.spyOn(fs.promises, 'lstat').mockImplementation(async (...args: Parameters<typeof lstat>) => {
      most = Math.max(most, ++open);
      try {
        return await lstat(...args);
      } finally {
        open--;
      }
    });
    const listing = await service().list({ appSessionId: A, path: inRoot('wide') });
    expect(listing.entries).toHaveLength(300);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(64);
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

// UX wave U6b-3a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, decisions 12 and 13, S1): a listing
// carries `ignored: true` on the entries the ignore check names, asked after the entries' reads and the cut, before the
// last confirmation; the check here is a function the test gives.
describe('files service listing: what git ignores', () => {
  const mixed = () => {
    write(inRoot('mix', 'b.txt'), 'b');
    write(inRoot('mix', 'A.txt'), 'a');
    mkdirSync(inRoot('mix', 'zdir'));
    mkdirSync(inRoot('mix', 'adir'));
  };
  const markedOf = (listing: { entries: { name: string }[] }) => listing.entries.filter((entry) => 'ignored' in entry).map((entry) => [entry.name, (entry as { ignored?: unknown }).ignored]);

  it('marks exactly the names the check answers, drops a name the listing does not carry, and asks with the confirmed realpath and the names answered', async () => {
    mixed();
    symlinkSync(root, at('root-link'));
    records.set(A, record(at('root-link')));
    const ignored = vi.fn(async () => new Set(['zdir', 'b.txt', 'not-listed']));
    const listing = await service({ ignored }).list({ appSessionId: A, path: at('root-link', 'mix') });
    expect(listing.entries.map((entry) => entry.name)).toEqual(['adir', 'zdir', 'A.txt', 'b.txt']);
    expect(markedOf(listing)).toEqual([['zdir', true], ['b.txt', true]]);
    expect(ignored).toHaveBeenCalledTimes(1);
    const opened = statSync(inRoot('mix'), { bigint: true });
    expect(ignored).toHaveBeenCalledWith(inRoot('mix'), ['adir', 'zdir', 'A.txt', 'b.txt'], expect.objectContaining({ dev: opened.dev, ino: opened.ino })); // the folder the service confirmed
  });

  it('marks no entry when the check answers nothing, gives no answer or is absent, and never asks for the roots, beside a listing it marks', async () => {
    mixed();
    const marking = vi.fn(async () => new Set(['b.txt']));
    expect(markedOf(await service({ ignored: marking }).list({ appSessionId: A, path: inRoot('mix') }))).toEqual([['b.txt', true]]); // the control
    const before = await service().list({ appSessionId: A, path: inRoot('mix') });
    for (const ignored of [async () => new Set<string>(), async () => null]) {
      const listing = await service({ ignored }).list({ appSessionId: A, path: inRoot('mix') });
      expect(markedOf(listing)).toEqual([]);
      expect(JSON.stringify(listing)).toBe(JSON.stringify(before)); // byte for byte what it was
    }
    expect(markedOf(before)).toEqual([]);
    marking.mockClear();
    const roots = await service({ ignored: marking }).list({ appSessionId: A });
    expect(marking).not.toHaveBeenCalled();
    expect(markedOf(roots)).toEqual([]);
  });

  it('asks about at most the capped entries, in the answer’s order', async () => {
    mkdirSync(inRoot('many'));
    for (let i = 0; i <= FILES_LIST_MAX_ENTRIES; i++) writeFileSync(inRoot('many', `f${String(i).padStart(5, '0')}.txt`), '');
    const ignored = vi.fn(async (_dir: string, names: readonly string[]) => new Set([names.at(-1)!, 'f05000.txt']));
    const listing = await service({ ignored }).list({ appSessionId: A, path: inRoot('many') });
    expect(listing.truncated).toBe(true);
    const asked = ignored.mock.calls[0]![1];
    expect(asked).toHaveLength(FILES_LIST_MAX_ENTRIES);
    expect(asked).toEqual(listing.entries.map((entry) => entry.name));
    expect(markedOf(listing)).toEqual([['f04999.txt', true]]); // the name past the cut is dropped
  });

  it('refuses the whole listing when the directory is swapped for a link at before-ignored', async () => {
    mixed();
    write(join(outside, 'mix', 'secret.txt'), 'outside');
    points['before-ignored'] = () => swapToLink(inRoot('mix'), join(outside, 'mix'));
    await expect(service({ ignored: async () => new Set(['b.txt']) }).list({ appSessionId: A, path: inRoot('mix') })).rejects.toThrow(OUT);
  });

  it('reaches before-ignored in a listing it answers, with nothing swapped (the control for the refusal)', async () => {
    mixed();
    points['before-ignored'] = () => undefined;
    const ignored = vi.fn(async () => new Set(['b.txt']));
    expect(markedOf(await service({ ignored }).list({ appSessionId: A, path: inRoot('mix') }))).toEqual([['b.txt', true]]);
    expect(points['before-ignored']).toBeUndefined(); // the point was reached
  });

  // The panel's scalpel 2, first finding, with its own input. The listed folder is reached through a link (`via`) to its
  // real ancestor (`real`); at a point after the open, `real` is moved elsewhere in the root, `via` retargeted to it, and
  // `real` replaced by a link to an outside repository. The request's spelling still names the opened folder; the
  // spelling the listing read it by, and handed to git, leads outside.
  describe('a standing substitution under a moved ancestor', () => {
    let checks: IgnoreCheck[];
    let calls: string[];
    beforeEach(async () => {
      checks = [];
      calls = [];
      await runGit(root, ['init', '-q', '-b', 'main']);
      write(inRoot('.gitignore'), '*.tmp\n'); // the root's own rule
      write(inRoot('real', 'listed', 'x.log'), 'x');
      write(inRoot('real', 'listed', 'y.tmp'), 'y');
      symlinkSync(inRoot('real'), inRoot('via'));
      write(join(outside, 'repo', '.gitignore'), '*.log\n'); // the outside repository's rule
      write(join(outside, 'repo', 'listed', 'x.log'), 'outside x');
      await runGit(join(outside, 'repo'), ['init', '-q', '-b', 'main']);
    });
    afterEach(async () => {
      await Promise.all(checks.map((check) => check.dispose()));
    });
    // The real check, under an empty home, keeping each git call's directory
    const check = () => {
      mkdirSync(at('home'), { recursive: true });
      const execFile: ExecFileFn = (file, args, options, callback) => (calls.push(args[1]!), execGit(file, args, options, callback));
      const made = createIgnoreCheck({ env: { PATH: process.env.PATH, HOME: at('home') }, execFile });
      checks.push(made);
      return made;
    };
    const substitute = () => {
      renameSync(inRoot('real'), inRoot('moved'));
      unlinkSync(inRoot('via'));
      symlinkSync(inRoot('moved'), inRoot('via'));
      symlinkSync(join(outside, 'repo'), inRoot('real'));
    };

    it('marks by the root’s rules through the link with nothing substituted (the control)', async () => {
      const listing = await service({ ignored: check().names }).list({ appSessionId: A, path: inRoot('via', 'listed') });
      expect(markedOf(listing)).toEqual([['y.tmp', true]]);
      expect(calls.length).toBeGreaterThan(0);
    });

    it('refuses the listing, and runs no git, under the substitution at before-ignored', async () => {
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
      points['before-ignored'] = substitute;
      await expect(service({ ignored: check().names }).list({ appSessionId: A, path: inRoot('via', 'listed') })).rejects.toThrow(OUT);
      expect(calls).toEqual([]);
      expect(warned.mock.calls.map(([line]) => String(line))).toEqual([expect.stringMatching(/^\[files\] the ignore check gave no answer: the folder or its repository changed before git ran/)]); // naming no folder
    });

    it('refuses the listing under the same substitution once the names were read, with no check', async () => {
      points['after-readdir'] = substitute;
      await expect(service().list({ appSessionId: A, path: inRoot('via', 'listed') })).rejects.toThrow(OUT);
    });
  });
});

describe('files openExternal', () => {
  beforeEach(() => {
    write(inRoot('doc.pdf'), '%PDF-1.4\n%%EOF\n');
    write(inRoot('media', 'clip.mp4'), 'x');
  });

  it('refuses a path outside the roots and opens nothing', async () => {
    const openPath = vi.fn(async () => '');
    const files = service({ port: portOf({ openPath }), env: {} });
    await expect(files.openExternal(A, join(outside, 'secret.txt'), null)).rejects.toThrow(OUT);
    symlinkSync(join(outside, 'secret.txt'), inRoot('leak'));
    await expect(files.openExternal(A, inRoot('leak'), null)).rejects.toThrow(OUT);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('hands the OS only a regular, non-executable document or media file, and refuses everything else', async () => {
    const log = at('open.log');
    const files = service({ env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log } });
    write(inRoot('tool.py'), 'print("hi")\n'); // not a document kind: an installed launcher could run it
    write(inRoot('archive.zip'), 'PK');
    write(inRoot('data.bin'), Buffer.from([1, 0, 2]));
    write(inRoot('run.sh'), '#!/bin/sh\necho hi\n');
    write(inRoot('script.command'), 'echo hi\n');
    write(inRoot('legacy.doc'), 'x'); // legacy Office: macros, and no quarantine attribute for Office's block to act on
    write(inRoot('movie.mp4'), 'x');
    fs.chmodSync(inRoot('movie.mp4'), 0o755); // an allowed kind with an execute bit is still refused
    mkdirSync(inRoot('Bundle.pdf')); // an allowed name on a directory is still refused
    for (const name of ['tool.py', 'archive.zip', 'data.bin', 'run.sh', 'script.command', 'movie.mp4', 'Bundle.pdf', 'legacy.doc']) {
      await expect(files.openExternal(A, inRoot(name), null)).rejects.toThrow(new Error(`not opened outside MAWS: ${inRoot(name)}`));
    }
    expect(fs.existsSync(log)).toBe(false); // nothing was handed to the OS
    const open = ['doc.pdf', 'page.html', 'clip.mp4', 'report.DOCX', 'server.log'];
    for (const name of open) {
      write(inRoot(name), 'x');
      expect(await files.openExternal(A, inRoot(name), null)).toEqual({ opened: true, message: null });
    }
    expect(readFileSync(log, 'utf8')).toBe(open.map((name) => `${inRoot(name)}\n`).join(''));
  });

  it('opens the checked realpath through the client port and relays its reason', async () => {
    const openPath = vi.fn<(path: string) => Promise<string>>(async () => '');
    const files = service({ port: portOf({ openPath }), env: {} });
    expect(await files.openExternal(A, inRoot('doc.pdf'), null)).toEqual({ opened: true, message: null });
    expect(openPath).toHaveBeenCalledWith(inRoot('doc.pdf'));
    openPath.mockResolvedValueOnce('No application knows how to open this file');
    expect(await files.openExternal(A, inRoot('doc.pdf'), null)).toEqual({ opened: false, message: 'No application knows how to open this file' });
  });

  it('under MAWS_E2E=1 with MAWS_E2E_OPEN_LOG appends the realpath instead of opening', async () => {
    const openPath = vi.fn(async () => '');
    const log = at('open.log');
    symlinkSync(root, at('root-link'));
    records.set(A, record(at('root-link')));
    const files = service({ port: portOf({ openPath }), env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log } });
    expect(await files.openExternal(A, at('root-link', 'doc.pdf'), null)).toEqual({ opened: true, message: null });
    expect(await files.openExternal(A, at('root-link', 'media', 'clip.mp4'), null)).toEqual({ opened: true, message: null });
    expect(readFileSync(log, 'utf8')).toBe(`${inRoot('doc.pdf')}\n${inRoot('media', 'clip.mp4')}\n`);
    expect(openPath).not.toHaveBeenCalled();
    // without MAWS_E2E the log variable is ignored: the production path has no seam
    const production = service({ port: portOf({ openPath }), env: { MAWS_E2E_OPEN_LOG: log } });
    await production.openExternal(A, inRoot('doc.pdf'), null);
    expect(openPath).toHaveBeenCalledTimes(1);
  });
});

// E5 M1: `files.write`, the hash-checked save through the open-first boundary, and the hash `files.read` answers when
// asked (E5 execution document, Interfaces "The write" and "`files.write` and the read hash").
describe('files service write', () => {
  const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const ORIGINAL = 'export const a = 1;\n';
  const file = () => inRoot('src', 'a.ts');
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }

  it('writes in place over a matching hash, answers the written bytes’ hash, and chains on each answer', async () => {
    const files = service();
    const first = await files.write({ appSessionId: A, path: file(), content: 'export const a = 2;\n', expectedHash: sha(ORIGINAL) });
    expect(first).toEqual({ status: 'ok', hash: sha('export const a = 2;\n') });
    expect(readFileSync(file(), 'utf8')).toBe('export const a = 2;\n');
    // shorter than what it replaces: the file is exactly the new bytes
    const second = await files.write({ appSessionId: A, path: file(), content: 'ü€\n', expectedHash: first.hash });
    expect(second).toEqual({ status: 'ok', hash: sha(Buffer.from('ü€\n', 'utf8')) });
    expect(readFileSync(file())).toEqual(Buffer.from('ü€\n', 'utf8'));
    const third = await files.write({ appSessionId: A, path: file(), content: '', expectedHash: second.hash });
    expect(third).toEqual({ status: 'ok', hash: sha('') });
    expect(statSync(file()).size).toBe(0);
    // what read hashes is what write answered
    expect((await files.read({ appSessionId: A, path: file(), hash: true })).hash).toBe(third.hash);
  });

  it('answers conflict with the current bytes’ hash and writes nothing, the mtime unchanged', async () => {
    const past = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(file(), past, past);
    const before = statSync(file()).mtimeMs;
    const answer = await service().write({ appSessionId: A, path: file(), content: 'mine\n', expectedHash: sha('a stale baseline\n') });
    expect(answer).toEqual({ status: 'conflict', hash: sha(ORIGINAL) });
    expect(readFileSync(file(), 'utf8')).toBe(ORIGINAL);
    expect(statSync(file()).mtimeMs).toBe(before);
  });

  // The second write is started by the test when the first has opened (its `after-open` point), and the first is
  // released only once the second has opened too, so both compare against the same bytes unless the service serialises.
  async function concurrently<T>(first: () => Promise<T>, second: () => Promise<T>): Promise<T[]> {
    let late: Promise<T> | undefined;
    points['after-open'] = async () => {
      const opened = deferred();
      points['after-open'] = () => opened.resolve();
      late = second();
      await opened.promise;
    };
    const early = await first();
    return [early, await late!];
  }

  it('serialises two concurrent writes with the same expected hash: one ok, one conflict, the file the ok one’s content', async () => {
    const files = service();
    const [one, two] = await concurrently(
      () => files.write({ appSessionId: A, path: file(), content: 'one\n', expectedHash: sha(ORIGINAL) }),
      () => files.write({ appSessionId: A, path: file(), content: 'two\n', expectedHash: sha(ORIGINAL) }),
    );
    expect([one.status, two.status].sort()).toEqual(['conflict', 'ok']);
    const [won, lost] = one.status === 'ok' ? [one, two] : [two, one];
    expect(lost.hash).toBe(won.hash); // the loser found the winner's bytes
    expect(sha(readFileSync(file()))).toBe(won.hash);
    expect(readFileSync(file(), 'utf8')).toBe(won === one ? 'one\n' : 'two\n');
  });

  it('serialises by the file’s identity: a hard-link alias written from another session waits its turn', async () => {
    linkSync(file(), inRoot('alias.ts'));
    records.set(B, record(root));
    const files = service();
    const answers = await concurrently(
      () => files.write({ appSessionId: A, path: file(), content: 'via a\n', expectedHash: sha(ORIGINAL) }),
      () => files.write({ appSessionId: B, path: inRoot('alias.ts'), content: 'via alias\n', expectedHash: sha(ORIGINAL) }),
    );
    expect(answers.map((answer) => answer.status).sort()).toEqual(['conflict', 'ok']);
  });

  it('keeps the mode, the inode and a hard link’s shared content across a write', async () => {
    chmodSync(file(), 0o644);
    linkSync(file(), inRoot('hard.ts'));
    const before = statSync(file());
    expect(await service().write({ appSessionId: A, path: file(), content: 'linked\n', expectedHash: sha(ORIGINAL) })).toMatchObject({ status: 'ok' });
    const after = statSync(file());
    expect(after.mode & 0o777).toBe(0o644);
    expect(after.ino).toBe(before.ino);
    expect(after.nlink).toBe(2);
    expect(readFileSync(inRoot('hard.ts'), 'utf8')).toBe('linked\n');
  });

  // E5 M4 (M1's review): a descriptor write may take fewer bytes than asked; the write loops until every byte is down.
  it('writes the whole content and answers its hash when each write call takes only part of what it is given', async () => {
    const open = fs.promises.open.bind(fs.promises);
    const asked: number[] = [];
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
      const handle = await open(...args);
      const write = handle.write.bind(handle) as (buffer: Buffer, offset: number, length: number, position: number) => Promise<{ bytesWritten: number; buffer: Buffer }>;
      Object.assign(handle, {
        write: (buffer: Buffer, offset: number, length: number, position: number) => {
          asked.push(length);
          return write(buffer, offset, Math.min(length, 7), position); // at most seven bytes per call
        },
      });
      return handle;
    });
    const content = 'export const ünïcødé = "日本語";\n'.repeat(4);
    const answer = await service().write({ appSessionId: A, path: file(), content, expectedHash: sha(ORIGINAL) });
    expect(answer).toEqual({ status: 'ok', hash: sha(Buffer.from(content, 'utf8')) });
    expect(readFileSync(file(), 'utf8')).toBe(content);
    expect(asked.length).toBe(Math.ceil(Buffer.byteLength(content, 'utf8') / 7)); // one call per seven bytes: the loop resumed each time
  });

  it('never creates a file: a missing in-root name, or one removed before the open, answers not found and nothing appears', async () => {
    const files = service();
    await expect(files.write({ appSessionId: A, path: inRoot('src', 'new.ts'), content: 'x', expectedHash: sha('') })).rejects.toThrow(new Error(`not found: ${inRoot('src', 'new.ts')}`));
    expect(fs.existsSync(inRoot('src', 'new.ts'))).toBe(false);
    points['before-open'] = () => unlinkSync(file());
    await expect(files.write({ appSessionId: A, path: file(), content: 'x', expectedHash: sha(ORIGINAL) })).rejects.toThrow(new Error(`not found: ${file()}`));
    expect(fs.existsSync(file())).toBe(false);
  });

  it('answers not writable for a file the user cannot write, and leaves it alone', async () => {
    chmodSync(file(), 0o444);
    await expect(service().write({ appSessionId: A, path: file(), content: 'x', expectedHash: sha(ORIGINAL) })).rejects.toThrow(new Error(`not writable: ${file()}`));
    expect(readFileSync(file(), 'utf8')).toBe(ORIGINAL);
  });

  it('opens real0 with O_RDWR | O_NONBLOCK | the no-link bit (O_NOFOLLOW_ANY on macOS) and neither O_CREAT nor O_TRUNC, and never writes by path', async () => {
    symlinkSync(root, at('root-link'));
    records.set(A, record(at('root-link')));
    const open = vi.spyOn(fs.promises, 'open');
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile');
    const renameSpy = vi.spyOn(fs.promises, 'rename');
    await service().write({ appSessionId: A, path: at('root-link', 'src', 'a.ts'), content: 'x', expectedHash: sha(ORIGINAL) });
    expect(open.mock.calls.map(([path]) => path)).toEqual([file()]); // the realpath, not the path as given
    const flags = open.mock.calls[0][1] as number;
    const { O_RDWR, O_WRONLY, O_NONBLOCK, O_CREAT, O_TRUNC, O_NOFOLLOW } = fs.constants;
    expect(typeof flags).toBe('number');
    expect(flags & (O_RDWR | O_WRONLY)).toBe(O_RDWR);
    expect(flags & O_NONBLOCK).toBe(O_NONBLOCK);
    expect(flags & (O_NOFOLLOW | O_NOFOLLOW_ANY)).toBe(NO_LINK);
    if (process.platform === 'darwin') expect(NO_LINK).toBe(O_NOFOLLOW_ANY);
    expect(flags & (O_CREAT | O_TRUNC)).toBe(0);
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  describe('the boundary: each refusal writes nothing', () => {
    const attempt = (path: string, content = 'pwned\n') => service().write({ appSessionId: A, path, content, expectedHash: sha(ORIGINAL) });

    it('refuses a path outside the roots, a `..`, a path not already normal, and a look-alike sibling', async () => {
      await expect(attempt(join(outside, 'secret.txt'))).rejects.toThrow(new Error(OUT));
      await expect(attempt(`${root}/../outside/secret.txt`)).rejects.toThrow(new Error(OUT));
      await expect(attempt(`${root}/src/../src/a.ts`)).rejects.toThrow(new Error(OUT));
      await expect(attempt(at('root2', 'x.txt'))).rejects.toThrow(new Error(OUT));
      expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
      expect(readFileSync(at('root2', 'x.txt'), 'utf8')).toBe('look-alike');
      expect(readFileSync(file(), 'utf8')).toBe(ORIGINAL);
    });

    it('refuses a relative path and an unknown session', async () => {
      await expect(attempt('src/a.ts')).rejects.toThrow('path must be absolute');
      await expect(service().write({ appSessionId: 'nope' as AppSessionId, path: file(), content: 'x', expectedHash: sha(ORIGINAL) })).rejects.toThrow('unknown app session: nope');
    });

    it('refuses a final-component symlink, to an outside file or even to an in-root one', async () => {
      symlinkSync(join(outside, 'secret.txt'), inRoot('leak'));
      symlinkSync(file(), inRoot('a-link.ts'));
      await expect(attempt(inRoot('leak'))).rejects.toThrow(new Error(OUT));
      await expect(attempt(inRoot('a-link.ts'))).rejects.toThrow(new Error(OUT));
      expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
      expect(readFileSync(file(), 'utf8')).toBe(ORIGINAL);
    });

    it('refuses a dangling in-root link rather than answering not found, and creates nothing at its target', async () => {
      symlinkSync(join(outside, 'absent'), inRoot('dangling'));
      await expect(attempt(inRoot('dangling'))).rejects.toThrow(new Error(OUT));
      expect(fs.existsSync(join(outside, 'absent'))).toBe(false);
    });

    it('writes through a stable in-root symlinked ancestor, as read reads through it', async () => {
      symlinkSync(inRoot('src'), inRoot('alias'));
      expect(await attempt(inRoot('alias', 'a.ts'), 'through the alias\n')).toEqual({ status: 'ok', hash: sha('through the alias\n') });
      expect(readFileSync(file(), 'utf8')).toBe('through the alias\n');
    });

    it('refuses an in-root directory, and answers not a regular file for a FIFO within a second', async () => {
      execFileSync('mkfifo', [inRoot('pipe')]);
      await expect(attempt(inRoot('src'))).rejects.toThrow(new Error(OUT)); // EISDIR at the open: no descriptor, no type named
      await expect(within(attempt(inRoot('pipe')), 1000)).rejects.toThrow(new Error(`not a regular file: ${inRoot('pipe')}`));
    });

    it('refuses a final component replaced by an outside link at before-open', async () => {
      points['before-open'] = () => {
        unlinkSync(file());
        symlinkSync(join(outside, 'secret.txt'), file());
      };
      await expect(attempt(file())).rejects.toThrow(new Error(OUT));
      expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    });

    // macOS: the kernel honours O_NOFOLLOW_ANY (0x20000000, macOS 11 and later; another kernel ignores the bit).
    it.skipIf(process.platform !== 'darwin')('refuses an ancestor swapped to an outside link at before-open (ELOOP), writing nothing outside', async () => {
      points['before-open'] = () => swapToLink(inRoot('src'), join(outside, 'src'));
      const open = vi.spyOn(fs.promises, 'open');
      await expect(attempt(file())).rejects.toThrow(new Error(OUT));
      await expect(open.mock.results[0].value).rejects.toMatchObject({ code: 'ELOOP' });
      expect(readFileSync(join(outside, 'src', 'a.ts'), 'utf8')).toBe('outside secret a');
    });

    it('refuses when the opened file is no longer the path’s at after-open (dev, ino), writing nothing', async () => {
      points['after-open'] = () => renameSync(inRoot('src', 'other.ts'), file());
      await expect(attempt(file())).rejects.toThrow(new Error(OUT));
      expect(readFileSync(file(), 'utf8')).toBe('export const other = 2;\n');
    });
  });

  describe('the caps', () => {
    it('answers content too large for content past the cap in UTF-8 bytes, before any open', async () => {
      const open = vi.spyOn(fs.promises, 'open');
      const content = 'é'.repeat(FILES_WRITE_MAX_BYTES / 2 + 1); // within the cap in characters, past it in bytes
      await expect(service().write({ appSessionId: A, path: file(), content, expectedHash: sha(ORIGINAL) })).rejects.toThrow(new Error('content too large'));
      expect(open).not.toHaveBeenCalled();
      expect(readFileSync(file(), 'utf8')).toBe(ORIGINAL);
    });

    it('writes content of exactly the cap', async () => {
      const content = 'x'.repeat(FILES_WRITE_MAX_BYTES);
      expect(await service().write({ appSessionId: A, path: file(), content, expectedHash: sha(ORIGINAL) })).toEqual({ status: 'ok', hash: sha(content) });
      expect(statSync(file()).size).toBe(FILES_WRITE_MAX_BYTES);
    });

    it('answers too large to edit for a file past the cap, and for one grown past it after the open', async () => {
      const big = Buffer.alloc(FILES_WRITE_MAX_BYTES + 1, 0x61);
      write(inRoot('big.log'), big);
      const files = service();
      await expect(files.write({ appSessionId: A, path: inRoot('big.log'), content: 'x', expectedHash: sha(big) })).rejects.toThrow(new Error(`too large to edit: ${inRoot('big.log')}`));
      expect(statSync(inRoot('big.log')).size).toBe(FILES_WRITE_MAX_BYTES + 1);
      points['after-open'] = () => appendFileSync(file(), Buffer.alloc(FILES_WRITE_MAX_BYTES, 0x62));
      await expect(files.write({ appSessionId: A, path: file(), content: 'x', expectedHash: sha(ORIGINAL) })).rejects.toThrow(new Error(`too large to edit: ${file()}`));
      expect(statSync(file()).size).toBe(ORIGINAL.length + FILES_WRITE_MAX_BYTES);
      // the failure inside the file's critical section left it: the next write of the same file is not held behind it
      writeFileSync(file(), ORIGINAL);
      expect(await within(files.write({ appSessionId: A, path: file(), content: 'after\n', expectedHash: sha(ORIGINAL) }), 5000)).toEqual({ status: 'ok', hash: sha('after\n') });
    });
  });

  describe('the read hash', () => {
    it('answers null when not asked, and the whole file’s hash when asked, text or base64', async () => {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      write(inRoot('dot.png'), png);
      const files = service();
      expect((await files.read({ appSessionId: A, path: file() })).hash).toBeNull();
      expect((await files.read({ appSessionId: A, path: file(), hash: false })).hash).toBeNull();
      expect(await files.read({ appSessionId: A, path: file(), hash: true })).toEqual({
        encoding: 'utf8', content: ORIGINAL, bytes: ORIGINAL.length, offset: 0, length: ORIGINAL.length, truncated: false, mime: 'text/x-typescript', hash: sha(ORIGINAL), utf8: true,
      });
      // a chunk answers the whole file's hash, not its own
      expect(await files.read({ appSessionId: A, path: file(), offset: 7, length: 5, hash: true })).toMatchObject({ content: 'const', hash: sha(ORIGINAL) });
      expect(await files.read({ appSessionId: A, path: inRoot('dot.png'), hash: true })).toMatchObject({ encoding: 'base64', content: png.toString('base64'), hash: sha(png) });
    });

    it('answers null for a file past the cap (a head is never edited), and a hash at the cap', async () => {
      const atCap = Buffer.alloc(FILES_READ_MAX_LENGTH, 0x61);
      write(inRoot('cap.log'), atCap);
      write(inRoot('past.log'), Buffer.concat([atCap, Buffer.from('b')]));
      const files = service();
      expect(await files.read({ appSessionId: A, path: inRoot('cap.log'), hash: true })).toMatchObject({ hash: sha(atCap), bytes: FILES_READ_MAX_LENGTH });
      expect(await files.read({ appSessionId: A, path: inRoot('past.log'), hash: true })).toMatchObject({ hash: null, utf8: null, bytes: FILES_READ_MAX_LENGTH + 1, length: MiB, truncated: true });
    });

    it('answers whether the hashed bytes are valid UTF-8, a truncated multi-byte sequence included; null when not hashed', async () => {
      // `f0 9f 92` is a 4-byte sequence cut short: a lenient decode gives U+FFFD, also 3 bytes, so a byte-length comparison
      // would pass it, and a save would write `ef bf bd` over the original bytes.
      const truncated = Buffer.from([0x61, 0xf0, 0x9f, 0x92, 0x0a]);
      const valid = Buffer.from('café € 💡\n', 'utf8');
      write(inRoot('cut.txt'), truncated);
      write(inRoot('multi.txt'), valid);
      const files = service();
      const cut = await files.read({ appSessionId: A, path: inRoot('cut.txt'), hash: true });
      expect(cut).toMatchObject({ encoding: 'utf8', bytes: truncated.length, hash: sha(truncated), utf8: false });
      expect(Buffer.byteLength(cut.content, 'utf8')).toBe(truncated.length); // the length test the flag replaces
      expect(await files.read({ appSessionId: A, path: inRoot('multi.txt'), hash: true })).toMatchObject({ content: valid.toString('utf8'), hash: sha(valid), utf8: true });
      // a chunk answers the whole file's validity, not its own
      expect(await files.read({ appSessionId: A, path: inRoot('cut.txt'), offset: 0, length: 1, hash: true })).toMatchObject({ content: 'a', utf8: false });
      expect((await files.read({ appSessionId: A, path: inRoot('multi.txt') })).utf8).toBeNull();
    });

    it('answers one hash for every chunk of an unchanged file, and each chunk’s bytes are its own hash’s file when it changes between reads', async () => {
      const first = Buffer.alloc(2 * MiB, 0x61);
      const second = Buffer.alloc(2 * MiB, 0x62);
      write(inRoot('two.log'), first);
      const files = service();
      const head = await files.read({ appSessionId: A, path: inRoot('two.log'), offset: 0, hash: true });
      const tail = await files.read({ appSessionId: A, path: inRoot('two.log'), offset: MiB, hash: true });
      expect(head.hash).toBe(sha(first));
      expect(tail.hash).toBe(head.hash);
      writeFileSync(inRoot('two.log'), second); // replaced between two reads of one load
      const replaced = await files.read({ appSessionId: A, path: inRoot('two.log'), offset: MiB, hash: true });
      expect(replaced.hash).toBe(sha(second));
      expect(replaced.hash).not.toBe(head.hash);
      expect(Buffer.from(head.content).equals(first.subarray(0, head.length))).toBe(true);
      expect(Buffer.from(replaced.content).equals(second.subarray(MiB, MiB + replaced.length))).toBe(true);
    });

    it('answers the bytes it hashed when the file grows after the fstat: one read of the descriptor, not two', async () => {
      points['after-open'] = () => appendFileSync(file(), 'export const b = 2;\n');
      const grown = `${ORIGINAL}export const b = 2;\n`;
      expect(await service().read({ appSessionId: A, path: file(), hash: true })).toMatchObject({
        content: grown, bytes: grown.length, length: grown.length, truncated: false, hash: sha(grown),
      });
    });

    it('settles a hashed chunk by the same rules as an unhashed one (character boundaries, CRLF)', async () => {
      const files = service();
      for (const [name, text] of [['euro.txt', 'ab€cd'], ['crlf.txt', 'ab\r\ncd\r\n'], ['cr-end.txt', 'ab\r']] as const) {
        write(inRoot(name), text);
        for (const [offset, length] of [[0, 3], [2, 3], [2, 1], [0, 100], [50, 3]]) {
          const plain = await files.read({ appSessionId: A, path: inRoot(name), offset, length });
          const hashed = await files.read({ appSessionId: A, path: inRoot(name), offset, length, hash: true });
          expect(hashed, `${name} ${offset} ${length}`).toEqual({ ...plain, hash: sha(Buffer.from(text, 'utf8')), utf8: true });
        }
      }
    });
  });
});
// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M2; Interfaces §B): `raw`, the bytes of
// exactly the range asked as base64, never decoded and never re-cut, with the identity of the version they are of; for a
// caller on this machine alone. The first three cases are the cut's named tests.
describe('files service raw read', () => {
  it('a raw read answers bytes that are not valid UTF-8 byte for byte, where the plain read answers replacement characters', async () => {
    const invalid = Buffer.from([0x61, 0xff, 0xfe, 0x62, 0xc3, 0x0a]); // a, two bytes no UTF-8 holds, b, a lead byte with no continuation
    write(inRoot('invalid.txt'), invalid);
    const files = service();
    const plain = await files.read({ appSessionId: A, path: inRoot('invalid.txt') });
    expect(plain).toMatchObject({ encoding: 'utf8', mime: 'text/plain' });
    expect(plain.content).toContain('\uFFFD');
    expect(bytesOf(plain).equals(invalid)).toBe(false);
    const raw = await files.read({ appSessionId: A, path: inRoot('invalid.txt'), raw: true });
    expect(raw).toMatchObject({ encoding: 'base64', mime: 'text/plain', bytes: invalid.length, offset: 0, length: invalid.length, truncated: false });
    expect(bytesOf(raw).equals(invalid)).toBe(true);
  });

  it('a raw range that begins and ends inside a multi-byte character is answered as asked, where the plain read moves its end', async () => {
    const text = Buffer.from('ab€€cd', 'utf8'); // a b E2 82 AC E2 82 AC c d
    write(inRoot('euros.txt'), text);
    const files = service();
    // from the second byte of the first € to the first byte of the second
    expect(await files.read({ appSessionId: A, path: inRoot('euros.txt'), offset: 3, length: 3 })).toMatchObject({ offset: 3, length: 2 });
    const raw = await files.read({ appSessionId: A, path: inRoot('euros.txt'), offset: 3, length: 3, raw: true });
    expect(raw).toMatchObject({ encoding: 'base64', offset: 3, length: 3, truncated: true, bytes: text.length });
    expect(bytesOf(raw).equals(text.subarray(3, 6))).toBe(true);
  });

  it('a replacement of the same size between two ranges answers another identity: by a rename over the file, and by a write into it', async () => {
    write(inRoot('page.bin'), Buffer.alloc(64, 0x61));
    const files = service();
    const read = (offset: number) => files.read({ appSessionId: A, path: inRoot('page.bin'), offset, length: 32, raw: true });
    const first = await read(0);
    expect(first.identity).toEqual(expect.any(String));
    write(at('replacement.bin'), Buffer.alloc(64, 0x62));
    renameSync(at('replacement.bin'), inRoot('page.bin')); // another file of the same size, put in its place
    const renamed = await read(32);
    expect(renamed.identity).toEqual(expect.any(String));
    expect(renamed.identity).not.toBe(first.identity);
    expect(bytesOf(renamed).equals(Buffer.alloc(32, 0x62))).toBe(true);
    pastChangeTime(inRoot('page.bin'));
    writeFileSync(inRoot('page.bin'), Buffer.alloc(64, 0x63)); // the same inode, the same size, other bytes
    const written = await read(32);
    expect(written.identity).toEqual(expect.any(String));
    expect(written.identity).not.toBe(renamed.identity);
    expect(bytesOf(written).equals(Buffer.alloc(32, 0x63))).toBe(true);
  });

  it('a raw read of a text file answers base64 and the range as asked, with no settling at a CRLF', async () => {
    write(inRoot('crlf.txt'), 'ab\r\ncd\r\n');
    const files = service();
    expect(await files.read({ appSessionId: A, path: inRoot('crlf.txt'), length: 3 })).toMatchObject({ encoding: 'utf8', content: 'ab', length: 2 });
    const raw = await files.read({ appSessionId: A, path: inRoot('crlf.txt'), length: 3, raw: true });
    expect(raw).toMatchObject({ encoding: 'base64', content: Buffer.from('ab\r').toString('base64'), offset: 0, length: 3, truncated: true, bytes: 8, mime: 'text/plain' });
    // a one-byte range of the lone `\r` is that byte, where the plain read reads forward for the `\n`
    expect(bytesOf(await files.read({ appSessionId: A, path: inRoot('crlf.txt'), offset: 2, length: 1, raw: true }))).toEqual(Buffer.from('\r'));
  });

  it('a raw read answers the identity, and two reads of an unchanged file answer the same one', async () => {
    write(inRoot('ten.txt'), Buffer.from('0123456789'));
    const files = service();
    const first = await files.read({ appSessionId: A, path: inRoot('ten.txt'), length: 4, raw: true });
    expect(first.identity).toBe(identityAt(inRoot('ten.txt')));
    const second = await files.read({ appSessionId: A, path: inRoot('ten.txt'), offset: 4, length: 4, raw: true });
    expect(second.identity).toBe(first.identity);
    expect(bytesOf(second)).toEqual(Buffer.from('4567'));
  });

  it('a raw read past the end answers no bytes and the file’s size', async () => {
    write(inRoot('ten.txt'), Buffer.from('0123456789'));
    expect(await service().read({ appSessionId: A, path: inRoot('ten.txt'), offset: 50, raw: true })).toEqual({
      encoding: 'base64', content: '', bytes: 10, offset: 50, length: 0, truncated: false, mime: 'text/plain', hash: null, utf8: null, identity: identityAt(inRoot('ten.txt')),
    });
  });

  it('a remote caller’s raw is passed over: the answer equals the plain read’s and carries no identity', async () => {
    write(inRoot('euros.txt'), 'ab€€cd\r\n');
    const files = service();
    for (const [offset, length] of [[0, 3], [3, 3], [0, 100]]) {
      const plain = await files.read({ appSessionId: A, path: inRoot('euros.txt'), offset, length }, UNCLAIMED);
      const raw = await files.read({ appSessionId: A, path: inRoot('euros.txt'), offset, length, raw: true }, UNCLAIMED);
      expect(raw, `${offset} ${length}`).toStrictEqual(plain);
      expect(raw).not.toHaveProperty('identity');
    }
  });

  it('a plain read’s answer is what it was', async () => {
    write(inRoot('ten.txt'), '0123456789');
    const files = service();
    const answer = await files.read({ appSessionId: A, path: inRoot('ten.txt'), offset: 2, length: 3 });
    expect(answer).toStrictEqual({ encoding: 'utf8', content: '234', bytes: 10, offset: 2, length: 3, truncated: true, mime: 'text/plain', hash: null, utf8: null });
    expect(Object.keys(answer)).not.toContain('identity');
    expect(Object.keys(await files.read({ appSessionId: A, path: inRoot('ten.txt'), hash: true }))).not.toContain('identity');
  });

  it('a raw read whose file changed while it was read is refused', async () => {
    // and so is one that also asks the hash, whose bytes come from one read of the whole file
    for (const hash of [false, true]) {
      write(inRoot('page.bin'), Buffer.alloc(64, 0x61));
      points['after-read'] = (path) => {
        pastChangeTime(path);
        writeFileSync(path, Buffer.alloc(64, 0x62)); // in place: the descriptor's file, the same size
      };
      await expect(service().read({ appSessionId: A, path: inRoot('page.bin'), length: 32, raw: true, hash }), `hash ${hash}`).rejects.toThrow(new Error(`changed while reading: ${inRoot('page.bin')}`));
      expect(points['after-read'], `hash ${hash}`).toBeUndefined(); // the point was reached
    }
    // the point is a raw read's alone: a plain read never reaches it
    points['after-read'] = () => {
      throw new Error('a plain read reached after-read');
    };
    await expect(service().read({ appSessionId: A, path: inRoot('page.bin'), length: 32 })).resolves.toMatchObject({ length: 32 });
  });

  it('a raw read answers the hash as the plain read does when both are asked', async () => {
    const bytes = Buffer.from('0123456789');
    write(inRoot('ten.txt'), bytes);
    const raw = await service().read({ appSessionId: A, path: inRoot('ten.txt'), offset: 2, length: 3, raw: true, hash: true });
    expect(raw).toMatchObject({ encoding: 'base64', length: 3, hash: createHash('sha256').update(bytes).digest('hex'), identity: identityAt(inRoot('ten.txt')) });
    expect(bytesOf(raw)).toEqual(Buffer.from('234'));
  });
});

// E1 start: a delivered file's Reveal in Finder (E1 residue 8)
describe('files reveal', () => {
  beforeEach(() => {
    write(inRoot('hello.txt'), 'HELLO_E1');
    write(inRoot('tool.py'), 'print("hi")\n');
    write(inRoot('run.sh'), '#!/bin/sh\n');
    fs.chmodSync(inRoot('run.sh'), 0o755);
  });

  it('shows any regular file in the roots, whatever its kind, since revealing runs nothing', async () => {
    const showItemInFolder = vi.fn<(path: string) => void>();
    const files = service({ port: portOf({ showItemInFolder }), env: {} });
    for (const name of ['hello.txt', 'tool.py', 'run.sh']) expect(await files.reveal(A, inRoot(name), null)).toEqual({ revealed: true, message: null });
    expect(showItemInFolder.mock.calls.map(([path]) => path)).toEqual([inRoot('hello.txt'), inRoot('tool.py'), inRoot('run.sh')]);
  });

  it('answers revealed: false with the boundary\'s message for a path outside, a symlink, a directory or a missing file', async () => {
    const showItemInFolder = vi.fn<(path: string) => void>();
    const files = service({ port: portOf({ showItemInFolder }), env: {} });
    symlinkSync(join(outside, 'secret.txt'), inRoot('leak'));
    mkdirSync(inRoot('dir'));
    expect(await files.reveal(A, join(outside, 'secret.txt'), null)).toEqual({ revealed: false, message: OUT });
    expect(await files.reveal(A, inRoot('leak'), null)).toEqual({ revealed: false, message: OUT });
    expect(await files.reveal(A, inRoot('dir'), null)).toEqual({ revealed: false, message: `not a file: ${inRoot('dir')}` });
    expect(await files.reveal(A, inRoot('gone.txt'), null)).toEqual({ revealed: false, message: `not found: ${inRoot('gone.txt')}` });
    expect(await files.reveal(B, inRoot('hello.txt'), null)).toEqual({ revealed: false, message: 'unknown app session: B' });
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it('under MAWS_E2E=1 with MAWS_E2E_OPEN_LOG appends `reveal <realpath>` instead of revealing', async () => {
    const showItemInFolder = vi.fn<(path: string) => void>();
    const log = at('open.log');
    const files = service({ port: portOf({ showItemInFolder }), env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log } });
    expect(await files.reveal(A, inRoot('hello.txt'), null)).toEqual({ revealed: true, message: null });
    expect(readFileSync(log, 'utf8')).toBe(`reveal ${inRoot('hello.txt')}\n`);
    expect(showItemInFolder).not.toHaveBeenCalled();
  });
});
// E1 end
// E2 start: a delivered file outside the session's directories (E2 execution document, Design §3, Decision Log 17 and
// 18): the reader's admission lets `read`, `openExternal` and `reveal` reach exactly the file a record names; `write`,
// `list` and `watch` keep the roots.
describe('files admission of delivered files', () => {
  let delivered: string;
  let admitted: ReturnType<typeof vi.fn<(appSessionId: AppSessionId, real: string) => Promise<boolean>>>;
  beforeEach(() => {
    delivered = join(outside, 'report.pdf');
    write(delivered, '%PDF-1.4\n%%EOF\n');
    write(join(outside, 'notes.md'), '# delivered notes\n');
    admitted = vi.fn(async (appSessionId: AppSessionId, real: string) => appSessionId === A && (real === delivered || real === join(outside, 'notes.md')));
  });

  it('reads, opens outside and reveals a file the session’s records name, by its realpath', async () => {
    const log = at('open.log');
    const files = service({ admitted, env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log } });
    expect((await files.read({ appSessionId: A, path: join(outside, 'notes.md') })).content).toBe('# delivered notes\n');
    expect(await files.openExternal(A, delivered, null)).toEqual({ opened: true, message: null });
    expect(await files.reveal(A, delivered, null)).toEqual({ revealed: true, message: null });
    expect(readFileSync(log, 'utf8')).toBe(`${delivered}\nreveal ${delivered}\n`);
    expect(admitted).toHaveBeenCalledWith(A, delivered);
  });

  it('never writes, lists or watches it, nor its directory', async () => {
    const files = service({ admitted, env: {} });
    const { hash } = await files.read({ appSessionId: A, path: join(outside, 'notes.md'), hash: true });
    await expect(files.write({ appSessionId: A, path: join(outside, 'notes.md'), content: 'changed', expectedHash: hash! })).rejects.toThrow(OUT);
    expect(readFileSync(join(outside, 'notes.md'), 'utf8')).toBe('# delivered notes\n');
    await expect(files.list({ appSessionId: A, path: outside })).rejects.toThrow(OUT);
    await expect(files.watch(A, outside, 'p1')).rejects.toThrow(OUT);
    await expect(files.read({ appSessionId: A, path: join(outside, 'secret.txt') })).rejects.toThrow(OUT); // a sibling it does not name
  });

  it('refuses an outside file the records do not name, and another session’s', async () => {
    const files = service({ admitted, env: {} });
    await expect(files.read({ appSessionId: A, path: join(outside, 'secret.txt') })).rejects.toThrow(OUT);
    records.set(B, record(root));
    await expect(files.read({ appSessionId: B, path: delivered })).rejects.toThrow(OUT);
    expect(await files.reveal(B, delivered, null)).toEqual({ revealed: false, message: OUT });
  });

  it('refuses a symlink to it, inside the roots or beside it', async () => {
    const files = service({ admitted, env: {} });
    symlinkSync(delivered, inRoot('link.pdf'));
    symlinkSync(delivered, join(outside, 'link.pdf'));
    await expect(files.read({ appSessionId: A, path: inRoot('link.pdf') })).rejects.toThrow(OUT);
    await expect(files.read({ appSessionId: A, path: join(outside, 'link.pdf') })).rejects.toThrow(OUT);
    expect(await files.reveal(A, join(outside, 'link.pdf'), null)).toEqual({ revealed: false, message: OUT });
  });

  it('asks only for a file outside the roots, and admits nothing without a reader', async () => {
    const files = service({ admitted, env: {} });
    await files.read({ appSessionId: A, path: inRoot('README.md') });
    expect(admitted).not.toHaveBeenCalled();
    const plain = service({ env: {} });
    await expect(plain.read({ appSessionId: A, path: delivered })).rejects.toThrow(OUT);
  });
});
// E2 end

// UX wave U6c (docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, M2; Interfaces §C): a file outside the
// session's directories that the session's own transcript links, read (and opened outside) read-only for a request of
// this machine that carries `named`. The transcript decides through the real search over a scratch store, in invented
// records; the boundary's cases take a reader that always answers yes.
describe('files admission of named files', () => {
  let store: StoreFixture;
  let transcripts: Map<AppSessionId, string>;
  let located: AppSessionId[]; // the reader's spy: whose transcript was looked for
  let serial: number;
  const said = (text: string) => ({ type: 'assistant', uuid: `a-${++serial}`, message: { role: 'assistant', content: [{ type: 'text', text }] } });
  const called = (id: string, name: string, input: object) => ({ type: 'assistant', uuid: `a-${++serial}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
  const typed = (content: string | object[]) => ({ type: 'user', uuid: `u-${++serial}`, message: { role: 'user', content } });
  const answered = (id: string, content: string | object[], extra: object = {}) => ({ type: 'user', uuid: `u-${++serial}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, ...extra });
  const queuedPrompt = (prompt: string) => ({ type: 'attachment', uuid: `q-${++serial}`, attachment: { type: 'queued_command', prompt, source_uuid: `s-${serial}`, commandMode: 'prompt', origin: { kind: 'human' } } });
  const queueRecord = (content: string) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-11-13T10:00:00.000Z', sessionId: 'engine-a', content });
  const link = (path: string) => `See [the file](${path}).`;
  const out = (...parts: string[]) => join(outside, ...parts);

  async function transcriptOf(appSessionId: AppSessionId, rows: object[]): Promise<void> {
    transcripts.set(appSessionId, await store.addTranscript(root, `engine-${appSessionId}`, rows.map((row) => JSON.stringify(row))));
  }
  // The real search over the scratch store, as the daemon builds it (`createNamedPaths`), with the reader's spy
  function namedService(extra: Partial<FilesServiceOptions> = {}, bounds?: NamedPathsOptions['bounds'], hooks?: NamedPathsOptions['hooks']) {
    const paths = createNamedPaths({ transcript: async (appSessionId) => (located.push(appSessionId), transcripts.get(appSessionId) ?? null), bounds, hooks });
    return service({ named: paths.names, env: {}, ...extra });
  }
  // The paths the service opened (the transcript's own open is the search's, by its own import)
  const opens = () => vi.spyOn(fs.promises, 'open');
  const openedAt = (spy: ReturnType<typeof opens>, path: string) => spy.mock.calls.filter(([opened]) => String(opened) === path).length;

  beforeEach(async () => {
    store = await StoreFixture.create();
    transcripts = new Map();
    located = [];
    serial = 0;
    write(out('notes.txt'), 'outside notes\n');
    write(out('report.pdf'), '%PDF-1.4\n%%EOF\n');
    write(out('unnamed.txt'), 'not linked\n');
  });
  afterEach(async () => {
    await store.dispose();
  });

  it('reads a file the transcript names in each counted form, with `named` in the answer', async () => {
    const forms: [string, (path: string) => object[]][] = [
      ['the agent’s text', (path) => [said(link(path))]],
      ['the person’s message', (path) => [typed(link(path))]],
      ['the person’s text block', (path) => [typed([{ type: 'text', text: link(path) }])]],
      ['a queued prompt’s record', (path) => [queuedPrompt(link(path))]],
      ['a plan', (path) => [called('t-plan', 'ExitPlanMode', { plan: `## Plan\n\n1. Edit ${link(path)}` })]],
      ['an MCP call’s result', (path) => [called('t-mcp', 'mcp__docs__find', { query: 'notes' }), answered('t-mcp', [{ type: 'text', text: link(path) }])]],
      ['a read’s chip', (path) => [called('t-read', 'Read', { file_path: path })]],
      ['an edit’s chip, by its input', (path) => [called('t-edit', 'Edit', { file_path: path, old_string: 'a', new_string: 'b' })]],
      ['an edit’s chip, by its result’s filePath', (path) => [called('t-write', 'Write', { file_path: out('elsewhere.txt'), content: 'x' }), answered('t-write', 'written', { toolUseResult: { type: 'create', filePath: path, content: 'x' } })]],
      ['an anchored comment', (path) => [typed(anchoredMessage({ anchor: { kind: 'file-line', label: 'form.txt', locator: `${path}:1`, path, line: 1 }, text: 'Look here', destination: 'main', screenshot: false }))]],
    ];
    const files = namedService();
    for (const [index, [form, rows]] of forms.entries()) {
      const session = `S${index}` as AppSessionId;
      const path = out(`form-${index}.txt`);
      write(path, `form ${index}\n`);
      records.set(session, record(root));
      await transcriptOf(session, rows(path));
      expect(await files.read({ appSessionId: session, path, named: true }), form).toMatchObject({ content: `form ${index}\n`, named: true });
    }
  });

  it('refuses a path the transcript does not write whole as a link or a chip, and opens nothing of it', async () => {
    write(out('.env'), 'TOKEN=invented\n');
    write(out('.env backup'), 'old\n');
    write(out('key'), 'invented key\n');
    write(out('key,backup'), 'b\n');
    write(out('key:backup'), 'c\n');
    write(out('prose.txt'), 'p\n');
    write(out('shell.txt'), 's\n');
    write(out('typed-only.txt'), 't\n');
    write(out('theirs.txt'), 'o\n');
    records.set(B, record(root));
    await transcriptOf(A, [
      said(`[e](<${out('.env backup')}>)`),
      said(`[k](${out('key,backup')}) and [k](${out('key:backup')})`),
      said(`The key is at host:${out('key')}, also [k](host:${out('key')}).`),
      said(`I wrote ${out('prose.txt')} for you.`),
      called('t-bash', 'Bash', { command: 'ls' }),
      answered('t-bash', link(out('shell.txt')), { toolUseResult: { stdout: link(out('shell.txt')), stderr: '' } }),
      queueRecord(link(out('typed-only.txt'))),
    ]);
    await transcriptOf(B, [said(link(out('theirs.txt')))]);
    const files = namedService();
    const spy = opens();
    for (const path of [out('.env'), out('key'), out('prose.txt'), out('shell.txt'), out('typed-only.txt'), out('theirs.txt'), out('unnamed.txt')]) {
      await expect(files.read({ appSessionId: A, path, named: true }), path).rejects.toThrow(new Error(OUT));
      expect(openedAt(spy, path), path).toBe(0);
    }
    expect(located.every((id) => id === A)).toBe(true); // another session's transcript was never looked for
  });

  // UX wave U6e (decision 7): a request with the key asks the transcript before any record of the Library the agent did
  // not make, so a delivered file is asked of it and is answered as what admitted it
  it('asks nothing of the transcript for a path inside the roots; asks it of a delivered file, which is answered added unless it names it', async () => {
    const admitted = vi.fn(async (_appSessionId: AppSessionId, real: string) => real === out('report.pdf') || real === out('notes.txt'));
    await transcriptOf(A, [said(link(inRoot('README.md'))), said(link(out('notes.txt')))]);
    const files = namedService({ admitted });
    const inside = await files.read({ appSessionId: A, path: inRoot('README.md'), named: true });
    expect(inside).toMatchObject({ content: '# readme\n' });
    expect(inside).not.toHaveProperty('named');
    expect(located).toEqual([]);
    const delivered = await files.read({ appSessionId: A, path: out('report.pdf'), named: true });
    expect(delivered).toMatchObject({ encoding: 'base64', named: true, outside: { real: out('report.pdf'), writable: false, why: 'added' } });
    expect(await files.read({ appSessionId: A, path: out('notes.txt'), named: true })).toMatchObject({ named: true, outside: { real: out('notes.txt'), writable: true } });
    expect(located).toEqual([A, A]);
    const unasked = await files.read({ appSessionId: A, path: out('report.pdf') }); // without the key: as before U6e
    expect(unasked).not.toHaveProperty('named');
    expect(located).toEqual([A, A]);
  });

  it('refuses a request without the key though the transcript names the path, and admits nothing without a reader', async () => {
    await transcriptOf(A, [said(link(out('notes.txt')))]);
    await expect(namedService().read({ appSessionId: A, path: out('notes.txt') })).rejects.toThrow(OUT);
    expect(located).toEqual([]);
    await expect(service({ env: {} }).read({ appSessionId: A, path: out('notes.txt'), named: true })).rejects.toThrow(OUT);
  });

  it('refuses a remote request that carries the key, before the transcript is looked for', async () => {
    await transcriptOf(A, [said(link(out('notes.txt'))), said(link(out('report.pdf')))]);
    const log = at('open.log');
    const files = namedService({ env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log } });
    await expect(files.read({ appSessionId: A, path: out('notes.txt'), named: true }, UNCLAIMED)).rejects.toThrow(OUT);
    await expect(files.openExternal(A, out('report.pdf'), null, { named: true, remote: true })).rejects.toThrow(OUT);
    expect(located).toEqual([]);
    expect(fs.existsSync(log)).toBe(false);
  });

  // Decision Log 14(b): a session none of whose folders resolve still reads a file its transcript links, and nothing else
  it('admits a named file for a session whose folders no longer resolve, and nothing else at that point', async () => {
    write(at('gone-repo', 'a.ts'), 'x');
    write(at('gone-worktree', 'a.ts'), 'x');
    records.set(A, record(at('gone-repo'), [], at('gone-worktree')));
    rmSync(at('gone-repo'), { recursive: true });
    rmSync(at('gone-worktree'), { recursive: true });
    await transcriptOf(A, [said(link(out('notes.txt')))]);
    const files = namedService();
    const spy = opens();
    expect(await files.read({ appSessionId: A, path: out('notes.txt'), named: true })).toMatchObject({ content: 'outside notes\n', named: true });
    located.length = 0;
    await expect(files.read({ appSessionId: A, path: out('notes.txt'), named: true }, UNCLAIMED)).rejects.toThrow(new Error(OUT));
    expect(located, 'a remote caller never reaches the transcript').toEqual([]);
    await expect(files.read({ appSessionId: A, path: out('notes.txt') })).rejects.toThrow(new Error(OUT));
    expect(located, 'nor does a request without the key').toEqual([]);
    await expect(files.read({ appSessionId: A, path: out('unnamed.txt'), named: true })).rejects.toThrow(new Error(OUT));
    expect(openedAt(spy, out('unnamed.txt'))).toBe(0);
  });

  it('answers `named` with every chunk and with the hashed read', async () => {
    write(out('long.txt'), 'abcdefghij');
    await transcriptOf(A, [said(link(out('long.txt')))]);
    const files = namedService();
    expect(await files.read({ appSessionId: A, path: out('long.txt'), named: true, length: 4 })).toMatchObject({ content: 'abcd', truncated: true, named: true });
    expect(await files.read({ appSessionId: A, path: out('long.txt'), named: true, offset: 4, length: 4 })).toMatchObject({ content: 'efgh', named: true });
    expect(await files.read({ appSessionId: A, path: out('long.txt'), named: true, hash: true })).toMatchObject({ content: 'abcdefghij', hash: expect.stringMatching(/^[0-9a-f]{64}$/), utf8: true, named: true });
  });

  // UX wave U6b-2: a raw read takes the plain read's admission whole
  it('a raw read of a file outside the folders is admitted and refused exactly as the plain read with named', async () => {
    const pdf = readFileSync(out('report.pdf'));
    await transcriptOf(A, [said(link(out('report.pdf')))]);
    const files = namedService();
    const raw = await files.read({ appSessionId: A, path: out('report.pdf'), named: true, raw: true });
    expect(raw).toMatchObject({ encoding: 'base64', bytes: pdf.length, length: pdf.length, named: true, identity: identityAt(out('report.pdf')) });
    expect(bytesOf(raw).equals(pdf)).toBe(true);
    // refused where the plain read is: without the key, from another machine, and a file the transcript does not name
    for (const [input, remote] of [[{ path: out('report.pdf') }, false], [{ path: out('report.pdf'), named: true as const }, true], [{ path: out('unnamed.txt'), named: true as const }, false]] as const) {
      await expect(files.read({ appSessionId: A, ...input }, fromAnotherMachine(remote)), JSON.stringify(input)).rejects.toThrow(new Error(OUT));
      await expect(files.read({ appSessionId: A, ...input, raw: true }, fromAnotherMachine(remote)), JSON.stringify(input)).rejects.toThrow(new Error(OUT));
    }
  });

  it('never writes, lists, watches or reveals the named file, nor reads its neighbour', async () => {
    await transcriptOf(A, [said(link(out('notes.txt')))]);
    const files = namedService();
    const { hash } = await files.read({ appSessionId: A, path: out('notes.txt'), named: true, hash: true });
    await expect(files.write({ appSessionId: A, path: out('notes.txt'), content: 'changed', expectedHash: hash! })).rejects.toThrow(OUT);
    expect(readFileSync(out('notes.txt'), 'utf8')).toBe('outside notes\n');
    await expect(files.list({ appSessionId: A, path: outside })).rejects.toThrow(OUT);
    await expect(files.watch(A, outside, 'p1')).rejects.toThrow(OUT);
    expect(files.watching()).toEqual([]);
    expect(await files.reveal(A, out('notes.txt'), null)).toEqual({ revealed: false, message: OUT });
    await expect(files.read({ appSessionId: A, path: out('unnamed.txt'), named: true })).rejects.toThrow(OUT);
  });

  it('opens outside a named document of an allowed kind, and keeps openExternal’s own refusals for it', async () => {
    write(out('run.sh'), '#!/bin/sh\necho hi\n');
    fs.chmodSync(out('run.sh'), 0o755);
    await transcriptOf(A, [said(`${link(out('report.pdf'))} ${link(out('run.sh'))}`)]);
    const log = at('open.log');
    const files = namedService({ env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log } });
    await expect(files.openExternal(A, out('report.pdf'), null)).rejects.toThrow(OUT); // no key: today's refusal
    expect(await files.openExternal(A, out('report.pdf'), null, { named: true })).toEqual({ opened: true, message: null });
    await expect(files.openExternal(A, out('run.sh'), null, { named: true })).rejects.toThrow(new Error(`not opened outside MAWS: ${out('run.sh')}`));
    await expect(files.openExternal(A, out('unnamed.txt'), null, { named: true })).rejects.toThrow(OUT);
    expect(readFileSync(log, 'utf8')).toBe(`${out('report.pdf')}\n`);
  });

  it('reads a named file through a folder that is a link, and refuses one whose last component is a link', async () => {
    symlinkSync(outside, at('via'));
    symlinkSync(out('notes.txt'), out('alias.txt'));
    await transcriptOf(A, [said(link(at('via', 'notes.txt'))), said(link(out('alias.txt')))]);
    const files = namedService();
    expect(await files.read({ appSessionId: A, path: at('via', 'notes.txt'), named: true })).toMatchObject({ content: 'outside notes\n', named: true });
    await expect(files.read({ appSessionId: A, path: out('alias.txt'), named: true })).rejects.toThrow(OUT);
  });

  it('answers not found for a named path that is gone and not a regular file for a named directory; the refusal for an unnamed one', async () => {
    mkdirSync(out('folder'));
    await transcriptOf(A, [said(link(out('gone.txt'))), said(link(out('folder'))), said(link(join(outside, 'missing', 'deeper.txt')))]);
    const files = namedService();
    await expect(files.read({ appSessionId: A, path: out('gone.txt'), named: true })).rejects.toThrow(new Error(`not found: ${out('gone.txt')}`));
    await expect(files.read({ appSessionId: A, path: join(outside, 'missing', 'deeper.txt'), named: true })).rejects.toThrow(new Error(`not found: ${join(outside, 'missing', 'deeper.txt')}`));
    await expect(files.read({ appSessionId: A, path: out('folder'), named: true })).rejects.toThrow(new Error(`not a regular file: ${out('folder')}`));
    await expect(files.read({ appSessionId: A, path: out('also-gone.txt'), named: true })).rejects.toThrow(new Error(OUT));
    await expect(files.read({ appSessionId: A, path: out('gone.txt') })).rejects.toThrow(new Error(OUT)); // no key
  });

  it('answers the refusal for a session with no transcript, or one that is not on disk', async () => {
    const files = namedService();
    await expect(files.read({ appSessionId: A, path: out('notes.txt'), named: true })).rejects.toThrow(OUT);
    transcripts.set(A, join(store.paths.projects, 'nowhere', 'engine-A.jsonl'));
    await expect(files.read({ appSessionId: A, path: out('notes.txt'), named: true })).rejects.toThrow(OUT);
    expect(located).toEqual([A, A]);
  });

  it('answers the refusal at once to a search past the queue’s bound, and the others as they would be', async () => {
    write(out('second.txt'), 'second\n');
    write(out('third.txt'), 'third\n');
    await transcriptOf(A, [said(link(out('notes.txt'))), said(link(out('second.txt'))), said(link(out('third.txt')))]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const opened = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    const files = namedService({}, { waiting: 1 }, {
      at: async (point) => {
        if (point !== 'opened' || !first) return;
        first = false;
        reached();
        await held;
      },
    });
    const running = files.read({ appSessionId: A, path: out('notes.txt'), named: true });
    await opened;
    const waiting = files.read({ appSessionId: A, path: out('second.txt'), named: true });
    // the second is queued before the third is made: each request resolves its path on the disk before it asks, and two
    // such resolutions in flight may finish in either order
    await vi.waitFor(() => expect(located).toHaveLength(2));
    await expect(within(files.read({ appSessionId: A, path: out('third.txt'), named: true }), 1000)).rejects.toThrow(OUT);
    release();
    expect(await running).toMatchObject({ content: 'outside notes\n', named: true });
    expect(await waiting).toMatchObject({ content: 'second\n', named: true });
  });

  it('asks the reader once, with the path as the request gave it and the caller’s signal', async () => {
    symlinkSync(outside, at('via'));
    const named = vi.fn(async () => 'counted' as const);
    const signal = new AbortController().signal;
    const files = service({ named, env: {} });
    await files.read({ appSessionId: A, path: at('via', 'notes.txt'), named: true }, undefined, signal);
    expect(named.mock.calls).toEqual([[A, at('via', 'notes.txt'), signal]]);
  });

  describe('the boundary holds for a named file (S1 to S3)', () => {
    it('refuses a path whose last component becomes a link after the search answered, and reads nothing (S1)', async () => {
      points['before-open'] = () => {
        unlinkSync(out('notes.txt'));
        symlinkSync(out('unnamed.txt'), out('notes.txt'));
      };
      const answer = service({ named: async () => 'counted' as const, env: {} }).read({ appSessionId: A, path: out('notes.txt'), named: true });
      await expect(answer).rejects.toThrow(OUT);
    });

    // UX wave U6b-2 (probe 7, third part): S1 for a raw read, the link put in place after the transcript's answer and
    // gone again before anything could look at a descriptor, so the open alone refuses it
    it.skipIf(process.platform !== 'darwin')('a raw read of a named file refuses a link put in its place after the transcript’s answer', async () => {
      const open = vi.spyOn(fs.promises, 'open');
      points['before-open'] = () => swapToLink(out('notes.txt'), out('unnamed.txt'));
      points['after-open'] = () => restore(out('notes.txt'));
      await expect(service({ named: async () => 'counted' as const, env: {} }).read({ appSessionId: A, path: out('notes.txt'), named: true, raw: true })).rejects.toThrow(OUT);
      expect(points['after-open']).toBeDefined(); // no descriptor was opened
      await expect(open.mock.results[0].value).rejects.toMatchObject({ code: 'ELOOP' });
      restore(out('notes.txt'));
    });

    it('refuses a path whose folder is swapped for a link to another place after the search answered (S2)', async () => {
      write(at('far', 'dir', 'notes.txt'), 'far notes\n');
      write(at('elsewhere', 'notes.txt'), 'elsewhere notes\n');
      points['before-open'] = () => swapToLink(at('far', 'dir'), at('elsewhere'));
      const answer = service({ named: async () => 'counted' as const, env: {} }).read({ appSessionId: A, path: at('far', 'dir', 'notes.txt'), named: true });
      await expect(answer).rejects.toThrow(OUT);
    });

    it('reads what the path names at the open when the file is replaced while the search runs (S3)', async () => {
      write(at('replacement'), 'replaced notes\n');
      points['before-named'] = () => renameSync(at('replacement'), out('notes.txt'));
      expect(await service({ named: async () => 'counted' as const, env: {} }).read({ appSessionId: A, path: out('notes.txt'), named: true })).toMatchObject({ content: 'replaced notes\n', named: true });
    });

    it('refuses a file replaced by a link while the search runs (S3)', async () => {
      points['before-named'] = () => {
        unlinkSync(out('notes.txt'));
        symlinkSync(out('unnamed.txt'), out('notes.txt'));
      };
      await expect(service({ named: async () => 'counted' as const, env: {} }).read({ appSessionId: A, path: out('notes.txt'), named: true })).rejects.toThrow(OUT);
    });
  });

  // APFS ignores case: the transcript's spelling is compared, the disk's is read
  it.skipIf(process.platform !== 'darwin')('reads a path the transcript writes in another case than the disk’s, and refuses a case it does not write', async () => {
    await transcriptOf(A, [said(link(out('Notes.txt')))]);
    const files = namedService();
    expect(await files.read({ appSessionId: A, path: out('Notes.txt'), named: true })).toMatchObject({ content: 'outside notes\n', named: true });
    await expect(files.read({ appSessionId: A, path: out('NOTES.txt'), named: true })).rejects.toThrow(OUT);
  });
});

// UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, "The write rule", M1, §B; S1 to
// S13): a file outside the session's directories is saved by `files.writeOutside` when the daemon holds, itself,
// evidence that admits it for that session (the transcript names it by a counted form, the person chose it, the
// session's agent sent it), the path still resolves to the real path the save names, the content is what was shown,
// and the file is not MAWS's own. Every claim that the transcript decides runs the real search over a scratch store,
// every claim that a grant decides a real grants file, every claim that a delivery decides a real Library index; MAWS's
// own folders are scratch folders handed to the service as such. A refusal is asserted with the bytes read back.
describe('files saves outside the folders', () => {
  const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  let store: StoreFixture;
  let transcripts: Map<AppSessionId, string>;
  let serial: number;
  let index: Index;
  let profile: string;
  let grantsFile: string;
  let grants: FileGrants;
  let told: string[];
  let asked: { transcript: AppSessionId[]; grants: number; sent: number; library: number };
  let logged: string[];
  const said = (text: string) => ({ type: 'assistant', uuid: `a-${++serial}`, message: { role: 'assistant', content: [{ type: 'text', text }] } });
  const called = (id: string, name: string, input: object) => ({ type: 'assistant', uuid: `a-${++serial}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
  const typed = (content: string) => ({ type: 'user', uuid: `u-${++serial}`, origin: { kind: 'human' }, message: { role: 'user', content } });
  const answered = (id: string, content: string | object[], extra: object = {}) => ({ type: 'user', uuid: `u-${++serial}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, ...extra });
  // A row the probes recorded (spikes/protocol-probe/fixtures/uxwave/), its marks kept and one run of its words replaced
  const recordedRow = (name: string, line: number, words: string, by: string): object => {
    const json = JSON.stringify(loadUxwaveTranscript(name)[line - 1]);
    if (!json.includes(words)) throw new Error(`${name}:${line} does not hold ${words}`);
    return JSON.parse(json.replace(words, JSON.stringify(by).slice(1, -1))) as object;
  };
  // The bridge's recorded delivery of the person's words, as a peer's: its frame names a session (U3a's reader, arrival.ts)
  const peerByBridge = (by: string): object =>
    JSON.parse(JSON.stringify(recordedRow('u3-sminos-r1-terminal', 37, 'UXW owner idle: reply with only the word ONE.', by)).replace('from human id=5aa95008', 'from session:7ef6ac00 id=5aa95008')) as object;
  const link = (path: string) => `See [the file](${path}).`;
  const out = (...parts: string[]) => join(outside, ...parts);
  const daemonExec = () => at('Apps', 'MAWS.app', 'Contents', 'MacOS', 'MAWS');
  // The Library's records, as the engine host's store hands them to the daemon's index (src/services/library/store.ts)
  const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  const artifact = (n: number, linkedPath: string, createdBy: LibraryEntry['createdBy']): LibraryEntry => ({
    id: uuid(n), kind: 'file', title: `File ${n}`, createdBy, createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false,
    agentEditsAsSuggestions: false, revision: 1, lastEditor: createdBy, lastEditedAt: 2, linkedPath,
  });
  const linked = (n: number, appSessionId: AppSessionId) => ({ artifactId: uuid(n), appSessionId, role: 'created' as const, lastAt: 1 });
  const session = (title: string): AppSessionId => {
    const id = index.sessions.upsertFromSummary(summary({ customTitle: title })).record.appId;
    records.set(id, record(root));
    return id;
  };

  async function transcriptOf(appSessionId: AppSessionId, rows: object[]): Promise<void> {
    transcripts.set(appSessionId, await store.addTranscript(root, `engine-${appSessionId}`, rows.map((row) => JSON.stringify(row))));
  }
  const openGrants = () => openFileGrants(grantsFile, { known: (id) => records.has(id), log: (line) => logged.push(line) });
  // The service as the daemon composes it (spine-root.ts): the real search, the real grants, the Library's index, MAWS's
  // own folders, each asked through a counting spy
  function outsideOptions(extra: Partial<FilesServiceOptions> = {}): Partial<FilesServiceOptions> {
    const paths = createNamedPaths({ transcript: async (appSessionId) => (asked.transcript.push(appSessionId), transcripts.get(appSessionId) ?? null) });
    const counted: FilesServiceOptions['grants'] = { add: (id, real) => grants.add(id, real), has: (id, real) => (asked.grants += 1, grants.has(id, real)) };
    const linkedPaths = fileAdmission({ fileLinkedPaths: async (id) => index.library.fileLinkedPaths(id) });
    return {
      named: paths.names,
      grants: counted,
      sent: async (id, real) => {
        asked.sent += 1;
        for (const path of index.library.fileSentPaths(id)) if ((await realpath(path).catch(() => null)) === real) return true;
        return false;
      },
      admitted: async (id, real) => ((asked.library += 1), linkedPaths(id, real)),
      own: ownFolders(profile, daemonExec(), () => told),
      env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: at('open.log') },
      ...extra,
    };
  }
  const outsideService = (extra: Partial<FilesServiceOptions> = {}) => service(outsideOptions(extra));
  type Files = ReturnType<typeof outsideService>;
  // A read as the window makes one (with the key and the hash), and the save of what it showed
  const shown = (files: Files, appSessionId: AppSessionId, path: string, extra: object = {}) => files.read({ appSessionId, path, named: true, hash: true, ...extra });
  async function saveShown(files: Files, appSessionId: AppSessionId, path: string, content: string) {
    const read = await shown(files, appSessionId, path);
    return files.writeOutside({ appSessionId, path, content, expectedHash: read.hash!, real: read.outside?.real ?? '' });
  }
  const nothingAsked = () => expect({ transcript: asked.transcript, grants: asked.grants, sent: asked.sent, library: asked.library }).toEqual({ transcript: [], grants: 0, sent: 0, library: 0 });

  beforeEach(async () => {
    store = await StoreFixture.create();
    transcripts = new Map();
    serial = 0;
    index = new Index(at('index.sqlite'));
    profile = at('profile');
    mkdirSync(join(profile, 'sessions'), { recursive: true });
    grantsFile = join(profile, 'sessions', 'file-grants.json');
    logged = [];
    grants = openGrants();
    told = [];
    asked = { transcript: [], grants: 0, sent: 0, library: 0 };
    for (const name of ['named.txt', 'chosen.txt', 'sent.txt', 'added.txt', 'unnamed.txt', 'result.txt', 'edited.txt', 'peer.txt', 'notice.txt', 'plugin.txt']) write(out(name), `${name} as it was\n`);
    write(join(profile, 'settings.json'), '{ "theme": "light" }\n');
    write(at('Apps', 'MAWS.app', 'Contents', 'Resources', 'app.txt'), 'the daemon’s bundle\n');
    write(daemonExec(), '');
    write(at('Dev', 'MAWS Dev.app', 'Contents', 'Resources', 'dev.txt'), 'an attached app’s bundle\n');
  });
  afterEach(async () => {
    chmodSync(join(profile, 'sessions'), 0o700);
    index.close();
    await store.dispose();
  });

  describe('the save (write rule, lines 1 and 4)', () => {
    it('writes a named, a chosen and a sent file: the bytes on disk the content sent, the answer its hash', async () => {
      await transcriptOf(A, [said(link(out('named.txt')))]);
      index.library.reconcile({ artifacts: [artifact(1, out('sent.txt'), { kind: 'session', appSessionId: A })], links: [linked(1, A)], spaces: [] });
      const files = outsideService();
      expect(await files.grant(A, out('chosen.txt'))).toEqual({ status: 'granted', path: out('chosen.txt') });
      for (const name of ['named.txt', 'chosen.txt', 'sent.txt']) {
        expect(await shown(files, A, out(name)), name).toMatchObject({ named: true, outside: { real: out(name), writable: true } });
        expect(await saveShown(files, A, out(name), `${name} saved\n`), name).toEqual({ status: 'ok', hash: sha(`${name} saved\n`) });
        expect(readFileSync(out(name), 'utf8'), name).toBe(`${name} saved\n`);
      }
      expect(readFileSync(out('unnamed.txt'), 'utf8')).toBe('unnamed.txt as it was\n');
    });

    it('refuses a path with no evidence, one admitted only for another session by each kind, and a file only an added record points at', async () => {
      records.set(B, record(root));
      await transcriptOf(B, [said(link(out('named.txt')))]);
      await transcriptOf(A, [said('nothing linked')]);
      index.library.reconcile({
        artifacts: [artifact(1, out('sent.txt'), { kind: 'session', appSessionId: B }), artifact(2, out('added.txt'), { kind: 'human' })],
        links: [linked(1, B)],
        spaces: [],
      });
      const files = outsideService();
      await files.grant(B, out('chosen.txt'));
      const hashOf = (name: string) => sha(`${name} as it was\n`);
      for (const name of ['unnamed.txt', 'named.txt', 'chosen.txt', 'sent.txt', 'added.txt']) {
        await expect(files.writeOutside({ appSessionId: A, path: out(name), content: 'pwned\n', expectedHash: hashOf(name), real: out(name) }), name).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out(name), 'utf8'), name).toBe(`${name} as it was\n`);
      }
      // the added file is read, read-only: the page can make that record
      expect(await shown(files, A, out('added.txt'))).toMatchObject({ named: true, outside: { real: out('added.txt'), writable: false, why: 'added' } });
    });

    it('answers conflict for a file changed on disk since it was read, its bytes unchanged', async () => {
      await transcriptOf(A, [said(link(out('named.txt')))]);
      const files = outsideService();
      const read = await shown(files, A, out('named.txt'));
      writeFileSync(out('named.txt'), 'changed by another program\n');
      expect(await files.writeOutside({ appSessionId: A, path: out('named.txt'), content: 'mine\n', expectedHash: read.hash!, real: read.outside?.real ?? '' })).toEqual({ status: 'conflict', hash: sha('changed by another program\n') });
      expect(readFileSync(out('named.txt'), 'utf8')).toBe('changed by another program\n');
    });

    it('writes a file under a root too, with the real path compared, and asks no evidence for it', async () => {
      const files = outsideService();
      const path = inRoot('README.md');
      expect(await files.writeOutside({ appSessionId: A, path, content: '# saved\n', expectedHash: sha('# readme\n'), real: path })).toEqual({ status: 'ok', hash: sha('# saved\n') });
      expect(readFileSync(path, 'utf8')).toBe('# saved\n');
      await expect(files.writeOutside({ appSessionId: A, path, content: 'x', expectedHash: sha('# saved\n'), real: inRoot('src', 'a.ts') })).rejects.toThrow(new Error(FILES_MOVED));
      expect(readFileSync(path, 'utf8')).toBe('# saved\n');
      nothingAsked();
    });

    it('keeps files.write to the folders: a named, a chosen and a sent file refused as on master, a file in the roots written', async () => {
      await transcriptOf(A, [said(link(out('named.txt')))]);
      index.library.reconcile({ artifacts: [artifact(1, out('sent.txt'), { kind: 'session', appSessionId: A })], links: [linked(1, A)], spaces: [] });
      const files = outsideService();
      await files.grant(A, out('chosen.txt'));
      for (const name of ['named.txt', 'chosen.txt', 'sent.txt']) {
        await expect(files.write({ appSessionId: A, path: out(name), content: 'pwned\n', expectedHash: sha(`${name} as it was\n`) }), name).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out(name), 'utf8'), name).toBe(`${name} as it was\n`);
      }
      expect(await files.write({ appSessionId: A, path: inRoot('README.md'), content: '# in the root\n', expectedHash: sha('# readme\n') })).toEqual({ status: 'ok', hash: sha('# in the root\n') });
    });

    it('refuses a save from another machine without asking the transcript, the grants or the Library (line 5)', async () => {
      await transcriptOf(A, [said(link(out('named.txt')))]);
      index.library.reconcile({ artifacts: [artifact(1, out('sent.txt'), { kind: 'session', appSessionId: A })], links: [linked(1, A)], spaces: [] });
      grants.add(A, out('chosen.txt'));
      const files = outsideService();
      for (const name of ['named.txt', 'chosen.txt', 'sent.txt']) {
        await expect(files.writeOutside({ appSessionId: A, path: out(name), content: 'pwned\n', expectedHash: sha(`${name} as it was\n`), real: out(name) }, UNCLAIMED), name).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out(name), 'utf8'), name).toBe(`${name} as it was\n`);
      }
      await expect(files.grant(A, out('unnamed.txt'), UNCLAIMED)).rejects.toThrow(new Error(OUT));
      expect(grants.has(A, out('unnamed.txt'))).toBe(false);
      nothingAsked();
    });

    it('refuses the save of a named file once the transcript no longer names it, and writes it after a grant of the same real path (S9)', async () => {
      await transcriptOf(A, [said(link(out('named.txt')))]);
      const files = outsideService();
      const read = await shown(files, A, out('named.txt'));
      await transcriptOf(A, [said('the conversation was cleared')]); // the session is bound to another transcript
      const save = () => files.writeOutside({ appSessionId: A, path: out('named.txt'), content: 'saved\n', expectedHash: read.hash!, real: read.outside?.real ?? '' });
      await expect(save()).rejects.toThrow(new Error(OUT));
      expect(readFileSync(out('named.txt'), 'utf8')).toBe('named.txt as it was\n');
      await files.grant(A, out('named.txt'));
      expect(await save()).toEqual({ status: 'ok', hash: sha('saved\n') });
    });
  });

  // Decision 22 and Decision Log 7 and 8: what a tool returned, and text someone other than the person wrote, name a
  // path for a read and never for a save
  describe('which names count for a save', () => {
    it('reads a path only a tool’s result names, read-only, opens it outside, and never saves it by that name', async () => {
      write(out('result.pdf'), '%PDF-1.4\n%%EOF\n');
      await transcriptOf(A, [
        called('t-mcp', 'mcp__docs__find', { query: 'notes' }),
        answered('t-mcp', [{ type: 'text', text: `${link(out('result.txt'))} ${link(out('result.pdf'))}` }]),
        called('t-write', 'Write', { file_path: out('elsewhere.txt'), content: 'x' }),
        answered('t-write', 'written', { toolUseResult: { type: 'create', filePath: out('edited.txt'), content: 'x' } }),
      ]);
      const files = outsideService();
      for (const name of ['result.txt', 'edited.txt']) {
        expect(await shown(files, A, out(name)), name).toMatchObject({ content: `${name} as it was\n`, named: true, outside: { real: out(name), writable: false, why: 'result' } });
        await expect(saveShown(files, A, out(name), 'pwned\n'), name).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out(name), 'utf8'), name).toBe(`${name} as it was\n`);
      }
      expect(await files.openExternal(A, out('result.pdf'), null, { named: true })).toEqual({ opened: true, message: null });
    });

    it('saves the same path once the agent’s text links it, once a tool call’s input holds it, or once the person’s message links it', async () => {
      const result = [called('t-mcp', 'mcp__docs__find', {}), answered('t-mcp', link(out('result.txt')))];
      const counted: [string, object][] = [
        ['the agent’s text', said(link(out('result.txt')))],
        ['a tool call’s input', called('t-read', 'Read', { file_path: out('result.txt') })],
        ['the person’s message', typed(`Open ${link(out('result.txt'))}`)],
      ];
      for (const [form, row] of counted) {
        write(out('result.txt'), 'result.txt as it was\n');
        await transcriptOf(A, [...result]);
        const files = outsideService();
        expect(await shown(files, A, out('result.txt')), form).toMatchObject({ outside: { writable: false, why: 'result' } });
        await transcriptOf(A, [...result, row]);
        expect(await shown(files, A, out('result.txt')), form).toMatchObject({ named: true, outside: { real: out('result.txt'), writable: true } });
        expect(await saveShown(files, A, out('result.txt'), `saved by ${form}\n`), form).toEqual({ status: 'ok', hash: sha(`saved by ${form}\n`) });
        expect(readFileSync(out('result.txt'), 'utf8'), form).toBe(`saved by ${form}\n`);
      }
    });

    it('reads a path only a peer session’s message or a notification links, read-only, and saves it once the person’s own message does (Decision Log 8)', async () => {
      const peer = peerByBridge(`Please edit ${link(out('peer.txt'))}`);
      const notice = recordedRow('u3-tasks-r1', 38, 'Background command \\"uxw ok\\" completed (exit code 0)', `Wrote ${link(out('notice.txt'))}`);
      await transcriptOf(A, [peer, notice]);
      const files = outsideService();
      for (const name of ['peer.txt', 'notice.txt']) {
        expect(await shown(files, A, out(name)), name).toMatchObject({ content: `${name} as it was\n`, named: true, outside: { real: out(name), writable: false, why: 'result' } });
        await expect(saveShown(files, A, out(name), 'pwned\n'), name).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out(name), 'utf8'), name).toBe(`${name} as it was\n`);
      }
      await transcriptOf(A, [peer, notice, typed(`Yes, ${link(out('peer.txt'))}`)]);
      expect(await saveShown(files, A, out('peer.txt'), 'the person’s edit\n')).toEqual({ status: 'ok', hash: sha('the person’s edit\n') });
    });

    // Decision Log 22: a row of a plugin's origin (sminos, as the user) that the reader reads no arrival off is no proof
    // that the person wrote it: as the only evidence it names the path for a read, and refuses the save
    it('reads a path only a plugin’s row links (sminos, as the user), read-only, and refuses its save (Decision Log 22)', async () => {
      const plugin = { type: 'user', uuid: 'u-plugin', origin: { kind: 'plugin', name: 'sminos', asUser: true }, message: { role: 'user', content: `Please edit ${link(out('plugin.txt'))}` } };
      await transcriptOf(A, [plugin]);
      const files = outsideService();
      expect(await shown(files, A, out('plugin.txt'))).toMatchObject({ content: 'plugin.txt as it was\n', named: true, outside: { real: out('plugin.txt'), writable: false, why: 'result' } });
      await expect(files.writeOutside({ appSessionId: A, path: out('plugin.txt'), content: 'pwned\n', expectedHash: sha('plugin.txt as it was\n'), real: out('plugin.txt') })).rejects.toThrow(new Error(OUT));
      expect(readFileSync(out('plugin.txt'), 'utf8')).toBe('plugin.txt as it was\n');
    });

    // UX wave U6e, board ticket 675: an artifact's read the host attached to the person's message is not the person's
    // text, though the row is of the person's origin; a link in it (the artifact's content, which the agent can write)
    // names the path for a read only. The person's own words in the same message then save it.
    it('reads a path only an attached artifact read links, read-only, refuses its save, and saves it once the person’s own words link it (ticket 675)', async () => {
      write(out('linked.txt'), 'linked.txt as it was\n');
      const read = JSON.stringify({ status: 'read', artifactId: '4c85e0e6-8cf5-4f06-a7eb-90a3e66fd806', kind: 'document', title: 'Season plan', revision: 3, markdown: `# Season plan\n\n${link(out('linked.txt'))}\n` }, null, 2);
      const message = (words: string) => ({ ...typed(''), message: { role: 'user', content: [{ type: 'text', text: words }, { type: 'text', text: linkedReadBlock(read) }] } });
      await transcriptOf(A, [message('Make [Season plan](maws-artifact:4c85e0e6-8cf5-4f06-a7eb-90a3e66fd806) warmer.')]);
      const files = outsideService();
      expect(await shown(files, A, out('linked.txt'))).toMatchObject({ content: 'linked.txt as it was\n', named: true, outside: { real: out('linked.txt'), writable: false, why: 'result' } });
      await expect(saveShown(files, A, out('linked.txt'), 'pwned\n')).rejects.toThrow(new Error(OUT));
      expect(readFileSync(out('linked.txt'), 'utf8')).toBe('linked.txt as it was\n');
      await transcriptOf(A, [message(`Make it warmer, and ${link(out('linked.txt'))}`)]);
      expect(await saveShown(files, A, out('linked.txt'), 'the person’s edit\n')).toEqual({ status: 'ok', hash: sha('the person’s edit\n') });
    });
  });

  // UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, R1): a `file:` link with an empty host is
  // the scheme-less link's form, under the same rule; every other `file:` form adds no evidence
  describe('the file: form of a link', () => {
    const fileLink = (path: string) => `See [the file](file://${path}).`;

    it('in the agent’s text, opens a file outside the folders and saves it (L2)', async () => {
      await transcriptOf(A, [said(fileLink(out('named.txt')))]);
      const files = outsideService();
      expect(await shown(files, A, out('named.txt'))).toMatchObject({ named: true, outside: { real: out('named.txt'), writable: true } });
      expect(await saveShown(files, A, out('named.txt'), 'saved\n')).toEqual({ status: 'ok', hash: sha('saved\n') });
    });

    // N1.7: refused for a session with no other evidence; the control, the person's choice, which no form takes away
    it('a transcript whose only mention of the file is another `file:` form is refused; the person’s choice still opens it (N1.7)', async () => {
      const path = out('unnamed.txt');
      await transcriptOf(A, [said(`[r](file://host${path}) [r](file://localhost${path}) [r](file:${path}) <file://${path}>`), said(`[r][l]\n\n[l]: file://${path}`)]);
      const files = outsideService();
      await expect(shown(files, A, path)).rejects.toThrow(new Error(OUT));
      expect(asked.transcript).toEqual([A]);
      expect(await files.grant(A, path)).toEqual({ status: 'granted', path });
      expect(await shown(files, A, path)).toMatchObject({ named: true, outside: { real: path, writable: true } });
    });

    it('written only in an MCP tool’s result, it opens read-only and is never saved by that name (N1.8)', async () => {
      await transcriptOf(A, [called('t-mcp', 'mcp__docs__find', { query: 'notes' }), answered('t-mcp', [{ type: 'text', text: fileLink(out('result.txt')) }])]);
      const files = outsideService();
      expect(await shown(files, A, out('result.txt'))).toMatchObject({ named: true, outside: { real: out('result.txt'), writable: false, why: 'result' } });
      await expect(saveShown(files, A, out('result.txt'), 'pwned\n')).rejects.toThrow(new Error(OUT));
      expect(readFileSync(out('result.txt'), 'utf8')).toBe('result.txt as it was\n');
      // the control: once the person chooses the same file, the same save is made
      expect(await files.grant(A, out('result.txt'))).toEqual({ status: 'granted', path: out('result.txt') });
      expect(await shown(files, A, out('result.txt'))).toMatchObject({ named: true, outside: { real: out('result.txt'), writable: true } });
      expect(await saveShown(files, A, out('result.txt'), 'pwned\n')).toEqual({ status: 'ok', hash: sha('pwned\n') });
      expect(readFileSync(out('result.txt'), 'utf8')).toBe('pwned\n');
    });
  });

  // UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, R2, N2.2): the window resolves a relative
  // link against the working folder before it reads; the transcript wrote the relative string, which names nothing
  describe('a relative link', () => {
    it('names no file outside the folders: the absolute path the window resolves it to is refused; the person’s choice opens it (N2.2)', async () => {
      const path = out('unnamed.txt');
      const written = relative(root, path); // `../outside/unnamed.txt`, as an agent working in the root would write it
      expect(written.startsWith('..')).toBe(true);
      expect(normalizeLexically(`${root}/${written}`)).toBe(path); // what the window asks for (open-file.ts, resolveRelative)
      await transcriptOf(A, [said(`See [the file](${written}) and [the other](./${written}).`)]);
      const files = outsideService();
      await expect(shown(files, A, path)).rejects.toThrow(new Error(OUT));
      expect(asked.transcript).toEqual([A]); // the search ran and found nothing
      expect(await files.grant(A, path)).toEqual({ status: 'granted', path });
      expect(await shown(files, A, path)).toMatchObject({ named: true, outside: { real: path, writable: true } });
    });
  });

  // The panel's finding 2: a prompt queued in a running turn counts for a save only when the person wrote it
  describe('which queued prompts count for a save', () => {
    // board ticket 711: the envelope holds what the person typed and no label of an option, so the answer names the path
    // in a typed answer
    const answerNaming = (path: string) => askSteerText('toolu_q', [{ question: 'Which file?', header: 'File', modality: 'text' }], [{ id: 'q1', question: 'Which file?', status: 'answered', value: link(path) }]);

    it('reads a path only MAWS’s queued answer names, read-only, never saves it by that, and saves it once the person’s queued message links it', async () => {
      await transcriptOf(A, [queuedPrompt(answerNaming(out('result.txt')))]);
      const files = outsideService();
      expect(await shown(files, A, out('result.txt'))).toMatchObject({ named: true, outside: { real: out('result.txt'), writable: false, why: 'result' } });
      await expect(saveShown(files, A, out('result.txt'), 'pwned\n')).rejects.toThrow(new Error(OUT));
      expect(readFileSync(out('result.txt'), 'utf8')).toBe('result.txt as it was\n');
      await transcriptOf(A, [queuedPrompt(answerNaming(out('result.txt'))), queuedPrompt(`Please edit ${link(out('result.txt'))}`)]);
      expect(await saveShown(files, A, out('result.txt'), 'the person’s edit\n')).toEqual({ status: 'ok', hash: sha('the person’s edit\n') });
    });

    it('admits no save by a queued peer message or a queued notification', async () => {
      await transcriptOf(A, [queuedPeerMessage(`Please edit ${link(out('peer.txt'))}`), queuedNotification(`Wrote ${link(out('notice.txt'))}`)]);
      const files = outsideService();
      for (const name of ['peer.txt', 'notice.txt']) {
        await expect(files.writeOutside({ appSessionId: A, path: out(name), content: 'pwned\n', expectedHash: sha(`${name} as it was\n`), real: out(name) }), name).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out(name), 'utf8'), name).toBe(`${name} as it was\n`);
      }
    });
  });

  // Write rule, line 5; decision 8; A8: no write reaches MAWS's own folders, whatever admits the file
  describe('MAWS’s own folders', () => {
    const ownFiles = () => [join(profile, 'settings.json'), at('Apps', 'MAWS.app', 'Contents', 'Resources', 'app.txt'), at('Dev', 'MAWS Dev.app', 'Contents', 'Resources', 'dev.txt')];
    const original = (path: string) => readFileSync(path, 'utf8');

    it('reads a file under the profile, the daemon’s bundle and a told app’s bundle with own, and refuses it to both commands through a root that holds it', async () => {
      told = [at('Dev', 'MAWS Dev.app')];
      records.set(H, record(base)); // a chat whose folder holds the profile and both bundles
      const files = outsideService();
      for (const path of ownFiles()) {
        const before = original(path);
        const read = await files.read({ appSessionId: H, path, hash: true });
        expect(read, path).toMatchObject({ content: before, own: true });
        expect(read, path).not.toHaveProperty('named');
        await expect(files.write({ appSessionId: H, path, content: 'pwned\n', expectedHash: read.hash! }), path).rejects.toThrow(new Error(`not writable: ${path}`));
        await expect(files.writeOutside({ appSessionId: H, path, content: 'pwned\n', expectedHash: read.hash!, real: path }), path).rejects.toThrow(new Error(`not writable: ${path}`));
        expect(original(path), path).toBe(before);
      }
      expect(await files.read({ appSessionId: H, path: inRoot('README.md') })).not.toHaveProperty('own');
    });

    it('refuses it admitted by a name and by a grant, and reads it with own', async () => {
      told = [at('Dev', 'MAWS Dev.app')];
      await transcriptOf(A, ownFiles().map((path) => said(`See [the file](<${path}>).`))); // a destination with a space is written in angle brackets
      records.set(B, record(root));
      const files = outsideService();
      for (const path of ownFiles()) expect(await files.grant(B, path), path).toEqual({ status: 'granted', path });
      for (const [appSessionId, path] of [...ownFiles().map((path) => [A, path] as const), ...ownFiles().map((path) => [B, path] as const)]) {
        const before = original(path);
        expect(await shown(files, appSessionId, path), path).toMatchObject({ named: true, own: true, outside: { real: path } });
        await expect(saveShown(files, appSessionId, path, 'pwned\n'), `${appSessionId} ${path}`).rejects.toThrow(new Error(`not writable: ${path}`));
        expect(original(path), path).toBe(before);
      }
    });

    it('refuses the grants file itself through a root that holds the profile, by both commands, and a store opened again holds the grants it held', async () => {
      records.set(H, record(base));
      const files = outsideService();
      expect(await files.grant(A, out('chosen.txt'))).toEqual({ status: 'granted', path: out('chosen.txt') });
      const before = readFileSync(grantsFile, 'utf8');
      const forged = JSON.stringify({ version: 1, sessions: { [A]: [{ real: out('unnamed.txt'), at: 1 }], [H]: [{ real: join(outside, 'secret.txt'), at: 1 }] } });
      const read = await files.read({ appSessionId: H, path: grantsFile, hash: true });
      expect(read).toMatchObject({ own: true });
      await expect(files.write({ appSessionId: H, path: grantsFile, content: forged, expectedHash: read.hash! })).rejects.toThrow(new Error(`not writable: ${grantsFile}`));
      await expect(files.writeOutside({ appSessionId: H, path: grantsFile, content: forged, expectedHash: read.hash!, real: grantsFile })).rejects.toThrow(new Error(`not writable: ${grantsFile}`));
      expect(readFileSync(grantsFile, 'utf8')).toBe(before);
      // the daemon restarts: the store is opened again over the same file
      grants = openGrants();
      expect(grants.has(A, out('chosen.txt'))).toBe(true);
      expect(grants.has(A, out('unnamed.txt'))).toBe(false);
      const restarted = outsideService();
      await expect(restarted.read({ appSessionId: A, path: out('unnamed.txt'), named: true })).rejects.toThrow(new Error(OUT));
      expect(await saveShown(restarted, A, out('chosen.txt'), 'still chosen\n')).toEqual({ status: 'ok', hash: sha('still chosen\n') });
    });

    // Review finding 1: MAWS's own folders are compared by the real path the boundary confirms (the native realpath), so
    // a folder handed in through a link to it, or in another case than the disk's, protects what is in it
    const refusesBoth = async (files: Files, appSessionId: AppSessionId, path: string) => {
      const before = original(path);
      const read = await files.read({ appSessionId, path, hash: true });
      expect(read, path).toMatchObject({ own: true });
      const forged = JSON.stringify({ version: 1, sessions: { [A]: [{ real: out('unnamed.txt'), at: 1 }] } });
      await expect(files.write({ appSessionId, path, content: forged, expectedHash: read.hash! }), path).rejects.toThrow(new Error(`not writable: ${path}`));
      await expect(files.writeOutside({ appSessionId, path, content: forged, expectedHash: read.hash!, real: path }), path).rejects.toThrow(new Error(`not writable: ${path}`));
      expect(original(path), path).toBe(before);
    };
    const holdsOnlyTheGrantMade = () => {
      grants = openGrants(); // the daemon restarts: the store is opened again over the same file
      expect(grants.has(A, out('chosen.txt'))).toBe(true);
      expect(grants.has(A, out('unnamed.txt'))).toBe(false);
    };

    it('refuses both writes under a profile handed in through a link to it, the grants file among them, and a store opened again holds the grants it held', async () => {
      symlinkSync(profile, at('profile-alias'));
      records.set(H, record(base));
      const files = outsideService({ own: ownFolders(at('profile-alias'), at('bin', 'node'), () => []) });
      expect(await files.grant(A, out('chosen.txt'))).toEqual({ status: 'granted', path: out('chosen.txt') });
      for (const path of [grantsFile, join(profile, 'settings.json')]) await refusesBoth(files, H, path);
      holdsOnlyTheGrantMade();
    });

    // APFS ignores case: the profile and a told bundle given in another case than the disk's are the same folders
    it.skipIf(process.platform !== 'darwin')('refuses both writes under a profile and a told bundle given in another case than the disk’s, and a store opened again holds the grants it held', async () => {
      records.set(H, record(base));
      const files = outsideService({ own: ownFolders(at('PROFILE'), at('bin', 'node'), () => [at('Dev', 'maws dev.app')]) });
      expect(await files.grant(A, out('chosen.txt'))).toEqual({ status: 'granted', path: out('chosen.txt') });
      for (const path of [grantsFile, join(profile, 'settings.json'), at('Dev', 'MAWS Dev.app', 'Contents', 'Resources', 'dev.txt')]) await refusesBoth(files, H, path);
      holdsOnlyTheGrantMade();
    });

    // The panel's finding 1: a bundle whose suffix is written in another case (the default Mac volume ignores case)
    it('refuses both writes into a bundle named MAWS.APP or Maws.App under a session’s root, the daemon’s and a told one', async () => {
      // two parents: on a volume that ignores case the two bundles' names are one name
      const exec = at('Upper', 'MAWS.APP', 'Contents', 'MacOS', 'MAWS');
      write(exec, 'the daemon’s executable\n');
      write(at('Mixed', 'Maws.App', 'Contents', 'MacOS', 'Maws'), 'an attached app’s executable\n');
      records.set(H, record(base));
      const files = outsideService({ own: ownFolders(profile, exec, () => [at('Mixed', 'Maws.App')]) });
      for (const path of [exec, at('Mixed', 'Maws.App', 'Contents', 'MacOS', 'Maws')]) {
        const before = original(path);
        const read = await files.read({ appSessionId: H, path, hash: true });
        expect(read, path).toMatchObject({ own: true });
        await expect(files.write({ appSessionId: H, path, content: 'pwned\n', expectedHash: read.hash! }), path).rejects.toThrow(new Error(`not writable: ${path}`));
        await expect(files.writeOutside({ appSessionId: H, path, content: 'pwned\n', expectedHash: read.hash!, real: path }), path).rejects.toThrow(new Error(`not writable: ${path}`));
        expect(original(path), path).toBe(before);
      }
    });

    it('protects an attached app’s bundle once the app tells it, and not before (S13)', async () => {
      records.set(H, record(base));
      const files = outsideService();
      const path = at('Dev', 'MAWS Dev.app', 'Contents', 'Resources', 'dev.txt');
      const before = await files.read({ appSessionId: H, path, hash: true });
      expect(before).not.toHaveProperty('own');
      expect(await files.write({ appSessionId: H, path, content: 'before the telling\n', expectedHash: before.hash! })).toEqual({ status: 'ok', hash: sha('before the telling\n') });
      told = [at('Dev', 'MAWS Dev.app')];
      const after = await files.read({ appSessionId: H, path, hash: true });
      expect(after).toMatchObject({ own: true });
      await expect(files.write({ appSessionId: H, path, content: 'after\n', expectedHash: after.hash! })).rejects.toThrow(new Error(`not writable: ${path}`));
      await expect(files.writeOutside({ appSessionId: H, path, content: 'after\n', expectedHash: after.hash!, real: path })).rejects.toThrow(new Error(`not writable: ${path}`));
      expect(readFileSync(path, 'utf8')).toBe('before the telling\n');
    });
  });

  // Decision 20: the Library admits a save only for what the session's agent sent, by its record's maker
  describe('a sent and an added file', () => {
    it('marks sent, writable, a file artifact whose maker is the session or its side thread’s ancestor', async () => {
      const parent = session('Parent');
      const thread = session('Thread');
      index.sideThreads.opened(thread, parent, 't1');
      index.library.reconcile({ artifacts: [artifact(1, out('sent.txt'), { kind: 'session', appSessionId: parent })], links: [linked(1, parent)], spaces: [] });
      const files = outsideService();
      for (const id of [parent, thread]) {
        expect(await shown(files, id, out('sent.txt'))).toMatchObject({ named: true, outside: { real: out('sent.txt'), writable: true } });
      }
      expect(await saveShown(files, thread, out('sent.txt'), 'saved in the thread\n')).toEqual({ status: 'ok', hash: sha('saved in the thread\n') });
      expect(asked.transcript, 'a sent file is admitted before the transcript is asked').toEqual([]);
    });

    it('marks added, read-only, a record the person made, one linked to no session, and one another session’s agent made: read and opened outside, never saved', async () => {
      const mine = session('Mine');
      const other = session('Other');
      write(out('added.pdf'), '%PDF-1.4\n%%EOF\n');
      write(out('theirs.txt'), 'theirs\n');
      index.library.reconcile({
        artifacts: [artifact(1, out('added.txt'), { kind: 'human' }), artifact(2, out('added.pdf'), { kind: 'human' }), artifact(3, out('theirs.txt'), { kind: 'session', appSessionId: other })],
        links: [linked(1, mine), linked(3, mine)],
        spaces: [],
      });
      const files = outsideService();
      for (const path of [out('added.txt'), out('added.pdf'), out('theirs.txt')]) {
        expect(await shown(files, mine, path), path).toMatchObject({ named: true, outside: { real: path, writable: false, why: 'added' } });
        await expect(saveShown(files, mine, path, 'pwned\n'), path).rejects.toThrow(new Error(OUT));
      }
      expect(readFileSync(out('added.txt'), 'utf8')).toBe('added.txt as it was\n');
      expect(readFileSync(out('theirs.txt'), 'utf8')).toBe('theirs\n');
      expect(await files.openExternal(mine, out('added.pdf'), null, { named: true })).toEqual({ opened: true, message: null });
      // without the key, a delivered file is read as before U6e: unmarked
      expect(await files.read({ appSessionId: mine, path: out('added.txt') })).not.toHaveProperty('outside');
    });

    it('marks named a file both added and named by a counted form, and result one both added and named only by a result', async () => {
      const mine = session('Mine');
      index.library.reconcile({ artifacts: [artifact(1, out('named.txt'), { kind: 'human' }), artifact(2, out('result.txt'), { kind: 'human' })], links: [], spaces: [] });
      await transcriptOf(mine, [said(link(out('named.txt'))), called('t-mcp', 'mcp__docs__find', {}), answered('t-mcp', link(out('result.txt')))]);
      const files = outsideService();
      expect(await shown(files, mine, out('named.txt'))).toMatchObject({ outside: { writable: true } });
      expect(await shown(files, mine, out('result.txt'))).toMatchObject({ outside: { writable: false, why: 'result' } });
      expect(await saveShown(files, mine, out('named.txt'), 'saved\n')).toEqual({ status: 'ok', hash: sha('saved\n') });
    });
  });

  describe('the read’s answer', () => {
    it('carries outside with the same real path on every chunk and on the hashed read, the path as given through a folder link', async () => {
      write(out('long.txt'), 'abcdefghij');
      symlinkSync(outside, at('via'));
      await transcriptOf(A, [said(link(at('via', 'long.txt')))]);
      const files = outsideService();
      const outsideOf = { real: out('long.txt'), writable: true };
      expect(await files.read({ appSessionId: A, path: at('via', 'long.txt'), named: true, length: 4 })).toMatchObject({ content: 'abcd', named: true, outside: outsideOf });
      expect(await files.read({ appSessionId: A, path: at('via', 'long.txt'), named: true, offset: 4, length: 4 })).toMatchObject({ content: 'efgh', named: true, outside: outsideOf });
      const hashed = await files.read({ appSessionId: A, path: at('via', 'long.txt'), named: true, hash: true });
      expect(hashed).toMatchObject({ named: true, outside: outsideOf });
      expect(hashed.outside).not.toHaveProperty('why');
      expect(await files.read({ appSessionId: A, path: inRoot('README.md'), named: true })).not.toHaveProperty('outside');
    });

    it('admits a chosen file to a read the agent did not ask, and refuses one it did; a named or a sent file is admitted to both (decision 19)', async () => {
      write(out('chosen.pdf'), '%PDF-1.4\n%%EOF\n');
      await transcriptOf(A, [said(link(out('named.txt')))]);
      index.library.reconcile({ artifacts: [artifact(1, out('sent.txt'), { kind: 'session', appSessionId: A })], links: [linked(1, A)], spaces: [] });
      const files = outsideService();
      await files.grant(A, out('chosen.txt'));
      await files.grant(A, out('chosen.pdf'));
      expect(await files.read({ appSessionId: A, path: out('chosen.txt'), named: true })).toMatchObject({ outside: { writable: true } });
      await expect(files.read({ appSessionId: A, path: out('chosen.txt'), named: true, agent: true })).rejects.toThrow(new Error(OUT));
      for (const name of ['named.txt', 'sent.txt']) expect(await files.read({ appSessionId: A, path: out(name), named: true, agent: true }), name).toMatchObject({ outside: { writable: true } });
      expect(await files.openExternal(A, out('chosen.pdf'), null, { named: true })).toEqual({ opened: true, message: null });
      await expect(files.openExternal(A, out('chosen.pdf'), null, { named: true, agent: true })).rejects.toThrow(new Error(OUT));
    });

    it('never lists, watches or reveals a chosen file or its folder, nor reads its neighbour', async () => {
      const files = outsideService();
      await files.grant(A, out('chosen.txt'));
      await expect(files.list({ appSessionId: A, path: outside })).rejects.toThrow(new Error(OUT));
      await expect(files.watch(A, outside, 'p1')).rejects.toThrow(new Error(OUT));
      expect(files.watching()).toEqual([]);
      expect(await files.reveal(A, out('chosen.txt'), null)).toEqual({ revealed: false, message: OUT });
      await expect(files.read({ appSessionId: A, path: out('unnamed.txt'), named: true })).rejects.toThrow(new Error(OUT));
    });

    it('admits a chosen file for a session whose folders no longer resolve', async () => {
      write(at('gone-repo', 'a.ts'), 'x');
      records.set(A, record(at('gone-repo')));
      rmSync(at('gone-repo'), { recursive: true });
      const files = outsideService();
      await files.grant(A, out('chosen.txt'));
      expect(await shown(files, A, out('chosen.txt'))).toMatchObject({ content: 'chosen.txt as it was\n', outside: { writable: true } });
    });

    it('answers not found for a granted path that is gone, and the refusal for one with no grant', async () => {
      const files = outsideService();
      await files.grant(A, out('chosen.txt'));
      unlinkSync(out('chosen.txt'));
      await expect(files.read({ appSessionId: A, path: out('chosen.txt'), named: true })).rejects.toThrow(new Error(`not found: ${out('chosen.txt')}`));
      await expect(files.read({ appSessionId: A, path: out('chosen.txt'), named: true, agent: true })).rejects.toThrow(new Error(OUT));
      await expect(files.read({ appSessionId: A, path: out('never.txt'), named: true })).rejects.toThrow(new Error(OUT));
    });
  });

  describe('the grant', () => {
    it('records a regular file by its real path, a link by its target’s, and refuses a directory, a package and a special file (C4)', async () => {
      mkdirSync(out('folder'));
      mkdirSync(out('Tool.app', 'Contents'), { recursive: true });
      execFileSync('mkfifo', [out('pipe')]);
      symlinkSync(out('chosen.txt'), out('alias.txt'));
      const files = outsideService();
      expect(await files.grant(A, out('alias.txt'))).toEqual({ status: 'granted', path: out('chosen.txt') });
      expect(grants.has(A, out('chosen.txt'))).toBe(true);
      expect(grants.has(A, out('alias.txt'))).toBe(false);
      for (const path of [out('folder'), out('Tool.app'), out('pipe')]) {
        expect(await files.grant(A, path), path).toEqual({ status: 'refused', reason: 'not-a-file' });
        expect(grants.has(A, path), path).toBe(false);
      }
    });

    it('refuses a path that is not absolute or not normal, a path that is gone, an unknown session, and every grant with no grants given', async () => {
      const files = outsideService();
      await expect(files.grant(A, 'outside/chosen.txt')).rejects.toThrow('path must be absolute');
      await expect(files.grant(A, `${outside}/../outside/chosen.txt`)).rejects.toThrow(new Error(OUT));
      await expect(files.grant(A, out('never.txt'))).rejects.toThrow(new Error(`not found: ${out('never.txt')}`));
      await expect(files.grant('nope' as AppSessionId, out('chosen.txt'))).rejects.toThrow('unknown app session: nope');
      await expect(outsideService({ grants: undefined }).grant(A, out('chosen.txt'))).rejects.toThrow(new Error(OUT));
      expect(existsSync(grantsFile)).toBe(false);
    });

    it('survives a restart: a store opened again over the file admits the chosen file', async () => {
      await outsideService().grant(A, out('chosen.txt'));
      grants = openGrants();
      expect(await saveShown(outsideService(), A, out('chosen.txt'), 'after a restart\n')).toEqual({ status: 'ok', hash: sha('after a restart\n') });
    });

    it('fails a grant whose file cannot be written: nothing is held, and the file stays refused (S7)', async () => {
      const files = outsideService();
      chmodSync(join(profile, 'sessions'), 0o500);
      await expect(files.grant(A, out('chosen.txt'))).rejects.toThrow();
      expect(grants.has(A, out('chosen.txt'))).toBe(false);
      await expect(files.read({ appSessionId: A, path: out('chosen.txt'), named: true })).rejects.toThrow(new Error(OUT));
    });

    it('refuses a grant whose session is removed before the add’s write, writing nothing (S12)', async () => {
      const files = outsideService({ grants: { add: (id, real) => (records.delete(id), grants.add(id, real)), has: (id, real) => grants.has(id, real) } });
      await expect(files.grant(A, out('chosen.txt'))).rejects.toThrow(`unknown app session: ${A}`);
      expect(existsSync(grantsFile)).toBe(false);
    });

    it('refuses the next read and save of a chosen file once its session’s record is removed (S8)', async () => {
      const files = outsideService();
      await files.grant(A, out('chosen.txt'));
      const read = await shown(files, A, out('chosen.txt'));
      records.delete(A);
      await expect(files.read({ appSessionId: A, path: out('chosen.txt'), named: true })).rejects.toThrow(`unknown app session: ${A}`);
      await expect(files.writeOutside({ appSessionId: A, path: out('chosen.txt'), content: 'x', expectedHash: read.hash!, real: out('chosen.txt') })).rejects.toThrow(`unknown app session: ${A}`);
      expect(readFileSync(out('chosen.txt'), 'utf8')).toBe('chosen.txt as it was\n');
    });
  });

  // Write rule, line 3: the save names the real path it was shown, and the daemon resolves it again and opens it with no
  // link on the way. Each swap leaves a file of the same name and the same bytes where the link leads.
  describe('a path that moved (S1 to S6)', () => {
    beforeEach(() => {
      write(at('far', 'dir', 'notes.txt'), 'same bytes\n');
      write(at('twin', 'notes.txt'), 'same bytes\n');
    });
    const far = () => at('far', 'dir', 'notes.txt');
    const bothUnchanged = () => expect([readFileSync(at('far', 'dir.away', 'notes.txt'), 'utf8'), readFileSync(at('twin', 'notes.txt'), 'utf8')]).toEqual(['same bytes\n', 'same bytes\n']);

    it('refuses a save whose last component becomes a link between the daemon’s check and its open (S1)', async () => {
      await transcriptOf(A, [said(link(far()))]);
      const files = outsideService();
      const read = await shown(files, A, far());
      let swapped = false;
      points['before-open'] = () => {
        renameSync(far(), `${far()}.away`);
        symlinkSync(at('twin', 'notes.txt'), far());
        swapped = true;
      };
      await expect(files.writeOutside({ appSessionId: A, path: far(), content: 'pwned\n', expectedHash: read.hash!, real: read.outside?.real ?? '' })).rejects.toThrow(new Error(OUT));
      expect(swapped, 'the swap ran between the check and the open').toBe(true);
      expect([readFileSync(`${far()}.away`, 'utf8'), readFileSync(at('twin', 'notes.txt'), 'utf8')]).toEqual(['same bytes\n', 'same bytes\n']);
    });

    it('refuses a save whose folder is swapped for a link between the daemon’s check and its open (S2)', async () => {
      await transcriptOf(A, [said(link(far()))]);
      const files = outsideService();
      const read = await shown(files, A, far());
      let swapped = false;
      points['before-open'] = () => {
        swapToLink(at('far', 'dir'), at('twin'));
        swapped = true;
      };
      await expect(files.writeOutside({ appSessionId: A, path: far(), content: 'pwned\n', expectedHash: read.hash!, real: read.outside?.real ?? '' })).rejects.toThrow(new Error(OUT));
      expect(swapped, 'the swap ran between the check and the open').toBe(true);
      bothUnchanged();
    });

    it('refuses with FILES_MOVED a save whose folder was swapped between the read and the save, and saves once it is back (S3)', async () => {
      await transcriptOf(A, [said(link(far()))]);
      const files = outsideService();
      const read = await shown(files, A, far());
      expect(read.outside?.real).toBe(far());
      swapToLink(at('far', 'dir'), at('twin'));
      const save = () => files.writeOutside({ appSessionId: A, path: far(), content: 'saved\n', expectedHash: read.hash!, real: read.outside?.real ?? '' });
      await expect(save()).rejects.toThrow(new Error(FILES_MOVED));
      bothUnchanged();
      restore(at('far', 'dir'));
      expect(await save()).toEqual({ status: 'ok', hash: sha('saved\n') });
      expect(readFileSync(far(), 'utf8')).toBe('saved\n');
    });

    it('refuses with the refusal a chosen file whose folder was swapped, saying nothing of where the path leads (S3)', async () => {
      const files = outsideService();
      await files.grant(A, far());
      const read = await shown(files, A, far());
      swapToLink(at('far', 'dir'), at('twin'));
      await expect(files.writeOutside({ appSessionId: A, path: far(), content: 'pwned\n', expectedHash: read.hash!, real: read.outside?.real ?? '' })).rejects.toThrow(new Error(OUT));
      bothUnchanged();
    });

    it('refuses a save whose client ends while the transcript is asked, writing nothing (S4)', async () => {
      const named = vi.fn((_appSessionId: AppSessionId, _path: string, signal?: AbortSignal) => new Promise<false>((resolve) => signal!.addEventListener('abort', () => resolve(false))));
      const files = outsideService({ named });
      const ended = new AbortController();
      const answer = files.writeOutside({ appSessionId: A, path: far(), content: 'pwned\n', expectedHash: sha('same bytes\n'), real: far() }, undefined, ended.signal);
      await vi.waitFor(() => expect(named).toHaveBeenCalledOnce());
      ended.abort();
      await expect(answer).rejects.toThrow(new Error(OUT));
      expect(readFileSync(far(), 'utf8')).toBe('same bytes\n');
    });

    // Review finding 2: the client's end refuses the save at every step after the search, the grant asked again included
    it('refuses a save whose client ends while the transcript is asked, though a grant is made meanwhile (S4, the second grant lookup)', async () => {
      await transcriptOf(A, [said('nothing linked')]);
      const files = outsideService();
      const ended = new AbortController();
      let reached!: () => void;
      let release!: () => void;
      const searching = new Promise<void>((resolve) => (reached = resolve));
      const held = new Promise<void>((resolve) => (release = resolve));
      points['before-named'] = async () => {
        reached();
        await held;
      };
      const answer = files.writeOutside({ appSessionId: A, path: far(), content: 'pwned\n', expectedHash: sha('same bytes\n'), real: far() }, undefined, ended.signal);
      await searching;
      expect(await files.grant(A, far())).toEqual({ status: 'granted', path: far() });
      ended.abort();
      release();
      await expect(answer).rejects.toThrow(new Error(OUT));
      expect(readFileSync(far(), 'utf8')).toBe('same bytes\n');
    });

    it('refuses a save whose client ends after the file is opened, before its section writes (S4)', async () => {
      const files = outsideService();
      await files.grant(A, far());
      const ended = new AbortController();
      points['after-open'] = () => ended.abort();
      await expect(files.writeOutside({ appSessionId: A, path: far(), content: 'pwned\n', expectedHash: sha('same bytes\n'), real: far() }, undefined, ended.signal)).rejects.toThrow(new Error(OUT));
      expect(readFileSync(far(), 'utf8')).toBe('same bytes\n');
    });

    it('serialises two saves of one outside file from two sessions: one ok, one conflict, the file the first one’s (S5)', async () => {
      records.set(B, record(root));
      await transcriptOf(A, [said(link(far()))]);
      const files = outsideService();
      await files.grant(B, far());
      let late: Promise<FilesWriteOutput> | undefined;
      points['after-open'] = async () => {
        let opened!: () => void;
        const second = new Promise<void>((resolve) => (opened = resolve));
        points['after-open'] = () => opened();
        late = files.writeOutside({ appSessionId: B, path: far(), content: 'two\n', expectedHash: sha('same bytes\n'), real: far() });
        await second;
      };
      const early = await files.writeOutside({ appSessionId: A, path: far(), content: 'one\n', expectedHash: sha('same bytes\n'), real: far() });
      const both = [early, await late!];
      expect(both.map((answer) => answer.status).sort()).toEqual(['conflict', 'ok']);
      const won = both.find((answer) => answer.status === 'ok')!;
      expect(readFileSync(far(), 'utf8')).toBe(won.hash === sha('one\n') ? 'one\n' : 'two\n');
    });

    it('asks the grant again after the transcript answered no: a grant made while it was searched admits the read (S6)', async () => {
      await transcriptOf(A, [said('nothing linked')]);
      const files = outsideService();
      points['before-named'] = async () => {
        expect(grants.has(A, far())).toBe(false); // the first ask of the grant missed
        await files.grant(A, far());
      };
      expect(await shown(files, A, far())).toMatchObject({ content: 'same bytes\n', named: true, outside: { real: far(), writable: true } });
    });
  });

  // UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, M1): the same rule for a
  // request from another machine under the claim `machine.op` made for one of the four outside acts, read by this
  // machine's daemon over its own evidence; below that claim, the pin's answers. The other machine's home is a folder of
  // this suite and its private folders are macOS's by the platform handed in, so no case reads a real one.
  describe('files from another machine', () => {
    const member = 'member-of-the-suite';
    const device = 'device-of-the-suite';
    const claimed = (opId = 'op-1') => ({ remote: true as const, claim: { member, device, opId } });
    const asker = endableClientRef('page:9.1');
    const unclaimed = { client: asker, remote: true as const };
    const claimedContext = (opId = 'op-1') => ({ ...unclaimed, op: { opId, opCreated: '2026-11-15T09:00:00.000Z', member, device, fingerprint: 'a'.repeat(64) } });
    const refused = { ok: false, error: { code: 'internal', message: OUT } };
    const protectedRefusal = { message: FILES_PROTECTED, ipcError: { code: 'internal', message: FILES_PROTECTED, issues: { refusal: 'protected' } } };
    let home: string;
    let logLines: string[];
    let recordsAsked: number;
    const inHome = (...parts: string[]) => join(home, ...parts);
    const secret = () => inHome('Documents', 'private.txt');
    // The service as the other machine's daemon composes it: U6e's, with the daemon user's home, macOS, and its log
    const remoteOptions = (extra: Partial<FilesServiceOptions> = {}) => outsideOptions({ home: () => home, platform: 'darwin', homes: () => [home], outsideLog: (line) => logLines.push(line), ...extra });
    const remoteService = (extra: Partial<FilesServiceOptions> = {}) => service(remoteOptions(extra));
    // The same behind its handlers, which the endpoint's dispatch reaches with `remote` and `machine.op` with its claim too
    function remoteHandlers(extra: Partial<FilesServiceOptions> = {}) {
      const bus = fakeBus();
      const files = registerFilesHandlers((id) => ((recordsAsked += 1), records.get(id) ?? null), {
        bus,
        emit: () => {},
        port: { openExternal: async () => ({ opened: true }), reveal: async () => ({ revealed: true }) },
        ...remoteOptions(extra),
      });
      services.push(files);
      return bus;
    }
    // The open of files.readOutside (the keyed read, the hash asked) and the save of what it showed, each under a claim
    const readThere = (files: Files, appSessionId: AppSessionId, path: string, opId = 'op-read', extra: object = {}) => files.read({ appSessionId, path, named: true, hash: true, ...extra }, claimed(opId));
    async function saveThere(files: Files, appSessionId: AppSessionId, path: string, content: string, opId = 'op-save', extra: object = {}) {
      const read = await readThere(files, appSessionId, path, `${opId}-read`, extra);
      return files.writeOutside({ appSessionId, path, content, expectedHash: read.hash!, real: read.outside?.real ?? path, ...extra }, claimed(opId));
    }
    const choose = (files: Files, path: string, opId = 'op-choose', extra: object = {}) => files.chooseOutside({ appSessionId: A, path, ...extra }, claimed(opId));
    const list = (files: Files, input: { path?: string; open?: true; cursor?: string } = {}, appSessionId: AppSessionId = A) => files.listOutside({ appSessionId, ...input }, claimed('op-list'));
    const names = (answer: { status: string; entries?: { name: string }[] }) => (answer.entries ?? []).map((entry) => entry.name);
    const nothingTouchedIn = (seen: readonly string[], folder: string) => expect(inside(seen, folder), `nothing inside ${folder} is touched`).toEqual([]);

    beforeEach(() => {
      home = at('home');
      logLines = [];
      recordsAsked = 0;
      write(inHome('notes.txt'), 'notes in the home\n');
      write(secret(), 'private as it was\n');
      write(inHome('Documents', 'deep', 'more.txt'), 'more as it was\n');
      mkdirSync(inHome('Desktop'));
      mkdirSync(inHome('projects', 'garden'), { recursive: true });
    });

    describe('the claimed caller', () => {
      it('reads a named, a chosen and a sent file writable and saves each: the bytes on disk the content sent', async () => {
        await transcriptOf(A, [said(link(out('named.txt')))]);
        index.library.reconcile({ artifacts: [artifact(1, out('sent.txt'), { kind: 'session', appSessionId: A })], links: [linked(1, A)], spaces: [] });
        const files = remoteService();
        expect(await choose(files, out('chosen.txt'))).toEqual({ status: 'granted', path: out('chosen.txt') });
        for (const name of ['named.txt', 'chosen.txt', 'sent.txt']) {
          expect(await readThere(files, A, out(name)), name).toMatchObject({ content: `${name} as it was\n`, named: true, outside: { real: out(name), writable: true } });
          expect(await saveThere(files, A, out(name), `${name} saved\n`), name).toEqual({ status: 'ok', hash: sha(`${name} saved\n`) });
          expect(readFileSync(out(name), 'utf8'), name).toBe(`${name} saved\n`);
        }
        expect(readFileSync(out('unnamed.txt'), 'utf8')).toBe('unnamed.txt as it was\n');
      });

      it('reads a file only a tool’s result names and one only an added record admits read-only, and refuses their save', async () => {
        await transcriptOf(A, [called('t-mcp', 'mcp__docs__find', { query: 'notes' }), answered('t-mcp', link(out('result.txt')))]);
        index.library.reconcile({ artifacts: [artifact(2, out('added.txt'), { kind: 'human' })], links: [linked(2, A)], spaces: [] });
        const files = remoteService();
        for (const [name, why] of [['result.txt', 'result'], ['added.txt', 'added']] as const) {
          const read = await readThere(files, A, out(name));
          expect(read, name).toMatchObject({ content: `${name} as it was\n`, named: true, outside: { real: out(name), writable: false, why } });
          await expect(files.writeOutside({ appSessionId: A, path: out(name), content: 'pwned\n', expectedHash: read.hash!, real: out(name) }, claimed()), name).rejects.toThrow(new Error(OUT));
          expect(readFileSync(out(name), 'utf8'), name).toBe(`${name} as it was\n`);
        }
      });

      it('reads a file inside the remote roots unmarked and saves it by files.writeOutside with the real path compared, asking no evidence', async () => {
        const files = remoteService();
        const path = inRoot('README.md');
        const read = await readThere(files, A, path);
        expect(read).toMatchObject({ content: '# readme\n' });
        expect(read).not.toHaveProperty('outside');
        expect(await files.writeOutside({ appSessionId: A, path, content: '# saved\n', expectedHash: read.hash!, real: path }, claimed())).toEqual({ status: 'ok', hash: sha('# saved\n') });
        expect(readFileSync(path, 'utf8')).toBe('# saved\n');
        await expect(files.writeOutside({ appSessionId: A, path, content: 'x', expectedHash: sha('# saved\n'), real: inRoot('src', 'a.ts') }, claimed())).rejects.toThrow(new Error(FILES_MOVED));
        expect(readFileSync(path, 'utf8')).toBe('# saved\n');
        nothingAsked();
      });

      it('answers a raw read asked with a claim with the plain read', async () => {
        const files = remoteService();
        const plain = await files.read({ appSessionId: A, path: inRoot('README.md') }, claimed());
        const raw = await files.read({ appSessionId: A, path: inRoot('README.md'), raw: true }, claimed());
        expect(raw).toStrictEqual(plain);
        expect(raw).not.toHaveProperty('identity');
      });

      it('saves after the daemon restarts between the read and the save, on the evidence it reads then (R6)', async () => {
        await transcriptOf(A, [said(link(out('named.txt')))]);
        await choose(remoteService(), out('chosen.txt'));
        const named = await readThere(remoteService(), A, out('named.txt'));
        const chosen = await readThere(remoteService(), A, out('chosen.txt'));
        grants = openGrants(); // the daemon restarts: the grants are a file, the transcript is a file
        const restarted = remoteService();
        for (const [name, read] of [['named.txt', named], ['chosen.txt', chosen]] as const) {
          expect(await restarted.writeOutside({ appSessionId: A, path: out(name), content: 'after a restart\n', expectedHash: read.hash!, real: read.outside!.real }, claimed()), name).toEqual({ status: 'ok', hash: sha('after a restart\n') });
          expect(readFileSync(out(name), 'utf8'), name).toBe('after a restart\n');
        }
      });

      it('refuses the save once the transcript no longer names the file, and saves it after a choice of the same file (R7)', async () => {
        await transcriptOf(A, [said(link(out('named.txt')))]);
        const files = remoteService();
        const read = await readThere(files, A, out('named.txt'));
        await transcriptOf(A, [said('the conversation was cleared')]);
        const save = () => files.writeOutside({ appSessionId: A, path: out('named.txt'), content: 'saved\n', expectedHash: read.hash!, real: read.outside!.real }, claimed());
        await expect(save()).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out('named.txt'), 'utf8')).toBe('named.txt as it was\n');
        expect(await choose(files, out('named.txt'))).toEqual({ status: 'granted', path: out('named.txt') });
        expect(await save()).toEqual({ status: 'ok', hash: sha('saved\n') });
      });

      it('refuses a claimed read and save whose last component becomes a link, or whose folder is swapped, between the check and the open (R2: S1, S2)', async () => {
        write(at('far', 'dir', 'notes.txt'), 'same bytes\n');
        write(at('twin', 'notes.txt'), 'same bytes\n');
        const far = at('far', 'dir', 'notes.txt');
        await transcriptOf(A, [said(link(far))]);
        const files = remoteService();
        const read = await readThere(files, A, far);
        const swaps: [string, () => void, () => void][] = [
          ['the last component', () => (renameSync(far, `${far}.away`), symlinkSync(at('twin', 'notes.txt'), far)), () => (unlinkSync(far), renameSync(`${far}.away`, far))],
          ['the folder', () => swapToLink(at('far', 'dir'), at('twin')), () => restore(at('far', 'dir'))],
        ];
        for (const [what, swap, back] of swaps) {
          points['before-open'] = swap;
          await expect(readThere(files, A, far), what).rejects.toThrow(new Error(OUT));
          back();
          points['before-open'] = swap;
          await expect(files.writeOutside({ appSessionId: A, path: far, content: 'pwned\n', expectedHash: read.hash!, real: read.outside!.real }, claimed()), what).rejects.toThrow(new Error(OUT));
          back();
          expect([readFileSync(far, 'utf8'), readFileSync(at('twin', 'notes.txt'), 'utf8')], what).toEqual(['same bytes\n', 'same bytes\n']);
        }
      });
    });

    describe('the four acts behind their handlers', () => {
      it('refuses each of the four without a claim, and the listing and the choice to this machine’s own client, asking nothing and resolving no session', async () => {
        await transcriptOf(A, [said(link(out('named.txt')))]);
        index.library.reconcile({ artifacts: [artifact(1, out('sent.txt'), { kind: 'session', appSessionId: A })], links: [linked(1, A)], spaces: [] });
        grants.add(A, out('chosen.txt'));
        const bus = remoteHandlers();
        const save = (path: string, before: string) => ({ appSessionId: A, path, content: 'pwned\n', expectedHash: sha(before), real: path });
        for (const name of ['named.txt', 'chosen.txt', 'sent.txt', 'unnamed.txt']) expect(await bus.invoke('files.readOutside', { appSessionId: A, path: out(name) }, unclaimed), name).toEqual(refused);
        expect(await bus.invoke('files.readOutside', { appSessionId: A, path: inRoot('README.md') }, unclaimed)).toEqual(refused);
        expect(await bus.invoke('files.writeOutside', save(out('named.txt'), 'named.txt as it was\n'), unclaimed)).toEqual(refused);
        expect(await bus.invoke('files.writeOutside', save(inRoot('README.md'), '# readme\n'), unclaimed)).toEqual(refused);
        expect(await bus.invoke('files.listOutside', { appSessionId: A }, unclaimed)).toEqual(refused);
        expect(await bus.invoke('files.chooseOutside', { appSessionId: A, path: out('unnamed.txt') }, unclaimed)).toEqual(refused);
        // this machine's own client: its chooser is the system's, so the daemon lists and chooses nothing for it
        expect(await bus.invoke('files.listOutside', { appSessionId: A }, asker)).toEqual(refused);
        expect(await bus.invoke('files.chooseOutside', { appSessionId: A, path: out('unnamed.txt') }, asker)).toEqual(refused);
        expect([readFileSync(out('named.txt'), 'utf8'), readFileSync(inRoot('README.md'), 'utf8')]).toEqual(['named.txt as it was\n', '# readme\n']);
        expect(grants.has(A, out('unnamed.txt'))).toBe(false);
        nothingAsked();
        expect(recordsAsked, 'no session is resolved, so no root is computed').toBe(0);
        expect(logLines).toEqual([]);
      });

      it('answers files.readOutside and files.writeOutside under the claim machine.op passes, and logs the claim’s member', async () => {
        await transcriptOf(A, [said(link(out('named.txt')))]);
        const bus = remoteHandlers();
        const read = await bus.invoke('files.readOutside', { appSessionId: A, path: out('named.txt'), hash: true }, claimedContext('op-read'));
        expect(read).toMatchObject({ ok: true, value: { content: 'named.txt as it was\n', named: true, outside: { real: out('named.txt'), writable: true } } });
        const save = { appSessionId: A, path: out('named.txt'), content: 'saved there\n', expectedHash: sha('named.txt as it was\n'), real: out('named.txt') };
        expect(await bus.invoke('files.writeOutside', save, claimedContext('op-save'))).toEqual({ ok: true, value: { status: 'ok', hash: sha('saved there\n') } });
        expect(readFileSync(out('named.txt'), 'utf8')).toBe('saved there\n');
        expect(logLines).toEqual([`outside write: member ${member} device ${device} session ${A} op op-save: ok 12 bytes ${out('named.txt')}`]);
      });

      it('lists through files.listOutside under the claim machine.op passes, the folder’s real entries', async () => {
        const folder = at('listing');
        mkdirSync(join(folder, 'inner'), { recursive: true });
        write(join(folder, 'a.txt'), '');
        const bus = remoteHandlers();
        expect(await bus.invoke('files.listOutside', { appSessionId: A, path: folder }, claimedContext('op-list'))).toEqual({
          ok: true,
          value: {
            status: 'listed',
            path: folder,
            parent: base,
            home,
            entries: [
              { name: 'inner', path: join(folder, 'inner'), kind: 'dir', protected: false },
              { name: 'a.txt', path: join(folder, 'a.txt'), kind: 'file', protected: false },
            ],
            cursor: null,
          },
        });
      });

      it('holds each input to its schema: no raw, no key beyond it, and nothing in a choice that could name a grant’s content', async () => {
        await transcriptOf(A, [said(link(out('named.txt')))]);
        const bus = remoteHandlers();
        const malformed = { ok: false, error: { code: 'invalid_input' } };
        for (const input of [{ raw: true }, { named: true }, { real: out('named.txt') }]) expect(await bus.invoke('files.readOutside', { appSessionId: A, path: out('named.txt'), ...input }, claimedContext()), JSON.stringify(input)).toMatchObject(malformed);
        for (const input of [{ real: out('unnamed.txt') }, { at: 1 }, { session: B }]) expect(await bus.invoke('files.chooseOutside', { appSessionId: A, path: out('unnamed.txt'), ...input }, claimedContext()), JSON.stringify(input)).toMatchObject(malformed);
        expect(await bus.invoke('files.listOutside', { appSessionId: A, entries: [] }, claimedContext())).toMatchObject(malformed);
        expect(grants.has(A, out('unnamed.txt'))).toBe(false);
        expect(logLines).toEqual([]);
      });

      it('chooses through files.chooseOutside, the grants file on this machine holding the real path, and refuses files.grant from another machine even under a claim', async () => {
        symlinkSync(out('chosen.txt'), out('alias.txt'));
        const bus = remoteHandlers();
        expect(await bus.invoke('files.chooseOutside', { appSessionId: A, path: out('alias.txt') }, claimedContext('op-choose'))).toEqual({ ok: true, value: { status: 'granted', path: out('chosen.txt') } });
        expect((JSON.parse(readFileSync(grantsFile, 'utf8')) as { sessions: Record<string, { real: string }[]> }).sessions[A]!.map((entry) => entry.real)).toEqual([out('chosen.txt')]);
        expect(await bus.main('files.grant', { appSessionId: A, path: out('unnamed.txt') }, claimedContext('op-grant'))).toEqual(refused);
        expect(await bus.main('files.grant', { appSessionId: A, path: out('unnamed.txt') }, unclaimed)).toEqual(refused);
        expect(grants.has(A, out('unnamed.txt'))).toBe(false);
        expect(logLines).toEqual([`outside choice: member ${member} device ${device} session ${A} op op-choose: granted ${out('chosen.txt')}`]);
      });
    });

    // Condition (c): P5's Decision Log 237 stands for every request no claimed act carries, and a claim changes nothing
    // outside the four names
    describe('below the terminal’s grade, to the byte', () => {
      it('answers files.list, files.read, files.watch and files.write for a chat rooted at the home and one in a project what the pin answers, with a claim or without, asking no evidence', async () => {
        const HOME_CHAT = 'home-chat' as AppSessionId;
        records.set(HOME_CHAT, record(home));
        for (const id of [HOME_CHAT, A]) {
          await transcriptOf(id, [said(link(inHome('notes.txt')))]);
          grants.add(id, inHome('notes.txt'));
        }
        const bus = remoteHandlers();
        const answers = async (appSessionId: AppSessionId, context: typeof unclaimed) => ({
          roots: await bus.invoke('files.list', { appSessionId }, context),
          home: await bus.invoke('files.list', { appSessionId, path: home }, context),
          folder: await bus.invoke('files.list', { appSessionId, path: inHome('projects') }, context),
          notes: await bus.invoke('files.read', { appSessionId, path: inHome('notes.txt') }, context),
          readme: await bus.invoke('files.read', { appSessionId, path: inRoot('README.md') }, context),
          watch: await bus.invoke('files.watch', { appSessionId, path: home }, context),
          write: await bus.invoke('files.write', { appSessionId, path: inHome('notes.txt'), content: 'pwned\n', expectedHash: sha('notes in the home\n') }, context),
        });
        const atHome = await answers(HOME_CHAT, unclaimed);
        expect(atHome).toEqual({ roots: refused, home: refused, folder: refused, notes: refused, readme: refused, watch: refused, write: refused });
        expect(await answers(HOME_CHAT, claimedContext())).toEqual(atHome);
        const inProject = await answers(A, unclaimed);
        expect(inProject).toMatchObject({ roots: { ok: true, value: { entries: [{ path: root }] } }, home: refused, folder: refused, notes: refused, readme: { ok: true, value: { content: '# readme\n' } }, watch: refused, write: refused });
        expect(await answers(A, claimedContext())).toEqual(inProject);
        expect(readFileSync(inHome('notes.txt'), 'utf8')).toBe('notes in the home\n');
        // a read outside the roots asks the Library's delivered files, as at the pin; nothing else is asked
        expect({ transcript: asked.transcript, grants: asked.grants, sent: asked.sent }).toEqual({ transcript: [], grants: 0, sent: 0 });
        expect(logLines).toEqual([]);
      });

      it('marks a delivered file read with the key and no claim added and read-only, its bytes those read without the key, and refuses one only the transcript or a grant admits (decision 9)', async () => {
        index.library.reconcile({ artifacts: [artifact(1, out('added.txt'), { kind: 'human' }), artifact(2, out('sent.txt'), { kind: 'session', appSessionId: A })], links: [linked(1, A), linked(2, A)], spaces: [] });
        await transcriptOf(A, [said(link(out('named.txt')))]);
        grants.add(A, out('chosen.txt'));
        const bus = remoteHandlers();
        for (const name of ['added.txt', 'sent.txt']) {
          const without = (await bus.invoke('files.read', { appSessionId: A, path: out(name), hash: true }, unclaimed)) as { ok: true; value: object };
          expect(without, name).toMatchObject({ ok: true, value: { content: `${name} as it was\n` } });
          expect(without.value, name).not.toHaveProperty('outside');
          expect(await bus.invoke('files.read', { appSessionId: A, path: out(name), hash: true, named: true }, unclaimed), name).toEqual({ ok: true, value: { ...without.value, named: true, outside: { real: out(name), writable: false, why: 'added' } } });
        }
        for (const name of ['named.txt', 'chosen.txt']) expect(await bus.invoke('files.read', { appSessionId: A, path: out(name), named: true }, unclaimed), name).toEqual(refused);
        expect({ transcript: asked.transcript, grants: asked.grants, sent: asked.sent }).toEqual({ transcript: [], grants: 0, sent: 0 });
      });
    });

    describe('the listing', () => {
      it('lists one folder outside the home: folders first, dot names after the others of their kind, case aside, a link as a link', async () => {
        const folder = at('listing');
        for (const name of ['beta', 'Alpha', '.hidden-dir']) mkdirSync(join(folder, name), { recursive: true });
        for (const name of ['b.txt', 'A.txt', '.zshrc', 'c.md']) write(join(folder, name), '');
        symlinkSync(out('named.txt'), join(folder, 'latest'));
        execFileSync('mkfifo', [join(folder, 'pipe')]);
        const entry = (name: string, kind: string) => ({ name, path: join(folder, name), kind, protected: false });
        expect(await list(remoteService(), { path: folder })).toEqual({
          status: 'listed',
          path: folder,
          parent: base,
          home,
          entries: [entry('Alpha', 'dir'), entry('beta', 'dir'), entry('.hidden-dir', 'dir'), entry('A.txt', 'file'), entry('b.txt', 'file'), entry('c.md', 'file'), entry('latest', 'link'), entry('pipe', 'other'), entry('.zshrc', 'file')],
          cursor: null,
        });
      });

      it('answers one page of 200 with the cursor of the next, the dot names of a kind after its last page’s others', async () => {
        expect(OUTSIDE_LIST_PAGE).toBe(200);
        const folder = at('many');
        for (const name of ['d1', 'd2', 'd3']) mkdirSync(join(folder, name), { recursive: true });
        const fileNames = Array.from({ length: 205 }, (_, i) => `f-${String(i).padStart(3, '0')}.txt`);
        for (const name of [...fileNames, '.dot.txt']) write(join(folder, name), '');
        const files = remoteService();
        const first = await list(files, { path: folder });
        expect(names(first)).toEqual(['d1', 'd2', 'd3', ...fileNames.slice(0, 197)]);
        expect(first).toMatchObject({ status: 'listed', cursor: 'f-196.txt' });
        const second = await list(files, { path: folder, cursor: 'f-196.txt' });
        expect(names(second)).toEqual([...fileNames.slice(197), '.dot.txt']);
        expect(second).toMatchObject({ status: 'listed', cursor: null });
      });

      it('lists the home when no path is asked, `~` and `~/…` under it, the private folders marked, and the filesystem’s root', async () => {
        const files = remoteService();
        const answer = await list(files);
        expect(answer).toEqual({
          status: 'listed',
          path: home,
          parent: base,
          home,
          entries: [
            { name: 'Desktop', path: inHome('Desktop'), kind: 'dir', protected: true },
            { name: 'Documents', path: inHome('Documents'), kind: 'dir', protected: true },
            { name: 'projects', path: inHome('projects'), kind: 'dir', protected: false },
            { name: 'notes.txt', path: inHome('notes.txt'), kind: 'file', protected: false },
          ],
          cursor: null,
        });
        expect(await list(files, { path: '~' })).toEqual(answer);
        expect(await list(files, { path: '~/projects' })).toMatchObject({ status: 'listed', path: inHome('projects'), parent: home, entries: [{ name: 'garden', kind: 'dir' }] });
        const top = await list(files, { path: sep });
        expect(top).toMatchObject({ status: 'listed', path: sep, parent: null, home });
        expect((top as { entries: { name: string; kind: string }[] }).entries).toContainEqual(expect.objectContaining({ name: base.split(sep)[1], kind: 'dir' }));
      });

      it('takes each entry’s kind from its directory entry alone: no entry is stat’ed, read or followed', async () => {
        const folder = at('listing');
        mkdirSync(join(folder, 'dir'), { recursive: true });
        write(join(folder, 'file.txt'), 'x');
        symlinkSync(out('named.txt'), join(folder, 'latest'));
        const seen = recordTouches();
        expect(names(await list(remoteService(), { path: folder }))).toEqual(['dir', 'file.txt', 'latest']);
        expect(seen.filter((entry) => ['dir', 'file.txt', 'latest'].some((name) => entry.endsWith(join(folder, name)) || entry.includes(`${join(folder, name)}${sep}`)))).toEqual([]);
      });

      it('refuses inside a private folder without open, touching nothing in it, and lists it with open', async () => {
        const files = remoteService();
        const seen = recordTouches();
        for (const path of [inHome('Documents'), '~/Documents/deep']) expect(await list(files, { path }), path).toEqual({ status: 'refused', reason: 'protected' });
        nothingTouchedIn(seen, inHome('Documents'));
        expect(names(await list(files, { path: '~/Documents', open: true }))).toEqual(['deep', 'private.txt']);
        expect(names(await list(files, { path: '~/Documents/deep', open: true }))).toEqual(['more.txt']);
      });

      it('refuses a link from outside the home into a private folder the same way, and with open lists where it leads', async () => {
        symlinkSync(inHome('Documents'), at('to-documents'));
        const files = remoteService();
        const seen = recordTouches();
        expect(await list(files, { path: at('to-documents') })).toEqual({ status: 'refused', reason: 'protected' });
        nothingTouchedIn(seen, inHome('Documents'));
        expect(await list(files, { path: at('to-documents'), open: true })).toMatchObject({ status: 'listed', path: inHome('Documents'), entries: [{ name: 'deep' }, { name: 'private.txt' }] });
      });

      it('refuses a folder reached through a link on the way into a private folder even with open, touching nothing inside it', async () => {
        symlinkSync(inHome('Documents'), at('to-documents'));
        const files = remoteService();
        const seen = recordTouches();
        for (const open of [undefined, true] as const) expect(await list(files, { path: join(at('to-documents'), 'deep'), ...(open && { open }) }), `open ${open}`).toEqual({ status: 'refused', reason: 'protected' });
        nothingTouchedIn(seen, inHome('Documents'));
      });

      it('answers unreadable for a folder it cannot read, not-a-folder for a file, no-folder for a missing or relative path, and an unknown session', async () => {
        write(at('locked', 'inside.txt'), 'x');
        const files = remoteService();
        chmodSync(at('locked'), 0o000);
        try {
          expect(await list(files, { path: at('locked') })).toEqual({ status: 'refused', reason: 'unreadable' });
        } finally {
          chmodSync(at('locked'), 0o700);
        }
        expect(await list(files, { path: out('named.txt') })).toEqual({ status: 'refused', reason: 'not-a-folder' });
        for (const path of [at('missing'), at('missing', 'deeper'), 'relative/path']) expect(await list(files, { path }), path).toEqual({ status: 'refused', reason: 'no-folder' });
        await expect(list(files, {}, 'nope' as AppSessionId)).rejects.toThrow('unknown app session: nope');
      });

      it('marks and guards no folder as private on a platform that is not macOS', async () => {
        const files = remoteService({ platform: 'linux' });
        expect(names(await list(files, { path: '~/Documents' }))).toEqual(['deep', 'private.txt']);
        expect((await list(files)) as { entries: { protected: boolean }[] }).toMatchObject({ entries: [{ protected: false }, { protected: false }, { protected: false }, { protected: false }] });
      });
    });

    describe('the choice', () => {
      it('grants a regular file by its real path and a link as its target, and refuses a directory, a package and a special file', async () => {
        mkdirSync(out('folder'));
        mkdirSync(out('Tool.app', 'Contents'), { recursive: true });
        execFileSync('mkfifo', [out('pipe')]);
        symlinkSync(out('chosen.txt'), out('alias.txt'));
        const files = remoteService();
        expect(await choose(files, out('alias.txt'))).toEqual({ status: 'granted', path: out('chosen.txt') });
        expect(grants.has(A, out('chosen.txt'))).toBe(true);
        expect(grants.has(A, out('alias.txt'))).toBe(false);
        for (const path of [out('folder'), out('Tool.app'), out('pipe')]) {
          expect(await choose(files, path), path).toEqual({ status: 'refused', reason: 'not-a-file' });
          expect(grants.has(A, path), path).toBe(false);
        }
        expect(await choose(files, '~/notes.txt')).toEqual({ status: 'granted', path: inHome('notes.txt') });
      });

      it('refuses a missing path no-file and a choice for a session this machine does not know', async () => {
        const files = remoteService();
        for (const path of [out('never.txt'), at('missing', 'never.txt')]) expect(await choose(files, path), path).toEqual({ status: 'refused', reason: 'no-file' });
        await expect(files.chooseOutside({ appSessionId: 'nope' as AppSessionId, path: out('chosen.txt') }, claimed())).rejects.toThrow('unknown app session: nope');
        expect(grants.has('nope' as AppSessionId, out('chosen.txt'))).toBe(false);
      });

      it('refuses a path in a private folder and a last link whose target lies in one without open, touching nothing inside it; with open grants the target’s real path', async () => {
        symlinkSync(secret(), out('to-private'));
        const files = remoteService();
        const seen = recordTouches();
        for (const path of [secret(), out('to-private')]) expect(await choose(files, path), path).toEqual({ status: 'refused', reason: 'protected' });
        nothingTouchedIn(seen, inHome('Documents'));
        expect(grants.has(A, secret())).toBe(false);
        expect(await choose(files, out('to-private'), 'op-choose', { open: true })).toEqual({ status: 'granted', path: secret() });
        expect(grants.has(A, secret())).toBe(true);
      });

      it('drops the oldest grant of a session at its 257th choice (U6e’s bound, reached from another machine)', async () => {
        const many = Array.from({ length: 257 }, (_, i) => at('many', `chosen-${i}.txt`));
        for (const path of many) write(path, 'x');
        const files = remoteService();
        for (const path of many) expect(await choose(files, path), path).toMatchObject({ status: 'granted' });
        expect([grants.has(A, many[0]!), grants.has(A, many[1]!), grants.has(A, many[256]!)]).toEqual([false, true, true]);
      }, 20_000); // 257 choices, each a walk and a grants file written: about 4.5 s on the build VM, near the default 5 s
    });

    // Decision 10: the other machine's own record of each save and each choice made from another machine
    describe('the log', () => {
      it('writes one line per ending of a claimed save and choice, with the claim’s member, device and operation id, and never the content', async () => {
        write(out('readonly.txt'), 'read-only as it was\n');
        chmodSync(out('readonly.txt'), 0o444);
        mkdirSync(out('folder'));
        const settings = join(profile, 'settings.json');
        await transcriptOf(A, [said(link(out('named.txt'))), said(link(out('gone.txt'))), said(link(out('readonly.txt'))), said(link(settings))]);
        const files = remoteService();
        const read = await readThere(files, A, out('named.txt'));
        const save = (appSessionId: AppSessionId, path: string, opId: string, extra: object = {}) =>
          files.writeOutside({ appSessionId, path, content: 'the words typed\n', expectedHash: read.hash!, real: path, ...extra }, claimed(opId));
        expect(await save(A, out('named.txt'), 'op-save')).toEqual({ status: 'ok', hash: sha('the words typed\n') });
        expect(await save(A, out('named.txt'), 'op-conflict')).toEqual({ status: 'conflict', hash: sha('the words typed\n') });
        await expect(save(A, out('unnamed.txt'), 'op-outside')).rejects.toThrow(new Error(OUT));
        await expect(save(A, settings, 'op-own')).rejects.toThrow(new Error(`not writable: ${settings}`));
        await expect(save(A, out('named.txt'), 'op-moved', { real: out('elsewhere.txt') })).rejects.toThrow(new Error(FILES_MOVED));
        await expect(save(A, out('gone.txt'), 'op-missing')).rejects.toThrow(new Error(`not found: ${out('gone.txt')}`));
        await expect(save(A, out('readonly.txt'), 'op-locked')).rejects.toThrow(new Error(`not writable: ${out('readonly.txt')}`));
        await expect(save(A, secret(), 'op-private')).rejects.toMatchObject(protectedRefusal);
        expect(await choose(files, out('chosen.txt'), 'op-choose')).toMatchObject({ status: 'granted' });
        expect(await choose(files, out('folder'), 'op-folder')).toEqual({ status: 'refused', reason: 'not-a-file' });
        const by = (appSessionId: AppSessionId, opId: string) => `member ${member} device ${device} session ${appSessionId} op ${opId}`;
        expect(logLines).toEqual([
          `outside write: ${by(A, 'op-save')}: ok 16 bytes ${out('named.txt')}`,
          `outside write: ${by(A, 'op-conflict')}: conflict ${out('named.txt')}`,
          `outside write: ${by(A, 'op-outside')}: refused (outside) ${out('unnamed.txt')}`,
          `outside write: ${by(A, 'op-own')}: refused (own) ${settings}`,
          `outside write: ${by(A, 'op-moved')}: refused (moved) ${out('named.txt')}`,
          `outside write: ${by(A, 'op-missing')}: refused (missing) ${out('gone.txt')}`,
          `outside write: ${by(A, 'op-locked')}: refused (not-writable) ${out('readonly.txt')}`,
          `outside write: ${by(A, 'op-private')}: refused (protected) ${secret()}`,
          `outside choice: ${by(A, 'op-choose')}: granted ${out('chosen.txt')}`,
          `outside choice: ${by(A, 'op-folder')}: refused (not-a-file) ${out('folder')}`,
        ]);
        expect(logLines.join('\n')).not.toContain('the words typed');
      });

      it('escapes the control characters of a path in its line, so a name holding a line ending writes one line, and an ordinary path reads as it is', async () => {
        const fed = out('fed\noutside choice: member someone device elsewhere session S op forged: granted .txt');
        const returned = out('returned\r\u0001.txt');
        write(fed, 'fed as it was\n');
        write(returned, 'returned as it was\n');
        const files = remoteService();
        expect(await choose(files, fed, 'op-fed')).toEqual({ status: 'granted', path: fed });
        expect(await saveThere(files, A, fed, 'saved\n', 'op-save')).toEqual({ status: 'ok', hash: sha('saved\n') });
        await expect(files.writeOutside({ appSessionId: A, path: returned, content: 'pwned\n', expectedHash: sha('returned as it was\n'), real: returned }, claimed('op-returned'))).rejects.toThrow(new Error(OUT));
        expect(await choose(files, out('tab\there'), 'op-tab')).toEqual({ status: 'refused', reason: 'no-file' });
        expect(await choose(files, out('chosen.txt'), 'op-plain')).toEqual({ status: 'granted', path: out('chosen.txt') });
        const by = (opId: string) => `member ${member} device ${device} session ${A} op ${opId}`;
        const escapedFed = out('fed\\noutside choice: member someone device elsewhere session S op forged: granted .txt');
        expect(logLines).toEqual([
          `outside choice: ${by('op-fed')}: granted ${escapedFed}`,
          `outside write: ${by('op-save')}: ok 6 bytes ${escapedFed}`,
          `outside write: ${by('op-returned')}: refused (outside) ${out('returned\\r\\x01.txt')}`,
          `outside choice: ${by('op-tab')}: refused (no-file) ${out('tab\\x09here')}`,
          `outside choice: ${by('op-plain')}: granted ${out('chosen.txt')}`,
        ]);
        for (const line of logLines) expect(line, line).not.toMatch(/\p{Cc}/u);
      });

      it('writes none for a save on this machine, a read or a listing, and a log that throws changes no answer', async () => {
        await transcriptOf(A, [said(link(out('named.txt')))]);
        const files = remoteService();
        expect(await saveShown(files, A, out('named.txt'), 'saved here\n')).toEqual({ status: 'ok', hash: sha('saved here\n') });
        await readThere(files, A, out('named.txt'));
        await list(files, { path: outside });
        expect(logLines).toEqual([]);
        const failing = remoteService({
          outsideLog: () => {
            throw new Error('the log cannot be written');
          },
        });
        expect(await saveThere(failing, A, out('named.txt'), 'saved anyway\n')).toEqual({ status: 'ok', hash: sha('saved anyway\n') });
        expect(await choose(failing, out('chosen.txt'))).toEqual({ status: 'granted', path: out('chosen.txt') });
        await expect(saveThere(failing, A, out('unnamed.txt'), 'pwned\n')).rejects.toThrow(new Error(OUT));
      });
    });

    // The architect's ruling on the walk-to-use race (the cheap half): the step after the chooser's walk uses the real path
    // the walk ended at, and resolves nothing again from the path as typed. A link of the typed path is moved between the
    // walk and that step, so a step that resolved the typed path again would reach the link's new target
    describe('the walk’s real path, handed to the step after it', () => {
      const relink = (link: string, target: string) => () => {
        rmSync(link);
        symlinkSync(target, link);
        relinked.push(link);
      };
      let relinked: string[];
      beforeEach(() => {
        relinked = [];
      });

      it('grants the file the choice’s walk ended at', async () => {
        symlinkSync(out('chosen.txt'), out('pick'));
        const files = remoteService();
        points['after-outside-walk'] = relink(out('pick'), out('unnamed.txt'));
        expect(await choose(files, out('pick'))).toEqual({ status: 'granted', path: out('chosen.txt') });
        expect(relinked, 'the link moved between the walk and the grant').toEqual([out('pick')]);
        expect([grants.has(A, out('chosen.txt')), grants.has(A, out('unnamed.txt'))]).toEqual([true, false]);
      });

      it('lists the folder the listing’s walk ended at', async () => {
        write(at('first', 'one.txt'), '');
        write(at('second', 'two.txt'), '');
        symlinkSync(at('first'), at('shown'));
        points['after-outside-walk'] = relink(at('shown'), at('second'));
        expect(await list(remoteService(), { path: at('shown') })).toEqual({ status: 'listed', path: at('first'), parent: base, home, entries: [{ name: 'one.txt', path: at('first', 'one.txt'), kind: 'file', protected: false }], cursor: null });
        expect(relinked, 'the link moved between the walk and the listing').toEqual([at('shown')]);
      });

      // The architect's ruling on item 6 (b): U6e's step 4 resolves the typed path as before, and a claimed path whose walk
      // answered is refused FILES_MOVED where step 4's real path is not the walk's, before anything is opened
      it('refuses a claimed read and save FILES_MOVED where a link moved between the walk and the resolution, opening nothing; unmoved, each reads and saves', async () => {
        write(at('first', 'file.txt'), 'first as it was\n');
        write(at('second', 'file.txt'), 'second as it was\n');
        symlinkSync(at('first'), at('via'));
        const path = at('via', 'file.txt');
        for (const real of [at('first', 'file.txt'), at('second', 'file.txt')]) grants.add(A, real); // either is the session's to read and save
        const files = remoteService();
        // the read
        const seen = recordTouches();
        points['after-outside-walk'] = relink(at('via'), at('second'));
        await expect(readThere(files, A, path)).rejects.toThrow(new Error(FILES_MOVED));
        expect(relinked, 'the link moved between the walk and the resolution').toEqual([at('via')]);
        expect(seen.filter((entry) => entry.startsWith('open ')), 'nothing is opened past the refusal').toEqual([]);
        // the save of what an unmoved read showed
        touches.on = false;
        relink(at('via'), at('first'))();
        const read = await readThere(files, A, path);
        expect(read).toMatchObject({ content: 'first as it was\n', outside: { real: at('first', 'file.txt'), writable: true } });
        seen.length = 0;
        touches.on = true;
        points['after-outside-walk'] = relink(at('via'), at('second'));
        await expect(files.writeOutside({ appSessionId: A, path, content: 'pwned\n', expectedHash: read.hash!, real: read.outside!.real }, claimed('op-save'))).rejects.toThrow(new Error(FILES_MOVED));
        expect(seen.filter((entry) => entry.startsWith('open ')), 'nothing is opened past the refusal').toEqual([]);
        expect([readFileSync(at('first', 'file.txt'), 'utf8'), readFileSync(at('second', 'file.txt'), 'utf8')]).toEqual(['first as it was\n', 'second as it was\n']);
        // the control: no move, and the same read and save answer
        touches.on = false;
        relink(at('via'), at('first'))();
        expect(await readThere(files, A, path)).toMatchObject({ content: 'first as it was\n', outside: { real: at('first', 'file.txt'), writable: true } });
        expect(await saveThere(files, A, path, 'saved there\n')).toEqual({ status: 'ok', hash: sha('saved there\n') });
        expect([readFileSync(at('first', 'file.txt'), 'utf8'), readFileSync(at('second', 'file.txt'), 'utf8')]).toEqual(['saved there\n', 'second as it was\n']);
      });
    });

    // Decision 18: no act of another machine reads or writes inside a private folder of this one unasked
    describe('a private folder, for a read and a save', () => {
      it('refuses a claimed read and save of a named file in a private folder as protected, touching nothing inside it and asking no evidence; with open reads and writes it', async () => {
        await transcriptOf(A, [said(link(secret()))]);
        const files = remoteService();
        const seen = recordTouches();
        await expect(readThere(files, A, secret())).rejects.toMatchObject(protectedRefusal);
        await expect(files.writeOutside({ appSessionId: A, path: secret(), content: 'pwned\n', expectedHash: sha('private as it was\n'), real: secret() }, claimed())).rejects.toMatchObject(protectedRefusal);
        nothingTouchedIn(seen, inHome('Documents'));
        nothingAsked();
        touches.on = false;
        expect(await readThere(files, A, secret(), 'op-read', { open: true })).toMatchObject({ content: 'private as it was\n', named: true, outside: { real: secret(), writable: true } });
        expect(await saveThere(files, A, secret(), 'saved there\n', 'op-save', { open: true })).toEqual({ status: 'ok', hash: sha('saved there\n') });
        expect(readFileSync(secret(), 'utf8')).toBe('saved there\n');
      });

      it('answers protected for a link on the way, outside every private folder, that leads into one, with open or without, touching nothing inside it', async () => {
        symlinkSync(inHome('Documents'), at('docs-link'));
        const via = at('docs-link', 'private.txt');
        await transcriptOf(A, [said(link(via))]);
        const files = remoteService();
        const seen = recordTouches();
        await expect(readThere(files, A, via)).rejects.toMatchObject(protectedRefusal);
        await expect(files.writeOutside({ appSessionId: A, path: via, content: 'pwned\n', expectedHash: sha('private as it was\n'), real: secret() }, claimed())).rejects.toMatchObject(protectedRefusal);
        await expect(readThere(files, A, via, 'op-read', { open: true })).rejects.toMatchObject(protectedRefusal);
        await expect(files.writeOutside({ appSessionId: A, path: via, content: 'pwned\n', expectedHash: sha('private as it was\n'), real: secret(), open: true }, claimed())).rejects.toMatchObject(protectedRefusal);
        nothingTouchedIn(seen, inHome('Documents'));
        nothingAsked();
        expect(readFileSync(secret(), 'utf8')).toBe('private as it was\n');
      });

      // Decision 18 as ruled (Decision Log 17): `open: true` covers the private folders the path names and the target of a
      // link that is its last component, never a link met on the way into another one
      it('answers protected for a path under an opened private folder whose link on the way leads into a second one, with open or without, touching nothing inside the second', async () => {
        write(inHome('Desktop', 'far.txt'), 'far as it was\n');
        symlinkSync(inHome('Desktop'), inHome('Documents', 'to-desktop'));
        const via = inHome('Documents', 'to-desktop', 'far.txt');
        await transcriptOf(A, [said(link(via))]);
        const files = remoteService();
        const seen = recordTouches();
        await expect(readThere(files, A, via)).rejects.toMatchObject(protectedRefusal);
        nothingTouchedIn(seen, inHome('Documents'));
        nothingTouchedIn(seen, inHome('Desktop'));
        await expect(readThere(files, A, via, 'op-read', { open: true })).rejects.toMatchObject(protectedRefusal);
        await expect(files.writeOutside({ appSessionId: A, path: via, content: 'pwned\n', expectedHash: sha('far as it was\n'), real: inHome('Desktop', 'far.txt'), open: true }, claimed())).rejects.toMatchObject(protectedRefusal);
        nothingTouchedIn(seen, inHome('Desktop'));
        nothingAsked();
        expect(readFileSync(inHome('Desktop', 'far.txt'), 'utf8')).toBe('far as it was\n');
      });

      it('opens with open the target in a private folder of a link that is the path’s last component, by the choice, and reads the file it grants', async () => {
        write(inHome('Desktop', 'far.txt'), 'far as it was\n');
        symlinkSync(inHome('Desktop', 'far.txt'), out('to-far'));
        const files = remoteService();
        const seen = recordTouches();
        expect(await choose(files, out('to-far'))).toEqual({ status: 'refused', reason: 'protected' });
        nothingTouchedIn(seen, inHome('Desktop'));
        expect(await choose(files, out('to-far'), 'op-choose', { open: true })).toEqual({ status: 'granted', path: inHome('Desktop', 'far.txt') });
        expect(await readThere(files, A, inHome('Desktop', 'far.txt'), 'op-read', { open: true })).toMatchObject({ content: 'far as it was\n', outside: { real: inHome('Desktop', 'far.txt'), writable: true } });
        nothingTouchedIn(seen, inHome('Documents'));
      });

      // The branch review (scalpel-2#1; Decision Log 33 (1)): a walk that cannot finish refuses as protected, and nothing
      // resolves the path unchecked after it
      it('refuses as protected a claimed read and a hash-checked save through a folder the walk cannot list (0111) holding a link into a private folder, with open or without, touching nothing inside it', async () => {
        mkdirSync(at('passage'));
        symlinkSync(inHome('Documents'), at('passage', 'to-docs'));
        write(at('passage', 'beside.txt'), 'beside as it was\n');
        const via = at('passage', 'to-docs', 'private.txt');
        await transcriptOf(A, [said(link(via)), said(link(at('passage', 'beside.txt')))]);
        const files = remoteService();
        chmodSync(at('passage'), 0o111); // entered by name, never listed: the walk cannot read its entries
        try {
          const seen = recordTouches();
          for (const open of [{}, { open: true as const }]) {
            await expect(readThere(files, A, via, 'op-read', open), JSON.stringify(open)).rejects.toMatchObject(protectedRefusal);
            await expect(files.writeOutside({ appSessionId: A, path: via, content: 'pwned\n', expectedHash: sha('private as it was\n'), real: secret(), ...open }, claimed('op-save')), JSON.stringify(open)).rejects.toMatchObject(protectedRefusal);
          }
          nothingTouchedIn(seen, inHome('Documents'));
          expect(seen.filter((entry) => entry === `realpath ${via}`), 'the path is never resolved unchecked').toEqual([]);
          // fail closed: a file of that folder itself, which the walk cannot see either, is refused the same way
          await expect(readThere(files, A, at('passage', 'beside.txt'))).rejects.toMatchObject(protectedRefusal);
        } finally {
          chmodSync(at('passage'), 0o755);
        }
        expect(readFileSync(secret(), 'utf8')).toBe('private as it was\n');
        expect(readFileSync(at('passage', 'beside.txt'), 'utf8')).toBe('beside as it was\n');
      });

      it('the control: through a folder the walk can list, a link to an ordinary folder reads and saves a named file; a named file gone from a folder it cannot list still says it is gone', async () => {
        mkdirSync(at('passage'));
        write(at('plain', 'notes.txt'), 'plain as it was\n');
        symlinkSync(at('plain'), at('passage', 'to-plain'));
        const via = at('passage', 'to-plain', 'notes.txt');
        await transcriptOf(A, [said(link(via)), said(link(at('passage', 'gone.txt')))]);
        const files = remoteService();
        expect(await readThere(files, A, via)).toMatchObject({ content: 'plain as it was\n', named: true, outside: { real: at('plain', 'notes.txt'), writable: true } });
        expect(await saveThere(files, A, via, 'saved there\n')).toEqual({ status: 'ok', hash: sha('saved there\n') });
        expect(readFileSync(at('plain', 'notes.txt'), 'utf8')).toBe('saved there\n');
        chmodSync(at('passage'), 0o111);
        try {
          await expect(readThere(files, A, at('passage', 'gone.txt'))).rejects.toThrow(new Error(`not found: ${at('passage', 'gone.txt')}`));
          await expect(files.writeOutside({ appSessionId: A, path: at('passage', 'gone.txt'), content: 'pwned\n', expectedHash: sha(''), real: at('passage', 'gone.txt') }, claimed('op-gone'))).rejects.toThrow(new Error(`not found: ${at('passage', 'gone.txt')}`));
        } finally {
          chmodSync(at('passage'), 0o755);
        }
      });

      it('walks no path under one of the caller’s roots: a root inside a private folder reads and saves without open', async () => {
        records.set(B, record(inHome('Documents', 'deep')));
        const files = remoteService();
        const read = await readThere(files, B, inHome('Documents', 'deep', 'more.txt'));
        expect(read).toMatchObject({ content: 'more as it was\n' });
        expect(read).not.toHaveProperty('outside');
        expect(await files.writeOutside({ appSessionId: B, path: inHome('Documents', 'deep', 'more.txt'), content: 'saved\n', expectedHash: read.hash!, real: inHome('Documents', 'deep', 'more.txt') }, claimed())).toEqual({ status: 'ok', hash: sha('saved\n') });
      });

      it('reads a delivered file in a private folder for a request with no claim as at the pin', async () => {
        index.library.reconcile({ artifacts: [artifact(1, secret(), { kind: 'human' })], links: [linked(1, A)], spaces: [] });
        const files = remoteService();
        const read = await files.read({ appSessionId: A, path: secret() }, UNCLAIMED);
        expect(read).toMatchObject({ content: 'private as it was\n' });
        expect(read).not.toHaveProperty('outside');
      });

      it('guards no folder on a platform that is not macOS: a claimed read and save there need no open', async () => {
        await transcriptOf(A, [said(link(secret()))]);
        const files = remoteService({ platform: 'linux' });
        expect(await readThere(files, A, secret())).toMatchObject({ content: 'private as it was\n', outside: { writable: true } });
        expect(await saveThere(files, A, secret(), 'saved there\n')).toEqual({ status: 'ok', hash: sha('saved there\n') });
      });
    });

    describe('a chat rooted at the home', () => {
      it('reads and saves a named file under that home as any outside file, refuses one nothing admits, and keeps the home out of its roots', async () => {
        const HOME_CHAT = 'home-chat' as AppSessionId;
        records.set(HOME_CHAT, record(home));
        write(inHome('unnamed.txt'), 'unnamed in the home\n');
        await transcriptOf(HOME_CHAT, [said(link(inHome('notes.txt')))]);
        const files = remoteService();
        expect(await readThere(files, HOME_CHAT, inHome('notes.txt'))).toMatchObject({ content: 'notes in the home\n', named: true, outside: { real: inHome('notes.txt'), writable: true } });
        expect(await saveThere(files, HOME_CHAT, inHome('notes.txt'), 'saved in the home\n')).toEqual({ status: 'ok', hash: sha('saved in the home\n') });
        expect(readFileSync(inHome('notes.txt'), 'utf8')).toBe('saved in the home\n');
        await expect(readThere(files, HOME_CHAT, inHome('unnamed.txt'))).rejects.toThrow(new Error(OUT));
        await expect(files.list({ appSessionId: HOME_CHAT }, true)).rejects.toThrow(new Error(OUT));
      });
    });

    // Condition (e): MAWS's own folders and the real path, reached by the claimed caller with nothing skipped
    describe('MAWS’s own folders and the real path', () => {
      it('reads a file under the profile, the daemon’s bundle and a told bundle with own, and refuses its claimed save', async () => {
        told = [at('Dev', 'MAWS Dev.app')];
        const ownFiles = [join(profile, 'settings.json'), at('Apps', 'MAWS.app', 'Contents', 'Resources', 'app.txt'), at('Dev', 'MAWS Dev.app', 'Contents', 'Resources', 'dev.txt')];
        await transcriptOf(A, ownFiles.map((path) => said(`See [the file](<${path}>).`)));
        const files = remoteService();
        for (const path of ownFiles) {
          const before = readFileSync(path, 'utf8');
          const read = await readThere(files, A, path);
          expect(read, path).toMatchObject({ content: before, own: true, named: true, outside: { real: path } });
          await expect(files.writeOutside({ appSessionId: A, path, content: 'pwned\n', expectedHash: read.hash!, real: path }, claimed()), path).rejects.toThrow(new Error(`not writable: ${path}`));
          expect(readFileSync(path, 'utf8'), path).toBe(before);
        }
      });

      it('refuses with FILES_MOVED a claimed save whose folder was swapped for a link since the read, and saves once it is back', async () => {
        write(at('far', 'dir', 'notes.txt'), 'same bytes\n');
        write(at('twin', 'notes.txt'), 'same bytes\n');
        const far = at('far', 'dir', 'notes.txt');
        await transcriptOf(A, [said(link(far))]);
        const files = remoteService();
        const read = await readThere(files, A, far);
        swapToLink(at('far', 'dir'), at('twin'));
        const save = () => files.writeOutside({ appSessionId: A, path: far, content: 'saved\n', expectedHash: read.hash!, real: read.outside!.real }, claimed());
        await expect(save()).rejects.toThrow(new Error(FILES_MOVED));
        expect([readFileSync(at('far', 'dir.away', 'notes.txt'), 'utf8'), readFileSync(at('twin', 'notes.txt'), 'utf8')]).toEqual(['same bytes\n', 'same bytes\n']);
        restore(at('far', 'dir'));
        expect(await save()).toEqual({ status: 'ok', hash: sha('saved\n') });
      });
    });
  });

  // UX wave U6b-4c (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, R1 to R5, Interfaces §B and §D):
  // a link in a Markdown file the session may read, found by the daemon itself (`files.follow`), recorded for the session
  // in a file of the profile, and every later request of this machine that asks by name admitted by the record
  describe('a followed link (UX wave U6b-4c)', () => {
    const LINKED = { status: 'linked' } as const;
    const INSIDE = { status: 'inside' } as const;
    const NOT_LINKED = { status: 'not-linked' } as const;
    const claimed = (opId = 'op-1') => ({ remote: true as const, claim: { member: 'member-of-the-suite', device: 'device-of-the-suite', opId } });
    let linksFile: string;
    let links: FileLinks;
    let followLog: string[];
    const openLinks = () => openFileLinks(linksFile, { known: (id) => records.has(id), log: (line) => logged.push(line) });
    // U6e's service as the daemon composes it, with the link records and the log of each record written; a claimed caller
    // walks under a home of the suite's, on macOS
    const followService = (extra: Partial<FilesServiceOptions> = {}) => outsideService({ links, log: (line) => followLog.push(line), home: () => at('home'), platform: 'darwin', ...extra });
    const guide = () => inRoot('docs', 'guide.md');
    type Source = { file: string } | { agent: string };
    const follow = (files: Files, path: string, from: Source = { file: guide() }, appSessionId: AppSessionId = A, signal?: AbortSignal) => files.follow({ appSessionId, path, from }, undefined, signal);
    type Recorded = { real: string; at: number; from: Source; why?: string };
    const recorded = (): Record<string, Recorded[]> | null => (existsSync(linksFile) ? (JSON.parse(readFileSync(linksFile, 'utf8')) as { sessions: Record<string, Recorded[]> }).sessions : null);
    const realsOf = (appSessionId: AppSessionId) => (recorded()?.[appSessionId] ?? []).map((entry) => entry.real);
    const ok = (content: string) => ({ status: 'ok', hash: sha(content) });

    beforeEach(() => {
      linksFile = join(profile, 'sessions', 'file-links.json');
      links = openLinks();
      followLog = [];
      mkdirSync(at('home'), { recursive: true });
      write(out('notes.txt'), 'notes as they were\n');
      write(guide(), `# Guide\n\n${link(out('notes.txt'))}\n`);
    });

    describe('what a follow records, and what the record admits', () => {
      it('records a file a Markdown file of the folders links, and admits its read, its open outside MAWS and its save by the record (K1, X1.6)', async () => {
        const linking = session('Linking');
        write(out('report.pdf'), '%PDF-1.4\n%%EOF\n');
        write(guide(), `# Guide\n\n${link(out('notes.txt'))} And [the report](${out('report.pdf')}).\n`);
        const files = followService();
        await expect(shown(files, linking, out('notes.txt')), 'before the follow').rejects.toThrow(new Error(OUT));
        expect(await follow(files, out('notes.txt'), { file: guide() }, linking)).toEqual(LINKED);
        expect(await follow(files, out('report.pdf'), { file: guide() }, linking)).toEqual(LINKED);
        const read = await shown(files, linking, out('notes.txt'));
        expect(read).toMatchObject({ content: 'notes as they were\n', named: true });
        expect(read.outside).toEqual({ real: out('notes.txt'), writable: true });
        expect(await files.openExternal(linking, out('report.pdf'), null, { named: true })).toEqual({ opened: true, message: null });
        expect(await saveShown(files, linking, out('notes.txt'), 'saved through the link\n')).toEqual(ok('saved through the link\n'));
        expect(readFileSync(out('notes.txt'), 'utf8')).toBe('saved through the link\n');
        expect(recorded()).toEqual({
          [linking]: [
            { real: out('notes.txt'), at: expect.any(Number), from: { file: guide() } },
            { real: out('report.pdf'), at: expect.any(Number), from: { file: guide() } },
          ],
        });
        expect(followLog).toHaveLength(2);
        for (const line of followLog) {
          expect(line).toContain(linking);
          expect(line).not.toContain(base);
          expect(line).not.toMatch(/notes|report/);
        }
      });

      it('admits the file again after the daemon restarts: the store opened again from its file, and a new service (K2, K12)', async () => {
        expect(await follow(followService(), out('notes.txt'))).toEqual(LINKED);
        links = openLinks();
        const again = followService();
        expect((await shown(again, A, out('notes.txt'))).outside).toEqual({ real: out('notes.txt'), writable: true });
        expect(await saveShown(again, A, out('notes.txt'), 'saved after the restart\n')).toEqual(ok('saved after the restart\n'));
      });

      it('answers not-linked for a path the source does not link, writes nothing, and a read of it stays refused; the linked path is recorded (X1.5, K7)', async () => {
        const files = followService();
        expect(await follow(files, out('unnamed.txt'))).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        await expect(shown(files, A, out('unnamed.txt'))).rejects.toThrow(new Error(OUT));
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
        expect(realsOf(A)).toEqual([out('notes.txt')]);
      });

      it('admits the record for its session alone, for a request that asks by name, and never for an open the agent asked for (X5.1, X5.2, X5.4)', async () => {
        records.set(B, record(root));
        write(out('report.pdf'), '%PDF-1.4\n%%EOF\n');
        write(guide(), `${link(out('notes.txt'))} ${link(out('report.pdf'))}\n`);
        const files = followService();
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
        expect(await follow(files, out('report.pdf'))).toEqual(LINKED);
        expect((await shown(files, A, out('notes.txt'))).outside, 'the control').toEqual({ real: out('notes.txt'), writable: true });
        await expect(shown(files, B, out('notes.txt'))).rejects.toThrow(new Error(OUT));
        await expect(shown(files, A, out('notes.txt'), { agent: true })).rejects.toThrow(new Error(OUT));
        await expect(files.openExternal(A, out('report.pdf'), null, { named: true, agent: true })).rejects.toThrow(new Error(OUT));
        await expect(files.read({ appSessionId: A, path: out('notes.txt') })).rejects.toThrow(new Error(OUT));
      });

      it('reaches a link record for a session with no folder that resolves, as a grant is reached', async () => {
        records.set(B, record(at('no-such-folder')));
        links.add(B, out('notes.txt'), { file: guide() });
        const files = service({ links });
        expect(await files.read({ appSessionId: B, path: out('notes.txt'), named: true })).toMatchObject({ named: true, outside: { real: out('notes.txt'), writable: true } });
        await expect(files.read({ appSessionId: B, path: out('unnamed.txt'), named: true })).rejects.toThrow(new Error(OUT));
      });

      it('reads a recorded file under MAWS’s own folders with own, and its save answers not writable (X4.5)', async () => {
        const settings = join(profile, 'settings.json');
        write(guide(), `${link(settings)}\n`);
        const files = followService();
        expect(await follow(files, settings)).toEqual(LINKED);
        const read = await shown(files, A, settings);
        expect(read).toMatchObject({ own: true, outside: { real: settings, writable: true } });
        await expect(files.writeOutside({ appSessionId: A, path: settings, content: 'pwned\n', expectedHash: read.hash!, real: settings })).rejects.toThrow(new Error(`not writable: ${settings}`));
        expect(readFileSync(settings, 'utf8')).toBe('{ "theme": "light" }\n');
      });

      it('answers not found for a recorded path that is gone by its real path, and the refusal by another spelling of it (X5.13, Q7)', async () => {
        write(out('kept', 'gone.txt'), 'soon gone\n');
        symlinkSync(out('kept'), out('kept-alias'));
        write(guide(), `${link(out('kept', 'gone.txt'))}\n`);
        const files = followService();
        expect(await follow(files, out('kept', 'gone.txt'))).toEqual(LINKED);
        expect((await shown(files, A, out('kept-alias', 'gone.txt'))).outside, 'the record is of the real path').toEqual({ real: out('kept', 'gone.txt'), writable: true });
        unlinkSync(out('kept', 'gone.txt'));
        await expect(shown(files, A, out('kept', 'gone.txt'))).rejects.toThrow(new Error(`not found: ${out('kept', 'gone.txt')}`));
        await expect(shown(files, A, out('kept-alias', 'gone.txt'))).rejects.toThrow(new Error(OUT));
        await expect(shown(files, A, out('kept', 'gone.txt'), { agent: true }), 'an open the agent asked for').rejects.toThrow(new Error(OUT));
      });

      it('admits nothing once the path leads to another real path, and the save answers the refusal, not that the file moved (X5.3)', async () => {
        write(out('moving', 'b.txt'), 'before the move\n');
        write(out('twin', 'b.txt'), 'before the move\n');
        write(guide(), `${link(out('moving', 'b.txt'))}\n`);
        const files = followService();
        expect(await follow(files, out('moving', 'b.txt'))).toEqual(LINKED);
        const read = await shown(files, A, out('moving', 'b.txt'));
        swapToLink(out('moving'), out('twin'));
        await expect(shown(files, A, out('moving', 'b.txt'))).rejects.toThrow(new Error(OUT));
        await expect(files.writeOutside({ appSessionId: A, path: out('moving', 'b.txt'), content: 'pwned\n', expectedHash: read.hash!, real: read.outside!.real })).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out('twin', 'b.txt'), 'utf8')).toBe('before the move\n');
        restore(out('moving'));
        expect(await saveShown(files, A, out('moving', 'b.txt'), 'saved\n')).toEqual(ok('saved\n'));
      });

      // R5, Q6; U6f's caller: a claimed caller of another machine reaches the outside evidence, where a grant admits it and
      // a link record does not
      it('admits nothing by a link record to another machine’s caller, claimed or not, and says not found to none of them; a grant admits the claimed one (X5.5)', async () => {
        write(out('gone.txt'), 'soon gone\n');
        write(guide(), `${link(out('notes.txt'))} ${link(out('gone.txt'))}\n`);
        const files = followService();
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
        expect(await follow(files, out('gone.txt'))).toEqual(LINKED);
        const mine = await shown(files, A, out('notes.txt'));
        expect(mine.outside, 'this machine’s own request (the control)').toEqual({ real: out('notes.txt'), writable: true });
        await expect(files.read({ appSessionId: A, path: out('notes.txt'), named: true }, UNCLAIMED)).rejects.toThrow(new Error(OUT));
        await expect(files.read({ appSessionId: A, path: out('notes.txt'), named: true, hash: true }, claimed('op-read'))).rejects.toThrow(new Error(OUT));
        await expect(files.writeOutside({ appSessionId: A, path: out('notes.txt'), content: 'pwned\n', expectedHash: mine.hash!, real: out('notes.txt') }, claimed('op-save'))).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out('notes.txt'), 'utf8')).toBe('notes as they were\n');
        unlinkSync(out('gone.txt'));
        await expect(files.read({ appSessionId: A, path: out('gone.txt'), named: true }, claimed('op-gone'))).rejects.toThrow(new Error(OUT));
        await expect(shown(files, A, out('gone.txt')), 'this machine’s own request (the control)').rejects.toThrow(new Error(`not found: ${out('gone.txt')}`));
        // the control: a grant of the same file admits the claimed caller as U6f built it
        await files.grant(A, out('notes.txt'));
        expect((await files.read({ appSessionId: A, path: out('notes.txt'), named: true, hash: true }, claimed('op-read-2'))).outside).toEqual({ real: out('notes.txt'), writable: true });
      });
    });

    describe('who asks, and what is asked (R1)', () => {
      it('refuses a follow from another machine, claimed or not, before the disk is touched, and records nothing; this machine’s own records (X1.2)', async () => {
        const files = followService();
        const input = { appSessionId: A, path: out('notes.txt'), from: { file: guide() } };
        const seen = recordTouches();
        await expect(files.follow(input, UNCLAIMED)).rejects.toThrow(new Error(OUT));
        await expect(files.follow(input, claimed())).rejects.toThrow(new Error(OUT));
        expect(seen).toEqual([]);
        touches.on = false;
        expect(existsSync(linksFile)).toBe(false);
        expect(asked.transcript).toEqual([]);
        expect(await files.follow(input)).toEqual(LINKED);
        expect(realsOf(A)).toEqual([out('notes.txt')]);
      });

      it('refuses as a read does an unknown session, a relative path and a path not normal, and links no path past its bound (X1.4)', async () => {
        const files = followService();
        await expect(files.follow({ appSessionId: 'Z' as AppSessionId, path: out('notes.txt'), from: { file: guide() } })).rejects.toThrow(new Error('unknown app session: Z'));
        await expect(follow(files, 'notes.txt')).rejects.toThrow(new Error('path must be absolute'));
        for (const path of [`${outside}/../outside/notes.txt`, `${out('notes.txt')}/`, `${outside}//notes.txt`]) await expect(follow(files, path), path).rejects.toThrow(new Error(OUT));
        const long = `${outside}/${'d/'.repeat(NAMED_PATH_MAX / 2)}notes.txt`;
        write(guide(), `${link(long)}\n`);
        expect(await follow(files, long)).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        expect(await follow(files, out('notes.txt'), { file: inRoot('docs', 'none.md') }), 'a source that is not there').toEqual(NOT_LINKED);
        write(guide(), `${link(out('notes.txt'))}\n`);
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
      });

      it('answers not-linked from a service given no store of link records', async () => {
        const files = outsideService();
        expect(await follow(files, out('notes.txt'))).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
      });
    });

    describe('the early answers (decision 4)', () => {
      it('answers inside for a target under the folders, a folder too, before the source is opened; not-linked for a target that is gone (Q7)', async () => {
        const opened: string[] = [];
        write(guide(), `${link(out('notes.txt'))} ${link(out('gone.txt'))}\n`);
        const files = followService({ hooks: { at: async (point, path) => void (point === 'before-open' && opened.push(path)) } });
        expect(await files.follow({ appSessionId: A, path: inRoot('README.md'), from: { file: inRoot('src', 'a.ts') } })).toEqual(INSIDE);
        expect(await follow(files, inRoot('src'))).toEqual(INSIDE);
        expect(opened).toEqual([]);
        expect(await follow(files, out('gone.txt'))).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
        expect(opened).toEqual([guide()]);
      });

      it('links neither a path inside the folders that ends in a link nor one outside that ends in a link to a file inside, and answers neither inside (X5.11)', async () => {
        symlinkSync(out('notes.txt'), inRoot('to-notes.txt'));
        symlinkSync(inRoot('README.md'), out('to-readme.md'));
        write(guide(), `${link(inRoot('to-notes.txt'))} ${link(out('to-readme.md'))} ${link(out('notes.txt'))}\n`);
        const files = followService();
        expect(await follow(files, inRoot('to-notes.txt'))).toEqual(NOT_LINKED);
        expect(await follow(files, out('to-readme.md'))).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
      });
    });

    describe('the source, read as a read reads it (R2)', () => {
      it('reads a source outside the folders only once the person chose it (X2.1)', async () => {
        const source = out('docs', 'guide.md');
        write(source, `${link(out('notes.txt'))}\n`);
        const files = followService();
        expect(await follow(files, out('notes.txt'), { file: source })).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        await files.grant(A, source);
        expect(await follow(files, out('notes.txt'), { file: source })).toEqual(LINKED);
      });

      it('reads as a source only a file the window draws as Markdown, by the name the request gives (X2.2)', async () => {
        const files = followService();
        for (const name of ['notes.txt', 'README', 'guide.md.bak']) {
          write(inRoot('kinds', name), `${link(out('notes.txt'))}\n`);
          expect(await follow(files, out('notes.txt'), { file: inRoot('kinds', name) }), name).toEqual(NOT_LINKED);
        }
        expect(existsSync(linksFile)).toBe(false);
        for (const name of ['notes.mdx', 'notes.markdown', 'notes.md']) {
          write(inRoot('kinds', name), `${link(out('notes.txt'))}\n`);
          expect(await follow(files, out('notes.txt'), { file: inRoot('kinds', name) }), name).toEqual(LINKED);
        }
      });

      it('reads no source past the Markdown cap or with a binary head; the same link in a file of exactly the cap is followed (X2.3)', async () => {
        const line = `${link(out('notes.txt'))}\n`;
        const filled = (size: number) => (line + 'some words of the guide\n'.repeat(Math.ceil(size / 24))).slice(0, size);
        write(inRoot('docs', 'big.md'), filled(MARKDOWN_RENDER_CAP + 1));
        write(inRoot('docs', 'nul.md'), `\0${line}`);
        write(inRoot('docs', 'cap.md'), filled(MARKDOWN_RENDER_CAP));
        expect(statSync(inRoot('docs', 'cap.md')).size).toBe(MARKDOWN_RENDER_CAP);
        const files = followService();
        expect(await follow(files, out('notes.txt'), { file: inRoot('docs', 'big.md') })).toEqual(NOT_LINKED);
        expect(await follow(files, out('notes.txt'), { file: inRoot('docs', 'nul.md') })).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        expect(await follow(files, out('notes.txt'), { file: inRoot('docs', 'cap.md') })).toEqual(LINKED);
      });

      it('reads no source that ends in a link, even to a Markdown file of the folders, nor one not lexically normal (X2.4)', async () => {
        symlinkSync(guide(), inRoot('docs', 'alias.md'));
        const files = followService();
        expect(await follow(files, out('notes.txt'), { file: inRoot('docs', 'alias.md') })).toEqual(NOT_LINKED);
        expect(await follow(files, out('notes.txt'), { file: `${root}/docs/../docs/guide.md` })).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
      });

      it('opens the source through the read’s boundary: a folder swapped for a link at the open is refused, and the file there is what decides (X2.5)', async () => {
        write(at('decoy', 'guide.md'), `${link(out('notes.txt'))}\n`);
        const files = followService();
        points['before-open'] = () => swapToLink(inRoot('docs'), at('decoy'));
        expect(await follow(files, out('notes.txt'))).toEqual(NOT_LINKED);
        restore(inRoot('docs'));
        const replaced = (text: string) => () => {
          unlinkSync(guide());
          writeFileSync(guide(), text);
        };
        points['before-open'] = replaced('# Guide, linking nothing now\n');
        expect(await follow(files, out('notes.txt'))).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        points['before-open'] = replaced(`# Guide, written again\n\n${link(out('notes.txt'))}\n`);
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
      });

      it('proves one Markdown source at a time: a second follow opens its source only once the first’s proof has ended, and leaves the line when its client ends (decision 7)', async () => {
        write(inRoot('docs', 'second.md'), `${link(out('result.txt'))}\n`);
        write(inRoot('docs', 'third.md'), `${link(out('chosen.txt'))}\n`);
        const order: string[] = [];
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        let reached!: () => void;
        const proving = new Promise<void>((resolve) => (reached = resolve));
        const waiting = new Set<string>(); // the follows that reached the line, by their source's name
        let bothWaiting!: () => void;
        const lined = new Promise<void>((resolve) => (bothWaiting = resolve));
        const files = followService({
          hooks: {
            at: async (point, path) => {
              if (point === 'before-open') order.push(`open ${basename(path)}`);
              if (point === 'before-follow-turn' && basename(path) !== 'guide.md' && waiting.add(basename(path)).size === 2) bothWaiting();
              if (point !== 'after-follow-read') return;
              order.push(`read ${basename(path)}`);
              if (basename(path) !== 'guide.md') return;
              reached();
              await held;
            },
          },
        });
        const first = follow(files, out('notes.txt'));
        await proving;
        const second = follow(files, out('result.txt'), { file: inRoot('docs', 'second.md') });
        const ending = new AbortController();
        const third = follow(files, out('chosen.txt'), { file: inRoot('docs', 'third.md') }, A, ending.signal);
        await lined;
        await new Promise((resolve) => setImmediate(resolve)); // each has taken its place in the line, the turn after its hook
        ending.abort();
        expect(await third, 'its client ended while it waited').toEqual(NOT_LINKED);
        expect(order).toEqual(['open guide.md', 'read guide.md']);
        release();
        expect(await Promise.all([first, second])).toEqual([LINKED, LINKED]);
        expect(order).toEqual(['open guide.md', 'read guide.md', 'open second.md', 'read second.md']);
      });

      it('records read-only what a Markdown file of MAWS’s own folders links, inside the session’s folders or chosen outside them; the same text elsewhere gives a save (X2.10, R4)', async () => {
        const own = join(profile, 'docs', 'own.md');
        write(own, `${link(out('notes.txt'))}\n`);
        records.set(H, record(join(profile, 'docs')));
        const files = followService();
        const readOnly = { real: out('notes.txt'), writable: false, why: 'result', linked: true };
        expect(await follow(files, out('notes.txt'), { file: own }, H)).toEqual(LINKED);
        expect((await shown(files, H, out('notes.txt'))).outside).toEqual(readOnly);
        await expect(saveShown(files, H, out('notes.txt'), 'pwned\n')).rejects.toThrow(new Error(OUT));
        await files.grant(A, own);
        expect(await follow(files, out('notes.txt'), { file: own })).toEqual(LINKED);
        expect((await shown(files, A, out('notes.txt'))).outside).toEqual(readOnly);
        await expect(saveShown(files, A, out('notes.txt'), 'pwned\n')).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out('notes.txt'), 'utf8')).toBe('notes as they were\n');
        const mine = out('docs', 'mine.md');
        write(mine, `${link(out('notes.txt'))}\n`);
        await files.grant(A, mine);
        expect(await follow(files, out('notes.txt'), { file: mine })).toEqual(LINKED);
        expect(await saveShown(files, A, out('notes.txt'), 'saved\n')).toEqual(ok('saved\n'));
      });
    });

    describe('the link, read as the click reads it (R3)', () => {
      it('follows only an inline link: the path in prose, a code span, a fence, an autolink, a reference, a cell the window does not draw and an image link nothing (X3.1, K6)', async () => {
        const P = out('notes.txt');
        const forms = [`see ${P}`, `\`[r](${P})\``, `\`\`\`\n[r](${P})\n\`\`\``, `<${P}>`, `[x][l]\n\n[l]: ${P}`, `| a | b |\n|---|---|\n| x | y | [r](${P}) |`, `![x](${P})`];
        const files = followService();
        for (const form of forms) {
          write(guide(), `${form}\n`);
          expect(await follow(files, P), form).toEqual(NOT_LINKED);
        }
        expect(existsSync(linksFile)).toBe(false);
        write(guide(), `${forms.join('\n\n')}\n\n[c](${P})\n`);
        expect(await follow(files, P)).toEqual(LINKED);
      });

      it('resolves a relative link against the source’s own folder, never one above or beside it (X3.2, K3)', async () => {
        const source = out('docs', 'guide.md');
        write(source, '[next](sub/a.md) and [up](../other/up.md)\n');
        for (const path of [out('sub', 'a.md'), out('docs', 'sub', 'b.md'), out('docs', 'sub', 'a.md'), out('other', 'up.md')]) write(path, 'x\n');
        const files = followService();
        await files.grant(A, source);
        expect(await follow(files, out('sub', 'a.md'), { file: source })).toEqual(NOT_LINKED);
        expect(await follow(files, out('docs', 'sub', 'b.md'), { file: source })).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        expect(await follow(files, out('docs', 'sub', 'a.md'), { file: source })).toEqual(LINKED);
        expect(await follow(files, out('other', 'up.md'), { file: source })).toEqual(LINKED);
        expect((await shown(files, A, out('docs', 'sub', 'a.md'))).outside).toEqual({ real: out('docs', 'sub', 'a.md'), writable: true });
        expect((await shown(files, A, out('other', 'up.md'))).outside).toEqual({ real: out('other', 'up.md'), writable: true });
      });

      it('links no path that differs from the link in letter case or in Unicode normal form (X3.3)', async () => {
        const composed = out('café.txt');
        const decomposed = out('café.txt');
        write(out('NOTES.txt'), 'notes as they were\n'); // on a file system that ignores case, the same file
        write(composed, 'composed\n');
        write(decomposed, 'decomposed\n'); // on one that ignores the normal form, the same file
        write(guide(), `${link(out('notes.txt'))} ${link(composed)}\n`);
        const files = followService();
        expect(await follow(files, out('NOTES.txt'))).toEqual(NOT_LINKED);
        expect(await follow(files, decomposed)).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
        expect(await follow(files, composed)).toEqual(LINKED);
      });

      it('links nothing past where the rule refuses a text, and gives the event loop back at every pause of the scan (X3.5)', async () => {
        write(guide(), `${'> '.repeat(40)}x\n\n${link(out('notes.txt'))}\n`);
        const files = followService();
        expect(await follow(files, out('notes.txt'))).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        const long = `${'[r](/elsewhere/other.txt) and some words\n'.repeat(20_000)}\n${link(out('notes.txt'))}\n`;
        write(guide(), long);
        const pauses = [...fileLinkSteps(long, dirname(guide()))].filter((step) => step === PAUSE).length;
        expect(pauses).toBeGreaterThan(1);
        turnsGiven.count = 0;
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
        expect(turnsGiven.count).toBe(pauses);
      });

      it('proves a relative link against the folder the source was confirmed in, not the spelling the window sent (X3.6, Q17)', async () => {
        write(out('real', 'docs', 'guide.md'), '[x](../secret.txt)\n');
        write(out('real', 'secret.txt'), 'beside the real folder\n');
        write(out('alias', 'secret.txt'), 'beside the alias\n');
        symlinkSync(out('real', 'docs'), out('alias', 'docs'));
        const files = followService();
        await files.grant(A, out('real', 'docs', 'guide.md'));
        expect(await follow(files, out('alias', 'secret.txt'), { file: out('alias', 'docs', 'guide.md') })).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        expect(await follow(files, out('real', 'secret.txt'), { file: out('real', 'docs', 'guide.md') })).toEqual(LINKED);
        // a folder whose two spellings share a parent: the suite's folder by its real path, and by the system's alias of it
        // where the platform has one (macOS: /var for /private/var)
        write(out('same', 'docs', 'guide.md'), '[x](../beside.txt)\n');
        write(out('same', 'beside.txt'), 'beside\n');
        await files.grant(A, out('same', 'docs', 'guide.md'));
        const alias = base.startsWith('/private/') && realpathSync(base.slice('/private'.length)) === base ? [base.slice('/private'.length)] : [];
        for (const spelling of [base, ...alias]) {
          const as = (path: string) => spelling + path.slice(base.length);
          expect(await follow(files, as(out('same', 'beside.txt')), { file: as(out('same', 'docs', 'guide.md')) }), spelling).toEqual(LINKED);
        }
        expect(realsOf(A)).toEqual([out('real', 'secret.txt'), out('same', 'beside.txt')]);
      });
    });

    describe('a link is no stronger than what writes it (R4)', () => {
      it('records read-only a file that a Markdown file only a tool’s result names links, and gives a save once the person chose the Markdown file (X4.1)', async () => {
        const source = out('docs', 'found.md');
        write(source, `${link(out('notes.txt'))}\n`);
        await transcriptOf(A, [called('t-mcp', 'mcp__docs__find', { query: 'guide' }), answered('t-mcp', [{ type: 'text', text: link(source) }])]);
        const files = followService();
        expect((await shown(files, A, source)).outside, 'the premise').toEqual({ real: source, writable: false, why: 'result' });
        expect(await follow(files, out('notes.txt'), { file: source })).toEqual(LINKED);
        const read = await shown(files, A, out('notes.txt'));
        expect(read.outside).toEqual({ real: out('notes.txt'), writable: false, why: 'result', linked: true });
        await expect(files.writeOutside({ appSessionId: A, path: out('notes.txt'), content: 'pwned\n', expectedHash: read.hash!, real: out('notes.txt') })).rejects.toThrow(new Error(OUT));
        expect(readFileSync(out('notes.txt'), 'utf8')).toBe('notes as they were\n');
        await files.grant(A, source);
        expect(await follow(files, out('notes.txt'), { file: source })).toEqual(LINKED);
        expect((await shown(files, A, out('notes.txt'))).outside).toEqual({ real: out('notes.txt'), writable: true });
        expect(await saveShown(files, A, out('notes.txt'), 'saved\n')).toEqual(ok('saved\n'));
        expect(recorded()![A]).toEqual([{ real: out('notes.txt'), at: expect.any(Number), from: { file: source } }]);
      });

      it('records read-only a file that a Markdown file only the Library admits links, and gives a save once the person chose it (X4.2)', async () => {
        const source = out('docs', 'added.md');
        write(source, `${link(out('notes.txt'))}\n`);
        index.library.reconcile({ artifacts: [artifact(1, source, { kind: 'human' })], links: [linked(1, A)], spaces: [] });
        const files = followService();
        expect((await shown(files, A, source)).outside, 'the premise').toEqual({ real: source, writable: false, why: 'added' });
        expect(await follow(files, out('notes.txt'), { file: source })).toEqual(LINKED);
        const read = await shown(files, A, out('notes.txt'));
        expect(read.outside).toEqual({ real: out('notes.txt'), writable: false, why: 'result', linked: true });
        await expect(files.writeOutside({ appSessionId: A, path: out('notes.txt'), content: 'pwned\n', expectedHash: read.hash!, real: out('notes.txt') })).rejects.toThrow(new Error(OUT));
        await files.grant(A, source);
        expect(await follow(files, out('notes.txt'), { file: source })).toEqual(LINKED);
        expect(await saveShown(files, A, out('notes.txt'), 'saved\n')).toEqual(ok('saved\n'));
      });

      it('keeps a record that admits a save, and where its link stood, when a later follow finds only a result form; a read-only one is raised (X4.4, W2 d)', async () => {
        write(out('other.txt'), 'other\n');
        write(out('later.txt'), 'later\n');
        write(guide(), `${link(out('notes.txt'))} ${link(out('other.txt'))} ${link(out('later.txt'))}\n`);
        const files = followService({ agentNames: async (_appSessionId, _agentId, _path, _signal, located) => (located?.(), 'result') });
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
        expect(await follow(files, out('other.txt'))).toEqual(LINKED);
        expect(await follow(files, out('notes.txt'), { agent: 'a1b2c3' })).toEqual(LINKED);
        expect(recorded()![A]).toEqual([
          { real: out('other.txt'), at: expect.any(Number), from: { file: guide() } },
          { real: out('notes.txt'), at: expect.any(Number), from: { file: guide() } },
        ]);
        expect((await shown(files, A, out('notes.txt'))).outside).toEqual({ real: out('notes.txt'), writable: true });
        expect(await follow(files, out('later.txt'), { agent: 'a1b2c3' })).toEqual(LINKED);
        expect((await shown(files, A, out('later.txt'))).outside).toEqual({ real: out('later.txt'), writable: false, why: 'result' });
        expect(await follow(files, out('later.txt'))).toEqual(LINKED);
        expect((await shown(files, A, out('later.txt'))).outside).toEqual({ real: out('later.txt'), writable: true });
        expect(recorded()![A]!.at(-1)).toEqual({ real: out('later.txt'), at: expect.any(Number), from: { file: guide() } });
      });
    });

    describe('a subagent’s transcript as the source (M3 supplies its search)', () => {
      it('answers not-linked while the service is given no search over one, and records what the search answers once it is', async () => {
        expect(await follow(followService(), out('notes.txt'), { agent: 'a1b2c3' })).toEqual(NOT_LINKED);
        expect(existsSync(linksFile)).toBe(false);
        const searched: unknown[][] = [];
        const answers: Record<string, Naming> = { [out('notes.txt')]: 'counted', [out('result.txt')]: 'result' };
        const files = followService({ agentNames: async (appSessionId, agentId, path, signal, located) => (searched.push([appSessionId, agentId, path, signal]), located?.(), answers[path] ?? false) });
        const client = new AbortController();
        expect(await follow(files, out('notes.txt'), { agent: 'a1b2c3' }, A, client.signal)).toEqual(LINKED);
        expect(await follow(files, out('result.txt'), { agent: 'a1b2c3' })).toEqual(LINKED);
        expect(await follow(files, out('unnamed.txt'), { agent: 'a1b2c3' })).toEqual(NOT_LINKED);
        expect(searched).toEqual([[A, 'a1b2c3', out('notes.txt'), client.signal], [A, 'a1b2c3', out('result.txt'), undefined], [A, 'a1b2c3', out('unnamed.txt'), undefined]]);
        expect((await shown(files, A, out('notes.txt'))).outside).toEqual({ real: out('notes.txt'), writable: true });
        expect((await shown(files, A, out('result.txt'))).outside).toEqual({ real: out('result.txt'), writable: false, why: 'result' });
        expect(recorded()![A]).toEqual([
          { real: out('notes.txt'), at: expect.any(Number), from: { agent: 'a1b2c3' } },
          { real: out('result.txt'), at: expect.any(Number), from: { agent: 'a1b2c3' }, why: 'result' },
        ]);
      });

      it('counts nine follows at most, each from before its first file system call until its own work ends, its locator’s call included (decision 7, K13)', async () => {
        const held: { located: () => void; answer: (naming: Naming) => void }[] = [];
        let nine!: () => void;
        const allIn = new Promise<void>((resolve) => (nine = resolve));
        const agentNames: FilesServiceOptions['agentNames'] = (_appSessionId, _agentId, _path, _signal, located) =>
          new Promise<Naming>((answer) => {
            held.push({ located: located!, answer });
            if (held.length === FOLLOW_IN_FLIGHT_MAX) nine();
          });
        const files = followService({ agentNames });
        const follows = Array.from({ length: FOLLOW_IN_FLIGHT_MAX }, () => follow(files, out('notes.txt'), { agent: 'a1b2c3' }));
        await allIn;
        const seen = recordTouches();
        expect(await follow(files, out('notes.txt'))).toEqual(NOT_LINKED);
        expect(seen, 'the tenth, with nine searches under way').toEqual([]);
        for (const one of held) one.answer(false); // each search answered, its locator's call not yet
        expect(await Promise.all(follows)).toEqual(Array.from({ length: FOLLOW_IN_FLIGHT_MAX }, () => NOT_LINKED));
        expect(await follow(files, out('notes.txt'))).toEqual(NOT_LINKED);
        expect(seen, 'the tenth, with nine locators’ calls under way').toEqual([]);
        held[0]!.located();
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
        expect(seen.length, 'a place given back: the next follow reads').toBeGreaterThan(0);
        for (const one of held.slice(1)) one.located();
      });

      // The search's contract (M3's `namesInAgent`, faked here): it calls `located` exactly once, when its call of the
      // transcript locator has settled (answered, thrown, or never made), whether the search itself fulfils, rejects or
      // throws as it is called, and possibly after it did. The follow gives its place back on `located` alone.
      it('keeps a follow’s place while its locator’s call is under way, whether its search rejects or throws as it is called (decision 7)', async () => {
        const locators: (() => void)[] = [];
        const agentNames: FilesServiceOptions['agentNames'] = (_appSessionId, _agentId, _path, _signal, located) => {
          locators.push(located!);
          if (locators.length % 2 === 0) throw new Error('the search threw as it was called');
          return Promise.reject(new Error('the search failed'));
        };
        const files = followService({ agentNames });
        const answers = await Promise.all(Array.from({ length: FOLLOW_IN_FLIGHT_MAX }, () => follow(files, out('notes.txt'), { agent: 'a1b2c3' })));
        expect(answers).toEqual(Array.from({ length: FOLLOW_IN_FLIGHT_MAX }, () => NOT_LINKED));
        const seen = recordTouches();
        expect(await follow(files, out('notes.txt'))).toEqual(NOT_LINKED);
        expect(seen, 'nine locators’ calls under way: nine places held').toEqual([]);
        locators[0]!();
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
        expect(seen.length, 'one located: one place given back').toBeGreaterThan(0);
        for (const located of locators.slice(1)) located();
      });
    });

    describe('between the proof and the record (W2, R5)', () => {
      it('records only the real path the target’s last resolution found, for a target changed during the follow (X5.10)', async () => {
        const target = out('t', 'b.txt');
        write(target, 'the first\n');
        write(out('u', 'b.txt'), 'the second\n');
        write(out('v', 'b.txt'), 'the third\n');
        write(guide(), `${link(target)}\n`);
        const files = followService();
        // before the second test: the absolute link leads, as the asked path does, to the new file, which is recorded
        points['after-follow-read'] = () => swapToLink(out('t'), out('u'));
        expect(await follow(files, target)).toEqual(LINKED);
        expect(realsOf(A)).toEqual([out('u', 'b.txt')]);
        restore(out('t'));
        // after the proof, before the last resolution: a swap to another folder outside, and a removal, record nothing
        points['before-follow-record'] = () => swapToLink(out('t'), out('v'));
        expect(await follow(files, target)).toEqual(NOT_LINKED);
        restore(out('t'));
        points['before-follow-record'] = () => renameSync(target, `${target}.gone`);
        expect(await follow(files, target)).toEqual(NOT_LINKED);
        renameSync(`${target}.gone`, target);
        expect(realsOf(A)).toEqual([out('u', 'b.txt')]);
        expect(await follow(files, target)).toEqual(LINKED); // the control: nothing changed meanwhile
        expect(realsOf(A)).toEqual([out('u', 'b.txt'), target]);
      });

      it('records nothing once the asking client has ended, during the source’s scan or after the proof (X5.8, W2 a)', async () => {
        const files = followService();
        for (const point of ['after-follow-read', 'before-follow-record'] as const) {
          const client = new AbortController();
          points[point] = () => client.abort();
          expect(await follow(files, out('notes.txt'), { file: guide() }, A, client.signal), point).toEqual(NOT_LINKED);
        }
        expect(existsSync(linksFile)).toBe(false);
        expect(await follow(files, out('notes.txt'), { file: guide() }, A, new AbortController().signal)).toEqual(LINKED);
      });

      // decision 7 (iv): the patience bounds the answer; the work under way keeps the follow's places until it ends, and
      // starts no step after it. The clock and the timers are the suite's (setTimeout and Date faked), the disk the real one.
      it('answers not-linked once its patience runs out while its Markdown proof is held open, keeps its place in the proofs’ line until the proof ends, and records nothing after (X5.12)', async () => {
        write(inRoot('docs', 'second.md'), `${link(out('result.txt'))}\n`);
        const seen: string[] = [];
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        let reached!: () => void;
        const proving = new Promise<void>((resolve) => (reached = resolve));
        let queued!: () => void;
        const lined = new Promise<void>((resolve) => (queued = resolve));
        const files = followService({
          hooks: {
            at: async (point, path) => {
              seen.push(`${point} ${basename(path)}`);
              if (point === 'before-follow-turn' && basename(path) === 'second.md') queued();
              if (point !== 'after-follow-read' || basename(path) !== 'guide.md') return;
              reached();
              await held;
            },
          },
        });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
          const first = follow(files, out('notes.txt'), { file: guide() }, A, new AbortController().signal);
          await proving;
          vi.advanceTimersByTime(NAMED_WAIT_MS + 1);
          expect(await first, 'answered with its proof still held').toEqual(NOT_LINKED);
          const second = follow(files, out('result.txt'), { file: inRoot('docs', 'second.md') });
          await lined;
          await new Promise((resolve) => setImmediate(resolve)); // the second has taken its place in the line
          expect(seen.filter((entry) => entry.startsWith('before-open')), 'the line is still the first’s').toEqual(['before-open guide.md']);
          release();
          expect(await second).toEqual(LINKED);
          expect(seen, 'the first starts no step after its patience').not.toContain('before-follow-record notes.txt');
          expect(realsOf(A)).toEqual([out('result.txt')]);
        } finally {
          vi.useRealTimers();
        }
      });

      it('answers not-linked once its patience runs out while its subagent’s search is held open, keeps its place in the count until the search ends, and records nothing after (X5.12, K13)', async () => {
        const held: { located: () => void; answer: (naming: Naming) => void }[] = [];
        let nine!: () => void;
        const allIn = new Promise<void>((resolve) => (nine = resolve));
        const agentNames: FilesServiceOptions['agentNames'] = (_appSessionId, _agentId, _path, _signal, located) =>
          new Promise<Naming>((answer) => {
            held.push({ located: located!, answer });
            if (held.length === FOLLOW_IN_FLIGHT_MAX) nine();
          });
        const files = followService({ agentNames });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
          const follows = Array.from({ length: FOLLOW_IN_FLIGHT_MAX }, () => follow(files, out('notes.txt'), { agent: 'a1b2c3' }));
          await allIn;
          vi.advanceTimersByTime(NAMED_WAIT_MS + 1);
          expect(await Promise.all(follows), 'answered with each search still held').toEqual(Array.from({ length: FOLLOW_IN_FLIGHT_MAX }, () => NOT_LINKED));
          const seen = recordTouches();
          expect(await follow(files, out('notes.txt'))).toEqual(NOT_LINKED);
          expect(seen, 'every place is still held').toEqual([]);
          for (const one of held) {
            one.answer('counted'); // a counted form, which would have recorded within the patience
            one.located();
          }
          await new Promise((resolve) => setImmediate(resolve));
          expect(existsSync(linksFile), 'nothing recorded after the patience').toBe(false);
          expect(await follow(files, out('notes.txt'))).toEqual(LINKED); // the places are given back
          expect(seen.length).toBeGreaterThan(0);
        } finally {
          vi.useRealTimers();
        }
      });

      it('fails the follow of a session removed before its record is written, writing nothing (W2 b)', async () => {
        const files = followService();
        points['before-follow-record'] = () => void records.delete(A);
        await expect(follow(files, out('notes.txt'))).rejects.toThrow(new Error(`unknown app session: ${A}`));
        expect(existsSync(linksFile)).toBe(false);
        expect(followLog).toEqual([]);
        records.set(A, record(root));
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
      });

      it('fails a follow whose record cannot be written: nothing is held, and a later read is refused (X5.9)', async () => {
        chmodSync(join(profile, 'sessions'), 0o500);
        const files = followService();
        await expect(follow(files, out('notes.txt'))).rejects.toThrow();
        chmodSync(join(profile, 'sessions'), 0o700);
        await expect(shown(files, A, out('notes.txt'))).rejects.toThrow(new Error(OUT));
        expect(existsSync(linksFile)).toBe(false);
        expect(followLog).toEqual([]);
        expect(await follow(files, out('notes.txt'))).toEqual(LINKED);
      });
    });
  });
});

// P3-L (M6b fix wave 2): a path main resolved itself (a File artifact's stored file, `library.read`), read with no session
// and no roots, as `read` answers; a directory or a missing path is refused.
describe('readResolved', () => {
  it('reads a file outside every root with no session, chunk and hash alike', async () => {
    const files = service({ env: {} });
    const answer = await files.readResolved({ path: join(outside, 'secret.txt'), hash: true });
    expect(answer).toMatchObject({ encoding: 'utf8', content: 'secret', bytes: 6, offset: 0, length: 6, truncated: false, utf8: true });
    expect(answer.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await files.readResolved({ path: join(outside, 'secret.txt'), offset: 3, length: 2 })).toMatchObject({ content: 're', offset: 3, length: 2, truncated: true });
  });

  it('refuses a directory, a relative path and a path that is gone', async () => {
    const files = service({ env: {} });
    await expect(files.readResolved({ path: join(outside, 'dirs') })).rejects.toThrow();
    await expect(files.readResolved({ path: 'secret.txt' })).rejects.toThrow('path must be absolute');
    await expect(files.readResolved({ path: join(outside, 'gone.txt') })).rejects.toThrow('not found');
  });
});

// Linux (P5 O3-E M2 fix round 1): the kernel ignores O_NOFOLLOW_ANY, so the service walks real0's ancestors (an lstat
// each, none a link), opens with O_NOFOLLOW, and takes the descriptor only if its own path (/proc/self/fd) is real0. A
// link at the last component or above it, there at the walk or put there after it, is refused at the open: no
// descriptor to outside bytes is stat'ed, read or written; readResolved, which has no roots, opens the same way (fix
// round 2). The Linux unit job runs these; macOS's cases are above.
describe.runIf(process.platform === 'linux')('files service on Linux: no link on the way to the open', () => {
  const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
  const ORIGINAL = 'export const a = 1;\n';
  const file = () => inRoot('src', 'a.ts');
  const outsideFile = () => join(outside, 'src', 'a.ts');
  beforeEach(() => writeFileSync(outsideFile(), ORIGINAL)); // what a write through a link would find: its hash matches
  const reached = () => {}; // `after-open`: deleted once reached, so still there when no descriptor was taken

  describe.each([
    ['read', () => service().read({ appSessionId: A, path: file() })],
    ['write', () => service().write({ appSessionId: A, path: file(), content: 'pwned\n', expectedHash: sha(ORIGINAL) })],
    ['readResolved', () => service().readResolved({ path: file() })], // library.read's reach: read's rules, no roots (§D)
  ] as const)('%s', (_name, attempt) => {
    it('refuses a last component replaced by an outside link before the open, at the open (ELOOP)', async () => {
      points['before-open'] = () => {
        unlinkSync(file());
        symlinkSync(outsideFile(), file());
      };
      points['after-open'] = reached;
      const open = vi.spyOn(fs.promises, 'open');
      await expect(attempt()).rejects.toThrow(new Error(OUT));
      await expect(open.mock.results[0]!.value).rejects.toMatchObject({ code: 'ELOOP' });
      expect(points['after-open']).toBe(reached);
      expect(readFileSync(outsideFile(), 'utf8')).toBe(ORIGINAL);
    });

    it('refuses an ancestor swapped to an outside link before the walk, opening nothing', async () => {
      points['before-open'] = () => swapToLink(inRoot('src'), join(outside, 'src'));
      const open = vi.spyOn(fs.promises, 'open');
      try {
        await expect(attempt()).rejects.toThrow(new Error(OUT));
        expect(open).not.toHaveBeenCalled();
        expect(readFileSync(outsideFile(), 'utf8')).toBe(ORIGINAL);
      } finally {
        restore(inRoot('src'));
      }
    });

    it('refuses an ancestor swapped to an outside link between the walk and the open, by the descriptor’s own path', async () => {
      points['after-walk'] = () => swapToLink(inRoot('src'), join(outside, 'src'));
      points['after-open'] = reached;
      const open = vi.spyOn(fs.promises, 'open');
      try {
        await expect(attempt()).rejects.toThrow(new Error(OUT));
        expect(open).toHaveBeenCalledTimes(1);
        await expect(open.mock.results[0]!.value).resolves.toBeDefined(); // the open followed the link: refused after it
        expect(points['after-open']).toBe(reached);
        expect(readFileSync(outsideFile(), 'utf8')).toBe(ORIGINAL);
      } finally {
        restore(inRoot('src'));
      }
    });
  });
});

// UX wave U8c-2, M3 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, §G and B-4): the launch folder
// and the working folder, where a fact names them, are roots of `files.*` while the admission holds at the call, for this
// machine's caller and for one on another machine (the home rule then applies to them as to any root).
describe('files service: the folders the record’s two facts name', () => {
  let repos: Awaited<ReturnType<typeof admissionRepos>>;
  let p: AdmissionPaths;
  beforeAll(async () => {
    repos = await admissionRepos();
    p = repos.paths;
  });
  afterAll(() => repos.dispose());
  const HOMES = () => ['/nonexistent-home-of-this-suite'];
  const rootNames = async (svc: ReturnType<typeof service>, remote: boolean) => (await svc.list({ appSessionId: A }, remote)).entries.map((entry) => entry.path);

  it('lists and reads a registered worktree outside the launch folder while a fact names it, here and for a remote caller, and not once it is deregistered', async () => {
    records.set(A, { directory: p.main, additionalDirectories: [], worktree: null, agentFolder: { checkout: p.beside, cwd: p.beside, branch: 'beside', linked: true } });
    const svc = service({ homes: HOMES });
    for (const remote of [false, true]) {
      expect(await rootNames(svc, remote), `remote ${remote}`).toEqual([p.main, p.beside]);
      expect((await svc.read({ appSessionId: A, path: join(p.beside, 'README.md') }, fromAnotherMachine(remote))).content, `remote ${remote}`).toBe('hello\n');
      expect((await svc.list({ appSessionId: A, path: join(p.beside, 'packages') }, remote)).root, `remote ${remote}`).toBe(p.beside);
    }
    const away = join(p.base, 'beside-registration');
    renameSync(join(p.main, '.git/worktrees/beside'), away);
    try {
      expect(await rootNames(svc, false)).toEqual([p.main]);
      await expect(svc.read({ appSessionId: A, path: join(p.beside, 'README.md') })).rejects.toThrow(OUT);
      await expect(svc.read({ appSessionId: A, path: join(p.beside, 'README.md') }, UNCLAIMED)).rejects.toThrow(OUT);
    } finally {
      renameSync(away, join(p.main, '.git/worktrees/beside'));
    }
  });

  it('keeps the launch folder a root while the record is filed in a worktree, and refuses it once the record’s directory is in another repository', async () => {
    records.set(A, { directory: p.beside, additionalDirectories: [], worktree: { path: p.beside, branch: 'beside' }, launchFolder: p.main });
    const svc = service({ homes: HOMES });
    expect(await rootNames(svc, false)).toEqual([p.beside, p.main]);
    expect((await svc.read({ appSessionId: A, path: join(p.main, 'README.md') })).content).toBe('hello\n');
    records.set(A, { directory: p.other, additionalDirectories: [], worktree: null, launchFolder: p.main });
    expect(await rootNames(svc, false)).toEqual([p.other]);
    await expect(svc.read({ appSessionId: A, path: join(p.main, 'README.md') })).rejects.toThrow(OUT);
  });

  it('admits the sub-folder a session was launched in, and not its repository’s root', async () => {
    const app = join(p.main, 'packages/app');
    records.set(A, { directory: p.w1, additionalDirectories: [], worktree: { path: p.w1, branch: 'w1' }, launchFolder: app });
    const svc = service({ homes: HOMES });
    expect(await rootNames(svc, true)).toEqual([p.w1, app]);
    expect((await svc.read({ appSessionId: A, path: join(app, 'index.ts') }, UNCLAIMED)).content).toBe('hello\n');
    await expect(svc.read({ appSessionId: A, path: join(p.main, 'README.md') }, UNCLAIMED)).rejects.toThrow(OUT);
  });

  it('drops an admitted folder that is a home of the machine for a remote caller, and keeps it for this machine’s', async () => {
    records.set(A, { directory: p.main, additionalDirectories: [], worktree: null, agentFolder: { checkout: p.beside, cwd: p.beside, branch: 'beside', linked: true } });
    const svc = service({ homes: () => [p.beside] });
    expect(await rootNames(svc, false)).toEqual([p.main, p.beside]);
    expect(await rootNames(svc, true)).toEqual([p.main]);
    await expect(svc.read({ appSessionId: A, path: join(p.beside, 'README.md') }, UNCLAIMED)).rejects.toThrow(OUT);
  });

  it.each(ADMISSION_CASES)('reads under a fact’s folder only where the table admits it: %s', async (_name, make) => {
    const { record, admitted } = make(p);
    records.set(A, record);
    const svc = service({ homes: HOMES });
    const roots = await rootNames(svc, true);
    expect(roots.slice(1)).toEqual(admitted === null || admitted === roots[0] ? [] : [admitted]);
  });
});
