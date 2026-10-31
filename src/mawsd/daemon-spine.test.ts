// The spine composed inside `mawsd` (P5 O3-D M2; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §A and
// §B): the seam loads the services entry (its source here; the built chunk is the bundle guard's and the measured
// scene's) over a scratch profile at the first spine command, behind the front, against the fake engine host, and
// answers a machine.sock client through it; then it releases and loads again in the same process.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_CLIENT, type ClientPort } from '@shared/client/port';
import { HOST_EVENTS } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { FakeSpineHost } from '../../test/support/fake-spine-host';
import { SPINE_COMMANDS } from '../../test/support/spine-lists';
import { takeSpineLock, type SpineLock } from '../services/settings/spine-lock';
import { createServicesFront, FRONT_COMMANDS, SPINE_ENGINE_INTERCEPTS, type ServicesFront } from './front';
import { createLazySpine, type LazySpine, type SpineEntry, type SpineState } from './spine-seam';

const MACHINE = 'TestMachineRef00000000' as MachineRef;
const BUILD = '0.0.0+daemon-spine-test';
const noClientPort = new Proxy({}, { get: () => () => NO_CLIENT }) as ClientPort;

let dir: string;
let profile: string;
let sminos: string;
let link: FakeSpineHost;
let front: ServicesFront;
let spine: LazySpine;
let loads: number;
let collected: number;
let states: SpineState[];
let other: SpineLock | null;

function compose(): void {
  spine = createLazySpine({
    profileDir: profile,
    build: BUILD,
    hosts: link as never, // the fake engine host stands in for the daemon's supervisor
    intercept: () => null,
    load: async () => (loads++, (await import('../services/entry')) as SpineEntry),
    deps: () => ({
      profile,
      machine: MACHINE,
      bus: front.bus,
      clientPort: noClientPort,
      interest: () => new Set(),
      browserSocket: () => null,
      trash: async () => {},
      engineEnv: Promise.resolve({ HOME: join(dir, 'home') }),
      env: { SMINOS_HOME: sminos },
      packaged: false,
      appPath: dir,
      devRoot: dir,
      home: join(dir, 'home'),
    }),
    quietMs: () => 50,
    reexecute: false,
    wakeOnEvents: true,
    endLink: async () => {},
    restart: () => {},
    exitForYield: () => {},
    collected: () => void collected++,
    onState: (state) => {
      states.push(state);
      if (state !== 'loading' && state !== 'loaded' && state !== 'releasing') front.unbind();
    },
    log: () => {},
    lockWaitMs: 50,
  });
  front = createServicesFront({
    spine,
    hosts: { forward: async () => ({ t: 'res', id: 'x', ok: false, error: { code: 'host_unavailable', message: 'none' } }), onRaw: () => () => {}, onStreaming: () => () => {}, parked: () => true },
    intercept: () => null,
    daemon: async () => undefined,
    identity: () => ({ ref: MACHINE, name: 'test', project: { key: `machine:${MACHINE}`, name: 'test', smnsId: null } }),
    isApp: () => false,
    log: () => {},
  });
}

// A machine.sock client of the front
function client() {
  const posted: Record<string, unknown>[] = [];
  let listener: (event: { data: unknown }) => void = () => {};
  front.runtimeFor({ appPid: 1, capabilities: [] }).serve({ start: () => {}, on: (_e: 'message', l: typeof listener) => void (listener = l), postMessage: (m: unknown) => void posted.push(m as Record<string, unknown>) });
  let next = 0;
  return async (name: string, input?: unknown) => {
    const id = `r${++next}`;
    listener({ data: { t: 'req', id, name, input } });
    await vi.waitFor(() => expect(posted.find((m) => m.id === id)).toBeDefined(), { timeout: 20_000 });
    return posted.find((m) => m.id === id)!;
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-daemon-spine-'));
  profile = join(dir, 'ud');
  mkdirSync(profile);
  mkdirSync(join(dir, 'home'));
  sminos = mkdtempSync('/tmp/o3d-s-');
  link = new FakeSpineHost();
  loads = 0;
  collected = 0;
  states = [];
  other = null;
  compose();
});

afterEach(async () => {
  await spine.stop();
  front.close();
  other?.release();
  rmSync(sminos, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

describe('the spine inside mawsd', () => {
  it('loads the chunk at the first spine command only, composes over the profile, answers it, and serves the D32 list beside its own', async () => {
    const request = client();
    expect(await request('machine.identity')).toMatchObject({ ok: true });
    expect(loads).toBe(0); // nothing of the library before a trigger
    await link.ready(); // the engine host streams: the load's barrier runs the spine's resync
    expect(await request('session.list', { includeArchived: false })).toMatchObject({ ok: true, value: { sessions: [] } });
    expect(loads).toBe(1);
    expect(spine.state()).toBe('loaded');
    expect(link.calls.map((call) => call.name)).toContain('engine.sessions'); // the resync's listing, through the adapter
    expect(front.commands()).toEqual([...SPINE_COMMANDS, ...FRONT_COMMANDS].sort());
    // P5 O3-D M5 (D44(3)): the engine-host names the front loads a cold spine for are those the spine intercepts, and
    // lane B's claimed op (D47), which the spine takes for an inner name among them
    expect(front.intercepts()).toEqual([...SPINE_ENGINE_INTERCEPTS, 'host.op'].sort());
  }, 30_000);

  it('releases after the quiet period, every part stopped and its listeners gone, and loads again at the next trigger', async () => {
    const request = client();
    const baseline = link.held(); // the seam's own subscriptions: every event, and the link's state (its coalesced parts' life)
    expect(baseline).toBe(HOST_EVENTS.length + 1);
    expect(await request('attention.list')).toMatchObject({ ok: true });
    expect(link.held()).toBeGreaterThan(baseline);
    spine.quiet(true);
    await vi.waitFor(() => expect(spine.state()).toBe('cold'), { timeout: 10_000 });
    expect(link.held()).toBe(baseline);
    expect(collected).toBe(1);
    expect(front.commands()).toEqual([...FRONT_COMMANDS]);
    spine.quiet(false);
    expect(await request('attention.list')).toMatchObject({ ok: true }); // load, release, load: one process, its own lock
    expect(states).toEqual(['loading', 'loaded', 'releasing', 'cold', 'loading', 'loaded']);
    expect(loads).toBe(1); // the chunk once
  }, 30_000);

  it('refused by a live holder of spine.lock: every spine command answers host_unavailable naming it', async () => {
    other = await takeSpineLock(profile, { build: 'the app', log: () => {} });
    const request = client();
    for (const [name, input] of [['session.list', { includeArchived: false }], ['attention.list', undefined]] as const) {
      expect(await request(name, input)).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: expect.stringMatching(/^spine\.lock is held by pid \d+ \(build the app\)/) } });
    }
    expect(spine.status()).toMatchObject({ state: 'refused', refused: expect.stringContaining('build the app') });
  }, 30_000);
});
