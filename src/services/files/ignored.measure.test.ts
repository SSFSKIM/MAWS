// Probe 8 (UX wave U6b-3a, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, "Probe 8 · the ignore
// check at size"): what the ignore check costs a `files.list` of a directory of 5,000 entries, and a burst of 200
// listings at once. A measurement, read by a person against the document's table: it prints one `probe8.*` line per
// label and asserts counts alone (how many entries came back marked). It makes its repositories with invented names
// under a temporary folder, with an empty home, runs a real files service in this process with the real check and once
// without it, and removes what it made. Run on request, on the build VM:
// `MAWS_IGNORED_MEASURE=1 pnpm exec vitest run src/services/files/ignored.measure.test.ts --testTimeout 600000`, and the
// same command on a Mac host (it reads the machine through `node:os` and git by `/usr/bin/git`, as the service does).
import { execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { FilesListOutput } from '@shared/ipc/schema/files';
import { GitFixture } from '../../../test/support/git-fixture';
import { createGitRunner, execGit, type ExecFileFn } from '../git/runner';
import { createIgnoreCheck, type IgnoreCheck, type IgnoreCheckEvent } from './ignored';
import { createFilesService, type FilesService } from './service';

const FOLDERS = 200; // the mixed repository's folders
const TRACKED_PER_FOLDER = 100;
const IGNORED_PER_FOLDER = 5;
const WIDE = 5_000; // the entries of each directory of 5,000
const WARM = 3;
const TIMED = 20;
const MIXED = 'app-probe8-mixed' as AppSessionId;
const NOWHERE = 'app-probe8-nowhere' as AppSessionId;

const print = (label: string, value: string | number) => console.log(`probe8.${label} ${value}`);
// What the check reported while a measurement ran (Decision Log 10): each ask's wait from its ask to the start of its
// run, each run's count of asks, and the asks whose bound passed while they waited or while their run ran
const events: IgnoreCheckEvent[] = [];
function printQueue(label: string): void {
  const runs = events.filter((event): event is Extract<IgnoreCheckEvent, { kind: 'run' }> => event.kind === 'run');
  const waits = runs.flatMap((event) => event.waitedMs);
  const sizes = runs.map((event) => event.waitedMs.length);
  const expired = events.filter((event): event is Extract<IgnoreCheckEvent, { kind: 'expired' }> => event.kind === 'expired');
  print(`${label}.runs`, runs.length);
  print(`${label}.wait.median_ms`, waits.length === 0 ? 'none' : median(waits).toFixed(1));
  print(`${label}.wait.max_ms`, waits.length === 0 ? 'none' : Math.max(...waits).toFixed(1));
  print(`${label}.batch.median`, sizes.length === 0 ? 'none' : median(sizes));
  print(`${label}.batch.max`, sizes.length === 0 ? 'none' : Math.max(...sizes));
  print(`${label}.expired_waiting`, expired.filter((event) => event.waiting).length);
  print(`${label}.expired_running`, expired.filter((event) => !event.waiting).length);
  events.length = 0;
}
const marked = (listing: FilesListOutput) => listing.entries.filter((entry) => entry.ignored === true).length;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[Math.floor(mid)]!;
};
// A spawn function that counts the git processes of the check alive at once
function counted(): { execFile: ExecFileFn; most: () => number; reset: () => void } {
  let live = 0;
  let most = 0;
  const execFile: ExecFileFn = (file, args, options, callback) => {
    const child = execGit(file, args, options, callback) as ChildProcess;
    most = Math.max(most, ++live);
    child.once('close', () => void live--);
    return child;
  };
  return { execFile, most: () => most, reset: () => void (most = live) };
}

describe.skipIf(process.env.MAWS_IGNORED_MEASURE !== '1')('probe 8: the ignore check at size', () => {
  let repo: GitFixture;
  let nowhere: string;
  let spawns: ReturnType<typeof counted>;
  let check: IgnoreCheck;
  let unbounded: IgnoreCheck;
  let withCheck: FilesService;
  let withUnbounded: FilesService;
  let without: FilesService;
  const records = (id: AppSessionId) => (id === MIXED ? { directory: repo.root, additionalDirectories: [], worktree: null } : id === NOWHERE ? { directory: nowhere, additionalDirectories: [], worktree: null } : null);

  beforeAll(async () => {
    repo = await GitFixture.create();
    // the root's ignore file: 60 patterns, of which the five-per-folder rule and the dependency folder's match
    const patterns = ['*.tmp', 'node_modules/', ...Array.from({ length: 58 }, (_, i) => (i % 2 === 0 ? `*.unused${i}` : `/nothing-${i}/`))];
    writeFileSync(repo.path('.gitignore'), `${patterns.join('\n')}\n`);
    for (let d = 0; d < FOLDERS; d++) {
      const folder = repo.path(`harbor-${String(d).padStart(3, '0')}`);
      mkdirSync(folder);
      for (let f = 0; f < TRACKED_PER_FOLDER; f++) writeFileSync(join(folder, `tide-${String(f).padStart(3, '0')}.ts`), `export const tide = ${f};\n`);
    }
    // the directory of 5,000: its own ignore file of 20 patterns (an extension, a name, eighteen that match nothing), 2,000
    // tracked entries (the ignore file among them), 2,000 untracked no rule names, 700 named by extension, 300 by name
    const wide = repo.path('wide');
    mkdirSync(wide);
    writeFileSync(join(wide, '.gitignore'), `${['*.bak', 'generated-*', ...Array.from({ length: 18 }, (_, i) => `*.spare${i}`)].join('\n')}\n`);
    for (let i = 0; i < 1_999; i++) writeFileSync(join(wide, `gauge-${String(i).padStart(4, '0')}.ts`), 'export {};\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-q', '-m', 'probe 8');
    for (let i = 0; i < 2_000; i++) writeFileSync(join(wide, `draft-${String(i).padStart(4, '0')}.md`), 'draft\n');
    for (let i = 0; i < 700; i++) writeFileSync(join(wide, `old-${String(i).padStart(4, '0')}.bak`), 'old\n');
    for (let i = 0; i < 300; i++) writeFileSync(join(wide, `generated-${String(i).padStart(4, '0')}.json`), '{}\n');
    for (let d = 0; d < FOLDERS; d++) {
      for (let f = 0; f < IGNORED_PER_FOLDER; f++) writeFileSync(repo.path(`harbor-${String(d).padStart(3, '0')}/cache-${f}.tmp`), 'cache\n');
    }
    // a dependency tree's folder: 5,000 entries inside a folder the root's rule ignores
    const installed = repo.path('node_modules/anchor-kit');
    mkdirSync(installed, { recursive: true });
    for (let i = 0; i < WIDE; i++) writeFileSync(join(installed, `chain-${String(i).padStart(4, '0')}.js`), 'module.exports = {};\n');
    // 5,000 entries outside any repository
    nowhere = realpathSync(mkdtempSync(join(os.tmpdir(), 'maws-probe8-nowhere-')));
    for (let i = 0; i < WIDE; i++) writeFileSync(join(nowhere, `buoy-${String(i).padStart(4, '0')}.txt`), 'buoy\n');

    spawns = counted();
    const observe = (event: IgnoreCheckEvent) => void events.push(event);
    check = createIgnoreCheck({ env: repo.serviceEnv(), execFile: spawns.execFile, observe });
    unbounded = createIgnoreCheck({ env: repo.serviceEnv(), execFile: spawns.execFile, concurrency: Number.POSITIVE_INFINITY, observe });
    withCheck = createFilesService({ records, ignored: check.names });
    withUnbounded = createFilesService({ records, ignored: unbounded.names });
    without = createFilesService({ records });

    const git = execFileSync('/usr/bin/git', ['--version'], { encoding: 'utf8' }).trim();
    print('machine', `cpus=${os.cpus().length} memory=${(os.totalmem() / 2 ** 30).toFixed(1)}GiB kernel=${os.type()} ${os.release()} ${git} node=${process.version}`);
  }, 600_000);

  afterAll(async () => {
    withCheck?.dispose();
    withUnbounded?.dispose();
    without?.dispose();
    await Promise.all([check?.dispose(), unbounded?.dispose()]);
    repo?.dispose();
    if (nowhere) rmSync(nowhere, { recursive: true, force: true });
  });

  // Three listings to warm up, then twenty one after another, each timed; with the check and without it
  async function timed(label: string, appSessionId: AppSessionId, path: string, expected: number): Promise<void> {
    const counts: number[] = [];
    for (const [variant, files] of [['with', withCheck], ['without', without]] as const) {
      for (let i = 0; i < WARM; i++) await files.list({ appSessionId, path });
      events.length = 0;
      const times: number[] = [];
      const markedEach: number[] = [];
      for (let i = 0; i < TIMED; i++) {
        const started = performance.now();
        const listing = await files.list({ appSessionId, path });
        times.push(performance.now() - started);
        expect(listing.entries).toHaveLength(WIDE);
        markedEach.push(marked(listing));
      }
      print(`${label}.${variant}.median_ms`, median(times).toFixed(1));
      print(`${label}.${variant}.max_ms`, Math.max(...times).toFixed(1));
      if (variant === 'with') {
        printQueue(label);
        print(`${label}.marked`, new Set(markedEach).size === 1 ? markedEach[0]! : markedEach.join(','));
        counts.push(...markedEach);
      } else expect(markedEach.every((count) => count === 0)).toBe(true);
    }
    // the run's first call on its own (Decision Log 9 and 10): ls-files of the directory, asked in the repository's root,
    // in a repository of 22,000 tracked files; outside any repository the check starts no git
    if (appSessionId === NOWHERE) {
      print(`${label}.lsfiles.median_ms`, 'none');
      print(`${label}.lsfiles.max_ms`, 'none');
      expect(counts).toEqual(Array(TIMED).fill(expected));
      return;
    }
    const run = createGitRunner({ env: repo.serviceEnv() });
    const lsFiles = () => run(repo.root, ['--literal-pathspecs', 'ls-files', '-z', '--', `${relative(repo.root, path)}/`]);
    for (let i = 0; i < WARM; i++) await lsFiles();
    const lsTimes: number[] = [];
    for (let i = 0; i < TIMED; i++) {
      const started = performance.now();
      await lsFiles();
      lsTimes.push(performance.now() - started);
    }
    print(`${label}.lsfiles.median_ms`, median(lsTimes).toFixed(1));
    print(`${label}.lsfiles.max_ms`, Math.max(...lsTimes).toFixed(1));
    expect(counts).toEqual(Array(TIMED).fill(expected));
  }

  it('mixed: a folder of 5,000 in a repository of 20,000 tracked files', async () => {
    await timed('mixed', MIXED, repo.path('wide'), 1_000);
  });

  it('all-ignored: a folder of 5,000 inside a folder a rule ignores', async () => {
    await timed('all-ignored', MIXED, repo.path('node_modules/anchor-kit'), WIDE);
  });

  it('no-repository: a folder of 5,000 outside any repository', async () => {
    await timed('no-repository', NOWHERE, nowhere, 0);
  });

  it('burst: the 200 folders of the mixed repository listed at once', async () => {
    const folders = Array.from({ length: FOLDERS }, (_, d) => repo.path(`harbor-${String(d).padStart(3, '0')}`));
    const burst = (files: FilesService) => Promise.all(folders.map((path) => files.list({ appSessionId: MIXED, path })));
    await burst(without); // the folders' metadata read once before any variant is timed
    const results: Record<string, number> = {};
    for (const [variant, files] of [['with', withCheck], ['unbounded', withUnbounded], ['without', without]] as const) {
      spawns.reset();
      events.length = 0;
      const started = performance.now();
      const listings = await burst(files);
      print(`burst.${variant}.total_ms`, (performance.now() - started).toFixed(1));
      if (variant !== 'without') printQueue(`burst.${variant}`);
      for (const listing of listings) expect(listing.entries).toHaveLength(TRACKED_PER_FOLDER + IGNORED_PER_FOLDER);
      if (variant === 'without') continue;
      results[variant] = listings.filter((listing) => marked(listing) === IGNORED_PER_FOLDER).length;
      print(`burst.${variant}.listings_marked`, results[variant]!);
      print(`burst.${variant}.live_max`, spawns.most());
    }
    expect(results.with).toBe(FOLDERS);
  });
});
