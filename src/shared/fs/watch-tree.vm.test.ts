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
// Each arm runs in a fresh process of its own (this file again, under vitest, with MAWS_WATCH_TREE_ARM naming the arm),
// as O3-G's measure ran each in its own node: an arm after another in one process inherits the heap V8 grew for it.
// Prints one line per arm and merges its numbers into test-results/watch-tree-vm.json. RSS growth is printed with its
// retained part beside it (RSS less the V8 heap committed but free after a full GC: the heap used, the external
// memory and the rest, native), so a miss can be told apart from pages V8 keeps. A slower write than §G's latency bound
// is recorded with the collections, child spawns and loop stalls that overlapped it. A missed bound fails the case (each
// read softly, so every line prints); it is a finding for the architect, never a widened bound.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { constants as perfConstants, performance, PerformanceObserver } from 'node:perf_hooks';
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
const ARM = process.env.MAWS_WATCH_TREE_ARM?.trim() || null; // set by this file for the process it runs one arm in
const RESULTS = join('test-results', 'watch-tree-vm.json');
const LINES = join('test-results', 'watch-tree-vm.lines'); // every line printed, appended: vitest may print no console (not on a terminal)

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
const gc = runInNewContext('gc') as (options?: { type: 'major'; execution: 'sync'; flavor: 'last-resort' }) => void;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MiB = 2 ** 20;

describe.runIf(process.platform === 'linux' && (ROOTS.length > 0 || ARM !== null))('the watch tree on a devcloud VM (P5 O3-E, Interfaces §G)', () => {
  const results: Record<string, unknown> = {};
  afterAll(() => {
    mkdirSync('test-results', { recursive: true });
    const earlier = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as Record<string, unknown>) : {};
    writeFileSync(RESULTS, `${JSON.stringify({ ...earlier, ...results, host: hostFacts() }, null, 2)}\n`);
  });

  if (ARM !== null) {
    it(`measures ${ARM}`, () => measure(parseArm(ARM), results), 1_800_000);
  } else if (EXHAUST === null) {
    for (const arm of arms()) {
      it(`measures ${arm.kind} ${arm.path} in a fresh process`, async () => {
        const { code, lines, tail } = await fresh(arm);
        for (const text of lines) console.log(text); // the parent's own console, where vitest prints one
        expect(lines.length, `the arm printed its line\n${tail}`).toBeGreaterThan(0);
        expect(code, `a bound missed or the arm failed (its own soft reads above)\n${tail}`).toBe(0);
      }, 1_800_000);
    }
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

// One arm: MAWS's checkout with the prune off, a repository through the product's path, or the synthetic store.
interface Arm {
  kind: 'unpruned' | 'repository' | 'store';
  path: string;
}

function arms(): Arm[] {
  const list: Arm[] = [];
  for (const given of ROOTS) {
    const root = realpathSync(given);
    if (kindOf(root) === 'maws') list.push({ kind: 'unpruned', path: root });
    list.push({ kind: 'repository', path: root });
  }
  if (STORE !== null) list.push({ kind: 'store', path: STORE });
  return list;
}

function parseArm(text: string): Arm {
  const colon = text.indexOf(':');
  const kind = text.slice(0, colon);
  if (kind !== 'unpruned' && kind !== 'repository' && kind !== 'store') throw new Error(`MAWS_WATCH_TREE_ARM names no arm: ${text}`);
  return { kind, path: text.slice(colon + 1) };
}

// This file again, in a new vitest process, measuring the one arm; answers its exit code, the lines it printed and its
// output's tail.
function fresh(arm: Arm): Promise<{ code: number | null; lines: string[]; tail: string }> {
  const from = existsSync(LINES) ? statSync(LINES).size : 0;
  return new Promise((resolve, reject) => {
    const vitest = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
    const env = { ...process.env, MAWS_WATCH_TREE_ARM: `${arm.kind}:${arm.path}` };
    const child = spawn(process.execPath, [vitest, 'run', 'src/shared/fs/watch-tree.vm.test.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => void (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => void (out += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      const printed = existsSync(LINES) ? readFileSync(LINES).subarray(from).toString().split('\n').filter((text) => text !== '') : [];
      resolve({ code, lines: printed, tail: out.split('\n').slice(-60).join('\n') });
    });
  });
}

async function measure(arm: Arm, results: Record<string, unknown>): Promise<void> {
  if (arm.kind === 'store') {
    const store = await storeArm(arm.path);
    results[`store ${arm.path}`] = store;
    line(`store ${arm.path}`, `watches ${store.watches} (expected ${store.expectedWatches}) · ${memoryText(store.memory)} · latency p50/p95 ${store.latency.p50}/${store.latency.p95} ms · rescan of projects/ ${store.rescanCpuMs} ms CPU (${store.rescanListed} transcripts)`);
    expect.soft(store.watches, "the store's watches").toBe(store.expectedWatches);
    expect.soft(store.latency.missed, 'missed appends').toBe(0);
    expect.soft(store.latency.p50 ?? Infinity, "an append's latency p50").toBeLessThanOrEqual(BOUND.storeLatencyP50Ms);
    expect.soft(store.memory.rssMiB, 'RSS growth').toBeLessThanOrEqual(BOUND.rssMiB);
    return;
  }
  const root = arm.path;
  const kind = kindOf(root);
  if (arm.kind === 'unpruned') {
    // O3-G's workload is the checkout with node_modules installed: a bare one cannot stand in for it.
    expect(existsSync(join(root, 'node_modules')), `${root}/node_modules (devenv/setup.sh installs it)`).toBe(true);
    const unpruned = await unprunedArm(root);
    results[`${root} (prune off)`] = unpruned;
    line(`${root} (prune off)`, `watches ${unpruned.watches} (bound ${BOUND.mawsUnprunedWatches}) · ${memoryText(unpruned.memory)} · walk lag ${unpruned.walkLagMs} ms`);
    expect.soft(unpruned.watches, 'MAWS with the prune off').toBeLessThanOrEqual(BOUND.mawsUnprunedWatches);
    expect.soft(unpruned.memory.rssMiB, 'RSS growth with the prune off').toBeLessThanOrEqual(BOUND.rssMiB);
    expect.soft(unpruned.walkLagMs, "the initial walk's worst lag with the prune off").toBeLessThanOrEqual(BOUND.walkLagMs);
    return;
  }
  const worktree = kind === 'maws' ? addWorktree(root) : null;
  try {
    const measured = await repositoryArm(root);
    const bound = kind === 'maws' ? BOUND.mawsWatches : kind === 'linux' ? BOUND.linuxWatches : null;
    results[root] = { kind, worktree, ...measured };
    line(root, `watches ${measured.watches} (bound ${bound ?? 'none'}) · ${memoryText(measured.memory)} · walk lag ${measured.walkLagMs} ms · burst ${BURST_FILES}: lag ${measured.burst.createLagMs}/${measured.burst.removeLagMs} ms, named in ${measured.burst.namedMs} ms · latency p50/p95 ${latencyText(measured.latency)}`);
    for (const [site, figures] of Object.entries(measured.latency)) for (const slow of [...figures.create.slow, ...figures.modify.slow]) line(root, `slow write at ${site}: ${JSON.stringify(slow)}`);
    for (const stall of measured.burst.createStalls) line(root, `burst stall: ${JSON.stringify(stall)}`);
    if (bound !== null) expect.soft(measured.watches, `${kind}'s watches`).toBeLessThanOrEqual(bound);
    expect.soft(measured.memory.rssMiB, 'RSS growth').toBeLessThanOrEqual(BOUND.rssMiB);
    expect.soft(measured.walkLagMs, "the initial walk's worst lag").toBeLessThanOrEqual(BOUND.walkLagMs);
    expect.soft(measured.burst.createLagMs, "the burst's worst lag (created)").toBeLessThanOrEqual(BOUND.burstLagMs);
    expect.soft(measured.burst.removeLagMs, "the burst's worst lag (removed)").toBeLessThanOrEqual(BOUND.burstLagMs);
    expect.soft(measured.burst.namedMs, 'every burst file named').not.toBeNull();
    expect.soft(measured.burst.namedMs ?? Infinity, 'every burst file named').toBeLessThanOrEqual(BOUND.burstNamedMs);
    for (const [site, figures] of Object.entries(measured.latency)) {
      for (const [op, stats] of [['create', figures.create], ['modify', figures.modify]] as const) {
        expect.soft(stats.missed, `${site} ${op}: missed writes`).toBe(0);
        expect.soft(stats.p95 ?? Infinity, `${site} ${op}: latency p95`).toBeLessThanOrEqual(BOUND.latencyP95Ms);
      }
    }
  } finally {
    if (worktree !== null) removeWorktree(root, worktree);
  }
}

function line(label: string, text: string): void {
  const printed = `[watch-tree] ${label}: ${text.replace(/\+-/g, '-')}`;
  console.log(printed);
  mkdirSync('test-results', { recursive: true });
  appendFileSync(LINES, `${printed}\n`);
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

interface Memory {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
}

function memory(): Memory {
  gc();
  gc();
  const { rss, heapTotal, heapUsed, external } = process.memoryUsage();
  return { rss, heapTotal, heapUsed, external };
}

// RSS growth and its retained part: RSS less the V8 heap committed but free after a full GC, which is the heap used,
// the external memory (array buffers) and the rest, native (the watch handles, libuv's watcher lists, malloc's arenas).
function growth(before: Memory, after: Memory) {
  const mib = (key: keyof Memory) => (after[key] - before[key]) / MiB;
  const committedFree = mib('heapTotal') - mib('heapUsed');
  return {
    rssMiB: round1(mib('rss')),
    retainedMiB: round1(mib('rss') - committedFree),
    heapUsedMiB: round1(mib('heapUsed')),
    externalMiB: round1(mib('external')),
    nativeMiB: round1(mib('rss') - mib('heapTotal') - mib('external')),
    heapCommittedFreeMiB: round1(committedFree),
    rssReducedMiB: null as number | null,
  };
}

// RSS growth once more at the arm's end, after a memory-reducing collection (V8's last resort, which gives committed new
// space back: a walk's survivors grow new space to its cap, and an ordinary collection keeps it). At the end, since the
// collection also drops compiled code, which the arm's later phases would then pay for (a burst lag of 293 ms, once).
function reduced(before: Memory, grown: ReturnType<typeof growth>): ReturnType<typeof growth> {
  gc({ type: 'major', execution: 'sync', flavor: 'last-resort' });
  return { ...grown, rssReducedMiB: round1((process.memoryUsage().rss - before.rss) / MiB) };
}

function memoryText(memory: ReturnType<typeof growth>): string {
  return `rss +${memory.rssMiB} MiB (retained +${memory.retainedMiB}: heap +${memory.heapUsedMiB}, external +${memory.externalMiB}, native +${memory.nativeMiB}; V8 committed and free +${memory.heapCommittedFreeMiB}; at the arm's end after a memory-reducing collection +${memory.rssReducedMiB})`;
}

const GC_KINDS: Record<number, string> = {
  [perfConstants.NODE_PERFORMANCE_GC_MINOR]: 'scavenge',
  [perfConstants.NODE_PERFORMANCE_GC_MAJOR]: 'mark-compact',
  [perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental marking',
  [perfConstants.NODE_PERFORMANCE_GC_WEAKCB]: 'weak callbacks',
};

// What overlapped a write: V8's collections, the child processes spawned (a spawn forks this process from its loop), and
// the loop's own stalls over 20 ms.
class Overlaps {
  private readonly gcs: { start: number; end: number; kind: string }[] = [];
  private readonly spawns: { at: number; what: string }[] = [];
  private readonly stalls: { start: number; end: number }[] = [];
  private readonly observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) this.gcs.push({ start: entry.startTime, end: entry.startTime + entry.duration, kind: GC_KINDS[(entry as unknown as { detail?: { kind?: number } }).detail?.kind ?? -1] ?? 'other' });
  });
  private readonly onSpawn = (message: unknown) => {
    const spawned = (message as { process?: ChildProcess }).process;
    this.spawns.push({ at: performance.now(), what: (spawned?.spawnargs ?? []).slice(0, 6).join(' ') });
  };
  private readonly ticker: ReturnType<typeof setInterval>;

  constructor() {
    this.observer.observe({ entryTypes: ['gc'] });
    subscribe('child_process', this.onSpawn);
    let last = performance.now();
    this.ticker = setInterval(() => {
      const now = performance.now();
      if (now - last > 20) this.stalls.push({ start: last, end: now });
      last = now;
    }, 5);
  }

  around(start: number, end: number) {
    const overlaps = (from: number, to: number) => from < end && to > start;
    return {
      gc: this.gcs.filter((gc) => overlaps(gc.start, gc.end)).map((gc) => `${gc.kind} ${round2(gc.end - gc.start)} ms`),
      spawns: this.spawns.filter((spawned) => spawned.at >= start && spawned.at <= end).map((spawned) => spawned.what),
      stalls: this.stalls.filter((stall) => overlaps(stall.start, stall.end)).map((stall) => round2(stall.end - stall.start)),
    };
  }

  // Each stall of the loop over `ms`, with what overlapped it.
  stallsOver(ms: number) {
    return this.stalls.filter((stall) => stall.end - stall.start > ms).map((stall) => ({ ms: round2(stall.end - stall.start), ...this.around(stall.start, stall.end), stalls: undefined }));
  }

  stop(): void {
    this.observer.disconnect();
    unsubscribe('child_process', this.onSpawn);
    clearInterval(this.ticker);
  }
}

async function repositoryArm(root: string) {
  const tap = new Tap(root);
  const changed: GitChanged[] = [];
  const service = new GitService({ emit: (change) => changed.push(change), env: process.env, watch: tap.wrap(recursiveWatch()) });
  try {
    const walked = tap.next((filename) => filename === null, 300_000); // the initial walk ends in one null event
    const before = memory();
    const watchesBefore = inotifyOf().watches;
    const lag = lagMonitor();
    const start = performance.now();
    await service.watch(root);
    const walkedAt = await walked;
    const walkLagMs = lag.stop();
    expect(walkedAt, 'the initial walk ended').not.toBeNull();
    const watches = inotifyOf().watches - watchesBefore;
    const grown = growth(before, memory());
    await sleep(1_000);
    const { deepest, largest } = trackedSites(root);
    const latency = {
      root: await latencyAt(root, root, tap),
      [`deepest ${relative(root, deepest)}`]: await latencyAt(root, deepest, tap),
      [`largest ${relative(root, largest)}`]: await latencyAt(root, largest, tap),
    };
    const burst = await burstAt(root, tap);
    return { watches, memory: reduced(before, grown), walkLagMs, walkMs: walkedAt === null ? null : Math.round(walkedAt - start), latency, burst, changes: changed.length };
  } finally {
    service.dispose();
  }
}

// MAWS's checkout with the prune off: what the tree takes for the whole directory tree, node_modules included.
async function unprunedArm(root: string) {
  let resolveWalk!: () => void;
  const walked = new Promise<void>((resolve) => (resolveWalk = resolve));
  const before = memory();
  const watchesBefore = inotifyOf().watches;
  const lag = lagMonitor();
  const handle = watchTree(root, {}, (_event, filename) => filename === null && resolveWalk());
  try {
    await walked;
    const walkLagMs = lag.stop();
    return { watches: inotifyOf().watches - watchesBefore, memory: reduced(before, growth(before, memory())), walkLagMs };
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
  const overlaps = new Overlaps();
  const timed = async (name: string, content: string): Promise<Sample> => {
    const rel = relative(root, join(dir, name));
    const heard = tap.next((filename) => filename === rel, 2_000);
    const start = performance.now();
    writeFileSync(join(dir, name), content);
    const at = await heard;
    await sleep(20);
    return { start, at };
  };
  const create: Sample[] = [];
  const modify: Sample[] = [];
  try {
    for (let i = 0; i < LATENCY_WRITES; i++) create.push(await timed(`${probe}-${i}`, 'x'));
    for (let i = 0; i < LATENCY_WRITES; i++) modify.push(await timed(`${probe}-0`, String(i)));
  } finally {
    for (let i = 0; i < LATENCY_WRITES; i++) rmSync(join(dir, `${probe}-${i}`), { force: true });
  }
  await sleep(300);
  overlaps.stop();
  // A write slower than §G's bound, with what overlapped it.
  const slowOf = (samples: Sample[]) =>
    samples.flatMap(({ start, at }, i) => (at !== null && at - start > BOUND.latencyP95Ms ? [{ write: i, ms: round2(at - start), ...overlaps.around(start, at) }] : []));
  const timings = (samples: Sample[]) => samples.map(({ start, at }) => (at === null ? null : at - start));
  return { entries: readdirSync(dir).length, create: { ...stats(timings(create)), slow: slowOf(create) }, modify: { ...stats(timings(modify)), slow: slowOf(modify) } };
}

interface Sample {
  start: number;
  at: number | null; // when the tree named it; null: never within 2 s
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
  // A name the repository's own rules do not ignore: the kernel's `.gitignore` opens with `.*`, so a dot-named burst
  // directory is pruned (rightly) and its files never named, which is no reading of the burst.
  const rel = `o3e-burst-${process.pid}`;
  const dir = join(root, rel);
  const ignoredBy = spawnSync('git', ['-C', root, 'check-ignore', '-v', rel], { encoding: 'utf8' });
  expect(ignoredBy.status, `the burst directory ${rel} is ignored by ${ignoredBy.stdout.trim()}`).toBe(1);
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
    const overlaps = new Overlaps();
    const start = performance.now();
    await node(`const fs=require('fs');for(let i=0;i<${BURST_FILES};i++)fs.writeFileSync(${JSON.stringify(dir)}+'/c'+i,'x'+i)`);
    await until(() => allAt !== null, 10_000, 'every burst file').catch(() => {});
    await sleep(300);
    const createLagMs = lag.stop();
    overlaps.stop();
    tap.onEach = null;
    lag = lagMonitor();
    await node(`const fs=require('fs');for(let i=0;i<${BURST_FILES};i++)fs.rmSync(${JSON.stringify(dir)}+'/c'+i)`);
    await sleep(1_000);
    const removeLagMs = lag.stop();
    return { files: BURST_FILES, namedMs: allAt === null ? null : Math.round(allAt - start), filesNamed: named.size, createLagMs, removeLagMs, createStalls: overlaps.stallsOver(50) };
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
  const before = memory();
  const watchesBefore = inotifyOf().watches;
  const walked = tap.next((filename) => filename === null, 120_000);
  const watcher = new StoreWatcher(paths, (change) => heard.push(change), { watch: tap.wrap(recursiveWatch(process.platform, { reconcileMs: STORE_RECONCILE_MS })) });
  watcher.start();
  try {
    expect(await walked, "the projects/ tree's initial walk ended").not.toBeNull();
    await sleep(500);
    const watches = inotifyOf().watches - watchesBefore;
    const grown = growth(before, memory());
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
    return { expectedWatches, watches, memory: reduced(before, grown), latency: stats(appends), rescanCpuMs: Math.round((used.user + used.system) / 1000), rescanListed: listed.length, changes: heard.length };
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
