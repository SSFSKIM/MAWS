// The ignore check of a listing (UX wave U6b-3a, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md,
// decisions 12 and 13, sequence S1, M1 "What it proves"). Over real repositories made under a temporary folder with an
// empty home: the facts of git the check rests on. Over stand-in spawn functions: its bound, its places and its
// disposal, on a clock the test moves, and once over a real process group held open.
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { GitFixture, runGit } from '../../../test/support/git-fixture';
import { createGitRunner, execGit, type ExecFileFn } from '../git/runner';
import { createIgnoreCheck, IGNORED_CHECK_CONCURRENCY, IGNORED_CHECK_MS, type IgnoreCheck } from './ignored';
import { createFilesService } from './service';

let fixtures: GitFixture[];
let temps: string[];
let checks: IgnoreCheck[];
let warned: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fixtures = [];
  temps = [];
  checks = [];
  warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(checks.map((check) => check.dispose()));
  for (const fixture of fixtures) fixture.dispose();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function repository(): Promise<GitFixture> {
  const repo = await GitFixture.create();
  fixtures.push(repo);
  return repo;
}
function temp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'maws-ignored-')));
  temps.push(dir);
  return dir;
}
function checkOf(options: Parameters<typeof createIgnoreCheck>[0]): IgnoreCheck {
  const check = createIgnoreCheck(options);
  checks.push(check);
  return check;
}
const sorted = (answer: ReadonlySet<string> | null) => (answer === null ? null : [...answer].sort());

// A spawn function over git whose first call is held until `open`, so that asks made meanwhile join the next run
function gatedFirstRun() {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let started!: () => void;
  const firstCall = new Promise<void>((resolve) => (started = resolve));
  const made: { args: string[]; input: string | undefined }[] = [];
  const execFile: ExecFileFn = (file, args, options, callback) => {
    made.push({ args: args.slice(2), input: options.input });
    if (made.length > 1) return execGit(file, args, options, callback);
    started();
    void gate.then(() => execGit(file, args, options, callback));
    return undefined;
  };
  return { execFile, made, firstCall, open };
}

describe('the ignore check over a real repository', () => {
  it('rests on git naming a path as it was asked, and on exit 1 when nothing is ignored', async () => {
    const repo = await repository();
    await repo.write('.gitignore', '*.log\n');
    await repo.write('x.log', 'log\n');
    const run = createGitRunner({ env: repo.serviceEnv() });
    expect(await run(repo.root, ['check-ignore', '-z', '--stdin'], { input: './x.log\0./README.md\0', acceptExitCodes: [1] })).toBe('./x.log\0');
    expect(await run(repo.root, ['check-ignore', '-z', '--stdin'], { input: './README.md\0', acceptExitCodes: [1] })).toBe('');
  });

  it('answers a file a pattern names, a folder a rule names and an entry of an ignored folder asked there; not a tracked file that matches, beside its untracked twin', async () => {
    const repo = await repository();
    await repo.write('.gitignore', '*.log\nbuild/\n');
    await repo.write('tracked.log', 'kept on purpose\n');
    await repo.git('add', '-f', 'tracked.log');
    await repo.git('commit', '-q', '-m', 'a tracked log');
    await repo.write('untracked.log', 'noise\n');
    await repo.write('build/out.js', 'built\n');
    await repo.write('src/cart.ts', 'export {};\n');
    const check = checkOf({ env: repo.serviceEnv() });
    expect(sorted(await check.names(repo.root, ['.gitignore', 'README.md', 'build', 'src', 'tracked.log', 'untracked.log']))).toEqual(['build', 'untracked.log']);
    expect(sorted(await check.names(repo.path('build'), ['out.js']))).toEqual(['out.js']);
    expect(sorted(await check.names(repo.path('src'), ['cart.ts']))).toEqual([]);
  });

  // Index-mode `check-ignore` names no folder that holds a tracked file (its pathspec matches an index entry); the check
  // asks with --no-index, so it leaves out every name that is a tracked path or the first segment of one (Decision Log 9)
  it('answers a folder a rule names that holds nothing tracked, and not one a rule names that holds a tracked file, as index mode does', async () => {
    const repo = await repository();
    await repo.write('.gitignore', 'vendor/\nbuild/\n');
    await repo.write('vendor/kept.js', 'kept on purpose\n');
    await repo.git('add', '-f', 'vendor/kept.js');
    await repo.git('commit', '-q', '-m', 'a vendored file');
    await repo.write('vendor/fresh.js', 'new\n');
    await repo.write('build/out.js', 'built\n');
    const run = createGitRunner({ env: repo.serviceEnv() });
    const indexMode = await run(repo.root, ['check-ignore', '-z', '--stdin'], { input: './vendor\0./build\0', acceptExitCodes: [1] });
    expect(indexMode).toBe('./build\0'); // the rule the check keeps, as git's index mode answers it
    const check = checkOf({ env: repo.serviceEnv() });
    expect(sorted(await check.names(repo.root, ['build', 'vendor']))).toEqual(['build']);
    expect(sorted(await check.names(repo.path('vendor'), ['fresh.js', 'kept.js']))).toEqual(['fresh.js']); // inside it, the tracked file alone is plain
  });

  it('in one run of folders of one repository, keeps a tracked file a rule names unmarked in one while another’s ignored file is marked, and reads * [ and : in a name or a folder as text', async () => {
    const repo = await repository();
    await repo.write('.gitignore', '*.log\n');
    await repo.write('g[1]/kept.log', 'kept on purpose\n');
    await repo.write(':(exclude)k/kept.log', 'kept on purpose\n'); // a folder whose name reads as pathspec magic
    await repo.git('--literal-pathspecs', 'add', '-f', 'g[1]/kept.log', ':(exclude)k/kept.log');
    await repo.git('commit', '-q', '-m', 'two tracked logs');
    await repo.write('g[1]/a*.log', 'x\n');
    await repo.write('g[1]/[x].log', 'x\n');
    await repo.write('g[1]/notes.md', 'x\n');
    await repo.write(':(exclude)k/fresh.log', 'x\n');
    await repo.write('g1/kept.log', 'x\n'); // what `g[1]/` would match as a glob: untracked here, so ignored
    await repo.write('seed/s.log', 'x\n');
    const runs = gatedFirstRun();
    const check = checkOf({ env: repo.serviceEnv(), execFile: runs.execFile });
    const seed = check.names(repo.path('seed'), ['s.log']);
    await runs.firstCall; // the seed's run holds the repository: the asks below join its next run
    const brackets = check.names(repo.path('g[1]'), ['[x].log', 'a*.log', 'kept.log', 'notes.md']);
    const plain = check.names(repo.path('g1'), ['kept.log']);
    const magic = check.names(repo.path(':(exclude)k'), ['fresh.log', 'kept.log']);
    await settle();
    runs.open();
    expect(sorted(await seed)).toEqual(['s.log']);
    expect(sorted(await brackets)).toEqual(['[x].log', 'a*.log']); // its tracked kept.log stays plain
    expect(sorted(await plain)).toEqual(['kept.log']); // the same name, untracked in g1, is marked
    expect(sorted(await magic)).toEqual(['fresh.log']);
    expect(runs.made.map((run) => (run.args.includes('ls-files') ? 'ls-files' : 'check-ignore'))).toEqual(['ls-files', 'check-ignore', 'ls-files', 'check-ignore']); // the seed's run, then one run for the three folders
    expect(runs.made[2]!.args.slice(0, 4)).toEqual(['--literal-pathspecs', 'ls-files', '-z', '--']);
    expect(runs.made[2]!.args.slice(4).sort()).toEqual([':(exclude)k/', 'g1/', 'g[1]/']);
    expect(runs.made[3]!.input!.split('\0').filter((path) => path !== '').sort()).toEqual(['./:(exclude)k/fresh.log', './g1/kept.log', './g[1]/[x].log', './g[1]/a*.log', './g[1]/notes.md']);
  });

  it('finds a linked worktree’s repository by its .git file, and judges its folder by its own rules', async () => {
    const repo = await repository();
    await repo.write('.gitignore', '*.log\n');
    await repo.git('add', '.gitignore');
    await repo.git('commit', '-q', '-m', 'rules');
    const worktree = await repo.addWorktree('wt');
    writeFileSync(join(worktree, 'trace.log'), 'x\n');
    writeFileSync(join(worktree, 'notes.md'), 'x\n');
    const check = checkOf({ env: repo.serviceEnv() });
    expect(sorted(await check.names(worktree, ['README.md', 'notes.md', 'trace.log']))).toEqual(['trace.log']);
  });

  // Asked bare, git 2.43 reads `:notes.txt` as a pathspec with empty magic, so it judges `notes.txt` and answers nothing
  // (M1 decision 6, seen on the build VM); `./` keeps such a name a name.
  it('answers a name that begins with a colon and one that begins with a dash when only a pattern for that name matches, beside the plain name it does not', async () => {
    const repo = await repository();
    await repo.write('.gitignore', ':*\n-*\n');
    await repo.write(':notes.txt', 'a\n');
    await repo.write('-notes.txt', 'b\n');
    await repo.write('notes.txt', 'c\n');
    const check = checkOf({ env: repo.serviceEnv() });
    expect(sorted(await check.names(repo.root, [':notes.txt', '-notes.txt', 'notes.txt']))).toEqual(['-notes.txt', ':notes.txt']);
  });

  it('judges a folder of a nested repository by that repository’s rules, not the outer one’s', async () => {
    const repo = await repository();
    await repo.write('.gitignore', '*.tmp\n');
    await repo.write('outer.tmp', 'x\n');
    await repo.write('inner/.gitignore', '*.cache\n');
    await runGit(repo.path('inner'), ['init', '-q', '-b', 'main']);
    await repo.write('inner/a.tmp', 'x\n');
    await repo.write('inner/b.cache', 'x\n');
    const check = checkOf({ env: repo.serviceEnv() });
    expect(sorted(await check.names(repo.path('inner'), ['.gitignore', 'a.tmp', 'b.cache']))).toEqual(['b.cache']);
    expect(sorted(await check.names(repo.root, ['outer.tmp', 'inner']))).toEqual(['outer.tmp']); // the outer rule holds in its own repository
  });

  it('answers an empty set when nothing is ignored, and no answer outside a repository or where git cannot read the configuration, beside a repository that answers', async () => {
    const good = await repository();
    await good.write('.gitignore', '*.log\n');
    await good.write('a.log', 'x\n');
    const bad = await repository();
    await bad.write('.gitignore', '*.log\n');
    await bad.write('a.log', 'x\n');
    writeFileSync(bad.path('.git/config'), '[core\nthis is no configuration\n');
    const nowhere = temp();
    writeFileSync(join(nowhere, 'a.log'), 'x\n');
    const check = checkOf({ env: good.serviceEnv() });
    expect(sorted(await check.names(good.root, ['a.log']))).toEqual(['a.log']); // the control: the same ask answers in a good repository
    const none = await check.names(good.root, ['README.md']);
    expect(none).not.toBeNull();
    expect(sorted(none)).toEqual([]);
    expect(await check.names(nowhere, ['a.log'])).toBeNull();
    expect(await check.names(bad.root, ['a.log'])).toBeNull();
  });

  it('logs no line for a folder that is no repository, and one line naming no folder for another reason, the first time it occurs', async () => {
    const bad = await repository();
    writeFileSync(bad.path('.git/config'), '[core\nthis is no configuration\n');
    const nowhere = temp();
    const check = checkOf({ env: bad.serviceEnv() });
    expect(await check.names(nowhere, ['a.log'])).toBeNull();
    expect(warned).not.toHaveBeenCalled();
    expect(await check.names(bad.root, ['a.log'])).toBeNull();
    expect(await check.names(bad.root, ['b.log'])).toBeNull();
    expect(warned).toHaveBeenCalledTimes(1);
    const line = String(warned.mock.calls[0]![0]);
    expect(line).toMatch(/^\[files\] /);
    expect(line).not.toContain(bad.root);
    expect(line).not.toContain(nowhere);
  });

  it('names an ignored file no longer once it is added to the index by force, while its untracked twin still is', async () => {
    const repo = await repository();
    await repo.write('.gitignore', '*.gen\n');
    await repo.write('kept.gen', 'x\n');
    await repo.write('twin.gen', 'x\n');
    const check = checkOf({ env: repo.serviceEnv() });
    expect(sorted(await check.names(repo.root, ['kept.gen', 'twin.gen']))).toEqual(['kept.gen', 'twin.gen']);
    await repo.git('add', '-f', 'kept.gen');
    expect(sorted(await check.names(repo.root, ['kept.gen', 'twin.gen']))).toEqual(['twin.gen']);
  });

  it('asked in a subfolder, names a file a rule of the ignore file above names, and not once that rule is removed, while another rule still holds', async () => {
    const repo = await repository();
    await repo.write('.gitignore', '*.gen\n*.out\n');
    await repo.write('deep/a.gen', 'x\n');
    await repo.write('deep/b.out', 'x\n');
    const check = checkOf({ env: repo.serviceEnv() });
    expect(sorted(await check.names(repo.path('deep'), ['a.gen', 'b.out']))).toEqual(['a.gen', 'b.out']);
    await repo.write('.gitignore', '*.out\n');
    expect(sorted(await check.names(repo.path('deep'), ['a.gen', 'b.out']))).toEqual(['b.out']);
  });
});

// A repository as the check finds one, by its `.git` entry, for a spawn function that stands in for git
function fakeRepo(...dirs: string[]): string {
  const root = temp();
  mkdirSync(join(root, '.git'));
  for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
  return root;
}
// Lets the asks' walks to their repositories, which read the disk, finish (they cannot be awaited from outside)
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await lstat(tmpdir()).catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

interface HeldRun {
  args: string[]; // as git is given them after `-C <directory>`
  directory: string;
  input: string | undefined;
  answer(error: Error | null, stdout: string): void;
}
// A spawn function whose runs are held by the test: each call is kept, with what it was asked, until the test answers
// it; `live` counts those not yet answered, and `reached(n)` settles once `n` calls were made.
function heldRuns() {
  const pending: HeldRun[] = [];
  const made: HeldRun[] = [];
  const waiters: { n: number; resolve: () => void }[] = [];
  let live = 0;
  let most = 0;
  const execFile: ExecFileFn = (_file, args, options, callback) => {
    most = Math.max(most, ++live);
    const run: HeldRun = {
      args: args.slice(2),
      directory: args[1]!,
      input: options.input,
      answer: (error, stdout) => {
        live--;
        callback(error as never, stdout, '');
      },
    };
    pending.push(run);
    made.push(run);
    for (const waiter of waiters.filter((one) => made.length >= one.n)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  };
  const reached = (n: number) => (made.length >= n ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ n, resolve })));
  return { execFile, pending, made, reached, counts: () => ({ calls: made.length, live, most }) };
}
const isLsFiles = (run: HeldRun) => run.args.includes('ls-files');
// Answers each held run as git would if nothing were tracked and every name asked were ignored
const echo = (run: HeldRun) => run.answer(null, isLsFiles(run) ? '' : run.input!);
// Answers held runs as they come until every one of `answers` has settled
async function drain(pending: HeldRun[], answers: Promise<unknown>[], reply: (run: HeldRun) => void = echo): Promise<void> {
  let settled = 0;
  void Promise.all(answers.map((answer) => answer.then(() => void (settled += 1))));
  while (settled < answers.length) {
    await vi.waitFor(() => expect(pending.length > 0 || settled === answers.length).toBe(true));
    const run = pending.shift();
    if (run) reply(run);
  }
}

describe('the bound and the places', () => {
  it('gives no answer when the test’s clock reaches the bound, and nothing more past the runner’s own kill delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { execFile, reached } = heldRuns(); // never answered
    const repo = fakeRepo();
    const check = checkOf({ execFile });
    let answers = 0;
    let answer: ReadonlySet<string> | null | undefined;
    void check.names(repo, ['a.log']).then((value) => ((answers += 1), (answer = value)));
    await reached(1);
    await vi.advanceTimersByTimeAsync(IGNORED_CHECK_MS - 1);
    expect(answers).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(answers).toBe(1);
    expect(answer).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000); // past the runner's SIGKILL half a second after its timeout, which rejects its run
    expect(answers).toBe(1);
  });

  it('answers a listing whose check never answers with all its entries, none marked, once the bound has passed, beside a check that marks one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const repo = fakeRepo('work');
    const dir = join(repo, 'work');
    writeFileSync(join(dir, 'a.txt'), 'a');
    writeFileSync(join(dir, 'b.log'), 'b');
    const S = 'app-ignored' as AppSessionId;
    const records = (id: AppSessionId) => (id === S ? { directory: dir, additionalDirectories: [], worktree: null } : null);
    const { execFile, reached } = heldRuns(); // never answered
    const silent = checkOf({ execFile });
    const files = createFilesService({ records, ignored: silent.names });
    const listing = files.list({ appSessionId: S, path: dir });
    await reached(1);
    await vi.advanceTimersByTimeAsync(IGNORED_CHECK_MS);
    const answer = await listing;
    expect(answer.entries.map((entry) => entry.name)).toEqual(['a.txt', 'b.log']);
    expect(answer.entries.filter((entry) => 'ignored' in entry)).toEqual([]);
    files.dispose();
    // the control: the same listing, with a check that answers, marks the entry it names
    const answering = checkOf({ execFile: (_file, args, _options, callback) => void queueMicrotask(() => callback(null, args.includes('ls-files') ? 'work/a.txt\0' : './work/b.log\0', '')) });
    const marked = createFilesService({ records, ignored: answering.names });
    expect((await marked.list({ appSessionId: S, path: dir })).entries.filter((entry) => 'ignored' in entry).map((entry) => entry.name)).toEqual(['b.log']);
    marked.dispose();
  });

  it(`runs at most ${IGNORED_CHECK_CONCURRENCY} runs at once for ten checks in ten repositories, and answers all ten`, async () => {
    const { execFile, pending, reached, counts } = heldRuns();
    const check = checkOf({ execFile, allowanceMs: 600_000 }); // the bound is not what this case reads
    const answers = Array.from({ length: 10 }, (_, i) => check.names(fakeRepo(), [`f${i}.log`]));
    await reached(IGNORED_CHECK_CONCURRENCY);
    await settle();
    expect(counts()).toEqual({ calls: IGNORED_CHECK_CONCURRENCY, live: IGNORED_CHECK_CONCURRENCY, most: IGNORED_CHECK_CONCURRENCY });
    await drain(pending, answers);
    expect((await Promise.all(answers)).map(sorted)).toEqual(Array.from({ length: 10 }, (_, i) => [`f${i}.log`]));
    expect(counts()).toEqual({ calls: 20, live: 0, most: IGNORED_CHECK_CONCURRENCY }); // each check's two runs, one after the other in its place
  });

  it('coalesces the asks of one repository that arrive while its run is in flight into its next run, and answers each its own names', async () => {
    const dirs = Array.from({ length: 10 }, (_, i) => `d${i}`);
    const repo = fakeRepo(...dirs);
    const { execFile, pending, made, reached, counts } = heldRuns();
    const check = checkOf({ execFile, allowanceMs: 600_000 });
    const first = check.names(join(repo, 'd0'), ['f0.log']);
    await reached(1); // the first run's ls-files, held
    const rest = dirs.slice(1).map((dir, i) => check.names(join(repo, dir), [`f${i + 1}.log`, 'plain.txt']));
    await settle();
    expect(counts().calls).toBe(1); // the nine wait for the repository's run in flight, not for a place
    await drain(pending, [first, ...rest], (run) => run.answer(null, isLsFiles(run) ? '' : run.input!.split('\0').filter((path) => path.endsWith('.log')).map((path) => `${path}\0`).join('')));
    expect(sorted(await first)).toEqual(['f0.log']);
    expect((await Promise.all(rest)).map(sorted)).toEqual(dirs.slice(1).map((_, i) => [`f${i + 1}.log`]));
    expect(counts()).toEqual({ calls: 4, live: 0, most: 1 }); // two runs of two: the first ask's, then the nine's together
    expect(made.map((run) => run.directory)).toEqual(Array(4).fill(repo)); // every run in the repository's root
    expect(made[2]!.args.slice(0, 4)).toEqual(['--literal-pathspecs', 'ls-files', '-z', '--']);
    expect(made[2]!.args.slice(4).sort()).toEqual(dirs.slice(1).map((dir) => `${dir}/`));
    expect(made[3]!.args).toEqual(['check-ignore', '--no-index', '-z', '--stdin']);
    expect(made[3]!.input!.split('\0').filter((path) => path !== '').sort()).toEqual(dirs.slice(1).flatMap((dir, i) => [`./${dir}/f${i + 1}.log`, `./${dir}/plain.txt`]).sort());
  });

  it('asks check-ignore with --no-index about the names ls-files does not track, each as ./<folder>/<name>, and ls-files about the folder alone', async () => {
    const repo = fakeRepo('harbor');
    const { execFile, pending, made } = heldRuns();
    const check = checkOf({ execFile });
    const answer = check.names(join(repo, 'harbor'), ['src', 'README.md', 'debug.log', 'node_modules']);
    const atRoot = (async () => {
      await answer;
      return check.names(repo, ['harbor', 'notes.md']);
    })();
    await drain(pending, [answer, atRoot], (run) => run.answer(null, isLsFiles(run) ? 'harbor/src/cart.ts\0harbor/src/lib/rates.ts\0harbor/README.md\0' : run.input!.split('\0').filter((path) => path.endsWith('.log') || path.endsWith('.md')).map((path) => `${path}\0`).join('')));
    expect(sorted(await answer)).toEqual(['debug.log']);
    expect(sorted(await atRoot)).toEqual(['notes.md']); // `harbor` holds tracked files: never asked
    expect(made.map((run) => [run.args, run.input])).toEqual([
      [['--literal-pathspecs', 'ls-files', '-z', '--', 'harbor/'], undefined],
      [['check-ignore', '--no-index', '-z', '--stdin'], './harbor/debug.log\0./harbor/node_modules\0'],
      [['--literal-pathspecs', 'ls-files', '-z', '--', '.'], undefined],
      [['check-ignore', '--no-index', '-z', '--stdin'], './notes.md\0'],
    ]);
  });

  it('gives no answer and runs no check-ignore when ls-files fails, beside a check whose ls-files answers', async () => {
    const repo = fakeRepo();
    const subcommands: string[] = [];
    const failing: ExecFileFn = (_file, args, _options, callback) => {
      subcommands.push(args.includes('ls-files') ? 'ls-files' : 'check-ignore');
      queueMicrotask(() => callback(Object.assign(new Error('Git exited with 128'), { code: 128 }), '', 'fatal: unreadable index\n'));
    };
    expect(await checkOf({ execFile: failing }).names(repo, ['debug.log'])).toBeNull();
    expect(subcommands).toEqual(['ls-files']);
    const answering: ExecFileFn = (_file, args, _options, callback) => {
      subcommands.push(args.includes('ls-files') ? 'ls-files' : 'check-ignore');
      queueMicrotask(() => callback(null, args.includes('ls-files') ? '' : './debug.log\0', ''));
    };
    expect(sorted(await checkOf({ execFile: answering }).names(repo, ['debug.log']))).toEqual(['debug.log']); // the control
    expect(subcommands).toEqual(['ls-files', 'ls-files', 'check-ignore']);
  });

  it('starts no git for a folder in no repository or inside a .git folder, beside one in a repository that does', async () => {
    const { execFile, pending, counts } = heldRuns();
    const check = checkOf({ execFile });
    const repo = fakeRepo('.git/objects', 'src');
    const nowhere = temp();
    expect(await check.names(nowhere, ['a.log'])).toBeNull();
    expect(await check.names(join(repo, '.git'), ['config'])).toBeNull();
    expect(await check.names(join(repo, '.git/objects'), ['pack'])).toBeNull();
    expect(counts().calls).toBe(0);
    expect(warned).not.toHaveBeenCalled();
    const inside = check.names(join(repo, 'src'), ['a.log']); // the control
    await drain(pending, [inside]);
    expect(sorted(await inside)).toEqual(['a.log']);
    expect(counts().calls).toBe(2);
  });

  it('bounds each ask by its own deadline: an ask that expires while it waits is dropped from its run, one that expires during the run gets no answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const repo = fakeRepo('x', 'y', 'z');
    const { execFile, pending, made, reached } = heldRuns();
    const check = checkOf({ execFile });
    const got: Record<string, ReadonlySet<string> | null | undefined> = {};
    void check.names(join(repo, 'x'), ['a.log']).then((value) => void (got.x = value));
    await reached(1); // x's run holds the repository from t = 0
    await vi.advanceTimersByTimeAsync(400);
    void check.names(join(repo, 'y'), ['a.log']).then((value) => void (got.y = value)); // deadline 2,400
    await settle();
    await vi.advanceTimersByTimeAsync(600);
    void check.names(join(repo, 'z'), ['a.log']).then((value) => void (got.z = value)); // deadline 3,000
    await settle();
    await vi.advanceTimersByTimeAsync(IGNORED_CHECK_MS - 1_000 + 500); // t = 2,500: x's and y's bounds have passed, both waiting
    expect([got.x, got.y, got.z]).toEqual([null, null, undefined]);
    pending.shift()!.answer(null, ''); // x's ls-files, which the runner gave up at x's deadline and its kill delay: too late
    await reached(2);
    expect(made[1]!.args.slice(1, 2)).toEqual(['ls-files']); // the next run: z's alone, y dropped
    expect(made[1]!.args.slice(4)).toEqual(['z/']);
    echo(pending.shift()!);
    await reached(3);
    expect(made[2]!.input).toBe('./z/a.log\0');
    echo(pending.shift()!);
    await vi.advanceTimersByTimeAsync(0);
    expect(sorted(got.z ?? null)).toEqual(['a.log']);
  });

  it('gives a run the latest deadline among the asks it carries, so a late ask is still answered after an earlier one expired in it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const repo = fakeRepo('x', 'y', 'z');
    const { execFile, pending, made, reached } = heldRuns();
    const check = checkOf({ execFile });
    const got: Record<string, ReadonlySet<string> | null | undefined> = {};
    void check.names(join(repo, 'x'), ['a.log']).then((value) => void (got.x = value));
    await reached(1);
    void check.names(join(repo, 'y'), ['a.log']).then((value) => void (got.y = value)); // deadline 2,000
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    void check.names(join(repo, 'z'), ['a.log']).then((value) => void (got.z = value)); // deadline 3,000
    await settle();
    echo(pending.shift()!); // x's ls-files, then its check-ignore
    await reached(2);
    echo(pending.shift()!);
    await reached(3); // y and z's run starts at t = 1,000
    echo(pending.shift()!); // its ls-files; its check-ignore is held
    await reached(4);
    await vi.advanceTimersByTimeAsync(1_000); // t = 2,000: y's bound passes inside the run
    expect(got.y).toBeNull();
    await vi.advanceTimersByTimeAsync(800); // t = 2,800: past y's deadline and its kill delay, short of z's
    expect(made[3]!.input).toBe('./y/a.log\0./z/a.log\0');
    echo(pending.shift()!);
    await vi.advanceTimersByTimeAsync(0);
    expect(sorted(got.z ?? null)).toEqual(['a.log']);
    expect(got.y).toBeNull();
  });

  it('frees a timed-out run’s place only when its child has closed, not when the runner gives the run up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const children: EventEmitter[] = [];
    let calls = 0;
    let spawned!: () => void;
    const firstSpawn = new Promise<void>((resolve) => (spawned = resolve));
    // A child that never answers and closes only when the test says (a git blocked in the filesystem, past its SIGKILL)
    const execFile: ExecFileFn = () => {
      calls++;
      spawned();
      const child = new EventEmitter();
      children.push(child);
      return child as unknown as ChildProcess;
    };
    const check = checkOf({ execFile, concurrency: 1 });
    const first = check.names(fakeRepo(), ['a.log']);
    await firstSpawn; // after the walk, which reads the disk while the clock stands
    await vi.advanceTimersByTimeAsync(1_000);
    const second = check.names(fakeRepo(), ['b.log']); // deadline 3,000; waits for the one place
    await settle();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(IGNORED_CHECK_MS - 1_000 + 600); // t = 2,600: past the first's bound, its timeout and the runner's kill delay
    expect(await first).toBeNull();
    expect(calls).toBe(1); // the runner gave the run up at 2,500, but its child has not closed: the place is still held
    children[0]!.emit('close', null, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2); // the place is free once the child closed
    const disposed = check.dispose();
    expect(await second).toBeNull();
    children[1]!.emit('close', null, 'SIGKILL'); // the stand-in has no process group to kill: its close is the test's
    await disposed;
  });

  it('never starts the run of a check that waited for a place its whole bound', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { execFile, reached, counts } = heldRuns(); // never answered
    const check = checkOf({ execFile });
    const answers = Array.from({ length: IGNORED_CHECK_CONCURRENCY + 1 }, () => check.names(fakeRepo(), ['a.log']));
    await reached(IGNORED_CHECK_CONCURRENCY);
    await settle();
    expect(counts().calls).toBe(IGNORED_CHECK_CONCURRENCY); // the last one waits
    await vi.advanceTimersByTimeAsync(IGNORED_CHECK_MS);
    expect(await Promise.all(answers)).toEqual(Array(IGNORED_CHECK_CONCURRENCY + 1).fill(null));
    await vi.advanceTimersByTimeAsync(1_000); // the held runs end at the runner's kill and free their places
    expect(counts().calls).toBe(IGNORED_CHECK_CONCURRENCY);
  });

  it('answers every running and waiting check with no answer at its disposal, and starts nothing after', async () => {
    const { execFile, reached, counts } = heldRuns(); // never answered
    const check = checkOf({ execFile, allowanceMs: 600_000 });
    const repo = fakeRepo();
    const answers = Array.from({ length: IGNORED_CHECK_CONCURRENCY + 2 }, () => check.names(fakeRepo(), ['a.log']));
    answers.push(check.names(repo, ['b.log']));
    await reached(IGNORED_CHECK_CONCURRENCY);
    await settle();
    expect(counts().calls).toBe(IGNORED_CHECK_CONCURRENCY); // the control: four run and three wait
    void check.dispose();
    expect(await Promise.all(answers)).toEqual(Array(IGNORED_CHECK_CONCURRENCY + 3).fill(null));
    expect(await check.names(repo, ['a.log'])).toBeNull();
    expect(counts().calls).toBe(IGNORED_CHECK_CONCURRENCY);
  });
});

// Whether a process answers signal 0. A killed process that its new parent has not reaped yet still answers it; such a
// zombie is no process alive, so its state is read where the system says it.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
  try {
    const state = process.platform === 'linux' ? (/^\d+ \(.*\) (\S)/s.exec(readFileSync(`/proc/${pid}/stat`, 'utf8'))?.[1] ?? '') : execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return !state.startsWith('Z');
  } catch {
    return false; // gone between the signal and the read
  }
}

describe('the daemon’s stop ends the check’s processes', () => {
  it('kills the process group a check holds open, its child included, and starts nothing for an ask after', async () => {
    const dir = fakeRepo();
    const pidFile = join(dir, 'sleeper.pid');
    const children: ChildProcess[] = [];
    // A shell that starts a sleeping child and waits for it, started exactly as git is: a group of its own, input piped
    const execFile: ExecFileFn = (_file, _args, options, callback) => {
      const child = execGit('/bin/sh', ['-c', 'sleep 300 & echo $! > "$1"; wait', 'sh', pidFile], options, callback);
      if (child) children.push(child);
      return child;
    };
    const check = checkOf({ env: { PATH: process.env.PATH }, execFile, allowanceMs: 600_000 });
    const answer = check.names(dir, ['a.log']);
    await vi.waitFor(() => expect(existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '').toBe(true), { timeout: 10_000 });
    const shell = children[0]!.pid!;
    const sleeper = Number(readFileSync(pidFile, 'utf8').trim());
    expect([alive(shell), alive(sleeper)]).toEqual([true, true]); // the control: both run before the disposal
    const disposed = check.dispose();
    expect(await answer).toBeNull();
    await disposed; // every child the check started has closed
    expect(alive(shell)).toBe(false);
    // the sleeper's new parent reaps it, not this process: its end is awaited, not assumed
    await vi.waitFor(() => expect(alive(sleeper)).toBe(false), { timeout: 10_000 });
    expect(await check.names(dir, ['a.log'])).toBeNull();
    expect(children).toHaveLength(1);
  });
});
