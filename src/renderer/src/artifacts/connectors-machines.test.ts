// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "O4's surfaces: leases, the window, delivery on
// the machine"): a page's connector surface is its artifact's machine's. Driven through the renderer's real client over a
// preload that speaks the raw pipe (a target per invoke, `(payload, machine)` per event, no machine for main's own), so
// every machine a command names here is the one the client hands the preload, as in the app.
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectorSurface } from '@artifacts/host';
import type { ConnectorCallOutcome } from '@shared/artifacts/connectors';
import type { CommandName, PreloadBridge } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { createClient } from '../ipc/client';
import { createConnectorHost } from './connectors';
import { recordArtifactMachine, resetArtifactMachines } from './machines';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';

const REMOTE = '11111111-1111-4111-8111-111111111111'; // an artifact on OTHER_MACHINE
const LOCAL = '77777777-7777-4777-8777-777777777777'; // one of this Mac's
const LEASE = '22222222-2222-4222-8222-222222222222'; // both machines answer this id: a lease is its machine's
const NEW_LEASE = '55555555-5555-4555-8555-555555555555';
const THIRD_LEASE = '33333333-3333-4333-8333-333333333333';
const WATCH = '44444444-4444-4444-8444-444444444444';
const NEW_WATCH = '66666666-6666-4666-8666-666666666666';
const TOOL = { server: 'fixture', tool: 'read_series' };
const SERIES = { ...TOOL, intervalMs: 60_000 };
const RESULT: ConnectorCallOutcome = { ok: true, result: { rows: [1, 2] }, fetchedAt: 5, via: { route: 'direct' } };
const OTHER_RESULT: ConnectorCallOutcome = { ok: true, result: { rows: [3] }, fetchedAt: 6, via: { route: 'direct' } };

interface Sent {
  name: CommandName;
  input: unknown;
  machine: MachineRef | undefined;
  answer(value: unknown): void;
  fail(code: string, message?: string): void;
}
type Auto = Partial<Record<CommandName, (input: never, machine: MachineRef | undefined) => unknown>>;

// The preload's side of the pipe: every invoke waits for the test unless `auto` answers it.
function pipe(auto: Auto = {}) {
  const sent: Sent[] = [];
  const listeners = new Map<string, Set<(payload: unknown, machine: MachineRef | undefined) => void>>();
  const bridge = {
    localMachine: TEST_MACHINE,
    invoke: (name: CommandName, input: unknown, target?: MachineRef | { machine: MachineRef }) => {
      const machine = typeof target === 'string' ? target : target?.machine;
      const handler = auto[name];
      return new Promise((resolve) => {
        const entry: Sent = { name, input, machine, answer: (value) => resolve({ ok: true, value }), fail: (code, message = `${name}: ${code}`) => resolve({ ok: false, error: { code, message } }) };
        sent.push(entry);
        if (handler) entry.answer(handler(input as never, machine));
      });
    },
    on: (name: string, listener: (payload: unknown, machine: MachineRef | undefined) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => void set.delete(listener);
    },
    pathForFile: () => '',
  } as unknown as PreloadBridge;
  // `machine` undefined: main's own word, as the preload hands a local event
  const emit = (name: string, payload: unknown, machine?: MachineRef) => listeners.get(name)?.forEach((listener) => listener(payload, machine));
  const of = (machine: MachineRef) => sent.filter((entry) => entry.machine === machine).map(({ name, input }) => [name, input]);
  return { client: createClient(() => bridge), sent, emit, of };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Each machine as a restarting broker answers it: each open the next lease, each watch the next id
function brokers() {
  const leases = new Map<MachineRef | undefined, string[]>([[OTHER_MACHINE, [LEASE, NEW_LEASE, THIRD_LEASE]], [TEST_MACHINE, [LEASE, NEW_LEASE, THIRD_LEASE]]]);
  const watches = new Map<MachineRef | undefined, string[]>([[OTHER_MACHINE, [WATCH, NEW_WATCH]], [TEST_MACHINE, [WATCH, NEW_WATCH]]]);
  return pipe({
    'connectors.open': (_input, machine) => ({ leaseId: leases.get(machine)!.shift() }),
    'connectors.declare': (input: { tools: unknown[] }) => ({ ok: true, declared: input.tools }),
    'connectors.visibility': () => ({ ok: true }),
    'connectors.watch': (_input, machine) => ({ ok: true, watchId: watches.get(machine)!.shift(), intervalMs: 60_000 }),
    'connectors.call': () => RESULT,
    'connectors.refresh': () => ({ refreshing: true }),
    'connectors.unwatch': () => ({ stopped: true }),
    'connectors.close': () => ({ closed: true }),
    'artifacts.connectorGrants': () => ({ grants: [] }),
    'artifacts.revokeConnectorTool': () => ({ revoked: true }),
  });
}

afterEach(() => resetArtifactMachines());

describe('a remote artifact’s connector surface', () => {
  it('sends every command of its lease and its grants to the artifact’s machine', async () => {
    recordArtifactMachine(REMOTE, OTHER_MACHINE, TEST_MACHINE);
    const p = brokers();
    const host = createConnectorHost(p.client);
    const surface = host.openConnectors(REMOTE);
    surface.setVisible(true);
    await surface.declareTools([TOOL]);
    await surface.watchTool(SERIES, () => {});
    await surface.callTool(TOOL);
    await surface.refreshWatch(WATCH);
    await surface.unwatchTool(WATCH);
    await host.connectorGrants(REMOTE);
    await host.revokeConnectorTool(REMOTE, TOOL);
    surface.close();
    await settle();
    expect(p.sent.map(({ machine }) => machine)).toEqual(p.sent.map(() => OTHER_MACHINE));
    expect(p.of(OTHER_MACHINE).map(([name]) => name)).toEqual([
      'connectors.open',
      'connectors.visibility',
      'connectors.declare',
      'connectors.watch',
      'connectors.call',
      'connectors.refresh',
      'connectors.unwatch',
      'artifacts.connectorGrants',
      'artifacts.revokeConnectorTool',
      'connectors.close',
    ]);
  });

  it('keeps the machine its lease opened on, whatever the table says later', async () => {
    recordArtifactMachine(REMOTE, OTHER_MACHINE, TEST_MACHINE);
    const p = brokers();
    const surface = createConnectorHost(p.client).openConnectors(REMOTE);
    await settle();
    recordArtifactMachine(REMOTE, TEST_MACHINE, TEST_MACHINE); // a later word moves the artifact: the lease stays where it is
    await surface.callTool(TOOL);
    expect(p.sent.map(({ name, machine }) => [name, machine])).toEqual([
      ['connectors.open', OTHER_MACHINE],
      ['connectors.call', OTHER_MACHINE],
    ]);
  });

  it('hears a watch’s refresh only from the machine its lease is on', async () => {
    recordArtifactMachine(REMOTE, OTHER_MACHINE, TEST_MACHINE);
    const p = brokers();
    const host = createConnectorHost(p.client);
    const there: ConnectorCallOutcome[] = [];
    const here: ConnectorCallOutcome[] = [];
    await host.openConnectors(REMOTE).watchTool(SERIES, (update) => there.push(update));
    await host.openConnectors(LOCAL).watchTool(SERIES, (update) => here.push(update));
    // both machines named the same lease and watch ids
    p.emit('connectors.watchUpdate', { leaseId: LEASE, watchId: WATCH, update: RESULT }, OTHER_MACHINE);
    p.emit('connectors.watchUpdate', { leaseId: LEASE, watchId: WATCH, update: OTHER_RESULT });
    expect(there).toEqual([RESULT]);
    expect(here).toEqual([OTHER_RESULT]);
  });
});

describe('connectors.reset, by machine', () => {
  // A remote surface and a local one, each with a visible lease, a declaration and a watch
  async function twoSurfaces() {
    recordArtifactMachine(REMOTE, OTHER_MACHINE, TEST_MACHINE);
    const p = brokers();
    const host = createConnectorHost(p.client);
    const heard = { there: [] as ConnectorCallOutcome[], here: [] as ConnectorCallOutcome[] };
    const remote = host.openConnectors(REMOTE);
    const local = host.openConnectors(LOCAL);
    for (const [surface, into] of [[remote, heard.there], [local, heard.here]] as const) {
      surface.setVisible(true);
      await surface.declareTools([TOOL]);
      await surface.watchTool(SERIES, (update) => into.push(update));
    }
    return { p, remote, local, heard, count: { there: p.of(OTHER_MACHINE).length, here: p.of(TEST_MACHINE).length } };
  }

  it('rebuilds only the named machine’s surfaces, under new ids, closing the lease each rebuilt one superseded; the other machine’s lease and watch run on as they were', async () => {
    const { p, remote, local, heard, count } = await twoSurfaces();
    p.emit('connectors.reset', { machine: OTHER_MACHINE });
    await settle();
    expect(p.of(OTHER_MACHINE).slice(count.there)).toEqual([
      ['connectors.close', { leaseId: LEASE }], // best-effort: a lease the machine's broker already ended answers as it may
      ['connectors.open', { artifactId: REMOTE }],
      ['connectors.declare', { leaseId: NEW_LEASE, tools: [TOOL] }],
      ['connectors.visibility', { leaseId: NEW_LEASE, visible: true }],
      ['connectors.watch', { leaseId: NEW_LEASE, request: SERIES }],
    ]);
    expect(p.of(TEST_MACHINE).slice(count.here)).toEqual([]); // nothing reopened, closed or restarted here
    p.emit('connectors.watchUpdate', { leaseId: NEW_LEASE, watchId: NEW_WATCH, update: RESULT }, OTHER_MACHINE);
    p.emit('connectors.watchUpdate', { leaseId: LEASE, watchId: WATCH, update: RESULT }, OTHER_MACHINE); // the ended lease's
    p.emit('connectors.watchUpdate', { leaseId: LEASE, watchId: WATCH, update: OTHER_RESULT }); // the local lease, still live
    expect(heard.there).toEqual([RESULT]);
    expect(heard.here).toEqual([OTHER_RESULT]);
    // the page keeps its watch id; each machine hears its own lease's
    await remote.refreshWatch(WATCH);
    await local.refreshWatch(WATCH);
    expect(p.of(OTHER_MACHINE).at(-1)).toEqual(['connectors.refresh', { leaseId: NEW_LEASE, watchId: NEW_WATCH }]);
    expect(p.of(TEST_MACHINE).at(-1)).toEqual(['connectors.refresh', { leaseId: LEASE, watchId: WATCH }]);
  });

  it('reads a reset that names no machine as the local machine’s', async () => {
    const { p, count } = await twoSurfaces();
    p.emit('connectors.reset', {});
    await settle();
    expect(p.of(TEST_MACHINE).slice(count.here).map(([name]) => name)).toEqual(['connectors.close', 'connectors.open', 'connectors.declare', 'connectors.visibility', 'connectors.watch']);
    expect(p.of(OTHER_MACHINE).slice(count.there)).toEqual([]);
  });

  it('rebuilds nothing for a reset said by a machine rather than by main', async () => {
    const { p, count } = await twoSurfaces();
    p.emit('connectors.reset', { machine: OTHER_MACHINE }, OTHER_MACHINE);
    p.emit('connectors.reset', {}, OTHER_MACHINE);
    await settle();
    expect(p.sent).toHaveLength(count.there + count.here);
  });

  it('answers a call in flight at the machine’s drop host_unavailable, never sends it again, and sends what is asked next on the rebuilt lease', async () => {
    recordArtifactMachine(REMOTE, OTHER_MACHINE, TEST_MACHINE);
    const p = pipe({ 'connectors.close': () => ({ closed: true }) });
    const surface = createConnectorHost(p.client).openConnectors(REMOTE);
    p.sent[0]!.answer({ leaseId: LEASE });
    const inFlight = surface.callTool(TOOL);
    await settle();
    expect(p.sent.map(({ name, machine }) => [name, machine])).toEqual([['connectors.open', OTHER_MACHINE], ['connectors.call', OTHER_MACHINE]]);
    p.sent[1]!.fail('host_unavailable'); // main fails a lost channel's lease commands
    await expect(inFlight).rejects.toMatchObject({ error: { code: 'host_unavailable' } });
    p.emit('connectors.reset', { machine: OTHER_MACHINE });
    const asked = surface.callTool(TOOL);
    await settle();
    expect(p.of(OTHER_MACHINE).slice(2)).toEqual([['connectors.close', { leaseId: LEASE }], ['connectors.open', { artifactId: REMOTE }]]);
    p.sent[3]!.answer({ leaseId: NEW_LEASE });
    await settle();
    expect(p.of(OTHER_MACHINE).slice(4)).toEqual([['connectors.call', { leaseId: NEW_LEASE, request: TOOL }]]);
    p.sent[4]!.answer(RESULT);
    await expect(asked).resolves.toEqual(RESULT);
    expect(p.of(OTHER_MACHINE).filter(([name, input]) => name === 'connectors.call' && (input as { leaseId: string }).leaseId === LEASE)).toHaveLength(1);
  });

  // The task review's finding 1: a duplicate reset, or one heard while a rebuild runs, supersedes a lease the machine still
  // runs; each rebuild closes the lease it supersedes, so its broker ends it and its watches with it
  it('closes the rebuilt lease a second reset supersedes', async () => {
    const { p, count } = await twoSurfaces();
    p.emit('connectors.reset', { machine: OTHER_MACHINE });
    await settle();
    p.emit('connectors.reset', { machine: OTHER_MACHINE }); // a duplicate: the machine's broker still runs NEW_LEASE
    await settle();
    expect(p.of(OTHER_MACHINE).slice(count.there).filter(([name]) => name === 'connectors.close')).toEqual([
      ['connectors.close', { leaseId: LEASE }],
      ['connectors.close', { leaseId: NEW_LEASE }],
    ]);
    expect(p.of(OTHER_MACHINE).at(-1)).toEqual(['connectors.watch', { leaseId: THIRD_LEASE, request: SERIES }]);
  });

  it('closes a lease superseded while its rebuild’s declaration is in flight, after it, and declares the late answer on the next lease', async () => {
    recordArtifactMachine(REMOTE, OTHER_MACHINE, TEST_MACHINE);
    const p = pipe({ 'connectors.close': () => ({ closed: true }) });
    const surface = createConnectorHost(p.client).openConnectors(REMOTE);
    p.sent[0]!.answer({ leaseId: LEASE });
    await settle();
    const declaring = surface.declareTools([TOOL]);
    await settle();
    p.emit('connectors.reset', { machine: OTHER_MACHINE }); // the declaration is in flight on LEASE
    await settle();
    expect(p.of(OTHER_MACHINE).slice(1)).toEqual([
      ['connectors.declare', { leaseId: LEASE, tools: [TOOL] }],
      ['connectors.close', { leaseId: LEASE }],
      ['connectors.open', { artifactId: REMOTE }],
    ]);
    p.sent[3]!.answer({ leaseId: NEW_LEASE });
    await settle();
    p.sent[1]!.answer({ ok: true, declared: [TOOL] }); // the superseded lease answered first: not failed
    await expect(declaring).resolves.toEqual({ ok: true, declared: [TOOL] });
    await settle();
    expect(p.of(OTHER_MACHINE).slice(4)).toEqual([['connectors.declare', { leaseId: NEW_LEASE, tools: [TOOL] }]]);
  });

  // The task review's finding 2: the lease a command goes to is the one found current in the continuation that sends it,
  // so a reset heard between the lease answering and the command's dispatch sends it to the rebuilt lease, never the old
  for (const [what, ask] of [
    ['a call', (surface: ConnectorSurface) => void surface.callTool(TOOL)],
    ['a declaration', (surface: ConnectorSurface) => void surface.declareTools([TOOL])],
    ['a watch’s start', (surface: ConnectorSurface) => void surface.watchTool(SERIES, () => {})],
  ] as const) {
    it(`sends ${what} asked before the lease opened nothing on the old lease once a reset is heard, wherever the reset falls`, async () => {
      for (let gap = 0; gap < 24; gap += 1) {
        resetArtifactMachines();
        recordArtifactMachine(REMOTE, OTHER_MACHINE, TEST_MACHINE);
        const p = pipe({ 'connectors.close': () => ({ closed: true }) });
        const surface = createConnectorHost(p.client).openConnectors(REMOTE);
        ask(surface);
        p.sent[0]!.answer({ leaseId: LEASE });
        for (let tick = 0; tick < gap; tick += 1) await Promise.resolve();
        const heard = p.sent.length;
        p.emit('connectors.reset', { machine: OTHER_MACHINE });
        await settle();
        const after = p.sent.slice(heard).filter(({ name, input }) => name !== 'connectors.close' && (input as { leaseId?: string }).leaseId === LEASE);
        expect(after.map(({ name }) => [gap, name])).toEqual([]);
        surface.close();
      }
    });
  }
});
