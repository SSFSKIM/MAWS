import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStorePaths } from './paths';
import { classifyStoreEvent, StoreWatcher, type StoreChange, type WatchFn } from './watcher';

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
  const opened: { path: string; recursive: boolean; listener: (event: string, filename: string | null) => void; handle: EventEmitter & { close: ReturnType<typeof vi.fn> } }[] = [];
  const watch: WatchFn = (path, options, listener) => {
    if (missing.has(path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    const handle = Object.assign(new EventEmitter(), { close: vi.fn() });
    opened.push({ path, recursive: options.recursive, listener, handle });
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
    fake.missing.delete('/cfg/jobs');
    vi.advanceTimersByTime(5_000);
    expect(watcher.status().jobs).toBe('open');
    vi.advanceTimersByTime(50);
    expect(changes).toEqual([{ kind: 'rescan', root: 'jobs' }]);
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
