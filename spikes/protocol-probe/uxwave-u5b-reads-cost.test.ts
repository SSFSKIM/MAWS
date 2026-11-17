// UX wave U5b-2, P5 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, "Probes"; Concrete
// Steps 4a): this build's GitService timed for the three reads over a large public repository's clone, on the branch
// uxwave-u5b-reads-cost.sh made there. Not a regression test and no bound is asserted: it runs only when P5_REPO names
// that clone and P5_OUT a file for the numbers, and it writes durations (each read several times; the first apart),
// the counts of files and new files, and each answer's size.
//   P5_REPO=<scratch>/repo P5_SHAS=<scratch>/probe.json P5_OUT=<file> node_modules/.bin/vitest run \
//     --config spikes/protocol-probe/uxwave-u5b-reads-cost.vitest.config.ts
// The run changes that clone's work tree for its heavy case (200 new files of nearly the cap, its own, removed after).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { UNTRACKED_COUNT_BYTES, UNTRACKED_COUNT_FILES } from '../../src/shared/ipc/schema/git';
import { countAddedLines } from '../../src/services/fs/count-lines';
import { GitService } from '../../src/services/git/service';

const REPO = process.env.P5_REPO ?? '';
const OUT = process.env.P5_OUT ?? '';
const SHAS = process.env.P5_SHAS ?? '';
const RUNS = Number(process.env.P5_RUNS ?? 7);

interface Timing { label: string; first: number; median: number; min: number; max: number; runs: number[]; bytes: number; facts: Record<string, unknown> }

const git = (...args: string[]) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const ms = (n: number) => Math.round(n * 10) / 10;

async function timed<T>(label: string, read: () => Promise<T>, facts: (answer: T) => Record<string, unknown>): Promise<Timing> {
  const runs: number[] = [];
  let answer: T | undefined;
  for (let i = 0; i < RUNS; i++) {
    const at = performance.now();
    answer = await read();
    runs.push(ms(performance.now() - at));
  }
  const sorted = [...runs.slice(1)].sort((a, b) => a - b); // the first run apart: the page cache may be cold for it
  return { label, first: runs[0], median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1)!, runs, bytes: Buffer.byteLength(JSON.stringify(answer)), facts: facts(answer!) };
}

describe.runIf(REPO !== '' && OUT !== '' && SHAS !== '')('U5b-2 P5: the cost of the three reads', () => {
  it('times the branch read, the commit read and the working-tree read', async () => {
    const shas = JSON.parse(readFileSync(SHAS, 'utf8')) as { small: string; large: string; merge: string; start: string };
    const service = new GitService({ env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    const repository = {
      commits: Number(git('rev-list', '--count', 'HEAD')),
      files: git('ls-files').split('\n').length,
      commitGraph: existsSync(join(REPO, '.git', 'objects', 'info', 'commit-graph')), // what `git gc` or maintenance writes; a fresh clone has none
      gitVersion: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(),
      node: process.version,
    };
    const results: Timing[] = [];
    try {
      results.push(await timed('git status (the watcher\'s read, for scale)', () => service.status(REPO), (s) => ({ files: s.files.length, untracked: s.files.filter((f) => f.untracked).length })));
      const branch = await service.branchCommits({ directory: REPO, limit: 50 });
      results.push(await timed('git.branchCommits limit 50', () => service.branchCommits({ directory: REPO, limit: 50 }), (b) => ({ base: b.base?.ref, rows: b.commits.length, counts: b.counts, behind: b.behind, upstream: b.upstream })));
      const against = branch.base!.mergeBase;
      results.push(await timed(`git.changesSince against the merge base (${UNTRACKED_COUNT_FILES} of the new files counted)`, () => service.changesSince({ directory: REPO, against }), (c) => ({ files: c.files.length, untracked: c.untracked.length, counted: c.untracked.filter((u) => u.insertions !== null).length, patchBytes: Buffer.byteLength(c.patch) })));
      results.push(await timed('git.changesSince against HEAD', () => service.changesSince({ directory: REPO, against: 'HEAD' }), (c) => ({ files: c.files.length, untracked: c.untracked.length, patchBytes: Buffer.byteLength(c.patch) })));
      results.push(await timed('git.changesSince against the merge base, one path', () => service.changesSince({ directory: REPO, against, path: git('diff', '--name-only', against, '--').split('\n')[0] }), (c) => ({ files: c.files.length, patchBytes: Buffer.byteLength(c.patch) })));
      for (const [label, commit] of [['small (one file)', shas.small], ['large (200 files)', shas.large], ['merge (first parent)', shas.merge]] as const) {
        results.push(await timed(`git.commitDiff ${label}`, () => service.commitDiff({ directory: REPO, commit }), (d) => ({ files: d.files.length, onHead: d.onHead, patchBytes: Buffer.byteLength(d.patch) })));
      }
      results.push(await timed('git.commitDiff patch: false (the re-ask when HEAD moves)', () => service.commitDiff({ directory: REPO, commit: shas.merge, patch: false }), (d) => ({ onHead: d.onHead })));

      // the count alone, per file, for typical new files and for files of nearly the cap
      const listed = (await service.status(REPO)).files.filter((f) => f.untracked && !f.path.endsWith('/')).map((f) => f.path);
      results.push(await timed(`the count alone, ${listed.length} typical new files`, async () => {
        for (const path of listed) await countAddedLines(REPO, path, UNTRACKED_COUNT_BYTES);
        return listed.length;
      }, () => ({ files: listed.length })));

      // the heavy case: the typical new files moved aside, 200 new files of nearly the cap beside tracked files
      const aside = join(REPO, '..', 'p5-aside');
      mkdirSync(aside, { recursive: true });
      const moved = listed.map((path, i) => {
        const to = join(aside, String(i));
        execFileSync('mv', [join(REPO, path), to]);
        return [path, to] as const;
      });
      const dirs = [...new Set(moved.map(([path]) => path.slice(0, path.lastIndexOf('/'))))];
      const line = `${'x'.repeat(99)}\n`;
      const heavy = Array.from({ length: 200 }, (_, i) => `${dirs[i % dirs.length]}/p5_heavy_${String(i).padStart(3, '0')}.rs`);
      try {
        for (const path of heavy) writeFileSync(join(REPO, path), line.repeat(Math.floor((UNTRACKED_COUNT_BYTES - 1) / line.length)));
        results.push(await timed('git.changesSince against the merge base, 200 new files of nearly the cap', () => service.changesSince({ directory: REPO, against }), (c) => ({ files: c.files.length, untracked: c.untracked.length, counted: c.untracked.filter((u) => u.insertions !== null).length })));
      } finally {
        for (const path of heavy) rmSync(join(REPO, path), { force: true });
        for (const [path, to] of moved) execFileSync('mv', [to, join(REPO, path)]);
        rmSync(aside, { recursive: true, force: true });
      }
    } finally {
      service.dispose();
    }
    writeFileSync(OUT, JSON.stringify({ repository, runs: RUNS, results }, null, 1) + '\n');
    expect(results.length).toBeGreaterThan(0);
  }, 60 * 60_000);
});
