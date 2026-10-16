// P3-H H4: the renderer's connector family of the ArtifactHost (src/artifacts/host.ts): a page's surface over main's
// lease commands (`connectors.*`) and the owner's grants (`artifacts.*`), driven through a fake bridge that records
// what reaches main and answers when a test says so.
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorCallOutcome } from '@shared/artifacts/connectors';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import { createConnectorHost } from './connectors';
import { ArtifactCommandError } from './host';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const LEASE = '22222222-2222-4222-8222-222222222222';
const OTHER_LEASE = '33333333-3333-4333-8333-333333333333';
const WATCH = '44444444-4444-4444-8444-444444444444';
const TOOL = { server: 'fixture', tool: 'read_series' };
const RESULT: ConnectorCallOutcome = { ok: true, result: { rows: [1, 2] }, fetchedAt: 5, via: { route: 'engine', sessionId: 's1' } };

type Answer = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
interface Sent {
  name: CommandName;
  input: unknown;
  answer(value: unknown): void;
  fail(message?: string): void;
}

// A bridge whose every command waits for the test to answer it, in the order sent; `auto` answers some at once.
function bridge(auto: Partial<Record<CommandName, (input: never) => unknown>> = {}) {
  const sent: Sent[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const ipc = {
    invoke: vi.fn((name: CommandName, input: unknown) => {
      const handler = auto[name];
      if (handler) return Promise.resolve({ ok: true, value: handler(input as never) } as Answer);
      return new Promise<Answer>((resolve) => {
        sent.push({ name, input, answer: (value) => resolve({ ok: true, value }), fail: (message = 'no') => resolve({ ok: false, error: { code: 'internal', message } }) });
      });
    }),
    on: vi.fn((name: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    }),
  };
  const emit = (name: string, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload));
  const names = () => ipc.invoke.mock.calls.map(([name]) => name);
  return { ipc: ipc as unknown as Pick<MawsBridge, 'invoke' | 'on'>, sent, emit, names, invoke: ipc.invoke };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a page’s connector surface', () => {
  it('opens one hidden lease and sends what was asked before it opened, in order, under it', async () => {
    const b = bridge();
    const surface = createConnectorHost(b.ipc).openConnectors(ARTIFACT);
    surface.setVisible(true);
    const declared = surface.declareTools([TOOL]);
    const called = surface.callTool({ ...TOOL, args: { q: 1 } });
    expect(b.names()).toEqual(['connectors.open']);
    expect(b.sent[0]!.input).toEqual({ artifactId: ARTIFACT });
    b.sent[0]!.answer({ leaseId: LEASE });
    await settle();
    expect(b.sent.slice(1).map(({ name, input }) => [name, input])).toEqual([
      ['connectors.visibility', { leaseId: LEASE, visible: true }],
      ['connectors.declare', { leaseId: LEASE, tools: [TOOL] }],
      ['connectors.call', { leaseId: LEASE, request: { ...TOOL, args: { q: 1 } } }],
    ]);
    b.sent[1]!.answer({ ok: true });
    b.sent[2]!.answer({ ok: true, declared: [TOOL] });
    b.sent[3]!.answer(RESULT);
    await expect(declared).resolves.toEqual({ ok: true, declared: [TOOL] });
    await expect(called).resolves.toEqual(RESULT);
  });

  it('closes a lease that answers after the surface closed, and asks main nothing after the close', async () => {
    const b = bridge();
    const surface = createConnectorHost(b.ipc).openConnectors(ARTIFACT);
    const before = surface.callTool(TOOL); // asked while the lease is opening: never sent once the surface closed
    surface.close();
    b.sent[0]!.answer({ leaseId: LEASE });
    await settle();
    expect(b.sent.slice(1).map(({ name, input }) => [name, input])).toEqual([['connectors.close', { leaseId: LEASE }]]);
    await expect(before).resolves.toEqual({ ok: false, state: 'invalid', reason: 'lease' });
    const count = b.invoke.mock.calls.length;
    await expect(surface.callTool(TOOL)).resolves.toEqual({ ok: false, state: 'invalid', reason: 'lease' });
    await expect(surface.declareTools([TOOL])).resolves.toEqual({ ok: false, state: 'invalid', reason: 'lease' });
    await expect(surface.watchTool({ ...TOOL, intervalMs: 60_000 }, () => {})).resolves.toEqual({ ok: false, state: 'invalid', reason: 'lease' });
    await expect(surface.unwatchTool(WATCH)).resolves.toBe(false);
    await expect(surface.refreshWatch(WATCH)).resolves.toBe(false);
    surface.setVisible(true);
    surface.close();
    expect(b.invoke.mock.calls.length).toBe(count);
  });

  it('answers invalid: lease for everything when the lease cannot be opened', async () => {
    const b = bridge();
    const surface = createConnectorHost(b.ipc).openConnectors(ARTIFACT);
    const called = surface.callTool(TOOL);
    surface.setVisible(true);
    b.sent[0]!.fail('the connector broker has stopped');
    await expect(called).resolves.toEqual({ ok: false, state: 'invalid', reason: 'lease' });
    await expect(surface.watchTool({ ...TOOL, intervalMs: 1 }, () => {})).resolves.toEqual({ ok: false, state: 'invalid', reason: 'lease' });
    surface.close();
    expect(b.names()).toEqual(['connectors.open']);
  });

  it('rejects a command main refused, as the host’s other methods do', async () => {
    const b = bridge({ 'connectors.open': () => ({ leaseId: LEASE }) });
    const surface = createConnectorHost(b.ipc).openConnectors(ARTIFACT);
    const called = surface.callTool(TOOL);
    await settle();
    b.sent[0]!.fail('invalid input');
    await expect(called).rejects.toBeInstanceOf(ArtifactCommandError);
  });

  it('hands a watch’s refreshes to its own listener alone, an early one once its start answers, none after it stops', async () => {
    const b = bridge({ 'connectors.open': () => ({ leaseId: LEASE }) });
    const host = createConnectorHost(b.ipc);
    const surface = host.openConnectors(ARTIFACT);
    const heard: ConnectorCallOutcome[] = [];
    const started = surface.watchTool({ ...TOOL, intervalMs: 60_000 }, (update) => heard.push(update));
    await settle();
    expect(b.sent[0]!.name).toBe('connectors.watch');
    // the first refresh's event overtakes the start's answer
    b.emit('connectors.watchUpdate', { leaseId: LEASE, watchId: WATCH, update: RESULT });
    b.emit('connectors.watchUpdate', { leaseId: OTHER_LEASE, watchId: WATCH, update: { ok: false, state: 'paused', reason: 'noRoute' } });
    expect(heard).toEqual([]);
    b.sent[0]!.answer({ ok: true, watchId: WATCH, intervalMs: 60_000 });
    await expect(started).resolves.toEqual({ ok: true, watchId: WATCH, intervalMs: 60_000 });
    expect(heard).toEqual([RESULT]);
    const paused = { ok: false, state: 'paused', reason: 'noRoute' } as const;
    b.emit('connectors.watchUpdate', { leaseId: LEASE, watchId: WATCH, update: paused });
    expect(heard).toEqual([RESULT, paused]);
    const stopped = surface.unwatchTool(WATCH);
    await settle();
    b.emit('connectors.watchUpdate', { leaseId: LEASE, watchId: WATCH, update: RESULT });
    b.sent[1]!.answer({ stopped: true });
    await expect(stopped).resolves.toBe(true);
    expect(heard).toEqual([RESULT, paused]);
  });

  it('drops refreshes held for a watch that never started, and hears nothing once closed', async () => {
    const b = bridge({ 'connectors.open': () => ({ leaseId: LEASE }) });
    const surface = createConnectorHost(b.ipc).openConnectors(ARTIFACT);
    const heard = vi.fn();
    const refused = surface.watchTool({ ...TOOL, intervalMs: 60_000 }, heard);
    await settle();
    b.emit('connectors.watchUpdate', { leaseId: LEASE, watchId: WATCH, update: RESULT });
    b.sent[0]!.answer({ ok: false, state: 'invalid', reason: 'watchLimit' });
    await expect(refused).resolves.toEqual({ ok: false, state: 'invalid', reason: 'watchLimit' });
    const started = surface.watchTool({ ...TOOL, intervalMs: 60_000 }, heard);
    await settle();
    b.sent[1]!.answer({ ok: true, watchId: WATCH, intervalMs: 60_000 });
    await started;
    expect(heard).not.toHaveBeenCalled(); // the held refresh belonged to no started watch
    surface.close();
    b.emit('connectors.watchUpdate', { leaseId: LEASE, watchId: WATCH, update: RESULT });
    expect(heard).not.toHaveBeenCalled();
  });

  it('relays the owner’s visibility and a watch’s refresh', async () => {
    const b = bridge({ 'connectors.open': () => ({ leaseId: LEASE }), 'connectors.visibility': () => ({ ok: true }), 'connectors.refresh': () => ({ refreshing: true }) });
    const surface = createConnectorHost(b.ipc).openConnectors(ARTIFACT);
    surface.setVisible(true);
    surface.setVisible(false);
    await expect(surface.refreshWatch(WATCH)).resolves.toBe(true);
    expect(b.invoke.mock.calls.slice(1)).toEqual([
      ['connectors.visibility', { leaseId: LEASE, visible: true }],
      ['connectors.visibility', { leaseId: LEASE, visible: false }],
      ['connectors.refresh', { leaseId: LEASE, watchId: WATCH }],
    ]);
  });
});

describe('the owner’s grants', () => {
  it('reads, grants and revokes through main’s artifacts grant commands', async () => {
    const grant = { ...TOOL, fingerprint: 'f1', mode: 'read' as const, grantedAt: 9 };
    const b = bridge({
      'artifacts.connectorGrants': () => ({ grants: [grant] }),
      'artifacts.grantConnectorTool': () => ({ ok: true, grant }),
      'artifacts.revokeConnectorTool': () => ({ revoked: true }),
    });
    const host = createConnectorHost(b.ipc);
    await expect(host.connectorGrants(ARTIFACT)).resolves.toEqual([grant]);
    await expect(host.grantConnectorTool(ARTIFACT, { ...TOOL, mode: 'read' })).resolves.toEqual({ ok: true, grant });
    await expect(host.revokeConnectorTool(ARTIFACT, TOOL)).resolves.toBe(true);
    expect(b.invoke.mock.calls).toEqual([
      ['artifacts.connectorGrants', { artifactId: ARTIFACT }],
      ['artifacts.grantConnectorTool', { artifactId: ARTIFACT, tool: { ...TOOL, mode: 'read' } }],
      ['artifacts.revokeConnectorTool', { artifactId: ARTIFACT, ...TOOL }],
    ]);
  });
});
