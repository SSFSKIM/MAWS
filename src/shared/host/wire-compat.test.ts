// P5 O1 M6, acceptance 6 (OX1): two builds a minor apart interoperate. Registry B is registry A plus one change of each
// additive kind (a command, an event, an optional input field, an output field, an event field, an optional field in a
// branch of a plain union nested in another union's option, and the capability `probe.extra`). One side serves its
// registry through the real socket server and host runtime on a real Unix socket (test/support/fake-supervisor.ts);
// the other runs main's real client path, createHostSupervisor over the detached transport, on its own registry. The
// test runs B against A, then A against B.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { captureConsole } from '../../../test/support/console-capture';
import { fakeProfile, FakeProcesses, FakeSupervisor, type FakeProfile } from '../../../test/support/fake-supervisor';
import type { WireRegistry } from '../ipc/registry';
import { classifyWireChange, wireManifestOf } from '../ipc/wire';
import { createHostRuntime, type HostEmit, type HostOn } from './runtime';
import { SOCKET_PROTOCOL } from './socket-protocol';

// The supervisor imports electron for its utility transport, which this test never uses.
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/nonexistent' }, utilityProcess: {}, MessageChannelMain: class {} }));

import { appIdentity, type AppIdentity } from '../../main/hosts/identity';
import { createHostSupervisor, type HostSupervisor } from '../../main/hosts/supervisor';

const TIMING = { connectTimeoutMs: 200, helloTimeoutMs: 150, startTimeoutMs: 1_200, pidPollMs: 20, waitRetryMs: 80, killGraceMs: 60 };
const host = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'engine-host' as const });

// Two options that both accept `{x}` up to unknown keys, so a newer field in one of them reaches the older reader as an
// `invalid_union` nested in the outer union's (tolerant.test.ts pins zod's shapes).
const innerOf = (added: boolean) =>
  z.union([z.strictObject({ x: z.number(), ...(added ? { added: z.string().optional() } : {}) }), z.strictObject({ x: z.number(), y: z.number().optional() })]);
const shapeOf = (added: boolean) =>
  z.union([z.strictObject({ kind: z.literal('a'), inner: innerOf(added) }), z.strictObject({ kind: z.literal('a'), inner: innerOf(added), note: z.string().optional() })]);

const A = {
  commands: {
    'probe.echo': host(z.strictObject({ text: z.string() }), z.strictObject({ text: z.string() })),
    'probe.shape': host(z.void(), shapeOf(false)),
  },
  events: { 'probe.changed': z.strictObject({ n: z.number() }) },
  hostEvents: ['probe.changed'],
  mainOnly: new Set<string>(),
} as const satisfies WireRegistry;

const B = {
  commands: {
    'probe.echo': host(z.strictObject({ text: z.string(), loud: z.boolean().optional() }), z.strictObject({ text: z.string(), length: z.number().optional() })),
    'probe.shape': host(z.void(), shapeOf(true)),
    'probe.newer': host(z.void(), z.strictObject({ newer: z.literal(true) })),
  },
  events: { 'probe.changed': z.strictObject({ n: z.number(), extra: z.string().optional() }), 'probe.newEvent': z.strictObject({ m: z.number() }) },
  hostEvents: ['probe.changed', 'probe.newEvent'],
  mainOnly: new Set<string>(),
} as const satisfies WireRegistry;

// One build: its registry, its minor and capabilities, and what its host handlers answer.
interface Build {
  name: 'A' | 'B';
  registry: WireRegistry;
  minor: number;
  capabilities: string[];
  register(on: HostOn<WireRegistry>, inputs: unknown[]): void;
}

const BUILD_A: Build = {
  name: 'A',
  registry: A,
  minor: 0,
  capabilities: [],
  register(on, inputs) {
    on('probe.echo', async (input) => (inputs.push(input), { text: (input as { text: string }).text }));
    on('probe.shape', async () => ({ kind: 'a', inner: { x: 1 } }));
  },
};
const BUILD_B: Build = {
  name: 'B',
  registry: B,
  minor: 1,
  capabilities: ['probe.extra'],
  register(on, inputs) {
    on('probe.echo', async (input) => {
      inputs.push(input);
      const { text } = input as { text: string };
      return { text, length: text.length };
    });
    on('probe.shape', async () => ({ kind: 'a', inner: { x: 1, added: 'new' } }));
    on('probe.newer', async () => ({ newer: true }));
  },
};

let profile: FakeProfile;
let processes: FakeProcesses;
let closers: (() => Promise<void>)[];

beforeEach(() => {
  profile = fakeProfile('maws-wc-');
  processes = new FakeProcesses();
  closers = [];
});

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  profile.dispose();
});

// `server` served by the real socket layer; `client` as main, over the detached transport. Different builds with a
// session live, so the client takes the other-build path: served, its exit armed for idle.
async function connect(server: Build, client: Build) {
  const inputs: unknown[] = [];
  let emit!: HostEmit<WireRegistry>;
  const runtime = createHostRuntime<WireRegistry>(
    (on, e) => {
      emit = e;
      server.register(on, inputs);
    },
    { registry: server.registry },
  );
  const fake = await new FakeSupervisor(profile, processes, {
    pid: processes.newPid(),
    runtime,
    buildId: `build-${server.name}`,
    minor: server.minor,
    capabilities: server.capabilities,
    counts: { liveSessions: 1, rows: 1 },
  }).start();
  const own = appIdentity(profile.modulePath, {});
  const identity: AppIdentity = { ...own, buildId: () => `build-${client.name}`, minor: () => client.minor, capabilities: () => client.capabilities };
  const logs: string[] = [];
  const relayed: [string, unknown][] = [];
  const supervisor: HostSupervisor = createHostSupervisor({
    hosts: { 'engine-host': { modulePath: profile.modulePath, serviceName: 'maws-engine-host', transport: 'detached' } },
    registry: client.registry,
    emit: ((name: string, payload: unknown) => (relayed.push([name, payload]), true)) as never,
    restartBackoffMs: [30, 60, 90],
    detached: {
      userData: () => profile.userData,
      packaged: () => false,
      env: () => ({ HOME: '/home/owner', MAWS_HOST_MODE: 'detached' }),
      spawn: () => {
        throw new Error('the test runs its own supervisor; nothing is spawned');
      },
      ...processes.deps,
      timing: TIMING,
      log: (line) => void logs.push(line),
      identity,
    },
  });
  closers.push(async () => {
    supervisor.stop();
    await fake.die();
  });
  await supervisor.start();
  expect(supervisor.snapshot('engine-host').state).toBe('ready');
  await vi.waitFor(() => expect(runtime.hasClient()).toBe(true), { timeout: 3_000, interval: 5 });
  const dispatch = (name: string, input?: unknown) => supervisor.dispatch('engine-host', name, input);
  return { fake, supervisor, inputs, logs, relayed, dispatch, emit: (name: string, payload: unknown) => emit(name, payload as never) };
}

const DROPPED = /^\[host(s)?\] dropped /;

describe('the two registries', () => {
  it('differ by additive changes only, one of each kind', () => {
    expect(classifyWireChange(wireManifestOf(A, BUILD_A.capabilities), wireManifestOf(B, BUILD_B.capabilities))).toEqual({
      additive: [
        'capabilities.probe.extra',
        'commands.probe.echo.input.properties.loud',
        'commands.probe.echo.output.properties.length',
        'commands.probe.newer',
        'commands.probe.shape.output.anyOf.0.properties.inner.anyOf.0.properties.added',
        'commands.probe.shape.output.anyOf.1.properties.inner.anyOf.0.properties.added',
        'events.probe.changed.properties.extra',
        'events.probe.newEvent',
      ],
      breaking: [],
    });
  });
});

describe('builds a minor apart over the real socket (acceptance 6)', () => {
  it('B serves, A connects: the newer server’s additions are dropped by the older client, which keeps working', async () => {
    const dropped = captureConsole('warn', DROPPED);
    const side = await connect(BUILD_B, BUILD_A);
    // the welcome: the other build is served (a session is live), its minor and capabilities kept as its peer facts
    expect(side.logs).toContain(`connected to supervisor pid ${side.fake.pid} build build-B wire ${SOCKET_PROTOCOL}.1 capabilities [probe.extra] (1 live of 1 rows)`);
    expect(side.fake.exits).toEqual(['idle']);
    // a capability is seen by its peer only when listed: B lists one, A lists none
    expect(side.supervisor.peer('engine-host')).toEqual({ major: SOCKET_PROTOCOL, minor: 1, build: 'build-B', capabilities: ['probe.extra'] });
    expect(side.fake.peer()).toEqual({ major: SOCKET_PROTOCOL, minor: 0, build: 'build-A', capabilities: [] });
    // a shared command answers; the output field B added is dropped by A
    await expect(side.dispatch('probe.echo', { text: 'hi' })).resolves.toEqual({ ok: true, value: { text: 'hi' } });
    // the optional field in a branch of a union nested in another union's option, dropped by A
    await expect(side.dispatch('probe.shape')).resolves.toEqual({ ok: true, value: { kind: 'a', inner: { x: 1 } } });
    // the event field B added is dropped; the event only B emits is dropped with one log line
    expect(side.emit('probe.changed', { n: 1, extra: 'x' })).toBe(true);
    expect(side.emit('probe.newEvent', { m: 1 })).toBe(true);
    expect(side.emit('probe.newEvent', { m: 2 })).toBe(true);
    expect(side.emit('probe.changed', { n: 2 })).toBe(true);
    await vi.waitFor(() => expect(side.relayed).toHaveLength(2), { timeout: 3_000, interval: 5 });
    expect(side.relayed).toEqual([
      ['probe.changed', { n: 1 }],
      ['probe.changed', { n: 2 }],
    ]);
    expect(dropped.lines()).toEqual([
      '[hosts] dropped length from the output of probe.echo, a field this build does not know (logged once per message and path)',
      '[hosts] dropped inner.added from the output of probe.shape, a field this build does not know (logged once per message and path)',
      '[hosts] dropped extra from event probe.changed, a field this build does not know (logged once per message and path)',
      "[hosts] dropped engine-host's event probe.newEvent: not in this build's event registry (logged once per name)",
    ]);
  });

  it('A serves, B connects: the newer client’s additions are dropped by the older server, which keeps answering', async () => {
    const dropped = captureConsole('warn', DROPPED);
    const side = await connect(BUILD_A, BUILD_B);
    expect(side.logs).toContain(`connected to supervisor pid ${side.fake.pid} build build-A wire ${SOCKET_PROTOCOL}.0 capabilities [] (1 live of 1 rows)`);
    expect(side.fake.exits).toEqual(['idle']);
    // a capability is seen by its peer only when listed: A lists none, B lists one
    expect(side.supervisor.peer('engine-host')).toEqual({ major: SOCKET_PROTOCOL, minor: 0, build: 'build-A', capabilities: [] });
    expect(side.fake.peer()).toEqual({ major: SOCKET_PROTOCOL, minor: 1, build: 'build-B', capabilities: ['probe.extra'] });
    // a shared command answers; the optional input field B added is dropped by A, which still answers
    await expect(side.dispatch('probe.echo', { text: 'hi', loud: true })).resolves.toEqual({ ok: true, value: { text: 'hi' } });
    expect(side.inputs).toEqual([{ text: 'hi' }]);
    // what A answers, B reads as is: the fields it added are optional
    await expect(side.dispatch('probe.shape')).resolves.toEqual({ ok: true, value: { kind: 'a', inner: { x: 1 } } });
    // the command only B knows answers unknown_command from A
    await expect(side.dispatch('probe.newer')).resolves.toMatchObject({ ok: false, error: { code: 'unknown_command' } });
    // A's events reach B unchanged
    expect(side.emit('probe.changed', { n: 3 })).toBe(true);
    await vi.waitFor(() => expect(side.relayed).toEqual([['probe.changed', { n: 3 }]]), { timeout: 3_000, interval: 5 });
    expect(dropped.lines()).toEqual(['[host] dropped loud from the input of probe.echo, a field this build does not know (logged once per message and path)']);
  });
});
