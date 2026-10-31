import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchTree } from '@shared/fs/watch-tree';
import { drain, errno, FakeWatchFs } from '../../../test/support/fake-watch-fs';
import { inotifyOf, until } from '../../../test/support/inotify';
import { resolveStorePaths } from './paths';
import { classifyStoreEvent, DEBOUNCE_MS, SETTLE_MS, STORE_POLL_MS, storePrune, StoreWatcher, type StoreChange, type WatchFn } from './watcher';

const paths = resolveStorePaths({ CLAUDE_CONFIG_DIR: '/cfg' });
const SID = '0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9';

describe('store events are classified by their path under a root', () => {
  it.each([
    ['projects', `-a-b/${SID}.jsonl`, { kind: 'transcript', slug: '-a-b', sessionId: SID, path: join('/cfg/projects/-a-b', `${SID}.jsonl`) }],
    ['projects', `-a-b/${SID}/custom-title.json`, { kind: 'sidecar', slug: '-a-b', sessionId: SID, rel: 'custom-title.json' }],
    ['projects', `-a-b/${SID}/subagents/agent-a1.meta.json`, { kind: 'sidecar', slug: '-a-b', sessionId: SID, rel: 'subagents/agent-a1.meta.json' }],
    ['projects', `-a-b/${SID}/workflows/wf_1.json`, { kind: 'sidecar', slug: '-a-b', sessionId: SID, rel: 'workflows/wf_1.json' }],
    ['projects', '-a-b', { kind: 'rescan', root: 'projects' }],
    ['sessions', '4242.json', { kind: 'registry', pid: 4242, path: '/cfg/sessions/4242.json' }],
    ['jobs', 'abcd1234/state.json', { kind: 'job', jobId: 'abcd1234', path: '/cfg/jobs/abcd1234/state.json' }],
    ['tasks', `${SID}/3.json`, { kind: 'taskList', listId: SID }],
  ] as const)('%s %s', (root, rel, change) => {
    expect(classifyStoreEvent(paths, root, rel)).toEqual(change);
  });

  it.each([
    ['projects', `-a-b/${SID}.orphaned-1727500000000-abcdef12.jsonl`], // quarantined (SPEC 35.2.6)
    ['projects', `-a-b/${SID}.superseded-1727500000000.jsonl`],
    ['projects', '-a-b/not-a-session.jsonl'], // the engine lists only UUID stems (SPEC 35.14.1)
    ['projects', `-a-b/${SID}.jsonl.tmp.123.4`],
    ['projects', `-a-b/${SID}/tool-results/b95u0622n.txt`], // spills are read on demand
    ['projects', '-a-b/memory/MEMORY.md'],
    ['projects', `-a-b/${SID}`], // the sidecar directory itself
    ['projects', '.session-aliases'],
    ['projects', `-a-b/${SID}/recording.cast`],
    ['sessions', '4242.key'],
    ['sessions', '4242.json.tmp.99.1'],
    ['sessions', '.fleetview-heartbeat'],
    ['sessions', 'notes.json'],
    ['jobs', 'abcd1234/timeline.jsonl'],
    ['jobs', 'abcd1234/tmp/out.txt'],
    ['jobs', 'abcd1234'],
    ['tasks', `${SID}/.lock`],
  ] as const)('ignores %s %s', (root, rel) => {
    expect(classifyStoreEvent(paths, root, rel)).toBeNull();
  });
});

// A stand-in for fs.watch: records every open and lets the test fire events and errors into it.
function fakeWatch(missing = new Set<string>()) {
  const opened: { path: string; recursive: boolean; prune: ((dir: string) => boolean) | undefined; listener: (event: string, filename: string | null) => void; handle: EventEmitter & { close: ReturnType<typeof vi.fn> } }[] = [];
  const watch: WatchFn = (path, options, listener) => {
    if (missing.has(path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    const handle = Object.assign(new EventEmitter(), { close: vi.fn() });
    opened.push({ path, recursive: options.recursive, prune: options.prune, listener, handle });
    return handle;
  };
  const latest = (path: string) => [...opened].reverse().find((o) => o.path === path)!;
  return { watch, opened, missing, latest, fire: (path: string, filename: string | null, event = 'change') => latest(path).listener(event, filename) };
}

describe('StoreWatcher', () => {
  let changes: StoreChange[];
  beforeEach(() => {
    vi.useFakeTimers();
    changes = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens one recursive watch on projects, jobs and tasks and a flat one on sessions', () => {
    const fake = fakeWatch();
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch: fake.watch });
    watcher.start();
    expect(fake.opened.map((o) => [o.path, o.recursive])).toEqual([
      ['/cfg/projects', true],
      ['/cfg/sessions', false],
      ['/cfg/jobs', true],
      ['/cfg/tasks', true],
    ]);
    expect(watcher.status()).toEqual({ projects: 'open', sessions: 'open', jobs: 'open', tasks: 'open' });
    watcher.stop();
  });

  it('coalesces events per key with a 50 ms trailing debounce', () => {
    const fake = fakeWatch();
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch: fake.watch });
    watcher.start();
    fake.fire('/cfg/projects', `-a-b/${SID}.jsonl`);
    vi.advanceTimersByTime(30);
    fake.fire('/cfg/projects', `-a-b/${SID}.jsonl`);
    fake.fire('/cfg/sessions', '4242.json', 'rename');
    vi.advanceTimersByTime(49);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([
      { kind: 'transcript', slug: '-a-b', sessionId: SID, path: join('/cfg/projects/-a-b', `${SID}.jsonl`) },
      { kind: 'registry', pid: 4242, path: '/cfg/sessions/4242.json' },
    ]);
    watcher.stop();
  });

  it('turns an event without a filename into a rescan of that root', () => {
    const fake = fakeWatch();
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch: fake.watch });
    watcher.start();
    fake.fire('/cfg/projects', null, 'rename');
    fake.fire('/cfg/projects', null, 'rename');
    vi.advanceTimersByTime(50);
    expect(changes).toEqual([{ kind: 'rescan', root: 'projects' }]);
    watcher.stop();
  });

  it('on a watcher error asks for a rescan and re-opens the watch after 1 s', () => {
    const fake = fakeWatch();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch: fake.watch });
    watcher.start();
    const first = fake.latest('/cfg/sessions');
    first.handle.emit('error', new Error('stream dropped'));
    expect(first.handle.close).toHaveBeenCalled();
    expect(watcher.status().sessions).toBe('reopening');
    vi.advanceTimersByTime(50);
    expect(changes).toEqual([{ kind: 'rescan', root: 'sessions' }]);
    vi.advanceTimersByTime(950);
    expect(fake.latest('/cfg/sessions')).not.toBe(first);
    expect(watcher.status().sessions).toBe('open');
    expect(errors).toHaveBeenCalled();
    watcher.stop();
  });

  it('retries a missing root every 5 s and rescans it once it exists', () => {
    const fake = fakeWatch(new Set(['/cfg/jobs']));
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch: fake.watch });
    watcher.start();
    expect(watcher.status().jobs).toBe('missing');
    vi.advanceTimersByTime(5_000);
    expect(watcher.status().jobs).toBe('missing');
    changes.splice(0); // the other roots' settle rescans
    fake.missing.delete('/cfg/jobs');
    vi.advanceTimersByTime(5_000);
    expect(watcher.status().jobs).toBe('open');
    vi.advanceTimersByTime(SETTLE_MS + DEBOUNCE_MS);
    expect(changes).toEqual([{ kind: 'rescan', root: 'jobs' }]);
    watcher.stop();
  });

  // FSEvents starts its stream asynchronously after fs.watch returns, and a write in the first milliseconds is not
  // reported (measured: 7 of 30 writes made 0 to 1 ms after the call were missed). One rescan per root once the stream
  // has settled covers whatever changed in between, at start and after every re-open.
  it('rescans each root once, 250 ms after its watch opens, so nothing written while the stream was starting is lost', () => {
    const fake = fakeWatch();
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch: fake.watch });
    watcher.start();
    vi.advanceTimersByTime(SETTLE_MS + DEBOUNCE_MS - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual(['projects', 'sessions', 'jobs', 'tasks'].map((root) => ({ kind: 'rescan', root })));
    vi.advanceTimersByTime(10_000);
    expect(changes).toHaveLength(4);
    watcher.stop();
  });

  it('reports a watch the platform refuses as failed, without throwing', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const watch: WatchFn = () => {
      throw Object.assign(new Error('recursive watch unavailable'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' });
    };
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch });
    expect(() => watcher.start()).not.toThrow();
    expect(watcher.status().projects).toBe('failed');
    expect(errors).toHaveBeenCalled();
    watcher.stop();
  });

  it('delivers nothing after stop', () => {
    const fake = fakeWatch();
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch: fake.watch });
    watcher.start();
    fake.fire('/cfg/projects', `-a-b/${SID}.jsonl`);
    watcher.stop();
    vi.advanceTimersByTime(10_000);
    expect(changes).toEqual([]);
    for (const o of fake.opened) expect(o.handle.close).toHaveBeenCalled();
  });
});

// P5 O3-E M1: on Linux the store's recursive roots are watched through the watch tree (src/shared/fs/watch-tree.ts),
// which prunes the subtrees the classifier never reads, and a root that runs out of inotify's budget is rescanned on a
// timer rather than left dark.
describe("the store's prune", () => {
  const OTHER = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';

  it("drops a project's directory that is no session's and a session's tool-results/, nothing else", () => {
    const prune = storePrune('projects')!;
    for (const dir of ['-a-b/memory', '-a-b/notes', `-a-b/${SID}.jsonl`, `-a-b/${SID}/tool-results`]) expect(prune(dir), dir).toBe(true);
    for (const dir of ['-a-b', '.hidden', `-a-b/${SID}`, `-a-b/${SID}/memory`, `-a-b/${SID}/subagents`, `-a-b/${SID}/workflows`, `-a-b/${SID}/tasks`, `-a-b/${SID}/subagents/tool-results`]) expect(prune(dir), dir).toBe(false);
    for (const root of ['sessions', 'jobs', 'tasks'] as const) expect(storePrune(root)).toBeUndefined();
  });

  // Each pruned subtree is one whose every path the classifier nulls: what the tree never watches it never misses.
  it.each([
    ['-a-b/memory', ['MEMORY.md', `${SID}.jsonl`, `${SID}/custom-title.json`, 'deep/er/x.json']],
    [`-a-b/${OTHER}/tool-results`, ['b95u0622n.txt', `${SID}.jsonl`, 'subagents/agent-a1.meta.json']],
  ])('pins %s against the classifier', (dir, beneath) => {
    expect(storePrune('projects')!(dir)).toBe(true);
    expect(classifyStoreEvent(paths, 'projects', dir)).toBeNull();
    for (const rel of beneath) expect(classifyStoreEvent(paths, 'projects', `${dir}/${rel}`), rel).toBeNull();
  });

  it("keeps a session's memory/, whose files are sidecars", () => {
    expect(storePrune('projects')!(`-a-b/${SID}/memory`)).toBe(false);
    expect(classifyStoreEvent(paths, 'projects', `-a-b/${SID}/memory/MEMORY.md`)).toEqual({ kind: 'sidecar', slug: '-a-b', sessionId: SID, rel: 'memory/MEMORY.md' });
  });

  it('is passed to the projects root alone', () => {
    const fake = fakeWatch();
    const watcher = new StoreWatcher(paths, () => {}, { watch: fake.watch });
    watcher.start();
    expect(fake.opened.map((o) => [o.path, o.prune === undefined ? null : o.prune === storePrune('projects') ? 'projects' : 'other'])).toEqual([
      ['/cfg/projects', 'projects'],
      ['/cfg/sessions', null],
      ['/cfg/jobs', null],
      ['/cfg/tasks', null],
    ]);
    watcher.stop();
  });
});

describe('the store watcher over the watch tree', () => {
  let changes: StoreChange[];
  let fs: FakeWatchFs;
  const treeOver = (): WatchFn => (path, options, listener) => (options.recursive ? watchTree(path, { prune: options.prune, fs: fs.options }, listener) : fs.fs.watch(path, {}, listener));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    changes = [];
    fs = new FakeWatchFs('/cfg');
    for (const root of ['projects', 'sessions', 'jobs', 'tasks']) fs.mkdir(root);
  });
  afterEach(() => vi.useRealTimers());

  async function started(): Promise<StoreWatcher> {
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch: treeOver() });
    watcher.start();
    await drain();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + DEBOUNCE_MS);
    changes.length = 0;
    return watcher;
  }

  it("reports a new job's state.json and a new task list's file, written before their directory's watch opened, with no slow timer", async () => {
    const watcher = await started();
    fs.write('jobs/abcd1234/state.json');
    fs.fire('jobs', 'rename', 'abcd1234');
    fs.write(`tasks/${SID}/1.json`);
    fs.fire('tasks', 'rename', SID);
    await drain();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(changes).toEqual([
      { kind: 'job', jobId: 'abcd1234', path: '/cfg/jobs/abcd1234/state.json' },
      { kind: 'taskList', listId: SID },
    ]);
    watcher.stop();
  });

  it("never watches a project's pruned directories", async () => {
    fs.write(`projects/-a-b/${SID}.jsonl`);
    fs.write('projects/-a-b/memory/MEMORY.md');
    fs.write(`projects/-a-b/${SID}/tool-results/x.txt`);
    fs.write(`projects/-a-b/${SID}/memory/MEMORY.md`);
    const watcher = await started();
    expect(fs.watched().filter((dir) => dir.startsWith('projects')).sort()).toEqual(['projects', 'projects/-a-b', `projects/-a-b/${SID}`, `projects/-a-b/${SID}/memory`]);
    watcher.stop();
  });

  // `projects/` is a tree; `sessions/` is flat, on fs.watch itself, whose open throws.
  it.each(['projects', 'sessions'] as const)('on exhaustion at the open of %s/ logs once, stays failed and rescans the root every STORE_POLL_MS until stopped', async (root) => {
    fs.failWatch = (path) => (path === `/cfg/${root}` ? errno('ENOSPC', path) : null);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch: treeOver() });
    watcher.start();
    await drain();
    await vi.advanceTimersByTimeAsync(SETTLE_MS + DEBOUNCE_MS);
    expect(watcher.status()[root]).toBe('failed');
    expect(changes.filter((c) => c.kind === 'rescan' && c.root === root)).toHaveLength(1);
    changes.length = 0;
    await vi.advanceTimersByTimeAsync(STORE_POLL_MS * 3);
    expect(changes).toEqual([{ kind: 'rescan', root }, { kind: 'rescan', root }, { kind: 'rescan', root }]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0].join(' '))).toContain('ENOSPC');
    expect(watcher.status()[root]).toBe('failed');
    watcher.stop();
    await vi.advanceTimersByTimeAsync(STORE_POLL_MS * 3);
    expect(changes).toHaveLength(3);
  });

  it("on its handle's later exhaustion, of a directory beneath the root, does the same rather than re-open", async () => {
    fs.mkdir('projects/-a-b');
    fs.failWatch = (path) => (path === '/cfg/projects/-a-b' ? errno('EMFILE', path) : null);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const watcher = new StoreWatcher(paths, (c) => changes.push(c), { watch: treeOver() });
    watcher.start();
    await drain();
    expect(watcher.status().projects).toBe('failed');
    await vi.advanceTimersByTimeAsync(SETTLE_MS + DEBOUNCE_MS);
    changes.length = 0;
    await vi.advanceTimersByTimeAsync(STORE_POLL_MS);
    expect(changes).toEqual([{ kind: 'rescan', root: 'projects' }]);
    expect(fs.watched().filter((dir) => dir.startsWith('projects'))).toEqual([]); // no re-open
    expect(errors).toHaveBeenCalledTimes(1);
    watcher.stop();
  });
});

// Real inotify, on the pool's Linux unit job: the default watch is the tree.
describe.runIf(process.platform === 'linux')('the store watcher over inotify', () => {
  let config: string;
  beforeEach(() => void (config = realpathSync(mkdtempSync(join(tmpdir(), 'maws-store-watch-')))));
  afterEach(() => rmSync(config, { recursive: true, force: true }));

  it('watches through the tree by default: one watch per directory, none per transcript', async () => {
    const store = resolveStorePaths({ CLAUDE_CONFIG_DIR: config });
    mkdirSync(join(store.projects, '-a-b'), { recursive: true });
    mkdirSync(store.sessions);
    const ids = Array.from({ length: 50 }, (_, i) => `0b1c2d3e-4f50-4617-8293-${String(i).padStart(12, '0')}`);
    for (const id of ids) writeFileSync(join(store.projects, '-a-b', `${id}.jsonl`), '{}\n');
    const heard: StoreChange[] = [];
    const before = inotifyOf().watches;
    const watcher = new StoreWatcher(store, (c) => heard.push(c));
    watcher.start();
    try {
      await until(() => heard.some((c) => c.kind === 'rescan' && c.root === 'projects'), 2000, 'the settle rescan');
      expect(inotifyOf().watches - before).toBe(3); // projects, projects/-a-b and the flat sessions/ (jobs/ and tasks/ do not exist)
      appendFileSync(join(store.projects, '-a-b', `${ids[7]}.jsonl`), '{}\n');
      await until(() => heard.some((c) => c.kind === 'transcript' && c.sessionId === ids[7]), 1000, 'the append');
    } finally {
      watcher.stop();
    }
  });
});
