// P3-HD M3b: route D's main half, its grant-backed targets, tool-specific source selection and the bounded credential
// preparation seam (./direct-route.ts; docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, Decision Log 18, 19, 21
// and 22). A scripted engine host answers the direct operation family; a scripted preparer stands where M3c's OAuth
// provider will. What main dispatched is the evidence: no start or discovery leaves main after the operation ended.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '@shared/ipc/schema';
import type { DirectOperationOutcome, DirectSource } from '@shared/ipc/schema/connectors';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { ConnectorBroker } from './broker';
import { createDirectRoute, DIRECT_OPERATION_DEADLINE_MS, type DirectCredentialPreparation, type DirectRoute, type DirectRouteDeps } from './direct-route';
import type { ConnectorGrantAuthority, ConnectorRouteTarget } from './route';

const ART = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION = '44444444-4444-4444-8444-444444444444';
const FP = 'f'.repeat(64);
const ROWS = { server: 'fixture', tool: 'rows' };
const TOKEN = 'access-token-sentinel-91be';

const httpSource = (patch: Partial<DirectSource> = {}): DirectSource => ({ directory: '/repo', sourceId: SOURCE_ID, generation: 3, server: 'fixture', scope: 'user', transport: 'http', path: '/home/.claude.json', entryPath: ['mcpServers', 'fixture'], observedAt: '2026-10-17T00:00:00.000Z', resourceUrl: 'https://mcp.example.test/mcp', ...patch });
const resolved = (tool: { fingerprint: string; readOnly: boolean } | { fingerprint: string; grantBacked: true } | null, source = httpSource()): DirectOperationOutcome => ({ kind: 'resolve', answer: { ready: true, source, ...(tool && { tool }) } });

type Dispatched = { name: string; input: Record<string, unknown> };
let dispatched: Dispatched[];
let outcomes: Map<string, DirectOperationOutcome>;
let route: DirectRoute;
let streams: boolean;

const call: DirectRouteDeps['call'] = async (name, input) => {
  expect(validateCommandInput(name as CommandName, input).ok, `${name} input`).toBe(true);
  dispatched.push({ name, input: input as Record<string, unknown> });
  let value: unknown;
  if (name === 'library.entry') value = { artifact: { id: ART, kind: 'html', title: 'Live', createdBy: { kind: 'session', appSessionId: 'app-own' }, projectId: 'proj', createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0 }, links: [] };
  else if (name === 'connectors.directTake') {
    const id = (input as { operationId: string }).operationId;
    value = { outcome: outcomes.get(id) ?? null };
    outcomes.delete(id);
  } else if (name === 'connectors.directCancel') value = { cancelled: true };
  else if (name === 'connectors.directClose') value = { cancelled: 0 };
  else value = { operationId: (input as { operationId: string }).operationId };
  expect(validateCommandOutput(name as CommandName, value).ok, `${name} output`).toBe(true);
  return { ok: true, value } as never;
};
const of = (name: string) => dispatched.filter((entry) => entry.name === name);
const last = (name: string) => of(name).at(-1)!;
function finish(name: string, outcome: DirectOperationOutcome): void {
  const id = last(name).input.operationId as string;
  outcomes.set(id, outcome);
  route.operationEnded(id);
}

// A preparer whose answers the test releases one by one.
class Preparer implements DirectCredentialPreparation {
  readonly asked: { source: DirectSource; purpose: string; signal: AbortSignal }[] = [];
  readonly reports: unknown[] = [];
  private readonly answers: ((value: Awaited<ReturnType<DirectCredentialPreparation['prepare']>>) => void)[] = [];
  prepare: DirectCredentialPreparation['prepare'] = (request) => {
    this.asked.push(request);
    return new Promise((resolve) => this.answers.push(resolve));
  };
  unauthorized: DirectCredentialPreparation['unauthorized'] = (report) => void this.reports.push(report);
  answer(value: Awaited<ReturnType<DirectCredentialPreparation['prepare']>>, index = this.answers.length - 1): void {
    this.answers[index]!(value);
  }
}
let preparer: Preparer;

function makeRoute(credentials: DirectCredentialPreparation | null): DirectRoute {
  return createDirectRoute({ call, sessions: { get: () => ({ projectId: 'proj', directory: '/repo' }) }, projects: { list: () => [{ id: 'proj', directory: '/repo' }] }, realpath: (path) => path, streaming: () => streams, log: () => {}, ...(credentials && { credentials }) });
}

beforeEach(() => {
  vi.useFakeTimers();
  dispatched = [];
  outcomes = new Map();
  streams = true;
  preparer = new Preparer();
  route = makeRoute(preparer);
});
afterEach(() => {
  route.stop();
  vi.useRealTimers();
});
const settle = () => vi.advanceTimersByTimeAsync(0);
const credential = { connectionId: CONNECTION, credentialEpoch: 7, accessToken: TOKEN };
const context = (controller = new AbortController()) => ({ signal: controller.signal, fingerprint: FP, mode: 'read' as const });

async function targetOf(outcome: DirectOperationOutcome): Promise<ConnectorRouteTarget | null> {
  const pending = route.resolve(ART, ROWS, new AbortController().signal);
  await settle();
  finish('connectors.directResolve', outcome);
  return pending;
}

describe('a grant-backed resolution', () => {
  it('reaches the broker as readOnly false with the marker; observed metadata as reported, without it', async () => {
    expect(await targetOf(resolved({ fingerprint: FP, grantBacked: true }))).toMatchObject({ fingerprint: FP, readOnly: false, grantBacked: true });
    const observed = await targetOf(resolved({ fingerprint: FP, readOnly: true }));
    expect(observed).toMatchObject({ readOnly: true });
    expect(observed).not.toHaveProperty('grantBacked');
  });

  it('resolution never prepares a credential', async () => {
    await targetOf(resolved({ fingerprint: FP, grantBacked: true }));
    expect(preparer.asked).toEqual([]);
  });
});

describe('credential preparation inside the call’s registered lifetime', () => {
  it('prepares for the complete final source after the broker’s check, then sends the credential with the start', async () => {
    const target = (await targetOf(resolved({ fingerprint: FP, readOnly: true })))!;
    expect(preparer.asked).toEqual([]);
    const pending = target.call({}, context());
    await settle();
    expect(preparer.asked).toEqual([{ source: httpSource(), purpose: 'call', signal: expect.any(AbortSignal) }]);
    expect(of('connectors.directStart')).toEqual([]);
    preparer.answer({ ok: true, credential });
    await settle();
    expect(last('connectors.directStart').input).toMatchObject({ sourceId: SOURCE_ID, credential });
    finish('connectors.directStart', { kind: 'call', outcome: { ok: true, result: 'rows' } });
    expect(await pending).toEqual({ ok: true, result: 'rows' });
  });

  it('a stdio source is never prepared for; no credential rides its start', async () => {
    const target = (await targetOf(resolved({ fingerprint: FP, readOnly: true }, httpSource({ transport: 'stdio', resourceUrl: undefined }))))!;
    void target.call({}, context());
    await settle();
    expect(preparer.asked).toEqual([]);
    expect(last('connectors.directStart').input).not.toHaveProperty('credential');
  });

  it('a preparation that answers no credential sends a start without one; one that refuses sends nothing', async () => {
    const target = (await targetOf(resolved({ fingerprint: FP, readOnly: true })))!;
    void target.call({}, context());
    await settle();
    preparer.answer({ ok: true, credential: null });
    await settle();
    expect(last('connectors.directStart').input).not.toHaveProperty('credential');
    const refused = target.call({}, context());
    await settle();
    preparer.answer({ ok: false });
    expect(await refused).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(of('connectors.directStart')).toHaveLength(1);
  });

  const enders: [string, (controller: AbortController) => void | Promise<unknown>][] = [
    ['the caller’s cancellation', (controller) => controller.abort()],
    ['the operation’s deadline', () => vi.advanceTimersByTimeAsync(DIRECT_OPERATION_DEADLINE_MS)],
    ['the host leaving ready', () => route.hostLost()],
    ['main stopping', () => route.stop()],
    ['a global close', () => route.close()],
  ];
  for (const [label, end] of enders) {
    it(`${label} during preparation settles the call at once, aborts the preparation and sends no start when it answers late`, async () => {
      const target = (await targetOf(resolved({ fingerprint: FP, readOnly: true })))!;
      const controller = new AbortController();
      const pending = target.call({}, context(controller));
      await settle();
      const { signal } = preparer.asked[0]!;
      await end(controller);
      expect(await pending).toMatchObject({ ok: false });
      expect(signal.aborted).toBe(true);
      preparer.answer({ ok: true, credential });
      await settle();
      expect(of('connectors.directStart')).toEqual([]);
      expect(of('connectors.directCancel')).toEqual([]); // nothing was sent to withdraw
    });
  }

  it('a preparation that throws is unavailable, and sends nothing', async () => {
    preparer.prepare = () => Promise.reject(new Error(`${TOKEN} broke`));
    const target = (await targetOf(resolved({ fingerprint: FP, readOnly: true })))!;
    const answer = await target.call({}, context());
    expect(answer).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
    expect(of('connectors.directStart')).toEqual([]);
  });
});

describe('unauthorized reports name the exact credential used', () => {
  it('reports the connection and epoch the start carried, never the token', async () => {
    const target = (await targetOf(resolved({ fingerprint: FP, readOnly: true })))!;
    const pending = target.call({}, context());
    await settle();
    preparer.answer({ ok: true, credential });
    await settle();
    finish('connectors.directStart', { kind: 'call', outcome: { ok: false, failure: 'unavailable', reason: 'unauthorized' } });
    expect(await pending).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(preparer.reports).toEqual([{ source: httpSource(), purpose: 'call', credential: { connectionId: CONNECTION, credentialEpoch: 7 } }]);
    expect(JSON.stringify(preparer.reports)).not.toContain(TOKEN);
  });

  it('reports no credential when none was sent, and nothing for another failure', async () => {
    const target = (await targetOf(resolved({ fingerprint: FP, readOnly: true })))!;
    const first = target.call({}, context());
    await settle();
    preparer.answer({ ok: true, credential: null });
    await settle();
    finish('connectors.directStart', { kind: 'call', outcome: { ok: false, failure: 'unavailable', reason: 'unauthorized' } });
    await first;
    const second = target.call({}, context());
    await settle();
    preparer.answer({ ok: true, credential });
    await settle();
    finish('connectors.directStart', { kind: 'call', outcome: { ok: false, failure: 'unavailable', reason: 'connection' } });
    await second;
    expect(preparer.reports).toEqual([{ source: httpSource(), purpose: 'call', credential: null }]);
  });
});

describe('the owner’s discovery and tool-specific source selection', () => {
  it('discovery prepares for the complete source, sends only its private reference and the credential, and reports unauthorized', async () => {
    const pending = route.discover(httpSource(), new AbortController().signal);
    await settle();
    expect(preparer.asked).toMatchObject([{ source: httpSource(), purpose: 'discover' }]);
    expect(of('connectors.directDiscover')).toEqual([]);
    preparer.answer({ ok: true, credential });
    await settle();
    expect(last('connectors.directDiscover').input).toEqual({ operationId: expect.any(String), directory: '/repo', sourceId: SOURCE_ID, generation: 3, server: 'fixture', credential });
    finish('connectors.directDiscover', { kind: 'discover', answer: { ok: false, failure: 'unavailable', reason: 'unauthorized' } });
    expect(await pending).toEqual({ ok: false, failure: 'unavailable', reason: 'unauthorized' });
    expect(preparer.reports).toEqual([{ source: httpSource(), purpose: 'discover', credential: { connectionId: CONNECTION, credentialEpoch: 7 } }]);
  });

  it('a discovery cancelled during preparation sends nothing', async () => {
    const controller = new AbortController();
    const pending = route.discover(httpSource(), controller.signal);
    await settle();
    controller.abort();
    expect(await pending).toMatchObject({ ok: false });
    preparer.answer({ ok: true, credential });
    await settle();
    expect(of('connectors.directDiscover')).toEqual([]);
  });

  it('without a preparer an HTTP call and discovery carry no credential (open HTTP)', async () => {
    route.stop();
    route = makeRoute(null);
    const target = (await targetOf(resolved({ fingerprint: FP, readOnly: true })))!;
    void target.call({}, context());
    void route.discover(httpSource(), new AbortController().signal);
    await settle();
    expect(last('connectors.directStart').input).not.toHaveProperty('credential');
    expect(last('connectors.directDiscover').input).not.toHaveProperty('credential');
  });

  it('a source selected for a named tool asks the host’s ranking for that tool and answers its source and metadata', async () => {
    const pending = route.resolveSource(ART, 'fixture', new AbortController().signal, 'rows');
    await settle();
    expect(last('connectors.directResolve').input).toMatchObject({ server: 'fixture', tool: 'rows' });
    finish('connectors.directResolve', resolved({ fingerprint: FP, grantBacked: true }, httpSource({ directory: '/docs' })));
    expect(await pending).toEqual({ ok: true, source: httpSource({ directory: '/docs' }), tool: { fingerprint: FP, grantBacked: true } });
    const bare = route.resolveSource(ART, 'fixture', new AbortController().signal);
    await settle();
    expect(last('connectors.directResolve').input).not.toHaveProperty('tool');
    finish('connectors.directResolve', resolved(null));
    expect(await bare).toEqual({ ok: true, source: httpSource() });
  });
});

// P3-F F-connectors 6: the broker's re-read of the owner's native window happens at route D's own door, after the
// credential preparation's awaits, so a window that hid unannounced meanwhile dispatches nothing (no Allow once is used)
describe('the native window after a credential preparation', () => {
  it('a window that hid with no event while the credential was prepared dispatches nothing, its call paused', async () => {
    let shown = true;
    const grants: ConnectorGrantAuthority = { list: async () => [], grant: async () => Promise.reject(new Error('no grant here')), revoke: async () => false, check: async () => ({ granted: true, mode: 'once' }) };
    const broker: ConnectorBroker = new ConnectorBroker({ routes: [route], grants, log: () => {}, recheckWindow: (owner) => broker.setWindowShown(owner, shown) });
    try {
      broker.setWindowShown('window-1', true);
      const lease = broker.open('window-1', ART);
      broker.declareTools('window-1', lease, [ROWS]);
      broker.setVisible('window-1', lease, true);
      const calling = broker.callTool('window-1', lease, ROWS);
      await settle();
      finish('connectors.directResolve', resolved({ fingerprint: FP, readOnly: false }));
      await vi.waitFor(() => expect(preparer.asked).toHaveLength(1));
      shown = false; // hidden, and no Electron event says so: only a re-read hears it
      preparer.answer({ ok: true, credential });
      await settle();
      expect(of('connectors.directStart')).toEqual([]);
      expect(await calling).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    } finally {
      broker.stop();
    }
  });
});
