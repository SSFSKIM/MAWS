// E3 x P3-HD integration (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3; the architect's merge ruling):
// route D and a dataset sink. A dataset's result stays in the host and is published there by E3's sink, which route D
// does not carry in this landing (its dataset path is a named post-landing corrective). Until then route D answers
// `unavailable` for any dataset work and sends nothing: never a plain direct call whose raw MCP result would reach main,
// a page or an agent's answer. A scripted engine host answers the direct operation commands; no engine, server or model
// is started.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorAuthorization, ConnectorCallOutcome, ConnectorGrant, ConnectorToolRef } from '@shared/artifacts/connectors';
import type { CommandName } from '@shared/ipc/schema';
import type { DirectOperationOutcome } from '@shared/ipc/schema/connectors';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { ConnectorBroker } from './broker';
import { createDirectRoute, type DirectRoute, type DirectRouteDeps } from './direct-route';
import type { ConnectorGrantAuthority, ConnectorRoute, ConnectorRouteTarget } from './route';

const ART = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const FP = 'f'.repeat(64);
const ME = 'window-1';
const SERIES: ConnectorToolRef = { server: 'fixture', tool: 'read_series' };
const DATASET = { id: 'signups' };
// what a direct call would have answered: never to be seen by main's callers for dataset work
const ENVELOPE = { content: [{ type: 'text', text: '{"rows":[{"day":"2026-10-01","signups":12}]}' }], structuredContent: { rows: [{ day: '2026-10-01', signups: 12 }] } };

const source = { directory: '/repo', sourceId: SOURCE_ID, generation: 3, server: 'fixture', scope: 'user' as const, transport: 'stdio' as const, path: '/home/.claude.json', entryPath: ['mcpServers', 'fixture'], observedAt: '2026-10-17T00:00:00.000Z' };
const READY: DirectOperationOutcome = { kind: 'resolve', answer: { ready: true, source, tool: { fingerprint: FP, readOnly: true } } };

let dispatched: { name: string; input: Record<string, unknown> }[];
let outcomes: Map<string, DirectOperationOutcome>;
let route: DirectRoute;

// The scripted host: a resolution ends at once with READY; a start ends only when the test finishes it.
const call: DirectRouteDeps['call'] = async (name, input) => {
  expect(validateCommandInput(name as CommandName, input).ok, `${name} input`).toBe(true);
  dispatched.push({ name, input: input as Record<string, unknown> });
  const operationId = (input as { operationId?: string }).operationId!;
  let value: unknown;
  if (name === 'library.entry') value = { artifact: { id: ART, kind: 'dashboard', title: 'Live', createdBy: { kind: 'session', appSessionId: 'app-own' }, projectId: 'proj', createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0 }, links: [] };
  else if (name === 'connectors.directTake') {
    value = { outcome: outcomes.get(operationId) ?? null };
    outcomes.delete(operationId);
  } else if (name === 'connectors.directCancel') value = { cancelled: true };
  else {
    value = { operationId };
    if (name === 'connectors.directResolve') finishLater(operationId, READY);
    if (name === 'connectors.directStart') finishLater(operationId, { kind: 'call', outcome: { ok: true, result: ENVELOPE } });
  }
  expect(validateCommandOutput(name as CommandName, value).ok, `${name} output`).toBe(true);
  return { ok: true, value } as never;
};
function finishLater(operationId: string, outcome: DirectOperationOutcome): void {
  setTimeout(() => {
    outcomes.set(operationId, outcome);
    route.operationEnded(operationId);
  }, 0);
}
const started = () => dispatched.filter((entry) => entry.name === 'connectors.directStart');

beforeEach(() => {
  vi.useFakeTimers();
  dispatched = [];
  outcomes = new Map();
  route = createDirectRoute({ call, sessions: { get: () => ({ projectId: 'proj', directory: '/repo' }) }, projects: { list: () => [{ id: 'proj', directory: '/repo' }] }, realpath: (path) => path, streaming: () => true, log: () => {} });
});
afterEach(() => {
  route.stop();
  vi.useRealTimers();
});

// `promise` settled, the fake clock advanced a millisecond at a time while the scripted host's ends arrive
async function settled<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  void promise.then(() => (done = true));
  for (let step = 0; step < 100 && !done; step += 1) await vi.advanceTimersByTimeAsync(1);
  if (!done) throw new Error('did not settle');
  return promise;
}

async function target(): Promise<ConnectorRouteTarget> {
  const resolved = await settled(route.resolve(ART, SERIES, new AbortController().signal));
  if (!resolved) throw new Error('no target');
  return resolved;
}

describe('route D’s target and a dataset sink', () => {
  it('never runs a dataset call as a plain direct call: nothing is started, and the work is unavailable', async () => {
    const found = await target();
    const answer = await settled(found.call({}, { signal: new AbortController().signal, fingerprint: FP, mode: 'read', dataset: DATASET, publishable: () => true }));
    expect(answer).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(started()).toEqual([]);
  });

  it('a plain call (no dataset) still starts and answers as P3-HD built it', async () => {
    const found = await target();
    expect(await settled(found.call({}, { signal: new AbortController().signal, fingerprint: FP, mode: 'read' }))).toEqual({ ok: true, result: ENVELOPE });
    expect(started()).toHaveLength(1);
    expect(started()[0]!.input).not.toHaveProperty('dataset');
  });
});

describe('the broker over route E (no live engine) and route D', () => {
  const READ: ConnectorGrant = { ...SERIES, fingerprint: FP, mode: 'read', grantedAt: 1 };
  const grants: ConnectorGrantAuthority = {
    list: async () => [READ],
    grant: async () => READ,
    revoke: async () => true,
    check: async (): Promise<ConnectorAuthorization> => ({ granted: true, mode: 'read' }),
  };
  const noEngine: ConnectorRoute = { route: 'engine', resolve: async () => null };
  let broker: ConnectorBroker;
  let sessionAsked: number;
  beforeEach(() => {
    sessionAsked = 0;
    broker = new ConnectorBroker({
      routes: [noEngine, route],
      grants,
      log: () => {},
      recheckWindow: (owner) => broker.setWindowShown(owner, true),
      sessionRoute: async () => {
        sessionAsked += 1;
        return null; // the asking session has no live engine
      },
    });
    broker.setWindowShown(ME, true);
  });
  afterEach(() => broker.stop());
  const raw = (value: unknown) => JSON.stringify(value).includes('signups');

  it('a page’s dataset watch is paused unavailable: no direct call, and no raw result reaches the page', async () => {
    const lease = broker.open(ME, ART);
    broker.declareTools(ME, lease, [SERIES]);
    broker.setVisible(ME, lease, true);
    const updates: ConnectorCallOutcome[] = [];
    expect(broker.watchTool(ME, lease, { ...SERIES, intervalMs: 30_000 }, (update) => updates.push(update), { dataset: DATASET })).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates).toContainEqual({ ok: false, state: 'paused', reason: 'unavailable' });
    expect(updates.some((update) => update.ok || raw(update))).toBe(false);
    expect(started()).toEqual([]);
    expect(dispatched.some((entry) => entry.name === 'connectors.directResolve')).toBe(true); // route D was asked, metadata only
  });

  it('a page’s dataset call is refused the same way', async () => {
    const lease = broker.open(ME, ART);
    broker.declareTools(ME, lease, [SERIES]);
    broker.setVisible(ME, lease, true);
    const outcome = await settled(broker.callTool(ME, lease, SERIES, { dataset: { ...DATASET, baseRevision: 3 } }));
    expect(outcome).toEqual({ ok: false, state: 'paused', reason: 'unavailable' });
    expect(started()).toEqual([]);
  });

  it('an agent’s refresh with no engine of its own is unavailable, with no direct call and no raw result in its answer', async () => {
    const outcome = await settled(broker.refreshForSession({ appSessionId: 'app-asker', artifactId: ART, ...SERIES, args: {}, dataset: { ...DATASET, baseRevision: 4, requestId: '00000000-0000-4000-8000-000000000001' } }));
    expect(sessionAsked).toBe(1);
    expect(outcome).toEqual({ ok: false, state: 'paused', reason: 'unavailable' });
    expect(raw(outcome)).toBe(false);
    expect(started()).toEqual([]);
  });

  it('a page’s plain call (no dataset) still reaches route D, as P3-HD built it', async () => {
    const lease = broker.open(ME, ART);
    broker.declareTools(ME, lease, [SERIES]);
    broker.setVisible(ME, lease, true);
    expect(await settled(broker.callTool(ME, lease, SERIES))).toMatchObject({ ok: true, result: ENVELOPE, via: { route: 'direct' } });
    expect(started()).toHaveLength(1);
  });
});
