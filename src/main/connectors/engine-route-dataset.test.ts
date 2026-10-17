// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): route E's main half with a dataset sink. The
// sink rides `connectors.start`; every take of a dataset operation (on its end, on reconciliation, at its deadline)
// follows a synchronous `publishable` recheck in the same turn, and a work that may no longer publish is withdrawn, not
// taken. E3 M2 fix (the architect's explicit phases): the host answers `publishing` while it publishes and its end
// once, typed; a dataset operation's takes run one at a time, those asked meanwhile coalesced into one more, and no
// null is read as a phase. The operation stays pending until the publication's end, within the one 180 s budget. An
// agent's refresh resolves the asking session alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { createEngineRoute, CONNECTOR_OPERATION_DEADLINE_MS, type EngineRoute } from './engine-route';

type Sent = { name: string; input: Record<string, unknown> };
let sent: Sent[];
let takes: Record<string, unknown>[]; // what each `connectors.take` answers, in order (none left: H's `{outcome: null}`)
let gate: Promise<void> | null; // while set, each take's answer waits for it
let route: EngineRoute;
let order: string[];
const LIVE = [
  { appSessionId: 'app-asker', launchId: 'L1', cwd: '/work/a', process: 'ready', lastUsedAt: '2026-10-17T00:00:00Z' },
  { appSessionId: 'app-other', launchId: 'L2', cwd: '/work/a', process: 'ready', lastUsedAt: '2026-10-17T00:01:00Z' },
  { appSessionId: 'app-idle', launchId: 'L3', cwd: '/work/a', process: 'starting', lastUsedAt: '2026-10-17T00:01:00Z' },
];
const ok = <T>(value: T) => ({ ok: true, value }) as CommandResult<never>;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  takes = [];
  gate = null;
  order = [];
  route = createEngineRoute({
    call: (async (name: string, input: CommandInput<never>) => {
      sent.push({ name, input: input as Record<string, unknown> });
      order.push(name);
      switch (name) {
        case 'engine.sessions':
          return ok(LIVE);
        case 'connectors.resolve':
          return ok({ ready: true, fingerprint: 'fp-1', readOnly: true });
        case 'connectors.start':
          return ok({ operationId: (input as { operationId: string }).operationId });
        case 'connectors.take': {
          if (gate) await gate;
          return ok(takes.shift() ?? { outcome: null });
        }
        case 'connectors.cancel':
          return ok({ cancelled: true });
        default:
          throw new Error(`unexpected ${name}`);
      }
    }) as never,
    sessions: { get: () => null },
    projects: { list: () => [] },
    realpath: (path) => path,
    streaming: () => true,
    log: () => {},
  });
});
afterEach(() => {
  route.stop();
  vi.useRealTimers();
});
const settle = () => vi.advanceTimersByTimeAsync(0);
const startOf = () => sent.find((entry) => entry.name === 'connectors.start')!.input;
const operationId = () => startOf().operationId as string;
const sentNames = () => sent.map((entry) => entry.name);
const META = { status: 'dataset', artifactId: 'a', id: 'live', revision: 3, columns: [], rows: 0 };
const ended = (dataset: Record<string, unknown>) => ({ outcome: null, dataset });
const publishing = () => ended({ status: 'publishing', operationId: operationId() });
const takesSent = () => sentNames().filter((name) => name === 'connectors.take').length;

async function started(publishable: () => boolean, dataset: Record<string, unknown> = { id: 'live' }) {
  const target = (await route.resolveSession('app-asker', '11111111-1111-4111-8111-111111111111', { server: 'fixture', tool: 'rows' }, new AbortController().signal))!;
  const answer = target.call({ series: 'revenue' }, { signal: new AbortController().signal, fingerprint: 'fp-1', mode: 'read', dataset: dataset as never, publishable: () => (order.push('publishable'), publishable()) });
  await settle();
  return { answer }; // not the answer itself, which an async function's return would await
}

describe('route E with a dataset sink', () => {
  it('resolves the asking session alone: its live launch and directory, ready, and asked of the host for that session only', async () => {
    const target = await route.resolveSession('app-asker', 'art', { server: 'fixture', tool: 'rows' }, new AbortController().signal);
    expect(target).toMatchObject({ fingerprint: 'fp-1', readOnly: true, sessionId: 'app-asker' });
    expect(sent.filter((entry) => entry.name === 'connectors.resolve').map((entry) => entry.input)).toEqual([{ appSessionId: 'app-asker', launchId: 'L1', cwd: '/work/a', server: 'fixture', tool: 'rows' }]);
    expect(sentNames()).not.toContain('library.entry'); // no eligibility walk, no other session
    expect(await route.resolveSession('app-idle', 'art', { server: 'fixture', tool: 'rows' }, new AbortController().signal)).toBeNull();
    expect(await route.resolveSession('app-gone', 'art', { server: 'fixture', tool: 'rows' }, new AbortController().signal)).toBeNull();
  });

  it('starts with the sink beside the call, and keeps the operation through the host’s publishing until the publication’s end', async () => {
    const { answer } = await started(() => true, { id: 'live', baseRevision: 4, requestId: '00000000-0000-4000-8000-000000000001' });
    expect(startOf()).toMatchObject({ appSessionId: 'app-asker', launchId: 'L1', arguments: { series: 'revenue' }, mode: 'read', dataset: { id: 'live', baseRevision: 4, requestId: '00000000-0000-4000-8000-000000000001' } });
    takes.push(publishing());
    route.operationEnded(operationId()); // the call ended; the host starts publishing
    await settle();
    expect(order.slice(-2)).toEqual(['publishable', 'connectors.take']); // the recheck right before the take
    expect(sentNames()).not.toContain('connectors.cancel');
    takes.push(ended(META));
    route.operationEnded(operationId()); // the publication ended
    await settle();
    expect(await answer).toEqual({ ok: true, result: META });
    expect(takesSent()).toBe(2);
  });

  it('takes one at a time: events and a reconciliation during the publication coalesce into one more take, and its end settles once', async () => {
    const { answer } = await started(() => true);
    let open!: () => void;
    gate = new Promise((resolve) => (open = resolve));
    takes.push(publishing(), publishing());
    route.operationEnded(operationId());
    await settle();
    route.operationEnded(operationId()); // a repeated event,
    route.reconcile(); // a reconciliation,
    route.operationEnded(operationId()); // and another event while the first take is out
    await settle();
    expect(takesSent()).toBe(1);
    gate = null;
    open();
    await settle();
    expect(takesSent()).toBe(2); // the three asked meanwhile, as one
    expect(sentNames()).not.toContain('connectors.cancel');
    let settled = false;
    void answer.then(() => (settled = true));
    await settle();
    expect(settled).toBe(false); // publishing twice is no failure
    takes.push(ended(META));
    route.operationEnded(operationId());
    await settle();
    expect(await answer).toEqual({ ok: true, result: META });
    route.operationEnded(operationId()); // an end heard again: the operation is no longer pending
    await settle();
    expect(takesSent()).toBe(3);
  });

  it('answers the publication’s typed failures in the result’s slot, and a revoke as the route’s refusal', async () => {
    for (const reason of ['stale', 'validation', 'toolError', 'timeout'] as const) {
      sent = [];
      const { answer } = await started(() => true);
      takes.push(ended({ status: 'failed', reason }));
      route.operationEnded(operationId());
      await settle();
      expect(await answer, reason).toEqual({ ok: true, result: { status: 'failed', reason } });
    }
    sent = [];
    const { answer } = await started(() => true);
    takes.push(ended({ status: 'failed', reason: 'revoked' }));
    route.operationEnded(operationId());
    await settle();
    expect(await answer).toMatchObject({ ok: false, failure: 'refused', refusal: 'revoked' });
  });

  it('withdraws, never takes, a dataset operation that may no longer publish when its end is heard', async () => {
    let publishable = true;
    const { answer } = await started(() => publishable);
    publishable = false;
    route.operationEnded(operationId());
    await settle();
    expect(await answer).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(sentNames()).not.toContain('connectors.take');
    expect(sentNames()).toContain('connectors.cancel');
  });

  it('rechecks before the reconciliation’s and the deadline’s takes too, and withdraws at the deadline what has not published', async () => {
    const { answer } = await started(() => true);
    route.reconcile(); // still calling: H's null, no failure
    await settle();
    expect(order.slice(-2)).toEqual(['publishable', 'connectors.take']);
    await vi.advanceTimersByTimeAsync(CONNECTOR_OPERATION_DEADLINE_MS);
    expect(order.slice(-3)).toEqual(['publishable', 'connectors.take', 'connectors.cancel']);
    expect(await answer).toMatchObject({ ok: false, failure: 'unavailable', message: expect.stringContaining('deadline') });
  });

  it('withdraws at the deadline a publication still running: the budget is not extended for it', async () => {
    const { answer } = await started(() => true);
    takes.push(publishing());
    route.operationEnded(operationId());
    await settle();
    takes.push(publishing());
    await vi.advanceTimersByTimeAsync(CONNECTOR_OPERATION_DEADLINE_MS);
    expect(order.slice(-3)).toEqual(['publishable', 'connectors.take', 'connectors.cancel']);
    expect(await answer).toMatchObject({ ok: false, failure: 'unavailable', message: expect.stringContaining('deadline') });
  });

  it('fails an operation the host no longer holds when an end is heard: no outcome and no phase', async () => {
    const { answer } = await started(() => true);
    takes.push(publishing());
    route.operationEnded(operationId());
    await settle();
    route.operationEnded(operationId()); // the host answers H's null: taken or expired
    await settle();
    expect(await answer).toMatchObject({ ok: false, failure: 'failed' });
  });

  it('leaves a call without a sink as H’s: no dataset in its start, and its first null take after its end withdraws it', async () => {
    const target = (await route.resolveSession('app-asker', 'art', { server: 'fixture', tool: 'rows' }, new AbortController().signal))!;
    const answer = target.call({}, { signal: new AbortController().signal, fingerprint: 'fp-1', mode: 'read' });
    await settle();
    expect(startOf()).not.toHaveProperty('dataset');
    route.operationEnded(operationId());
    await settle();
    expect(await answer).toMatchObject({ ok: false, failure: 'failed' });
  });
});
