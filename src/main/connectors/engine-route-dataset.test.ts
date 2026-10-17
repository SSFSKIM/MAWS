// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): route E's main half with a dataset sink. The
// sink rides `connectors.start`; every take of a dataset operation (on its end, on reconciliation, at its deadline)
// follows a synchronous `publishable` recheck in the same turn, and a work that may no longer publish is withdrawn, not
// taken. The host answers the first take of a ended call null while it publishes; the operation stays pending until
// the publication's end brings its outcome, all within the one 180 s deadline. An agent's refresh resolves the asking
// session alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { createEngineRoute, CONNECTOR_OPERATION_DEADLINE_MS, type EngineRoute } from './engine-route';

type Sent = { name: string; input: Record<string, unknown> };
let sent: Sent[];
let takes: (Record<string, unknown> | null)[]; // what each `connectors.take` answers, in order
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
        case 'connectors.take':
          return ok({ outcome: takes.shift() ?? null });
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

  it('starts with the sink beside the call, and keeps the operation through the host’s null take until the publication’s end', async () => {
    const { answer } = await started(() => true, { id: 'live', baseRevision: 4, requestId: '00000000-0000-4000-8000-000000000001' });
    expect(startOf()).toMatchObject({ appSessionId: 'app-asker', launchId: 'L1', arguments: { series: 'revenue' }, mode: 'read', dataset: { id: 'live', baseRevision: 4, requestId: '00000000-0000-4000-8000-000000000001' } });
    route.operationEnded(operationId()); // the call ended; the host starts publishing and answers null
    await settle();
    expect(order.slice(-2)).toEqual(['publishable', 'connectors.take']); // the recheck right before the take
    expect(sentNames()).not.toContain('connectors.cancel');
    takes.push({ ok: true, result: META });
    route.operationEnded(operationId()); // the publication ended
    await settle();
    expect(await answer).toEqual({ ok: true, result: META });
    expect(sentNames().filter((name) => name === 'connectors.take')).toHaveLength(2);
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
    route.reconcile();
    await settle();
    expect(order.slice(-2)).toEqual(['publishable', 'connectors.take']);
    await vi.advanceTimersByTimeAsync(CONNECTOR_OPERATION_DEADLINE_MS);
    expect(order.slice(-3)).toEqual(['publishable', 'connectors.take', 'connectors.cancel']);
    expect(await answer).toMatchObject({ ok: false, failure: 'unavailable', message: expect.stringContaining('deadline') });
  });

  it('fails an operation whose publication’s end brought no outcome either', async () => {
    const { answer } = await started(() => true);
    route.operationEnded(operationId());
    await settle();
    route.operationEnded(operationId());
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
