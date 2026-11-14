// P5 Decision Log 45: `mawsd`'s seam and O10's endpoint module agree field for field, and O10 M10 binds the module. The
// architect's lever (a) on acceptance 14: the module is loaded at the daemon's start only when an enrollment is on disk,
// else at the first command that needs it, and starts then as it would have at the daemon's start; a read-only command
// over a state directory that holds nothing is answered without it, as it would answer.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import type { EndpointModule as O10Module, EndpointServices } from '../endpoint/index';
import { unloadedAnswer, UNENROLLED_STATUS } from '../endpoint/presence';
import type { NewHostEntry } from '@shared/ipc/schema/channel';
import type { SpineRoot } from '../services/spine-root';
import { LazyEndpoint, loadEndpointModule, spineChannel, type DaemonServices, type EndpointModule } from './endpoint-seam';
import { SpineUnavailable } from './spine-seam';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

/** Services over a scratch state directory; the endpoint's log lines kept. */
function services(enrolled = false): DaemonServices & { lines: string[] } {
  dir = mkdtempSync(join(tmpdir(), 'maws-seam-'));
  const stateDir = join(dir, 'mawsd', 'endpoint');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  if (enrolled) writeFileSync(join(stateDir, 'enrollment.json'), '{}', { mode: 0o600 });
  const lines: string[] = [];
  const none = () => () => {};
  return {
    machine: { ref: 'r'.repeat(22) as never, profileDir: dir, stateDir, kind: 'private' },
    dispatch: async () => ({ t: 'res', id: '0', ok: true, value: null }),
    onEvent: none,
    onAttachment: none,
    onFrame: none,
    documents: { open: () => false, close: () => {}, frame: () => false, onClosed: none },
    onUpstream: none,
    hold: () => () => {},
    interest: { report: () => {}, drop: () => {} },
    artifacts: { fetch: async () => ({ status: 404, headers: {}, body: null }) }, // P5 O5 M2
    browser: { inventory: () => ({ epoch: 'e', tabs: [], selected: null, state: 'ready' }), watchInventory: () => () => {}, open: async () => Promise.reject(new Error('no browser here')) }, // P5 O17 M6
    clientPort: { serve: () => ({ answer: () => {}, close: () => {} }) }, // P5 O7 M5c
    engineHostLists: () => false, // P5 O7 M8
    channel: { record: () => {} }, // P5 O8 M7b
    log: (line) => void lines.push(line),
    lines,
  };
}

/** A module standing in for O10's, recording what is asked of it. */
class Module implements EndpointModule {
  static built: Array<{ build?: string }> = [];
  static startGate: Promise<void> | null = null;
  readonly events: string[] = [];
  started: DaemonServices | null = null;
  constructor(options: { build?: string }) {
    Module.built.push(options);
  }
  async start(s: DaemonServices): Promise<void> {
    this.events.push('start');
    if (Module.startGate) await Module.startGate;
    this.started = s;
  }
  async stop(): Promise<void> {
    this.events.push('stop');
  }
  status(): unknown {
    return { enrollment: 'loaded' };
  }
  enrollment(): { name: string; org: string } | null {
    return { name: 'mini', org: 'org-local' };
  }
  async cli(command: string): Promise<{ code: number; out: string }> {
    this.events.push(`cli ${command}`);
    return { code: 0, out: command };
  }
}

/** A loader of `Module`, counted, that can be held or made to fail. */
function loader() {
  const state = { loads: 0, modules: [] as Module[], fail: null as Error | null, gate: null as Promise<void> | null };
  const load = async () => {
    state.loads++;
    if (state.gate) await state.gate;
    if (state.fail) throw state.fail;
    return {
      createEndpoint: (options: { build?: string }) => {
        const m = new Module(options);
        state.modules.push(m);
        return m;
      },
    };
  };
  return { state, load };
}

describe('the endpoint seam', () => {
  // P5 O17 M9a: EndpointServices.browser is DaemonServices.browser (R1), so the two are equal again, member for member.
  // P5 O8 M6a: `dispatch` included, with the `reader` both take.
  it('DaemonServices is O10’s EndpointServices, and the two EndpointModule shapes are one', () => {
    expectTypeOf<DaemonServices>().toEqualTypeOf<EndpointServices>();
    expectTypeOf<Omit<EndpointModule, 'start'>>().toEqualTypeOf<Omit<O10Module, 'start'>>();
    expectTypeOf<Parameters<EndpointModule['start']>[0]>().toExtend<Parameters<O10Module['start']>[0]>();
  });

  it('binds O10’s endpoint module: a fresh one for each daemon, reporting unenrolled until it is loaded', async () => {
    const endpoint = loadEndpointModule('0123456789abcdef');
    expect(loadEndpointModule('0123456789abcdef')).not.toBe(endpoint);
    expect(endpoint.status()).toEqual(UNENROLLED_STATUS);
    await expect(endpoint.cli('keys', [])).resolves.toEqual({ code: 3, out: 'the endpoint has not started' });
  });
});

describe('the endpoint loaded when it is needed (lever (a))', () => {
  it('an unenrolled daemon loads nothing at start; the first command that needs it loads it once, starts it with the daemon’s services, then runs', async () => {
    const { state, load } = loader();
    const endpoint = new LazyEndpoint('b1', load);
    const s = services();
    await endpoint.start(s);
    expect(state.loads).toBe(0);
    expect(endpoint.status()).toEqual(UNENROLLED_STATUS);
    expect(endpoint.enrollment()).toBeNull(); // machine.identity's, unloaded: no enrollment is on disk, or it would be loaded
    // A read-only command asked while the module loads waits for it, and is the module's to answer.
    const [first, second] = await Promise.all([endpoint.cli('enroll', ['--json'], 'CODE'), endpoint.cli('keys', [])]);
    expect([first, second]).toEqual([
      { code: 0, out: 'enroll' },
      { code: 0, out: 'keys' },
    ]);
    expect(state.loads).toBe(1);
    expect(Module.built.at(-1)).toEqual({ build: 'b1' });
    const [m] = state.modules;
    expect(m.started).toBe(s);
    expect(m.events).toEqual(['start', 'cli enroll', 'cli keys']);
    expect(endpoint.status()).toEqual({ enrollment: 'loaded' });
    expect(endpoint.enrollment()).toEqual({ name: 'mini', org: 'org-local' }); // loaded, the module's own
    // Loaded, the module answers every command, the read-only ones too.
    expect(await endpoint.cli('status', [])).toEqual({ code: 0, out: 'status' });
    await endpoint.stop();
    expect(m.events.at(-1)).toBe('stop');
  });

  it('an unenrolled daemon answers status, keys and policy, as text and --json, without loading the module, as it would answer', async () => {
    const { state, load } = loader();
    const endpoint = new LazyEndpoint('b7', load);
    const s = services();
    await endpoint.start(s);
    for (const command of ['status', 'keys', 'policy']) {
      for (const args of [[], ['--json']]) {
        const answer = await endpoint.cli(command, args);
        expect(answer, `${command} ${args.join(' ')}`).toEqual(unloadedAnswer(s.machine, command, args));
        expect(answer.code).toBe(0);
      }
    }
    expect(await endpoint.cli('status', [])).toEqual({ code: 0, out: 'enrollment: none\nhub: not connected; channels: 0 relayed, 0 direct; sminos: not connected' });
    expect(await endpoint.cli('keys', ['--json'])).toEqual({ code: 0, out: JSON.stringify({ enrollment: 'none', ref: s.machine.ref, delegated: false }) });
    expect(state.loads).toBe(0);
    expect(s.lines).toEqual([]);
    // Anything else needs the module: other arguments, or another command.
    expect(await endpoint.cli('status', ['--bogus'])).toEqual({ code: 0, out: 'status' });
    expect(state.loads).toBe(1);
    expect(s.lines).toEqual(['loading the endpoint for its first command']);
  });

  it('a read-only command over a state directory that holds anything loads the module, which judges it', async () => {
    const { state, load } = loader();
    const endpoint = new LazyEndpoint('b8', load);
    const s = services();
    writeFileSync(join(s.machine.stateDir, 'policy.json'), '{}', { mode: 0o600 });
    await endpoint.start(s);
    expect(state.loads).toBe(0); // a policy alone is no enrollment
    expect(await endpoint.cli('policy', [])).toEqual({ code: 0, out: 'policy' });
    expect(state.loads).toBe(1);
  });

  it('a daemon with an enrollment on disk loads and starts it at start, as before', async () => {
    const { state, load } = loader();
    const endpoint = new LazyEndpoint('b2', load);
    await endpoint.start(services(true));
    expect(state.loads).toBe(1);
    expect(state.modules[0].events).toEqual(['start']);
    expect(endpoint.status()).toEqual({ enrollment: 'loaded' });
  });

  it('stops with nothing loaded; a stop during a load stops what it loaded; nothing loads after a stop', async () => {
    const quiet = loader();
    const idle = new LazyEndpoint('b3', quiet.load);
    await idle.start(services());
    await idle.stop();
    expect(await idle.cli('keys', [])).toEqual({ code: 3, out: 'the endpoint has stopped' });
    expect(await idle.cli('unenroll', [])).toEqual({ code: 3, out: 'the endpoint has stopped' });
    expect(quiet.state.loads).toBe(0);

    // Stopped while its chunk loads: never started, so nothing to stop.
    const held = loader();
    let release!: () => void;
    held.state.gate = new Promise<void>((r) => (release = r));
    const busy = new LazyEndpoint('b4', held.load);
    await busy.start(services());
    const command = busy.cli('unenroll', []);
    const stopped = busy.stop();
    release();
    await stopped;
    expect(held.state.modules).toEqual([]);
    expect(await command).toEqual({ code: 3, out: 'the endpoint has stopped' });

    // Stopped while it starts: the stop waits for the start, then stops it, and the command runs nothing.
    const starting = loader();
    const late = new LazyEndpoint('b4b', starting.load);
    await late.start(services());
    let started!: () => void;
    Module.startGate = new Promise<void>((r) => (started = r));
    const run = late.cli('unenroll', []);
    await new Promise((r) => setTimeout(r, 0));
    const ending = late.stop();
    started();
    await ending;
    Module.startGate = null;
    expect(starting.state.modules[0].events).toEqual(['start', 'stop']);
    expect(await run).toEqual({ code: 3, out: 'the endpoint has stopped' });
  });

  it('a module that cannot be loaded is said, logged and tried again at the next command', async () => {
    const { state, load } = loader();
    state.fail = new Error("Cannot find module './chunks/index-OLD.js'");
    const endpoint = new LazyEndpoint('b5', load);
    const s = services();
    await endpoint.start(s);
    const refused = await endpoint.cli('unenroll', []);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('the endpoint module could not be loaded');
    expect(refused.out).toContain('mawsd restart');
    expect(s.lines.some((line) => line.includes("Cannot find module './chunks/index-OLD.js'"))).toBe(true);
    expect(endpoint.status()).toEqual(UNENROLLED_STATUS);
    expect(await endpoint.cli('keys', [])).toEqual(unloadedAnswer(s.machine, 'keys', [])); // still unloaded: answered without it
    expect(state.loads).toBe(1);
    state.fail = null;
    expect(await endpoint.cli('unenroll', [])).toEqual({ code: 0, out: 'unenroll' });
    expect(state.loads).toBe(2);
  });

  it('before the daemon starts it, a command answers as an unstarted module does, loading nothing', async () => {
    const { state, load } = loader();
    const endpoint = new LazyEndpoint('b6', load);
    expect(await endpoint.cli('keys', [])).toEqual({ code: 3, out: 'the endpoint has not started' });
    expect(state.loads).toBe(0);
  });

  // P5 O3-D M4: MAWS's own projects (the spine's rows) reach the module through its CheckoutSource injection
  it('hands the module MAWS’s own projects, the source the daemon gave it', async () => {
    const { load } = loader();
    const projects = { known: (path: string) => path === '/work/maws' };
    const endpoint = new LazyEndpoint('b9', load, { projects });
    await endpoint.start(services());
    await endpoint.cli('enroll', [], 'CODE');
    expect(Module.built.at(-1)).toEqual({ build: 'b9', projects });
  });
});

// P5 O8 M7b (Interfaces §O): lane A's to-human entries reach the spine's journal (`SpineRoot.channel`), the spine loaded for
// one if it is cold (the endpoint's trigger), and what can't be kept is logged.
describe('the seam’s channel', () => {
  const entry = (text: string): NewHostEntry => ({ project: 'p', appSessionId: null, engineSessionId: 'la-1' as never, lane: 'A', kind: 'message', text, at: '2026-11-06T10:00:00.000Z', src: `p/mini%2Fla-1/${text}` });
  function spine(state: { root: SpineRoot | null; ensure: () => Promise<SpineRoot> }) {
    const ensured: string[] = [];
    return { ensured, root: () => state.root, ensure: (reason: string) => (ensured.push(reason), state.ensure()) };
  }

  it('hands an entry to the loaded spine’s journal at once, and loads a cold spine for one, as the endpoint’s trigger', async () => {
    const kept: string[] = [];
    const root = { channel: { record: (e: NewHostEntry) => void kept.push(e.text) } } as unknown as SpineRoot;
    const loaded = spine({ root, ensure: () => Promise.reject(new Error('not asked')) });
    spineChannel(loaded, () => {}).record(entry('now'));
    expect([kept, loaded.ensured]).toEqual([['now'], []]);

    let load!: (root: SpineRoot) => void;
    const loading = new Promise<SpineRoot>((resolve) => (load = resolve)); // one load, which both entries wait on
    const cold = spine({ root: null, ensure: () => loading });
    const channel = spineChannel(cold, () => {});
    channel.record(entry('first'));
    channel.record(entry('second'));
    expect(kept).toEqual(['now']);
    load(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([kept, cold.ensured]).toEqual([['now', 'first', 'second'], ['endpoint', 'endpoint']]);
  });

  it('logs an entry it can’t keep: a spine refused, or a run whose spine holds no journal', async () => {
    const lines: string[] = [];
    spineChannel(spine({ root: null, ensure: () => Promise.reject(new SpineUnavailable('pid 7 holds spine.lock', 'refused')) }), (line) => void lines.push(line)).record(entry('refused'));
    spineChannel(spine({ root: {} as SpineRoot, ensure: () => Promise.reject(new Error('not asked')) }), (line) => void lines.push(line)).record(entry('none'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lines.sort()).toEqual(['[channel] a lane A entry of p was not kept: pid 7 holds spine.lock', '[channel] a lane A entry of p was not kept: the spine holds no journal']);
  });
});

// P5 O8 M6b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §Q): the local door, the loaded module's.
describe('the seam’s local door', () => {
  /** A module with a door, recording what reaches it. */
  class DoorModule extends Module {
    readonly asked: unknown[] = [];
    readonly local = {
      act: async (action: unknown) => (this.asked.push(['act', action]), { state: 'done', result: { changed: true, policyRev: 2 } }),
      call: async (name: string, input: unknown) => (this.asked.push(['call', name, input]), { ok: true as const, output: { supported: false } }),
    };
  }

  it('is the loaded module’s, a load in flight awaited; unloaded, or a module with none, `unavailable`', async () => {
    const unloaded = new LazyEndpoint('b1', loader().load);
    await unloaded.start(services());
    expect(await unloaded.local.act({ action: 'record.access' })).toEqual({ state: 'refused', reason: 'unavailable' });
    expect(await unloaded.local.call('record.policy', null)).toEqual({ ok: false, code: 'unavailable' });
    const doorless = new LazyEndpoint('b1', loader().load);
    await doorless.start(services(true));
    expect(await doorless.local.act({})).toEqual({ state: 'refused', reason: 'unavailable' });
    const modules: DoorModule[] = [];
    const door = new LazyEndpoint('b1', async () => ({ createEndpoint: (options) => (modules.push(new DoorModule(options)), modules.at(-1)!) }));
    await door.start(services(true));
    expect(await door.local.act({ action: 'record.access' })).toEqual({ state: 'done', result: { changed: true, policyRev: 2 } });
    expect(await door.local.call('record.policy', { session: 'la-1' })).toEqual({ ok: true, output: { supported: false } });
    expect(modules[0].asked).toEqual([['act', { action: 'record.access' }], ['call', 'record.policy', { session: 'la-1' }]]);
    await door.stop();
    expect(await door.local.act({ action: 'record.access' }), 'stopped').toEqual({ state: 'refused', reason: 'unavailable' });
  });
});

// The project registry's M12 (Interfaces §H's RegistryRead, §K's `projects.registry`): what `maws` reads of the org's
// projects is the loaded module's own read; unloaded, there is none, and the daemon answers for an unenrolled machine.
describe('the seam’s registry read', () => {
  const READ = { enrolled: true, machine: { ref: 'r'.repeat(22) as never, name: 'mini' }, machines: [], contested: [], projects: [] };
  class ReadModule extends Module {
    readonly registryRead = { read: async () => READ };
  }

  it('is the loaded module’s, and none while nothing is loaded or the module has none', async () => {
    const unloaded = new LazyEndpoint('b1', loader().load);
    await unloaded.start(services());
    expect(unloaded.registryRead).toBeUndefined();
    const readless = new LazyEndpoint('b1', loader().load);
    await readless.start(services(true));
    expect(readless.registryRead).toBeUndefined();
    const reading = new LazyEndpoint('b1', async () => ({ createEndpoint: (options) => new ReadModule(options) }));
    await reading.start(services(true));
    expect(await reading.registryRead?.read()).toEqual(READ);
  });
});

// The UX wave (U9, M2; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M2's Decisions): the machine's
// ceiling as a fork from another machine is judged against it, which the daemon hands the session service: the loaded
// module's own policy read, as it stands when asked. Unloaded, or from a module that has none, every mode is above it:
// no act from another machine reaches the services while no endpoint is loaded.
describe('the seam’s ceiling', () => {
  class CeilingModule extends Module {
    ceiling = 'acceptEdits';
    aboveCeiling(mode: string): boolean {
      return mode !== 'default' && mode !== this.ceiling;
    }
  }

  it('is the loaded module’s, read at each ask, and refuses every mode while nothing is loaded or the module has none', async () => {
    const unloaded = new LazyEndpoint('b1', loader().load);
    await unloaded.start(services());
    expect(unloaded.aboveCeiling('default')).toBe(true);
    const without = new LazyEndpoint('b1', loader().load);
    await without.start(services(true));
    expect(without.aboveCeiling('default')).toBe(true);
    const modules: CeilingModule[] = [];
    const judging = new LazyEndpoint('b1', async () => ({ createEndpoint: (options) => (modules.push(new CeilingModule(options)), modules.at(-1)!) }));
    await judging.start(services(true));
    expect([judging.aboveCeiling('default'), judging.aboveCeiling('acceptEdits'), judging.aboveCeiling('bypassPermissions')]).toEqual([false, false, true]);
    modules[0].ceiling = 'bypassPermissions';
    expect(judging.aboveCeiling('bypassPermissions')).toBe(false);
  });
});
