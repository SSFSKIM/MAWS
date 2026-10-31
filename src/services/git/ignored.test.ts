import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitFixture } from '../../../test/support/git-fixture';
import { CHECK_IGNORE_BATCH_MS, gitIgnored } from './ignored';
import { createGitReader, createGitRunner, GitCommandError, type GitRead, type GitRun, type GitRunOptions } from './runner';

// A runner answering the two listings and recording each check-ignore it is asked.
function fakeRun(listings: { ignored: string[]; listed: string[] }, checkIgnore: (paths: string[]) => string[] | Error = () => []) {
  const batches: string[][] = [];
  const run = vi.fn<GitRun>(async (_directory: string, args: string[], options?: GitRunOptions) => {
    const z = (paths: string[]) => paths.map((path) => `${path}\0`).join('');
    if (args[0] === 'ls-files') return z(args.includes('-i') ? listings.ignored : listings.listed);
    if (args[0] === 'check-ignore') {
      expect(args).toEqual(['check-ignore', '-z', '--stdin']);
      expect(options?.acceptExitCodes).toEqual([1]); // exit 1: nothing ignored
      const paths = (options?.input ?? '').split('\0').filter((path) => path !== '');
      batches.push(paths);
      const answer = checkIgnore(paths);
      if (answer instanceof Error) throw answer;
      return z(answer);
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  });
  return { run, batches };
}

describe("the repository's ignore rules as a prune", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('names a directory git lists ignored, collapsed with nothing listed beneath it, and every directory beneath it', async () => {
    const { run, batches } = fakeRun({
      ignored: ['node_modules/', 'pkg/', 'pkg/node_modules/', 'build/', 'build/a.o', 'notes.o'],
      listed: ['README.md', 'pkg/index.js', 'src/a/b.ts', 'build/', 'scratch/'],
    });
    const prune = await gitIgnored(run, '/repo');
    expect(await prune('node_modules')).toBe(true);
    expect(await prune('node_modules/left-pad')).toBe(true);
    expect(await prune('pkg/node_modules')).toBe(true);
    // A directory git lists only because everything in it is ignored is not itself ignored: a new file there counts.
    expect(await prune('build')).toBe(false);
    expect(await prune('pkg')).toBe(false);
    expect(await prune('src')).toBe(false);
    expect(await prune('src/a')).toBe(false);
    expect(await prune('scratch')).toBe(false);
    expect(batches).toEqual([]); // every directory git listed is answered from its listings
  });

  it('asks a directory git never listed (made after the listings, or inside an untracked one) in one check-ignore per window', async () => {
    const { run, batches } = fakeRun({ ignored: [], listed: ['README.md', 'scratch/'] }, (paths) => paths.filter((path) => path.endsWith('dist')));
    const prune = await gitIgnored(run, '/repo');
    const answers = Promise.all([prune('fresh'), prune('fresh/dist'), prune('scratch/inner')]);
    await vi.advanceTimersByTimeAsync(CHECK_IGNORE_BATCH_MS - 1);
    expect(batches).toEqual([]); // held until the window closes
    await vi.advanceTimersByTimeAsync(1);
    expect(await answers).toEqual([false, true, false]);
    expect(batches).toEqual([['fresh', 'fresh/dist', 'scratch/inner']]);
    const later = prune('later');
    await vi.advanceTimersByTimeAsync(CHECK_IGNORE_BATCH_MS);
    expect(await later).toBe(false);
    expect(batches).toHaveLength(2);
  });

  it('reads a clean batch as nothing ignored, and a failed one as nothing ignored rather than miss a write', async () => {
    const clean = fakeRun({ ignored: [], listed: [] });
    const prune = await gitIgnored(clean.run, '/repo');
    const answer = prune('a');
    await vi.advanceTimersByTimeAsync(CHECK_IGNORE_BATCH_MS);
    expect(await answer).toBe(false);

    const failing = fakeRun({ ignored: [], listed: [] }, () => new GitCommandError("git check-ignore failed: pathspec 'sub/x' is in submodule 'sub'", '', 128, ''));
    const strict = await gitIgnored(failing.run, '/repo');
    const answers = Promise.all([strict('sub/x'), strict('b')]);
    await vi.advanceTimersByTimeAsync(CHECK_IGNORE_BATCH_MS);
    expect(await answers).toEqual([false, false]);
  });
});

// D21: git's listing reaches the prune as git writes it. A kernel's (3.9 MB), read whole, held the loop 18 to 33 ms in
// the runner's one decode while the tree walked; read chunk by chunk, no turn takes more than one chunk of it. Pinned by
// the bytes a turn takes, not by milliseconds (a wall-clock bound flakes on a loaded runner).
const LISTING_PATHS = 300_000; // about 5 MB, a kernel's shape: some 6,000 directories, the paths beneath them many
const listingBytes = () => Buffer.from(Array.from({ length: LISTING_PATHS }, (_, i) => `d${i % 2_000}/s${i % 3}/f${i}.c\0`).join(''));

describe("the repository's ignore rules, read as git writes them", () => {
  it('decodes and parses at most one chunk of a listing in a turn', async () => {
    const bytes = listingBytes();
    const chunks: Buffer[] = [];
    for (let at = 0; at < bytes.length; at += 65_536) chunks.push(bytes.subarray(at, at + 65_536)); // a pipe's chunks
    let turn = 0;
    let ticking = true;
    const tick = () => {
      turn++;
      if (ticking) setImmediate(tick);
    };
    setImmediate(tick);
    const takenIn: number[] = []; // the turn each chunk was taken in; every chunk is ready at once, so only the reader's own yields separate them
    const read: GitRead = (_directory, args) => ({
      async *[Symbol.asyncIterator]() {
        if (args.includes('-i')) return yield Buffer.from('build/\0');
        for (const chunk of chunks) {
          takenIn.push(turn);
          yield chunk;
        }
      },
    });
    const run: GitRun = async (_directory, args) => {
      throw new Error(`the listings are read as streams, not run: git ${args.join(' ')}`);
    };
    const prune = await gitIgnored(run, '/repo', read);
    ticking = false;
    expect(takenIn).toHaveLength(chunks.length);
    const perTurn = new Map<number, number>();
    for (const at of takenIn) perTurn.set(at, (perTurn.get(at) ?? 0) + 1);
    expect(Math.max(...perTurn.values())).toBe(1);
    expect(await Promise.all([prune('d7/s1'), prune('d1999'), prune('build'), prune('build/x')])).toEqual([false, false, true, true]);
  });

  describe('through the runner, from a git that writes a multi-megabyte listing', () => {
    let dir: string;
    beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'maws-ignored-'))));
    afterEach(() => {
      vi.restoreAllMocks();
      rmSync(dir, { recursive: true, force: true });
    });

    it('never holds the whole of it: no concatenation of its output and no decode of it whole', async () => {
      const listing = join(dir, 'listing');
      writeFileSync(listing, listingBytes());
      const git = join(dir, 'git');
      writeFileSync(git, `#!/bin/sh\ncase " $* " in\n  *" -i "*) printf 'build/\\0' ;;\n  *" -c "*) cat '${listing}' ;;\nesac\n`, { mode: 0o755 });
      const env = { PATH: process.env.PATH, HOME: process.env.HOME, MAWS_GIT: git };
      const whole = 256 * 1024; // the listing is 5 MB; a pipe's chunk at most 64 KiB
      const held: string[] = []; // what took more than `whole` bytes of it at once
      const concat = Buffer.concat;
      vi.spyOn(Buffer, 'concat').mockImplementation((list, length) => {
        const joined = concat(list, length);
        if (joined.length > whole) held.push(`Buffer.concat of ${joined.length} bytes`);
        return joined;
      });
      const toString = Buffer.prototype.toString; // called on its buffer below
      vi.spyOn(Buffer.prototype, 'toString').mockImplementation(function (this: Buffer, ...args: unknown[]) {
        if (this.length > whole) held.push(`a decode of ${this.length} bytes`);
        return toString.apply(this, args as Parameters<Buffer['toString']>);
      });
      const prune = await gitIgnored(createGitRunner({ env }), dir, createGitReader({ env }));
      vi.restoreAllMocks();
      expect(held).toEqual([]);
      expect(await Promise.all([prune('d7/s1'), prune('build'), prune('build/x')])).toEqual([false, true, true]);
    });
  });
});

// Real git: the listings' shapes and check-ignore's answers, through the service's own runner.
describe("the repository's ignore rules, read from a real repository", () => {
  let repo: GitFixture;
  beforeEach(async () => {
    repo = await GitFixture.create();
  });
  afterEach(() => repo.dispose());

  it('prunes what git ignores, keeps what it does not, and asks git about a directory made later', async () => {
    await repo.write('.gitignore', 'node_modules/\n*.o\nout/\n');
    await repo.write('src/a.ts', 'x');
    await repo.git('add', '.gitignore', 'src/a.ts');
    await repo.write('out/kept.txt', 'x');
    await repo.git('add', '-f', 'out/kept.txt'); // an ignored directory holding a tracked file stays watched
    await repo.git('commit', '-q', '-m', 'files');
    await repo.write('node_modules/p/index.js', 'x');
    await repo.write('build/a.o', 'x'); // nothing but ignored files
    await repo.write('scratch/notes/n.md', 'x'); // untracked, listed collapsed
    await mkdir(repo.path('scratch/notes/node_modules'), { recursive: true });
    await repo.write('scratch/notes/node_modules/q.js', 'x');
    const prune = await gitIgnored(createGitRunner({ env: repo.serviceEnv() }), repo.root);
    expect(await prune('node_modules')).toBe(true);
    expect(await prune('scratch/notes/node_modules')).toBe(true);
    expect(await prune('out')).toBe(false);
    expect(await prune('build')).toBe(false);
    expect(await prune('src')).toBe(false);
    expect(await prune('scratch')).toBe(false);
    expect(await prune('scratch/notes')).toBe(false);
    await repo.write('later/node_modules/r.js', 'x');
    await repo.write('later/src/s.ts', 'x');
    expect(await Promise.all([prune('later'), prune('later/node_modules'), prune('later/src')])).toEqual([false, true, false]);
  });
});
