// The ignore check of a listing (UX wave U6b-3a, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md,
// decisions 12 and 13, sequence S1, M1 "What it proves"). Over real repositories made under a temporary folder with an
// empty home: the facts of git the check rests on. Over stand-in spawn functions: its bound, its places and its
// disposal, on a clock the test moves, and once over a real process group held open.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

  it('answers a name that begins with a colon and one that begins with a dash when a pattern names them', async () => {
    const repo = await repository();
    await repo.write('.gitignore', '*.log\n');
    await repo.write(':colon.log', 'a\n');
    await repo.write('-dash.log', 'b\n');
    await repo.write('plain.txt', 'c\n');
    const check = checkOf({ env: repo.serviceEnv() });
    expect(sorted(await check.names(repo.root, [':colon.log', '-dash.log', 'plain.txt']))).toEqual(['-dash.log', ':colon.log']);
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

// A spawn function whose runs are held by the test: each call is kept with its callback, and `live` counts those not
// yet called back.
function heldRuns() {
  const pending: Parameters<ExecFileFn>[3][] = [];
  let live = 0;
  let most = 0;
  let calls = 0;
  const execFile: ExecFileFn = (_file, _args, _options, callback) => {
    calls++;
    most = Math.max(most, ++live);
    pending.push((error, stdout, stderr) => {
      live--;
      callback(error, stdout, stderr);
    });
  };
  return { execFile, pending, counts: () => ({ calls, live, most }) };
}

describe('the bound and the places', () => {
  it('gives no answer when the test’s clock reaches the bound, and nothing more past the runner’s own kill delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { execFile, counts } = heldRuns(); // never called back
    const check = checkOf({ execFile });
    let answers = 0;
    let answer: ReadonlySet<string> | null | undefined;
    void check.names('/work/repo', ['a.log']).then((value) => ((answers += 1), (answer = value)));
    expect(counts().calls).toBe(1);
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
    const dir = temp();
    writeFileSync(join(dir, 'a.txt'), 'a');
    writeFileSync(join(dir, 'b.log'), 'b');
    const S = 'app-ignored' as AppSessionId;
    const records = (id: AppSessionId) => (id === S ? { directory: dir, additionalDirectories: [], worktree: null } : null);
    let started!: () => void;
    const asked = new Promise<void>((resolve) => (started = resolve));
    const silent = checkOf({ execFile: () => void started() });
    const files = createFilesService({ records, ignored: silent.names });
    const listing = files.list({ appSessionId: S, path: dir });
    await asked;
    await vi.advanceTimersByTimeAsync(IGNORED_CHECK_MS);
    const answer = await listing;
    expect(answer.entries.map((entry) => entry.name)).toEqual(['a.txt', 'b.log']);
    expect(answer.entries.filter((entry) => 'ignored' in entry)).toEqual([]);
    files.dispose();
    // the control: the same listing, with a check that answers, marks the entry it names
    const answering = checkOf({ execFile: (_file, _args, _options, callback) => void queueMicrotask(() => callback(null, './b.log\0', '')) });
    const marked = createFilesService({ records, ignored: answering.names });
    expect((await marked.list({ appSessionId: S, path: dir })).entries.filter((entry) => 'ignored' in entry).map((entry) => entry.name)).toEqual(['b.log']);
    marked.dispose();
  });

  it(`runs at most ${IGNORED_CHECK_CONCURRENCY} of ten checks asked at once, and answers all ten`, async () => {
    const { execFile, pending, counts } = heldRuns();
    const check = checkOf({ execFile, allowanceMs: 600_000 }); // the bound is not what this case reads
    const answers = Array.from({ length: 10 }, (_, i) => check.names('/work/repo', [`f${i}.log`]));
    expect(counts()).toEqual({ calls: IGNORED_CHECK_CONCURRENCY, live: IGNORED_CHECK_CONCURRENCY, most: IGNORED_CHECK_CONCURRENCY });
    for (let released = 0; released < 10; released++) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
      pending.shift()!(null, '', '');
    }
    expect(await Promise.all(answers)).toHaveLength(10);
    expect(counts()).toEqual({ calls: 10, live: 0, most: IGNORED_CHECK_CONCURRENCY });
  });

  it('never starts the run of a check that waited for a place its whole bound', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { execFile, counts } = heldRuns(); // never called back
    const check = checkOf({ execFile });
    const answers = Array.from({ length: IGNORED_CHECK_CONCURRENCY + 1 }, () => check.names('/work/repo', ['a.log']));
    expect(counts().calls).toBe(IGNORED_CHECK_CONCURRENCY); // the last one waits
    await vi.advanceTimersByTimeAsync(IGNORED_CHECK_MS);
    expect(await Promise.all(answers)).toEqual(Array(IGNORED_CHECK_CONCURRENCY + 1).fill(null));
    await vi.advanceTimersByTimeAsync(1_000); // the held runs end at the runner's kill and free their places
    expect(counts().calls).toBe(IGNORED_CHECK_CONCURRENCY);
  });

  it('answers every running and waiting check with no answer at its disposal, and starts nothing after', async () => {
    const { execFile, counts } = heldRuns(); // never called back
    const check = checkOf({ execFile, allowanceMs: 600_000 });
    const answers = Array.from({ length: IGNORED_CHECK_CONCURRENCY + 2 }, () => check.names('/work/repo', ['a.log']));
    expect(counts().calls).toBe(IGNORED_CHECK_CONCURRENCY); // the control: four run and two wait
    void check.dispose();
    expect(await Promise.all(answers)).toEqual(Array(IGNORED_CHECK_CONCURRENCY + 2).fill(null));
    expect(await check.names('/work/repo', ['a.log'])).toBeNull();
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
    const dir = temp();
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
