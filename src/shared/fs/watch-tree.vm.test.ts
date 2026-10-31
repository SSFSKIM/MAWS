// P5 O3-E M1, Interfaces §G (as D21 reads it): the watch tree measured on a devcloud VM over O3-G's repositories
// (research/org/p5-o3-linux-repo-watch.md), the proof of acceptance 6. Skipped unless MAWS_WATCH_TREE_ROOTS names roots
// (comma-separated) on Linux; it reads /proc/self/fdinfo as O3-G's watch-measure.mjs did. Each root is watched through
// the product's path, the repository watcher of a GitService over the platform's recursive watch (on Linux the tree,
// with the git prune built over the real git runner), and read for: the inotify watches it takes; RSS growth with a
// forced GC and its retained part (RSS less the V8 heap committed but free: the heap used, the external memory and the
// rest, native), then RSS after MAWS_WATCH_TREE_IDLE_MS idle (60 s by default; no collection forced) and after a
// memory-reducing collection; the event loop's worst lag during the initial walk; notification latency over 30 writes
// at the root and at the deepest and the largest tracked directory, the writes made by a writer process of its own and
// timed on CLOCK_MONOTONIC in both, from each write's return (§G's quantity) and from before it, with the writes the
// filesystem held in their own call; and a 2,000-file burst created then removed in one new directory (the worst loop
// lag, and the time until every burst file was named). MAWS's checkout is also walked with the prune off, and is
// measured with a linked worktree under `.claude/worktrees/`, so the nested-checkout prune is read. With both MAWS and
// the kernel named, one process walks MAWS and then the kernel, each root's growth read on its own (D21 (a): the second
// root's RSS growth is §G's per-root bound). With MAWS_WATCH_TREE_STORE the synthetic store (seeded when empty: 5,000
// transcripts in one project, 200 in another) is watched through the store watcher's tree. MAWS_WATCH_TREE_EXHAUST=
// watches (after `sysctl` lowered max_user_watches to 600) or =instances (max_user_instances at the user's count) runs
// the exhaustion arm instead. Each arm runs in a fresh process of its own (this file again, under vitest, with
// MAWS_WATCH_TREE_ARM naming the arm), as O3-G's measure ran each in its own node. Prints one line per arm, appends it to
// test-results/watch-tree-vm.lines and merges its numbers into test-results/watch-tree-vm.json. A notification slower
// than §G's bound is recorded with the collections, child spawns and loop stalls that overlapped it. A missed bound
// fails the case (each read softly, so every line prints); it is a finding for the architect, never a widened bound.
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
const IDLE_MS = Number(process.env.MAWS_WATCH_TREE_IDLE_MS ?? 60_000); // D21 (b): RSS once more after this long idle, no collection forced
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
  kind: 'unpruned' | 'repository' | 'store' | 'second-root';
  path: string; // the second-root arm's: the first root, a comma, the second
}

function arms(): Arm[] {
  const list: Arm[] = [];
  for (const given of ROOTS) {
    const root = realpathSync(given);
    if (kindOf(root) === 'maws') list.push({ kind: 'unpruned', path: root });
    list.push({ kind: 'repository', path: root });
  }
  if (STORE !== null) list.push({ kind: 'store', path: STORE });
  const maws = list.find((arm) => arm.kind === 'repository' && kindOf(arm.path) === 'maws');
  const linux = list.find((arm) => arm.kind === 'repository' && kindOf(arm.path) === 'linux');
  if (maws && linux) list.push({ kind: 'second-root', path: `${maws.path},${linux.path}` });
  return list;
}

function parseArm(text: string): Arm {
  const colon = text.indexOf(':');
  const kind = text.slice(0, colon);
  if (kind !== 'unpruned' && kind !== 'repository' && kind !== 'store' && kind !== 'second-root') throw new Error(`MAWS_WATCH_TREE_ARM names no arm: ${text}`);
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
    const held = store.latency.heldWrites;
    line(`store ${arm.path}`, `watches ${store.watches} (expected ${store.expectedWatches}) · ${memoryText(store.memory)} · latency p50/p95 from the append's return ${store.latency.p50}/${store.latency.p95} ms, from before it ${store.latency.fromStart.p50}/${store.latency.fromStart.p95} ms, appends held in their own call ${held.count}${held.worstMs === null ? '' : ` (worst ${held.worstMs} ms)`} · rescan of projects/ ${store.rescanCpuMs} ms CPU (${store.rescanListed} transcripts)`);
    expect.soft(store.watches, "the store's watches").toBe(store.expectedWatches);
    expect.soft(store.latency.missed, 'missed appends').toBe(0);
    expect.soft(store.latency.p50 ?? Infinity, "an append's latency p50 from its return").toBeLessThanOrEqual(BOUND.storeLatencyP50Ms);
    expect.soft(store.memory.retainedMiB, 'retained memory').toBeLessThanOrEqual(BOUND.rssMiB);
    return;
  }
  if (arm.kind === 'second-root') {
    const [first, second] = arm.path.split(',');
    const both = await secondRootArm(first, second);
    results[`second root ${arm.path}`] = both;
    for (const reading of [both.first, both.second]) line(`second root: ${reading.root}`, `${reading.order} · watches ${reading.watches} · ${memoryText(reading.memory)} · walk lag ${reading.walkLagMs} ms`);
    // D21 (a): a walk's young-generation growth is once per process; the root after it shows what a root costs.
    expect.soft(both.second.memory.rssMiB, "the second root's RSS growth").toBeLessThanOrEqual(BOUND.rssMiB);
    for (const reading of [both.first, both.second]) expect.soft(reading.memory.retainedMiB, `${reading.root}'s retained memory`).toBeLessThanOrEqual(BOUND.rssMiB);
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
    expect.soft(unpruned.memory.retainedMiB, 'retained memory with the prune off').toBeLessThanOrEqual(BOUND.rssMiB); // RSS growth: D21 (a), the second-root arm
    expect.soft(unpruned.walkLagMs, "the initial walk's worst lag with the prune off").toBeLessThanOrEqual(BOUND.walkLagMs);
    return;
  }
  const worktree = kind === 'maws' ? addWorktree(root) : null;
  try {
    const measured = await repositoryArm(root);
    const bound = kind === 'maws' ? BOUND.mawsWatches : kind === 'linux' ? BOUND.linuxWatches : null;
    results[root] = { kind, worktree, ...measured };
    line(root, `watches ${measured.watches} (bound ${bound ?? 'none'}) · ${memoryText(measured.memory)} · walk lag ${measured.walkLagMs} ms · burst ${BURST_FILES}: lag ${measured.burst.createLagMs}/${measured.burst.removeLagMs} ms, named in ${measured.burst.namedMs} ms · ${latencyText(measured.latency)}`);
    for (const [site, figures] of Object.entries(measured.latency)) for (const slow of [...figures.create.slow, ...figures.modify.slow]) line(root, `slow notification at ${site}: ${JSON.stringify(slow)}`);
    for (const stall of measured.burst.createStalls) line(root, `burst stall: ${JSON.stringify(stall)}`);
    if (bound !== null) expect.soft(measured.watches, `${kind}'s watches`).toBeLessThanOrEqual(bound);
    expect.soft(measured.memory.retainedMiB, 'retained memory').toBeLessThanOrEqual(BOUND.rssMiB); // RSS growth: D21 (a), the second-root arm
    expect.soft(measured.walkLagMs, "the initial walk's worst lag").toBeLessThanOrEqual(BOUND.walkLagMs);
    expect.soft(measured.burst.createLagMs, "the burst's worst lag (created)").toBeLessThanOrEqual(BOUND.burstLagMs);
    expect.soft(measured.burst.removeLagMs, "the burst's worst lag (removed)").toBeLessThanOrEqual(BOUND.burstLagMs);
    expect.soft(measured.burst.namedMs, 'every burst file named').not.toBeNull();
    expect.soft(measured.burst.namedMs ?? Infinity, 'every burst file named').toBeLessThanOrEqual(BOUND.burstNamedMs);
    for (const [site, figures] of Object.entries(measured.latency)) {
      for (const [op, stats] of [['create', figures.create], ['modify', figures.modify]] as const) {
        expect.soft(stats.missed, `${site} ${op}: missed writes`).toBe(0);
        expect.soft(stats.p95 ?? Infinity, `${site} ${op}: latency p95 from the write's return`).toBeLessThanOrEqual(BOUND.latencyP95Ms);
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

// CLOCK_MONOTONIC in ms (process.hrtime on Linux), the clock a writer process and this one read alike.
const monoMs = () => Number(process.hrtime.bigint()) / 1e6;

// When an event reached the caller's listener: `at` on this process's performance clock, `mono` on the shared one.
interface Heard {
  at: number;
  mono: number;
}

// The tree's events at one root, timed as they reach the caller's listener.
class Tap {
  private readonly waiters: { match: (filename: string | null) => boolean; resolve: (heard: Heard) => void }[] = [];
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
    const mono = monoMs();
    this.onEach?.(filename, at);
    for (const waiter of [...this.waiters]) {
      if (!waiter.match(filename)) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve({ at, mono });
    }
  }

  // When the next event matching arrives, or null after `withinMs`; register before the write.
  next(match: (filename: string | null) => boolean, withinMs: number): Promise<Heard | null> {
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

// A writer in a process of its own (D21's latency clock: in the product the writer is always another process, so a
// write the filesystem holds in its call never holds the observing loop). Each write is stamped on CLOCK_MONOTONIC
// before the call and at its return.
class Writer {
  private readonly child: ChildProcess;
  private readonly pending: ((stamps: { start: number; end: number }) => void)[] = [];
  private buffered = '';

  constructor() {
    const script = `const fs=require('fs');const rl=require('readline').createInterface({input:process.stdin});rl.on('line',(l)=>{const w=JSON.parse(l);const t0=process.hrtime.bigint();if(w.append)fs.appendFileSync(w.path,w.content);else fs.writeFileSync(w.path,w.content);const t1=process.hrtime.bigint();process.stdout.write(JSON.stringify({start:String(t0),end:String(t1)})+'\\n');});`;
    this.child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child.stdout!.on('data', (chunk: Buffer) => {
      this.buffered += chunk.toString();
      let newline: number;
      while ((newline = this.buffered.indexOf('\n')) >= 0) {
        const { start, end } = JSON.parse(this.buffered.slice(0, newline)) as { start: string; end: string };
        this.buffered = this.buffered.slice(newline + 1);
        this.pending.shift()?.({ start: Number(BigInt(start)) / 1e6, end: Number(BigInt(end)) / 1e6 });
      }
    });
  }

  write(path: string, content: string, append = false): Promise<{ start: number; end: number }> {
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.child.stdin!.write(`${JSON.stringify({ path, content, append })}\n`);
    });
  }

  close(): void {
    this.child.stdin!.end();
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
    rssIdleMiB: null as number | null,
    rssReducedMiB: null as number | null,
  };
}

// RSS growth once more at the arm's end, after a memory-reducing collection (V8's last resort, which gives committed new
// space back: a walk's survivors grow new space to its cap, and an ordinary collection keeps it). At the end, since the
// collection also drops compiled code, which the arm's later phases would then pay for (a burst lag of 293 ms, once).
// Before it, D21 (b): RSS after IDLE_MS idle with no collection forced, whether V8's memory reducer gives the pages back.
async function settled(before: Memory, grown: ReturnType<typeof growth>): Promise<ReturnType<typeof growth>> {
  let rssIdleMiB: number | null = null;
  if (IDLE_MS > 0) {
    await sleep(IDLE_MS);
    rssIdleMiB = round1((process.memoryUsage().rss - before.rss) / MiB);
  }
  gc({ type: 'major', execution: 'sync', flavor: 'last-resort' });
  return { ...grown, rssIdleMiB, rssReducedMiB: round1((process.memoryUsage().rss - before.rss) / MiB) };
}

function memoryText(memory: ReturnType<typeof growth>): string {
  return `rss +${memory.rssMiB} MiB (retained +${memory.retainedMiB}: heap +${memory.heapUsedMiB}, external +${memory.externalMiB}, native +${memory.nativeMiB}; V8 committed and free +${memory.heapCommittedFreeMiB}; at the arm's end after ${IDLE_MS / 1000} s idle ${memory.rssIdleMiB === null ? 'not read' : `+${memory.rssIdleMiB}`}, then after a memory-reducing collection +${memory.rssReducedMiB})`;
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
    const walkedAt = (await walked)?.at ?? null;
    const walkLagMs = lag.stop();
    expect(walkedAt, 'the initial walk ended').not.toBeNull();
    const watches = inotifyOf().watches - watchesBefore;
    const grown = growth(before, memory());
    await sleep(1_000);
    const { deepest, largest } = trackedSites(root);
    const writer = new Writer();
    const latency = {
      root: await latencyAt(root, root, tap, writer),
      [`deepest ${relative(root, deepest)}`]: await latencyAt(root, deepest, tap, writer),
      [`largest ${relative(root, largest)}`]: await latencyAt(root, largest, tap, writer),
    };
    writer.close();
    const burst = await burstAt(root, tap);
    return { watches, memory: await settled(before, grown), walkLagMs, walkMs: walkedAt === null ? null : Math.round(walkedAt - start), latency, burst, changes: changed.length };
  } finally {
    service.dispose();
  }
}

// D21 (a): two roots in one process through one GitService, MAWS under git's rules and then the kernel tree, each
// root's growth read from the memory before its own walk (the first's young-generation growth is the process's, once).
async function secondRootArm(first: string, second: string) {
  const taps = [new Tap(first), new Tap(second)];
  const service = new GitService({ emit: () => {}, env: process.env, watch: taps[1].wrap(taps[0].wrap(recursiveWatch())) });
  try {
    const start = memory();
    const walk = async (i: number, root: string, before: Memory) => {
      const walked = taps[i].next((filename) => filename === null, 300_000);
      const watchesBefore = inotifyOf().watches;
      const lag = lagMonitor();
      await service.watch(root);
      expect(await walked, `${root}'s initial walk ended`).not.toBeNull();
      const walkLagMs = lag.stop();
      await sleep(1_000);
      const after = memory();
      return { reading: { root, watches: inotifyOf().watches - watchesBefore, memory: growth(before, after), walkLagMs }, after };
    };
    const one = await walk(0, first, start);
    const two = await walk(1, second, one.after);
    return {
      first: { ...one.reading, order: 'first root' },
      second: { ...two.reading, order: 'second root, after the first', memory: await settled(one.after, two.reading.memory) }, // its idle and reduced readings from before its own walk
      process: growth(start, memory()), // both roots, from before either
    };
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
    const grown = growth(before, memory());
    return { watches: inotifyOf().watches - watchesBefore, memory: await settled(before, grown), walkLagMs };
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

// §G's latency, as D21 reads it: from a write's return in a writer process of its own to the tree's event naming it, on
// CLOCK_MONOTONIC in both processes. Beside it, the time from before the write (O3-G's quantity), and the writes the
// filesystem held in their own call (ext4 on the VM's disk held a rewrite of the probe up to 90 ms, the writer off the
// CPU throughout), with what overlapped any slow notification in this process.
async function latencyAt(root: string, dir: string, tap: Tap, writer: Writer) {
  const probe = `.o3e-probe-${process.pid}`;
  const overlaps = new Overlaps();
  const perfOffset = monoMs() - performance.now(); // both monotonic: a constant between the two clocks
  const timed = async (name: string, content: string): Promise<Sample> => {
    const rel = relative(root, join(dir, name));
    const [heard, { start, end }] = await Promise.all([tap.next((filename) => filename === rel, 2_000), writer.write(join(dir, name), content)]);
    await sleep(20);
    return { start, end, at: heard?.mono ?? null };
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
  return { entries: readdirSync(dir).length, create: latencyOf(create, overlaps, perfOffset), modify: latencyOf(modify, overlaps, perfOffset) };
}

interface Sample {
  start: number; // CLOCK_MONOTONIC ms: the writer's call began
  end: number; // and returned
  at: number | null; // the tree named it; null: never within 2 s
}

function latencyOf(samples: Sample[], overlaps: Overlaps, perfOffset: number) {
  const fromReturn = samples.map(({ end, at }) => (at === null ? null : Math.max(0, at - end))); // an event read before the writer's reply came back reads 0
  const fromStart = samples.map(({ start, at }) => (at === null ? null : at - start));
  const held = samples.map(({ start, end }) => end - start).filter((ms) => ms > BOUND.latencyP95Ms);
  return {
    ...stats(fromReturn),
    fromStart: stats(fromStart),
    heldWrites: { count: held.length, worstMs: held.length === 0 ? null : round2(Math.max(...held)) },
    // A notification slower than §G's bound from the write's return, with what overlapped it here.
    slow: samples.flatMap(({ end, at }, i) => (at !== null && at - end > BOUND.latencyP95Ms ? [{ write: i, ms: round2(at - end), ...overlaps.around(end - perfOffset, at - perfOffset) }] : [])),
  };
}

function stats(samples: (number | null)[]) {
  const seen = samples.filter((sample): sample is number => sample !== null).sort((a, b) => a - b);
  const at = (q: number) => (seen.length === 0 ? null : round2(seen[Math.min(seen.length - 1, Math.floor(q * seen.length))]));
  return { n: samples.length, missed: samples.length - seen.length, p50: at(0.5), p95: at(0.95), max: seen.length === 0 ? null : round2(seen.at(-1)!) };
}

function latencyText(latency: Record<string, { create: ReturnType<typeof latencyOf>; modify: ReturnType<typeof latencyOf> }>): string {
  const sites = Object.entries(latency);
  const by = (pick: (figures: ReturnType<typeof latencyOf>) => ReturnType<typeof stats>) => sites.map(([site, { create, modify }]) => `${site.split(' ')[0]} ${pick(create).p50}/${pick(create).p95} (create) ${pick(modify).p50}/${pick(modify).p95} (modify)`).join(', ');
  const held = sites.flatMap(([, { create, modify }]) => [create.heldWrites, modify.heldWrites]);
  const worst = Math.max(0, ...held.map((h) => h.worstMs ?? 0));
  return `latency p50/p95 from the write's return ${by((figures) => figures)} · from before the write ${by((figures) => figures.fromStart)} · writes held in their own call ${held.reduce((sum, h) => sum + h.count, 0)}, worst ${round2(worst)} ms`;
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
    const appends: Sample[] = [];
    const writer = new Writer();
    const overlaps = new Overlaps();
    for (let i = 0; i < LATENCY_WRITES; i++) {
      const id = sessionId((i * 97) % count);
      const rel = `${slug}/${id}.jsonl`;
      const [heardAt, { start, end }] = await Promise.all([tap.next((filename) => filename === rel, 2_000), writer.write(join(paths.projects, rel), '{"type":"assistant"}\n', true)]);
      appends.push({ start, end, at: heardAt?.mono ?? null });
      await sleep(20);
    }
    writer.close();
    overlaps.stop();
    const cpu = process.cpuUsage();
    const listed = await new Discovery(paths).list();
    const used = process.cpuUsage(cpu);
    const latency = latencyOf(appends, overlaps, monoMs() - performance.now());
    return { expectedWatches, watches, memory: await settled(before, grown), latency, rescanCpuMs: Math.round((used.user + used.system) / 1000), rescanListed: listed.length, changes: heard.length };
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
