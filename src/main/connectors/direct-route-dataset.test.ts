// E3c: route D publishes dataset work in the host; main receives metadata alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorAuthorization, ConnectorCallOutcome, ConnectorGrant, ConnectorToolRef } from '@shared/artifacts/connectors';
import type { CommandName } from '@shared/ipc/schema';
import type { ConnectorDatasetTake, DirectOperationOutcome } from '@shared/ipc/schema/connectors';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { ConnectorBroker } from './broker';
import { createDirectRoute, DIRECT_RETRY_MS, type DirectRoute, type DirectRouteDeps } from './direct-route';
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
let phases: Map<string, ConnectorDatasetTake>;
let holdPublication: boolean;
let cancelled: boolean;
let cancelUnanswered: boolean; // P3-F F-connectors 5: `connectors.directCancel` fails (the dispatch timed out)
let takeUnanswered: boolean; // P3-F F-connectors 5 sibling: `connectors.directTake` fails the same way
const PUBLISHED = { status: 'dataset' as const, artifactId: ART, id: DATASET.id, revision: 5, columns: [{ name: 'day', type: 'string' as const }, { name: 'signups', type: 'number' as const }], rows: 1 };

// The scripted host: a resolution ends at once with READY; a start ends only when the test finishes it.
const call: DirectRouteDeps['call'] = async (name, input) => {
  expect(validateCommandInput(name as CommandName, input).ok, `${name} input`).toBe(true);
  dispatched.push({ name, input: input as Record<string, unknown> });
  const operationId = (input as { operationId?: string }).operationId!;
  let value: unknown;
  if (name === 'library.entry') value = { artifact: { id: ART, kind: 'dashboard', title: 'Live', createdBy: { kind: 'session', appSessionId: 'app-own' }, projectId: 'proj', createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0 }, links: [] };
  else if (name === 'connectors.directTake') {
    if (takeUnanswered) return { ok: false, error: { code: 'timeout', message: 'no answer' } } as never;
    const dataset = phases.get(operationId);
    value = { outcome: outcomes.get(operationId) ?? null, ...(dataset && { dataset }) };
    if (dataset?.status === 'publishing' && !holdPublication) setTimeout(() => { phases.set(operationId, PUBLISHED); route.operationEnded(operationId); }, 0);
    phases.delete(operationId);
    outcomes.delete(operationId);
  } else if (name === 'connectors.directCancel') {
    if (cancelUnanswered) return { ok: false, error: { code: 'timeout', message: 'no answer' } } as never;
    value = { cancelled };
  }
  else {
    value = { operationId };
    if (name === 'connectors.directResolve') finishLater(operationId, READY);
    if (name === 'connectors.directStart') {
      if ('dataset' in (input as object)) setTimeout(() => { phases.set(operationId, { status: 'publishing', operationId }); route.operationEnded(operationId); }, 0);
      else finishLater(operationId, { kind: 'call', outcome: { ok: true, result: ENVELOPE } });
    }
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
  phases = new Map();
  holdPublication = false;
  cancelled = true;
  cancelUnanswered = false;
  takeUnanswered = false;
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
  it('takes publication phases and answers only compact metadata', async () => {
    const found = await target();
    const answer = await settled(found.call({}, { signal: new AbortController().signal, fingerprint: FP, mode: 'read', dataset: DATASET, publishable: () => true }));
    expect(answer).toEqual({ ok: true, result: PUBLISHED });
    expect(started()[0]!.input).toMatchObject({ dataset: DATASET });
    expect(started()[0]!.input).not.toHaveProperty('appSessionId');
  });

  it('rechecks visibility before taking and cancels work that may no longer publish', async () => {
    const found = await target();
    const answer = await settled(found.call({}, { signal: new AbortController().signal, fingerprint: FP, mode: 'read', dataset: DATASET, publishable: () => false }));
    expect(answer).toMatchObject({ ok: false, failure: 'unavailable' });
    const id = started()[0]!.input.operationId;
    const commands = dispatched.filter((entry) => entry.input.operationId === id).map((entry) => entry.name);
    expect(commands.slice(0, 2)).toEqual(['connectors.directStart', 'connectors.directCancel']);
  });

  it('waits for the durable dataset end when cancellation loses to the host commit', async () => {
    const found = await target();
    holdPublication = true;
    cancelled = false;
    const controller = new AbortController();
    let ended = false;
    const answer = found.call({}, { signal: controller.signal, fingerprint: FP, mode: 'read', dataset: DATASET, publishable: () => !controller.signal.aborted }).then((end) => { ended = true; return end; });
    await vi.advanceTimersByTimeAsync(2);
    const id = started()[0]!.input.operationId as string;
    phases.set(id, { status: 'publishing', operationId: id });
    controller.abort();
    await vi.advanceTimersByTimeAsync(2);
    expect(ended).toBe(false);
    expect(dispatched.filter((entry) => entry.name === 'connectors.directCancel')).toHaveLength(1);
    phases.set(id, PUBLISHED);
    route.operationEnded(id);
    expect(await settled(answer)).toEqual({ ok: true, result: PUBLISHED });
  });

  // P3-F F-connectors 5: an unanswered cancel settles nothing; the operation's next end asks the cancel again before any
  // take, and the host's durable end answers the call
  it('keeps an operation whose cancel went unanswered and asks the cancel again before taking its end', async () => {
    const found = await target();
    holdPublication = true;
    cancelUnanswered = true;
    const controller = new AbortController();
    let ended = false;
    const answer = found.call({}, { signal: controller.signal, fingerprint: FP, mode: 'read', dataset: DATASET, publishable: () => !controller.signal.aborted }).then((end) => { ended = true; return end; });
    await vi.advanceTimersByTimeAsync(2);
    const id = started()[0]!.input.operationId as string;
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(ended).toBe(false);
    cancelUnanswered = false;
    cancelled = false; // the host had admitted the commit
    phases.set(id, PUBLISHED);
    route.operationEnded(id);
    expect(await settled(answer)).toEqual({ ok: true, result: PUBLISHED });
    expect(dispatched.filter((entry) => entry.input.operationId === id).map((entry) => entry.name).slice(-3)).toEqual(['connectors.directCancel', 'connectors.directCancel', 'connectors.directTake']);
  });

  // P3-F F-connectors 5 sibling: an unanswered take may have started the publication: kept, and taken again until the
  // publication's durable end
  it('keeps an operation whose take went unanswered and takes again until the publication’s durable end', async () => {
    const found = await target();
    takeUnanswered = true;
    let ended = false;
    const answer = found.call({}, { signal: new AbortController().signal, fingerprint: FP, mode: 'read', dataset: DATASET, publishable: () => true }).then((end) => { ended = true; return end; });
    await vi.advanceTimersByTimeAsync(2);
    const id = started()[0]!.input.operationId as string;
    expect(dispatched.filter((entry) => entry.name === 'connectors.directTake' && entry.input.operationId === id)).toHaveLength(1);
    expect(ended).toBe(false);
    takeUnanswered = false;
    await vi.advanceTimersByTimeAsync(DIRECT_RETRY_MS); // taken again: the publication runs and ends
    expect(await settled(answer)).toEqual({ ok: true, result: PUBLISHED });
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
  const raw = (value: unknown) => /structuredContent|2026-10-01|content/.test(JSON.stringify(value));

  it('a page’s dataset watch publishes over direct with no raw result reaching the page', async () => {
    const lease = broker.open(ME, ART);
    broker.declareTools(ME, lease, [SERIES]);
    broker.setVisible(ME, lease, true);
    const updates: ConnectorCallOutcome[] = [];
    expect(broker.watchTool(ME, lease, { ...SERIES, intervalMs: 30_000 }, (update) => updates.push(update), { dataset: DATASET })).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates).toContainEqual(expect.objectContaining({ ok: true, result: PUBLISHED, via: expect.objectContaining({ route: 'direct' }) }));
    expect(updates.some(raw)).toBe(false);
    expect(started().length).toBeGreaterThan(0);
    expect(dispatched.some((entry) => entry.name === 'connectors.directResolve')).toBe(true); // route D was asked, metadata only
  });

  it('a page’s dataset call uses the same publication path', async () => {
    const lease = broker.open(ME, ART);
    broker.declareTools(ME, lease, [SERIES]);
    broker.setVisible(ME, lease, true);
    const outcome = await settled(broker.callTool(ME, lease, SERIES, { dataset: { ...DATASET, baseRevision: 3 } }));
    expect(outcome).toMatchObject({ ok: true, result: PUBLISHED, via: { route: 'direct' } });
    expect(started()[0]!.input).toMatchObject({ dataset: { ...DATASET, baseRevision: 3 } });
  });

  it('an agent’s refresh with no engine keeps its request and session binding, without raw rows', async () => {
    const outcome = await settled(broker.refreshForSession({ appSessionId: 'app-asker', artifactId: ART, ...SERIES, args: {}, dataset: { ...DATASET, baseRevision: 4, requestId: '00000000-0000-4000-8000-000000000001' } }));
    expect(sessionAsked).toBe(1);
    expect(outcome).toMatchObject({ ok: true, result: PUBLISHED, via: { route: 'direct' } });
    expect(raw(outcome)).toBe(false);
    expect(started()[0]!.input).toMatchObject({ appSessionId: 'app-asker', dataset: { ...DATASET, baseRevision: 4, requestId: '00000000-0000-4000-8000-000000000001' } });
  });

  it('a page’s plain call (no dataset) still reaches route D, as P3-HD built it', async () => {
    const lease = broker.open(ME, ART);
    broker.declareTools(ME, lease, [SERIES]);
    broker.setVisible(ME, lease, true);
    expect(await settled(broker.callTool(ME, lease, SERIES))).toMatchObject({ ok: true, result: ENVELOPE, via: { route: 'direct' } });
    expect(started()).toHaveLength(1);
  });
});
