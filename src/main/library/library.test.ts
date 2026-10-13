// The library's side of main as started (index.ts): the reads registered over the index, the sync reading the host
// through the dispatch adapter (source.ts), `library.changed` told once per tick, and the two ways it serves nothing
// new: a host that has no library reads (the runtime's answer to a command it has no handler for) and an index this
// app cannot use.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, CommandResult, EventName } from '@shared/ipc/schema';
import { ipcError } from '@shared/ipc/errors';
import type { LibraryEntry } from '@shared/ipc/schema/library';
import { tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import type { LibraryStore } from './store';
import { startLibrary } from './index';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const entry = (n: number, over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: uuid(n), kind: 'html', title: `Page ${n}`, createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false,
  agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 2, ...over,
});

type Handler = (input: unknown) => unknown;
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// A host as main's supervisor shows it: a command with no answer here is refused as the host runtime refuses a
// registered command it has no handler for.
function fakeHost(answers: Partial<Record<CommandName, Handler>>) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const streamingListeners = new Set<() => void>();
  const dispatched: string[] = [];
  return {
    dispatched,
    dispatch: async (_owner: string, name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
      dispatched.push(name);
      const answer = answers[name];
      if (!answer) return { ok: false, error: ipcError('internal', `this host has no handler for ${name}`) };
      return { ok: true, value: answer(input) as never };
    },
    onEvent: (name: EventName, listener: (payload: never) => void) => {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      set.add(listener as (payload: unknown) => void);
      return () => set.delete(listener as (payload: unknown) => void);
    },
    onStreaming: (_owner: string, listener: () => void) => {
      streamingListeners.add(listener);
      return () => streamingListeners.delete(listener);
    },
    streaming: () => true,
    tell: (name: EventName, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload)),
    connect: () => streamingListeners.forEach((listener) => listener()),
  };
}

describe('startLibrary', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let handlers: Map<string, Handler>;
  let emitted: { name: string; payload: unknown }[];
  let stop: () => void;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    handlers = new Map();
    emitted = [];
    stop = () => {};
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    stop();
    index.close();
    dir.dispose();
    vi.restoreAllMocks();
  });
  const start = (host: ReturnType<typeof fakeHost>, target: Pick<Index, 'library' | 'unavailable'> = index, tickMs = 0) => {
    ({ stop } = startLibrary({
      index: target,
      hosts: host as never,
      register: ((name: string, handler: Handler) => handlers.set(name, handler)) as never,
      emit: ((name: string, payload: unknown) => emitted.push({ name, payload }) > 0) as never,
      tickMs,
      settleMs: 0,
    }));
  };
  const call = (name: string, input?: unknown) => handlers.get(name)!(input);

  it('reconciles from the host’s snapshot, answers the reads from the index, and tells library.changed once per tick', async () => {
    const host = fakeHost({
      'library.snapshot': () => ({ artifacts: [entry(1, { updatedAt: 5 }), entry(2, { updatedAt: 9 })], links: [], spaces: [] }),
      'library.text': (input) => ({ revision: 1, text: `text of ${(input as { artifactId: string }).artifactId.slice(-1)}` }),
    });
    // The clock is the test's, so a tick is a tick whatever the machine's load: the host's answers and the texts' settles
    // (0 ms) all run inside the first 16 ms tick, and the tick then tells the whole of it once.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const TICK = 16;
    start(host, index, TICK);
    await vi.advanceTimersByTimeAsync(TICK - 1);
    expect(call('library.list', {})).toMatchObject({ rows: [{ id: uuid(2) }, { id: uuid(1) }], counts: { html: 2, document: 0 } });
    expect(call('library.get', { artifactId: uuid(1) })).toMatchObject({ row: { id: uuid(1), title: 'Page 1' } });
    expect(call('library.spaces')).toEqual({ spaces: [] });
    expect(call('library.list', { filter: { query: 'text of 2' } })).toMatchObject({ rows: [{ id: uuid(2), snippet: 'text of 2' }] });
    // the reconciliation and the two texts committed three times within the tick, and nothing was told before it ended
    const committed = index.library.revision;
    expect(committed).toBe(3);
    expect(emitted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(emitted).toEqual([{ name: 'library.changed', payload: { revision: committed } }]);

    emitted.length = 0;
    host.tell('artifacts.changed', { artifactId: uuid(1), kind: 'html', revision: 2, change: 'deleted' });
    host.tell('artifacts.changed', { artifactId: uuid(2), kind: 'html', revision: 2, change: 'deleted' });
    await vi.advanceTimersByTimeAsync(TICK - 1);
    expect(call('library.list', {})).toMatchObject({ rows: [] });
    expect(emitted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(emitted).toEqual([{ name: 'library.changed', payload: { revision: index.library.revision } }]);
  });

  it('a host without the library reads leaves the index as it is and logs why, while Space changes still land', async () => {
    index.library.reconcile({ artifacts: [entry(1)], links: [], spaces: [] });
    const space = { id: uuid(0xa1), name: 'Work', createdAt: 1 };
    const host = fakeHost({ 'spaces.list': () => ({ spaces: [space] }) });
    start(host);
    await settle(5);
    expect(host.dispatched).toEqual(['library.snapshot']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[library]'), 'library.snapshot: internal: this host has no handler for library.snapshot');
    expect(call('library.list', {})).toMatchObject({ rows: [{ id: uuid(1) }] });

    host.tell('artifacts.changed', { artifactId: uuid(1), kind: 'html', revision: 2, change: 'updated' });
    host.tell('spaces.changed', { spaceId: space.id, change: 'created' });
    await settle(5);
    expect(call('library.get', { artifactId: uuid(1) })).toMatchObject({ row: { revision: 1 } });
    expect(call('library.spaces')).toEqual({ spaces: [{ ...space, count: 0 }] });
  });

  it('with an index this app cannot use, the reads answer empty, the reason is logged and the host is never asked', async () => {
    const host = fakeHost({});
    start(host, { unavailable: 'user_version 99 is newer than this app knows (9)', library: {} as LibraryStore });
    host.connect();
    await settle(5);
    expect(call('library.list', { filter: { kind: 'html' } })).toEqual({ rows: [], counts: { document: 0, presentation: 0, design: 0, design_system: 0, dashboard: 0, html: 0, file: 0 } });
    expect(call('library.get', { artifactId: uuid(1) })).toEqual({ row: null });
    expect(call('library.spaces')).toEqual({ spaces: [] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('user_version 99 is newer than this app knows (9)'));
    expect(host.dispatched).toEqual([]);
  });

  it('after stop tells nothing more and follows no event', async () => {
    const host = fakeHost({ 'library.snapshot': () => ({ artifacts: [], links: [], spaces: [] }) });
    start(host);
    await settle(5);
    stop();
    emitted.length = 0;
    host.dispatched.length = 0;
    host.connect();
    host.tell('artifacts.changed', { artifactId: uuid(1), kind: 'html', revision: 2, change: 'updated' });
    await settle(5);
    expect(host.dispatched).toEqual([]);
    expect(emitted).toEqual([]);
  });
});
