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
import { LazyEndpoint, loadEndpointModule, type DaemonServices, type EndpointModule } from './endpoint-seam';

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
  it('DaemonServices is O10’s EndpointServices, and the two EndpointModule shapes are one', () => {
    expectTypeOf<DaemonServices>().toEqualTypeOf<EndpointServices>();
    expectTypeOf<EndpointModule>().toEqualTypeOf<O10Module>();
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
});
