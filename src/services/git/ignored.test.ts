import { mkdir } from 'node:fs/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitFixture } from '../../../test/support/git-fixture';
import { CHECK_IGNORE_BATCH_MS, gitIgnored } from './ignored';
import { createGitRunner, GitCommandError, type GitRun, type GitRunOptions } from './runner';

setFlagsFromString('--expose_gc');
const gc = runInNewContext('gc') as () => void;

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

// VM measure of M1: a kernel checkout's listing (3.9 MB, about 80,000 paths) held the loop 44 ms in one turn, split
// whole before its chunked read began; the tree's walk runs meanwhile, and its lag is bounded (§G).
describe("the repository's ignore rules, read from a listing of a million paths", () => {
  it('never holds the loop for the whole listing', async () => {
    // A kernel's shape: some 6,000 directories, the paths beneath them many.
    const listed = Array.from({ length: 1_000_000 }, (_, i) => `d${i % 2_000}/s${i % 3}/f${i}.c\0`).join('');
    const run: GitRun = async (_directory, args) => (args.includes('-i') ? 'build/\0' : listed);
    gc(); // the listing's making left a million strings: their collection is no turn of the read's
    let worst = 0;
    let last = performance.now();
    let ticking = true;
    const tick = () => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      if (ticking) setImmediate(tick);
    };
    setImmediate(tick);
    const prune = await gitIgnored(run, '/repo');
    ticking = false;
    expect(await Promise.all([prune('d7/s1'), prune('build'), prune('build/x')])).toEqual([false, true, true]);
    expect(worst).toBeLessThan(30); // split whole, the listing held the loop 95 ms on an M-series Mac, 120 to 180 ms on the VM
  });
});

// VM measure of M1: on Node 24, mawsd's runtime, git's listing of a kernel checkout reaches the prune as one 3.9 MB
// string held outside V8's heap, and a directory kept as a substring of it held all of it for as long as the prune
// lived (the kernel arm's external memory, +3.8 MiB). Node 22 makes a heap string of it, which this case cannot tell
// from the heap's own churn: there it is skipped.
describe("the repository's ignore rules, kept apart from the listing they were read from", () => {
  it('holds none of the listing once read', async (context) => {
    // The bytes are made first and kept: an array buffer's memory leaves `external` on a sweep after the collection.
    const bytes = Buffer.from(Array.from({ length: 100_000 }, (_, i) => `drivers/net/ethernet/vendor${i % 2_000}/sub${i % 3}/f${i}.c\0`).join(''));
    gc();
    const before = process.memoryUsage().external;
    let listing: string | null = bytes.toString(); // as the runner decodes git's output
    if ((process.memoryUsage().external - before) / 2 ** 20 < 4) return context.skip(); // a heap string: Node 22
    const run: GitRun = async (_directory, args) => (args.includes('-i') ? '' : listing!);
    const prune = await gitIgnored(run, '/repo');
    listing = null;
    gc();
    expect(await prune('drivers/net/ethernet/vendor7/sub1')).toBe(false); // alive, answering from what it kept
    expect((process.memoryUsage().external - before) / 2 ** 20).toBeLessThan(1); // the listing alone is 4.3 MiB
    expect(bytes.length).toBeGreaterThan(0);
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
