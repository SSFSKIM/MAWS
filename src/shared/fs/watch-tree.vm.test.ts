// P5 O3-E M1, Interfaces §G: the watch tree measured on a devcloud VM over O3-G's repositories
// (research/org/p5-o3-linux-repo-watch.md), the proof of acceptance 6. Skipped unless MAWS_WATCH_TREE_ROOTS names roots
// (comma-separated) on Linux; it reads /proc/self/fdinfo as O3-G's watch-measure.mjs did. Each root is watched through
// the product's path, the repository watcher of a GitService over the platform's recursive watch (on Linux the tree,
// with the git prune built over the real git runner), and read for: the inotify watches it takes, RSS growth with a
// forced GC, the event loop's worst lag during the initial walk, notification latency over 30 writes at the root and at
// the deepest and the largest tracked directory, and a 2,000-file burst created then removed in one new directory (the
// worst loop lag, and the time until every burst file was named). MAWS's checkout is also walked with the prune off,
// and is measured with a linked worktree under `.claude/worktrees/`, so the nested-checkout prune is read. With
// MAWS_WATCH_TREE_STORE the synthetic store (seeded when empty: 5,000 transcripts in one project, 200 in another) is
// watched through the store watcher's tree. MAWS_WATCH_TREE_EXHAUST=watches (after `sysctl` lowered
// max_user_watches to 600) or =instances (max_user_instances at the user's count) runs the exhaustion arm instead.
// Prints one line per arm and merges its numbers into test-results/watch-tree-vm.json. A missed bound fails the case
// (each read softly, so every line prints); it is a finding for the architect, never a widened bound.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { GitChanged } from '@shared/ipc/schema/git';
import { inotifyOf, until } from '../../../test/support/inotify';
import { Discovery } from '../../engine-host/fs/discovery';
import { resolveStorePaths } from '../../engine-host/fs/paths';
import { STORE_RECONCILE_MS, storePrune, StoreWatcher } from '../../engine-host/fs/watcher';
import { GitService } from '../../services/git/service';
import { recursiveWatch, watchTree, type WatchFn } from './watch-tree';

const ROOTS = (process.env.MAWS_WATCH_TREE_ROOTS ?? '').split(',').map((root) => root.trim()).filter((root) => root !== '');
const STORE = process.env.MAWS_WATCH_TREE_STORE?.trim() || null;
const EXHAUST = process.env.MAWS_WATCH_TREE_EXHAUST?.trim() || null; // 'watches' | 'instances'
const RESULTS = join('test-results', 'watch-tree-vm.json');

// From O3-G's directory-tree rows, with a fifth of room (§G).
const BOUND = {
  mawsWatches: 1_300, // O3-G 1,081 under git's rules
  mawsUnprunedWatches: 7_100, // 5,903
  linuxWatches: 7_700, // 6,359
  rssMiB: 20,
  walkLagMs: 50,
  burstLagMs: 250,
  burstNamedMs: 1_000,
  latencyP95Ms: 5,
  storeLatencyP50Ms: 5,
  pollChangedMs: 10_000,
};
const LATENCY_WRITES = 30;
const BURST_FILES = 2_000;
const STORE_LAYOUT = [
  ['-o3e-store-large', 5_000],
  ['-o3e-store-small', 200],
] as const;

setFlagsFromString('--expose_gc');
const gc = runInNewContext('gc') as () => void;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MiB = 2 ** 20;

describe.runIf(process.platform === 'linux' && ROOTS.length > 0)('the watch tree on a devcloud VM (P5 O3-E, Interfaces §G)', () => {
  const results: Record<string, unknown> = {};
  afterAll(() => {
    mkdirSync('test-results', { recursive: true });
    const earlier = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as Record<string, unknown>) : {};
    writeFileSync(RESULTS, `${JSON.stringify({ ...earlier, ...results, host: hostFacts() }, null, 2)}\n`);
  });

  if (EXHAUST === null) {
    for (const given of ROOTS) {
      it(`measures ${given}`, async () => {
        const root = realpathSync(given);
        const kind = kindOf(root);
        if (kind === 'maws') {
          // O3-G's workload is the checkout with node_modules installed: a bare one cannot stand in for it.
          expect(existsSync(join(root, 'node_modules')), `${root}/node_modules (devenv/setup.sh installs it)`).toBe(true);
          const unpruned = await unprunedArm(root);
          results[`${root} (prune off)`] = unpruned;
          line(`${root} (prune off)`, `watches ${unpruned.watches} (bound ${BOUND.mawsUnprunedWatches}) · rss +${unpruned.rssMiB} MiB · walk lag ${unpruned.walkLagMs} ms`);
          expect.soft(unpruned.watches, 'MAWS with the prune off').toBeLessThanOrEqual(BOUND.mawsUnprunedWatches);
          expect.soft(unpruned.rssMiB, 'RSS growth with the prune off').toBeLessThanOrEqual(BOUND.rssMiB);
          expect.soft(unpruned.walkLagMs, "the initial walk's worst lag with the prune off").toBeLessThanOrEqual(BOUND.walkLagMs);
        }
        const worktree = kind === 'maws' ? addWorktree(root) : null;
        try {
          const arm = await repositoryArm(root);
          const bound = kind === 'maws' ? BOUND.mawsWatches : kind === 'linux' ? BOUND.linuxWatches : null;
          results[root] = { kind, worktree, ...arm };
          line(root, `watches ${arm.watches} (bound ${bound ?? 'none'}) · rss +${arm.rssMiB} MiB · walk lag ${arm.walkLagMs} ms · burst ${BURST_FILES}: lag ${arm.burst.createLagMs}/${arm.burst.removeLagMs} ms, named in ${arm.burst.namedMs} ms · latency p50/p95 ${latencyText(arm.latency)}`);
          if (bound !== null) expect.soft(arm.watches, `${kind}'s watches`).toBeLessThanOrEqual(bound);
          expect.soft(arm.rssMiB, 'RSS growth').toBeLessThanOrEqual(BOUND.rssMiB);
          expect.soft(arm.walkLagMs, "the initial walk's worst lag").toBeLessThanOrEqual(BOUND.walkLagMs);
          expect.soft(arm.burst.createLagMs, "the burst's worst lag (created)").toBeLessThanOrEqual(BOUND.burstLagMs);
          expect.soft(arm.burst.removeLagMs, "the burst's worst lag (removed)").toBeLessThanOrEqual(BOUND.burstLagMs);
          expect.soft(arm.burst.namedMs, 'every burst file named').not.toBeNull();
          expect.soft(arm.burst.namedMs ?? Infinity, 'every burst file named').toBeLessThanOrEqual(BOUND.burstNamedMs);
          for (const [site, figures] of Object.entries(arm.latency)) {
            for (const [op, stats] of [['create', figures.create], ['modify', figures.modify]] as const) {
              expect.soft(stats.missed, `${site} ${op}: missed writes`).toBe(0);
              expect.soft(stats.p95 ?? Infinity, `${site} ${op}: latency p95`).toBeLessThanOrEqual(BOUND.latencyP95Ms);
            }
          }
        } finally {
          if (worktree !== null) removeWorktree(root, worktree);
        }
      }, 1_800_000);
    }

    it.runIf(STORE !== null)('measures the synthetic store through the store watcher', async () => {
      const arm = await storeArm(STORE!);
      results[`store ${STORE}`] = arm;
      line(`store ${STORE}`, `watches ${arm.watches} (expected ${arm.expectedWatches}) · rss +${arm.rssMiB} MiB · latency p50/p95 ${arm.latency.p50}/${arm.latency.p95} ms · rescan of projects/ ${arm.rescanCpuMs} ms CPU (${arm.rescanListed} transcripts)`);
      expect.soft(arm.watches, "the store's watches").toBe(arm.expectedWatches);
      expect.soft(arm.latency.missed, 'missed appends').toBe(0);
      expect.soft(arm.latency.p50 ?? Infinity, "an append's latency p50").toBeLessThanOrEqual(BOUND.storeLatencyP50Ms);
      expect.soft(arm.rssMiB, 'RSS growth').toBeLessThanOrEqual(BOUND.rssMiB);
    }, 600_000);
  } else {
    it(`surfaces inotify's ${EXHAUST} exhausted and keeps git.changed arriving by the poll`, async () => {
      expect(['watches', 'instances']).toContain(EXHAUST);
      const root = realpathSync(ROOTS[0]);
      const arm = await exhaustionArm(root, EXHAUST === 'watches' ? 'ENOSPC' : 'EMFILE');
      results[`${root} (exhausted: ${EXHAUST})`] = arm;
      line(root, `${arm.code ?? 'no error'} at ${arm.at ?? '?'} · ${arm.polling ? 'polling' : 'not polling'} · git.changed ${arm.changedMs === null ? 'never' : `in ${arm.changedMs} ms`} (limits ${JSON.stringify(arm.limits)})`);
      expect(arm.code).toBe(EXHAUST === 'watches' ? 'ENOSPC' : 'EMFILE');
      if (EXHAUST === 'instances') expect(arm.at).toBe(root); // the first watch
      else expect(arm.at).not.toBeNull();
      expect(arm.polling).toBe(true);
      expect(arm.changedMs).not.toBeNull();
      expect(arm.changedMs!).toBeLessThanOrEqual(BOUND.pollChangedMs);
    }, 120_000);
  }
});

function line(label: string, text: string): void {
  console.log(`[watch-tree] ${label}: ${text.replace(/\+-/g, '-')}`);
}

function kindOf(root: string): 'maws' | 'linux' | 'other' {
  if (existsSync(join(root, 'src/shared/fs/watch-tree.ts'))) return 'maws';
  if (existsSync(join(root, 'MAINTAINERS')) && existsSync(join(root, 'Kbuild'))) return 'linux';
  return 'other';
}

function hostFacts() {
  const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8').trim() : null);
  return {
    node: process.version,
    kernel: read('/proc/sys/kernel/osrelease'),
    limits: Object.fromEntries(['max_user_watches', 'max_user_instances', 'max_queued_events'].map((key) => [key, Number(read(`/proc/sys/fs/inotify/${key}`))])),
  };
}

// The tree's events at one root, timed as they reach the caller's listener.
class Tap {
  private readonly waiters: { match: (filename: string | null) => boolean; resolve: (at: number) => void }[] = [];
  onEach: ((filename: string | null, at: number) => void) | null = null;
  errors: NodeJS.ErrnoException[] = [];

  constructor(private readonly root: string) {}

  wrap(base: WatchFn): WatchFn {
    return (path, options, listener) => {
      if (path !== this.root) return base(path, options, listener);
      const handle = base(path, options, (event, filename) => {
        this.heard(filename);
        listener(event, filename);
      });
      handle.on('error', (error) => this.errors.push(error));
      return handle;
    };
  }

  private heard(filename: string | null): void {
    const at = performance.now();
    this.onEach?.(filename, at);
    for (const waiter of [...this.waiters]) {
      if (!waiter.match(filename)) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(at);
    }
  }

  // When the next event matching arrives, or null after `withinMs`; register before the write.
  next(match: (filename: string | null) => boolean, withinMs: number): Promise<number | null> {
    return new Promise((resolve) => {
      const waiter = { match, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const at = this.waiters.indexOf(waiter);
        if (at < 0) return;
        this.waiters.splice(at, 1);
        resolve(null);
      }, withinMs);
    });
  }
}

function lagMonitor(periodMs = 10): { stop(): number } {
  let worst = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last - periodMs);
    last = now;
  }, periodMs);
  return {
    stop: () => {
      clearInterval(timer);
      return Math.max(0, Math.round(worst));
    },
  };
}

function memory(): number {
  gc();
  gc();
  return process.memoryUsage().rss;
}

async function repositoryArm(root: string) {
  const tap = new Tap(root);
  const changed: GitChanged[] = [];
  const service = new GitService({ emit: (change) => changed.push(change), env: process.env, watch: tap.wrap(recursiveWatch()) });
  try {
    const walked = tap.next((filename) => filename === null, 300_000); // the initial walk ends in one null event
    const rssBefore = memory();
    const watchesBefore = inotifyOf().watches;
    const lag = lagMonitor();
    const start = performance.now();
    await service.watch(root);
    const walkedAt = await walked;
    const walkLagMs = lag.stop();
    expect(walkedAt, 'the initial walk ended').not.toBeNull();
    const watches = inotifyOf().watches - watchesBefore;
    const rssMiB = round1((memory() - rssBefore) / MiB);
    await sleep(1_000);
    const { deepest, largest } = trackedSites(root);
    const latency = {
      root: await latencyAt(root, root, tap),
      [`deepest ${relative(root, deepest)}`]: await latencyAt(root, deepest, tap),
      [`largest ${relative(root, largest)}`]: await latencyAt(root, largest, tap),
    };
    const burst = await burstAt(root, tap);
    return { watches, rssMiB, walkLagMs, walkMs: walkedAt === null ? null : Math.round(walkedAt - start), latency, burst, changes: changed.length };
  } finally {
    service.dispose();
  }
}

// MAWS's checkout with the prune off: what the tree takes for the whole directory tree, node_modules included.
async function unprunedArm(root: string) {
  let resolveWalk!: () => void;
  const walked = new Promise<void>((resolve) => (resolveWalk = resolve));
  const rssBefore = memory();
  const watchesBefore = inotifyOf().watches;
  const lag = lagMonitor();
  const handle = watchTree(root, {}, (_event, filename) => filename === null && resolveWalk());
  try {
    await walked;
    const walkLagMs = lag.stop();
    return { watches: inotifyOf().watches - watchesBefore, rssMiB: round1((memory() - rssBefore) / MiB), walkLagMs };
  } finally {
    handle.close();
  }
}

// The deepest and the largest directory holding a tracked file (never one the prune drops).
function trackedSites(root: string): { deepest: string; largest: string } {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const dirs = new Set<string>();
  for (const path of out.split('\0')) {
    const slash = path.lastIndexOf('/');
    if (slash > 0) dirs.add(path.slice(0, slash));
  }
  let deepest = '';
  let largest = '';
  let largestSize = -1;
  for (const dir of dirs) {
    if (dir.split('/').length > deepest.split('/').length) deepest = dir;
    const size = readdirSync(join(root, dir)).length;
    if (size > largestSize) [largest, largestSize] = [dir, size];
  }
  return { deepest: join(root, deepest), largest: join(root, largest) };
}

async function latencyAt(root: string, dir: string, tap: Tap) {
  const probe = `.o3e-probe-${process.pid}`;
  const timed = async (name: string, content: string) => {
    const rel = relative(root, join(dir, name));
    const heard = tap.next((filename) => filename === rel, 2_000);
    const start = performance.now();
    writeFileSync(join(dir, name), content);
    const at = await heard;
    await sleep(20);
    return at === null ? null : at - start;
  };
  const create: (number | null)[] = [];
  const modify: (number | null)[] = [];
  try {
    for (let i = 0; i < LATENCY_WRITES; i++) create.push(await timed(`${probe}-${i}`, 'x'));
    for (let i = 0; i < LATENCY_WRITES; i++) modify.push(await timed(`${probe}-0`, String(i)));
  } finally {
    for (let i = 0; i < LATENCY_WRITES; i++) rmSync(join(dir, `${probe}-${i}`), { force: true });
  }
  await sleep(300);
  return { entries: readdirSync(dir).length, create: stats(create), modify: stats(modify) };
}

function stats(samples: (number | null)[]) {
  const seen = samples.filter((sample): sample is number => sample !== null).sort((a, b) => a - b);
  const at = (q: number) => (seen.length === 0 ? null : round2(seen[Math.min(seen.length - 1, Math.floor(q * seen.length))]));
  return { n: samples.length, missed: samples.length - seen.length, p50: at(0.5), p95: at(0.95), max: seen.length === 0 ? null : round2(seen.at(-1)!) };
}

function latencyText(latency: Record<string, { create: ReturnType<typeof stats>; modify: ReturnType<typeof stats> }>): string {
  return Object.entries(latency)
    .map(([site, { create, modify }]) => `${site.split(' ')[0]} ${create.p50}/${create.p95} (create) ${modify.p50}/${modify.p95} (modify)`)
    .join(', ');
}

// Another process writes, then removes, BURST_FILES files in one new directory while this one only watches.
async function burstAt(root: string, tap: Tap) {
  const rel = `.o3e-burst-${process.pid}`;
  const dir = join(root, rel);
  const watched = tap.next((filename) => filename === rel, 10_000); // a late directory's own event comes last
  mkdirSync(dir);
  try {
    await watched;
    const pattern = new RegExp(`^${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/c(\\d+)$`);
    const named = new Set<string>();
    let allAt: number | null = null;
    tap.onEach = (filename, at) => {
      const match = pattern.exec(filename ?? '');
      if (match === null || named.has(match[1])) return;
      named.add(match[1]);
      if (named.size === BURST_FILES) allAt = at;
    };
    let lag = lagMonitor();
    const start = performance.now();
    await node(`const fs=require('fs');for(let i=0;i<${BURST_FILES};i++)fs.writeFileSync(${JSON.stringify(dir)}+'/c'+i,'x'+i)`);
    await until(() => allAt !== null, 10_000, 'every burst file').catch(() => {});
    await sleep(300);
    const createLagMs = lag.stop();
    tap.onEach = null;
    lag = lagMonitor();
    await node(`const fs=require('fs');for(let i=0;i<${BURST_FILES};i++)fs.rmSync(${JSON.stringify(dir)}+'/c'+i)`);
    await sleep(1_000);
    const removeLagMs = lag.stop();
    return { files: BURST_FILES, namedMs: allAt === null ? null : Math.round(allAt - start), filesNamed: named.size, createLagMs, removeLagMs };
  } finally {
    tap.onEach = null;
    rmSync(dir, { recursive: true, force: true });
  }
}

function node(code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (exitCode) => (exitCode === 0 ? resolve() : reject(new Error(`the writer exited ${exitCode}`))));
  });
}

// One linked worktree of the checkout under `.claude/worktrees/`, as O3-G's overlap run had (answers its path).
function addWorktree(root: string): string {
  const path = join(root, '.claude', 'worktrees', `o3e-vm-${process.pid}`);
  execFileSync('git', ['-C', root, 'worktree', 'add', '-q', '--detach', path, 'HEAD'], { stdio: 'ignore' });
  return path;
}

function removeWorktree(root: string, path: string): void {
  execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', path], { stdio: 'ignore' });
}

async function storeArm(storeDir: string) {
  const paths = resolveStorePaths({ CLAUDE_CONFIG_DIR: storeDir });
  if (!existsSync(paths.projects) || readdirSync(paths.projects).length === 0) {
    for (const [slug, count] of STORE_LAYOUT) {
      mkdirSync(join(paths.projects, slug), { recursive: true });
      for (let i = 0; i < count; i++) writeFileSync(join(paths.projects, slug, `${sessionId(i)}.jsonl`), '{"type":"user","message":{"role":"user","content":"seed"}}\n');
    }
  }
  const expectedWatches = storeDirectories(paths);
  const tap = new Tap(paths.projects);
  const heard: unknown[] = [];
  const rssBefore = memory();
  const watchesBefore = inotifyOf().watches;
  const walked = tap.next((filename) => filename === null, 120_000);
  const watcher = new StoreWatcher(paths, (change) => heard.push(change), { watch: tap.wrap(recursiveWatch(process.platform, { reconcileMs: STORE_RECONCILE_MS })) });
  watcher.start();
  try {
    expect(await walked, "the projects/ tree's initial walk ended").not.toBeNull();
    await sleep(500);
    const watches = inotifyOf().watches - watchesBefore;
    const rssMiB = round1((memory() - rssBefore) / MiB);
    const [slug, count] = STORE_LAYOUT[0];
    const appends: (number | null)[] = [];
    for (let i = 0; i < LATENCY_WRITES; i++) {
      const id = sessionId((i * 97) % count);
      const rel = `${slug}/${id}.jsonl`;
      const heardAt = tap.next((filename) => filename === rel, 2_000);
      const start = performance.now();
      appendFileSync(join(paths.projects, rel), '{"type":"assistant"}\n');
      const at = await heardAt;
      appends.push(at === null ? null : at - start);
      await sleep(20);
    }
    const cpu = process.cpuUsage();
    const listed = await new Discovery(paths).list();
    const used = process.cpuUsage(cpu);
    return { expectedWatches, watches, rssMiB, latency: stats(appends), rescanCpuMs: Math.round((used.user + used.system) / 1000), rescanListed: listed.length, changes: heard.length };
  } finally {
    watcher.stop();
  }
}

function sessionId(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
}

// The directories the store watcher watches: every one under each recursive root the store's prune keeps, plus the
// flat sessions/ itself; a root that does not exist takes none.
function storeDirectories(paths: ReturnType<typeof resolveStorePaths>): number {
  let count = 0;
  for (const root of ['projects', 'jobs', 'tasks'] as const) {
    if (!existsSync(paths[root])) continue;
    const prune = storePrune(root);
    const walk = (rel: string): void => {
      count++;
      for (const entry of readdirSync(join(paths[root], rel), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (!prune?.(child)) walk(child);
      }
    };
    walk('');
  }
  return count + (existsSync(paths.sessions) ? 1 : 0);
}

async function exhaustionArm(root: string, expected: 'ENOSPC' | 'EMFILE') {
  const warn = vi.spyOn(console, 'warn');
  const tap = new Tap(root);
  const changed: { at: number; change: GitChanged }[] = [];
  const service = new GitService({ emit: (change) => changed.push({ at: performance.now(), change }), env: process.env, watch: tap.wrap(recursiveWatch()) });
  const probe = join(root, `.o3e-exhaust-${process.pid}`);
  try {
    await service.watch(root);
    await until(() => tap.errors.length > 0, 60_000, `the tree's ${expected}`).catch(() => {});
    const error = tap.errors[0] ?? null;
    const polling = warn.mock.calls.some(([text]) => String(text).startsWith(`[git] watch exhausted under ${root} (${expected}): polling`));
    await sleep(6_000); // past the first poll, so the write below is a change the next one finds
    const from = changed.length;
    const start = performance.now();
    writeFileSync(probe, String(start));
    await until(() => changed.length > from, BOUND.pollChangedMs + 2_000, 'git.changed by the poll').catch(() => {});
    const changedMs = changed.length > from ? Math.round(changed[from].at - start) : null;
    return { code: error?.code ?? null, at: error?.path ?? null, polling, changedMs, limits: hostFacts().limits };
  } finally {
    rmSync(probe, { force: true });
    service.dispose();
    warn.mockRestore();
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
