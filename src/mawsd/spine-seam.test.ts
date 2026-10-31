// The spine seam (P5 O3-D M2; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §A; D5, D6, D8, D9, D26,
// D27): how `mawsd` loads, holds, releases, re-executes and yields the spine, over a stand-in of the services chunk (the
// real `spine.lock`, a recording root) and a stand-in of the engine-host link. The real spine composed by the seam inside
// `mawsd` is daemon-spine.test.ts's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { HostDispatch } from '@shared/host/host-supervisor';
import type { CommandResult, HostState } from '@shared/ipc/schema';
import type { SpineView, SpineViewEvents } from '@shared/spine/view';
import { status as statusOf } from '../../test/support/builders';
import { ev } from '../../test/support/events';
import { takeSpineLock, type SpineLock } from '../services/settings/spine-lock';
import type { SpineDeps, SpineHosts, SpineRoot } from '../services/spine-root';
import type { EngineLink } from './spine-hosts';
import { createLazySpine, workingSession, type LazySpine, type LazySpineOptions, type SpineEntry } from './spine-seam';

const BUILD = '0.0.0+spine-seam-test';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The engine host's link as the supervisor offers it to the seam: events validated and delivered by name, the link's state
// and its streaming, and a dispatch whose answers a test scripts (a gate holds one).
class FakeLink {
  readonly calls: { name: string; input: unknown }[] = [];
  readonly answers = new Map<string, (input: unknown) => unknown>();
  readonly gates = new Map<string, Promise<void>>();
  private readonly events = new Map<string, Set<(payload: unknown) => void>>();
  private readonly states = new Set<(state: HostState) => void>();
  private readonly streams = new Set<() => void>();
  private live = false;
  state: HostState = { state: 'ready', pid: 4242, restarts: 0, revision: 1 };

  onEvent = ((name: string, listener: (payload: unknown) => void) => {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name)!.add(listener);
    return () => void this.events.get(name)!.delete(listener);
  }) as EngineLink['onEvent'];
  onState = (_owner: string, listener: (state: HostState) => void) => (this.states.add(listener), () => void this.states.delete(listener));
  onStreaming = (_owner: string, listener: () => void) => (this.streams.add(listener), () => void this.streams.delete(listener));
  streaming = () => this.live;
  snapshot = () => this.state;
  dispatch: HostDispatch = async (_owner, name, input) => {
    this.calls.push({ name, input });
    await this.gates.get(name);
    const answer = this.answers.get(name);
    return (answer ? { ok: true, value: answer(input) } : { ok: false, error: { code: 'host_unavailable', message: `no ${name}` } }) as CommandResult<never>;
  };

  emit(name: string, payload: unknown): void {
    for (const listener of [...(this.events.get(name) ?? [])]) listener(payload);
  }
  batch(appSessionId: string, ...seqs: number[]): void {
    this.emit('session.eventBatch', { appSessionId, events: seqs.map((seq) => ev('turn.started', { id: `${appSessionId}:L1:${seq}:0`, seq })) });
  }
  stream(): void {
    this.live = true;
    for (const listener of [...this.streams]) listener();
  }
  leave(): void {
    this.live = false;
    this.state = { ...this.state, state: 'restarting', revision: this.state.revision + 1 };
    for (const listener of [...this.states]) listener(this.state);
  }
  arrive(): void {
    this.state = { ...this.state, state: 'ready', revision: this.state.revision + 1 };
    for (const listener of [...this.states]) listener(this.state);
  }
  listeners(): number {
    let count = this.states.size + this.streams.size;
    for (const set of this.events.values()) count += set.size;
    return count;
  }
  gate(name: string): () => void {
    let open!: () => void;
    this.gates.set(name, new Promise<void>((resolve) => (open = resolve)));
    return () => {
      this.gates.delete(name);
      open();
    };
  }
}

// A root as the services chunk's `startSpine` would compose one, recording what reached it: each event, in order, with
// whether it came at the barrier (`coalesced`, `held`) or live, and the resync it registered; its view's engine statuses
// follow `session.status`. Its work is a test's to hold (`busy`).
class FakeRoot implements SpineRoot {
  readonly seen: string[] = [];
  readonly later: number[] = []; // at each held batch: how many held events follow it (HeldReplay.later)
  readonly stop = vi.fn();
  private readonly statuses = new Map<string, EngineSessionStatus>();
  private readonly engine = new Set<SpineViewEvents['engine']>();
  private work: Promise<void> | null = null;
  resyncs = 0;
  readonly view: SpineView;

  constructor(readonly hosts: SpineHosts, readonly deps: SpineDeps) {
    const phase = () => (hosts.replay?.replaying() ? 'held' : hosts.replay?.barrier() ? 'coalesced' : 'live');
    hosts.onEvent('session.eventBatch', ({ appSessionId, events }) => {
      if (phase() === 'held') this.later.push(hosts.replay!.later().length);
      const kinds = events.some((e) => e.kind !== 'turn.started') ? ` (${events.map((e) => e.kind).join(',')})` : '';
      this.seen.push(`${phase()} batch ${appSessionId} ${events.map((e) => e.seq).join(',')}${kinds}`);
    });
    hosts.onEvent('session.brokerItems', ({ appSessionId, items }) => void this.seen.push(`${phase()} brokerItems ${appSessionId} ${items.map((i) => i.summary).join(',') || 'none'}`));
    hosts.onEvent('session.status', ({ status }) => {
      this.seen.push(`${phase()} status ${status.appSessionId} ${status.process}`);
      this.statuses.set(status.appSessionId, status);
      for (const listener of this.engine) listener(status.appSessionId, status);
    });
    hosts.setResync('engine-host', async (dispatch: HostDispatch, signal: AbortSignal) => {
      this.resyncs += 1;
      this.seen.push('resync');
      const answered = await dispatch('engine-host', 'engine.sessions', undefined);
      this.seen.push(signal.aborted ? `resync aborted (${String(signal.reason)})` : `resync paged (${answered.ok ? 'ok' : answered.error.code})`);
    });
    this.view = {
      engineStatuses: () => [...this.statuses.values()],
      on: (event: string, listener: never) => {
        if (event !== 'engine') return () => {};
        this.engine.add(listener);
        return () => void this.engine.delete(listener);
      },
    } as unknown as SpineView;
  }

  hold(): () => void {
    let done!: () => void;
    this.work = new Promise<void>((resolve) => (done = resolve));
    return () => {
      this.work = null;
      done();
    };
  }
  busy(): boolean {
    return this.work !== null;
  }
  async settled(): Promise<void> {
    while (this.work !== null) await this.work;
  }
}

let profile: string;
let link: FakeLink;
let roots: FakeRoot[];
let logs: string[];
let states: string[];
let restarts: string[];
let yieldExits: number;
let collected: number;
let ended: number;
let loads: number;
let spines: LazySpine[];
let other: SpineLock | null;

function seam(extra: Partial<LazySpineOptions> = {}): LazySpine {
  const entry: SpineEntry = {
    takeSpineLock,
    openSpineData: async (_profile, { lock }) => ({ lock: lock!, refused: lock!.refused, machineSettings: null as never, paths: { client: '', machine: '' } }),
    startSpine: (deps) => {
      const root = new FakeRoot(deps.hosts, deps);
      roots.push(root);
      return root;
    },
  };
  const spine = createLazySpine({
    profileDir: profile,
    build: BUILD,
    hosts: link,
    intercept: () => null,
    load: async () => (loads++, entry),
    deps: () => ({}) as Omit<SpineDeps, 'data' | 'hosts'>,
    quietMs: () => 40,
    reexecute: false,
    wakeOnEvents: true,
    endLink: async () => void ended++,
    restart: (reason) => void restarts.push(reason),
    exitForYield: () => void yieldExits++,
    collected: () => void collected++,
    onState: (state, detail) => void states.push(detail === null ? state : `${state}: ${detail}`),
    log: (line) => void logs.push(line),
    lockWaitMs: 50,
    timing: { yieldCheckMs: 20, yieldSettleMs: 200, settleLogMs: 50, refusalRetryMs: 60_000, stopSettleMs: 100, provisionalYieldMs: 100 },
    ...extra,
  });
  spines.push(spine);
  return spine;
}

const working = (appSessionId: string, over: Parameters<typeof statusOf>[1] = {}) => ({ appSessionId, status: statusOf(appSessionId, over) });

beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'maws-seam-'));
  link = new FakeLink();
  link.answers.set('engine.sessions', () => []);
  roots = [];
  logs = [];
  states = [];
  restarts = [];
  yieldExits = 0;
  collected = 0;
  ended = 0;
  loads = 0;
  spines = [];
  other = null;
});

afterEach(async () => {
  for (const spine of spines) await spine.stop();
  other?.release();
  rmSync(profile, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('the load', () => {
  it('is cold at start, loads the chunk at the first spine command, holds spine.lock and answers with the root', async () => {
    const spine = seam();
    expect(spine.state()).toBe('cold');
    expect(loads).toBe(0);
    const root = await spine.ensure('command');
    expect(root).toBe(roots[0]);
    expect(spine.state()).toBe('loaded');
    expect(loads).toBe(1);
    expect(states).toEqual(['loading: command', expect.stringMatching(/^loaded: in \d+ ms$/)]);
    expect(spine.status()).toMatchObject({ state: 'loaded', refused: null, heldDropped: 0, loadedAt: expect.any(String) });
    // the lock is this process's: another candidate is refused
    const candidate = await takeSpineLock(profile, { build: 'other', waitMs: 10, log: () => {} });
    expect(candidate.refused).toMatch(/^spine\.lock is held by pid \d+ \(build 0\.0\.0\+spine-seam-test\)/);
  });

  it('a second trigger while it loads waits for the same load', async () => {
    const spine = seam();
    const [a, b] = await Promise.all([spine.ensure('command'), spine.ensure('command')]);
    expect(a).toBe(b);
    expect(roots).toHaveLength(1);
  });

  it('refused by a live holder of spine.lock: every ensure rejects naming the holder, and a trigger tries again only after a minute', async () => {
    other = await takeSpineLock(profile, { build: 'the app', log: () => {} });
    let now = 1_000_000;
    const spine = seam({ now: () => now });
    await expect(spine.ensure('command')).rejects.toThrow(/spine\.lock is held by pid \d+ \(build the app\)/);
    expect(spine.state()).toBe('refused');
    expect(spine.status().refused).toMatch(/held by pid \d+ \(build the app\)/);
    other.release();
    other = null;
    now += 59_000;
    await expect(spine.ensure('command')).rejects.toThrow(/held by pid/); // within the minute: the refusal stands
    expect(loads).toBe(1);
    now += 2_000;
    expect(await spine.ensure('command')).toBe(roots[0]); // the next trigger after it tries again
  });

  it('a load that ends refused discards what it held, counted', async () => {
    other = await takeSpineLock(profile, { build: 'the app', log: () => {} });
    const spine = seam();
    link.batch('s1', 1); // a batch while cold: the trigger, held
    link.batch('s1', 2);
    await vi.waitFor(() => expect(spine.state()).toBe('refused'));
    expect(spine.status().heldDropped).toBe(2);
    expect(roots).toHaveLength(0);
  });
});

describe('the hold and the barrier', () => {
  it('a periodic status while cold wakes nothing; the coalesced parts, the latest per session, replay into the spine at load', async () => {
    const spine = seam();
    link.emit('session.status', working('s1', { process: 'starting' }));
    link.emit('session.status', working('s1', { process: 'ready' }));
    link.emit('session.queue', { appSessionId: 's1', queue: [] });
    await sleep(10);
    expect(spine.state()).toBe('cold');
    const root = (await spine.ensure('command')) as FakeRoot;
    expect(root.seen).toEqual(['coalesced status s1 ready']);
  });

  it('a batch while cold is a trigger; what arrives until the barrier is held and drained in order after the resync, then live', async () => {
    link.stream();
    const release = link.gate('engine.sessions'); // the resync's listing waits
    const spine = seam();
    link.emit('session.status', working('s1')); // coalesced
    link.batch('s1', 1); // the trigger
    await vi.waitFor(() => expect(roots).toHaveLength(1));
    link.batch('s1', 2); // during the resync: held
    link.emit('session.status', working('s1', { process: 'exiting' }));
    release();
    const root = (await spine.ensure('command')) as FakeRoot;
    link.batch('s1', 3);
    expect(root.seen).toEqual([
      'coalesced status s1 ready',
      'resync',
      'resync paged (ok)',
      'held batch s1 1',
      'held batch s1 2',
      'held status s1 exiting',
      'live batch s1 3',
    ]);
    expect(root.later).toEqual([2, 1]); // the hold's own order, offered to the fold at each held event
    expect(logs).toContainEqual(expect.stringMatching(/^\[spine\] the hold drained: 3 events \(\d+ bytes\)$/));
  });

  it('a batch while cold wakes nothing when events do not wake the spine (M2 in production)', async () => {
    const spine = seam({ wakeOnEvents: false });
    link.batch('s1', 1);
    await sleep(10);
    expect(spine.state()).toBe('cold');
    expect(loads).toBe(0);
  });

  it('a resync that stalls ends at its bound: the drain still runs in order, and a late page folds nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      link.stream();
      const release = link.gate('engine.sessions');
      const spine = seam();
      link.batch('s1', 1);
      await vi.waitFor(() => expect(roots).toHaveLength(1));
      link.batch('s1', 2);
      const loaded = spine.ensure('command');
      await vi.advanceTimersByTimeAsync(30_000); // RESYNC_BOUND_MS
      const root = (await loaded) as FakeRoot;
      expect(root.seen).toEqual(['resync', 'held batch s1 1', 'held batch s1 2']);
      release(); // the stalled page answers late
      await vi.advanceTimersByTimeAsync(0);
      expect(root.seen.at(-1)).toBe('resync aborted (bound)');
      expect(logs).toContainEqual(expect.stringContaining('resync took longer than 30 s'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a link that streams once the spine is loaded runs the resync then, holding the live batches meanwhile', async () => {
    const spine = seam();
    const root = (await spine.ensure('command')) as FakeRoot;
    expect(root.resyncs).toBe(0); // the link was not streaming at the load
    const release = link.gate('engine.sessions');
    link.stream();
    link.batch('s1', 7); // the connect burst, during the resync
    release();
    await vi.waitFor(() => expect(root.seen).toEqual(['resync', 'resync paged (ok)', 'held batch s1 7']));
    link.batch('s1', 8);
    expect(root.seen.at(-1)).toBe('live batch s1 8');
  });

  it('the spine’s own engine-host requests go through the daemon’s intercept first', async () => {
    const intercepted: string[] = [];
    const spine = seam({ intercept: ({ name }) => (name === 'host.stopAll' ? (intercepted.push(name), Promise.resolve({ t: 'res', id: 'x', ok: true, value: undefined })) : null) });
    const root = (await spine.ensure('command')) as FakeRoot;
    expect(await root.hosts.dispatch('engine-host', 'host.stopAll', { graceMs: 1 })).toEqual({ ok: true, value: undefined });
    expect(intercepted).toEqual(['host.stopAll']);
    expect(link.calls.map((call) => call.name)).not.toContain('host.stopAll');
  });
});

describe('the release', () => {
  it('after the quiet period: waits for the root, stops every part, drops the root and its listeners, collects, and loads again at the next trigger', async () => {
    const spine = seam();
    const before = link.listeners();
    const first = (await spine.ensure('command')) as FakeRoot;
    spine.quiet(true);
    await vi.waitFor(() => expect(spine.state()).toBe('cold'));
    expect(first.stop).toHaveBeenCalledOnce();
    expect(spine.root()).toBeNull();
    expect(link.listeners()).toBe(before); // what the released root held on the link went with it
    expect(collected).toBe(1);
    expect(restarts).toEqual([]); // a private daemon is not re-executed
    expect(states.slice(-2)).toEqual(['releasing', 'cold: released']);
    const second = await spine.ensure('command'); // load, release, load: the lock this process holds
    expect(second).not.toBe(first);
    expect(spine.state()).toBe('loaded');
  });

  it('a release without re-execution leaves the link open and starts the hold: a batch after it loads the spine again and folds there', async () => {
    const spine = seam();
    await spine.ensure('command');
    spine.quiet(true);
    await vi.waitFor(() => expect(spine.state()).toBe('cold'));
    expect(ended).toBe(0); // the link was not ended
    spine.quiet(false); // a client again: the next load stays
    link.batch('s1', 9); // held: the trigger
    await vi.waitFor(() => expect(spine.state()).toBe('loaded'));
    expect((roots[1] as FakeRoot).seen).toEqual(['held batch s1 9']);
  });

  it('a working session holds it; a kept session ready and idle with no work does not, and is not ended by it', async () => {
    const spine = seam();
    await spine.ensure('command');
    link.emit('session.status', working('s1', { engineState: 'running' })); // an engine-started turn: no turn, no keepAlive
    spine.quiet(true);
    await sleep(100);
    expect(spine.state()).toBe('loaded');
    link.emit('session.status', working('s1', { engineState: 'idle' }));
    await vi.waitFor(() => expect(spine.state()).toBe('cold'));
    expect(link.calls.map((call) => call.name)).not.toContain('session.stop');
  });

  it('a session is working while it launches, holds a turn, host work or background tasks, or runs an engine-started turn; a request, a queue or a stateful MCP server keeps only its process', () => {
    const of = (over: Parameters<typeof statusOf>[1], keepAlive: EngineSessionStatus['keepAlive'] = []) => workingSession({ ...statusOf('s1', over), keepAlive });
    expect(of({ process: 'starting' })).toBe(true);
    expect(of({ process: 'initializing' })).toBe(true);
    for (const reason of ['turn', 'busy', 'background_tasks'] as const) expect(of({}, [reason]), reason).toBe(true);
    expect(of({ engineState: 'requires_action' })).toBe(true);
    for (const reason of ['pending_request', 'queued_messages', 'held_peer_message', 'stateful_mcp'] as const) expect(of({}, [reason]), reason).toBe(false);
    expect(of({})).toBe(false); // ready, idle, nothing kept
    expect(of({ process: 'exited' }, ['turn'])).toBe(false);
  });

  it('a client or a hold (the daemon’s quiet) holds it', async () => {
    const spine = seam();
    await spine.ensure('command');
    spine.quiet(true);
    spine.quiet(false);
    await sleep(100);
    expect(spine.state()).toBe('loaded');
  });

  it('admits no new work while it waits for a setup that resolves after the quiet began; the request waits, then loads again', async () => {
    const spine = seam();
    const first = (await spine.ensure('command')) as FakeRoot;
    spine.quiet(true);
    await vi.waitFor(() => expect(spine.state()).toBe('loaded')); // the period runs
    const done = first.hold(); // a setup still running when the period ends
    await vi.waitFor(() => expect(spine.state()).toBe('releasing'), { timeout: 1_000 });
    let answered: SpineRoot | null = null;
    const request = spine.ensure('command').then((root) => void (answered = root));
    await sleep(80);
    expect(answered).toBeNull();
    expect(first.stop).not.toHaveBeenCalled();
    expect(logs).toContainEqual('[spine] the release waits for the spine’s work in flight');
    done();
    await request;
    expect(first.stop).toHaveBeenCalledOnce();
    expect(answered).not.toBe(first);
  });

  it('re-executes a unit daemon after a release: the link’s terminal close first, its drained batches folded, then the parts stop and the daemon restarts', async () => {
    const spine = seam({
      reexecute: true,
      endLink: async () => {
        ended += 1;
        link.batch('s1', 41); // what the link's drain delivers
        await sleep(5);
        link.batch('s1', 42);
      },
    });
    const root = (await spine.ensure('command')) as FakeRoot;
    root.stop.mockImplementation(() => void root.seen.push('stopped'));
    spine.quiet(true);
    await sleep(10);
    const done = root.hold(); // work that began once the period ran: the release waits for it
    await vi.waitFor(() => expect(spine.state()).toBe('releasing'));
    link.batch('s1', 40); // while the release settles
    done();
    await vi.waitFor(() => expect(restarts).toEqual(['spine released']));
    expect(ended).toBe(1);
    expect(root.seen).toEqual(['live batch s1 40', 'live batch s1 41', 'live batch s1 42', 'stopped']);
  });

  it('stop at the daemon’s exit releases without re-executing', async () => {
    const spine = seam({ reexecute: true });
    const root = (await spine.ensure('command')) as FakeRoot;
    await spine.stop();
    expect(root.stop).toHaveBeenCalledOnce();
    expect(restarts).toEqual([]);
  });

  // P5 O3-D fix wave (sweep#1): the engine host advances its delivered cursor as it writes a batch, so a batch still on
  // the link when the parts stop is in no successor's connect burst; the exit drains the link into them first
  it('stop at the daemon’s exit drains the link into the loaded spine after its work settled, then stops the parts', async () => {
    const spine = seam({
      endLink: async () => {
        ended += 1;
        link.batch('s1', 51); // what the engine host wrote before it saw the end
        await sleep(5);
        link.batch('s1', 52);
      },
    });
    const root = (await spine.ensure('command')) as FakeRoot;
    root.stop.mockImplementation(() => void root.seen.push('stopped'));
    const done = root.hold(); // work that needs the link: it settles before the link ends
    const stopping = spine.stop();
    await sleep(10);
    expect(ended).toBe(0);
    done();
    await stopping;
    expect(ended).toBe(1);
    expect(root.seen).toEqual(['live batch s1 51', 'live batch s1 52', 'stopped']);
  });
});

describe('the daemon’s exit during a load', () => {
  it('stop is bounded while a load-time resync stalls: nothing stopped, closed or handed over under it', async () => {
    link.stream();
    const release = link.gate('engine.sessions'); // the load's resync stalls (its own bound is 30 s)
    const spine = seam();
    void spine.ensure('command').catch(() => {});
    await vi.waitFor(() => expect(roots).toHaveLength(1));
    const started = Date.now();
    await spine.stop();
    expect(Date.now() - started).toBeLessThan(1_000); // the exit's deadline (100 ms here, 5 s in the daemon)
    expect(roots[0]!.stop).not.toHaveBeenCalled(); // the root's barrier is still running: nothing closed under it
    const candidate = await takeSpineLock(profile, { build: 'the next writer', waitMs: 10, log: () => {} });
    expect(candidate.refused).not.toBeNull(); // the lock is left to the process's exit
    expect(logs).toContainEqual(expect.stringContaining('the exit leaves the load in flight'));
    release();
    await sleep(20);
    expect(roots[0]!.stop).not.toHaveBeenCalled();
  });

  it('a load that has not composed yet when the exit begins composes nothing afterwards', async () => {
    let open!: () => void;
    const opening = new Promise<void>((resolve) => (open = resolve));
    const spine = seam({
      load: async () => ({
        takeSpineLock,
        openSpineData: async (_profile, { lock }) => (await opening, { lock: lock!, refused: lock!.refused, machineSettings: null as never, paths: { client: '', machine: '' } }),
        startSpine: (deps) => {
          const root = new FakeRoot(deps.hosts, deps);
          roots.push(root);
          return root;
        },
      }),
    });
    const loaded = spine.ensure('command');
    await vi.waitFor(() => expect(logs).toContain('[spine] loading (command)'));
    await sleep(20); // the lock is taken; the data's open waits
    await spine.stop(); // bounded: the open is still in flight
    open();
    await expect(loaded).rejects.toThrow(/exiting/);
    expect(roots).toHaveLength(0); // no composition after the exit began
  });
});

describe('the yield', () => {
  const live = new Map<number, string>();
  const processes = { isAlive: (pid: number) => live.has(pid), procStartOf: (pid: number) => live.get(pid) ?? null };
  beforeEach(() => {
    live.clear();
    live.set(777, 'start-777');
  });

  it('releases a loaded spine once it settled, gives the lock up, refuses every load while the app lives, and loads again once it is gone', async () => {
    const spine = seam({ processes });
    const first = (await spine.ensure('command')) as FakeRoot;
    const done = first.hold();
    spine.yield(777);
    await sleep(30);
    expect(first.stop).not.toHaveBeenCalled(); // its writers first
    done();
    await vi.waitFor(() => expect(spine.state()).toBe('yielded'));
    expect(first.stop).toHaveBeenCalledOnce();
    // a second candidate takes the lock and gives it back meanwhile
    const candidate = await takeSpineLock(profile, { build: 'the old app', waitMs: 10, log: () => {} });
    expect(candidate.refused).toBeNull();
    candidate.release();
    await expect(spine.ensure('command')).rejects.toThrow(/yielded to pid 777/);
    live.delete(777);
    await vi.waitFor(() => expect(spine.state()).toBe('cold'));
    await expect(spine.ensure('command')).resolves.toBeDefined(); // the lock taken again
  });

  it('a yield whose writer never settles ends the process after its deadline, with the lock left for the exit path', async () => {
    const spine = seam({ processes });
    const first = (await spine.ensure('command')) as FakeRoot;
    first.hold(); // never resolves
    spine.yield(777);
    await vi.waitFor(() => expect(yieldExits).toBe(1), { timeout: 1_000 });
    expect(first.stop).not.toHaveBeenCalled(); // the exit ends the writer; nothing is handed over in process
    const candidate = await takeSpineLock(profile, { build: 'the old app', waitMs: 10, log: () => {} });
    expect(candidate.refused).not.toBeNull();
  });

  it('a yield lifted while its writer is still pending cancels the deadline: no exit with no app left to yield to', async () => {
    const spine = seam({ processes });
    const first = (await spine.ensure('command')) as FakeRoot;
    const done = first.hold();
    spine.yield(777);
    await sleep(30);
    live.delete(777); // the older app departs while the writer is pending
    await vi.waitFor(() => expect(spine.yieldedTo()).toBeNull());
    await sleep(300); // past yieldSettleMs (200)
    expect(yieldExits).toBe(0);
    done();
    await vi.waitFor(() => expect(spine.state()).toBe('cold'));
    expect(first.stop).toHaveBeenCalledOnce();
  });

  it('a yield lifted while the load goes on: the load completes and what arrives from then on folds', async () => {
    link.stream();
    const release = link.gate('engine.sessions');
    const spine = seam({ processes });
    const loaded = spine.ensure('command');
    await vi.waitFor(() => expect(roots).toHaveLength(1));
    spine.yield(777);
    live.delete(777);
    await vi.waitFor(() => expect(logs).toContain('[spine] the yield to pid 777 lifted'));
    link.batch('s1', 5); // held again: the load's barrier drains it
    release();
    const root = (await loaded) as FakeRoot;
    link.batch('s1', 6);
    expect(root.seen).toEqual(['resync', 'resync paged (ok)', 'held batch s1 5', 'live batch s1 6']);
    expect(spine.state()).toBe('loaded');
  });

  // P5 O3-D M5 (Interfaces §L, D21): the second signal, read at each load attempt
  it('a yield candidate named at a load attempt yields instead of loading, takes no lock, and the load goes on once lifted', async () => {
    let candidate: number | null = 777;
    const spine = seam({ processes, yieldCandidate: () => candidate });
    await expect(spine.ensure('command')).rejects.toThrow(/yielded to pid 777/);
    expect(spine.yieldedTo()).toBe(777);
    expect(spine.state()).toBe('yielded');
    expect(loads).toBe(0);
    const another = await takeSpineLock(profile, { build: 'the old app', waitMs: 10, log: () => {} }); // no lock was taken
    expect(another.refused).toBeNull();
    another.release();
    candidate = null;
    spine.yield(null); // a post-D hello announced the pid (daemon.ts)
    expect(spine.yieldedTo()).toBeNull();
    await expect(spine.ensure('command')).resolves.toBeDefined();
  });

  // The cross-build check's `(update, daemon)` scene (run 41156614454) and the architect's ruling (B): a fresh mawsd's
  // connect burst from a kept engine host arrives before the launching app's hello; its batch wakes a load and D21's
  // second signal names that app (no hello yet, no spine.lock), so the seam yields provisionally and holds; the hello
  // lists machine.spine and lifts it, which resumes the load: the coalesced parts (a permission raised while no app ran is
  // only its `session.brokerItems`), the resync, then the hold in order, an error raised between the yield and the lift
  // among it.
  const failed = (seq: number) => ({ appSessionId: 's1', events: [ev('turn.ended', { id: `s1:L1:${seq}:0`, seq, isError: true })] }); // an error item's turn
  const asked = (summary: string) => ({ appSessionId: 's1', items: [{ summary }] });
  const provisionally = async (candidate: () => number | null) => {
    link.stream(); // a permanent link streams from its welcome
    const spine = seam({ processes, yieldCandidate: candidate });
    link.emit('session.status', working('s1')); // the burst: coalesced while cold
    link.emit('session.brokerItems', asked('Bash: git log'));
    link.batch('s1', 1); // the trigger, met by the candidate
    await vi.waitFor(() => expect(spine.state()).toBe('yielded'));
    expect(logs).toContain('[spine] yielding to pid 777, provisionally: what arrives is held until its hello');
    return spine;
  };

  it('a provisional yield holds what arrives; the lift resumes the load, which folds the hold after the coalesced parts', async () => {
    let candidate: number | null = 777;
    const spine = await provisionally(() => candidate);
    link.emit('session.eventBatch', failed(2)); // between the yield and the lift
    link.emit('session.brokerItems', asked('Bash: git status'));
    expect(roots).toHaveLength(0); // nothing delivered while provisional
    candidate = null;
    spine.yield(null); // the app's hello lists machine.spine
    await vi.waitFor(() => expect(spine.state()).toBe('loaded')); // the lift itself resumed the load
    const root = roots[0]!;
    expect(root.seen).toEqual([
      'coalesced status s1 ready',
      'coalesced brokerItems s1 Bash: git log',
      'resync',
      'resync paged (ok)',
      'held batch s1 1',
      'held batch s1 2 (turn.ended)',
      'held brokerItems s1 Bash: git status',
    ]);
    expect(spine.status().heldDropped).toBe(0);
  });

  // Confirmed, the yield is a yield as before: its hold discarded, counted; the coalesced parts kept for the load after it
  // lifts (the latest while yielded included).
  it.each([
    ['its hello lists no machine.spine', (spine: LazySpine) => spine.yield(777)],
    ['no hello came in time', async () => void (await sleep(150))],
  ])('a provisional yield confirmed (%s) discards its hold and keeps the coalesced parts', async (_why, confirm) => {
    const spine = await provisionally(() => (live.has(777) ? 777 : null));
    link.emit('session.eventBatch', failed(2));
    await confirm(spine);
    await vi.waitFor(() => expect(logs).toContainEqual(expect.stringMatching(/^\[spine\] the yield to pid 777 confirmed: /)));
    expect(spine.status().heldDropped).toBe(2);
    link.emit('session.brokerItems', asked('Bash: git status')); // while yielded: kept as the latest
    link.batch('s1', 3); // dropped
    live.delete(777); // the app departs: the yield lifts
    await vi.waitFor(() => expect(spine.state()).toBe('cold'));
    expect(roots).toHaveLength(0); // a confirmed yield's lift resumes nothing
    const root = (await spine.ensure('command')) as FakeRoot;
    expect(root.seen).toEqual(['coalesced status s1 ready', 'coalesced brokerItems s1 Bash: git status', 'resync', 'resync paged (ok)']); // nothing held
  });

  it('a provisional yield whose app is gone before its hello is confirmed: its hold discarded, the spine cold', async () => {
    const spine = await provisionally(() => (live.has(777) ? 777 : null));
    live.delete(777);
    await vi.waitFor(() => expect(spine.state()).toBe('cold'));
    expect(logs).toContain('[spine] the yield to pid 777 confirmed: pid 777 is gone');
    expect(spine.status().heldDropped).toBe(1);
  });

  // Review round 1 of #386 and its round-2 finding: the parts are one link's state. A link that leaves `ready` voids
  // them, kept or held, and what it still delivers before the next link is ready (a recycled connection's drain) is no
  // part of the next one's.
  it('a link that leaves ready voids the whole-state parts, kept or held, and those it delivers until the next is ready', async () => {
    let candidate: number | null = 777;
    const spine = await provisionally(() => candidate);
    link.emit('session.brokerItems', asked('Bash: git status')); // held
    link.leave(); // the engine host is gone, and with it s1's launch
    link.emit('session.brokerItems', asked('Bash: git diff')); // the old link's drain
    link.emit('session.status', working('s1'));
    link.arrive();
    link.stream();
    link.emit('session.status', working('s2')); // its successor's burst
    candidate = null;
    spine.yield(null);
    await vi.waitFor(() => expect(spine.state()).toBe('loaded'));
    expect(roots[0]!.seen).toEqual(['resync', 'resync paged (ok)', 'held batch s1 1', 'held status s2 ready']);
  });

  it('a yield during a load discards its hold, counted, and a cold seam just refuses until the pid is gone', async () => {
    link.stream();
    const release = link.gate('engine.sessions');
    const spine = seam({ processes });
    link.batch('s1', 1);
    await vi.waitFor(() => expect(roots).toHaveLength(1));
    spine.yield(777);
    release();
    await vi.waitFor(() => expect(spine.state()).toBe('yielded'));
    expect(spine.status().heldDropped).toBe(1);
    link.batch('s1', 2); // nothing wakes a yielded seam
    await sleep(10);
    expect(roots).toHaveLength(1);
  });
});
