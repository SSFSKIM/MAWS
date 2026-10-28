// P5 O3-G, a findings-only spike (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md, child O3-G, document blob
// 67da2f63a992c9c6f6369ffe1ff3fc7605999c89 at master 1d1d71937; research/org/p5-o3-linux-repo-watch.md): what one
// recursive `fs.watch` of a repository root costs on Linux under mawsd's runtime (Node 24.21.0), the call
// src/main/git/watcher.ts makes per root (`watch(root, { recursive: true }, listener)`, its 'error' listener attached
// after the call returns). One measurement per process, so the inotify instance and watches this process holds are the
// watch's own. Linux only (it reads /proc/self/fdinfo).
//
//   node --expose-gc watch-measure.mjs <root> [--ignore <preset>] [--latency <n>] [--idle <s>] [--churn <files>]
//        [--probe-unwatched] [--label <text>]   (--churn takes a list, e.g. 200,2000)
// Prints one JSON object. --ignore: none (the watcher's call), maws (node_modules, .git/objects, .git/lfs, out, dist,
// .claude/worktrees as Node's own `ignore` option takes them), or git (every path git ignores, from
// `git ls-files -o -i --exclude-standard --directory`, as a function matcher, plus .git/objects and .git/lfs).
import { watch, readdirSync, readFileSync, readlinkSync, writeFileSync, mkdirSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { readdir, lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const args = process.argv.slice(2);
const root = args[0];
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const flag = (name) => args.includes('--' + name);
const latencyN = Number(opt('latency', '0'));
const idleS = Number(opt('idle', '0'));
const churnN = String(opt('churn', '0')).split(',').map(Number).reduce((a, b) => a + b, 0);
const ignorePreset = opt('ignore', 'none');
// --mode recursive (default): Node's `fs.watch(root, { recursive: true })`, the call watcher.ts makes. --mode dirs: the
// alternative measured beside it, a directory-only watch tree (DirTree below).
const mode = opt('mode', 'recursive');
const label = opt('label', root);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint()) / 1e6;
const gc = () => { if (globalThis.gc) { globalThis.gc(); globalThis.gc(); } };

// The inotify instances this process holds and the watches on each, from /proc/self/fdinfo.
export function inotifyOf(pid = 'self') {
  let instances = 0, watches = 0;
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    let target; try { target = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
    if (target !== 'anon_inode:inotify') continue;
    instances++;
    try { watches += readFileSync(`/proc/${pid}/fdinfo/${fd}`, 'utf8').split('\n').filter((l) => l.startsWith('inotify wd:')).length; } catch {}
  }
  return { instances, watches };
}
const limits = () => Object.fromEntries(['max_user_watches', 'max_user_instances', 'max_queued_events'].map((k) => [k, Number(readFileSync('/proc/sys/fs/inotify/' + k, 'utf8'))]));

// What the tree holds, walked as Node's watcher walks it (readdir with types, a symlink never descended).
function census(dir, ignored) {
  const c = { dirs: 1, files: 0, symlinks: 0, other: 0, ignoredEntries: 0, byTop: {}, deepest: { depth: 0, dir }, dirsBySize: [] };
  const walk = (d, depth) => {
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    c.dirsBySize.push([entries.length, d]);
    if (depth > c.deepest.depth) c.deepest = { depth, dir: d };
    for (const e of entries) {
      const f = join(d, e.name); const rel = relative(dir, f);
      if (ignored?.(rel)) { c.ignoredEntries++; continue; }
      const top = rel.split(sep)[0]; c.byTop[top] = (c.byTop[top] ?? 0) + 1;
      if (e.isSymbolicLink()) c.symlinks++;
      else if (e.isDirectory()) { c.dirs++; walk(f, depth + 1); }
      else if (e.isFile()) c.files++;
      else c.other++;
    }
  };
  walk(dir, 0);
  c.dirsBySize.sort((a, b) => b[0] - a[0]);
  c.largestDir = c.dirsBySize[0] ?? null;
  delete c.dirsBySize;
  c.byTop = Object.fromEntries(Object.entries(c.byTop).sort((a, b) => b[1] - a[1]).slice(0, 8));
  return c;
}

// The ignore matcher for a preset: what Node 24.21.0's `ignore` option takes (a glob, a RegExp or a function, matched
// against the path relative to the root; recursive_watch.js skips a matched path entirely, its subtree included).
function ignoreFor(preset) {
  if (preset === 'none') return null;
  const always = /^\.git\/(objects|lfs)(\/|$)/;
  if (preset === 'maws') return [/(^|\/)node_modules(\/|$)/, always, /^(out|dist)(\/|$)/, /^\.claude\/worktrees(\/|$)/];
  if (preset === 'git') {
    const listed = execFileSync('git', ['-C', root, 'ls-files', '-o', '-i', '--exclude-standard', '--directory', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean).map((p) => p.replace(/\/$/, ''));
    const set = new Set(listed);
    return [always, (rel) => set.has(rel.split(sep).join('/'))];
  }
  throw new Error('unknown --ignore preset ' + preset);
}
// The alternative: one non-recursive `fs.watch` per directory (inotify names a directory's changed children, so no file
// needs a watch of its own), what the matcher ignores never walked, the walk awaiting each readdir so the event loop is
// never held for the whole tree, a directory created later added from its parent's event (one lstat per created
// entry), and a removed one dropped. ENOSPC or EMFILE from a watch is caught where it happens and marks the tree
// exhausted, which a caller can act on. A sketch to measure, not MAWS's code.
class DirTree {
  constructor(base, ignored, listener) { this.base = base; this.ignored = ignored; this.listener = listener; this.watchers = new Map(); this.errors = []; this.exhausted = false; this.handlers = { error: [] }; }
  on(event, fn) { (this.handlers[event] ??= []).push(fn); return this; }
  start() { return this.add(this.base); }
  async add(top) {
    const queue = [top];
    while (queue.length && !this.exhausted) {
      const dir = queue.shift();
      if (this.watchers.has(dir)) continue;
      let w;
      try { w = watch(dir, (type, name) => this.event(dir, type, name)); }
      catch (e) { this.errors.push({ code: e.code, dir: relative(this.base, dir) }); if (e.code === 'ENOSPC' || e.code === 'EMFILE') { this.exhausted = true; for (const fn of this.handlers.error) fn(e); } continue; }
      w.on('error', (e) => { for (const fn of this.handlers.error) fn(e); });
      this.watchers.set(dir, w);
      let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) if (e.isDirectory() && !e.isSymbolicLink()) { const f = join(dir, e.name); if (!this.ignored?.(relative(this.base, f))) queue.push(f); }
    }
  }
  event(dir, type, name) {
    if (name === null) return this.listener(type, relative(this.base, dir));
    const f = join(dir, name); const rel = relative(this.base, f);
    if (this.ignored?.(rel)) return;
    this.listener(type, rel);
    if (type !== 'rename') return;
    if (this.watchers.has(f)) { if (!existsSync(f)) for (const [k, w] of this.watchers) if (k === f || k.startsWith(f + sep)) { w.close(); this.watchers.delete(k); } }
    else lstat(f).then((s) => { if (s.isDirectory()) this.add(f); }, () => {});
  }
  close() { for (const w of this.watchers.values()) w.close(); this.watchers.clear(); }
}

const matcherOf = (ignore) => { if (!ignore) return null; const fs = ignore.map((m) => m instanceof RegExp ? (r) => m.test(r.split(sep).join('/')) : m); return (r) => fs.some((f) => f(r)); };

const out = { label, root, mode, node: process.version, kernel: readFileSync('/proc/sys/kernel/osrelease', 'utf8').trim(), ignore: ignorePreset, limits: limits() };
const ignore = ignoreFor(ignorePreset);
const tc0 = now();
out.census = census(root, matcherOf(ignore));
out.census.walkMs = Math.round(now() - tc0);
out.census.entries = out.census.dirs + out.census.files + out.census.symlinks + out.census.other;
gc();
const before = { inotify: inotifyOf(), mem: process.memoryUsage(), cpu: process.cpuUsage() };

// The watcher's call. Linux's recursive watch is Node's own JS walk (lib/internal/fs/recursive_watch.js), synchronous
// inside fs.watch, so the time the call takes is the time the event loop is blocked.
const events = [];
let onEvent = null;
const errors = [];
const listener = (type, filename) => { const at = now(); events.push({ at, type, filename }); onEvent?.(type, filename, at); };
let setupLag = 0;
const lagTimer = setInterval((() => { let last = now(); return () => { const t = now(); setupLag = Math.max(setupLag, t - last - 10); last = t; }; })(), 10);
const t0 = now();
let watcher, thrown = null;
try {
  if (mode === 'dirs') { watcher = new DirTree(root, matcherOf(ignore), listener); await watcher.start(); }
  else watcher = watch(root, { recursive: true, ...(ignore ? { ignore } : {}) }, listener);
} catch (e) { thrown = { code: e.code, message: e.message }; }
const t1 = now();
clearInterval(lagTimer);
watcher?.on('error', (e) => errors.push({ at: Math.round(now() - t0), code: e.code, message: e.message })); // as watcher.ts attaches it: after the call
const cpu1 = process.cpuUsage(before.cpu);
gc();
const after = { inotify: inotifyOf(), mem: process.memoryUsage() };
out.setup = {
  // the recursive call holds the loop for all of its walk; the tree's walk awaits each readdir, so its worst lag is the measure
  thrown, wallMs: Math.round(t1 - t0), blockedMs: mode === 'dirs' ? Math.round(setupLag) : Math.round(t1 - t0), cpuMs: Math.round((cpu1.user + cpu1.system) / 1000),
  ...(mode === 'dirs' ? { treeWatchers: watcher.watchers.size, treeErrors: watcher.errors.slice(0, 5), exhausted: watcher.exhausted } : {}),
  inotify: { instances: after.inotify.instances - before.inotify.instances, watches: after.inotify.watches - before.inotify.watches },
  rssMiB: +((after.mem.rss - before.mem.rss) / 2 ** 20).toFixed(1), heapMiB: +((after.mem.heapUsed - before.mem.heapUsed) / 2 ** 20).toFixed(1),
  externalMiB: +((after.mem.external - before.mem.external) / 2 ** 20).toFixed(1), rssTotalMiB: +(after.mem.rss / 2 ** 20).toFixed(1),
};
out.setup.watchesPerEntry = +(out.setup.inotify.watches / out.census.entries).toFixed(3);
out.setup.watchesPerDir = +(out.setup.inotify.watches / out.census.dirs).toFixed(2);
out.setup.bytesPerWatch = out.setup.inotify.watches ? Math.round(((after.mem.rss - before.mem.rss)) / out.setup.inotify.watches) : null;
await delay(500);
out.setup.eventsDuringSetup = events.length; // the walk's own 'rename' per entry goes to no listener (attached after)
out.setup.errorsSoon = errors.slice();

// One write and the time until the listener names it.
async function timeWrite(dir, name, kind) {
  const file = join(dir, name);
  const rel = relative(root, file);
  const p = new Promise((resolve) => { onEvent = (type, filename) => { if (filename === rel) resolve(now()); }; });
  const start = now();
  if (kind === 'modify') writeFileSync(file, String(start)); else writeFileSync(file, 'x');
  const at = await Promise.race([p, delay(2000).then(() => null)]);
  onEvent = null;
  return at === null ? null : +(at - start).toFixed(2);
}
const stats = (xs) => { const v = xs.filter((x) => x !== null).sort((a, b) => a - b); const q = (f) => v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] : null; return { n: xs.length, missed: xs.length - v.length, p50: q(0.5), p95: q(0.95), max: v.at(-1) ?? null }; };

if (latencyN > 0) {
  const targets = { root, deepest: out.census.deepest.dir, largestDir: out.census.largestDir?.[1] ?? root };
  out.latency = {};
  for (const [name, dir] of Object.entries(targets)) {
    const create = [], modify = [];
    const probe = `.o3g-probe-${process.pid}`;
    for (let i = 0; i < latencyN; i++) { create.push(await timeWrite(dir, `${probe}-${i}`, 'create')); await delay(20); }
    for (let i = 0; i < latencyN; i++) { modify.push(await timeWrite(dir, `${probe}-0`, 'modify')); await delay(20); }
    for (let i = 0; i < latencyN; i++) rmSync(join(dir, `${probe}-${i}`), { force: true });
    out.latency[name] = { dir: relative(root, dir) || '.', entries: readdirSync(dir).length, create: stats(create), modify: stats(modify) };
    await delay(200);
  }
  // a directory made after the watch started: its first file
  const fresh = join(root, `.o3g-fresh-${process.pid}`); mkdirSync(fresh); await delay(300);
  const first = [];
  for (let i = 0; i < latencyN; i++) { first.push(await timeWrite(fresh, `f-${i}`, 'create')); await delay(20); }
  out.latency.newDirectory = { create: stats(first) };
  rmSync(fresh, { recursive: true, force: true }); await delay(300);
}

if (flag('probe-unwatched')) {
  // which directories a write is seen in, sampled across the tree in walk order: at exhaustion the walk stops where the
  // first watch failed, so the late directories are the silent ones
  const dirs = [];
  const walk = (d) => { let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; } dirs.push(d); for (const e of es) if (e.isDirectory() && !e.isSymbolicLink()) walk(join(d, e.name)); };
  walk(root);
  const sample = Array.from({ length: 20 }, (_, i) => dirs[Math.floor((i * (dirs.length - 1)) / 19)]);
  out.unwatched = [];
  for (const d of sample) { const ms = await timeWrite(d, `.o3g-seen-${process.pid}`, 'create'); rmSync(join(d, `.o3g-seen-${process.pid}`), { force: true }); out.unwatched.push({ index: dirs.indexOf(d), of: dirs.length, dir: relative(root, d) || '.', seenMs: ms }); }
  // a directory made now: its watch is added from the listener, after the 'error' listener is attached
  const late = join(root, `.o3g-late-${process.pid}`); mkdirSync(late); await delay(300);
  out.lateDirectory = { seenMs: await timeWrite(late, 'f', 'create') };
  rmSync(late, { recursive: true, force: true }); await delay(300);
}

if (idleS > 0) {
  const c0 = process.cpuUsage(); const e0 = events.length; await delay(idleS * 1000); const c = process.cpuUsage(c0);
  out.idle = { seconds: idleS, cpuMs: Math.round((c.user + c.system) / 1000), events: events.length - e0 };
}

// Another process writes (or removes) `n` files in one new directory under the root while this one only watches: the
// wall time until the listener has heard every one, this process's CPU, and how long its event loop was held (a 10 ms
// timer's worst lateness, and perf_hooks' delay histogram), which is what a daemon's other clients would wait.
async function burst(dir, n, op) {
  const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
  let worstLag = 0, last = now();
  const tick = setInterval(() => { const t = now(); worstLag = Math.max(worstLag, t - last - 10); last = t; }, 10);
  const c0 = process.cpuUsage(); const e0 = events.length; const s = now();
  const child = spawn(process.execPath, ['-e', `const fs=require('fs');for(let i=0;i<${n};i++)${op === 'create' ? `fs.writeFileSync(${JSON.stringify(dir)}+'/c'+i,'x'+i)` : `fs.rmSync(${JSON.stringify(dir)}+'/c'+i)`};`]);
  const wrote = await new Promise((r) => child.on('exit', () => r(now())));
  const deadline = s + 600_000;
  while (events.length - e0 < n && now() < deadline) await delay(50);
  const heard = now();
  await delay(300);
  clearInterval(tick); h.disable();
  const c = process.cpuUsage(c0);
  return { files: n, op, writerMs: Math.round(wrote - s), allHeardMs: Math.round(heard - s), events: events.length - e0, cpuMs: Math.round((c.user + c.system) / 1000), worstLoopLagMs: Math.round(worstLag), loopDelayP99Ms: Math.round(h.percentile(99) / 1e6), loopDelayMaxMs: Math.round(h.max / 1e6), watches: inotifyOf().watches };
}
if (churnN > 0) {
  out.churn = [];
  for (const n of String(opt('churn', '0')).split(',').map(Number)) {
    const dir = join(root, `.o3g-churn-${process.pid}-${n}`); mkdirSync(dir); await delay(300);
    out.churn.push(await burst(dir, n, 'create'));
    out.churn.push(await burst(dir, n, 'remove'));
    rmSync(dir, { recursive: true, force: true }); await delay(500);
  }
}

out.errors = errors;
out.final = { inotify: inotifyOf(), rssMiB: +(process.memoryUsage().rss / 2 ** 20).toFixed(1) };
watcher?.close();
console.log(JSON.stringify(out));
process.exit(0);
